#!/usr/bin/env python3
"""
Octragon System — Phase 6 Auditor Script
Simulates the Telegram ingestion flow to feed the database
with a real video, forge it, create delivery logs, and set it
to pending approval so the Dashboard can be smoke tested.
"""

import asyncio
import sys
from pathlib import Path
from loguru import logger

from octragon.config import get_config
from octragon.db import OctragonDB
from octragon.models import NicheType, DeliveryLog, TargetPlatform
from octragon.scraper.engine import OctragonScraper, detect_platform
from octragon.forgery.pipeline import VariationGenerator
from octragon.metadata.injector import MetadataInjector

async def run_audit(url: str):
    config = get_config()
    db = OctragonDB(config.db_path)
    scraper = OctragonScraper(config)
    forger = VariationGenerator(config)
    injector = MetadataInjector(config)

    niche = db.get_niche_config(1)  # Phone 1
    if not niche:
        logger.error("Phone 1 niche config not found. Run setup.")
        return

    platform = detect_platform(url)
    if not platform:
        logger.error("Invalid URL")
        return

    logger.info(f"== AUDIT START ==")
    logger.info(f"Target URL: {url}")

    import urllib.request
    from octragon.models import ScrapedContent, TargetPlatform, ScrapeStatus
    
    logger.info("Downloading test MP4 bypass...")
    test_url = "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
    temp_dir = config.videos_dir / "raw"
    temp_dir.mkdir(parents=True, exist_ok=True)
    video_path = temp_dir / "audit_test_video.mp4"
    
    if not video_path.exists():
        urllib.request.urlretrieve(test_url, video_path)
        
    sc = ScrapedContent(
        source_url=url,
        target_phone=niche.phone_number,
        target_niche=niche.niche,
        source_platform=platform,
        video_path=str(video_path),
        scrape_status=ScrapeStatus.DOWNLOADED,
        caption="This is a real smoke test video caption. We bypassed yt-dlp to get here. #business",
        source_creator="@audit_tester",
        engagement_views=1500000,
        engagement_likes=120000,
        engagement_comments=4500,
        telegram_group_id=niche.telegram_group_id,
        video_hash="dummyhash12345"
    )
    sc.generate_id()
    db.upsert_scraped_content(sc)
    
    # 2. Forge
    logger.info("Forging 3 variations...")
    variations = await forger.generate(
        scraped_content_id=sc.id,
        video_path=sc.video_path,
        gps_lat_center=niche.gps_lat_center,
        gps_lon_center=niche.gps_lon_center,
        device_profile=niche.device_profile,
    )

    for var in variations:
        db.save_variation(var)

    # 3. Inject Metadata
    logger.info("Injecting metadata...")
    await injector.inject_all(variations, sc.id)
    for var in variations:
        db.update_variation_status(var.id, var.cleanse_status, metadata_injected=True)

    # 4. Create Delivery Logs
    logger.info("Creating Delivery Logs...")
    for var in variations:
        for t_plat in niche.platforms:
            account = ""
            if t_plat == TargetPlatform.TIKTOK: account = niche.tiktok_handle
            elif t_plat == TargetPlatform.INSTAGRAM: account = niche.instagram_handle
            elif t_plat == TargetPlatform.LINKEDIN: account = niche.linkedin_handle
            
            dl = DeliveryLog(
                variation_id=var.id,
                scraped_content_id=sc.id,
                phone_number=niche.phone_number,
                target_platform=t_plat,
                target_account=account,
                telegram_group_id=niche.telegram_group_id,
                telegram_message_id=999 # dummy ID
            )
            dl.generate_id()
            db.save_delivery(dl)
    
    logger.success("== AUDIT INGESTION COMPLETE ==")
    logger.info(f"-> Scraped ID: {sc.id}")
    logger.info(f"-> Variations: {[v.id for v in variations]}")
    logger.info("Now check the Dashboard!")

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://www.tiktok.com/@midjourney.gallery/video/7339227599023066374"
    asyncio.run(run_audit(url))
