import asyncio
import json
import os
from datetime import datetime, timezone
from loguru import logger

from octragon.config import get_config
from octragon.db import OctragonDB
from octragon.cmo.agent import CMOAgent

async def run_audit():
    config = get_config()
    db = OctragonDB(config.db_path)
    agent = CMOAgent(config, db)

    handle = "@jaedits66"
    
    # 1. Find account_id
    res = db.conn.execute("SELECT id FROM accounts WHERE handle = ?", (handle,)).fetchone()
    if not res:
        logger.error(f"Account {handle} not found in DB.")
        return
    account_id = res[0]

    # 2. Get existing scraped content to analyze
    sc_rows = db.conn.execute("SELECT id, source_url, video_path, audio_path, caption FROM scraped_content WHERE source_url LIKE '%jaedits66%'").fetchall()
    
    if not sc_rows:
        logger.error("No scraped content found for @jaedits66.")
        return

    logger.info(f"Auditing AI Intelligence for @jaedits66 ({len(sc_rows)} videos)...")

    # 3. Force re-analysis with Elite CMO
    for row in sc_rows:
        sc_id = row[0]
        url = row[1]
        video_path = row[2]
        
        # Verify file exists
        if not os.path.exists(video_path):
            logger.warning(f"Video file missing: {video_path}. Deep vision may be limited.")

        logger.info(f"--- ELITE CMO ANALYSIS: {sc_id[:8]} ---")
        try:
            # We clear existing analysis to force fresh elite run
            db.conn.execute("DELETE FROM content_analysis WHERE scraped_content_id = ?", (sc_id,))
            db.conn.commit()
            
            # Analyze
            ca = agent.analyze_content(sc_id, account_id)
            
            print(f"\n[INTELLIGENCE AUDIT] Video: {url}")
            print(f"VERDICT: {ca.verdict.value.upper()} (Score: {ca.cmo_score}/100)")
            print(f"AXIS 1 (Hook Power): {ca.axis_hook_power}/10")
            print(f"AXIS 2 (Curiosity Gap): {ca.axis_curiosity_gap}/10")
            print(f"AXIS 3 (Emotional Velocity): {ca.axis_emotional_velocity}/10")
            print(f"AXIS 4 (Retention Architecture): {ca.axis_retention_architecture}/10")
            print(f"WHY WORKED: {ca.why_worked}")
            print(f"WHY FAILED: {ca.why_failed}")
            print(f"STRATEGIC INTERVENTION: {ca.highest_leverage_intervention}")
            print(f"VIRAL ATOMS: {ca.viral_atoms_json}")
            
        except Exception as e:
            logger.error(f"Analysis failed for {sc_id}: {e}")

    # 4. Synthesize Viral DNA
    logger.info("--- ELITE VIRAL DNA SYNTHESIS ---")
    vdna = agent.update_viral_dna(account_id)
    print(f"\n[GENOME AUDIT] Signature: {vdna.genome_signature}")
    print(f"Trajectory: {vdna.trend_direction} ({vdna.trajectory_note})")
    print(f"Strengths: {vdna.dominant_axis_strengths}")
    print(f"Weaknesses: {vdna.critical_axis_weaknesses}")
    print(f"Exploitation Gap: {vdna.competitor_exploitation_gap}")

    # 5. Prescribe Next Post
    logger.info("--- ELITE PRESCRIPTION ---")
    np = agent.prescribe_next_post(account_id)
    print(f"\n[PRESCRIPTION AUDIT]")
    print(f"HOOK: {np.hook}")
    print(f"FORMAT: {np.format_type}")
    print(f"RATIONALE: {np.rationale}")
    print(f"SCRIPT SENTINEL:\n{np.script}")

    db.close()

if __name__ == "__main__":
    asyncio.run(run_audit())
