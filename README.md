# HerdLedger

Cattle inventory, cost-of-gain, breakeven and hedge tracking for cattle producers. Mobile-first static web app.

- **Live:** https://mikeradical72.github.io/herdledger/ (landing) · https://mikeradical72.github.io/herdledger/app.html (app)
- **v1 preview:** no accounts yet. Data lives in the browser (localStorage) with JSON backup/restore. Tap **Load sample operation** to demo.

## Layout
| Path | What |
|---|---|
| `index.html` | Marketing / pricing page |
| `app.html` | The app (hash-routed single page) |
| `js/config.js` | **Brand, plans & prices — the only place pricing lives** |
| `js/calc.js` | Pure math: lot metrics, breakeven, projections, futures/options/LRP MTM, exposure |
| `js/store.js` | Data layer (LocalStore). Add a Supabase store with the same `load/save/clear` interface later |
| `js/app.js` | Views & events · `js/ui.js` helpers & SVG charts · `js/sample.js` demo operation |
| `data/quotes.json` | End-of-day futures (LE, GF, ZC) written by the quotes workflow |
| `scripts/fetch_quotes.py` | Pulls delayed closes from Yahoo Finance's public chart endpoint |
| `sw.js` | Network-first service worker (updates show on next open; cache only used offline) |

## Workflows
- **Update end-of-day quotes** — weekdays 22:30 UTC and on demand; commits `data/quotes.json` if prices changed.
- **Deploy site to GitHub Pages** — on every push to `main` and after each quotes run; runs `tests/calc.test.mjs` first.

## Math conventions
- Purchase cost = price × in-weight/100 × head ($/cwt) or price × head ($/head).
- Est. weight = in-weight + ADG × days on feed. Cost per head and per cwt spread total cost over **live** head (death loss carried by survivors).
- Market price = lot's cash override, else futures close (chosen contract or front month) + basis.
- Futures MTM: (last − entry) × multiplier × contracts, sign-flipped for shorts. LE $400, GF $500 per $1/cwt; ZC $50 per 1¢/bu.
- Options: current premium if entered, else intrinsic vs. the futures close.
- LRP: est. indemnity = max(0, coverage − futures) × head × target cwt, net of producer premium.
- Equity = market value − cost basis of open lots + hedge MTM.

## Tests
```
node tests/calc.test.mjs            # math
python3 -m http.server 8765 & python3 tests/smoke.py   # browser smoke test (Playwright)
```

## Next phase
Supabase auth + Postgres (swap `getStore()`), Stripe Checkout using `BILLING` in `js/config.js`, plan gating by `PLANS[].id`, custom domain.

Prices are end-of-day / delayed and for planning only. Not financial advice.
