#!/usr/bin/env python3
"""
Octragon System — Entry Point

Usage:
  python run.py bot              # Start the Telegram bot
  python run.py scrape <url>     # Test scrape a single URL
  python run.py edit <url|path>  # Test the Agentic Video Editor
  python run.py discover         # Run one discovery cycle (all 4 phones)
  python run.py radar            # Run one radar sweep (fast, no cookies needed)
  python run.py gc [--execute]   # Run garbage collector (dry-run by default)
  python run.py cmo              # Run the Gemini 3.1 Pro CMO strategy loop
  python run.py cmo-deep          # Run deep analysis: Why Analysis + Viral DNA + Next Post (all accounts)
  python run.py daily-brief       # Run daily briefing: health scores + to-dos (all 20 accounts)
  python run.py scrape-profiles   # Scrape profile data (avatar, bio, followers) for all accounts
  python run.py schedule         # Start 4h discovery loop
  python run.py post             # Process approved delivery queue once
  python run.py postloop         # Start 30-min post scheduler loop
  python run.py caption <niche> <context>  # Generate captions for a niche
  python run.py embed            # Back-fill embeddings for existing scraped content
  python run.py status           # Show pipeline stats
  python run.py setup            # Seed DB with niche configs
"""

import asyncio
import sys
from pathlib import Path
from loguru import logger

# Add project to path
sys.path.insert(0, str(Path(__file__).parent))

from octragon.config import get_config
from octragon.db import OctragonDB
from octragon.env_check import validate_env


def cmd_bot():
    """Start the Telegram bot."""
    from octragon.telegram.bot import OctragonBot
    bot = OctragonBot()
    bot.run()


async def cmd_scrape(url: str):
    """Test scrape a single URL and run full pipeline."""
    config = get_config()
    db = OctragonDB(config.db_path)

    from octragon.scraper.engine import OctragonScraper, detect_platform
    from octragon.forgery.pipeline import VariationGenerator
    from octragon.metadata.injector import MetadataInjector
    from octragon.models import NicheType

    platform = detect_platform(url)
    if not platform:
        logger.error(f"Unsupported URL: {url}")
        return

    logger.info(f"Testing pipeline for: {url}")
    scraper = OctragonScraper(config)
    forger = VariationGenerator(config)
    injector = MetadataInjector(config)

    # Scrape
    sc = await scraper.scrape(url, target_niche=NicheType.ECOM, target_phone=1)
    db.upsert_scraped_content(sc)  # auto-embeds via _auto_embed_after_upsert
    logger.success(f"Scraped: {sc.id} — {sc.video_hash[:12]}")

    # Forge
    variations = await forger.generate(sc.id, sc.video_path)
    for v in variations:
        db.save_variation(v)
        logger.success(f"Variation {v.variation_label}: {v.video_hash[:12]}")

    # Inject metadata
    ready_paths = await injector.inject_all(variations, sc.id)
    for path in ready_paths:
        logger.success(f"Ready: {path}")

    # Stats
    stats = db.get_pipeline_stats()
    logger.info(f"DB Stats: {stats}")


def cmd_status():
    """Show pipeline stats."""
    config = get_config()
    db = OctragonDB(config.db_path)
    stats = db.get_pipeline_stats()
    print("\n=== OCTAGON PIPELINE STATUS ===")
    print(f"Total scraped:      {stats.get('total_scraped', 0)}")
    print(f"Pending scrapes:    {stats.get('pending_scrapes', 0)}")
    print(f"Total variations:   {stats.get('total_variations', 0)}")
    print(f"Variations ready:   {stats.get('variations_ready', 0)}")
    print(f"Pending approvals:  {stats.get('pending_approvals', 0)}")
    print(f"Total delivered:    {stats.get('total_delivered', 0)}")
    print("\n--- Per Phone ---")
    for phone, stats_phone in stats.get("by_phone", {}).items():
        nc = db.get_niche_config(phone)
        niche_name = nc.niche_name if nc else f"Phone {phone}"
        print(f"Phone {phone} ({niche_name}): "
              f"{stats_phone.get('scraped', 0)} scraped, "
              f"{stats_phone.get('posted', 0)} posted")


def cmd_setup():
    """Seed DB with default niche configs and verify setup."""
    config = get_config()
    db = OctragonDB(config.db_path)

    print("\n=== OCTAGON SETUP ===")
    print(f"DB: {config.db_path}")
    print(f"Videos: {config.videos_dir}")
    print()

    for nc in config.niche_configs:
        db.save_niche_config(nc)
        platforms = ", ".join(p.value.title() for p in nc.platforms)
        print(f"✅ Phone {nc.phone_number}: {nc.niche_name}")
        print(f"   Group: {nc.telegram_group_id}")
        print(f"   Platforms: {platforms}")
        print(f"   TikTok: {nc.tiktok_handle or '(not set)'}")
        print(f"   Instagram: {nc.instagram_handle or '(not set)'}")
        if nc.linkedin_handle:
            print(f"   LinkedIn: {nc.linkedin_handle}")
        print()

    print("✅ Setup complete. Run: python run.py bot")


async def cmd_discover():
    """Run one competitor discovery cycle across all 4 phones."""
    from octragon.scraper.scheduler import run_once
    from octragon.scraper.scorer import rank_candidates
    print("\n=== OCTAGON DISCOVERY CYCLE ===")
    summary = await run_once()
    for phone, data in summary.items():
        print(f"Phone {phone}: {data.get('candidates', 0)} candidates → {data.get('top', 0)} top picks sent")
    print("\n✅ Discovery cycle complete")


def cmd_schedule():
    """Start the 4-hour discovery scheduler loop."""
    from octragon.scraper.scheduler import run_scheduler_loop
    logger.info("[Run] Starting discovery scheduler (every 4h)…")
    asyncio.run(run_scheduler_loop())


async def cmd_post():
    """Process all approved deliveries once."""
    from octragon.uploader.orchestrator import run_once
    print("\n=== OCTAGON DELIVERY ===")
    summary = await run_once()
    print(f"Total: {summary['total']} | Posted: {summary['posted']} | Failed: {summary['failed']}")
    print("\n✅ Delivery run complete")


def cmd_postloop():
    """Start the 30-min auto-post scheduler loop."""
    from octragon.uploader.orchestrator import run_post_scheduler
    logger.info("[Run] Starting post scheduler (every 30min)…")
    asyncio.run(run_post_scheduler())


async def cmd_caption(niche_str: str, context_text: str):
    """Generate viral captions for a niche + context."""
    from octragon.caption.engine import CaptionEngine, Platform, get_default_platforms
    from octragon.models import NicheType

    try:
        niche = NicheType(niche_str)
    except ValueError:
        niches = [n.value for n in NicheType]
        print(f"Unknown niche '{niche_str}'. Valid: {niches}")
        return

    config = get_config()
    engine = CaptionEngine(config)
    platforms = get_default_platforms(niche)

    print(f"\n=== OCTAGON CAPTIONS: {niche.value.upper()} ===")
    print(f"Context: {context_text}\n")

    results = await engine.generate_all_platforms(
        niche=niche,
        video_context=context_text,
        platforms=platforms,
    )

    for platform, result in results.items():
        if not result:
            print(f"\n[{platform.value.upper()}] FAILED")
            continue
        sep = "-" * 60
        print(f"\n{sep}")
        print(f"[{platform.value.upper()}] ({result.char_count} chars)")
        print(sep)
        print(result.full_post)

    print("\n\u2705 Caption generation complete")


async def cmd_edit(target: str):
    """Run the Agentic Video Editor on a URL or local file."""
    from octragon.video_editor.pipeline import VideoEditorPipeline, EditStatus
    config = get_config()

    print("\n=== OCTAGON AGENTIC VIDEO EDITOR ===")
    pipeline = VideoEditorPipeline(config)

    try:
        if target.startswith("http"):
            print(f"\u2b07\ufe0f  Downloading: {target}")
            result = await pipeline.process_url(target)
        else:
            print(f"[Video] Processing local file: {target}")
            result = await pipeline.process(target)

        print(f"\n--- Result ---")
        print(f"Status: {result.status.value}")
        if result.decision:
            print(f"AI Decision: {result.decision.action.value} ({result.decision.confidence:.0%})")
            print(f"Reasoning: {result.decision.reasoning}")
            if result.decision.watermark_locations:
                print(f"Watermarks found: {', '.join(result.decision.watermark_locations)}")
        print(f"Time: {result.processing_time_seconds:.1f}s")

        if result.status == EditStatus.SUCCESS:
            print(f"\n\u2705 Output: {result.output_path}")
        elif result.status == EditStatus.REJECTED:
            print(f"\n\u274c Rejected: {result.error_message}")
        else:
            print(f"\n\u274c Error: {result.error_message}")
    finally:
        await pipeline.close()



async def cmd_radar():
    """Run one radar sweep (fast, no cookies needed)."""
    from octragon.scraper.scheduler import run_radar_sweep
    config = get_config()
    print("[Radar] Starting sweep across all phones...")
    results = await run_radar_sweep(config)
    for phone, data in results.items():
        print(f"  Phone {phone}: {data.get('candidates', 0)} candidates, "
              f"{data.get('top_scored', 0)} scored, "
              f"best={data.get('best_score', 0)}")
    print("[Radar] Done.")


async def cmd_gc(execute: bool = False):
    """Run garbage collector."""
    from octragon.retention.gc import GarbageCollector
    config = get_config()
    db = OctragonDB(config.db_path)
    gc = GarbageCollector(config, db)
    mode = "EXECUTE" if execute else "DRY RUN"
    print(f"[GC] Running in {mode} mode...")
    result = gc.run(dry_run=not execute)
    print(f"[GC] Result: {result}")


def cmd_cmo():
    """Run the Gemini 3.1 Pro CMO Agent strategy generation."""
    from octragon.cmo.agent import CMOAgent
    print("[CMO] Initializing Gemini 3.1 Pro strategic analysis...")
    try:
        agent = CMOAgent()
        result = agent.generate_strategy()
        print("\n[CMO] Weekly Strategy complete. Sample:")
        print(f"Executive Summary: {result.get('strategy', {}).get('executive_summary', 'N/A')}")
        print(f"AI Confidence: {result.get('strategy', {}).get('ai_confidence_score', 'N/A')}/100")
    except Exception as e:
        print(f"[CMO] Failed: {e}")
        logger.exception("CMO Error")


def cmd_cmo_deep():
    """Run the full deep CMO analysis: Why Analysis → Viral DNA → Next Post for all accounts."""
    from octragon.cmo.agent import CMOAgent
    print("[CMO-Deep] Initializing deep analysis across all 8 accounts...")
    try:
        agent = CMOAgent()
        result = agent.run_deep_analysis()
        print(f"\n[CMO-Deep] Results:")
        print(f"  Accounts processed: {result['accounts_processed']}")
        print(f"  Content analyses:   {result['analyses']}")
        print(f"  DNA profiles:       {result['dna_updated']}")
        print(f"  Posts prescribed:   {result['posts_prescribed']}")
    except Exception as e:
        print(f"[CMO-Deep] Failed: {e}")
        logger.exception("CMO-Deep Error")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(0)

    cmd = args[0]

    # Validate env vars for commands that need them
    _needs_supabase = {"schedule", "postloop", "bot"}
    _needs_gemini = {"cmo", "cmo-deep", "daily-brief"}
    validate_env(
        require_supabase=cmd in _needs_supabase,
        require_gemini=cmd in _needs_gemini,
        fatal=True,
    )

    if cmd == "bot":
        cmd_bot()
    elif cmd == "scrape":
        if len(args) < 2:
            print("Usage: python run.py scrape <url>")
            sys.exit(1)
        asyncio.run(cmd_scrape(args[1]))
    elif cmd == "edit":
        if len(args) < 2:
            print("Usage: python run.py edit <url or file path>")
            sys.exit(1)
        asyncio.run(cmd_edit(args[1]))
    elif cmd == "discover":
        asyncio.run(cmd_discover())
    elif cmd == "schedule":
        cmd_schedule()
    elif cmd == "post":
        asyncio.run(cmd_post())
    elif cmd == "postloop":
        cmd_postloop()
    elif cmd == "caption":
        if len(args) < 3:
            print("Usage: python run.py caption <niche> <context text>")
            print("Niches: ecom, ai_tech, business, lifestyle")
            sys.exit(1)
        asyncio.run(cmd_caption(args[1], " ".join(args[2:])))
    elif cmd == "radar":
        asyncio.run(cmd_radar())
    elif cmd == "gc":
        execute = "--execute" in args
        asyncio.run(cmd_gc(execute))
    elif cmd == "cmo":
        cmd_cmo()
    elif cmd == "cmo-deep":
        cmd_cmo_deep()
    elif cmd == "daily-brief":
        from octragon.cmo.agent import CMOAgent
        agent = CMOAgent()
        results = agent.run_daily_briefing()
        print(f"\n✅ Daily Briefing Complete: {results}")
    elif cmd == "scrape-profiles":
        from octragon.scraper.profile_scraper import ProfileScraper
        scraper = ProfileScraper()
        results = asyncio.run(scraper.scrape_all_accounts())
        asyncio.run(scraper.close())
        print(f"\n✅ Profile Scrape Complete: {results}")
    elif cmd == "embed":
        from octragon.intelligence.ingest_hook import batch_embed_unindexed
        config = get_config()
        db = OctragonDB(config.db_path)
        count = batch_embed_unindexed(db=db, limit=200)
        print(f"\n✅ Back-fill complete: {count} embeddings stored")
    elif cmd == "status":
        cmd_status()
    elif cmd == "setup":
        cmd_setup()
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)
