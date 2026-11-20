# Browser smoke test: python3 tests/smoke.py [base_url]
import sys, json
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/"
errors = []
with sync_playwright() as p:
    try: b = p.chromium.launch()
    except Exception: b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    def watch(page):
        page.on("pageerror", lambda e: errors.append(f"pageerror {page.url}: {e}"))
        page.on("console", lambda m: m.type == "error" and errors.append(f"console {page.url}: {m.text}"))
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page(); watch(pg)
    pg.goto(BASE + "index.html"); pg.wait_for_selector(".plan")
    prices = pg.eval_on_selector_all(".plan .price b", "els => els.map(e => e.textContent)")
    print("landing prices:", prices)
    pg.goto(BASE + "app.html"); pg.wait_for_selector("[data-act=sample]")
    pg.click("[data-act=sample]"); pg.wait_for_selector(".kpis .kpi")
    s = pg.evaluate("(() => { const s = window.__hl.summary(); return {head:s.totalHead, cost:s.costBasis, mv:s.marketValue, hedge:s.hedgeValue, equity:s.equity, snaps: window.__hl.state.snapshots.length, expo:s.exposure, lots:s.lotsM.map(m=>({n:m.name,be:m.breakevenCwt,mkt:m.marketCwt,pl:m.pl,src:m.marketSource})), pos:s.posM.map(x=>({t:x.p.type,s:x.p.symbol,c:x.p.contract,last:x.m.last,mtm:x.m.mtm}))} })()")
    print(json.dumps(s, indent=1))
    for route in ["lots", "risk", "markets", "equity", "reports", "settings"]:
        pg.goto(BASE + "app.html#/" + route); pg.wait_for_timeout(300)
        assert pg.inner_text("#view").strip(), route
    # open a lot, add expense via modal
    pg.goto(BASE + "app.html#/lots"); pg.click(".lot-card >> nth=0"); pg.wait_for_selector("[data-act=add-exp]")
    before = pg.evaluate("window.__hl.state.expenses.length")
    pg.click("[data-act=add-exp]"); pg.fill("#f_amount", "123.45"); pg.click("dialog button.primary")
    pg.wait_for_timeout(200)
    assert pg.evaluate("window.__hl.state.expenses.length") == before + 1, "expense add failed"
    # add futures position through modal flow
    pg.goto(BASE + "app.html#/risk"); pg.click("[data-act=add-pos][data-type=futures]")
    pg.fill("#f_entryPrice", "230"); pg.click("dialog button.primary"); pg.wait_for_timeout(200)
    assert pg.evaluate("window.__hl.state.positions.length") == 6, "position add failed"
    # reload persists
    pg.reload(); pg.wait_for_timeout(500)
    assert pg.evaluate("window.__hl.state.positions.length") == 6, "not persisted"
    # screenshots
    pg.goto(BASE + "app.html#/dash"); pg.wait_for_timeout(3200)
    pg.screenshot(path="screenshot-desktop.png", full_page=True)
    m = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    mp = m.new_page(); watch(mp)
    mp.goto(BASE + "app.html"); mp.wait_for_selector("[data-act=sample]"); mp.click("[data-act=sample]"); mp.wait_for_selector(".kpis")
    mp.wait_for_timeout(3200)  # let the toast fade
    mp.screenshot(path="screenshot.png")
    mp.screenshot(path="screenshot-mobile-full.png", full_page=True)
    mp.screenshot(path="img/hero.png")
    mp.goto(BASE + "app.html#/risk"); mp.wait_for_timeout(300); mp.screenshot(path="/tmp/hl-risk.png", full_page=True)
    mp.goto(BASE + "app.html#/lots"); mp.click(".lot-card >> nth=0"); mp.wait_for_timeout(300); mp.screenshot(path="/tmp/hl-lot.png", full_page=True)
    mp.goto(BASE + "index.html"); mp.wait_for_timeout(400); mp.screenshot(path="/tmp/hl-landing.png", full_page=True)
    b.close()
print("ERRORS:", errors if errors else "none")
sys.exit(1 if errors else 0)
