// Small DOM / formatting helpers shared by views.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export const n0 = (x) => nf0.format(x || 0);
export const n1 = (x) => nf1.format(x || 0);
export const n2 = (x) => nf2.format(x || 0);
export const usd = (x) => (x < 0 ? "−$" : "$") + nf0.format(Math.abs(Math.round(x || 0)));
export const usd2 = (x) => (x < 0 ? "−$" : "$") + nf2.format(Math.abs(x || 0));
export const signed = (x, f = usd) => (x > 0 ? "+" : "") + f(x);
export const cls = (x) => (x > 0.004 ? "pos" : x < -0.004 ? "neg" : "");
export const fmtDate = (s) => {
  if (!s) return "—";
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
export const px = (root, v) => (v == null ? "—" : root === "ZC" ? n2(v) + "¢" : "$" + n2(v));

export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2600);
}

export function download(name, text, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// Modal form builder. fields: [{k,label,type,options,step,required,help,full,show}]
export function formModal({ title, fields, values = {}, submitLabel = "Save", onDelete }) {
  return new Promise((resolve) => {
    const dlg = $("#modal");
    const row = (f) => {
      const v = values[f.k] ?? f.default ?? "";
      const id = "f_" + f.k;
      let input;
      if (f.type === "select") {
        input = `<select id="${id}" name="${f.k}">${f.options.map((o) => {
          const [val, lab] = Array.isArray(o) ? o : [o, o];
          return `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(lab)}</option>`;
        }).join("")}</select>`;
      } else if (f.type === "textarea") {
        input = `<textarea id="${id}" name="${f.k}" rows="2">${esc(v)}</textarea>`;
      } else {
        input = `<input id="${id}" name="${f.k}" type="${f.type || "text"}" ${f.type === "number" ? `inputmode="decimal" step="${f.step || "any"}"` : ""} value="${esc(v)}" ${f.required ? "required" : ""} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ""}>`;
      }
      return `<label class="field ${f.full ? "full" : ""}" data-k="${f.k}"><span>${esc(f.label)}</span>${input}${f.help ? `<small>${esc(f.help)}</small>` : ""}</label>`;
    };
    dlg.innerHTML = `<form method="dialog" class="modal-form">
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-x aria-label="Close">✕</button></header>
      <div class="grid">${fields.map(row).join("")}</div>
      <footer>${onDelete ? `<button type="button" class="btn danger" data-del>Delete</button>` : ""}<span class="sp"></span>
      <button type="button" class="btn ghost" data-x>Cancel</button><button class="btn primary" value="ok">${esc(submitLabel)}</button></footer></form>`;
    const form = $("form", dlg);
    const read = () => {
      const o = {};
      for (const f of fields) {
        const el = form.elements[f.k];
        if (!el) continue;
        o[f.k] = f.type === "number" ? (el.value === "" ? "" : +el.value) : el.value.trim();
      }
      return o;
    };
    const applyShow = () => {
      const cur = read();
      for (const f of fields) if (f.show) $(`[data-k="${f.k}"]`, form).style.display = f.show(cur) ? "" : "none";
    };
    form.addEventListener("change", applyShow);
    applyShow();
    let done = false;
    const finish = (val) => { if (done) return; done = true; dlg.close(); resolve(val); };
    $$("[data-x]", form).forEach((b) => b.addEventListener("click", () => finish(null)));
    const del = $("[data-del]", form);
    if (del) del.addEventListener("click", () => { if (confirm("Delete this item?")) { onDelete(); finish(null); } });
    form.addEventListener("submit", (e) => { e.preventDefault(); finish(read()); });
    dlg.addEventListener("close", () => finish(null), { once: true });
    dlg.showModal();
    const first = $("input,select", form);
    if (first && matchMedia("(pointer:fine)").matches) first.focus();
  });
}

// Minimal responsive SVG line chart.
export function lineChart(points, { height = 180, fmtY = usd, zero = true, color = "var(--accent)" } = {}) {
  if (!points.length) return `<div class="chart-empty">No history yet. A snapshot is saved each day you open HerdLedger.</div>`;
  const W = Math.round(Math.min(1040, Math.max(280, ((typeof document !== "undefined" && document.querySelector("#view")?.clientWidth) || 600) - 34))), H = height, pl = 58, pr = 10, pt = 12, pb = 24;
  const ys = points.map((p) => p.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (zero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08; min -= pad; max += pad;
  const n = points.length;
  const X = (i) => pl + (n === 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (n - 1));
  const Y = (v) => pt + ((max - v) * (H - pt - pb)) / (max - min);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const area = `${d}L${X(n - 1).toFixed(1)},${Y(Math.max(min, 0)).toFixed(1)}L${X(0).toFixed(1)},${Y(Math.max(min, 0)).toFixed(1)}Z`;
  const ticks = [max - pad, (max + min) / 2, min + pad];
  const grid = ticks.map((t) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(t)}" y2="${Y(t)}" class="gl"/><text x="${pl - 6}" y="${Y(t) + 4}" text-anchor="end">${esc(fmtY(t))}</text>`).join("");
  const zl = min < 0 && max > 0 ? `<line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" class="zl"/>` : "";
  const lab = (i) => { const s = points[i].x; const dt = new Date(s + "T00:00:00"); return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const xl = n > 1 ? `<text x="${X(0)}" y="${H - 6}">${lab(0)}</text><text x="${X(n - 1)}" y="${H - 6}" text-anchor="end">${lab(n - 1)}</text>` : "";
  const last = points[n - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="chart">
    ${grid}${zl}<path d="${area}" fill="${color}" opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2.5"/>
    <circle cx="${X(n - 1)}" cy="${Y(last.y)}" r="4" fill="${color}"/>${xl}</svg>`;
}

export function sparkline(vals, w = 90, h = 26) {
  if (!vals || vals.length < 2) return "";
  const min = Math.min(...vals), max = Math.max(...vals), r = max - min || 1;
  const d = vals.map((v, i) => `${i ? "L" : "M"}${((i * w) / (vals.length - 1)).toFixed(1)},${(h - 2 - ((v - min) * (h - 4)) / r).toFixed(1)}`).join("");
  const up = vals[vals.length - 1] >= vals[0];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${d}" fill="none" stroke="${up ? "var(--pos)" : "var(--neg)"}" stroke-width="1.6"/></svg>`;
}
