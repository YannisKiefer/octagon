import asyncio
import logging
from pathlib import Path
from loguru import logger
from octragon.metadata.mediaunicum import strip_metadata_via_web

async def main():
    video = Path("test.mp4")
    out = Path("test_stripped.mp4")
    
    if not video.exists():
        logger.error(f"Test video {video} not found")
        return
        
    logger.info(f"Testing mediaunicum API on {video.name} ...")
    
    res = await strip_metadata_via_web(video, out)
    if res:
        logger.success(f"SUCCESS: Stripped video saved to {res}")
    else:
        logger.error("FAILED to strip video via mediaunicum")

if __name__ == "__main__":
    asyncio.run(main())
