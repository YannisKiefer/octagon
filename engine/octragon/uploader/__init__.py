"""
Octragon Auto-Upload Engine

Posts approved video variations to social media platforms.
Architecture:
  - uploader/tiktok.py   — TikTok Content Posting API v2
  - uploader/instagram.py — Instagram Graph API (Reels)
  - uploader/linkedin.py  — LinkedIn Share API (video)
  - uploader/orchestrator.py — Pulls approved delivery queue, routes to platform
"""
