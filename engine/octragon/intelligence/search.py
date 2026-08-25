"""
Octragon Intelligence — Semantic Search

Wraps the embedding engine + DB for natural language search
across all scraped content. Zero API calls for search queries
(embedding is cached in SQLite BLOBs).
"""

from __future__ import annotations

from typing import Optional

import numpy as np
from loguru import logger

from octragon.intelligence.embeddings import EmbeddingEngine


class SemanticSearch:
    """Natural language search across Octragon content."""

    def __init__(self, db=None):
        from octragon.db import OctragonDB
        self.db = db or OctragonDB()
        self.engine = EmbeddingEngine()

    def index_content(
        self,
        content_id: str,
        account_id: str,
        text: str,
        niche: str = "",
        source_type: str = "caption",
    ) -> bool:
        """Embed and store a piece of content. Called once on ingest."""
        if not text or not text.strip():
            return False

        embedding = self.engine.embed_content(text, task_type="document")

        # Reject zero vectors — they are produced on API failure and would pollute rankings.
        # The dedup key `emb:{content_id}:caption` would prevent retries if stored.
        vec = np.array(embedding, dtype=np.float32)
        if not np.any(vec) or not np.all(np.isfinite(vec)):
            logger.warning(
                f"[Search] Rejected zero/invalid embedding for {content_id[:8]} — API failure? "
                "Content will be re-attempted on next batch_embed run."
            )
            return False

        blob = EmbeddingEngine.to_blob(embedding)
        model_ver = getattr(self.engine, "MODEL", "gemini-embedding-001")
        self.db.conn.execute("""
            INSERT OR REPLACE INTO content_embeddings
            (id, content_id, account_id, niche, embedding, text_source, task_type, model_version, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'RETRIEVAL_DOCUMENT', ?, datetime('now'))
        """, (
            f"emb:{content_id}:{source_type}",
            content_id, account_id, niche, blob, source_type, model_ver,
        ))
        self.db.conn.commit()
        return True

    def search(
        self,
        query: str,
        niche: Optional[str] = None,
        account_id: Optional[str] = None,
        limit: int = 10,
    ) -> list[dict]:
        """
        Search content by natural language query.

        Searches across the entire scraped-content corpus (competitor research
        is not account-specific). Optionally narrow by niche for relevance.
        account_id filter is kept for back-compat but not used for primary filtering.

        Returns [{content_id, niche, score, text_source}, ...] sorted by relevance.
        """
        query_vec = np.array(
            self.engine.embed_content(query, task_type="query"),
            dtype=np.float32,
        )

        # Filter by niche when provided (preferred); fall back to global corpus.
        # Do NOT filter by account_id — scraped content is niche-scoped, not account-scoped.
        if niche:
            rows = self.db.conn.execute(
                "SELECT content_id, niche, embedding, text_source FROM content_embeddings WHERE niche = ?",
                (niche,)
            ).fetchall()
            # If niche filter returns nothing (e.g., no niche column yet), fall back to global
            if not rows:
                rows = self.db.conn.execute(
                    "SELECT content_id, niche, embedding, text_source FROM content_embeddings"
                ).fetchall()
        else:
            rows = self.db.conn.execute(
                "SELECT content_id, niche, embedding, text_source FROM content_embeddings"
            ).fetchall()

        results = []
        for row in rows:
            try:
                stored_vec = EmbeddingEngine.from_blob(row[2])
                score = EmbeddingEngine.cosine_similarity(query_vec, stored_vec)
                results.append({
                    "content_id": row[0],
                    "niche": row[1],
                    "score": score,
                    "text_source": row[3],
                })
            except Exception:
                continue

        # Sort by score descending, return top N
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def find_similar(self, content_id: str, limit: int = 5) -> list[dict]:
        """Find content similar to an existing piece (content-to-content)."""
        row = self.db.conn.execute(
            "SELECT embedding, account_id FROM content_embeddings WHERE content_id = ? LIMIT 1",
            (content_id,)
        ).fetchone()
        if not row:
            return []

        source_vec = EmbeddingEngine.from_blob(row[0])

        all_rows = self.db.conn.execute(
            "SELECT content_id, account_id, embedding, text_source FROM content_embeddings WHERE content_id != ?",
            (content_id,)
        ).fetchall()

        results = []
        for r in all_rows:
            stored_vec = EmbeddingEngine.from_blob(r[2])
            score = EmbeddingEngine.cosine_similarity(source_vec, stored_vec)
            results.append({
                "content_id": r[0],
                "account_id": r[1],
                "score": score,
                "text_source": r[3],
            })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]
