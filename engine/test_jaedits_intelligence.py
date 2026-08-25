import asyncio
import os
import json
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from loguru import logger

from octragon.config import get_config
from octragon.db import OctragonDB
from octragon.models import Account, TargetPlatform, NicheType, AccountType, SourcePlatform
from octragon.scraper.engine import OctragonScraper
from octragon.cmo.agent import CMOAgent
from octragon.scraper.discovery import CompetitorDiscovery

async def run_test():
    config = get_config()
    db = OctragonDB(config.db_path)
    agent = CMOAgent(config, db)
    scraper = OctragonScraper(config)

    handle = "jaedits66"

    # 1. Ensure account exists in DB
    import hashlib
    def hashlib_id(raw: str) -> str:
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    account_id = hashlib_id(f"account:test:tiktok:{handle}")
    existing = db.get_account(account_id)
    if not existing:
        acct = Account(
            id=account_id,
            platform=TargetPlatform.TIKTOK,
            handle=f"@{handle}",
            niche=NicheType.AI_TECH,
            phone_number=1,
            account_type=AccountType.PERSONAL
        )
        db.save_account(acct)
        logger.info(f"Created test account: {acct.handle}")
    else:
        acct = existing

    # 2. Native Discovery Engine (Autonomous extraction)
    logger.info(f"Running autonomous discovery for @{handle}...")
    discovery = CompetitorDiscovery(config)

    # We treat @jaedits66 as a discovery target
    candidates = await discovery.discover_creator(
        handle=f"@{handle}",
        platform=SourcePlatform.TIKTOK,
        niche=acct.niche,
        phone=acct.phone_number,
        targets={"videos_per_creator": 5, "min_views": 0, "min_likes": 0}
    )

    if not candidates:
        logger.warning(f"Engine found 0 candidates for @{handle}. Check if profile is public.")
        return

    logger.info(f"Engine discovered {len(candidates)} candidates. Proceeding to autonomous scrape & analysis...")

    # 3. Scrape and Analyze
    for can in candidates:
        try:
            logger.info(f"--- Scraping candidate: {can.url[:60]} ---")
            sc = await scraper.scrape(can.url, target_niche=acct.niche, target_phone=acct.phone_number)
            db.save_scraped_content(sc)

            logger.info(f"--- Analyzing content {sc.id[:8]} ---")
            analysis = agent.analyze_content(sc.id, acct.id)

            # Audit check
            print(f"\n[AUDIT] Video: {can.url}")
            print(f"Verdict: {analysis.verdict.value.upper()}")
            print(f"CMO Score: {analysis.cmo_score}/100")
            print(f"Axis Scores: Hook={analysis.axis_hook_power}, Gap={analysis.axis_curiosity_gap}, Emotions={analysis.axis_emotional_velocity}, Retention={analysis.axis_retention_architecture}")
            print(f"Why Worked: {analysis.why_worked}")
            print(f"Why Failed: {analysis.why_failed}")
            print(f"Viral Atoms: {analysis.viral_atoms_json}")
            print(f"Multimodal sensing: Embedding size = {len(json.loads(analysis.embedding_json or '[]'))}")
            print(f"Transcription/Caption: {sc.caption[:100]}...")

        except Exception as e:
            logger.error(f"Failed to process {can.url}: {e}")

    # 4. Update Viral DNA and Prescribe
    logger.info("--- Updating Viral DNA Profile ---")
    vdna = agent.update_viral_dna(acct.id)
    if vdna:
        print(f"\n[DNA AUDIT] Genome Signature: {vdna.genome_signature}")
        print(f"Top 3 Winning Hooks: {vdna.top_hooks[:3]}")
    else:
        print("\n[DNA AUDIT] DNA Profile Update Failed.")

    logger.info("--- Generating Next Post Prescription ---")
    prescription = agent.prescribe_next_post(acct.id)
    if prescription.hook:
        print(f"\n[PRESCRIPTION AUDIT] Hook: {prescription.hook}")
        print(f"Rationale: {prescription.rationale}")
    else:
        print("\n[PRESCRIPTION AUDIT] Next Post Prescription Failed.")

    db.close()

if __name__ == "__main__":
    asyncio.run(run_test())
