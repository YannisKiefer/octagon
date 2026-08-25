"""
Test script for the FFmpeg + Gemini Vision Forgery Pipeline.
"""

import asyncio
import os
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from loguru import logger
from octragon.config import get_config
from octragon.forgery.pipeline import VariationGenerator
from octragon.models import DeviceProfile

async def main():
    config = get_config()
    
    # Check for test video
    test_video = sys.argv[1] if len(sys.argv) > 1 else "test.mp4"
    if not Path(test_video).exists():
        logger.error(f"Test video not found: {test_video}")
        logger.info("Usage: python test_forgery.py <path_to_video.mp4>")
        return

    logger.info(f"Testing forgery pipeline on: {test_video}")
    logger.info(f"Gemini API Key present: {bool(config.gemini_api_key)}")

    # Create dummy scraped content ID
    scraped_id = "test_scraped_123"
    
    # Initialize generator
    forger = VariationGenerator(config)
    
    try:
        # Generate variations
        variations = await forger.generate(
            scraped_content_id=scraped_id,
            video_path=test_video,
            gps_lat_center=47.3769,
            gps_lon_center=8.5417,
            device_profile=DeviceProfile.IPHONE_15_PRO
        )
        
        logger.success(f"Generated {len(variations)} variations:")
        for v in variations:
            logger.info(f"  - {v.variation_label}: {v.video_path}")
            logger.info(f"    Hash: {v.video_hash[:12]}...")
            if v.gemini_analysis:
                logger.info(f"    Gemini Analysis: {v.gemini_analysis}")
            
    except Exception as e:
        logger.exception(f"Forgery failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
