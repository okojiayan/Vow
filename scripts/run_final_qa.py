import os
import sys
import time
import json
import shutil
from playwright.sync_api import sync_playwright

CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE_URL = "http://127.0.0.1:3123"
OUT_DIR = "/Users/ayan/Vow-repo/.screenshots/review-round-final"
BRAIN_DIR = "/Users/ayan/.gemini/antigravity/brain/cb7472af-f833-4347-8c7d-3bda1652fff7"

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(BRAIN_DIR, exist_ok=True)

def run_final_qa():
    eval_results = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME_PATH,
            headless=True,
            args=["--disable-web-security", "--allow-running-insecure-content", "--no-sandbox"]
        )

        # -------------------------------------------------------------
        # 1. Normal Desktop 1024x640 & Living Mascot Interaction
        # -------------------------------------------------------------
        print("\n--- Testing 1: Normal Desktop 1024x640 ---")
        context = browser.new_context(viewport={"width": 1024, "height": 640}, device_scale_factor=1)
        page = context.new_page()
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(1000)

        dom_1024 = page.evaluate("""() => {
            const mascotEnv = document.querySelector('.vow-mascot-env');
            const mascotImg = document.querySelector('.vow-mascot-img');
            const tablet = document.querySelector('.vow-tablet');
            const normalBg = document.querySelector('.scene-bg-normal');
            const normalBgStyle = normalBg ? window.getComputedStyle(normalBg) : null;
            const mascotRect = mascotEnv ? mascotEnv.getBoundingClientRect() : null;
            const imgRect = mascotImg ? mascotImg.getBoundingClientRect() : null;
            const sidebar = document.querySelector('.vow-railcol');
            const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;
            const chips = document.querySelector('.vow-sugs');
            const chipsStyle = chips ? window.getComputedStyle(chips) : null;

            return {
                mascotEnvExists: !!mascotEnv,
                mascotImgExists: !!mascotImg,
                fakeTabletExists: !!tablet,
                mascotRect: mascotRect ? { x: mascotRect.x, y: mascotRect.y, width: mascotRect.width, height: mascotRect.height } : null,
                imgRect: imgRect ? { x: imgRect.x, y: imgRect.y, width: imgRect.width, height: imgRect.height } : null,
                sidebarWidth: sidebarRect ? sidebarRect.width : null,
                bgNormalColor: normalBgStyle ? normalBgStyle.backgroundColor : null,
                bgNormalOpacity: normalBgStyle ? normalBgStyle.opacity : null,
                chipsFlexWrap: chipsStyle ? chipsStyle.flexWrap : null
            };
        }""")
        eval_results["normal_1024x640"] = dom_1024
        print("DOM 1024 Normal Eval:", json.dumps(dom_1024, indent=2))

        shot_01 = os.path.join(OUT_DIR, "01-normal-1024x640.png")
        page.screenshot(path=shot_01)
        shutil.copy2(shot_01, os.path.join(BRAIN_DIR, "01-normal-1024x640.png"))
        print(f"Captured: {shot_01}")

        # -------------------------------------------------------------
        # 1b. Mascot Click & Speech Bubble
        # -------------------------------------------------------------
        print("\n--- Testing 1b: Mascot Click & Speech Bubble ---")
        page.locator(".vow-mascot-env").click()
        page.wait_for_timeout(400)

        bubble_eval = page.evaluate("""() => {
            const bubble = document.querySelector('.vow-speech-bubble');
            const env = document.querySelector('.vow-mascot-env');
            return {
                bubbleExists: !!bubble,
                bubbleText: bubble ? bubble.innerText.trim() : null,
                isHopping: env ? env.classList.contains('hopping') : false
            };
        }""")
        eval_results["normal_mascot_interaction"] = bubble_eval
        print("Mascot Interaction Eval:", json.dumps(bubble_eval, indent=2))

        shot_01b = os.path.join(OUT_DIR, "01b-normal-mascot-speech-bubble.png")
        page.screenshot(path=shot_01b)
        shutil.copy2(shot_01b, os.path.join(BRAIN_DIR, "01b-normal-mascot-speech-bubble.png"))
        print(f"Captured: {shot_01b}")

        # Dismiss speech bubble
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # -------------------------------------------------------------
        # 1c. Desktop Sidebar Focus Mode (Collapsed)
        # -------------------------------------------------------------
        print("\n--- Testing 1c: Desktop Sidebar Focus Mode ---")
        toggle_btn = page.locator("button[title*='Toggle sidebar'], button[aria-label='Toggle sidebar']").first
        toggle_btn.click()
        page.wait_for_timeout(500)

        focus_eval = page.evaluate("""() => {
            const app = document.querySelector('#vow-app');
            const railcol = document.querySelector('.vow-railcol');
            const railRect = railcol ? railcol.getBoundingClientRect() : null;
            const main = document.querySelector('.vow-main');
            const mainRect = main ? main.getBoundingClientRect() : null;
            const sidebarOpen = app ? app.classList.contains('sidebar-open') : false;

            return {
                sidebarOpen: sidebarOpen,
                railWidth: railRect ? railRect.width : null,
                mainLeft: mainRect ? mainRect.x : null,
                mainWidth: mainRect ? mainRect.width : null
            };
        }""")
        eval_results["focus_mode_sidebar_collapse"] = focus_eval
        print("Focus Mode Eval:", json.dumps(focus_eval, indent=2))

        shot_01c = os.path.join(OUT_DIR, "01c-normal-desktop-focus-mode.png")
        page.screenshot(path=shot_01c)
        shutil.copy2(shot_01c, os.path.join(BRAIN_DIR, "01c-normal-desktop-focus-mode.png"))
        print(f"Captured: {shot_01c}")

        context.close()

        # -------------------------------------------------------------
        # 2. Normal Desktop 1440x900 & Interactive Modals
        # -------------------------------------------------------------
        print("\n--- Testing 2: Normal Desktop 1440x900 ---")
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = context.new_page()
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(1000)

        shot_02 = os.path.join(OUT_DIR, "02-normal-1440x900.png")
        page.screenshot(path=shot_02)
        shutil.copy2(shot_02, os.path.join(BRAIN_DIR, "02-normal-1440x900.png"))
        print(f"Captured: {shot_02}")

        # Tools Dropdown
        tools_btn = page.query_selector("button:has-text('Tools')")
        if tools_btn:
            tools_btn.click()
            page.wait_for_timeout(400)
            shot_02b = os.path.join(OUT_DIR, "02b-normal-tools-dropdown.png")
            page.screenshot(path=shot_02b)
            shutil.copy2(shot_02b, os.path.join(BRAIN_DIR, "02b-normal-tools-dropdown.png"))
            print(f"Captured: {shot_02b}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

        # Deliverable Preview Modal
        preview_btn = page.query_selector(".vow-report button:has-text('Preview')")
        if preview_btn:
            preview_btn.click()
            page.wait_for_timeout(400)
            shot_02c = os.path.join(OUT_DIR, "02c-normal-report-preview-modal.png")
            page.screenshot(path=shot_02c)
            shutil.copy2(shot_02c, os.path.join(BRAIN_DIR, "02c-normal-report-preview-modal.png"))
            print(f"Captured: {shot_02c}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

        context.close()

        # -------------------------------------------------------------
        # 3. Warden 7-Step Transformation Modal
        # -------------------------------------------------------------
        print("\n--- Testing 3: Warden 7-Step Transformation Modal ---")
        context = browser.new_context(viewport={"width": 1024, "height": 640}, device_scale_factor=1)
        page = context.new_page()
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(800)

        # Click the Warden activation button in the Topbar to trigger modal
        warden_btn = page.locator("button[title*='Warden'], button[title*='7-step']").first
        warden_btn.click()
        page.wait_for_timeout(800)

        modal_eval = page.evaluate("""() => {
            const modal = document.querySelector('.vow-transform-overlay') || document.querySelector('[role=\"dialog\"]') || document.querySelector('.fixed.inset-0');
            const title = document.querySelector('h3, h2, .vow-transform-title');
            return {
                modalExists: !!modal,
                titleText: title ? title.innerText : null
            };
        }""")
        eval_results["warden_transformation_modal"] = modal_eval
        print("Transformation Modal Eval:", json.dumps(modal_eval, indent=2))

        shot_03c = os.path.join(OUT_DIR, "03c-warden-transformation-modal.png")
        page.screenshot(path=shot_03c)
        shutil.copy2(shot_03c, os.path.join(BRAIN_DIR, "03c-warden-transformation-modal.png"))
        print(f"Captured: {shot_03c}")

        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        context.close()

        # -------------------------------------------------------------
        # 4. Warden Desktop 1024x640 & Speech Bubble
        # -------------------------------------------------------------
        print("\n--- Testing 4: Warden Desktop 1024x640 ---")
        context = browser.new_context(viewport={"width": 1024, "height": 640}, device_scale_factor=1)
        page = context.new_page()
        page.goto(f"{BASE_URL}/?mode=warden", wait_until="networkidle")
        page.wait_for_timeout(500)
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)

        warden_dom_1024 = page.evaluate("""() => {
            const mascotEnv = document.querySelector('.vow-mascot-env');
            const mascotImg = document.querySelector('.vow-mascot-img');
            const wardenCircle = document.querySelector('.vow-warden-circle');
            const crystal = document.querySelector('.vow-crystal');
            const pill = document.querySelector('.bg-gradient-to-r.from-purple-600');
            const wardenBg = document.querySelector('.scene-bg-warden');
            const bgStyle = wardenBg ? window.getComputedStyle(wardenBg) : null;
            const mascotRect = mascotEnv ? mascotEnv.getBoundingClientRect() : null;

            return {
                mascotEnvExists: !!mascotEnv,
                mascotImgExists: !!mascotImg,
                wardenCircleExists: !!wardenCircle,
                crystalExists: !!crystal,
                wardenPillExists: !!pill,
                bgWardenColor: bgStyle ? bgStyle.backgroundColor : null,
                bgWardenOpacity: bgStyle ? bgStyle.opacity : null,
                mascotRect: mascotRect ? { x: mascotRect.x, y: mascotRect.y, width: mascotRect.width, height: mascotRect.height } : null
            };
        }""")
        eval_results["warden_1024x640"] = warden_dom_1024
        print("Warden DOM 1024 Eval:", json.dumps(warden_dom_1024, indent=2))

        shot_03 = os.path.join(OUT_DIR, "03-warden-1024x640.png")
        page.screenshot(path=shot_03)
        shutil.copy2(shot_03, os.path.join(BRAIN_DIR, "03-warden-1024x640.png"))
        print(f"Captured: {shot_03}")

        # Warden speech bubble
        print("\n--- Testing 4b: Warden Mascot Click & Speech Bubble ---")
        page.locator(".vow-mascot-env").click()
        page.wait_for_timeout(400)

        warden_bubble_eval = page.evaluate("""() => {
            const bubble = document.querySelector('.vow-speech-bubble');
            return {
                bubbleExists: !!bubble,
                bubbleText: bubble ? bubble.innerText.trim() : null
            };
        }""")
        eval_results["warden_mascot_interaction"] = warden_bubble_eval
        print("Warden Mascot Interaction Eval:", json.dumps(warden_bubble_eval, indent=2))

        shot_03b = os.path.join(OUT_DIR, "03b-warden-mascot-speech-bubble.png")
        page.screenshot(path=shot_03b)
        shutil.copy2(shot_03b, os.path.join(BRAIN_DIR, "03b-warden-mascot-speech-bubble.png"))
        print(f"Captured: {shot_03b}")

        context.close()

        # -------------------------------------------------------------
        # 5. Warden Desktop 1440x900
        # -------------------------------------------------------------
        print("\n--- Testing 5: Warden Desktop 1440x900 ---")
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = context.new_page()
        page.goto(f"{BASE_URL}/?mode=warden", wait_until="networkidle")
        page.wait_for_timeout(500)
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)

        shot_04 = os.path.join(OUT_DIR, "04-warden-1440x900.png")
        page.screenshot(path=shot_04)
        shutil.copy2(shot_04, os.path.join(BRAIN_DIR, "04-warden-1440x900.png"))
        print(f"Captured: {shot_04}")
        context.close()

        # -------------------------------------------------------------
        # 6. Mobile 390x844 (Normal & Warden)
        # -------------------------------------------------------------
        print("\n--- Testing 6: Mobile 390x844 Normal & Warden ---")
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        page = context.new_page()
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(800)

        shot_05 = os.path.join(OUT_DIR, "05-mobile-normal-390x844.png")
        page.screenshot(path=shot_05)
        shutil.copy2(shot_05, os.path.join(BRAIN_DIR, "05-mobile-normal-390x844.png"))
        print(f"Captured: {shot_05}")

        page.goto(f"{BASE_URL}/?mode=warden", wait_until="networkidle")
        page.wait_for_timeout(500)
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)

        shot_06 = os.path.join(OUT_DIR, "06-mobile-warden-390x844.png")
        page.screenshot(path=shot_06)
        shutil.copy2(shot_06, os.path.join(BRAIN_DIR, "06-mobile-warden-390x844.png"))
        print(f"Captured: {shot_06}")
        context.close()

        browser.close()

    summary_file = os.path.join(OUT_DIR, "final_qa_results.json")
    with open(summary_file, "w") as f:
        json.dump(eval_results, f, indent=2)
    shutil.copy2(summary_file, os.path.join(BRAIN_DIR, "final_qa_results.json"))
    print(f"\nFinal QA suite complete! Results saved to {summary_file}")

if __name__ == "__main__":
    run_final_qa()
