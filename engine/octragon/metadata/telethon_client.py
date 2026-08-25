import asyncio
from pathlib import Path
from typing import Optional

from loguru import logger
from telethon import TelegramClient, events

class MediaUnicumTelethonClient:
    """
    Connects to Telegram as a Userbot to DM @clicklead_media_bot
    directly, totally bypassing the HTTP restrictions.
    """
    def __init__(self, config):
        self.api_id = config.telethon_api_id
        self.api_hash = config.telethon_api_hash
        
        # session is saved in the same directory as octragon.db
        self.session_path = str(config.db_path.parent.parent / "anon.session")
        self.bot_username = "@clicklead_media_bot"
        self.timeout = 300 # 5 minutes max wait
        
    async def strip_metadata(self, video_path: Path, output_path: Optional[Path] = None) -> Optional[Path]:
        if not self.api_id or not self.api_hash:
            logger.warning("[Telethon] TELETHON_API_ID or TELETHON_API_HASH missing. Skipping DM uniquifier.")
            return None
            
        if not Path(self.session_path).exists():
            logger.warning("[Telethon] anon.session not found. Please run login_telethon.py. Skipping DM uniquifier.")
            return None
            
        if output_path is None:
            output_path = video_path.parent / f"{video_path.stem}_stripped.mp4"
            
        client = TelegramClient(self.session_path, int(self.api_id), self.api_hash)
        
        try:
            await client.connect()
            if not await client.is_user_authorized():
                logger.error("[Telethon] User is not authorized. Please run login_telethon.py first.")
                return None
        except Exception as e:
            logger.error(f"[Telethon] Connection failed: {e}")
            return None
            
        logger.info(f"[Telethon] Uploading {video_path.name} to {self.bot_username} via DM...")
        
        response_file = None
        future = asyncio.Future()
        
        @client.on(events.NewMessage(chats=self.bot_username))
        async def handler(event):
            try:
                # Log any message from the bot for debugging
                msg_text = getattr(event, 'text', '[No Text]')
                logger.debug(f"[Telethon] Bot message: {msg_text[:100]}")
                
                # Check for media (video or document)
                if event.message.media:
                    logger.info(f"[Telethon] Media received! Type: {type(event.message.media)}")
                    downloaded_path = await event.download_media(file=str(output_path))
                    if downloaded_path:
                        logger.success(f"[Telethon] Downloaded media to {downloaded_path}")
                        if not future.done():
                            future.set_result(Path(downloaded_path))
                        return
                
                # Handle the "how many copies" prompt
                if hasattr(event, 'text') and event.text:
                    text_lower = event.text.lower()
                    if "количество копий" in text_lower or "how many copies" in text_lower:
                        logger.info("[Telethon] Bot asked for copies. Replying with '1'...")
                        await event.reply("1")
                    elif any(x in text_lower for x in ["ошибка", "лимит"]):
                        logger.warning(f"[Telethon] Bot returned a terminal error message: {event.text}")
                        if not future.done():
                            future.set_result(None)
            except Exception as e:
                logger.error(f"[Telethon] Error in event handler: {e}")
                if not future.done():
                    future.set_exception(e)
            except Exception as e:
                if not future.done():
                    future.set_exception(e)

        try:
            # Send the video file
            await client.send_file(self.bot_username, str(video_path))
            logger.debug(f"[Telethon] Video sent. Waiting for {self.bot_username} to reply...")
            
            # Use a while loop to keep the client running and processing updates
            start_time = asyncio.get_event_loop().time()
            while not future.done():
                if asyncio.get_event_loop().time() - start_time > self.timeout:
                    future.set_exception(asyncio.TimeoutError())
                    break
                await asyncio.sleep(1) # This keeps the loop spinning so Telethon can receive updates
                
            response_file = await future
            
            if response_file:
                size_mb = response_file.stat().st_size / (1024 * 1024)
                logger.success(f"[Telethon] ✅ Downloaded stripped video ({size_mb:.1f}MB)")
            else:
                logger.warning("[Telethon] Bot did not return a valid video. Falling back.")
                
            return response_file
            
        except asyncio.TimeoutError:
            logger.error(f"[Telethon] Timed out waiting {self.timeout}s for {self.bot_username}")
            return None
        except Exception as e:
            logger.error(f"[Telethon] Failed to send/receive video: {e}")
            return None
        finally:
            client.remove_event_handler(handler)
            await client.disconnect()
