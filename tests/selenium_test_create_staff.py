# -*- coding: utf-8 -*-
"""Selenium E2E test for creating staff under Selenium Test Restaurant."""
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
STAFF_EMAIL = "selenium-staff@example.com"
STAFF_FIRST_NAME = "John"
STAFF_LAST_NAME = "Doe"


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
    """Delete previously created test staff from the database."""
    subprocess.run(
        ["php", "artisan", "tinker", "--execute",
         "DB::table('staff')->where('employee_id', 'like', 'EMP-%')->delete(); "
         "DB::table('users')->where('email', '" + STAFF_EMAIL + "')->delete(); echo 'Done'"],
        capture_output=True, text=True, timeout=15,
        cwd=r"C:\xampp\htdocs\Capstone Project 1",
    )
    log("Cleaned up previous test staff")


def test_create_staff():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1280,1024")

    driver = webdriver.Chrome(options=options)
    driver.set_page_load_timeout(20)

    try:
        cleanup_old()
        login(driver)

        log("Navigating to staff creation page...")
        driver.get(f"{BASE_URL}/business-owner/staff/create")
        log(f"Page loaded, title: {driver.title}")

        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.ID, "business_id"))
        )
        log("Staff creation form loaded")

        # Select business
        business_select = Select(driver.find_element(By.ID, "business_id"))
        for option in business_select.options:
            if "Selenium Test Restaurant" in option.text:
                business_select.select_by_visible_text(option.text)
                log(f"Selected business: {option.text}")
                break
        else:
            fail("Selenium Test Restaurant not found in business dropdown")
            sys.exit(1)

        # Personal Information
        driver.find_element(By.ID, "first_name").send_keys(STAFF_FIRST_NAME)
        driver.find_element(By.ID, "last_name").send_keys(STAFF_LAST_NAME)

        gender_select = Select(driver.find_element(By.ID, "gender"))
        gender_select.select_by_value("male")
        log("Filled personal information")

        # Account Information
        driver.find_element(By.ID, "email").send_keys(STAFF_EMAIL)
        driver.find_element(By.ID, "password").send_keys("StaffPass123!")
        driver.find_element(By.ID, "password_confirmation").send_keys("StaffPass123!")
        log("Filled account information")

        # Employment Details
        role_select = Select(driver.find_element(By.ID, "staff_role_id"))
        for option in role_select.options:
            if "Waiter" in option.text:
                role_select.select_by_visible_text(option.text)
                log(f"Selected role: {option.text}")
                break
        else:
            role_select.select_by_index(1)
            log("Selected first available role")

        department_input = driver.find_element(By.ID, "department")
        department_input.send_keys("Service")

        log("Filled employment details")

        # Submit form
        submit_btn = driver.find_element(By.XPATH, "//button[contains(text(), 'Create Staff Account')]")
        driver.execute_script("arguments[0].scrollIntoView(true);", submit_btn)
        time.sleep(0.5)
        driver.execute_script("arguments[0].click();", submit_btn)
        ok("Clicked Create Staff Account button")

        # Wait for redirect
        log("Waiting for form submission result...")
        WebDriverWait(driver, 20).until(
            lambda d: "business-owner/staff" in d.current_url
        )
        ok(f"Redirected to: {driver.current_url}")

        # Verify database
        result = subprocess.run(
            ["php", "artisan", "tinker", "--execute",
             "echo json_encode(App\\Models\\Staff::whereHas('user', fn($q) => $q->where('email', '" + STAFF_EMAIL + "'))"
             "->with('user.profile')->first()?->only(['id','employee_id','staff_role_id','department']) ?? 'NOT FOUND');"],
            capture_output=True, text=True, timeout=15,
            cwd=r"C:\xampp\htdocs\Capstone Project 1",
        )
        output = result.stdout.strip()
        if output and "NOT FOUND" not in output:
            try:
                data = json.loads(output)
                ok(f"Staff ID {data['id']} (Employee: {data['employee_id']}) verified in database")
                ok("All checks passed - staff created successfully")
            except json.JSONDecodeError as e:
                fail(f"Could not parse staff data: {e}")
                fail(f"Raw output: {output}")
                sys.exit(1)
        else:
            fail(f"DB check failed. stdout: {output!r}, stderr: {result.stderr!r}")
            sys.exit(1)

        print("\n=== ALL CHECKS PASSED ===", flush=True)

    except Exception as e:
        fail(f"TEST FAILED: {type(e).__name__}: {e}")
        try:
            driver.save_screenshot("selenium_staff_failure.png")
            log("Screenshot saved")
        except Exception:
            pass
        sys.exit(1)
    finally:
        driver.quit()


if __name__ == "__main__":
    test_create_staff()
