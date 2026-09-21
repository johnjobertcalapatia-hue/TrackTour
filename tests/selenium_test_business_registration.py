# -*- coding: utf-8 -*-
"""Selenium E2E test for business registration."""
import sys
import time
import subprocess
import json
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException

BASE_URL = "http://localhost:8000"
TEST_USER_EMAIL = "selenium-test@example.com"
TEST_USER_PASSWORD = "Test1234!"


def log(msg):
    print(f"[INFO] {msg}", flush=True)


def ok(msg):
    print(f"[PASS] {msg}", flush=True)


def fail(msg):
    print(f"[FAIL] {msg}", flush=True)


def login(driver):
    driver.get(f"{BASE_URL}/login")
    WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.ID, "email"))
    )
    driver.find_element(By.ID, "email").send_keys(TEST_USER_EMAIL)
    driver.find_element(By.ID, "password").send_keys(TEST_USER_PASSWORD)
    driver.find_element(By.XPATH, "//button[@type='submit']").click()
    WebDriverWait(driver, 10).until(EC.url_contains("dashboard"))
    ok("Logged in successfully")


def cleanup_old():
    """Delete previously created test businesses from the database."""
    subprocess.run(
        ["php", "artisan", "tinker", "--execute",
         "DB::table('businesses')->where('business_name', 'like', 'Selenium Test%')->delete(); echo 'Done'"],
        capture_output=True, text=True, timeout=15,
        cwd=r"C:\xampp\htdocs\Capstone Project 1",
    )
    log("Cleaned up previous test businesses")


def test_and_fix():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1280,1024")

    driver = webdriver.Chrome(options=options)
    driver.set_page_load_timeout(20)

    try:
        # --- CLEANUP previous test data ---
        cleanup_old()

        # --- LOGIN ---
        login(driver)

        # --- NAVIGATE ---
        log("Navigating to business registration...")
        driver.get(f"{BASE_URL}/business-owner/businesses/create")
        log(f"Page loaded, title: {driver.title}")

        # Wait for page to fully render (Alpine + content)
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located(
                (By.XPATH, "//h2[contains(text(), 'Select Business Category')]")
            )
        )
        log("Step 1 visible")

        # Find all category buttons
        cat_elements = driver.find_elements(By.XPATH, "//span[text()='Restaurant']")
        log(f"Found {len(cat_elements)} 'Restaurant' span(s)")

        if len(cat_elements) == 0:
            # Try alternative - maybe buttons are already visible
            cat_elements = driver.find_elements(By.XPATH, "//button[contains(@class, 'relative')]//span[text()='Restaurant']")
            log(f"Alternative search found {len(cat_elements)}")

        if len(cat_elements) == 0:
            # Dump page structure for debugging
            body = driver.find_element(By.TAG_NAME, "body")
            log(f"Page body text (first 2000 chars): {body.text[:2000]}")
            fail("Could not find Restaurant category button")
            driver.save_screenshot("step1_no_category.png")
            sys.exit(1)

        cat_btn = cat_elements[0]
        driver.execute_script("arguments[0].scrollIntoView(true);", cat_btn)
        time.sleep(0.5)
        driver.execute_script("arguments[0].click();", cat_btn)
        ok("Step 1: Selected 'Restaurant' category")

        # Click Next
        next_btn = WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Next')]"))
        )
        driver.execute_script("arguments[0].scrollIntoView(true);", next_btn)
        time.sleep(0.2)
        driver.execute_script("arguments[0].click();", next_btn)
        log("Clicked Next on step 1")

        # ===== STEP 2: Basic Information =====
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "business_name"))
        )
        driver.find_element(By.ID, "business_name").send_keys("Selenium Test Restaurant")
        log("Filled business name")

        driver.find_element(By.ID, "business_description").send_keys(
            "A test restaurant created by Selenium"
        )
        driver.find_element(By.ID, "contact_number").send_keys("0917-111-2222")
        driver.find_element(By.ID, "email").send_keys("selenium-restaurant@example.com")
        driver.find_element(By.ID, "website").send_keys("https://selenium-test.com")
        driver.find_element(By.ID, "facebook").send_keys("https://facebook.com/seleniumtest")
        driver.find_element(By.ID, "instagram").send_keys("https://instagram.com/seleniumtest")

        # Legal fields
        Select(driver.find_element(By.ID, "legal_entity_type")).select_by_value("Sole Proprietorship")
        driver.find_element(By.ID, "tin").send_keys("123-456-789-000")
        driver.find_element(By.ID, "dti_sec_reg_number").send_keys("2026-123456")
        driver.find_element(By.ID, "year_established").send_keys("2020")
        driver.find_element(By.ID, "owner_full_name").send_keys("Selenium Test Owner")
        driver.find_element(By.ID, "owner_address").send_keys("123 Test Street, Manila")
        driver.find_element(By.ID, "initial_capital").send_keys("500000")
        driver.find_element(By.ID, "gross_floor_area").send_keys("250")
        driver.find_element(By.ID, "number_of_employees").send_keys("10")
        Select(driver.find_element(By.ID, "occupancy_status")).select_by_value("Owned")

        ok("Step 2: Filled business information")

        next_btn = WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Next')]"))
        )
        driver.execute_script("arguments[0].scrollIntoView(true);", next_btn)
        time.sleep(0.2)
        driver.execute_script("arguments[0].click();", next_btn)
        log("Clicked Next on step 2")

        # ===== STEP 3: Details =====
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "detail_cuisine_type"))
        )
        driver.find_element(By.ID, "detail_cuisine_type").send_keys("Filipino")
        for name in ["details[dine_in]", "details[take_out]"]:
            cb = driver.find_element(By.NAME, name)
            if not cb.is_selected():
                driver.execute_script("arguments[0].click();", cb)
        driver.find_element(By.ID, "detail_seating_capacity").send_keys("50")
        driver.find_element(By.ID, "detail_average_price_range").send_keys("PHP 100-500")
        ok("Step 3: Filled dynamic details")

        next_btn = WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Next')]"))
        )
        driver.execute_script("arguments[0].scrollIntoView(true);", next_btn)
        time.sleep(0.2)
        driver.execute_script("arguments[0].click();", next_btn)
        log("Clicked Next on step 3")

        # ===== STEP 4: Location =====
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "municipality"))
        )
        Select(driver.find_element(By.ID, "municipality")).select_by_index(1)
        time.sleep(2)
        WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.ID, "barangay"))
        )
        Select(driver.find_element(By.ID, "barangay")).select_by_index(1)
        driver.find_element(By.ID, "address").send_keys("123 Main Street")
        driver.find_element(By.ID, "latitude").send_keys("12.345678")
        driver.find_element(By.ID, "longitude").send_keys("121.987654")
        ok("Step 4: Selected location with coordinates")

        next_btn = WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Next')]"))
        )
        driver.execute_script("arguments[0].scrollIntoView(true);", next_btn)
        time.sleep(0.2)
        driver.execute_script("arguments[0].click();", next_btn)
        log("Clicked Next on step 4")

        # ===== STEP 5: Operating Information =====
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "opening_time"))
        )
        for day in ["Mon", "Tue", "Wed", "Thu", "Fri"]:
            spans = driver.find_elements(By.XPATH, f"//span[text()='{day}']")
            if spans:
                label = spans[0].find_element(By.XPATH, "./ancestor::label")
                driver.execute_script("arguments[0].click();", label)
        opening = driver.find_element(By.ID, "opening_time")
        opening.clear()
        driver.execute_script("arguments[0].value = '08:00'; arguments[0].dispatchEvent(new Event('input'));", opening)
        closing = driver.find_element(By.ID, "closing_time")
        closing.clear()
        driver.execute_script("arguments[0].value = '17:00'; arguments[0].dispatchEvent(new Event('input'));", closing)
        ok("Step 5: Filled operating information")

        next_btn = WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Next')]"))
        )
        driver.execute_script("arguments[0].scrollIntoView(true);", next_btn)
        time.sleep(0.2)
        driver.execute_script("arguments[0].click();", next_btn)
        log("Clicked Next on step 5")

        # ===== STEP 6: Skip =====
        ok("Step 6: Skipped documents")

        next_btn = WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Next')]"))
        )
        driver.execute_script("arguments[0].scrollIntoView(true);", next_btn)
        time.sleep(0.2)
        driver.execute_script("arguments[0].click();", next_btn)
        log("Clicked Next on step 6")

        # ===== STEP 7: Skip =====
        ok("Step 7: Skipped gallery")

        next_btn = WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Next')]"))
        )
        driver.execute_script("arguments[0].scrollIntoView(true);", next_btn)
        time.sleep(0.2)
        driver.execute_script("arguments[0].click();", next_btn)
        log("Clicked Next on step 7")

        # ===== STEP 8: Review & Submit =====
        log("Waiting for step 8 to fully render...")
        time.sleep(2)

        # Find and check the declaration checkbox
        decl_boxes = driver.find_elements(
            By.XPATH, "//input[@type='checkbox']"
        )
        log(f"Found {len(decl_boxes)} checkboxes on page")

        decl_box = None
        for cb in decl_boxes:
            try:
                parent_text = cb.find_element(By.XPATH, "./following-sibling::span").text
                if "certify" in parent_text.lower() or "declaration" in parent_text.lower() or "true and correct" in parent_text.lower():
                    decl_box = cb
                    log(f"Found declaration checkbox with text: {parent_text[:50]}")
                    break
            except:
                pass

        if decl_box is None and len(decl_boxes) > 0:
            # Just use the only checkbox on the page
            decl_box = decl_boxes[0]
            log("Using first available checkbox")

        if decl_box:
            driver.execute_script("arguments[0].scrollIntoView(true);", decl_box)
            time.sleep(0.5)
            if not decl_box.is_selected():
                driver.execute_script("arguments[0].click();", decl_box)
                log("Checked declaration checkbox")
            else:
                log("Declaration checkbox already checked")
        else:
            log("WARNING: No checkbox found, trying to proceed anyway")

        ok("Step 8: Accepted declaration")

        # Wait a moment for Alpine to react
        time.sleep(1)

        # Find and click submit button
        submit_btn = None
        all_buttons = driver.find_elements(By.TAG_NAME, "button")
        log(f"Found {len(all_buttons)} buttons on page")
        for btn in all_buttons:
            try:
                text = btn.text.strip()
                log(f"Button text: '{text}'")
                if "Submit Registration" in text or "Submit" in text:
                    submit_btn = btn
                    break
            except:
                pass

        if submit_btn is None:
            # Try with contains XPath
            try:
                submit_btn = driver.find_element(By.XPATH, "//button[contains(text(), 'Submit')]")
            except:
                pass

        if submit_btn:
            driver.execute_script("arguments[0].scrollIntoView(true);", submit_btn)
            time.sleep(0.5)
            driver.execute_script("arguments[0].click();", submit_btn)
            ok("Clicked Submit Registration")
        else:
            fail("Could not find Submit Registration button")
            # Debug: dump page
            body = driver.find_element(By.TAG_NAME, "body")
            log(f"Page body HTML (first 3000 chars): {body.get_attribute('innerHTML')[:3000]}")
            sys.exit(1)

        # Wait for redirect (or capture error)
        log("Waiting for form submission result...")
        time.sleep(5)
        current_url = driver.current_url
        log(f"After submission URL: {current_url}")

        if "business-owner/businesses" not in current_url:
            log("Still on create page - checking for errors...")
            body_text = driver.find_element(By.TAG_NAME, "body").text
            log(f"Page content (first 3000 chars): {body_text[:3000]}")

            # Check for validation errors or Laravel error output
            error_elements = driver.find_elements(By.CSS_SELECTOR, ".text-red-600, .error, .alert-danger, .bg-red-50, .text-red-700")
            for el in error_elements:
                log(f"Error element text: {el.text}")

        WebDriverWait(driver, 20).until(
            lambda d: "business-owner/businesses" in d.current_url
        )
        ok(f"Redirected to: {driver.current_url}")

        # Verify database — fetch full record and check no required field is NULL
        result = subprocess.run(
            [
                "php", "artisan", "tinker", "--execute",
                "echo json_encode(App\\Models\\Business::where('business_name', 'Selenium Test Restaurant')->first()?->only(['id','business_name','business_description','contact_number','email','website','facebook','instagram','address','latitude','longitude','opening_time','closing_time','business_days','municipality_id','barangay_id','business_category_id']) ?? 'NOT FOUND');",
            ],
            capture_output=True, text=True, timeout=15,
            cwd=r"C:\xampp\htdocs\Capstone Project 1",
        )
        output = result.stdout.strip()
        if output and "NOT FOUND" not in output:
            try:
                data = json.loads(output)
                ok(f"Business ID {data['id']} verified in database")

                required_fields = [
                    'business_name', 'business_description', 'contact_number',
                    'email', 'website', 'facebook', 'instagram', 'address',
                    'municipality_id', 'barangay_id', 'business_category_id',
                ]
                numeric_fields = ['latitude', 'longitude', 'opening_time', 'closing_time', 'business_days']

                all_ok = True
                for field in required_fields:
                    if data.get(field) is None:
                        fail(f"Field '{field}' is NULL — expected a value")
                        all_ok = False

                for field in numeric_fields:
                    if data.get(field) is None:
                        fail(f"Field '{field}' is NULL — expected a value")
                        all_ok = False

                if all_ok:
                    ok("All fields stored correctly — no NULL values in submitted data")
                    log(f"  lat={data['latitude']}, lng={data['longitude']}, "
                        f"open={data['opening_time']}, close={data['closing_time']}, "
                        f"days={data['business_days']}")
                else:
                    sys.exit(1)
            except json.JSONDecodeError as e:
                fail(f"Could not parse business data: {e}")
                fail(f"Raw output: {output}")
                sys.exit(1)
        else:
            fail(f"DB check failed. stdout: {output!r}, stderr: {result.stderr!r}")
            sys.exit(1)

        print("\n=== ALL CHECKS PASSED ===", flush=True)

    except Exception as e:
        fail(f"TEST FAILED: {type(e).__name__}: {e}")
        try:
            driver.save_screenshot("selenium_failure.png")
            log("Screenshot saved")
            log(f"URL: {driver.current_url}")
        except Exception:
            pass
        sys.exit(1)
    finally:
        driver.quit()


if __name__ == "__main__":
    test_and_fix()
