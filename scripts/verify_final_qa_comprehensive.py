import os
import sys
import time
import json
import shutil
from playwright.sync_api import sync_playwright

CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:3123")
OUT_DIR = "/Users/ayan/Vow-repo/.screenshots/review-round-final"
PARENT_BRAIN_DIR = "/Users/ayan/.gemini/antigravity/brain/cb7472af-f833-4347-8c7d-3bda1652fff7"
MY_BRAIN_DIR = "/Users/ayan/.gemini/antigravity/brain/b50e7033-b22c-46a1-8e56-5d1af76f2745"

for d in [OUT_DIR, PARENT_BRAIN_DIR, MY_BRAIN_DIR]:
    os.makedirs(d, exist_ok=True)

def measure_layout(page, state_name):
    return page.evaluate("""(state) => {
        const app = document.querySelector('.vow-app');
        const main = document.querySelector('.vow-main');
        const rail = document.querySelector('.vow-railcol');
        const task = document.querySelector('.vow-taskcol');
        const col = document.querySelector('.vow-col');
        const mascot = document.querySelector('.vow-mascot-env');
        const mascotImg = document.querySelector('.vow-mascot-img');

        const appRect = app ? app.getBoundingClientRect() : null;
        const mainRect = main ? main.getBoundingClientRect() : null;
        const railRect = rail ? rail.getBoundingClientRect() : null;
        const taskRect = task ? task.getBoundingClientRect() : null;
        const colRect = col ? col.getBoundingClientRect() : null;
        const mascotRect = mascot ? mascot.getBoundingClientRect() : null;
        const mascotStyle = mascot ? window.getComputedStyle(mascot) : null;
        const mascotImgStyle = mascotImg ? window.getComputedStyle(mascotImg) : null;

        return {
            state,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            appRect: appRect ? { x: Math.round(appRect.x), width: Math.round(appRect.width), right: Math.round(appRect.right) } : null,
            mainRect: mainRect ? { x: Math.round(mainRect.x), width: Math.round(mainRect.width), right: Math.round(mainRect.right) } : null,
            railRect: railRect ? { x: Math.round(railRect.x), width: Math.round(railRect.width) } : null,
            taskRect: taskRect ? { x: Math.round(taskRect.x), width: Math.round(taskRect.width), right: Math.round(taskRect.right) } : null,
            colRect: colRect ? { x: Math.round(colRect.x), width: Math.round(colRect.width) } : null,
            mascot: mascot ? {
                x: Math.round(mascotRect.x),
                y: Math.round(mascotRect.y),
                width: Math.round(mascotRect.width),
                height: Math.round(mascotRect.height),
                opacity: mascotStyle ? parseFloat(mascotStyle.opacity) : null,
                pointerEvents: mascotStyle ? mascotStyle.pointerEvents : null,
                display: mascotStyle ? mascotStyle.display : null,
                zIndex: mascotStyle ? mascotStyle.zIndex : null,
                imgPointerEvents: mascotImgStyle ? mascotImgStyle.pointerEvents : null
            } : null,
            appClasses: app ? app.className : ""
        };
    }""", state_name)

def save_and_copy(page, filename):
    local_path = os.path.join(OUT_DIR, filename)
    page.screenshot(path=local_path)
    shutil.copy2(local_path, os.path.join(PARENT_BRAIN_DIR, filename))
    shutil.copy2(local_path, os.path.join(MY_BRAIN_DIR, filename))
    print(f"Captured: {filename}")
    return local_path

def run():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME_PATH,
            headless=True,
            args=["--disable-web-security", "--allow-running-insecure-content", "--no-sandbox"]
        )

        # =========================================================================
        # VIEWPORT 1: 1440x900 (Standard Desktop)
        # =========================================================================
        print("\n==================================================")
        print("TESTING 1440x900 LAYOUT PERMUTATIONS")
        print("==================================================")
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        # State 1: Both Open (Sidebar Open, Monitor Open)
        page.goto(f"{BASE_URL}/?monitor=1", wait_until="networkidle")
        page.wait_for_timeout(1000)
        s1_1440 = measure_layout(page, "1440 State 1: Both Open")
        results["1440_state1_both_open"] = s1_1440
        save_and_copy(page, "01-state1-both-open-1440x900.png")

        # State 2: Monitor Closed (Cmd+Shift+M or click Monitor button)
        monitor_btn = page.query_selector("button:has-text('Monitor')")
        assert monitor_btn, "Monitor button not found"
        monitor_btn.click()
        page.wait_for_timeout(500)
        s2_1440 = measure_layout(page, "1440 State 2: Monitor Closed")
        results["1440_state2_monitor_closed"] = s2_1440
        save_and_copy(page, "02-state2-monitor-closed-1440x900.png")

        # Re-open Monitor
        monitor_btn.click()
        page.wait_for_timeout(500)

        # State 3: Sidebar Closed (Click PanelLeft toggle)
        sidebar_btn = page.query_selector("button[aria-label='Toggle sidebar']")
        assert sidebar_btn, "Sidebar button not found"
        sidebar_btn.click()
        page.wait_for_timeout(500)
        s3_1440 = measure_layout(page, "1440 State 3: Sidebar Closed (Adaptive Mascot Focus)")
        results["1440_state3_sidebar_closed"] = s3_1440
        save_and_copy(page, "03-state3-sidebar-closed-1440x900.png")

        # State 4: Both Closed (Zen Focus Mode)
        monitor_btn.click()
        page.wait_for_timeout(500)
        s4_1440 = measure_layout(page, "1440 State 4: Both Closed (Zen Focus Mode)")
        results["1440_state4_both_closed"] = s4_1440
        save_and_copy(page, "04-state4-both-closed-1440x900.png")

        # Reset back to Both Open for modal tests
        sidebar_btn.click()
        monitor_btn.click()
        page.wait_for_timeout(500)

        # Mascot Speech Bubble Test
        mascot_img = page.query_selector(".vow-mascot-img")
        if mascot_img:
            mascot_img.click()
            page.wait_for_timeout(600)
            bubble = page.query_selector(".vow-mascot-speech")
            results["1440_mascot_bubble"] = {
                "active": bubble is not None,
                "text": bubble.inner_text() if bubble else None
            }
            save_and_copy(page, "15-mascot-speech-bubble-1440x900.png")
            # Dismiss speech bubble
            page.wait_for_timeout(4000)

        # Deliverable Report Preview Modal Test
        # Look for report preview trigger in PersistentLiveActivity or Tools
        report_preview_btn = page.query_selector("button:has-text('Preview full report'), button:has-text('View Deliverable Report'), button:has-text('Deliverable Report')")
        if not report_preview_btn:
            # Let's inspect buttons inside vow-taskcol
            buttons = page.eval_on_selector_all(".vow-taskcol button", "elements => elements.map(e => e.innerText.trim())")
            print("Taskcol buttons available:", buttons)
            for b in page.query_selector_all(".vow-taskcol button"):
                txt = b.inner_text().strip()
                if "Report" in txt or "Preview" in txt or "Deliverable" in txt:
                    report_preview_btn = b
                    break

        if report_preview_btn:
            report_preview_btn.click()
            page.wait_for_timeout(600)
            modal_info = page.evaluate("""() => {
                const dialog = document.querySelector('[role="dialog"], .vow-report-modal, .vow-deliverable-modal');
                const mascot = document.querySelector('.vow-mascot-env');
                const dialogStyle = dialog ? window.getComputedStyle(dialog) : null;
                const mascotStyle = mascot ? window.getComputedStyle(mascot) : null;
                return {
                    dialogFound: dialog !== null,
                    dialogZIndex: dialogStyle ? dialogStyle.zIndex : null,
                    mascotZIndex: mascotStyle ? mascotStyle.zIndex : null,
                    mascotOpacity: mascotStyle ? mascotStyle.opacity : null,
                    mascotPointerEvents: mascotStyle ? mascotStyle.pointerEvents : null
                };
            }""")
            results["modal_report_preview"] = modal_info
            print("Modal Report Preview:", modal_info)
            save_and_copy(page, "09-modal-report-preview-1440x900.png")
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)

        # Warden Transformation Modal Test
        warden_btn = page.query_selector("button:has-text('Warden Standby')")
        if warden_btn:
            warden_btn.click()
            page.wait_for_timeout(800)
            transform_info = page.evaluate("""() => {
                const overlay = document.querySelector('.vow-transform-overlay, [role="dialog"]');
                const mascot = document.querySelector('.vow-mascot-env');
                const overlayStyle = overlay ? window.getComputedStyle(overlay) : null;
                const mascotStyle = mascot ? window.getComputedStyle(mascot) : null;
                return {
                    overlayFound: overlay !== null,
                    overlayZIndex: overlayStyle ? overlayStyle.zIndex : null,
                    mascotZIndex: mascotStyle ? mascotStyle.zIndex : null,
                    bodyWardenClass: document.body.classList.contains('warden')
                };
            }""")
            results["modal_warden_transform"] = transform_info
            print("Warden Transform Modal:", transform_info)
            save_and_copy(page, "10-modal-warden-transform-1440x900.png")
            page.wait_for_timeout(2000)
            save_and_copy(page, "11-warden-both-open-1440x900.png")

        context.close()

        # =========================================================================
        # VIEWPORT 2: 1024x640 (Native Reference Resolution)
        # =========================================================================
        print("\n==================================================")
        print("TESTING 1024x640 LAYOUT PERMUTATIONS")
        print("==================================================")
        context = browser.new_context(viewport={"width": 1024, "height": 640})
        page = context.new_page()

        # State 1: Both Open at 1024
        page.goto(f"{BASE_URL}/?monitor=1", wait_until="networkidle")
        page.wait_for_timeout(1000)
        s1_1024 = measure_layout(page, "1024 State 1: Both Open")
        results["1024_state1_both_open"] = s1_1024
        save_and_copy(page, "05-state1-both-open-1024x640.png")

        # State 2: Monitor Closed at 1024
        monitor_btn = page.query_selector("button:has-text('Monitor')")
        if monitor_btn:
            monitor_btn.click()
            page.wait_for_timeout(500)
        s2_1024 = measure_layout(page, "1024 State 2: Monitor Closed")
        results["1024_state2_monitor_closed"] = s2_1024
        save_and_copy(page, "06-state2-monitor-closed-1024x640.png")

        # Re-open monitor
        if monitor_btn:
            monitor_btn.click()
            page.wait_for_timeout(500)

        # State 3: Sidebar Closed at 1024
        sidebar_btn = page.query_selector("button[aria-label='Toggle sidebar']")
        if sidebar_btn:
            sidebar_btn.click()
            page.wait_for_timeout(500)
        s3_1024 = measure_layout(page, "1024 State 3: Sidebar Closed")
        results["1024_state3_sidebar_closed"] = s3_1024
        save_and_copy(page, "07-state3-sidebar-closed-1024x640.png")

        # State 4: Both Closed at 1024
        if monitor_btn:
            monitor_btn.click()
            page.wait_for_timeout(500)
        s4_1024 = measure_layout(page, "1024 State 4: Both Closed (Zen Focus)")
        results["1024_state4_both_closed"] = s4_1024
        save_and_copy(page, "08-state4-both-closed-1024x640.png")

        # Warden mode at 1024
        sidebar_btn.click()
        monitor_btn.click()
        page.wait_for_timeout(500)
        warden_btn = page.query_selector("button:has-text('Warden Standby')")
        if warden_btn:
            warden_btn.click()
            page.wait_for_timeout(2500)
        save_and_copy(page, "12-warden-both-open-1024x640.png")

        context.close()

        # =========================================================================
        # VIEWPORT 3: 390x844 (Mobile)
        # =========================================================================
        print("\n==================================================")
        print("TESTING 390x844 MOBILE VIEWPORT")
        print("==================================================")
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()

        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(1000)
        m_normal = measure_layout(page, "Mobile Normal")
        results["mobile_normal"] = m_normal
        save_and_copy(page, "13-mobile-normal-390x844.png")

        # Warden on Mobile
        warden_btn = page.query_selector("button:has-text('Warden Standby')")
        if warden_btn:
            warden_btn.click()
            page.wait_for_timeout(2500)
        save_and_copy(page, "14-mobile-warden-390x844.png")

        context.close()
        browser.close()

    # Save results json
    results_path = os.path.join(OUT_DIR, "layout_permutation_metrics.json")
    with open(results_path, "w") as f:
        json.dump(results, f, indent=2)
    shutil.copy2(results_path, os.path.join(PARENT_BRAIN_DIR, "layout_permutation_metrics.json"))
    shutil.copy2(results_path, os.path.join(MY_BRAIN_DIR, "layout_permutation_metrics.json"))
    print("\nMetrics written successfully to:", results_path)

if __name__ == "__main__":
    run()
