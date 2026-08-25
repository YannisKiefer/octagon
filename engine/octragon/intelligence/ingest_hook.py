"""
Octragon Intelligence — Ingest Embedding Hook

Auto-embeds scraped content into the SQLite vector index immediately after
DB upsert. Gracefully no-ops if GEMINI_API_KEY is not configured or if
the content has already been embedded.
"""

from __future__ import annotations

import hashlib
from typing import Optional

from loguru import logger


def auto_embed_scraped_content(
    content_id: str,
    caption: str,
    hashtags: Optional[list] = None,
    niche: str = "",
    account_id: str = "",
    db=None,
) -> bool:
    """Embed and index scraped content immediately after ingest.

    Constructs a rich text string from caption + hashtags, then calls
    SemanticSearch.index_content() to embed and store in content_embeddings.

    Safe to call unconditionally — skips silently on any failure.

    Args:
        content_id:  The scraped_content.id value.
        caption:     The raw caption text.
        hashtags:    List of hashtag strings (no '#' prefix needed).
        niche:       The target_niche value (e.g. 'ecom', 'fitness').
        account_id:  Soft account context (no FK, empty string = global).
        db:          Optional OctragonDB instance (creates one if None).

    Returns:
        True if embedding was stored, False otherwise.
    """
    if not content_id or not caption or not caption.strip():
        return False

    # Check if already embedded to avoid duplicate API calls
    if db is not None:
        try:
            embed_id = f"emb:{content_id}:caption"
            existing = db.conn.execute(
                "SELECT id FROM content_embeddings WHERE id = ?", (embed_id,)
            ).fetchone()
            if existing:
                logger.debug(f"[IngestHook] Already embedded: {content_id[:8]}")
                return False
        except Exception:
            pass

    # Build rich text: caption + hashtags
    tags_str = ""
    if hashtags and isinstance(hashtags, list):
        tags_str = " " + " ".join(f"#{t.lstrip('#')}" for t in hashtags if t)
    text = f"{caption.strip()}{tags_str}".strip()[:8000]

    try:
        from octragon.intelligence.search import SemanticSearch
        searcher = SemanticSearch(db=db)
        result = searcher.index_content(
            content_id=content_id,
            account_id=account_id,
            niche=niche,
            text=text,
            source_type="caption",
        )
        if result:
            logger.debug(f"[IngestHook] Embedded content {content_id[:8]}: {text[:60]}...")
        return result
    except Exception as e:
        logger.debug(f"[IngestHook] Skipped {content_id[:8]}: {e}")
        return False


def batch_embed_unindexed(db=None, limit: int = 50) -> int:
    """Back-fill embeddings for any scraped content not yet in content_embeddings.

    Useful for running once to index existing DB records.
    Returns count of newly embedded items.
    """
    if db is None:
        from octragon.db import OctragonDB
        db = OctragonDB()

    try:
        rows = db.conn.execute("""
            SELECT sc.id, sc.caption, sc.hashtags, sc.target_niche
            FROM scraped_content sc
            LEFT JOIN content_embeddings ce ON ce.content_id = sc.id
            WHERE ce.id IS NULL
              AND sc.caption != ''
              AND sc.scrape_status != 'pending'
            ORDER BY sc.created_at DESC
            LIMIT ?
        """, (limit,)).fetchall()
    except Exception as e:
        logger.warning(f"[IngestHook] batch_embed query failed: {e}")
        return 0

    if not rows:
        logger.info("[IngestHook] No unindexed content found.")
        return 0

    logger.info(f"[IngestHook] Back-filling {len(rows)} embeddings...")
    count = 0
    for row in rows:
        import json
        content_id, caption, hashtags_json, niche = row[0], row[1], row[2], (row[3] or "")
        try:
            hashtags = json.loads(hashtags_json) if hashtags_json else []
        except Exception:
            hashtags = []
        if auto_embed_scraped_content(content_id, caption, hashtags, niche=niche, db=db):
            count += 1

    logger.success(f"[IngestHook] Back-filled {count}/{len(rows)} embeddings.")
    return count
