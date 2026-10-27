import os
import sys
import time
import json
import shutil
from playwright.sync_api import sync_playwright

CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:3125")
OUT_DIR = "/Users/ayan/Vow-repo/.screenshots/review-round-2"
BRAIN_DIR = "/Users/ayan/.gemini/antigravity/brain/cb7472af-f833-4347-8c7d-3bda1652fff7"
MY_BRAIN_DIR = "/Users/ayan/.gemini/antigravity/brain/ad81b0ae-9c62-42d4-8aa0-eeb404b60c0a"

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(BRAIN_DIR, exist_ok=True)
os.makedirs(MY_BRAIN_DIR, exist_ok=True)

def run_qa_suite():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME_PATH,
            headless=True,
            args=["--disable-web-security", "--allow-running-insecure-content", "--no-sandbox"]
        )

        # 1. Normal Desktop 1024x640
        print("\n=== Testing Normal Desktop 1024x640 ===")
        context = browser.new_context(viewport={"width": 1024, "height": 640}, device_scale_factor=1)
        page = context.new_page()
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(1000)

        # DOM measurements
        normal_1024_eval = page.evaluate("""() => {
            const mascotEnv = document.querySelector('.vow-mascot-env');
            const mascotImg = document.querySelector('.vow-mascot-img');
            const platform = document.querySelector('.vow-platform');
            const glow = document.querySelector('.vow-mascot-glow');
            const tablet = document.querySelector('.vow-tablet');
            const browserPreview = document.querySelector('.vow-browser-preview');
            const cyberPreview = document.querySelector('.vow-preview');
            const report = document.querySelector('.vow-report');
            const composer = document.querySelector('.vow-composer');
            const topbar = document.querySelector('.vow-topbar');
            const wardenPill = document.querySelector('.vow-warden-pill');
            const scenicCorridor = document.querySelector('.vow-main');

            const mRect = mascotEnv ? mascotEnv.getBoundingClientRect() : null;
            const imgRect = mascotImg ? mascotImg.getBoundingClientRect() : null;
            const cRect = composer ? composer.getBoundingClientRect() : null;
            const compStyle = composer ? window.getComputedStyle(composer) : null;
            const bpRect = browserPreview ? browserPreview.getBoundingClientRect() : null;

            return {
                mascotEnvExists: !!mascotEnv,
                mascotImgExists: !!mascotImg,
                mascotSrc: mascotImg ? mascotImg.getAttribute('src') : null,
                mascotRect: mRect ? { x: mRect.x, y: mRect.y, width: mRect.width, height: mRect.height } : null,
                imgRect: imgRect ? { x: imgRect.x, y: imgRect.y, width: imgRect.width, height: imgRect.height } : null,
                platformExists: !!platform,
                glowExists: !!glow,
                fakeTabletExists: !!tablet,
                browserPreviewExists: !!browserPreview,
                cyberPreviewExists: !!cyberPreview,
                reportCardExists: !!report,
                wardenPillExists: !!wardenPill,
                composerBorderRadius: compStyle ? compStyle.borderRadius : null,
                composerBg: compStyle ? compStyle.backgroundColor : null,
                browserPreviewRect: bpRect ? { width: bpRect.width, height: bpRect.height } : null,
                browserPreviewText: browserPreview ? browserPreview.innerText : null
            };
        }""")
        results["normal_1024x640"] = normal_1024_eval
        print("Normal 1024x640 DOM Eval:", json.dumps(normal_1024_eval, indent=2))

        shot_1024_normal = os.path.join(OUT_DIR, "01-normal-1024x640.png")
        page.screenshot(path=shot_1024_normal)
        print(f"Captured: {shot_1024_normal}")

        # Click mascot to trigger playful hop and interactive speech bubble
        mascot_env = page.query_selector(".vow-mascot-env")
        if mascot_env:
            mascot_env.click()
            page.wait_for_timeout(300)
            shot_bubble_normal = os.path.join(OUT_DIR, "01b-normal-mascot-speech-bubble.png")
            page.screenshot(path=shot_bubble_normal)
            print(f"Captured mascot speech bubble: {shot_bubble_normal}")

        # Test sidebar collapse / focus mode
        collapse_btn = page.query_selector("button[aria-label='Collapse sidebar']")
        if collapse_btn:
            collapse_btn.click()
            page.wait_for_timeout(400)
            shot_focus = os.path.join(OUT_DIR, "01c-normal-desktop-focus-mode.png")
            page.screenshot(path=shot_focus)
            print(f"Captured focus mode: {shot_focus}")

            # Re-expand via Topbar button
            expand_btn = page.query_selector("button[aria-label='Toggle sidebar']")
            if expand_btn:
                expand_btn.click()
                page.wait_for_timeout(400)

        # Test Warden 7-step modal trigger from Topbar
        warden_btn = page.query_selector("button:has-text('Warden Standby')")
        if warden_btn:
            warden_btn.click()
            page.wait_for_timeout(700)
            shot_modal = os.path.join(OUT_DIR, "01d-warden-7step-transformation.png")
            page.screenshot(path=shot_modal)
            print(f"Captured 7-step modal: {shot_modal}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

        context.close()

        # 2. Normal Desktop 1440x900
        print("\n=== Testing Normal Desktop 1440x900 ===")
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = context.new_page()
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(1000)

        shot_1440_normal = os.path.join(OUT_DIR, "02-normal-1440x900.png")
        page.screenshot(path=shot_1440_normal)
        print(f"Captured: {shot_1440_normal}")

        # Check Tools dropdown menu
        tools_btn = page.query_selector("button:has-text('Tools')")
        if tools_btn:
            tools_btn.click()
            page.wait_for_timeout(500)
            shot_tools = os.path.join(OUT_DIR, "02b-normal-tools-dropdown.png")
            page.screenshot(path=shot_tools)
            print(f"Captured tools dropdown: {shot_tools}")

        # Check Deliverable modal preview if exists
        preview_btn = page.query_selector(".vow-report button:has-text('Preview')")
        if preview_btn:
            preview_btn.click()
            page.wait_for_timeout(500)
            shot_modal = os.path.join(OUT_DIR, "02c-normal-report-preview-modal.png")
            page.screenshot(path=shot_modal)
            print(f"Captured report preview modal: {shot_modal}")
            # close modal
            close_btn = page.query_selector(".vow-modal-close, button:has-text('Close')")
            if close_btn:
                close_btn.click()
                page.wait_for_timeout(300)

        context.close()

        # 3. Warden Desktop 1024x640
        print("\n=== Testing Warden Desktop 1024x640 ===")
        context = browser.new_context(viewport={"width": 1024, "height": 640}, device_scale_factor=1)
        page = context.new_page()
        page.goto(f"{BASE_URL}/?mode=warden", wait_until="networkidle")
        page.wait_for_timeout(600)
        # Dismiss transformation overlay if open
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

        warden_1024_eval = page.evaluate("""() => {
            const mascotEnv = document.querySelector('.vow-mascot-env');
            const mascotImg = document.querySelector('.vow-mascot-img');
            const platform = document.querySelector('.vow-platform');
            const glow = document.querySelector('.vow-mascot-glow');
            const tablet = document.querySelector('.vow-tablet');
            const browserPreview = document.querySelector('.vow-browser-preview');
            const cyberPreview = document.querySelector('.vow-preview');
            const wardenPill = document.querySelector('.vow-warden-pill');
            const wardenStatusCard = document.querySelector('.vow-monitor .bg-gradient-to-br');
            const crystal = document.querySelector('.vow-crystal');

            const mRect = mascotEnv ? mascotEnv.getBoundingClientRect() : null;
            const imgRect = mascotImg ? mascotImg.getBoundingClientRect() : null;

            return {
                mascotEnvExists: !!mascotEnv,
                mascotImgExists: !!mascotImg,
                mascotSrc: mascotImg ? mascotImg.getAttribute('src') : null,
                mascotRect: mRect ? { x: mRect.x, y: mRect.y, width: mRect.width, height: mRect.height } : null,
                imgRect: imgRect ? { x: imgRect.x, y: imgRect.y, width: imgRect.width, height: imgRect.height } : null,
                platformExists: !!platform,
                glowExists: !!glow,
                fakeTabletExists: !!tablet,
                browserPreviewExists: !!browserPreview,
                cyberPreviewExists: !!cyberPreview,
                cyberPreviewText: cyberPreview ? cyberPreview.innerText : null,
                wardenPillExists: !!wardenPill,
                wardenStatusCardExists: !!wardenStatusCard,
                wardenStatusCardText: wardenStatusCard ? wardenStatusCard.innerText : null,
                crystalExists: !!crystal
            };
        }""")
        results["warden_1024x640"] = warden_1024_eval
        print("Warden 1024x640 DOM Eval:", json.dumps(warden_1024_eval, indent=2))

        shot_1024_warden = os.path.join(OUT_DIR, "03-warden-1024x640.png")
        page.screenshot(path=shot_1024_warden)
        print(f"Captured: {shot_1024_warden}")

        # Click mascot to trigger Warden speech bubble
        mascot_env = page.query_selector(".vow-mascot-env")
        if mascot_env:
            mascot_env.click()
            page.wait_for_timeout(300)
            shot_bubble_warden = os.path.join(OUT_DIR, "03b-warden-mascot-speech-bubble.png")
            page.screenshot(path=shot_bubble_warden)
            print(f"Captured Warden mascot speech bubble: {shot_bubble_warden}")

        context.close()

        # 4. Warden Desktop 1440x900
        print("\n=== Testing Warden Desktop 1440x900 ===")
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = context.new_page()
        page.goto(f"{BASE_URL}/?mode=warden", wait_until="networkidle")
        page.wait_for_timeout(600)
        # Dismiss transformation overlay if open
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

        shot_1440_warden = os.path.join(OUT_DIR, "04-warden-1440x900.png")
        page.screenshot(path=shot_1440_warden)
        print(f"Captured: {shot_1440_warden}")
        context.close()

        # 5. Mobile 390x844 (Normal & Warden)
        print("\n=== Testing Mobile 390x844 (Normal) ===")
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        page = context.new_page()
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_timeout(1000)

        shot_mobile_normal = os.path.join(OUT_DIR, "05-mobile-normal-390x844.png")
        page.screenshot(path=shot_mobile_normal)
        print(f"Captured: {shot_mobile_normal}")

        print("\n=== Testing Mobile 390x844 (Warden) ===")
        page.goto(f"{BASE_URL}/?mode=warden", wait_until="networkidle")
        page.wait_for_timeout(600)
        # Dismiss transformation overlay if open
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

        shot_mobile_warden = os.path.join(OUT_DIR, "06-mobile-warden-390x844.png")
        page.screenshot(path=shot_mobile_warden)
        print(f"Captured: {shot_mobile_warden}")
        context.close()

        # 6. Sub-pages: /tasks, /memory, /routines, /tools (Normal & Warden)
        subpages = ["/tasks", "/memory", "/routines", "/tools"]
        for sp in subpages:
            print(f"\n=== Testing Subpage {sp} Normal 1440x900 ===")
            context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
            page = context.new_page()
            page.goto(f"{BASE_URL}{sp}", wait_until="networkidle")
            page.wait_for_timeout(800)

            sub_eval = page.evaluate("""() => {
                const env = document.querySelector('.vow-mascot-env');
                const img = document.querySelector('.vow-mascot-img');
                const tablet = document.querySelector('.vow-tablet');
                const content = document.querySelector('.vow-main') || document.querySelector('main');
                const envRect = env ? env.getBoundingClientRect() : null;
                const isMini = env ? env.classList.contains('mini') : false;
                return {
                    mascotEnvExists: !!env,
                    mascotImgExists: !!img,
                    isMini: isMini,
                    fakeTabletExists: !!tablet,
                    envRect: envRect ? { x: envRect.x, y: envRect.y, width: envRect.width, height: envRect.height } : null
                };
            }""")
            results[f"subpage_{sp.replace('/', '')}_normal"] = sub_eval
            print(f"Subpage {sp} Normal Eval:", json.dumps(sub_eval, indent=2))

            shot_sub = os.path.join(OUT_DIR, f"07-subpage-{sp.replace('/', '')}-normal.png")
            page.screenshot(path=shot_sub)
            print(f"Captured: {shot_sub}")

            # Also check subpage under Warden mode
            page.goto(f"{BASE_URL}{sp}?mode=warden", wait_until="networkidle")
            page.wait_for_timeout(800)
            shot_sub_warden = os.path.join(OUT_DIR, f"07-subpage-{sp.replace('/', '')}-warden.png")
            page.screenshot(path=shot_sub_warden)
            print(f"Captured: {shot_sub_warden}")

            context.close()

        browser.close()

    # Copy all captured screenshots to BRAIN_DIR and MY_BRAIN_DIR
    print("\n=== Copying screenshots to Brain directory ===")
    for fname in os.listdir(OUT_DIR):
        if fname.endswith(".png"):
            src_file = os.path.join(OUT_DIR, fname)
            dst_file = os.path.join(BRAIN_DIR, fname)
            shutil.copy2(src_file, dst_file)
            shutil.copy2(src_file, os.path.join(MY_BRAIN_DIR, fname))
            print(f"Copied {fname} to {dst_file}")

    # Write evaluation summary json
    summary_path = os.path.join(OUT_DIR, "dom_evaluation_results.json")
    with open(summary_path, "w") as f:
        json.dump(results, f, indent=2)
    shutil.copy2(summary_path, os.path.join(BRAIN_DIR, "dom_evaluation_results.json"))
    shutil.copy2(summary_path, os.path.join(MY_BRAIN_DIR, "dom_evaluation_results.json"))
    print(f"\nAll evaluations saved to {summary_path}")

if __name__ == "__main__":
    run_qa_suite()
