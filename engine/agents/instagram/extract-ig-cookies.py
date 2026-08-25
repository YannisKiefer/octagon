#!/usr/bin/env python3
"""
extract-ig-cookies.py — Opens Instagram in a visible browser for you to log in,
then saves your session cookies to ig_session.json.

Same pattern as Skool's extract-cookies.py.

Usage:
  python3 extract-ig-cookies.py
  python3 extract-ig-cookies.py --output ~/path/to/ig_session.json
"""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_OUTPUT = (
    Path(__file__).parent.parent / "data" / "ig_session.json"
)


def main():
    parser = argparse.ArgumentParser(description="Extract Instagram session cookies")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    print("\nOpening Instagram in a browser window.")
    print("Log in to your Instagram account, then come back here and press ENTER.\n")

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
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded")

        input("Press ENTER once you are logged in to Instagram...")

        cookies = context.cookies()
        browser.close()

    ig_cookies = [c for c in cookies if "instagram" in c.get("domain", "")]
    print(f"\nFound {len(ig_cookies)} Instagram cookies ({len(cookies)} total).")

    # Verify we have the critical cookies
    cookie_names = {c["name"] for c in ig_cookies}
    critical = {"sessionid", "csrftoken", "ds_user_id"}
    found = critical & cookie_names
    missing = critical - cookie_names

    if found:
        print(f"Critical cookies present: {', '.join(sorted(found))}")
    if missing:
        print(f"WARNING: Missing critical cookies: {', '.join(sorted(missing))}")
        print("You may not be fully logged in. Try again.")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(ig_cookies, f, indent=2)

    print(f"Saved to: {args.output}\n")
    print("You can now run:")
    print(f"  python3 instagram-team/src/ig-playwright-outreach.py --self-test")


if __name__ == "__main__":
    main()
