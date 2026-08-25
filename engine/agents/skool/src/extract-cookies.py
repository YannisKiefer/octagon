#!/usr/bin/env python3
"""
extract-cookies.py — Opens Skool in a visible browser for you to log in,
then saves your session cookies to skool_session.json.

Usage:
  python3 extract-cookies.py
  python3 extract-cookies.py --output ~/path/to/skool_session.json
"""

import argparse
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_OUTPUT = Path(
    os.environ.get("SKOOL_BASE_DIR", "~/clawd-workspace/skool-whop-team")
).expanduser() / "data" / "skool_session.json"


def main():
    parser = argparse.ArgumentParser(description="Extract Skool session cookies")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    print(f"\nOpening Skool in a browser window.")
    print("Log in if needed, then come back here and press ENTER.\n")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()
        page.goto("https://www.skool.com/", wait_until="domcontentloaded")

        input("Press ENTER once you are logged in to Skool...")

        cookies = context.cookies()
        browser.close()

    skool_cookies = [c for c in cookies if "skool" in c.get("domain", "")]
    print(f"\nFound {len(skool_cookies)} Skool cookies ({len(cookies)} total).")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(skool_cookies, f, indent=2)

    print(f"Saved to: {args.output}\n")
    print("You can now run:")
    print(f"  SKOOL_BASE_DIR=~/clawd-workspace/skool-whop-team python3 skool-scout.py --test --keyword dropshipping --limit 5")


if __name__ == "__main__":
    main()
