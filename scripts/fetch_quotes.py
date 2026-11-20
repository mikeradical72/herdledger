#!/usr/bin/env python3
"""Fetch end-of-day / delayed futures settlements for HerdLedger.

Source: Yahoo Finance public chart endpoint (delayed, not real-time).
Writes data/quotes.json. If every request fails, the existing file is left
untouched and the script exits non-zero so the workflow shows the failure.
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.request

ROOTS = {
    "LE": {"name": "Live Cattle", "exch": "CME", "months": "GJMQVZ", "unit": "$/cwt", "multiplier": 400},
    "GF": {"name": "Feeder Cattle", "exch": "CME", "months": "FHJKQUVX", "unit": "$/cwt", "multiplier": 500},
    "ZC": {"name": "Corn", "exch": "CBT", "months": "HKNUZ", "unit": "cents/bu", "multiplier": 50},
}
MONTH_NUM = {c: i + 1 for i, c in enumerate("FGHJKMNQUVXZ")}
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
UA = {"User-Agent": "Mozilla/5.0 (HerdLedger quotes bot; +https://github.com/mikeradical72/herdledger)"}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "quotes.json")
N_CONTRACTS = 4


def fetch_chart(symbol, rng="3mo"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={rng}&interval=1d"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                data = json.load(r)
            res = (data.get("chart") or {}).get("result")
            if not res:
                return None
            res = res[0]
            ts = res.get("timestamp") or []
            closes = (res.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
            hist = [
                [dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%d"), round(c, 4)]
                for t, c in zip(ts, closes)
                if c is not None
            ]
            if not hist:
                return None
            return {"meta": res.get("meta", {}), "history": hist}
        except Exception as e:  # noqa: BLE001
            print(f"  {symbol}: attempt {attempt + 1} failed: {e}", file=sys.stderr)
            time.sleep(2 + attempt * 3)
    return None


def upcoming_codes(root, months, today, count):
    out, y, m = [], today.year, today.month
    for _ in range(36):
        for c in months:
            if MONTH_NUM[c] == m:
                out.append((c, y))
        m += 1
        if m > 12:
            m, y = 1, y + 1
        if len(out) >= count + 1:
            break
    return out


def main():
    today = dt.date.today()
    result = {
        "generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Yahoo Finance (delayed / end-of-day)",
        "disclaimer": "End-of-day or delayed prices. Not real-time. Not for trading decisions.",
        "roots": {},
        "contracts": {},
    }
    ok = 0
    for root, info in ROOTS.items():
        print(f"{root} …")
        entry = {k: info[k] for k in ("name", "unit", "multiplier")}
        entry["contracts"] = []
        cont = fetch_chart(f"{root}=F")
        if cont:
            entry["continuous"] = {"symbol": f"{root}=F", "label": cont["meta"].get("shortName"),
                                   "close": cont["history"][-1][1], "date": cont["history"][-1][0]}
        for mcode, year in upcoming_codes(root, info["months"], today, N_CONTRACTS + 1):
            code = f"{root}{mcode}{str(year)[2:]}"
            ch = fetch_chart(f"{code}.{info['exch']}")
            if not ch:
                print(f"  {code}: no data")
                continue
            hist = ch["history"]
            last_date = dt.date.fromisoformat(hist[-1][0])
            if (today - last_date).days > 10:  # expired / stale contract
                print(f"  {code}: stale ({last_date})")
                continue
            close, prev = hist[-1][1], (hist[-2][1] if len(hist) > 1 else None)
            c = {
                "code": code,
                "label": f"{MONTH_ABBR[MONTH_NUM[mcode] - 1]} {year}",
                "close": close,
                "prevClose": prev,
                "change": round(close - prev, 4) if prev is not None else None,
                "date": hist[-1][0],
                "history": hist[-70:],
            }
            entry["contracts"].append(c)
        # A contract whose last print is older than its siblings has expired (e.g. GFX on expiry day).
        if entry["contracts"]:
            newest = max(c["date"] for c in entry["contracts"])
            entry["contracts"] = [c for c in entry["contracts"] if c["date"] == newest][:N_CONTRACTS]
        for c in entry["contracts"]:
            result["contracts"][c["code"]] = {k: c[k] for k in ("label", "close", "change", "date")} | {"root": root}
            ok += 1
        entry["front"] = entry["contracts"][0]["code"] if entry["contracts"] else None
        result["roots"][root] = entry
    if ok == 0:
        print("No quotes fetched; leaving existing file untouched.", file=sys.stderr)
        sys.exit(1)
    with open(OUT, "w") as f:
        json.dump(result, f, indent=1)
        f.write("\n")
    print(f"Wrote {ok} contracts to {OUT}")


if __name__ == "__main__":
    main()
