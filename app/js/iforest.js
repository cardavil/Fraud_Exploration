/* Isolation Forest inference in the browser — no libraries.
   Consumes app/data/isolation_forest.json (exported by analysis/export_model.py,
   fidelity-checked against sklearn to 1e-9) and reproduces two things exactly:
   the 12-feature engineering of analysis/anomaly.py and sklearn's score_samples
   semantics (anomaly score = 2^(−E[path]/c(max_samples)), higher = worse). */
window.FE.iforest = (() => {
  const { HIGH_RISK, OFFSHORE } = window.FE;
  let model = null;

  async function load() {
    if (!model) model = await fetch("data/isolation_forest.json").then((r) => r.json());
    return model;
  }

  /* Mirror of analysis/account_features.py — same aggregations, same NaN
     handling. txnScores: Map(transaction_id -> {score, anomaly}) from the
     served transaction_scores table (tier 1). datasetMaxDate: max transaction
     date across the WHOLE dataset (recent_intensity is anchored to it). */
  function computeFeatures(transactions, txnScores, datasetMaxDate) {
    const amounts = transactions.map((t) => t.amount).filter((v) => v != null);
    const n = amounts.length;
    const sum = amounts.reduce((s, v) => s + v, 0);
    const mean = n ? sum / n : 0;
    const sampleStd = n > 1
      ? Math.sqrt(amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
    const share = (pred) => transactions.filter(pred).length / transactions.length;
    const days = transactions.map((t) => Date.parse(t.transaction_date));
    const spanDays = (Math.max(...days) - Math.min(...days)) / 86400000 + 1;
    const months = spanDays / 30.44;

    const t1 = transactions.map((t) => txnScores.get(t.transaction_id)).filter(Boolean);
    const byDay = new Map();
    for (const t of transactions) {
      if (t.amount != null) byDay.set(t.transaction_date, (byDay.get(t.transaction_date) ?? 0) + t.amount);
    }
    const maxDay = byDay.size ? Math.max(...byDay.values()) : 0;
    const recentCut = datasetMaxDate - 90 * 86400000;
    const recentValue = transactions.filter((t) => Date.parse(t.transaction_date) > recentCut)
      .reduce((s, t) => s + (t.amount ?? 0), 0);

    return {
      n_tx: transactions.length,
      avg_amt: mean,
      std_amt: sampleStd,
      max_amt: n ? Math.max(...amounts) : 0,
      total: sum,
      pct_hr: share((t) => HIGH_RISK.has(t.counterparty_country)),
      pct_off: share((t) => OFFSHORE.has(t.counterparty_country)),
      pct_cash: share((t) => (t.transaction_type ?? "").includes("Cash")),
      pct_struct: share((t) => t.amount >= 9000 && t.amount < 10000),
      pct_intl: share((t) => t.is_international === "Yes"),
      tx_per_month: transactions.length / months,
      velocity_value: sum / months,
      pct_txn_anomalous: t1.length ? t1.filter((s) => s.anomaly === -1).length / t1.length : 0,
      max_txn_score: t1.length ? Math.max(...t1.map((s) => s.score)) : 0,
      max_day_share: sum ? Math.min(maxDay / sum, 1) : 0,
      recent_intensity: sum ? Math.min(recentValue / sum, 1) : 0,
    };
  }

  function averagePathLength(n) {
    if (n <= 1) return 0;
    if (n === 2) return 1;
    return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n;
  }

  /* features: object keyed like model.features. Returns the pipeline's score. */
  function score(features) {
    const x = model.features.map((name, j) =>
      (features[name] - model.scaler.mean[j]) / model.scaler.scale[j]);
    let depths = 0;
    for (let i = 0; i < model.trees.length; i++) {
      const tree = model.trees[i];
      const feats = model.estimators_features[i];
      let node = 0, edges = 0;
      while (tree.l[node] !== -1) {
        node = x[feats[tree.f[node]]] <= tree.t[node] ? tree.l[node] : tree.r[node];
        edges += 1;
      }
      depths += edges + averagePathLength(tree.n[node]);
    }
    const value = 2 ** (-depths / (model.trees.length * averagePathLength(model.max_samples)));
    return { score: value, isAnomalous: value > -model.offset, cutoff: -model.offset };
  }

  return { load, computeFeatures, score, get model() { return model; } };
})();
