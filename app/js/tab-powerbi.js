/* Power BI: the mandated Layer-1 deliverable, embedded so the exploration board
   and the formal dashboard live at one address. The report reads the same
   analytical layer as this board — the nine tables served from BigQuery. */
window.FE.tabs.powerbi = {
  render(el) {
    const { CFG } = window.FE;

    el.innerHTML = `
      <p class="tab-intro">The Power BI dashboard is the assessment's core deliverable. It reads the
      same analytical layer as this board — the nine tables loaded into BigQuery — across four pages:
      Overview, Risk deep-dive, Controls &amp; operations, and Detection layers. The live published
      report is embedded below; the interactive board in the other tabs is the Layer-2 prototype it
      inspired.</p>

      <div class="card">
        <div class="card-head">
          <h3>Fraud &amp; Compliance dashboard — Power BI</h3>
          <a href="${CFG.POWERBI_URL}" target="_blank" rel="noopener">Open full screen &rarr;</a>
        </div>
        <div class="pbi-frame">
          <iframe title="Fraud &amp; Compliance — Power BI report" src="${CFG.POWERBI_URL}"
            frameborder="0" allowfullscreen loading="lazy"></iframe>
        </div>
        <p class="muted">Published with Power BI "Publish to web". Dummy dataset only — no real customer data.</p>
      </div>`;
  },
};
