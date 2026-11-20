import { getStore, uid, validateBackup, emptyState } from "./store.js";
import { lotMetrics, positionMetrics, operationSummary, snapshotFrom, todayISO, toCSV, CONTRACT, daysBetween } from "./calc.js";
import { buildSample } from "./sample.js";
import { PLANS, TRIAL_DAYS, BRAND } from "./config.js";
import { $, $$, esc, n0, n1, n2, usd, usd2, signed, cls, fmtDate, px, toast, download, formModal, lineChart, sparkline } from "./ui.js";

const store = getStore();
let state = emptyState();
let quotes = null;
const T = () => todayISO();
const CLASSES = [["steers", "Steers"], ["heifers", "Heifers"], ["cows", "Cows"], ["calves", "Calves"], ["bulls", "Bulls"], ["mixed", "Mixed"]];
const EXP_CATS = ["Feed", "Yardage", "Vet & Health", "Freight", "Interest", "Commission", "Labor", "Pasture", "Insurance", "Checkoff", "Other"];

// ---------- persistence ----------
async function save(msg) {
  autoSnapshot();
  await store.save(state);
  if (msg) toast(msg);
  render();
}
function summary() { return operationSummary(state, quotes, T()); }

// One automatic snapshot per day the app is opened (updated if reopened that day).
function autoSnapshot() {
  if (!state.lots.length) return;
  const today = T();
  const snap = snapshotFrom(summary(), today, false);
  const i = state.snapshots.findIndex((s) => s.date === today && !s.manual);
  if (i >= 0) state.snapshots[i] = snap; else state.snapshots.push(snap);
  state.snapshots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.manual ? 1 : -1)));
}

async function loadQuotes() {
  try {
    const r = await fetch("data/quotes.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    quotes = await r.json();
  } catch (e) {
    console.warn("quotes unavailable", e);
    quotes = null;
  }
}

// ---------- router ----------
const routes = { dash: viewDash, lots: viewLots, lot: viewLot, risk: viewRisk, markets: viewMarkets, equity: viewEquity, reports: viewReports, settings: viewSettings };
function route() {
  const [name, arg] = (location.hash.replace(/^#\/?/, "") || "dash").split("/");
  return { name: routes[name] ? name : "dash", arg };
}
function render(top = false) {
  const { name, arg } = route();
  $("#opname").textContent = state.operation.name;
  $$(".tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === (name === "lot" ? "lots" : name === "equity" ? "dash" : name)));
  $("#view").innerHTML = routes[name](arg);
  bind(name, arg);
  if (top) window.scrollTo?.(0, 0);
}
window.addEventListener("hashchange", () => render(true));
let _rz, _w = innerWidth; window.addEventListener("resize", () => { if (innerWidth === _w) return; _w = innerWidth; clearTimeout(_rz); _rz = setTimeout(() => { if (!document.querySelector("dialog[open]")) render(); }, 250); });

// ---------- shared bits ----------
const kpi = (label, val, extra = "", c = "") => `<div class="kpi"><span>${label}</span><b class="${c}">${val}</b>${extra ? `<small>${extra}</small>` : ""}</div>`;
const quoteAsOf = () => quotes ? `End-of-day prices as of ${fmtDate(Object.values(quotes.contracts || {})[0]?.date)} · delayed, not real-time` : "Market prices unavailable — values use manual cash prices only";
function emptyOps() {
  return `<section class="empty card">
    <img src="img/logo.svg" alt="" width="64" height="64">
    <h2>Welcome to ${BRAND.name}</h2>
    <p>Add your first lot, or load a sample operation to see how everything fits together. Your data stays in this browser.</p>
    <div class="row"><button class="btn primary" data-act="sample">Load sample operation</button><button class="btn" data-act="add-lot">Add a lot</button></div>
  </section>`;
}
function lotRow(m) {
  return `<a class="lot-card" href="#/lot/${m.id}">
    <div class="lc-top"><b>${esc(m.name)}</b><span class="pill ${m.status}">${m.status === "sold" ? "Sold" : n0(m.headOnHand) + " hd"}</span></div>
    <div class="lc-grid">
      <div><span>${m.status === "sold" ? "Sale wt" : "Est. wt"}</span><b>${n0(m.estWeight)} lb</b></div>
      <div><span>Breakeven</span><b>$${n2(m.breakevenCwt)}</b></div>
      <div><span>${m.status === "sold" ? "Sold" : "Market"}</span><b>$${n2(m.marketCwt)}</b></div>
      <div><span>${m.status === "sold" ? "Realized" : "P/L"}</span><b class="${cls(m.pl)}">${signed(m.pl)}</b></div>
    </div></a>`;
}

// ---------- Dashboard ----------
function viewDash() {
  if (!state.lots.length) return emptyOps() + quotesStrip();
  const s = summary();
  const snaps = dailySnaps();
  const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
  const chg = prev ? s.equity - prev.equity : null;
  const ex = s.exposure;
  return `
  <section class="kpis">
    ${kpi("Head on hand", n0(s.totalHead), `${s.open.length} open lot${s.open.length === 1 ? "" : "s"}`)}
    ${kpi("Cost basis", usd(s.costBasis), s.totalHead ? usd(s.costBasis / s.totalHead) + "/hd" : "")}
    ${kpi("Market value", usd(s.marketValue), s.totalHead ? usd(s.marketValue / s.totalHead) + "/hd" : "")}
    ${kpi("Cattle P/L", signed(s.cattlePL), "vs. market", cls(s.cattlePL))}
    ${kpi("Hedge P/L", signed(s.hedgeValue), `${state.positions.length} position${state.positions.length === 1 ? "" : "s"}`, cls(s.hedgeValue))}
    ${kpi("Equity", signed(s.equity), chg == null ? "cattle + hedges" : `${signed(chg)} since ${fmtDate(prev.date)}`, cls(s.equity) + " big")}
  </section>
  <section class="card">
    <div class="card-h"><h3>Equity trend</h3><a href="#/equity" class="link">History →</a></div>
    ${lineChart(snaps.map((x) => ({ x: x.date, y: x.equity })))}
    <p class="muted tiny">Equity = market value of cattle on hand − cost basis + hedge mark-to-market. ${quoteAsOf()}.</p>
  </section>
  <section class="card">
    <div class="card-h"><h3>Price exposure</h3><a href="#/risk" class="link">Risk →</a></div>
    ${exposureBar(ex)}
  </section>
  <section class="card">
    <div class="card-h"><h3>Open lots</h3><a href="#/lots" class="link">All lots →</a></div>
    <div class="lot-list">${s.open.map(lotRow).join("") || `<p class="muted">No open lots.</p>`}</div>
    <button class="btn block" data-act="add-lot">+ Add lot</button>
  </section>
  ${quotesStrip()}`;
}
function dailySnaps() {
  // one point per date: prefer manual snapshot recorded last that day
  const by = new Map();
  for (const s of state.snapshots) by.set(s.date, s);
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
function exposureBar(ex) {
  const pct = Math.max(0, Math.min(100, ex.pctHedged));
  return `<div class="expo"><div class="bar"><i style="width:${pct}%"></i></div>
    <div class="expo-grid">
      <div><span>Cattle to market</span><b>${n0(ex.cattleCwt)} cwt</b></div>
      <div><span>Protected</span><b>${n0(ex.hedgedCwt)} cwt</b></div>
      <div><span>Unprotected</span><b class="${ex.unhedged > 0 ? "neg" : ""}">${n0(ex.unhedged)} cwt</b></div>
      <div><span>Hedged</span><b>${n1(ex.pctHedged)}%</b></div>
    </div><p class="muted tiny">Counts short LE/GF futures, long puts, and active LRP against open head × target (or projected) weight.</p></div>`;
}
function quotesStrip() {
  if (!quotes) return `<section class="card"><h3>Markets</h3><p class="muted">Quotes file not available yet.</p></section>`;
  return `<section class="card"><div class="card-h"><h3>Markets <span class="tag">End-of-day</span></h3><a href="#/markets" class="link">More →</a></div>
    <div class="qstrip">${["LE", "GF", "ZC"].map((r) => {
      const c = quotes.roots?.[r]?.contracts?.[0];
      if (!c) return "";
      return `<div class="q"><span>${r} ${esc(c.label)}</span><b>${px(r, c.close)}</b><small class="${cls(c.change)}">${c.change == null ? "" : signed(c.change, n2)}</small></div>`;
    }).join("")}</div><p class="muted tiny">${quoteAsOf()}.</p></section>`;
}

// ---------- Lots ----------
let lotFilter = "open";
function viewLots() {
  if (!state.lots.length) return emptyOps();
  const ms = state.lots.map((l) => lotMetrics(l, state.expenses, quotes, T()));
  const shown = ms.filter((m) => lotFilter === "all" || m.status === lotFilter);
  return `<div class="page-h"><h2>Inventory</h2><button class="btn primary" data-act="add-lot">+ Lot</button></div>
  <div class="seg">${["open", "sold", "all"].map((f) => `<button data-filter="${f}" class="${lotFilter === f ? "on" : ""}">${f[0].toUpperCase() + f.slice(1)} (${f === "all" ? ms.length : ms.filter((m) => m.status === f).length})</button>`).join("")}</div>
  <div class="lot-list">${shown.map(lotRow).join("") || `<p class="muted card">Nothing here yet.</p>`}</div>`;
}

function lotFields(l = {}) {
  const contracts = (root) => [["", "Front month"], ...((quotes?.roots?.[root]?.contracts) || []).map((c) => [c.code, `${c.code} · ${c.label}`])];
  return [
    { k: "name", label: "Lot name", required: true, full: true, placeholder: "e.g. East pen steers" },
    { k: "class", label: "Class", type: "select", options: CLASSES, default: "steers" },
    { k: "head", label: "Head in", type: "number", required: true, step: 1 },
    { k: "inDate", label: "In date", type: "date", required: true, default: T() },
    { k: "inWeight", label: "In weight (lb/hd)", type: "number", required: true },
    { k: "priceBasis", label: "Priced by", type: "select", options: [["cwt", "$ per cwt"], ["head", "$ per head"]], default: "cwt" },
    { k: "purchasePrice", label: "Purchase price", type: "number", required: true, help: "$/cwt or $/head, per the field above" },
    { k: "adg", label: "Avg. daily gain (lb)", type: "number", default: 2.5 },
    { k: "deaths", label: "Death loss (head)", type: "number", step: 1, default: 0 },
    { k: "marketRef", label: "Value against", type: "select", options: [["GF", "Feeder cattle (GF)"], ["LE", "Live cattle (LE)"]], default: "GF" },
    { k: "marketContract", label: "Contract", type: "select", options: contracts(l.marketRef || "GF"), help: "Save & reopen after changing the market to see its months" },
    { k: "basis", label: "Basis ($/cwt)", type: "number", default: 0, help: "Your local cash minus futures; negative = under" },
    { k: "cashPrice", label: "Cash price override ($/cwt)", type: "number", help: "Optional. Used instead of futures + basis" },
    { k: "targetWeight", label: "Target sale weight (lb)", type: "number" },
    { k: "targetDate", label: "Target sale date", type: "date", help: "If set, projections use this date" },
    { k: "dailyCost", label: "Projected cost ($/hd/day)", type: "number", help: "Feed + yardage etc. for projections" },
    { k: "notes", label: "Notes", type: "textarea", full: true },
  ];
}
async function editLot(id) {
  const lot = state.lots.find((l) => l.id === id);
  const v = await formModal({ title: lot ? "Edit lot" : "New lot", fields: lotFields(lot || {}), values: lot || {},
    onDelete: lot ? () => deleteLot(id) : null });
  if (!v) return;
  if (lot) Object.assign(lot, v);
  else { const nl = { id: uid(), status: "open", ...v }; state.lots.push(nl); location.hash = "#/lot/" + nl.id; }
  await save(lot ? "Lot updated" : "Lot added");
}
async function deleteLot(id) {
  state.lots = state.lots.filter((l) => l.id !== id);
  state.expenses = state.expenses.filter((e) => e.lotId !== id);
  state.positions.forEach((p) => { if (p.lotId === id) p.lotId = ""; });
  location.hash = "#/lots";
  await save("Lot deleted");
}

function viewLot(id) {
  const lot = state.lots.find((l) => l.id === id);
  if (!lot) return `<p class="card">Lot not found. <a href="#/lots">Back to lots</a></p>`;
  const m = lotMetrics(lot, state.expenses, quotes, T());
  const exps = state.expenses.filter((e) => e.lotId === id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const cats = Object.entries(m.byCategory).sort((a, b) => b[1] - a[1]);
  const p = m.projection;
  const sold = m.status === "sold";
  const cwtDen = m.liveCwt || 1;
  const linked = state.positions.filter((x) => x.lotId === id);
  return `<div class="page-h"><a href="#/lots" class="link">← Lots</a><div class="row"><button class="btn" data-act="print-lot" data-id="${id}">Report</button><button class="btn" data-act="edit-lot" data-id="${id}">Edit</button></div></div>
  <section class="card lot-head">
    <h2>${esc(lot.name)} <span class="pill ${m.status}">${sold ? "Sold " + fmtDate(lot.sale.date) : "Open"}</span></h2>
    <p class="muted">${esc(CLASSES.find((c) => c[0] === lot.class)?.[1] || lot.class)} · in ${fmtDate(lot.inDate)} at ${n0(lot.inWeight)} lb · ${lot.priceBasis === "head" ? usd2(lot.purchasePrice) + "/hd" : "$" + n2(lot.purchasePrice) + "/cwt"} · ${m.dof} days on feed</p>
    ${lot.notes ? `<p class="note">${esc(lot.notes)}</p>` : ""}
  </section>
  <section class="kpis">
    ${kpi(sold ? "Head sold" : "Head on hand", n0(sold ? m.saleHead : m.headOnHand), `${n0(m.head)} in · ${n0(m.deaths)} dead (${n1(m.deathLossPct)}%)`)}
    ${kpi(sold ? "Sale weight" : "Est. weight", n0(m.estWeight) + " lb", sold ? "" : `${n2(lot.adg)} lb ADG`)}
    ${kpi("Cost basis", usd(m.costBasis), usd2(m.costPerHead) + "/hd")}
    ${kpi("Breakeven", "$" + n2(m.breakevenCwt) + "/cwt", sold ? "at sale weight" : "at current est. weight")}
    ${kpi(sold ? "Sale price" : "Market", "$" + n2(m.marketCwt) + "/cwt", sold ? "" : m.marketSource === "manual" ? "cash override" : m.marketSource === "futures+basis" ? `${lot.marketRef} ${n2(m.futures)} ${m.basis >= 0 ? "+" : "−"} ${n2(Math.abs(m.basis))} basis` : "no price")}
    ${kpi(sold ? "Realized P/L" : "P/L vs. market", signed(m.pl), signed(m.plPerHead, usd2) + "/hd", cls(m.pl) + " big")}
  </section>
  ${sold ? "" : `<section class="card"><div class="card-h"><h3>Projection to sale</h3></div>
    ${p ? `<div class="proj">
      <div><span>Target</span><b>${fmtDate(p.date)}</b><small>${p.days} days out</small></div>
      <div><span>Projected weight</span><b>${n0(p.weight)} lb</b></div>
      <div><span>Added cost</span><b>${usd(p.addlCost)}</b><small>${usd2(lot.dailyCost || 0)}/hd/day</small></div>
      <div><span>Projected cost</span><b>${usd(p.projCost)}</b><small>${usd2(p.projCostPerHead)}/hd</small></div>
      <div><span>Projected breakeven</span><b>$${n2(p.projBreakeven)}/cwt</b></div>
      <div><span>P/L at today's price</span><b class="${cls(p.projPL)}">${signed(p.projPL)}</b></div>
    </div>` : `<p class="muted">Set a target sale weight or date (and a projected daily cost) on this lot to see projected breakevens.</p>`}</section>`}
  <section class="card"><div class="card-h"><h3>Costs</h3><button class="btn sm primary" data-act="add-exp" data-id="${id}">+ Expense</button></div>
    <table class="tbl"><thead><tr><th>Item</th><th class="r">Total</th><th class="r">Per head</th><th class="r">Per cwt</th></tr></thead><tbody>
      <tr><td>Purchase</td><td class="r">${usd(m.purchaseCost)}</td><td class="r">${usd2(m.purchaseCost / (m.headOnHand || 1))}</td><td class="r">${usd2(m.purchaseCost / cwtDen)}</td></tr>
      ${cats.map(([c, v]) => `<tr><td>${esc(c)}</td><td class="r">${usd(v)}</td><td class="r">${usd2(v / (m.headOnHand || 1))}</td><td class="r">${usd2(v / cwtDen)}</td></tr>`).join("")}
      <tr class="tot"><td>Total</td><td class="r">${usd(m.costBasis)}</td><td class="r">${usd2(m.costPerHead)}</td><td class="r">${usd2(m.breakevenCwt)}</td></tr>
    </tbody></table>
    <p class="muted tiny">Per head uses ${n0(m.headOnHand)} live head (death loss is carried by the survivors). Per cwt uses ${n0(m.liveCwt)} cwt ${sold ? "sold" : "on hand"}. Cost of gain: ${m.costOfGainCwt ? usd2(m.costOfGainCwt) + "/cwt" : "—"}.</p>
    <details><summary>${exps.length} expense entr${exps.length === 1 ? "y" : "ies"}</summary>
      <ul class="exp-list">${exps.map((e) => `<li data-exp="${e.id}"><div><b>${esc(e.category)}</b><small>${fmtDate(e.date)}${e.note ? " · " + esc(e.note) : ""}</small></div><span>${usd2(e.amount)}</span></li>`).join("") || "<li class='muted'>None yet</li>"}</ul>
    </details>
  </section>
  ${linked.length ? `<section class="card"><h3>Linked hedges</h3>${positionList(linked)}</section>` : ""}
  <section class="row wrap actions">
    ${sold ? `<button class="btn" data-act="reopen" data-id="${id}">Reopen lot</button>` : `<button class="btn" data-act="death" data-id="${id}">Record death</button><button class="btn primary" data-act="sell" data-id="${id}">Sell / close lot</button>`}
  </section>`;
}
async function editExpense(lotId, expId) {
  const e = state.expenses.find((x) => x.id === expId);
  const v = await formModal({ title: e ? "Edit expense" : "Add expense", values: e || {}, onDelete: e ? () => { state.expenses = state.expenses.filter((x) => x.id !== expId); save("Expense deleted"); } : null,
    fields: [
      { k: "category", label: "Category", type: "select", options: EXP_CATS, default: "Feed" },
      { k: "date", label: "Date", type: "date", default: T(), required: true },
      { k: "amount", label: "Amount ($, whole lot)", type: "number", required: true },
      { k: "note", label: "Note", full: true },
    ] });
  if (!v) return;
  if (e) Object.assign(e, v); else state.expenses.push({ id: uid(), lotId, ...v });
  await save(e ? "Expense updated" : "Expense added");
}
async function sellLot(id) {
  const lot = state.lots.find((l) => l.id === id);
  const m = lotMetrics(lot, state.expenses, quotes, T());
  const v = await formModal({ title: "Sell / close lot", submitLabel: "Close lot", values: { date: T(), head: m.headOnHand, avgWeight: Math.round(m.estWeight), priceCwt: Math.round(m.marketCwt * 100) / 100 },
    fields: [
      { k: "date", label: "Sale date", type: "date", required: true },
      { k: "head", label: "Head sold", type: "number", step: 1, required: true },
      { k: "avgWeight", label: "Avg. sale weight (lb)", type: "number", required: true },
      { k: "priceCwt", label: "Sale price ($/cwt)", type: "number", required: true },
    ] });
  if (!v) return;
  lot.status = "sold"; lot.sale = v;
  await save("Lot closed");
}
async function recordDeath(id) {
  const lot = state.lots.find((l) => l.id === id);
  const v = await formModal({ title: "Record death loss", values: { n: 1 }, fields: [{ k: "n", label: "Head lost", type: "number", step: 1, required: true }] });
  if (!v || !v.n) return;
  lot.deaths = (+lot.deaths || 0) + v.n;
  await save(`${v.n} head recorded as death loss`);
}

// ---------- Risk ----------
function positionList(list) {
  return `<ul class="pos-list">${list.map((p) => {
    const m = positionMetrics(p, quotes);
    const lot = state.lots.find((l) => l.id === p.lotId);
    let title, sub;
    if (p.type === "futures") {
      title = `${p.side === "short" ? "Short" : "Long"} ${p.contracts} ${p.symbol} ${p.contract || "front"} futures`;
      sub = `Entry ${px(p.symbol, p.entryPrice)} · last ${px(p.symbol, m.last)}`;
    } else if (p.type === "option") {
      title = `${p.side === "short" ? "Short" : "Long"} ${p.contracts} ${p.symbol} ${p.contract || "front"} ${p.strike} ${p.optType}${p.contracts == 1 ? "" : "s"}`;
      sub = `Paid ${px(p.symbol, p.premium)} · ${m.valueEst === "entered" ? "now" : "intrinsic"} ${px(p.symbol, m.current)} · fut ${px(p.symbol, m.last)}`;
    } else {
      title = `LRP ${p.commodity === "fed" ? "fed cattle" : "feeder cattle"} · ${n0(p.head)} hd × ${n0(p.targetWeight)} lb`;
      sub = `Coverage $${n2(p.coveragePrice)} · premium $${n2(p.premium)}/cwt (${usd(m.premiumTotal)}) · ends ${fmtDate(p.endDate)}${m.expired ? " (ended)" : ""} · est. indemnity ${usd(m.indemnity)}`;
    }
    return `<li data-pos="${p.id}"><div><b>${esc(title)}</b><small>${sub}${lot ? ` · ${esc(lot.name)}` : ""}</small></div><span class="${cls(m.mtm)}">${signed(m.mtm)}</span></li>`;
  }).join("")}</ul>`;
}
function viewRisk() {
  const s = summary();
  const groups = [["futures", "Futures"], ["option", "Options"], ["lrp", "LRP endorsements"]];
  const tot = (t) => s.posM.filter((x) => x.p.type === t).reduce((a, x) => a + x.m.mtm, 0);
  return `<div class="page-h"><h2>Risk management</h2><button class="btn primary" data-act="add-pos">+ Position</button></div>
  <section class="kpis">
    ${kpi("Futures MTM", signed(tot("futures")), "", cls(tot("futures")))}
    ${kpi("Options MTM", signed(tot("option")), "vs. premium paid", cls(tot("option")))}
    ${kpi("LRP net", signed(tot("lrp")), "est. indemnity − premium", cls(tot("lrp")))}
    ${kpi("Total hedge P/L", signed(s.hedgeValue), "", cls(s.hedgeValue) + " big")}
  </section>
  <section class="card"><h3>Hedged vs. unhedged</h3>${exposureBar(s.exposure)}</section>
  ${groups.map(([t, label]) => {
    const list = state.positions.filter((p) => p.type === t);
    return `<section class="card"><div class="card-h"><h3>${label}</h3><button class="btn sm" data-act="add-pos" data-type="${t}">+ Add</button></div>
      ${list.length ? positionList(list) : `<p class="muted">None.</p>`}</section>`;
  }).join("")}
  <p class="muted tiny pad">Mark-to-market uses the latest end-of-day settlement (${quoteAsOf()}). Options without an entered current premium are valued at intrinsic value only, which understates time value. LRP indemnity is estimated with the matching futures price as a stand-in for the CME index. Contract sizes: LE 40,000 lb, GF 50,000 lb, ZC 5,000 bu.</p>`;
}
function posFields(type) {
  const lotOpts = [["", "— none —"], ...state.lots.filter((l) => l.status !== "sold").map((l) => [l.id, l.name])];
  const contractOpts = [["", "Front month"], ...Object.entries(quotes?.contracts || {}).map(([code, c]) => [code, `${code} · ${c.label}`])];
  if (type === "lrp") return [
    { k: "commodity", label: "Type", type: "select", options: [["feeder", "Feeder cattle"], ["fed", "Fed cattle"]] },
    { k: "head", label: "Head insured", type: "number", step: 1, required: true },
    { k: "targetWeight", label: "Target weight (lb/hd)", type: "number", required: true },
    { k: "coveragePrice", label: "Coverage price ($/cwt)", type: "number", required: true },
    { k: "premium", label: "Producer premium ($/cwt)", type: "number", required: true },
    { k: "endDate", label: "Endorsement end date", type: "date", required: true },
    { k: "contract", label: "Value against contract", type: "select", options: contractOpts, help: "Futures month nearest the end date (stand-in for the CME index)" },
    { k: "date", label: "Purchase date", type: "date", default: T() },
    { k: "lotId", label: "Covers lot", type: "select", options: lotOpts },
    { k: "note", label: "Note", full: true },
  ];
  const base = [
    { k: "symbol", label: "Market", type: "select", options: [["LE", "Live cattle (LE)"], ["GF", "Feeder cattle (GF)"], ["ZC", "Corn (ZC)"]] },
    { k: "contract", label: "Contract month", type: "select", options: contractOpts },
    { k: "side", label: "Side", type: "select", options: [["short", "Short (sold)"], ["long", "Long (bought)"]] },
    { k: "contracts", label: "Contracts", type: "number", step: 1, default: 1, required: true },
  ];
  const tail = [
    { k: "date", label: "Trade date", type: "date", default: T() },
    { k: "lotId", label: "Hedges lot", type: "select", options: lotOpts },
    { k: "note", label: "Note", full: true },
  ];
  if (type === "option") return [...base,
    { k: "optType", label: "Put / call", type: "select", options: [["put", "Put"], ["call", "Call"]] },
    { k: "strike", label: "Strike", type: "number", required: true, help: "$/cwt for cattle, ¢/bu for corn" },
    { k: "premium", label: "Premium paid / received", type: "number", required: true },
    { k: "currentPremium", label: "Current premium (optional)", type: "number", help: "Leave blank to value at intrinsic" },
    ...tail];
  return [...base, { k: "entryPrice", label: "Entry price", type: "number", required: true, help: "$/cwt for cattle, ¢/bu for corn" }, ...tail];
}
async function editPos(id, type) {
  const p = state.positions.find((x) => x.id === id);
  if (!p && !type) {
    const pick = await formModal({ title: "New position", submitLabel: "Next", fields: [{ k: "type", label: "What are you adding?", type: "select", options: [["futures", "Futures"], ["option", "Option (put / call)"], ["lrp", "LRP endorsement"]], full: true }] });
    if (!pick) return; type = pick.type;
  }
  type = p ? p.type : type;
  const v = await formModal({ title: (p ? "Edit " : "New ") + (type === "lrp" ? "LRP endorsement" : type === "option" ? "option" : "futures position"), fields: posFields(type), values: p || {},
    onDelete: p ? () => { state.positions = state.positions.filter((x) => x.id !== id); save("Position deleted"); } : null });
  if (!v) return;
  if (v.contract && quotes?.contracts?.[v.contract] && v.symbol && quotes.contracts[v.contract].root !== v.symbol) {
    toast("Contract month didn't match the market; using front month"); v.contract = "";
  }
  if (p) Object.assign(p, v); else state.positions.push({ id: uid(), type, ...v });
  await save(p ? "Position updated" : "Position added");
}

// ---------- Markets ----------
function viewMarkets() {
  if (!quotes) return `<section class="card"><h2>Markets</h2><p>Price file not available. Lots can still be valued with a manual cash price.</p></section>`;
  return `<div class="page-h"><h2>Markets</h2><span class="tag big">End-of-day · delayed</span></div>
  <p class="muted tiny pad">Settlement-style closing prices from ${esc(quotes.source)}, refreshed once each weekday evening. Last update ${new Date(quotes.generated).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. These are <b>not real-time</b> prices.</p>
  ${["LE", "GF", "ZC"].map((r) => {
    const R = quotes.roots[r];
    if (!R) return "";
    return `<section class="card"><div class="card-h"><h3>${esc(R.name)} <small class="muted">${r} · ${esc(R.unit)}</small></h3></div>
      <table class="tbl"><thead><tr><th>Contract</th><th class="r">Close</th><th class="r">Chg</th><th class="r hide-sm">60-day</th></tr></thead><tbody>
      ${R.contracts.map((c) => `<tr><td><b>${esc(c.label)}</b><small class="block muted">${c.code} · ${fmtDate(c.date)}</small></td><td class="r">${px(r, c.close)}</td><td class="r ${cls(c.change)}">${c.change == null ? "—" : signed(c.change, n2)}</td><td class="r hide-sm">${sparkline((c.history || []).slice(-60).map((h) => h[1]))}</td></tr>`).join("")}
      </tbody></table></section>`;
  }).join("")}`;
}

// ---------- Equity history ----------
function viewEquity() {
  const snaps = [...state.snapshots].sort((a, b) => (a.date < b.date ? 1 : -1));
  return `<div class="page-h"><a href="#/dash" class="link">← Dashboard</a><button class="btn primary" data-act="snap">Record snapshot</button></div>
  <section class="card"><h3>Equity history</h3>${lineChart(dailySnaps().map((x) => ({ x: x.date, y: x.equity })))}
  <p class="muted tiny">A snapshot is saved automatically each day you open ${BRAND.name}. Record one manually any time, e.g. at month end for your lender.</p></section>
  <section class="card"><table class="tbl"><thead><tr><th>Date</th><th class="r">Head</th><th class="r hide-sm">Cost</th><th class="r hide-sm">Market</th><th class="r">Equity</th><th></th></tr></thead><tbody>
  ${snaps.map((s, i) => `<tr><td>${fmtDate(s.date)}${s.manual ? ` <span class="tag">manual</span>` : ""}${s.note ? `<small class="block muted">${esc(s.note)}</small>` : ""}</td><td class="r">${n0(s.head)}</td><td class="r hide-sm">${usd(s.costBasis)}</td><td class="r hide-sm">${usd(s.marketValue)}</td><td class="r ${cls(s.equity)}">${signed(s.equity)}</td><td class="r"><button class="icon-btn" data-delsnap="${state.snapshots.indexOf(s)}" aria-label="Delete">✕</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">No snapshots yet.</td></tr>`}
  </tbody></table></section>`;
}

// ---------- Reports ----------
let reportLot = "";
function viewReports() {
  if (!state.lots.length) return emptyOps();
  const s = summary();
  const lots = reportLot ? s.lotsM.filter((m) => m.id === reportLot) : s.lotsM;
  return `<div class="page-h no-print"><h2>Reports</h2><button class="btn primary" data-act="print">Print / PDF</button></div>
  <section class="card no-print"><div class="row wrap">
    <label class="field inline"><span>Report</span><select id="replot"><option value="">Whole operation</option>${state.lots.map((l) => `<option value="${l.id}" ${reportLot === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>
  </div><div class="row wrap"><button class="btn sm" data-csv="lots">Lots CSV</button><button class="btn sm" data-csv="expenses">Expenses CSV</button><button class="btn sm" data-csv="positions">Positions CSV</button><button class="btn sm" data-csv="snapshots">Equity CSV</button></div></section>
  <article class="report">
    <header><img src="img/logo.svg" width="36" height="36" alt=""><div><h2>${esc(state.operation.name)}</h2><p>${reportLot ? "Lot report" : "Operation summary"} · ${fmtDate(T())}</p></div></header>
    ${reportLot ? "" : `<table class="tbl"><tbody>
      <tr><td>Head on hand</td><td class="r">${n0(s.totalHead)}</td></tr>
      <tr><td>Cost basis (open lots)</td><td class="r">${usd(s.costBasis)}</td></tr>
      <tr><td>Market value (open lots)</td><td class="r">${usd(s.marketValue)}</td></tr>
      <tr><td>Unrealized cattle P/L</td><td class="r">${signed(s.cattlePL)}</td></tr>
      <tr><td>Hedge mark-to-market</td><td class="r">${signed(s.hedgeValue)}</td></tr>
      <tr class="tot"><td>Equity</td><td class="r">${signed(s.equity)}</td></tr>
      <tr><td>Realized P/L (sold lots)</td><td class="r">${signed(s.realizedPL)}</td></tr>
      <tr><td>Hedged share of cattle</td><td class="r">${n1(s.exposure.pctHedged)}%</td></tr></tbody></table>`}
    <h3>Lots</h3>
    <div class="tbl-wrap"><table class="tbl rep"><thead><tr><th>Lot</th><th class="r">Head</th><th class="r">Wt</th><th class="r">DOF</th><th class="r">Cost/hd</th><th class="r">B/E $/cwt</th><th class="r">Mkt $/cwt</th><th class="r">P/L</th></tr></thead><tbody>
    ${lots.map((m) => `<tr><td>${esc(m.name)}${m.status === "sold" ? " (sold)" : ""}</td><td class="r">${n0(m.status === "sold" ? m.saleHead : m.headOnHand)}</td><td class="r">${n0(m.estWeight)}</td><td class="r">${m.dof}</td><td class="r">${usd2(m.costPerHead)}</td><td class="r">${n2(m.breakevenCwt)}</td><td class="r">${n2(m.marketCwt)}</td><td class="r">${signed(m.pl)}</td></tr>`).join("")}
    </tbody></table></div>
    ${reportLot ? lots.map((m) => `<h3>Cost detail</h3><table class="tbl"><thead><tr><th>Item</th><th class="r">Total</th><th class="r">Per head</th><th class="r">Per cwt</th></tr></thead><tbody>
      <tr><td>Purchase</td><td class="r">${usd(m.purchaseCost)}</td><td class="r">${usd2(m.purchaseCost / (m.headOnHand || 1))}</td><td class="r">${usd2(m.purchaseCost / (m.liveCwt || 1))}</td></tr>
      ${Object.entries(m.byCategory).map(([c, v]) => `<tr><td>${esc(c)}</td><td class="r">${usd(v)}</td><td class="r">${usd2(v / (m.headOnHand || 1))}</td><td class="r">${usd2(v / (m.liveCwt || 1))}</td></tr>`).join("")}
      <tr class="tot"><td>Total</td><td class="r">${usd(m.costBasis)}</td><td class="r">${usd2(m.costPerHead)}</td><td class="r">${usd2(m.breakevenCwt)}</td></tr></tbody></table>
      ${m.projection ? `<p>Projected to ${fmtDate(m.projection.date)} at ${n0(m.projection.weight)} lb: cost ${usd(m.projection.projCost)}, breakeven $${n2(m.projection.projBreakeven)}/cwt, P/L at today's price ${signed(m.projection.projPL)}.</p>` : ""}`).join("") : ""}
    <p class="muted tiny">Market values use end-of-day futures plus each lot's basis, or a manual cash price. Prices are delayed and for planning only.</p>
  </article>`;
}
function csv(kind) {
  let rows = [];
  const lotName = (id) => state.lots.find((l) => l.id === id)?.name || "";
  if (kind === "lots") rows = summary().lotsM.map((m) => ({ lot: m.name, status: m.status, head_in: m.head, deaths: m.deaths, head_on_hand: m.headOnHand, days_on_feed: m.dof, est_weight_lb: Math.round(m.estWeight), purchase_cost: m.purchaseCost.toFixed(2), expenses: m.expenseTotal.toFixed(2), cost_basis: m.costBasis.toFixed(2), cost_per_head: m.costPerHead.toFixed(2), breakeven_cwt: m.breakevenCwt.toFixed(2), market_cwt: m.marketCwt.toFixed(2), market_value: m.marketValue.toFixed(2), pl: m.pl.toFixed(2) }));
  if (kind === "expenses") rows = state.expenses.map((e) => ({ date: e.date, lot: lotName(e.lotId), category: e.category, amount: e.amount, note: e.note || "" }));
  if (kind === "positions") rows = state.positions.map((p) => { const m = positionMetrics(p, quotes); return { type: p.type, market: p.symbol || p.commodity, contract: p.contract || "", side: p.side || "", contracts: p.contracts || "", option: p.optType || "", strike: p.strike || "", entry_or_premium: p.entryPrice ?? p.premium ?? "", coverage: p.coveragePrice || "", head: p.head || "", target_wt: p.targetWeight || "", end_date: p.endDate || "", last_price: m.last ?? "", mtm: m.mtm.toFixed(2), lot: lotName(p.lotId) }; });
  if (kind === "snapshots") rows = state.snapshots.map((s) => ({ date: s.date, manual: s.manual, head: s.head, cost_basis: s.costBasis, market_value: s.marketValue, hedge_value: s.hedgeValue, equity: s.equity, note: s.note || "" }));
  if (!rows.length) return toast("Nothing to export");
  download(`herdledger-${kind}-${T()}.csv`, toCSV(rows), "text/csv");
}

// ---------- Settings ----------
function viewSettings() {
  return `<div class="page-h"><h2>Settings</h2></div>
  <section class="card"><h3>Operation</h3><div class="row wrap"><label class="field inline grow"><span>Name</span><input id="opn" value="${esc(state.operation.name)}"></label><button class="btn" data-act="save-op">Save</button></div></section>
  <section class="card"><h3>Your data</h3>
    <p class="muted">During the preview everything is stored only in this browser on this device. Download a backup regularly, and restore it on another device.</p>
    <div class="row wrap"><button class="btn primary" data-act="backup">Download backup (.json)</button><label class="btn">Restore backup<input type="file" id="restore" accept="application/json,.json" hidden></label></div>
    <div class="row wrap"><button class="btn" data-act="sample">Load sample operation</button><button class="btn danger" data-act="clear">Erase all data</button></div>
  </section>
  <section class="card"><h3>Plan</h3><p class="muted">Preview mode: every feature is unlocked. Paid plans start after the ${TRIAL_DAYS}-day free trial once accounts launch.</p>
    <div class="mini-plans">${PLANS.map((p) => `<div><b>${esc(p.name)}</b><span>$${p.price.toFixed(2)}/mo</span></div>`).join("")}</div>
    <a class="link" href="index.html#pricing">Compare plans →</a></section>
  <section class="card"><h3>About</h3><p class="muted tiny">${BRAND.name} v1 preview. Market prices are end-of-day / delayed from a public source and may be missing or wrong; verify with your broker before trading. Not financial advice.</p></section>`;
}

// ---------- events ----------
function bind(name) {
  const v = $("#view");
  v.onclick = async (e) => {
    const t = e.target.closest("[data-act],[data-filter],[data-exp],[data-pos],[data-delsnap],[data-csv]");
    if (!t) return;
    const id = t.dataset.id;
    if (t.dataset.filter) { lotFilter = t.dataset.filter; return render(); }
    if (t.dataset.exp) return editExpense(null, t.dataset.exp);
    if (t.dataset.pos) return editPos(t.dataset.pos);
    if (t.dataset.csv) return csv(t.dataset.csv);
    if (t.dataset.delsnap) { if (confirm("Delete this snapshot?")) { state.snapshots.splice(+t.dataset.delsnap, 1); await store.save(state); render(); } return; }
    switch (t.dataset.act) {
      case "sample":
        if (state.lots.length && !confirm("Replace your current data with the sample operation?")) return;
        state = buildSample(quotes); location.hash = "#/dash"; return save("Sample operation loaded");
      case "add-lot": return editLot();
      case "edit-lot": return editLot(id);
      case "add-exp": return editExpense(id);
      case "sell": return sellLot(id);
      case "death": return recordDeath(id);
      case "reopen": { const l = state.lots.find((x) => x.id === id); l.status = "open"; delete l.sale; return save("Lot reopened"); }
      case "add-pos": return editPos(null, t.dataset.type);
      case "snap": {
        const r = await formModal({ title: "Record equity snapshot", fields: [{ k: "note", label: "Note (optional)", full: true, placeholder: "e.g. Month-end for the bank" }], submitLabel: "Record" });
        if (!r) return; state.snapshots.push(snapshotFrom(summary(), T(), true, r.note)); await store.save(state); toast("Snapshot recorded"); return render();
      }
      case "print": return window.print();
      case "print-lot": reportLot = id; location.hash = "#/reports"; return;
      case "save-op": state.operation.name = $("#opn").value.trim() || "My Operation"; return save("Saved");
      case "backup": return download(`herdledger-backup-${T()}.json`, JSON.stringify(state, null, 1), "application/json");
      case "clear": if (confirm("Erase every lot, expense, position and snapshot in this browser? Download a backup first if unsure.")) { state = emptyState(); await store.clear(); toast("All data erased"); render(); } return;
    }
  };
  const rl = $("#replot");
  if (rl) rl.onchange = () => { reportLot = rl.value; render(); };
  const rs = $("#restore");
  if (rs) rs.onchange = async () => {
    try {
      const obj = validateBackup(JSON.parse(await rs.files[0].text()));
      if (!confirm(`Restore ${obj.lots.length} lots from this backup? Current data will be replaced.`)) return;
      state = obj; await save("Backup restored");
    } catch (err) { alert("Could not restore: " + err.message); }
  };
}

// ---------- boot ----------
async function boot() {
  [state] = await Promise.all([store.load(), loadQuotes()]);
  autoSnapshot();
  await store.save(state);
  render();
  $("#gear").onclick = () => (location.hash = "#/settings");
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
window.__hl = { get state() { return state; }, get quotes() { return quotes; }, summary };
