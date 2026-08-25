"""
Patch: add send_dm_via_instagrapi() to ig_dm_sender.py.
Replaces clothefobia/Apify DM sender with free instagrapi equivalent.

Drop-in replacement: same signature, returns bool.
"""


def send_dm_via_instagrapi(username: str, message: str, cl) -> bool:
    """
    Send Instagram DM via instagrapi (free, uses Instagram private API).
    cl = authenticated instagrapi Client (already logged in).
    Returns True on success, False on failure.
    """
    import logging
    logger = logging.getLogger(__name__)
    try:
        user_info = cl.user_info_by_username(username)
        thread = cl.direct_send(message, [user_info.pk])
        thread_id = thread.id if hasattr(thread, "id") else str(thread)
        logger.info(f"DM sent to @{username} (thread: {thread_id})")
        return True
    except Exception as e:
        logger.error(f"instagrapi DM failed @{username}: {e}")
        return False
