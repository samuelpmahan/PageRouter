#!/usr/bin/env python3
"""Published-build browser acceptance checks for the HH bounded style playground.

This runner is intended for ordinary browser-enabled CI against a published HH
fixture URL. It does not start a local HTTP server, seed application state, or
evaluate app-provided code. For this task's live cloud-browser QA, use the
documented CUA tab APIs instead of invoking this runner.

Example:
  python3 exp/adversarial/hh_style_usability_qa.py \
    --base-url https://<published-host>/compiled/hh/index.html
"""
import argparse
import json
import pathlib
import re
import sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "evidence" / "hh-style-usability"
OUT.mkdir(parents=True, exist_ok=True)

checks = []


def check(name, condition, detail=""):
    row = {"name": name, "ok": bool(condition), "detail": str(detail)}
    checks.append(row)
    print(("PASS" if condition else "FAIL") + " " + name + (" — " + str(detail) if detail else ""))


def screenshot(page, name):
    path = OUT / name
    page.screenshot(path=str(path), full_page=False)
    return str(path.relative_to(ROOT))


def wait_status(page, fragment, timeout=5000):
    page.locator(".pxdt-style-status").filter(has_text=fragment).wait_for(timeout=timeout)


def open_style_panel(page):
    page.get_by_role("button", name="PxC DevTools", exact=True).click()
    page.locator(".pxdt").wait_for(state="visible")
    page.locator(".pxdt-style > summary").click()
    page.locator(".pxdt-style [data-view='style-playground']").wait_for(state="visible")


def read_candidates(page):
    return page.locator(".pxdt-style-choice small").all_text_contents()


def app_dom_and_state(page):
    return page.locator("#app").inner_text(), page.locator(".pxdt-loaded-status").inner_text(), page.locator(".pxdt-teacher-row").all_text_contents()


def dimensions(page, selector):
    return page.locator(selector).evaluate("el => ({x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight})")


def contrast_with_white(rgb_text):
    channels = re.findall(r"\d+(?:\.\d+)?", rgb_text)
    if len(channels) < 3:
        return 0.0
    values = [int(float(channel)) / 255 for channel in channels[:3]]
    linear = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4 for value in values]
    luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    return 1.05 / (luminance + 0.05)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True, help="Published HH fixture page URL")
    parser.add_argument("--headed", action="store_true", help="Show Chromium instead of running headless (useful in desktop CI)")
    parser.add_argument("--timeout", type=int, default=15000)
    args = parser.parse_args()

    page_errors = []
    console_errors = []
    base = args.base_url

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

        response = page.goto(base, wait_until="domcontentloaded", timeout=args.timeout)
        page.locator("#app main#main h1").wait_for(timeout=args.timeout)
        page.wait_for_timeout(350)
        check("published HH fixture loaded", response is not None and response.ok and page.locator("#app").count() == 1, f"{page.url} status={response.status if response else 'no response'}")
        check("style playground is gated inside the existing DevTools panel", page.locator(".pxdt").count() == 1 and page.locator(".pxdt-style").count() == 1, "existing app root remains mounted")
        screenshot(page, "01-desktop-hh-before.png")
        teacher_before = app_dom_and_state(page)
        h1_color_before = page.locator("#app h1").first.evaluate("el => getComputedStyle(el).color")

        open_style_panel(page)
        screenshot(page, "02-desktop-style-controls.png")
        check("bounded controls and workflow actions are available without search", all(page.get_by_role("button", name=name, exact=True).count() == 1 for name in ["Generate six styles", "Replay same seed", "Keep selected style", "Reset style", "Export kept values"]), page.locator(".pxdt-style-actions").inner_text())
        check("seed and eight explicit bound inputs are present", page.locator(".pxdt-style input[type=number]").count() == 9, str(page.locator(".pxdt-style input[type=number]").count()))
        check("all numeric controls have visible labels and allowed min/max", page.locator(".pxdt-style-bounds .pxdt-style-range").count() == 4 and page.locator(".pxdt-style-bounds label").count() == 8, "four fields × Min/Max")
        bound_labels = page.locator(".pxdt-style-bounds input[type=number]").evaluate_all("els => els.map(el => [el.getAttribute('aria-label') || '', ...[...el.labels].map(label => label.textContent.trim())].join(' '))")
        check("each bound input's accessible label names its style field and endpoint", all(any(field.lower() in label.lower() for field in ["Accent hue", "Card padding", "Layout gap", "Corner radius"]) and ("Min" in label or "Max" in label) for label in bound_labels), bound_labels)

        seed = page.locator(".pxdt-style input[type=number]").first
        seed.fill("42")
        page.get_by_role("button", name="Generate six styles", exact=True).click()
        wait_status(page, "Generated six deterministic variants")
        page.locator(".pxdt-style-choice").nth(5).wait_for()
        first_candidates = read_candidates(page)
        first_addresses = page.locator(".pxdt-style-parts [data-part-address]").evaluate_all("els => els.map(el => el.dataset.partAddress)")
        screenshot(page, "03-desktop-generated.png")
        check("Generate creates exactly six candidate controls", page.locator(".pxdt-style-choice").count() == 6, str(page.locator(".pxdt-style-choice").count()))
        check("seed, bounds, and candidate Parts are directly discoverable without the advanced search", len(first_addresses) == 3 and ["seed", "bounds", "candidates"] == ["seed" if ".seed." in x else "bounds" if ".bounds." in x else "candidates" if ".candidates." in x else "other" for x in first_addresses], first_addresses)
        receipts_before_generate = page.locator(".pxdt-activity-row").count()

        # Follow one real Part link and make sure DevTools presents its actual
        # address and receipt links, rather than just a value-only mock.
        page.get_by_role("button", name="Six variants Part", exact=True).click()
        page.locator("[data-view='title']").filter(has_text=first_addresses[2]).wait_for()
        detail_text = page.locator("[data-view='detail']").inner_text()
        check("variant Part opens in the actual PxC inspector with provenance", "Producer and inputs" in detail_text and "Calculation" in detail_text, detail_text[:350])
        receipts_after_generate = page.locator(".pxdt-activity-row").count()
        check("generation is recorded in recent activity", receipts_after_generate > receipts_before_generate, {"before": receipts_before_generate, "after": receipts_after_generate})
        screenshot(page, "04-desktop-pxc-variants-part.png")

        page.get_by_role("button", name="Replay same seed", exact=True).click()
        wait_status(page, "Replayed six deterministic variants")
        replayed = read_candidates(page)
        check("Replay regenerates the same visible six values", replayed == first_candidates, {"first": first_candidates, "replay": replayed})

        # Repeat a small number of controls to exercise replaced candidates,
        # stale selection labels, and repeated Part/receipt refreshes.
        for repeat in range(2):
            page.locator(".pxdt-style-choice").nth(repeat + 1).click()
            wait_status(page, f"Style {repeat + 2} is applied")
            page.locator(".pxdt-style-choice").nth(5).wait_for()
            page.get_by_role("button", name="Replay same seed", exact=True).click()
            wait_status(page, "Replayed six deterministic variants")
            check(f"repeated replay {repeat + 1} leaves one current six-choice set", page.locator(".pxdt-style-choice").count() == 6, str(page.locator(".pxdt-style-choice").count()))

        page.locator(".pxdt-style-choice").nth(2).click()
        wait_status(page, "Style 3 is applied")
        screenshot(page, "05-desktop-style-selected.png")
        style_props = page.locator("#app").evaluate("el => Object.fromEntries(['--hh-style-accent-hue','--hh-style-card-padding','--hh-style-layout-gap','--hh-style-radius'].map(key => [key, el.style.getPropertyValue(key)]))")
        check("selection applies only the four bounded HH style properties", len(style_props) == 4 and all(style_props.values()), style_props)
        check("teacher journey DOM and loaded profile data remain unchanged through style runs", app_dom_and_state(page) == teacher_before, "app text, current loaded-state status, and seed teacher rows compared")
        h1_color_after = page.locator("#app h1").first.evaluate("el => getComputedStyle(el).color")
        check("accent-colored heading retains readable contrast on the white HH card", contrast_with_white(h1_color_after) >= 4.5, {"before": h1_color_before, "after": h1_color_after, "contrast": round(contrast_with_white(h1_color_after), 2)})
        check("selection keeps the HH inspector usable", page.locator(".pxdt").is_visible() and page.locator(".pxdt-style-status").is_visible(), "pinned panel and live status remain visible")

        page.get_by_role("button", name="Keep selected style", exact=True).click()
        wait_status(page, "Kept for this tab")
        record_text = page.locator(".pxdt-style-export pre").inner_text()
        record = json.loads(record_text)
        check("Keep opens a portable JSON record with seed, bounds, selection, and exact CSS values", all(key in record for key in ["schema", "generator", "seed", "bounds", "selectedIndex", "style", "cssVariables"]) and record["schema"] == "hh-style-playground@1" and record["selectedIndex"] == 2 and record["cssVariables"] == style_props, record)
        screenshot(page, "06-desktop-kept-values.png")
        with page.expect_download(timeout=args.timeout) as download_info:
            page.get_by_role("button", name="Export kept values", exact=True).click()
        download = download_info.value
        downloaded = OUT / "hh-style-playground.json"
        download.save_as(str(downloaded))
        downloaded_record = json.loads(downloaded.read_text())
        check("Export downloads the kept portable JSON", downloaded_record == record, str(downloaded.relative_to(ROOT)))

        # A reload tests the session-storage restore path, not only in-memory state.
        page.reload(wait_until="domcontentloaded", timeout=args.timeout)
        page.locator("#app main#main h1").wait_for(timeout=args.timeout)
        page.wait_for_timeout(500)
        restored_style = page.locator("#app").evaluate("el => Object.fromEntries(['--hh-style-accent-hue','--hh-style-card-padding','--hh-style-layout-gap','--hh-style-radius'].map(key => [key, el.style.getPropertyValue(key)]))")
        check("kept style restores after reload from this tab's session storage", restored_style == style_props, {"expected": style_props, "actual": restored_style})
        open_style_panel(page)
        wait_status(page, f"Restored the kept style from seed {record['seed']}")
        check("restored export remains available and matches the saved value", json.loads(page.locator(".pxdt-style-export pre").inner_text()) == record and not page.get_by_role("button", name="Export kept values", exact=True).is_disabled(), "same tab restore")

        page.get_by_role("button", name="Reset style", exact=True).click()
        wait_status(page, "Teacher journey state and PxC receipts are unchanged")
        reset_style = page.locator("#app").evaluate("el => el.getAttribute('style')")
        check("Reset clears the applied variables and kept session record", reset_style in (None, "") and page.get_by_role("button", name="Export kept values", exact=True).is_disabled(), str(reset_style))
        check("Reset preserves the loaded teacher journey state", app_dom_and_state(page) == teacher_before, "app text, current loaded-state status, and seed teacher rows compared")
        screenshot(page, "07-desktop-reset.png")

        # Keyboard path: Escape closes DevTools and returns focus to the opener.
        page.keyboard.press("Escape")
        page.locator(".pxdt").wait_for(state="hidden")
        focused_text = page.evaluate("document.activeElement?.textContent?.trim()")
        check("Escape closes the pinned panel and restores focus to its opener", "PxC DevTools" in (focused_text or ""), focused_text)

        # Small-screen acceptance, including the post-Generate inspect jump.
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(200)
        open_style_panel(page)
        panel_geometry = dimensions(page, ".pxdt")
        document_width = page.evaluate("({width: innerWidth, scrollWidth: document.documentElement.scrollWidth})")
        screenshot(page, "08-mobile-style-controls-390x844.png")
        check("phone panel remains within viewport with internal vertical scrolling when needed", panel_geometry["x"] >= 0 and panel_geometry["x"] + panel_geometry["width"] <= 390 and panel_geometry["height"] <= 844 and panel_geometry["scrollHeight"] >= panel_geometry["clientHeight"], panel_geometry)
        check("phone layout has no document-level horizontal overflow", document_width["scrollWidth"] <= document_width["width"], document_width)
        # Refresh/reset has already cleared saved state; start one mobile run.
        page.locator(".pxdt-style input[type=number]").first.fill("42")
        page.get_by_role("button", name="Generate six styles", exact=True).click()
        wait_status(page, "Generated six deterministic variants")
        page.locator(".pxdt-style-choice").nth(5).wait_for()
        page.wait_for_timeout(150)
        controls_rect = dimensions(page, ".pxdt-style-actions")
        choices_rect = dimensions(page, ".pxdt-style-candidates")
        panel_scroll = page.locator(".pxdt").evaluate("el => ({scrollTop: el.scrollTop, height: el.clientHeight, scrollHeight: el.scrollHeight})")
        screenshot(page, "09-mobile-generated-and-inspected-390x844.png")
        controls_visible = controls_rect["y"] < panel_geometry["y"] + panel_geometry["height"] and controls_rect["y"] + controls_rect["height"] > panel_geometry["y"]
        choices_visible = choices_rect["y"] < panel_geometry["y"] + panel_geometry["height"] and choices_rect["y"] + choices_rect["height"] > panel_geometry["y"]
        check("mobile Generate leaves style controls or candidates visible after automatic Part inspection", controls_visible or choices_visible, {"panel": panel_geometry, "controls": controls_rect, "choices": choices_rect, "scroll": panel_scroll})
        mobile_teacher_before = app_dom_and_state(page)
        page.keyboard.press("Escape")
        page.locator(".pxdt").wait_for(state="hidden")
        check("phone Escape restores access to the HH app", page.locator("#app").is_visible() and page.get_by_role("button", name="PxC DevTools", exact=True).is_visible(), "application root and opener remain visible")
        # The teacher surface can be reached again after closing the overlay.
        check("phone style experiment does not mutate teacher state", app_dom_and_state(page) == mobile_teacher_before, "same synthetic teacher text/profile rows")
        screenshot(page, "10-mobile-app-after-close-390x844.png")

        page.set_viewport_size({"width": 320, "height": 568})
        page.wait_for_timeout(250)
        open_style_panel(page)
        tiny_panel = dimensions(page, ".pxdt")
        tiny_width = page.evaluate("({width: innerWidth, scrollWidth: document.documentElement.scrollWidth})")
        screenshot(page, "11-mobile-style-controls-320x568.png")
        check("compact phone controls remain inside the 320px viewport", tiny_panel["x"] >= 0 and tiny_panel["x"] + tiny_panel["width"] <= 320 and tiny_width["scrollWidth"] <= tiny_width["width"], {"panel": tiny_panel, "document": tiny_width})
        check("numeric Min/Max controls remain individually visible on compact phone", page.locator(".pxdt-style-bounds input[type=number]").count() == 8 and page.locator(".pxdt-style-bounds").evaluate("el => el.scrollWidth <= el.clientWidth"), dimensions(page, ".pxdt-style-bounds"))

        check("no uncaught HH page errors", len(page_errors) == 0, page_errors)
        check("no browser console errors", len(console_errors) == 0, console_errors)
        result = {"baseUrl": base, "checks": checks, "pageErrors": page_errors, "consoleErrors": console_errors,
                  "screenshots": sorted(p.name for p in OUT.glob("*.png"))}
        (OUT / "browser-qa.json").write_text(json.dumps(result, indent=2))
        context.close()
        browser.close()

    failed = [row for row in checks if not row["ok"]]
    print(json.dumps({"passed": len(checks) - len(failed), "failed": len(failed), "report": str(OUT / "browser-qa.json"),
                      "evidence": str(OUT)}, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
