"""
Discovery Scheduler (v2 — Cookie-Aware + Manual-First)

Two operating modes:
  1. AUTOMATED: When TikTok cookies are present → pull creator profiles,
     score videos, send top-N URLs to Telegram groups for easy one-tap scraping.
  2. MANUAL-FIRST: When no cookies → batch-analyze the existing DB,
     surface the highest-performing already-scraped content for phase-2 reuse,
     and send a "feed health report" to Telegram.

Runs every 4 hours.
"""

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from loguru import logger

from octragon.config import OctragonConfig, get_config
from octragon.db import OctragonDB
from octragon.models import NicheType, TargetPlatform

# ─── Config ───────────────────────────────────────────────────────────────────

DISCOVER_INTERVAL_HOURS = 4
TOP_N_PER_PHONE = 3

NICHE_MAP: dict[int, tuple[NicheType, list[TargetPlatform]]] = {
    1: (NicheType.ECOM,      [TargetPlatform.TIKTOK, TargetPlatform.INSTAGRAM]),
    2: (NicheType.AI_TECH,   [TargetPlatform.TIKTOK, TargetPlatform.INSTAGRAM]),
    3: (NicheType.BUSINESS,  [TargetPlatform.TIKTOK, TargetPlatform.INSTAGRAM, TargetPlatform.LINKEDIN]),
    4: (NicheType.LIFESTYLE, [TargetPlatform.TIKTOK, TargetPlatform.INSTAGRAM]),
}

NICHE_EMOJI = {1: "🛒", 2: "🤖", 3: "💼", 4: "💪"}


# ─── Telegram sender ──────────────────────────────────────────────────────────

async def _send_telegram(config: OctragonConfig, group_id: str, text: str) -> None:
    if not config.telegram_bot_token or not group_id:
        return
    try:
        from telegram import Bot
        bot = Bot(token=config.telegram_bot_token)
        await bot.send_message(
            chat_id=group_id,
            text=text,
            parse_mode="Markdown",
            disable_web_page_preview=True,
        )
    except Exception as e:
        logger.error(f"[Scheduler] Telegram send failed: {e}")


# ─── Cookie check ─────────────────────────────────────────────────────────────

def _has_tiktok_cookies(config: OctragonConfig) -> bool:
    if not config.yt_dlp_cookies_dir:
        return False
    p = Path(config.yt_dlp_cookies_dir) / "tiktok_cookies.txt"
    return p.exists() and p.stat().st_size > 100


# ─── Mode A: Automated discovery (cookies present) ───────────────────────────

async def run_automated_discovery(
    config: OctragonConfig,
    db: OctragonDB,
    phone: int,
    niche: NicheType,
    platforms: list[TargetPlatform],
    group_id: str,
) -> dict:
    """Pull creator feeds, score, and send top-N to Telegram."""
    from octragon.scraper.discovery import CompetitorDiscovery, NICHE_CREATORS
    from octragon.scraper.scorer import rank_candidates

    discovery = CompetitorDiscovery(config)
    candidates = await discovery.run_discovery_for_phone(phone, niche, platforms)
    top = rank_candidates(candidates, niche, top_n=TOP_N_PER_PHONE)

    if not top:
        logger.info(f"[Scheduler] Phone {phone}: no candidates above threshold")
        return {"mode": "automated", "candidates": len(candidates), "top": 0}

    emoji = NICHE_EMOJI.get(phone, "📱")
    lines = [f"{emoji} *Phone {phone} — Top Picks*\n"]
    for i, s in enumerate(top, 1):
        c = s.candidate
        platform_emoji = {"tiktok": "🎵", "instagram": "📸", "linkedin": "💼"}.get(c.platform.value, "🎬")
        lines.append(
            f"*{i}. {platform_emoji} Score: {s.virality_score}/100*\n"
            f"👤 @{c.creator}\n"
            f"👁 {c.view_count:,} views · ❤️ {c.like_count:,} · ER: {s.engagement_rate}%\n"
            f"🔗 {c.url}\n"
        )
    lines.append("_Drop any URL above to scrape it →_")
    await _send_telegram(config, group_id, "\n".join(lines))

    return {"mode": "automated", "candidates": len(candidates), "top": len(top)}


# ─── Mode B: Feed health report (no cookies) ─────────────────────────────────

async def run_feed_health_report(
    config: OctragonConfig,
    db: OctragonDB,
    phone: int,
    niche: NicheType,
    group_id: str,
) -> dict:
    """
    Analyze existing DB for this phone:
    - How many videos in pipeline?
    - Any stuck in pending?
    - Variations ready for posting?
    - Suggest re-scraping top performers.
    """
    stats = db.get_pipeline_stats()
    phone_stats = stats["by_phone"].get(phone, {"scraped": 0, "posted": 0})
    pending_scrapes = db.get_pending_scrapes(phone)
    approved_queue = db.get_approved_pending_post(phone)

    emoji = NICHE_EMOJI.get(phone, "📱")
    scraped = phone_stats.get("scraped", 0)
    posted = phone_stats.get("posted", 0)

    lines = [
        f"{emoji} *Phone {phone} — Pipeline Health*\n",
        f"📥 Scraped: {scraped} videos",
        f"✅ Posted: {posted} videos",
        f"⏳ Pending scrapes: {len(pending_scrapes)}",
        f"📤 Approved & ready to post: {len(approved_queue)}",
    ]

    if len(pending_scrapes) > 3:
        lines.append(f"\n⚠️ {len(pending_scrapes)} videos stuck pending. Check Telegram bot or re-drop URLs.")
    if scraped == 0:
        lines.append(f"\n💡 *Drop a viral video URL here to start the pipeline!*")
        lines.append("Supported: TikTok, Instagram Reels, LinkedIn videos")
    elif len(approved_queue) > 0:
        lines.append(f"\n🚀 {len(approved_queue)} video(s) approved. Ready to post!")

    lines.append(f"\n🕐 Next health check in {DISCOVER_INTERVAL_HOURS}h")
    await _send_telegram(config, group_id, "\n".join(lines))

    return {
        "mode": "health_report",
        "scraped": scraped,
        "posted": posted,
        "pending": len(pending_scrapes),
        "ready": len(approved_queue),
    }


# ─── Radar sweep (fast pre-scan) ──────────────────────────────────────────────

async def run_radar_sweep(config: OctragonConfig) -> dict:
    """Run a fast radar sweep across all phones using the lightweight scanner."""
    from octragon.scraper.radar import RadarScanner
    from octragon.scraper.scorer import rank_candidates

    scanner = RadarScanner(config)
    try:
        all_results = await scanner.sweep_all_phones()
        summary = {}
        for phone, candidates in all_results.items():
            niche = NICHE_MAP.get(phone, (NicheType.ECOM, []))[0]
            top = rank_candidates(candidates, niche, top_n=TOP_N_PER_PHONE)
            summary[phone] = {
                "candidates": len(candidates),
                "top_scored": len(top),
                "best_score": top[0].virality_score if top else 0,
            }
            # Send top picks to Telegram
            if top:
                group_id = config.telegram_group_ids.get(phone, "")
                emoji = NICHE_EMOJI.get(phone, "📱")
                lines = [f"{emoji} *Phone {phone} — Radar Picks*\n"]
                for i, s in enumerate(top, 1):
                    c = s.candidate
                    lines.append(
                        f"*{i}. Score: {s.virality_score}/100*\n"
                        f"👤 @{c.creator}\n"
                        f"👁 {c.view_count:,} views · ❤️ {c.like_count:,}\n"
                        f"🔗 {c.url}\n"
                    )
                lines.append("_Drop any URL above to scrape it >>_")
                await _send_telegram(config, group_id, "\n".join(lines))
        logger.success(f"[Radar] Sweep complete: {summary}")
        return summary
    finally:
        await scanner.close()


# ─── Garbage collection ──────────────────────────────────────────────────────

def run_gc_cycle(config: OctragonConfig, db: OctragonDB) -> dict:
    """Run the garbage collector as part of the scheduler cycle."""
    from octragon.retention.gc import GarbageCollector
    gc = GarbageCollector(config, db)
    return gc.run(dry_run=False)


# ─── Main cycle ───────────────────────────────────────────────────────────────

async def run_discovery_cycle(config: OctragonConfig, db: OctragonDB) -> dict:
    """Run one full cycle for all 4 phones."""
    has_cookies = _has_tiktok_cookies(config)
    mode = "automated" if has_cookies else "health_report"
    logger.info(f"[Scheduler] Starting cycle — mode: {mode}")

    # Step 1: Radar sweep (fast, no auth needed)
    radar_results = {}
    try:
        radar_results = await run_radar_sweep(config)
    except Exception as e:
        logger.warning(f"[Scheduler] Radar sweep failed (non-fatal): {e}")

    # Step 2: Discovery (cookies-dependent)
    niche_configs = {nc.phone_number: nc for nc in db.get_all_niche_configs()}
    results = {}

    for phone, (default_niche, default_platforms) in NICHE_MAP.items():
        nc = niche_configs.get(phone)
        if nc:
            try:
                platforms = [TargetPlatform(p) for p in json.loads(nc.platforms)]
            except Exception:
                platforms = default_platforms
            try:
                niche = NicheType(nc.niche)
            except Exception:
                niche = default_niche
            group_id = nc.telegram_group_id
        else:
            niche, platforms = default_niche, default_platforms
            group_id = config.telegram_group_ids.get(phone, "")

        try:
            if has_cookies:
                result = await run_automated_discovery(config, db, phone, niche, platforms, group_id)
            else:
                result = await run_feed_health_report(config, db, phone, niche, group_id)
        except Exception as e:
            logger.exception(f"[Scheduler] Phone {phone} failed: {e}")
            result = {"error": str(e)}

        results[phone] = result

    # Step 3: Garbage collection
    gc_results = {}
    try:
        gc_results = run_gc_cycle(config, db)
    except Exception as e:
        logger.warning(f"[Scheduler] GC failed (non-fatal): {e}")

    logger.success(f"[Scheduler] Cycle done — discovery: {results}, radar: {radar_results}, gc: {gc_results}")
    return {"discovery": results, "radar": radar_results, "gc": gc_results}


async def run_scheduler_loop(interval_hours: float = DISCOVER_INTERVAL_HOURS) -> None:
    """Infinite loop running discovery every interval_hours."""
    config = get_config()
    db = OctragonDB(config.db_path)
    logger.info(f"[Scheduler] Starting loop — interval: {interval_hours}h")
    while True:
        try:
            await run_discovery_cycle(config, db)
        except Exception as e:
            logger.exception(f"[Scheduler] Cycle failed: {e}")
        await asyncio.sleep(interval_hours * 3600)


async def run_once() -> dict:
    """Run a single cycle (used by run.py discover)."""
    config = get_config()
    db = OctragonDB(config.db_path)
    return await run_discovery_cycle(config, db)
