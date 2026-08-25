import asyncio
import os
import shutil
from pathlib import Path

from octragon.config import get_config
from octragon.metadata.injector import MetadataInjector

async def investigate():
    print("\n" + "="*50)
    print("OCTAGON METADATA UNIQUIFIER — LAYER 1 & 2 AUDIT")
    print("="*50 + "\n")
    
    video = Path("test.mp4")
    if not video.exists():
        print("❌ Error: test.mp4 not found. Please provide a real video.")
        return
        
    l1_out = Path("test_layer1.mp4")
    l2_out = Path("test_telethon_stripped.mp4") # Maybe generated from background?
    
    print(f"📁 ORIGINAL VIDEO: {video.name} ({video.stat().st_size / 1024 / 1024:.2f} MB)")
    
    # -------------------------------------------------------------
    # LAYER 1: ExifTool / FFmpeg 5-layer hash bypass + Apple spoofing
    # -------------------------------------------------------------
    print("\n--- 🛡️  LAYER 1 (Local Metadata Spoofing) ---")
    config = get_config()
    injector = MetadataInjector(config)
    
    # Mocking a Variation object just for the injector
    from dataclasses import dataclass
    @dataclass
    class MockParams:
        device_profile: any = config.niche_configs[0].device_profile
        gps_latitude: float = 40.7128
        gps_longitude: float = -74.0060

    @dataclass
    class MockVar:
        video_path: Path
        post_id: str = "T123456"
        variation_label: str = "var0"
        forge_params: MockParams = None
        
    shutil.copy(video, l1_out)
    mock = MockVar(video_path=l1_out, forge_params=MockParams())
    
    await injector.inject_all([mock], "S123456")
    
    print(f"✅ LAYER 1 COMPLETE: {l1_out.name} ({l1_out.stat().st_size / 1024 / 1024:.2f} MB)")
    print("   ↳ Applied: FFmpeg bit-padding, creation_time shift, ExifTool Make/Model spoofing (iPhone 16 Pro)")

    # -------------------------------------------------------------
    # LAYER 2: Telethon DM Uniquifier
    # -------------------------------------------------------------
    print("\n--- 🤖 LAYER 2 (Telethon Cloud Stripping) ---")
    if not l2_out.exists():
        print(f"🚀 Triggering Telethon Cloud Layer for {l1_out.name}...")
        from octragon.metadata.telethon_client import MediaUnicumTelethonClient
        client = MediaUnicumTelethonClient(config)
        
        # Start a timer for the user's expected 20s delay
        print("⏳ Uploading to @clicklead_media_bot and waiting for processing (est. 20-30s)...")
        res = await client.strip_metadata(l1_out, l2_out)
        
        if res and l2_out.exists():
            print(f"✅ LAYER 2 COMPLETE: Saved to {l2_out.name}!")
        else:
            print("❌ LAYER 2 FAILED: Bot did not respond in time or error occurred.")
    
    # Update L1 out path to where it actually saved
    l1_real_out = Path(f"data/videos/ready/S123456/ready_var0.mp4")
    
    print("\n" + "="*50)
    print("🔍 INVESTIGATIVE HASH & BITS CHECK:")
    print("="*50)
    print("\n[MD5 HASHES]")
    os.system(f"md5 -q {video}")
    os.system(f"md5 -q {l1_real_out}")
    if l2_out.exists():
        os.system(f"md5 -q {l2_out}")

    print("\n[EXIF METADATA (Make/Model/Software)]")
    print(f"Original:")
    os.system(f"exiftool {video} | egrep -i 'Make|Model|Software'")
    print(f"\nLayer 1 (Spoofed):")
    os.system(f"exiftool {l1_real_out} | egrep -i 'Make|Model|Software'")
    if l2_out.exists():
        print(f"\nLayer 2 (Telethon):")
        os.system(f"exiftool {l2_out} | egrep -i 'Make|Model|Software'")

if __name__ == "__main__":
    asyncio.run(investigate())
