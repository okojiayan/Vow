import os
import sys
import time
import json
from playwright.sync_api import sync_playwright

CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:3125")
OUT_DIR = "/Users/ayan/Vow-repo/.screenshots/review-round-2"
BRAIN_DIR = "/Users/ayan/.gemini/antigravity/brain/cb7472af-f833-4347-8c7d-3bda1652fff7"
MY_BRAIN_DIR = "/Users/ayan/.gemini/antigravity/brain/ad81b0ae-9c62-42d4-8aa0-eeb404b60c0a"

os.makedirs(OUT_DIR, exist_ok=True)

def measure_layout(page, state_name):
    return page.evaluate("""(state) => {
        const app = document.querySelector('.vow-app');
        const main = document.querySelector('.vow-main');
        const rail = document.querySelector('.vow-railcol');
        const task = document.querySelector('.vow-taskcol');
        const col = document.querySelector('.vow-col');
        const mascot = document.querySelector('.vow-mascot-env');

        const appRect = app ? app.getBoundingClientRect() : null;
        const mainRect = main ? main.getBoundingClientRect() : null;
        const railRect = rail ? rail.getBoundingClientRect() : null;
        const taskRect = task ? task.getBoundingClientRect() : null;
        const colRect = col ? col.getBoundingClientRect() : null;
        const mascotRect = mascot ? mascot.getBoundingClientRect() : null;
        const mascotStyle = mascot ? window.getComputedStyle(mascot) : null;

        return {
            state,
            viewportWidth: window.innerWidth,
            appRect: appRect ? { x: appRect.x, width: appRect.width, right: appRect.right } : null,
            mainRect: mainRect ? { x: mainRect.x, width: mainRect.width, right: mainRect.right } : null,
            railRect: railRect ? { x: railRect.x, width: railRect.width } : null,
            taskRect: taskRect ? { x: taskRect.x, width: taskRect.width, right: taskRect.right } : null,
            colRect: colRect ? { x: colRect.x, width: colRect.width, right: colRect.right } : null,
            mascot: mascot ? {
                x: mascotRect.x,
                width: mascotRect.width,
                opacity: mascotStyle ? mascotStyle.opacity : null,
                pointerEvents: mascotStyle ? mascotStyle.pointerEvents : null,
                display: mascotStyle ? mascotStyle.display : null
            } : null
        };
    }""", state_name)

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME_PATH,
            headless=True,
            args=["--disable-web-security", "--allow-running-insecure-content", "--no-sandbox"]
        )

        # Test at 1440x900
        print("\n=== Testing Fluid States at 1440x900 ===")
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(1000)

        # State 1: Default (Sidebar Open, Monitor Open)
        s1 = measure_layout(page, "State 1: Sidebar Open + Monitor Open")
        print("State 1:", json.dumps(s1, indent=2))
        shot_s1 = os.path.join(OUT_DIR, "10-fluid-state1-sidebar-open-monitor-open.png")
        page.screenshot(path=shot_s1)

        # State 2: Close Monitor (Monitor button in Topbar)
        monitor_btn = page.query_selector("button:has-text('Monitor')")
        if monitor_btn:
            monitor_btn.click()
            page.wait_for_timeout(500)
        s2 = measure_layout(page, "State 2: Sidebar Open + Monitor Closed")
        print("State 2:", json.dumps(s2, indent=2))
        shot_s2 = os.path.join(OUT_DIR, "11-fluid-state2-sidebar-open-monitor-closed.png")
        page.screenshot(path=shot_s2)

        # Re-open monitor
        if monitor_btn:
            monitor_btn.click()
            page.wait_for_timeout(500)

        # State 3: Close Sidebar (Sidebar button in Topbar or sidebar collapse)
        sidebar_btn = page.query_selector("button[aria-label='Toggle sidebar']")
        if sidebar_btn:
            sidebar_btn.click()
            page.wait_for_timeout(500)
        s3 = measure_layout(page, "State 3: Sidebar Closed + Monitor Open")
        print("State 3:", json.dumps(s3, indent=2))
        shot_s3 = os.path.join(OUT_DIR, "12-fluid-state3-sidebar-closed-monitor-open.png")
        page.screenshot(path=shot_s3)

        # State 4: Both Closed (Focus Mode)
        if monitor_btn:
            monitor_btn.click()
            page.wait_for_timeout(500)
        s4 = measure_layout(page, "State 4: Sidebar Closed + Monitor Closed (Focus Mode)")
        print("State 4:", json.dumps(s4, indent=2))
        shot_s4 = os.path.join(OUT_DIR, "13-fluid-state4-full-focus-both-closed.png")
        page.screenshot(path=shot_s4)

        context.close()

        # Also test at 1024x640
        print("\n=== Testing Fluid States at 1024x640 ===")
        context = browser.new_context(viewport={"width": 1024, "height": 640})
        page = context.new_page()
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(1000)

        s1_1024 = measure_layout(page, "1024 State 1: Default")
        print("1024 State 1:", json.dumps(s1_1024, indent=2))
        page.screenshot(path=os.path.join(OUT_DIR, "01-normal-1024x640.png"))

        # Close Monitor at 1024
        monitor_btn = page.query_selector("button:has-text('Monitor')")
        if monitor_btn:
            monitor_btn.click()
            page.wait_for_timeout(500)
        s2_1024 = measure_layout(page, "1024 State 2: Monitor Closed")
        print("1024 State 2:", json.dumps(s2_1024, indent=2))
        page.screenshot(path=os.path.join(OUT_DIR, "14-fluid-1024-monitor-closed.png"))

        # Re-open monitor
        if monitor_btn:
            monitor_btn.click()
            page.wait_for_timeout(500)

        # Close Sidebar at 1024
        sidebar_btn = page.query_selector("button[aria-label='Toggle sidebar']")
        if sidebar_btn:
            sidebar_btn.click()
            page.wait_for_timeout(500)
        s3_1024 = measure_layout(page, "1024 State 3: Sidebar Closed")
        print("1024 State 3:", json.dumps(s3_1024, indent=2))
        page.screenshot(path=os.path.join(OUT_DIR, "15-fluid-1024-sidebar-closed.png"))

        # Both Closed at 1024
        if monitor_btn:
            monitor_btn.click()
            page.wait_for_timeout(500)
        s4_1024 = measure_layout(page, "1024 State 4: Both Closed (Focus)")
        print("1024 State 4:", json.dumps(s4_1024, indent=2))
        page.screenshot(path=os.path.join(OUT_DIR, "16-fluid-1024-focus-both-closed.png"))

        context.close()
        browser.close()

if __name__ == "__main__":
    run()
