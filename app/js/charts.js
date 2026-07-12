/* Hand-rolled SVG charts (no libraries, CSP-safe). Shared hover tooltip and a
   "how to read this chart" popover on every figure. Colors come from the CSS
   tokens; text always wears ink tokens, never the series color. */
window.FE.charts = (() => {
  const { escapeHtml } = window.FE;
  const tooltip = () => document.getElementById("chart-tooltip");

  const INK = "#0A1633", MUTED = "#5A6B8C", LINE = "#E3E8F2";

  function showTip(evt, html) {
    const el = tooltip();
    el.innerHTML = html;
    el.classList.remove("hidden");
    const pad = 14;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = evt.clientX + pad, y = evt.clientY - h - pad;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y < 8) y = evt.clientY + pad;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
  const hideTip = () => tooltip().classList.add("hidden");

  // Figure wrapper: title + "how to read" affordance + svg mount.
  function figure(el, { title, howToRead }) {
    const fig = document.createElement("figure");
    fig.className = "chart-fig";
    fig.innerHTML = `
      <figcaption>
        <span>${escapeHtml(title)}</span>
        <button class="how-btn" type="button" aria-label="How to read this chart">&#9432; how to read</button>
      </figcaption>
      <div class="chart-mount"></div>`;
    fig.querySelector(".how-btn").addEventListener("click", (e) => {
      showTip(e, `<strong>How to read</strong><br>${escapeHtml(howToRead)}`);
      setTimeout(() => document.addEventListener("click", hideTip, { once: true }), 0);
      e.stopPropagation();
    });
    el.appendChild(fig);
    return fig.querySelector(".chart-mount");
  }

  const svgEl = (w, h) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    s.setAttribute("width", "100%");
    return s;
  };
  const node = (tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  /* Vertical bars. data: [{label, value, color?, tip}] */
  function barChart(el, opts) {
    const mount = figure(el, opts);
    const { data, fmt } = opts;
    const W = 640, H = 260, m = { t: 14, r: 10, b: 40, l: 54 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(...data.map((d) => d.value)) * 1.08;
    const svg = svgEl(W, H);
    for (let i = 0; i <= 3; i++) {                       // recessive gridlines
      const y = m.t + ih - (ih * i) / 3;
      svg.appendChild(node("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: LINE, "stroke-width": 1 }));
      const lbl = node("text", { x: m.l - 8, y: y + 4, "text-anchor": "end", "font-size": 11, fill: MUTED });
      lbl.textContent = fmt(max * i / 3);
      svg.appendChild(lbl);
    }
    const bw = Math.min(46, (iw / data.length) * 0.66);
    data.forEach((d, i) => {
      const x = m.l + (iw / data.length) * (i + 0.5) - bw / 2;
      const h = (d.value / max) * ih;
      const bar = node("rect", {
        x, y: m.t + ih - h, width: bw, height: Math.max(h, 1), rx: 3,
        fill: d.color || "#2E5BFF", class: "chart-mark",
      });
      bar.addEventListener("mousemove", (e) => showTip(e, d.tip));
      bar.addEventListener("mouseleave", hideTip);
      svg.appendChild(bar);
      const xl = node("text", { x: x + bw / 2, y: H - m.b + 16, "text-anchor": "middle", "font-size": 11, fill: MUTED });
      xl.textContent = d.label;
      svg.appendChild(xl);
      if (d.emphasize) {                                  // selective direct label
        const vl = node("text", { x: x + bw / 2, y: m.t + ih - h - 6, "text-anchor": "middle", "font-size": 11.5, "font-weight": 700, fill: INK });
        vl.textContent = fmt(d.value);
        svg.appendChild(vl);
      }
    });
    mount.appendChild(svg);
  }

  /* Horizontal bars. data: [{label, value, color?, tip, emphasize?}] */
  function hBarChart(el, opts) {
    const mount = figure(el, opts);
    const { data, fmt } = opts;
    const W = 640, rowH = 34, m = { t: 8, r: 70, b: 8, l: 150 };
    const H = m.t + m.b + rowH * data.length;
    const iw = W - m.l - m.r;
    const max = Math.max(...data.map((d) => d.value)) || 1;
    const svg = svgEl(W, H);
    data.forEach((d, i) => {
      const y = m.t + rowH * i + 7;
      const w = Math.max((d.value / max) * iw, 2);
      const lbl = node("text", { x: m.l - 8, y: y + 14, "text-anchor": "end", "font-size": 12, fill: INK });
      lbl.textContent = d.label;
      svg.appendChild(lbl);
      const bar = node("rect", { x: m.l, y, width: w, height: 18, rx: 3, fill: d.color || "#2E5BFF", class: "chart-mark" });
      bar.addEventListener("mousemove", (e) => showTip(e, d.tip));
      bar.addEventListener("mouseleave", hideTip);
      svg.appendChild(bar);
      const vl = node("text", { x: m.l + w + 6, y: y + 14, "font-size": 11.5, "font-weight": d.emphasize ? 700 : 400, fill: d.emphasize ? INK : MUTED });
      vl.textContent = fmt(d.value);
      svg.appendChild(vl);
    });
    mount.appendChild(svg);
  }

  /* Multi-series line chart. series: [{name, color, points:[{x,y}]}] — one y axis. */
  function lineChart(el, opts) {
    const mount = figure(el, opts);
    const { series, fmt } = opts;
    const W = 640, H = 260, m = { t: 14, r: 12, b: 40, l: 54 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const xs = series[0].points.map((p) => p.x);
    const max = Math.max(...series.flatMap((s) => s.points.map((p) => p.y))) * 1.1 || 1;
    const X = (i) => m.l + (iw * i) / Math.max(xs.length - 1, 1);
    const Y = (v) => m.t + ih - (v / max) * ih;
    const svg = svgEl(W, H);
    for (let i = 0; i <= 3; i++) {
      const y = m.t + ih - (ih * i) / 3;
      svg.appendChild(node("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: LINE, "stroke-width": 1 }));
      const lbl = node("text", { x: m.l - 8, y: y + 4, "text-anchor": "end", "font-size": 11, fill: MUTED });
      lbl.textContent = fmt(max * i / 3);
      svg.appendChild(lbl);
    }
    const step = Math.ceil(xs.length / 8);
    xs.forEach((x, i) => {
      if (i % step) return;
      const lbl = node("text", { x: X(i), y: H - m.b + 16, "text-anchor": "middle", "font-size": 10.5, fill: MUTED });
      lbl.textContent = x;
      svg.appendChild(lbl);
    });
    for (const s of series) {
      const dAttr = s.points.map((p, i) => `${i ? "L" : "M"}${X(i)},${Y(p.y)}`).join(" ");
      svg.appendChild(node("path", { d: dAttr, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round" }));
      s.points.forEach((p, i) => {
        const dot = node("circle", { cx: X(i), cy: Y(p.y), r: 8, fill: "transparent", class: "chart-hit" });
        dot.addEventListener("mousemove", (e) =>
          showTip(e, `<strong>${escapeHtml(s.name)}</strong> · ${escapeHtml(p.x)}<br>${fmt(p.y)}`));
        dot.addEventListener("mouseleave", hideTip);
        svg.appendChild(dot);
        svg.appendChild(node("circle", { cx: X(i), cy: Y(p.y), r: 2.5, fill: s.color, "pointer-events": "none" }));
      });
    }
    mount.appendChild(svg);
    if (series.length >= 2) {                             // legend for >= 2 series
      const legend = document.createElement("div");
      legend.className = "chart-legend";
      legend.innerHTML = series.map((s) =>
        `<span><i style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`).join("");
      mount.appendChild(legend);
    }
  }

  return { barChart, hBarChart, lineChart, showTip, hideTip };
})();
