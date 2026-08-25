#!/usr/bin/env python3
"""
One-shot script: regenerate dm_text for all leads in joined.json
using the updated generate_dm from skool-scout.py (unicorn energy voice).
"""

import json
import sys
from pathlib import Path

# Add src/ to path so we can import from skool-scout
src_dir = Path(__file__).parent / "src"
sys.path.insert(0, str(src_dir))

from importlib import import_module

# Import skool_scout module (filename has a hyphen, use importlib)
import importlib.util
spec = importlib.util.spec_from_file_location("skool_scout", src_dir / "skool-scout.py")
skool_scout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(skool_scout)

JOINED_FILE = Path(__file__).parent / "data" / "joined.json"
QUEUE_FILE = Path(__file__).parent / "data" / "queue.json"


def main():
    if not JOINED_FILE.exists():
        print(f"File not found: {JOINED_FILE}")
        sys.exit(1)

    with open(JOINED_FILE, "r", encoding="utf-8") as f:
        leads = json.load(f)

    # Load queue.json to cross-reference member counts
    queue_members = {}
    if QUEUE_FILE.exists():
        with open(QUEUE_FILE, "r", encoding="utf-8") as f:
            queue_data = json.load(f)
        for entry in queue_data:
            slug = entry.get("slug", "")
            members = entry.get("members", 0)
            if slug and members:
                queue_members[slug] = members
        print(f"Loaded {len(queue_members)} member counts from queue.json")

    print(f"Loaded {len(leads)} leads from {JOINED_FILE}")

    for i, lead in enumerate(leads):
        # Cross-reference member count from queue.json if missing or zero
        slug = lead.get("slug", "")
        if (not lead.get("members") or lead.get("members") == 0) and slug in queue_members:
            lead["members"] = queue_members[slug]

        # Ensure required fields exist with defaults
        if "members" not in lead:
            lead["members"] = 0
        if "tier" not in lead:
            lead["tier"] = skool_scout.determine_tier(lead.get("members", 0))
        if "observation" not in lead:
            lead["observation"] = ""
        if "language" not in lead:
            lead["language"] = "EN"
        if "display" not in lead:
            lead["display"] = lead.get("slug", "community")

        lead["dm_text"] = skool_scout.generate_dm(lead)
        display = lead.get("display", lead.get("slug", "unknown"))
        members = lead.get("members", 0)
        print(f"  [{i+1}] Regenerated DM for: {display} ({members} members)")

    # Write back
    tmp = JOINED_FILE.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(leads, f, ensure_ascii=False, indent=2)
    tmp.replace(JOINED_FILE)

    print(f"\nWrote {len(leads)} updated leads back to {JOINED_FILE}")

    # Print first lead as sample
    if leads:
        print("\n--- Sample DM (lead 1) ---")
        print(leads[0].get("dm_text", ""))
        print("--- END ---")


if __name__ == "__main__":
    main()
