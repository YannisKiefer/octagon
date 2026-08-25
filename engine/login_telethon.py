import asyncio
from telethon import TelegramClient

from octragon.config import get_config

async def main():
    print("==========================================")
    print("  OCTAGON TELETHON USERBOT LOGIN SCRIPT  ")
    print("==========================================")
    
    config = get_config()
    
    api_id = config.telethon_api_id
    api_hash = config.telethon_api_hash
    
    if not api_id or not api_hash:
        print("ERROR: TELETHON_API_ID or TELETHON_API_HASH not found in .env!")
        return
        
    session_path = str(config.db_path.parent.parent / "anon.session")
    
    print("\nThis script will log into your Telegram User account to ")
    print("generate 'anon.session' which allows the bot to DM @clicklead_media_bot.")
    print("Please enter your phone number with country code (e.g. +41...)")
    
    # Initialize the client
    client = TelegramClient(session_path, int(api_id), api_hash)
    
    await client.start()
    
    print("\n✅ SUCCESS! Session saved to anon.session")
    print("You can now securely use the Telethon API in the Octragon pipeline.")
    
    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
