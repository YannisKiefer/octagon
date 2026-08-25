"""
Phone Farm OS — Demo Seeder
Creates a fresh infra/db/farm.db with synthetic demo data so screenshots pop
without any private or scraped content. Safe to run repeatedly.

Usage:
  python scripts/seed-demo.py
  # or from repo root:
  pip install -r engine/requirements.txt && python scripts/seed-demo.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))

import json, random, sqlite3
from datetime import datetime, timezone, timedelta
from octragon.db import OctragonDB

def main():
    db_path = ROOT / "infra" / "db" / "farm.db"
    if db_path.exists():
        print(f"→ removing old {db_path}")
        db_path.unlink()
        for ext in ("-shm", "-wal"):
            p = Path(str(db_path) + ext)
            if p.exists():
                p.unlink()
    db = OctragonDB(db_path)
    print(f"✓ DB initialized at {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    now = datetime.now(timezone.utc).isoformat()

    # — farm health (so /farm looks alive) —
    demo_health = [
        ("phone1", 1, "warmup", 3421, 812, 234, 89, 12, "Swipe Next"),
        ("phone2", 1, "scraping", 2893, 654, 198, 67, 9, "Like Post"),
        ("phone3", 0, "idle", 452, 120, 45, 12, 3, "Save Post"),
        ("phone4", 1, "posting", 1765, 432, 98, 34, 7, "Open Comments"),
    ]
    for device_id, usb, state, swipes, likes, saves, comments, profiles, last in demo_health:
        conn.execute("UPDATE farm_device_health SET usb_connected=?, session_state=?, swipes=?, likes=?, saves=?, comments=?, profiles=?, last_action=?, last_action_at=?, updated_at=? WHERE device_id=?",
                     (usb, state, swipes, likes, saves, comments, profiles, last, now, now, device_id))

    tasks = [
        ("task_warmup_1", "warmup", "phone1", "running", '{"duration_minutes": 30, "platform": "tiktok"}'),
        ("task_scout_1", "scout", "phone2", "scheduled", '{"max_videos": 20, "niche": "ecom"}'),
        ("task_post_1", "post", "phone4", "scheduled", '{"platform": "instagram"}'),
        ("task_audit_1", "audit", None, "succeeded", '{"check_jitter": true}'),
    ]
    for tid, typ, dev, status, payload in tasks:
        conn.execute("INSERT OR REPLACE INTO farm_tasks (id, type, device_id, scheduled_for, status, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     (tid, typ, dev, now, status, payload, now, now))

    accounts = [
        ("acc_ecom_tt_1", 1, "tiktok", "@trendlab", "ecom", "TrendLab", 45200),
        ("acc_ai_tt_1", 2, "tiktok", "@aibuilder", "ai", "AI Builder", 89200),
        ("acc_biz_ig_1", 3, "instagram", "@founderflow", "business", "Founder Flow", 23100),
        ("acc_life_yt_1", 4, "youtube", "@mindfuel", "lifestyle", "MindFuel", 156000),
    ]
    for aid, phone, plat, handle, niche, display, followers in accounts:
        conn.execute("INSERT OR REPLACE INTO accounts (id, phone_number, platform, handle, niche, display_name, follower_count, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
                     (aid, phone, plat, handle, niche, display, followers, now))

    captions = [
        "This one trick doubled our store conversion overnight...",
        "POV: you stopped overthinking and just shipped",
        "The hook that made this video hit 2.4M views",
        "I tested 30 ad creatives so you don't have to",
        "5am routine that actually sticks (no cold plunges)",
        "Behind the scenes: how we pack 500 orders/day",
    ]
    platforms = ["tiktok", "instagram", "youtube"]
    creators = ["@viralchef", "@buildinpublic", "@aestheticlab", "@growthguy", "@mindsetdaily", "@shopwins"]
    for i in range(18):
        cid = f"scraped_{i+1:03d}"
        plat = random.choice(platforms)
        creator = random.choice(creators)
        caption = random.choice(captions)
        views = random.randint(15000, 2800000)
        likes = int(views * random.uniform(0.04, 0.12))
        comments = int(views * random.uniform(0.003, 0.015))
        shares = int(views * random.uniform(0.002, 0.01))
        niche = random.choice(["ecom", "ai", "business", "lifestyle"])
        phone = random.randint(1,4)
        status = random.choice(["pending","pending","downloaded","ready"])
        created = (datetime.now(timezone.utc) - timedelta(hours=random.randint(1,72))).isoformat()
        conn.execute("INSERT OR REPLACE INTO scraped_content (id, source_url, source_platform, source_creator, caption, hashtags, duration_seconds, resolution, engagement_likes, engagement_comments, engagement_shares, engagement_views, target_niche, target_phone, scrape_status, scraped_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     (cid, f"https://{plat}.com/video/{cid}", plat, creator, caption, '["fyp","viral","business"]', random.randint(12,45), "1080x1920", likes, comments, shares, views, niche, phone, status, created, created))
    for i in range(6):
        scid = f"scraped_{i+1:03d}"
        for vi in range(3):
            var_id = f"var_{scid}_{vi}"
            status = random.choice(["pending","cleansed","ready"])
            params = json.dumps({"fps": 30, "crf": 22, "preset": "fast"})
            conn.execute("INSERT OR REPLACE INTO video_variations (id, scraped_content_id, variation_index, video_path, forge_params, cleanse_status, metadata_injected, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                         (var_id, scid, vi, f"/videos/{var_id}.mp4", params, status, random.randint(0,1), now))
    conn.commit()
    print("✓ demo seeded: 4 devices, 18 scraped, 18 variations")
    conn.close()

if __name__ == "__main__":
    main()
