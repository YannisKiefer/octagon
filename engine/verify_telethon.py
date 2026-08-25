import asyncio
from pathlib import Path
from loguru import logger
from octragon.config import get_config
from octragon.metadata.telethon_client import MediaUnicumTelethonClient

async def main():
    video = Path("test.mp4")
    out = Path("test_telethon_stripped.mp4")
    
    if not video.exists():
        logger.error(f"Test video {video} not found")
        return
        
    logger.info(f"Testing Telethon API on {video.name} ...")
    
    config = get_config()
    client = MediaUnicumTelethonClient(config)
    
    res = await client.strip_metadata(video, out)
    if res:
        logger.success(f"SUCCESS! The Userbot successfully DMed @clicklead_media_bot and saved to {res}")
    else:
        logger.error("FAILED to strip video via Telethon")

if __name__ == "__main__":
    asyncio.run(main())
