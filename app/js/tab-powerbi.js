/* Power BI tab: embeds the published report (CFG.POWERBI_URL) in a responsive 16:9 frame. */
window.FE.tabs.powerbi = {
  render(el) {
    const { CFG } = window.FE;

    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h3>Fraud &amp; Compliance dashboard</h3>
          <a href="${CFG.POWERBI_URL}" target="_blank" rel="noopener">Open full screen &rarr;</a>
        </div>
        <div class="pbi-frame">
          <iframe title="Fraud &amp; Compliance dashboard" src="${CFG.POWERBI_URL}"
            frameborder="0" allowfullscreen loading="lazy"></iframe>
        </div>
        <p class="muted">Dummy dataset only — no real customer data.</p>
      </div>`;
  },
};
