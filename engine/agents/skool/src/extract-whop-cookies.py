#!/usr/bin/env python3
"""
extract-whop-cookies.py — Opens Whop in a visible browser for you to log in,
then saves your session cookies to whop_session.json.

Same pattern as extract-cookies.py (Skool).

Usage:
  python3 extract-whop-cookies.py
  python3 extract-whop-cookies.py --output ~/path/to/whop_session.json
"""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_OUTPUT = (
    Path(__file__).parent.parent / "data" / "whop_session.json"
)


def main():
    parser = argparse.ArgumentParser(description="Extract Whop session cookies")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    output_path = args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print("\nOpening Whop in a browser window.")
    print("Log in to your Whop account, then come back here and press ENTER.\n")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        page.goto("https://whop.com/login", wait_until="domcontentloaded")

        input("Press ENTER once you are logged in to Whop...")

        cookies = context.cookies()
        browser.close()

    whop_cookies = [c for c in cookies if "whop" in c.get("domain", "")]

    if not whop_cookies:
        print("WARNING: No Whop cookies found. Did you log in?")
        return

    # Extract session token
    session_token = ""
    for c in whop_cookies:
        if c["name"] in ("session", "whop_session", "_whop_session"):
            session_token = c["value"]
            break

    session_data = {
        "session_token": session_token,
        "cookies": whop_cookies,
        "extracted_at": __import__("datetime").datetime.now().isoformat(),
    }

    with open(output_path, "w") as f:
        json.dump(session_data, f, indent=2)

    print(f"\nSaved {len(whop_cookies)} Whop cookies to {output_path}")
    if session_token:
        print(f"Session token: {session_token[:20]}...")
    else:
        print("WARNING: Session token not found. You may need to check cookie names.")
    print("\nYou can now run:")
    print("  python3 whop-dm-auto.py --self-test")


if __name__ == "__main__":
    main()
