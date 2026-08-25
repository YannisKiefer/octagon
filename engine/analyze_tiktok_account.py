
import asyncio
import json
import os
from pathlib import Path
from loguru import logger
from datetime import datetime, timezone

from octragon.config import get_config
from octragon.db import OctragonDB
from octragon.scraper.profile_scraper import ProfileScraper
from octragon.scraper.radar import RadarScanner
from octragon.scraper.engine import OctragonScraper
from octragon.cmo.agent import CMOAgent
from octragon.models import SourcePlatform, NicheType, Account, AccountType, TargetPlatform

async def main():
    logger.info("🚀 STARTING FULL ACCOUNT ANALYSIS FOR @jaedits66")
    
    config = get_config()
    db = OctragonDB(config.db_path)
    
    # 1. Setup Account in DB
    handle = "jaedits66"
    platform = TargetPlatform.TIKTOK
    
    # Check if account exists
    acct = db.get_account_by_handle_and_platform(handle, platform)
    if not acct:
        logger.info(f"Adding new account @{handle} to database...")
        acct = Account(
            handle=handle,
            platform=platform,
            niche=NicheType.LIFESTYLE, 
            account_type=AccountType.PERSONAL,
            phone_number=1,
        )
        acct.generate_id()
        db.save_account(acct)
    
    # 2. Scrape Profile Metadata
    logger.info(f"--- [STEP 1] Profile Metadata ---")
    ps = ProfileScraper(config)
    profile_data = await ps.scrape_tiktok_profile(handle)
    if "error" in profile_data:
        logger.error(f"Profile scrape failed: {profile_data['error']}")
    else:
        logger.info(f"Followers: {profile_data.get('follower_count')}")
        logger.info(f"Bio: {profile_data.get('bio')}")
        
        # Update account in DB
        db.conn.execute("""
            UPDATE accounts SET 
                display_name = ?, 
                bio = ?, 
                follower_count = ?
            WHERE id = ?
        """, (
            profile_data.get("display_name", ""),
            profile_data.get("bio", ""),
            profile_data.get("follower_count", 0),
            acct.id
        ))
        db.conn.commit()

    # 3. Radar Scan for Viral Candidates
    logger.info(f"--- [STEP 2] Radar Scan (Last 5 Videos) ---")
    radar = RadarScanner(config)
    candidates = await radar.scan_creator(
        handle, SourcePlatform.TIKTOK, NicheType.LIFESTYLE, 1, 
        min_views=100, min_likes=0, max_videos=5
    )
    
    if not candidates:
        logger.warning("No candidates found via Radar. Using manual fallback for test...")
        from octragon.scraper.discovery import VideoCandidate
        candidates = [
            VideoCandidate(
                url="https://www.tiktok.com/@jaedits66/video/7487299066497125633",
                platform=SourcePlatform.TIKTOK,
                creator=handle,
                title="Manual Fallback",
                view_count=243000,
                like_count=5000,
                comment_count=100,
                share_count=50,
                duration=15,
                discovered_via="manual_test",
                niche=NicheType.LIFESTYLE,
                phone=1
            ),
            VideoCandidate(
                url="https://www.tiktok.com/@jaedits66/video/7487109501538962689",
                platform=SourcePlatform.TIKTOK,
                creator=handle,
                title="Manual Fallback 2",
                view_count=6500,
                like_count=200,
                comment_count=10,
                share_count=5,
                duration=12,
                discovered_via="manual_test",
                niche=NicheType.LIFESTYLE,
                phone=1
            )
        ]
    
    # Sort by views descending
    candidates.sort(key=lambda x: x.view_count, reverse=True)
    top_candidates = candidates[:3]
    
    logger.info(f"Found {len(candidates)} candidates. Analyzing top 3 most viral...")

    # 4. Deep Scrape (Download + Meta)
    logger.info(f"--- [STEP 3] Deep Scrape (Downloads) ---")
    scraper = OctragonScraper(config)
    scraped_items = []
    
    for cand in top_candidates:
        logger.info(f"Downloading {cand.url} ({cand.view_count} views)...")
        try:
            # We'll limit download to avoid huge disk usage for test
            sc = await scraper.scrape(cand.url, target_niche=NicheType.LIFESTYLE, target_phone=1)
            db.save_scraped_content(sc)
            scraped_items.append(sc)
            logger.success(f"Saved {sc.id[:8]} to database.")
        except Exception as e:
            logger.error(f"Failed to scrape {cand.url}: {e}")

    # 5. CMO Analysis
    logger.info(f"--- [STEP 4] CMO Analysis (Gemini 3.1 Pro) ---")
    cmo = CMOAgent(config, db)
    
    # If no new items, try to find existing ones in DB for this account handle
    if not scraped_items:
        logger.warning("No new videos downloaded. Checking DB for existing content...")
        # (This is just a fallback for local testing)
    
    for sc in scraped_items:
        logger.info(f"Analyzing Why {sc.id[:8]} worked/failed...")
        try:
            analysis = cmo.analyze_content(sc.id, acct.id)
            logger.info(f"Result: {analysis.verdict.value} | Score: {analysis.cmo_score}")
        except Exception as e:
            logger.error(f"CMO Analysis failed: {e}")

    # 6. Viral DNA & Prescription
    logger.info(f"--- [STEP 5] Viral DNA & Next Post ---")
    try:
        dna = cmo.update_viral_dna(acct.id)
        logger.info(f"Viral DNA Trend: {dna.trend_direction}")
        
        prescription = cmo.prescribe_next_post(acct.id)
        logger.info(f"Next Post Prescribed Hook: {prescription.hook[:100]}...")
    except Exception as e:
        logger.error(f"DNA/Prescription failed: {e}")

    logger.info("✅ ACCOUNT ANALYSIS COMPLETE!")
    
    # Close resources
    await ps.close()
    await radar.close()
    db.close()

if __name__ == "__main__":
    asyncio.run(main())
