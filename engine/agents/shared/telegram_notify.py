"""Shared Telegram notification helper for all outreach scripts."""
import json
import logging
import urllib.request
from pathlib import Path

log = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).parent.parent / "config" / "api_keys.json"
_BOT_TOKEN = None
_CHAT_ID = None


def _load_config():
    global _BOT_TOKEN, _CHAT_ID
    if _BOT_TOKEN and _CHAT_ID:
        return
    try:
        with open(_CONFIG_PATH) as f:
            cfg = json.load(f)
        _BOT_TOKEN = cfg.get("telegram_bot_token", "").strip()
        _CHAT_ID = cfg.get("telegram_chat_id", "").strip()
    except Exception as exc:
        log.warning("Could not load Telegram config: %s", exc)


def send(message: str) -> bool:
    """Send a message to the configured Telegram chat. Returns True on success."""
    _load_config()
    if not _BOT_TOKEN or not _CHAT_ID:
        log.debug("Telegram not configured — skipping notification")
        return False
    try:
        url = "https://api.telegram.org/bot%s/sendMessage" % _BOT_TOKEN
        data = json.dumps({"chat_id": _CHAT_ID, "text": message, "parse_mode": "HTML"}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read())
        return result.get("ok", False)
    except Exception as exc:
        log.warning("Telegram send failed: %s", exc)
        return False
