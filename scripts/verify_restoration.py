import os
import sys
import json
import time
from playwright.sync_api import sync_playwright

CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE_URL = "http://127.0.0.1:3125"
OUT_DIR = "/Users/ayan/Vow-repo/.screenshots/restoration-audit"
BRAIN_DIR = "/Users/ayan/.gemini/antigravity/brain/cb7472af-f833-4347-8c7d-3bda1652fff7"

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(BRAIN_DIR, exist_ok=True)

def run_audit():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME_PATH,
            headless=True,
            args=["--disable-web-security", "--allow-running-insecure-content", "--no-sandbox"]
        )

        # 1. Desktop Standard 1440x900 - Home View
        print("\n=== 1. Desktop Standard 1440x900 - Home ===")
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(800)

        # Check Home Layout
        home_metrics = page.evaluate("""() => {
            const app = document.querySelector('#vow-app');
            const rail = document.querySelector('.vow-railcol');
            const main = document.querySelector('.vow-main');
            const task = document.querySelector('#vow-taskcol');
            const mascot = document.querySelector('.vow-mascot-env');
            const pageScroll = document.querySelector('.page-scroll');
            const normalBg = document.querySelector('.scene-bg-normal');
            return {
                appGrid: window.getComputedStyle(app).gridTemplateColumns,
                railWidth: rail ? rail.getBoundingClientRect().width : null,
                mainWidth: main ? main.getBoundingClientRect().width : null,
                mainX: main ? main.getBoundingClientRect().x : null,
                taskWidth: task ? task.getBoundingClientRect().width : null,
                mascotVisible: mascot ? (window.getComputedStyle(mascot).display !== 'none' && window.getComputedStyle(mascot).opacity !== '0') : false,
                mascotX: mascot ? mascot.getBoundingClientRect().x : null,
                bgNormalDisplay: normalBg ? window.getComputedStyle(normalBg).display : null,
            };
        }""")
        results["home_1440x900"] = home_metrics
        print("Home metrics:", json.dumps(home_metrics, indent=2))
        shot_01 = os.path.join(OUT_DIR, "01-restoration-home-1440x900.png")
        page.screenshot(path=shot_01)

        # 2. Test Escape key does NOT close sidebar
        print("\n=== 2. Test Escape Key on Desktop ===")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        escape_metrics = page.evaluate("""() => {
            const app = document.querySelector('#vow-app');
            const rail = document.querySelector('.vow-railcol');
            return {
                sidebarOpen: app.classList.contains('sidebar-open'),
                railWidth: rail ? rail.getBoundingClientRect().width : null,
            };
        }""")
        results["escape_test"] = escape_metrics
        print("Escape test (sidebar should remain open):", json.dumps(escape_metrics, indent=2))

        # 3. Test Monitor Toggle button in Topbar
        print("\n=== 3. Test Monitor Toggle in Topbar ===")
        monitor_btn = page.locator("button[title*='Live Monitor'], button[aria-label*='Live Monitor']").first
        monitor_btn.click()
        page.wait_for_timeout(500)
        monitor_closed_metrics = page.evaluate("""() => {
            const app = document.querySelector('#vow-app');
            const main = document.querySelector('.vow-main');
            const task = document.querySelector('#vow-taskcol');
            return {
                taskOpen: app.classList.contains('task-open'),
                mainWidth: main ? main.getBoundingClientRect().width : null,
                taskWidth: task ? task.getBoundingClientRect().width : null,
            };
        }""")
        results["monitor_closed"] = monitor_closed_metrics
        print("Monitor closed metrics (main should expand to right):", json.dumps(monitor_closed_metrics, indent=2))
        shot_02 = os.path.join(OUT_DIR, "02-restoration-monitor-closed-1440x900.png")
        page.screenshot(path=shot_02)

        # Reopen monitor
        monitor_btn.click()
        page.wait_for_timeout(400)

        # 4. Test Sidebar Toggle in Topbar
        print("\n=== 4. Test Sidebar Toggle in Topbar ===")
        sidebar_btn = page.locator("button[title*='Toggle sidebar'], button[aria-label*='Toggle sidebar']").first
        sidebar_btn.click()
        page.wait_for_timeout(500)
        sidebar_closed_metrics = page.evaluate("""() => {
            const app = document.querySelector('#vow-app');
            const main = document.querySelector('.vow-main');
            const mascot = document.querySelector('.vow-mascot-env');
            return {
                sidebarOpen: app.classList.contains('sidebar-open'),
                mainWidth: main ? main.getBoundingClientRect().width : null,
                mainX: main ? main.getBoundingClientRect().x : null,
                mascotOpacity: mascot ? window.getComputedStyle(mascot).opacity : null,
                mascotPointerEvents: mascot ? window.getComputedStyle(mascot).pointerEvents : null,
            };
        }""")
        results["sidebar_closed"] = sidebar_closed_metrics
        print("Sidebar closed metrics (main expands left, mascot fades out):", json.dumps(sidebar_closed_metrics, indent=2))
        shot_03 = os.path.join(OUT_DIR, "03-restoration-sidebar-closed-1440x900.png")
        page.screenshot(path=shot_03)

        # Reopen sidebar
        sidebar_btn.click()
        page.wait_for_timeout(400)

        # 5. Test Deliverable Report Modal if present
        print("\n=== 5. Test Deliverable Report Modal ===")
        doc_btn = page.query_selector("button:has-text('AI Agent Frameworks Analysis Report'), .vow-deliverable")
        if doc_btn:
            doc_btn.click()
            page.wait_for_timeout(400)
            modal_metrics = page.evaluate("""() => {
                const dialog = document.querySelector('[role=\"dialog\"]');
                const card = dialog ? dialog.querySelector('.vow-panel') : null;
                return {
                    dialogExists: !!dialog,
                    dialogZIndex: dialog ? window.getComputedStyle(dialog).zIndex : null,
                    cardWidth: card ? card.getBoundingClientRect().width : null,
                };
            }""")
            results["report_modal"] = modal_metrics
            print("Report modal metrics:", json.dumps(modal_metrics, indent=2))
            shot_04 = os.path.join(OUT_DIR, "04-restoration-report-modal.png")
            page.screenshot(path=shot_04)
            # Dismiss modal
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
        else:
            print("No deliverable button on clean home load; skipping.")

        # 6. Test Navigation across Routes (Tasks, Memory, Routines, Tools, Settings)
        subpages = ["/tasks", "/memory", "/routines", "/tools", "/settings"]
        for sp in subpages:
            print(f"\n=== Testing Subpage: {sp} ===")
            page.goto(f"{BASE_URL}{sp}", wait_until="networkidle")
            page.wait_for_timeout(500)
            sp_metrics = page.evaluate("""() => {
                const main = document.querySelector('.vow-main');
                const pageScroll = document.querySelector('.page-scroll');
                const mascot = document.querySelector('.vow-mascot-env');
                return {
                    mainWidth: main ? main.getBoundingClientRect().width : null,
                    pageScrollWidth: pageScroll ? pageScroll.getBoundingClientRect().width : null,
                    pageScrollMargin: pageScroll ? window.getComputedStyle(pageScroll).margin : null,
                    pageScrollBg: pageScroll ? window.getComputedStyle(pageScroll).backgroundColor : null,
                    mascotMounted: !!mascot,
                };
            }""")
            clean_name = sp.replace('/', '')
            results[f"subpage_{clean_name}"] = sp_metrics
            print(f"Subpage {sp} metrics:", json.dumps(sp_metrics, indent=2))
            shot_sp = os.path.join(OUT_DIR, f"05-restoration-subpage-{clean_name}.png")
            page.screenshot(path=shot_sp)

        # 7. Test Subpage Modals (e.g. Memory Add Modal)
        print("\n=== 7. Test Memory Add Modal ===")
        page.goto(f"{BASE_URL}/memory", wait_until="networkidle")
        page.wait_for_timeout(400)
        add_btn = page.locator("button:has-text('Add Memory')").first
        if add_btn:
            add_btn.click()
            page.wait_for_timeout(400)
            mem_modal_metrics = page.evaluate("""() => {
                const dialog = document.querySelector('[role=\"dialog\"]');
                const card = dialog ? dialog.querySelector('.vow-panel') : null;
                return {
                    dialogExists: !!dialog,
                    dialogZIndex: dialog ? window.getComputedStyle(dialog).zIndex : null,
                    cardWidth: card ? card.getBoundingClientRect().width : null,
                };
            }""")
            results["memory_modal"] = mem_modal_metrics
            print("Memory modal metrics:", json.dumps(mem_modal_metrics, indent=2))
            shot_06 = os.path.join(OUT_DIR, "06-restoration-memory-modal.png")
            page.screenshot(path=shot_06)
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

        # 8. Test Native Reference Viewport (1024x640)
        print("\n=== 8. Test Native Reference Viewport 1024x640 ===")
        page.set_viewport_size({"width": 1024, "height": 640})
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(500)
        shot_07 = os.path.join(OUT_DIR, "07-restoration-home-1024x640.png")
        page.screenshot(path=shot_07)

        # 9. Test Mobile Viewport (390x844)
        print("\n=== 9. Test Mobile Viewport 390x844 ===")
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(500)
        shot_08 = os.path.join(OUT_DIR, "08-restoration-home-mobile-390x844.png")
        page.screenshot(path=shot_08)

        # 10. Test Warden Mode Desktop
        print("\n=== 10. Test Warden Mode Desktop ===")
        page.set_viewport_size({"width": 1440, "height": 900})
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(500)
        warden_btn = page.locator("button:has-text('Warden Standby')").first
        if warden_btn:
            warden_btn.click()
            page.wait_for_timeout(500)
            shot_09 = os.path.join(OUT_DIR, "09-restoration-warden-modal.png")
            page.screenshot(path=shot_09)
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)
            shot_10 = os.path.join(OUT_DIR, "10-restoration-warden-desktop-1440x900.png")
            page.screenshot(path=shot_10)

        browser.close()

    # Save metrics
    with open(os.path.join(BRAIN_DIR, "restoration_metrics.json"), "w") as f:
        json.dump(results, f, indent=2)

    print("\n=== AUDIT COMPLETE. All metrics written to restoration_metrics.json ===")

if __name__ == "__main__":
    run_audit()
