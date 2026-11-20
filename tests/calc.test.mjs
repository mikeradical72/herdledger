// Run: node tests/calc.test.mjs
import assert from "node:assert/strict";
import { lotMetrics, positionMetrics, operationSummary, exposure } from "../js/calc.js";

const near = (a, b, msg, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b}`);
const quotes = { roots: { GF: { contracts: [{ code: "GFF27", close: 330 }] }, LE: { contracts: [{ code: "LEG27", close: 230 }] }, ZC: { contracts: [{ code: "ZCH27", close: 450 }] } },
  contracts: { GFF27: { root: "GF", close: 330 }, LEG27: { root: "LE", close: 230 }, ZCH27: { root: "ZC", close: 450 }, GFH27: { root: "GF", close: 325 } } };

// Lot: 100 hd, 600 lb, $350/cwt, ADG 3, 50 days, 2 dead, $20,000 expenses, basis -5 on GF
const lot = { id: "a", name: "T", head: 100, deaths: 2, inDate: "2026-01-01", inWeight: 600, priceBasis: "cwt", purchasePrice: 350,
  adg: 3, marketRef: "GF", basis: -5, targetWeight: 900, dailyCost: 3, status: "open" };
const exps = [{ lotId: "a", amount: 12000, category: "Feed" }, { lotId: "a", amount: 8000, category: "Yardage" }, { lotId: "b", amount: 999 }];
const m = lotMetrics(lot, exps, quotes, "2026-02-20");
assert.equal(m.dof, 50);
assert.equal(m.headOnHand, 98);
near(m.estWeight, 750, "est weight");
near(m.purchaseCost, 210000, "purchase = 350 × 6 cwt × 100");
near(m.costBasis, 230000, "cost basis");
near(m.costPerHead, 230000 / 98, "cost/hd");
near(m.liveCwt, 735, "live cwt = 98 × 7.5");
near(m.breakevenCwt, 230000 / 735, "breakeven"); // 312.93
near(m.marketCwt, 325, "market = 330 − 5");
near(m.marketValue, 735 * 325, "market value"); // 238,875
near(m.pl, 238875 - 230000, "P/L"); // 8,875
// projection: (900−750)/3 = 50 days, + 3 × 98 × 50 = 14,700
near(m.projection.days, 50, "proj days");
near(m.projection.addlCost, 14700, "proj added cost");
near(m.projection.projBreakeven, 244700 / 882, "proj breakeven");

// Per-head pricing + manual cash price + specific contract
const lot2 = { ...lot, id: "b", priceBasis: "head", purchasePrice: 2000, head: 10, deaths: 0, cashPrice: 240, marketContract: "GFH27" };
const m2 = lotMetrics(lot2, exps, quotes, "2026-02-20");
near(m2.purchaseCost, 20000, "per-head purchase");
near(m2.costBasis, 20999, "per-head cost basis");
near(m2.marketCwt, 240, "manual cash wins");
const m2b = lotMetrics({ ...lot2, cashPrice: "" }, exps, quotes, "2026-02-20");
near(m2b.marketCwt, 320, "specific contract GFH27 325 − 5");

// Sold lot
const sold = { ...lot, id: "c", status: "sold", sale: { date: "2026-03-01", head: 98, avgWeight: 800, priceCwt: 300 } };
const ms = lotMetrics(sold, [], quotes, "2026-04-01");
assert.equal(ms.dof, 59);
near(ms.marketValue, 98 * 8 * 300, "sale revenue");
near(ms.pl, 235200 - 210000, "realized P/L");

// Futures: short 2 LE @ 235, last 230 → +5 × 400 × 2 = +4,000
const f = positionMetrics({ type: "futures", symbol: "LE", contract: "LEG27", side: "short", contracts: 2, entryPrice: 235 }, quotes);
near(f.mtm, 4000, "short LE MTM");
assert.equal(f.hedgedCwt, 800);
// Long corn 1 @ 440¢, last 450 → 10¢ × $50 = +500
near(positionMetrics({ type: "futures", symbol: "ZC", contract: "ZCH27", side: "long", contracts: 1, entryPrice: 440 }, quotes).mtm, 500, "long ZC MTM");
// Long GF put strike 335, paid 6, last 330 → intrinsic 5, MTM (5−6) × 500 = −500
const o = positionMetrics({ type: "option", symbol: "GF", contract: "GFF27", optType: "put", side: "long", contracts: 1, strike: 335, premium: 6, currentPremium: "" }, quotes);
near(o.intrinsic, 5, "put intrinsic"); near(o.mtm, -500, "put MTM"); assert.equal(o.hedgedCwt, 500);
// Short call strike 320 received 4, last 330 → intrinsic 10 → (10−4) × 500 × −1 = −3,000
near(positionMetrics({ type: "option", symbol: "GF", optType: "call", side: "short", contracts: 1, strike: 320, premium: 4, currentPremium: "" }, quotes).mtm, -3000, "short call MTM");
// Entered premium overrides intrinsic
near(positionMetrics({ type: "option", symbol: "GF", optType: "put", side: "long", contracts: 1, strike: 335, premium: 6, currentPremium: 9 }, quotes).mtm, 1500, "entered premium MTM");
// LRP: 80 hd × 850 lb = 680 cwt, coverage 335, GF 330 → indemnity 5 × 680 = 3,400, premium 7 × 680 = 4,760
const l = positionMetrics({ type: "lrp", commodity: "feeder", head: 80, targetWeight: 850, coveragePrice: 335, premium: 7, endDate: "2099-01-01" }, quotes);
near(l.indemnity, 3400, "LRP indemnity"); near(l.premiumTotal, 4760, "LRP premium"); near(l.mtm, -1360, "LRP net"); near(l.hedgedCwt, 680, "LRP cwt");

// Operation + exposure
const state = { lots: [lot], expenses: exps, positions: [{ type: "futures", symbol: "GF", side: "short", contracts: 1, entryPrice: 340 }] };
const s = operationSummary(state, quotes, "2026-02-20");
near(s.hedgeValue, 5000, "short GF 340→330 = +5,000");
near(s.equity, 8875 + 5000, "equity = cattle P/L + hedges");
near(s.exposure.cattleCwt, 882, "exposure uses target weight 98 × 9");
near(s.exposure.hedgedCwt, 500, "1 GF = 500 cwt");
near(s.exposure.unhedged, 382, "unhedged");
console.log("All calc tests passed ✔");
