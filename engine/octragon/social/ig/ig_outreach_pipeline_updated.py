"""
ig_outreach_pipeline.py -- updated send() to use instagrapi instead of clothefobia.
Patch the existing ig_outreach_pipeline.py with this send() function.
Replaces: send_dm_via_clothefobia -> send_dm_via_instagrapi (free, zero API cost)
"""
# In ig_outreach_pipeline.py, replace the send() function with this version:

def send(dry_run: bool = False, crafted_file: str = None) -> None:
    """
    Send crafted DMs via instagrapi (free -- no Apify, no clothefobia).
    Reads: crafted_messages_$TODAY.json
    Smart delays: 60-120s between DMs (human-like pacing)
    Daily cap: 30 DMs/day
    """
    import time, random, json, logging
    from pathlib import Path
    from datetime import datetime, timezone
    from ig_dm_sender import load_json, save_json, count_todays_sends

    logger = logging.getLogger(__name__)
    TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    NOW = datetime.now(timezone.utc)
    DATA_DIR = Path.home() / "clawd" / "data" / "influencer"
    CRM_DIR = Path.home() / "clawd" / "crm"
    TRACKER_FILE = CRM_DIR / "influence_tracker.json"
    CONTACT_LOG = CRM_DIR / "contact_log.json"
    DAILY_LIMIT = 30

    # Build instagrapi client (reuses session from ig_follow.py)
    SESSION_FILE = CRM_DIR / "ig_session.json"
    keys = load_json(CRM_DIR / "api_keys.json", {})
    ig_username = keys.get("ig_username", "")
    ig_password = keys.get("ig_password", "")

    if not ig_username or not ig_password:
        print("ERROR: ig_username / ig_password required in api_keys.json")
        return

    crafted_path = Path(crafted_file) if crafted_file else DATA_DIR / f"crafted_messages_{TODAY}.json"
    if not crafted_path.exists():
        print(f"ERROR: No crafted messages file: {crafted_path}")
        return

    crafted = load_json(crafted_path, [])
    contact_log = load_json(CONTACT_LOG, {"entries": []})
    tracker = load_json(TRACKER_FILE, {})

    todays_sends = count_todays_sends(contact_log)
    remaining = DAILY_LIMIT - todays_sends

    print(f"\n=== DM-IG Send (instagrapi) --- {TODAY} ===")
    print(f"Crafted: {len(crafted)} | Sent today: {todays_sends}/{DAILY_LIMIT} | Remaining: {remaining}")

    if remaining <= 0:
        print("Daily limit reached.")
        return

    cl = None
    if not dry_run:
        from ig_follow import build_client
        cl = build_client(ig_username, ig_password)

    sent_total = stage0_sent = stage1_sent = 0

    for item in crafted:
        if sent_total >= remaining:
            break

        username = item.get("username", "")
        msg = item.get("message", "")
        stage = item.get("stage", 0)
        tier = item.get("tier", "T3")

        if not username or not msg:
            continue

        print(f"[SEND S{stage} | {tier}] @{username}")
        print(f"  {msg[:160]}...")

        if dry_run:
            print("  [DRY RUN]")
            sent_total += 1
            continue

        # Send via instagrapi
        success = False
        try:
            user_info = cl.user_info_by_username(username)
            thread = cl.direct_send(msg, [user_info.pk])
            success = bool(thread)
            if success:
                logger.info(f"DM sent to @{username}")
            else:
                logger.warning(f"DM to @{username} returned falsy")
        except Exception as e:
            logger.error(f"DM failed @{username}: {e}")
            success = False

        if success:
            now_iso = NOW.isoformat()
            entry = tracker.get(username, {})
            if stage == 0:
                tracker[username] = {
                    **entry,
                    "stage": 0,
                    "tier": tier,
                    "stage0_sent_at": now_iso,
                    "followers": item.get("followers", 0),
                    "bio": item.get("bio", ""),
                    "research": item.get("research", entry.get("research_cached", {})),
                }
                stage0_sent += 1
            elif stage == 1:
                tracker[username] = {
                    **entry,
                    "stage": 1,
                    "stage1_sent_at": now_iso,
                    "variant": item.get("variant", "A"),
                }
                stage1_sent += 1

            contact_log.setdefault("entries", []).append({
                "contact_id": f"ig_{username}_{TODAY}_s{stage}",
                "username": username,
                "platform": "instagram",
                "followers": item.get("followers", 0),
                "tier": tier,
                "stage": stage,
                "message_sent": msg,
                "sent_at": now_iso,
                "status": "sent",
            })
            sent_total += 1
            print(f"  OK ({sent_total}/{remaining})")

            # Smart delay: 60-120s between DMs
            delay = random.randint(60, 120)
            logger.info(f"Waiting {delay}s...")
            time.sleep(delay)
        else:
            print(f"  FAILED")

    save_json(TRACKER_FILE, tracker)
    save_json(CONTACT_LOG, contact_log)

    print(f"\n=== Done ===")
    print(f"Stage 0 (compliments): {stage0_sent} | Stage 1 (pitches): {stage1_sent} | Total: {sent_total}")
