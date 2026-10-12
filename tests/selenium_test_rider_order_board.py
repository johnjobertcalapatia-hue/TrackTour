# -*- coding: utf-8 -*-
"""Selenium browser E2E for the Rider Order Board (read model + accordion UI).

Covers the rider-facing race the API tests cannot prove in a real browser:

  1. two riders sign in (separate browser sessions)
  2. both boards discover the SAME open delivery
  3. Rider A accepts it
  4. Rider B sees the read-only "Accepted by another rider" state and cannot claim it
  5. Rider B refreshes / reconnects and the board recovers via HTTP polling
  6. (integrity) no duplicate assignment / purchasing-cash records were created

Scope note — step 6 of the review checklist (drive the FULL COD lifecycle:
purchasing cash -> every restaurant pickup -> delivery -> settlement through the
UI) is NOT automated here. Those transitions span the admin and business-owner
UIs and are already covered at the API level by
`PurchasingCashFlowTest::test_end_to_end_multi_restaurant_cod_purchasing_flow_to_settlement`.
This script asserts the rider-side acceptance and the resulting COD
purchasing-cash initialization (exactly one stop, reconciling to the settlement
base) via `seed_rider_board_e2e.php --verify`.

Prereqs:
  - Backend + frontend running, reachable at TRACKTOUR_E2E_BASE_URL
    (default http://localhost:3000).
  - Python: `pip install selenium`; Chrome installed.

Run:
  python tests/selenium_test_rider_order_board.py
Env:
  TRACKTOUR_E2E_BASE_URL   default http://localhost:3000
  E2E_KEEP_FIXTURE=1       do not --clean the seeded fixture on exit
"""
import json
import os
import subprocess
import sys
import time

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BASE_URL = os.environ.get("TRACKTOUR_E2E_BASE_URL", "http://localhost:3000")
SEED_SCRIPT = os.path.join("tests", "seed_rider_board_e2e.php")
PASSWORD = "Password123!"


def log(msg):
    print(f"[INFO] {msg}", flush=True)


def ok(msg):
    print(f"[PASS] {msg}", flush=True)


def fail(msg):
    print(f"[FAIL] {msg}", flush=True)


def php(*args):
    return subprocess.run(
        ["php", SEED_SCRIPT, *args],
        capture_output=True, text=True, timeout=60, cwd=PROJECT_ROOT,
    )


def parse_seed_json(stdout):
    for line in stdout.splitlines():
        if line.startswith("SEED_JSON:"):
            return json.loads(line[len("SEED_JSON:"):])
    return None


def seed_fixture():
    result = php()
    payload = parse_seed_json(result.stdout)
    if not payload or payload.get("type") != "seeded":
        fail(f"Seed failed. stdout={result.stdout!r} stderr={result.stderr!r}")
        sys.exit(1)
    ok(f"Seeded delivery #{payload['delivery_id']} offered to riders "
       f"{payload['rider_a_id']} / {payload['rider_b_id']}")
    return payload


def clean_fixture():
    php("--clean")
    log("Fixture cleaned")


def verify_integrity():
    result = php("--verify")
    payload = parse_seed_json(result.stdout)
    if not payload:
        fail(f"Integrity verify produced no JSON. stdout={result.stdout!r} stderr={result.stderr!r}")
        return False
    if payload.get("ok"):
        ok(
            "Integrity OK: one assignment, one accepted log, no pending offers, "
            f"one COD purchase ({payload['cod_purchase_sum']} == base {payload['cod_settlement_base']})"
        )
        return True
    fail(f"Integrity FAILED: {payload}")
    return False


def make_driver():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=430,932")  # mobile-ish rider viewport
    driver = webdriver.Chrome(options=options)
    driver.set_page_load_timeout(30)
    return driver


def login(driver, email):
    driver.get(f"{BASE_URL}/login")
    WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.ID, "email")))
    driver.find_element(By.ID, "email").clear()
    driver.find_element(By.ID, "email").send_keys(email)
    driver.find_element(By.ID, "password").clear()
    driver.find_element(By.ID, "password").send_keys(PASSWORD)
    driver.find_element(By.XPATH, "//button[@type='submit']").click()
    # Rider lands on the rider area.
    WebDriverWait(driver, 25).until(lambda d: "/rider" in d.current_url)
    log(f"Logged in as {email} -> {driver.current_url}")


def js_click(driver, element):
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", element)
    time.sleep(0.2)
    driver.execute_script("arguments[0].click();", element)


def open_order_sheet(driver):
    """Expand the floating 'Order details' sheet (idempotent)."""
    # Already expanded?
    if driver.find_elements(By.XPATH, "//button[@aria-label='Hide order details']"):
        return
    btn = WebDriverWait(driver, 25).until(
        EC.presence_of_element_located((By.XPATH, "//button[@aria-label='Show order details']"))
    )
    js_click(driver, btn)
    WebDriverWait(driver, 10).until(
        lambda d: d.find_elements(By.XPATH, "//button[@aria-label='Hide order details']")
    )
    log("Opened the Order details sheet")


def board_is_visible(driver):
    return bool(driver.find_elements(By.XPATH, "//*[normalize-space(text())='Available orders']"))


def has_accepted_by_other(driver):
    return bool(driver.find_elements(By.XPATH, "//*[contains(normalize-space(.), 'Accepted by another rider')]"))


def actionable_card_header(driver):
    """The button whose text contains 'Looking for riders'."""
    els = driver.find_elements(By.XPATH, "//button[contains(normalize-space(.), 'Looking for riders')]")
    return els[0] if els else None


def order_number_present(driver, number):
    return bool(driver.find_elements(By.XPATH, f"//*[contains(normalize-space(.), '#{number}')]"))


def accept_button(driver):
    els = driver.find_elements(By.XPATH, "//button[normalize-space()='Accept order']")
    return els[0] if els else None


def error_banner_text(driver):
    els = driver.find_elements(By.XPATH, "//p[contains(@class,'text-red-700')]")
    return els[0].text.strip() if els else None


def detect_and_confirm(driver, email, order_number):
    """Both riders reach the board and see the same actionable delivery."""
    login(driver, email)
    driver.get(f"{BASE_URL}/rider/map")
    WebDriverWait(driver, 25).until(
        lambda d: d.find_elements(By.XPATH, "//button[@aria-label='Show order details']")
        or d.find_elements(By.XPATH, "//button[@aria-label='Hide order details']")
    )
    open_order_sheet(driver)

    WebDriverWait(driver, 20).until(lambda d: board_is_visible(d) and actionable_card_header(d))
    if not order_number_present(driver, order_number):
        fail(f"{email} board does not show #{order_number}")
        return False
    ok(f"{email} discovered #{order_number} as actionable ('Looking for riders')")
    return True


def run():
    payload = seed_fixture()
    order_number = payload["order_number"]
    rider_a = payload["rider_a_email"]
    rider_b = payload["rider_b_email"]

    driver_a = make_driver()
    driver_b = make_driver()
    all_ok = True

    try:
        # --- Steps 1 & 2: both riders discover the same delivery ---
        if not detect_and_confirm(driver_a, rider_a, order_number):
            all_ok = False
        if not detect_and_confirm(driver_b, rider_b, order_number):
            all_ok = False

        # --- Step 3: Rider A accepts ---
        header = actionable_card_header(driver_a)
        js_click(driver_a, header)  # expand the nested restaurant/item detail
        WebDriverWait(driver_a, 10).until(lambda d: accept_button(d))
        js_click(driver_a, accept_button(driver_a))
        log("Rider A clicked 'Accept order'")

        # Accept succeeds when the actionable card disappears and no error shows.
        WebDriverWait(driver_a, 20).until(lambda d: accept_button(d) is None)
        if error_banner_text(driver_a):
            fail(f"Rider A saw an error after accept: {error_banner_text(driver_a)}")
            all_ok = False
        else:
            ok("Rider A accepted the delivery (actionable card cleared)")

        # --- Step 4: Rider B now sees it as read-only ---
        WebDriverWait(driver_b, 25).until(lambda d: has_accepted_by_other(d))
        if accept_button(driver_b):
            fail("Rider B still has an 'Accept order' button for the taken delivery")
            all_ok = False
        else:
            ok("Rider B sees 'Accepted by another rider' and cannot claim it")

        # --- Step 5: recovery via HTTP polling after refresh/reconnect ---
        open_order_sheet(driver_b)  # collapse if needed
        driver_b.refresh()
        WebDriverWait(driver_b, 25).until(
            lambda d: d.find_elements(By.XPATH, "//button[@aria-label='Show order details']")
            or d.find_elements(By.XPATH, "//button[@aria-label='Hide order details']")
        )
        open_order_sheet(driver_b)
        WebDriverWait(driver_b, 25).until(lambda d: has_accepted_by_other(d))
        ok("Rider B recovered the read-only state after a refresh (HTTP polling)")

        # --- Step 6/7: integrity, no duplicate assignment / purchasing cash ---
        if not verify_integrity():
            all_ok = False

    except TimeoutException as exc:
        fail(f"Timed out: {exc}")
        for name, drv in (("A", driver_a), ("B", driver_b)):
            try:
                drv.save_screenshot(f"rider_board_e2e_failure_{name}.png")
                log(f"Saved rider_board_e2e_failure_{name}.png ({drv.current_url})")
            except Exception:
                pass
        all_ok = False
    finally:
        driver_a.quit()
        driver_b.quit()
        if not os.environ.get("E2E_KEEP_FIXTURE"):
            clean_fixture()

    if all_ok:
        print("\n=== RIDER ORDER BOARD BROWSER E2E PASSED ===", flush=True)
        sys.exit(0)
    print("\n=== RIDER ORDER BOARD BROWSER E2E FAILED ===", flush=True)
    sys.exit(1)


if __name__ == "__main__":
    run()
