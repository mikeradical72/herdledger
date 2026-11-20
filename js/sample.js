// "Load sample operation": a believable feedlot / backgrounding mix, dated
// relative to today so it always looks current. Equity history is rebuilt
// from the real end-of-day futures history in data/quotes.json.
import { addDays, todayISO, operationSummary, snapshotFrom } from "./calc.js";
import { uid, emptyState } from "./store.js";

export function buildSample(quotes) {
  const T = todayISO();
  const d = (n) => addDays(T, n);
  const front = (root, i = 0) => quotes?.roots?.[root]?.contracts?.[i]?.code || "";

  const lots = [
    { id: uid(), name: "North Pen – Fall Steers", class: "steers", head: 120, deaths: 1, inDate: d(-66), inWeight: 575,
      priceBasis: "cwt", purchasePrice: 372, adg: 3.0, marketRef: "GF", marketContract: front("GF", 0), basis: 6,
      targetWeight: 900, targetDate: "", dailyCost: 2.85, status: "open", notes: "Sale barn, weaned 45 days" },
    { id: uid(), name: "Heifer Lot 7", class: "heifers", head: 85, deaths: 0, inDate: d(-58), inWeight: 520,
      priceBasis: "cwt", purchasePrice: 356, adg: 2.6, marketRef: "GF", marketContract: front("GF", 1), basis: -14,
      targetWeight: 850, targetDate: "", dailyCost: 2.6, status: "open", notes: "Covered by LRP" },
    { id: uid(), name: "Finishers – Pen 3", class: "steers", head: 64, deaths: 1, inDate: d(-150), inWeight: 860,
      priceBasis: "head", purchasePrice: 2650, adg: 3.6, marketRef: "LE", marketContract: front("LE", 0), basis: 1.5,
      targetWeight: 0, targetDate: d(40), dailyCost: 3.4, status: "open", notes: "Hedged with Feb LE" },
    { id: uid(), name: "Cull Cows", class: "cows", head: 22, deaths: 0, inDate: d(-35), inWeight: 1280,
      priceBasis: "head", purchasePrice: 1850, adg: 1.2, marketRef: "LE", marketContract: "", basis: 0, cashPrice: 158,
      targetWeight: 1380, targetDate: "", dailyCost: 1.9, status: "open", notes: "Valued at local cash bid" },
    { id: uid(), name: "Spring Calves 2026", class: "calves", head: 95, deaths: 1, inDate: d(-210), inWeight: 450,
      priceBasis: "cwt", purchasePrice: 405, adg: 2.2, marketRef: "GF", marketContract: "", basis: 0,
      targetWeight: 800, targetDate: "", dailyCost: 2.4, status: "sold",
      sale: { date: d(-52), head: 94, avgWeight: 792, priceCwt: 351.5 }, notes: "Sold through video auction" },
  ];

  const expenses = [];
  const add = (lot, offset, category, amount, note = "") =>
    expenses.push({ id: uid(), lotId: lot.id, date: addDays(lot.inDate, offset), category, amount: Math.round(amount * 100) / 100, note });
  for (const lot of lots) {
    const end = lot.status === "sold" ? lot.sale.date : T;
    const span = Math.round((new Date(end) - new Date(lot.inDate)) / 864e5);
    const hd = lot.head - lot.deaths;
    add(lot, 0, "Freight", lot.head * 14.5, "Haul in");
    add(lot, 1, "Vet & Health", lot.head * 22, "Processing: vaccines, implant, pour-on");
    if (lot.class === "cows") add(lot, 0, "Commission", lot.head * 25, "Buying commission");
    for (let m = 30; m <= span; m += 30) {
      add(lot, m, "Feed", hd * 30 * (lot.dailyCost * 0.78), "Ration, 30 days");
      add(lot, m, "Yardage", hd * 30 * 0.45, "30 days");
    }
    if (span > 60) add(lot, 60, "Vet & Health", hd * 6.5, "Re-implant / treatment");
    add(lot, Math.max(1, span - 5), "Interest", (lot.priceBasis === "head" ? lot.purchasePrice * lot.head : lot.purchasePrice * lot.inWeight / 100 * lot.head) * 0.075 * span / 365, "Operating note");
    if (lot.status === "sold") {
      add(lot, span, "Commission", lot.sale.head * 30, "Selling commission");
      add(lot, span, "Freight", lot.sale.head * 9, "Haul out");
      add(lot, span, "Checkoff", lot.sale.head * 1, "Beef checkoff");
    }
  }

  const finishers = lots[2], heifers = lots[1];
  const positions = [
    { id: uid(), type: "futures", symbol: "LE", contract: front("LE", 1), side: "short", contracts: 1,
      entryPrice: round((quotePx(quotes, front("LE", 1)) || 230) + 3.4), date: d(-40), lotId: finishers.id, note: "Hedge on Pen 3" },
    { id: uid(), type: "futures", symbol: "GF", contract: front("GF", 1), side: "short", contracts: 1,
      entryPrice: round((quotePx(quotes, front("GF", 1)) || 330) - 4.25), date: d(-20), lotId: lots[0].id, note: "" },
    { id: uid(), type: "option", symbol: "GF", contract: front("GF", 0), optType: "put", side: "long", contracts: 1,
      strike: Math.round((quotePx(quotes, front("GF", 0)) || 335) / 5) * 5, premium: 7.1, currentPremium: 6.4,
      date: d(-30), lotId: lots[0].id, note: "At-the-money floor" },
    { id: uid(), type: "futures", symbol: "ZC", contract: front("ZC", 1), side: "long", contracts: 2,
      entryPrice: round((quotePx(quotes, front("ZC", 1)) || 450) - 6.5), date: d(-25), lotId: "", note: "Locking in feed corn" },
    { id: uid(), type: "lrp", commodity: "feeder", head: 80, targetWeight: 850, coveragePrice: round((quotePx(quotes, front("GF", 1)) || 330) - 2),
      endDate: d(95), contract: front("GF", 2), premium: 6.85, date: d(-45), lotId: heifers.id, note: "95% coverage, 13-week endorsement" },
  ];

  const state = { ...emptyState(), operation: { name: "Red River Cattle Co. (sample)", owner: "" }, lots, expenses, positions };
  state.snapshots = backfillSnapshots(state, quotes, 60);
  return state;
}

const round = (x) => Math.round(x * 100) / 100;
const quotePx = (q, code) => q?.contracts?.[code]?.close;

// Recreate what each day's equity would have been, using that day's settlements.
function backfillSnapshots(state, quotes, days) {
  const T = todayISO();
  const out = [];
  for (let i = days; i >= 1; i--) {
    const date = addDays(T, -i);
    const q = quotesAsOf(quotes, date);
    if (!q) continue;
    const s = {
      ...state,
      lots: state.lots.filter((l) => l.inDate <= date).map((l) =>
        l.status === "sold" && l.sale.date > date ? { ...l, status: "open", sale: undefined } : l),
      expenses: state.expenses.filter((e) => e.date <= date),
      positions: state.positions.filter((p) => p.date <= date),
    };
    out.push({ ...snapshotFrom(operationSummary(s, q, date), date, false), sample: true });
  }
  return out;
}

export function quotesAsOf(quotes, date) {
  if (!quotes?.roots) return null;
  const roots = {}, contracts = {};
  for (const [root, r] of Object.entries(quotes.roots)) {
    const cs = [];
    for (const c of r.contracts || []) {
      const h = (c.history || []).filter(([dd]) => dd <= date);
      if (!h.length) continue;
      const close = h[h.length - 1][1];
      cs.push({ ...c, close });
      contracts[c.code] = { root, label: c.label, close, date: h[h.length - 1][0] };
    }
    roots[root] = { ...r, contracts: cs };
  }
  return { roots, contracts };
}
