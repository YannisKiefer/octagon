"""
Delivery Orchestrator

Pulls approved deliveries from the DB and routes them to the correct
platform uploader (TikTok / Instagram / LinkedIn).

Per-phone API credentials come from environment variables:
  PHONE1_TIKTOK_ACCESS_TOKEN, PHONE1_INSTAGRAM_ACCESS_TOKEN, etc.

After posting, updates the delivery_log with post_url and marks as 'posted'.
Sends a Telegram success/failure notification to the phone's group.
"""

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Optional

from loguru import logger

from octragon.config import OctragonConfig, get_config
from octragon.db import OctragonDB
from octragon.models import (
    ApprovalStatus,
    DeliveryLog,
    NicheConfig,
    TargetPlatform,
)
from octragon.uploader.tiktok import TikTokUploader
from octragon.uploader.instagram import InstagramUploader
from octragon.uploader.linkedin import LinkedInUploader


# ─── Credential helpers ───────────────────────────────────────────────────────

def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def _phone_credentials(phone: int) -> dict:
    """Load all platform credentials for a given phone from env."""
    prefix = f"PHONE{phone}"
    return {
        "tiktok_token": _env(f"{prefix}_TIKTOK_ACCESS_TOKEN"),
        "ig_token": _env(f"{prefix}_INSTAGRAM_ACCESS_TOKEN"),
        "ig_account_id": _env(f"{prefix}_INSTAGRAM_ACCOUNT_ID"),
        "li_token": _env(f"{prefix}_LINKEDIN_ACCESS_TOKEN"),
        "li_urn": _env(f"{prefix}_LINKEDIN_AUTHOR_URN"),
    }


# ─── Platform routers ─────────────────────────────────────────────────────────

async def _upload_tiktok(
    config: OctragonConfig,
    delivery: DeliveryLog,
    nc: NicheConfig,
    video_path: str,
    caption: str,
    hashtags: list[str],
    creds: dict,
) -> Optional[str]:
    """Upload to TikTok. Returns post URL or None on failure."""
    token = creds.get("tiktok_token")
    if not token:
        logger.warning(f"[Orchestrator] No TikTok token for phone {delivery.phone_number}")
        return None

    uploader = TikTokUploader(config, token)
    try:
        result = await uploader.upload_video(
            video_path=video_path,
            caption=caption,
            privacy_level="PUBLIC_TO_EVERYONE",
            hashtags=hashtags,
        )
        if not result:
            return None
        # Poll for completion
        publish_id = result["publish_id"]
        final_status = await uploader.poll_status(publish_id)
        if final_status in ("PUBLISH_COMPLETE", "SEND_TO_USER_INBOX"):
            return f"https://www.tiktok.com/@{nc.tiktok_handle}"
        return None
    finally:
        await uploader.close()


async def _upload_instagram(
    delivery: DeliveryLog,
    nc: NicheConfig,
    video_path: str,
    caption: str,
    hashtags: list[str],
    creds: dict,
) -> Optional[str]:
    """Upload to Instagram Reels. Returns post URL or None."""
    token = creds.get("ig_token")
    account_id = creds.get("ig_account_id")
    if not token or not account_id:
        logger.warning(f"[Orchestrator] No Instagram creds for phone {delivery.phone_number}")
        return None

    uploader = InstagramUploader(token, account_id)
    try:
        result = await uploader.upload_reel(
            video_path=video_path,
            caption=caption,
            hashtags=hashtags,
        )
        return result.get("post_url") if result else None
    finally:
        await uploader.close()


async def _upload_linkedin(
    delivery: DeliveryLog,
    nc: NicheConfig,
    video_path: str,
    caption: str,
    hashtags: list[str],
    creds: dict,
) -> Optional[str]:
    """Upload to LinkedIn. Returns post URL or None."""
    token = creds.get("li_token")
    author_urn = creds.get("li_urn")
    if not token or not author_urn:
        logger.warning(f"[Orchestrator] No LinkedIn creds for phone {delivery.phone_number}")
        return None

    uploader = LinkedInUploader(token, author_urn)
    try:
        result = await uploader.upload_video(
            video_path=video_path,
            caption=caption,
            hashtags=hashtags,
        )
        return result.get("post_url") if result else None
    finally:
        await uploader.close()


# ─── Telegram notifications ───────────────────────────────────────────────────

async def _notify_success(
    config: OctragonConfig,
    group_id: str,
    platform: str,
    post_url: str,
    phone: int,
) -> None:
    if not config.telegram_bot_token or not group_id:
        return
    emoji = {"tiktok": "🎵", "instagram": "📸", "linkedin": "💼"}.get(platform, "✅")
    text = (
        f"{emoji} *Posted successfully!*\n"
        f"Platform: {platform.title()}\n"
        f"Phone: {phone}\n"
        f"🔗 {post_url}"
    )
    try:
        from telegram import Bot
        bot = Bot(token=config.telegram_bot_token)
        await bot.send_message(chat_id=group_id, text=text, parse_mode="Markdown")
    except Exception as e:
        logger.warning(f"[Orchestrator] Telegram notify failed: {e}")


async def _notify_failure(
    config: OctragonConfig,
    group_id: str,
    platform: str,
    phone: int,
    reason: str,
) -> None:
    if not config.telegram_bot_token or not group_id:
        return
    text = (
        f"⚠️ *Upload failed*\n"
        f"Platform: {platform.title()}\n"
        f"Phone: {phone}\n"
        f"Reason: {reason}"
    )
    try:
        from telegram import Bot
        bot = Bot(token=config.telegram_bot_token)
        await bot.send_message(chat_id=group_id, text=text, parse_mode="Markdown")
    except Exception as e:
        logger.warning(f"[Orchestrator] Telegram notify failed: {e}")


# ─── Core orchestration ───────────────────────────────────────────────────────

async def process_delivery(
    config: OctragonConfig,
    db: OctragonDB,
    delivery: DeliveryLog,
    nc: NicheConfig,
    variation_path: str,
    scraped_caption: str,
    scraped_hashtags: list[str],
) -> bool:
    """Process a single approved delivery item. Returns True if posted."""
    platform = delivery.target_platform
    phone = delivery.phone_number
    creds = _phone_credentials(phone)

    logger.info(f"[Orchestrator] Posting variation {delivery.variation_id} to {platform.value} (Phone {phone})")

    post_url: Optional[str] = None

    if platform == TargetPlatform.TIKTOK:
        post_url = await _upload_tiktok(config, delivery, nc, variation_path, scraped_caption, scraped_hashtags, creds)
    elif platform == TargetPlatform.INSTAGRAM:
        post_url = await _upload_instagram(delivery, nc, variation_path, scraped_caption, scraped_hashtags, creds)
    elif platform == TargetPlatform.LINKEDIN:
        post_url = await _upload_linkedin(delivery, nc, variation_path, scraped_caption, scraped_hashtags, creds)
    else:
        logger.error(f"[Orchestrator] Unknown platform: {platform}")
        return False

    now = datetime.now(timezone.utc)

    if post_url:
        # Mark as posted
        db.conn.execute("""
            UPDATE delivery_log
            SET approval_status = 'posted', posted_at = ?, post_url = ?
            WHERE id = ?
        """, (now.isoformat(), post_url, delivery.id))
        db.conn.commit()
        logger.success(f"[Orchestrator] Posted! {post_url}")
        await _notify_success(config, nc.telegram_group_id, platform.value, post_url, phone)
        return True
    else:
        # Mark as failed
        db.conn.execute("""
            UPDATE delivery_log
            SET approval_status = 'failed'
            WHERE id = ?
        """, (delivery.id,))
        db.conn.commit()
        logger.error(f"[Orchestrator] Upload failed for delivery {delivery.id}")
        await _notify_failure(config, nc.telegram_group_id, platform.value, phone, "Upload API returned no URL")
        return False


async def _is_in_upload_window(phone: int) -> bool:
    """
    Layer 5: Organic upload window gating.

    Platform behavioral analysis detects bots that post at non-human hours.
    Each niche phone has a mapped city; this gate enforces posting only
    during known-peak hours in that timezone (CET = UTC+1).

    Phone 1 (E-com/Zurich):    06:00-09:30, 11:30-14:30, 18:00-21:30
    Phone 2 (AI/Berlin):       07:30-10:30, 13:30-16:30, 19:00-22:00
    Phone 3 (Business/London): 07:00-09:30, 12:00-14:00, 17:30-20:30
    Phone 4 (Lifestyle/BCN):   06:30-09:00, 19:30-22:30

    Returns True if the current CET local hour is within a peak window.
    """
    from datetime import timezone, timedelta
    cet = timezone(timedelta(hours=1))  # CET (simplified, no DST)
    now_local = datetime.now(cet)
    hour = now_local.hour + now_local.minute / 60.0

    windows: dict[int, list[tuple[float, float]]] = {
        1: [(6.0, 9.5), (11.5, 14.5), (18.0, 21.5)],
        2: [(7.5, 10.5), (13.5, 16.5), (19.0, 22.0)],
        3: [(7.0, 9.5), (12.0, 14.0), (17.5, 20.5)],
        4: [(6.5, 9.0), (19.5, 22.5)],
    }
    for start, end in windows.get(phone, [(0.0, 24.0)]):
        if start <= hour <= end:
            return True
    return False


async def _organic_stagger_delay(delivery_index: int, total_deliveries: int) -> None:
    """
    Layer 5: Inter-variation stagger delay.

    When multiple variations of the same content are approved,
    platforms flag simultaneous or rapid sequential uploads as bot behavior.
    Wait 45-120 minutes between each variation post.
    First variation: post immediately.
    """
    if delivery_index == 0:
        return  # Post first variation immediately

    # Stagger: 45-120 minutes (2700-7200 seconds) between subsequent items
    import random
    delay_seconds = random.randint(2700, 7200)
    logger.info(
        f"[Orchestrator] Organic stagger: waiting {delay_seconds//60}min "
        f"before item {delivery_index + 1}/{total_deliveries}"
    )
    await asyncio.sleep(delay_seconds)


async def run_delivery_queue(config: OctragonConfig, db: OctragonDB, respect_windows: bool = False) -> dict:
    """
    Process all approved-but-not-yet-posted deliveries.

    Args:
        respect_windows: If True, delays posts until within organic upload windows.
                         Set to True in production (postloop). False for manual 'post' command.
    Returns summary of successes/failures.
    """
    approved = db.get_approved_pending_post()
    if not approved:
        logger.info("[Orchestrator] No approved deliveries to process")
        return {"total": 0, "posted": 0, "failed": 0}

    logger.info(f"[Orchestrator] Processing {len(approved)} approved deliveries")
    posted = 0
    failed = 0

    for idx, delivery in enumerate(approved):
        try:
            # Layer 5: Check organic upload window
            if respect_windows:
                if not await _is_in_upload_window(delivery.phone_number):
                    logger.info(
                        f"[Orchestrator] Phone {delivery.phone_number}: outside peak window, "
                        f"deferring delivery {delivery.id}"
                    )
                    continue  # Skip — postloop will retry next cycle

            # Get variation path + scraped metadata
            variation = db.get_variation(delivery.variation_id)
            if not variation:
                logger.warning(f"[Orchestrator] Variation not found: {delivery.variation_id}")
                failed += 1
                continue

            scraped = db.get_scraped_content(delivery.scraped_content_id)
            if not scraped:
                logger.warning(f"[Orchestrator] Scraped content not found: {delivery.scraped_content_id}")
                failed += 1
                continue

            nc = db.get_niche_config(delivery.phone_number)
            if not nc:
                logger.warning(f"[Orchestrator] No niche config for phone {delivery.phone_number}")
                failed += 1
                continue

            # Layer 5: Apply inter-variation organic stagger
            if respect_windows:
                await _organic_stagger_delay(idx, len(approved))

            success = await process_delivery(
                config=config,
                db=db,
                delivery=delivery,
                nc=nc,
                variation_path=variation.video_path,
                scraped_caption=scraped.caption or "Check this out! 🔥",
                scraped_hashtags=scraped.hashtags or [],
            )
            if success:
                posted += 1
            else:
                failed += 1

            # Minimum inter-request cooldown (avoids platform rate limits)
            if len(approved) > 1 and not respect_windows:
                await asyncio.sleep(30)

        except Exception as e:
            logger.exception(f"[Orchestrator] Delivery {delivery.id} error: {e}")
            failed += 1

    summary = {"total": len(approved), "posted": posted, "failed": failed}
    logger.info(f"[Orchestrator] Delivery complete: {summary}")
    return summary



# ─── Post-loop scheduler ─────────────────────────────────────────────────────

async def run_post_scheduler(interval_minutes: float = 30) -> None:
    """Run the delivery queue on a timer. Uses organic upload windows in production."""
    config = get_config()
    db = OctragonDB(config.db_path)
    logger.info(f"[PostScheduler] Starting — interval: {interval_minutes}min, organic windows: ON")
    while True:
        try:
            await run_delivery_queue(config, db, respect_windows=True)
        except Exception as e:
            logger.exception(f"[PostScheduler] Run failed: {e}")
        await asyncio.sleep(interval_minutes * 60)



async def run_once() -> dict:
    """Run one delivery cycle (for run.py post command)."""
    config = get_config()
    db = OctragonDB(config.db_path)
    return await run_delivery_queue(config, db)
