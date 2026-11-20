// Pure calculation functions. No DOM access, so they run in Node tests too.

export const CONTRACT = {
  LE: { name: "Live Cattle", mult: 400, cwt: 400, unit: "$/cwt" },  // 40,000 lb; $400 per $1/cwt
  GF: { name: "Feeder Cattle", mult: 500, cwt: 500, unit: "$/cwt" }, // 50,000 lb; $500 per $1/cwt
  ZC: { name: "Corn", mult: 50, bu: 5000, unit: "¢/bu" },            // 5,000 bu; $50 per 1¢
};

const DAY = 86400000;
export const toDate = (s) => new Date(s + "T00:00:00Z");
export const todayISO = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
export const addDays = (s, n) => new Date(toDate(s).getTime() + n * DAY).toISOString().slice(0, 10);
const num = (v) => (v === "" || v == null || isNaN(+v) ? 0 : +v);

// ---------- quotes ----------
export function quotePrice(quotes, root, code) {
  if (!quotes || !quotes.roots || !quotes.roots[root]) return null;
  if (code && quotes.contracts && quotes.contracts[code]) return quotes.contracts[code].close;
  const r = quotes.roots[root];
  const front = r.contracts && r.contracts[0];
  return front ? front.close : null;
}

// ---------- lots ----------
export function lotMetrics(lot, expenses, quotes, asOf) {
  const exp = expenses.filter((e) => e.lotId === lot.id);
  const sold = lot.status === "sold" && lot.sale;
  const endDate = sold ? lot.sale.date : asOf;
  const head = num(lot.head);
  const deaths = num(lot.deaths);
  const headOnHand = Math.max(0, head - deaths);
  const dof = Math.max(0, daysBetween(lot.inDate, endDate));
  const inWt = num(lot.inWeight);
  const adg = num(lot.adg);
  const estWeight = sold && num(lot.sale.avgWeight) ? num(lot.sale.avgWeight) : inWt + adg * dof;

  const purchaseCost = lot.priceBasis === "head"
    ? num(lot.purchasePrice) * head
    : num(lot.purchasePrice) * (inWt / 100) * head;
  const expenseTotal = exp.reduce((s, e) => s + num(e.amount), 0);
  const byCategory = {};
  for (const e of exp) byCategory[e.category] = (byCategory[e.category] || 0) + num(e.amount);
  const costBasis = purchaseCost + expenseTotal;

  const liveCwt = (headOnHand * estWeight) / 100;
  const costPerHead = headOnHand ? costBasis / headOnHand : 0;
  const breakevenCwt = liveCwt ? costBasis / liveCwt : 0;
  const expensePerHead = headOnHand ? expenseTotal / headOnHand : 0;
  const costOfGainCwt = headOnHand && estWeight > inWt
    ? expenseTotal / ((headOnHand * (estWeight - inWt)) / 100) : 0;

  // market
  const futures = quotePrice(quotes, lot.marketRef || "GF", lot.marketContract || null);
  const basis = num(lot.basis);
  const manual = num(lot.cashPrice);
  const marketCwt = sold ? num(lot.sale.priceCwt) : manual || (futures != null ? futures + basis : 0);
  const marketSource = sold ? "sale" : manual ? "manual" : futures != null ? "futures+basis" : "none";
  const saleHead = sold ? num(lot.sale.head) || headOnHand : headOnHand;
  const marketValue = sold ? (saleHead * estWeight / 100) * marketCwt : liveCwt * marketCwt;
  const pl = marketValue - costBasis;

  // projection to target
  let projection = null;
  if (!sold && (lot.targetDate || num(lot.targetWeight))) {
    let days;
    if (lot.targetDate) days = Math.max(0, daysBetween(asOf, lot.targetDate));
    else days = adg > 0 ? Math.max(0, Math.ceil((num(lot.targetWeight) - estWeight) / adg)) : 0;
    const date = lot.targetDate || addDays(asOf, days);
    const weight = lot.targetDate ? estWeight + adg * days : Math.max(estWeight, num(lot.targetWeight));
    const daily = num(lot.dailyCost); // $/head/day projected (feed + yardage etc.)
    const addlCost = daily * headOnHand * days;
    const projCost = costBasis + addlCost;
    const projCwt = (headOnHand * weight) / 100;
    const projBreakeven = projCwt ? projCost / projCwt : 0;
    const projValue = projCwt * marketCwt;
    projection = { days, date, weight, addlCost, projCost, projBreakeven, projValue, projPL: projValue - projCost,
      projCostPerHead: headOnHand ? projCost / headOnHand : 0 };
  }

  return {
    id: lot.id, name: lot.name, status: lot.status || "open", head, deaths, headOnHand, saleHead, dof, estWeight,
    purchaseCost, expenseTotal, byCategory, costBasis, costPerHead, breakevenCwt, expensePerHead,
    expensePerCwt: liveCwt ? expenseTotal / liveCwt : 0, costOfGainCwt, liveCwt,
    deathLossPct: head ? (deaths / head) * 100 : 0,
    futures, basis, marketCwt, marketSource, marketValue, pl,
    plPerHead: saleHead ? pl / saleHead : 0, projection,
  };
}

// ---------- risk ----------
export function positionMetrics(p, quotes) {
  const last = quotePrice(quotes, p.type === "lrp" ? (p.commodity === "fed" ? "LE" : "GF") : p.symbol, p.contract || null);
  const c = CONTRACT[p.symbol] || CONTRACT[p.commodity === "fed" ? "LE" : "GF"];
  const n = num(p.contracts);
  const sign = p.side === "short" ? -1 : 1;
  if (p.type === "futures") {
    const mtm = last == null ? 0 : (last - num(p.entryPrice)) * c.mult * n * sign;
    const hedgedCwt = p.symbol !== "ZC" ? -sign * n * c.cwt : 0; // short futures hedge cattle
    return { last, mtm, hedgedCwt, value: mtm };
  }
  if (p.type === "option") {
    const k = num(p.strike);
    const intrinsic = last == null ? 0 : p.optType === "put" ? Math.max(0, k - last) : Math.max(0, last - k);
    const current = p.currentPremium !== "" && p.currentPremium != null ? num(p.currentPremium) : intrinsic;
    const valueEst = p.currentPremium !== "" && p.currentPremium != null ? "entered" : "intrinsic";
    const mtm = (current - num(p.premium)) * c.mult * n * sign;
    const premiumTotal = num(p.premium) * c.mult * n;
    // Long puts / short calls protect against falling cattle prices; count long puts as hedged cwt.
    let hedgedCwt = 0;
    if (p.symbol !== "ZC" && p.optType === "put" && p.side !== "short") hedgedCwt = n * c.cwt;
    return { last, intrinsic, current, valueEst, mtm, premiumTotal, hedgedCwt, value: mtm };
  }
  if (p.type === "lrp") {
    const cwt = (num(p.head) * num(p.targetWeight)) / 100;
    const premiumTotal = num(p.premium) * cwt;
    const indemnity = last == null ? 0 : Math.max(0, num(p.coveragePrice) - last) * cwt;
    const expired = p.endDate && p.endDate < todayISO();
    return { last, cwt, premiumTotal, indemnity, mtm: indemnity - premiumTotal, hedgedCwt: expired ? 0 : cwt,
      value: indemnity - premiumTotal, expired };
  }
  return { last, mtm: 0, hedgedCwt: 0, value: 0 };
}

export function exposure(lotsM, positions, quotes, lots) {
  // Exposure = cwt we will sell: open head x (target weight, else current est. weight)
  let cattleCwt = 0;
  for (const m of lotsM) {
    if (m.status === "sold") continue;
    const lot = lots.find((l) => l.id === m.id);
    const w = num(lot && lot.targetWeight) || (m.projection ? m.projection.weight : m.estWeight);
    cattleCwt += (m.headOnHand * w) / 100;
  }
  let hedgedCwt = 0;
  for (const p of positions) hedgedCwt += positionMetrics(p, quotes).hedgedCwt;
  const unhedged = cattleCwt - hedgedCwt;
  return { cattleCwt, hedgedCwt, unhedged, pctHedged: cattleCwt ? (hedgedCwt / cattleCwt) * 100 : 0 };
}

// ---------- operation ----------
export function operationSummary(state, quotes, asOf) {
  const lotsM = state.lots.map((l) => lotMetrics(l, state.expenses, quotes, asOf));
  const open = lotsM.filter((m) => m.status !== "sold");
  const sold = lotsM.filter((m) => m.status === "sold");
  const sum = (arr, k) => arr.reduce((s, m) => s + m[k], 0);
  const posM = state.positions.map((p) => ({ p, m: positionMetrics(p, quotes) }));
  const hedgeValue = posM.reduce((s, x) => s + x.m.value, 0);
  const totalHead = sum(open, "headOnHand");
  const costBasis = sum(open, "costBasis");
  const marketValue = sum(open, "marketValue");
  const cattlePL = marketValue - costBasis;
  return {
    lotsM, open, sold, posM, totalHead, costBasis, marketValue, cattlePL, hedgeValue,
    equity: cattlePL + hedgeValue, // unrealized equity: cattle over cost + hedge account
    realizedPL: sum(sold, "pl"),
    exposure: exposure(lotsM, state.positions, quotes, state.lots),
  };
}

export function snapshotFrom(summary, date, manual = false, note = "") {
  return {
    date, manual, note,
    head: summary.totalHead,
    costBasis: round2(summary.costBasis),
    marketValue: round2(summary.marketValue),
    hedgeValue: round2(summary.hedgeValue),
    equity: round2(summary.equity),
  };
}
export const round2 = (x) => Math.round(x * 100) / 100;

// ---------- CSV ----------
export function toCSV(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
