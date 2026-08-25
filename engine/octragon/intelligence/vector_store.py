"""
Octragon System — LanceDB Vector Store

High-performance local vector sidecar for semantic search.
Replaces SQLite BLOB embeddings with proper IVF_PQ indexing.

25ms query latency, zero API cost, unlimited embeddings.
"""

from __future__ import annotations

import os
import numpy as np
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import lancedb
import pyarrow as pa
from loguru import logger


# Default storage path
_PROJECT_ROOT = Path(__file__).parent.parent.parent
DEFAULT_LANCE_DIR = _PROJECT_ROOT / "data" / "vectors"


class OctragonVectorStore:
    """LanceDB-backed vector storage for Octragon embeddings.

    Replaces the content_embeddings SQLite table with proper
    vector indexing (IVF_PQ) for <25ms semantic search.
    """

    EMBEDDING_DIM = 768  # Gemini embedding-001 dimension
    TABLE_NAME = "content_embeddings"

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = str(db_path or DEFAULT_LANCE_DIR)
        os.makedirs(self.db_path, exist_ok=True)
        self.db = lancedb.connect(self.db_path)
        self._ensure_table()
        logger.info(f"[VECTOR] LanceDB connected at {self.db_path}")

    def _ensure_table(self):
        """Create the embeddings table if it doesn't exist."""
        if self.TABLE_NAME not in self.db.table_names():
            schema = pa.schema([
                pa.field("id", pa.string()),
                pa.field("content_id", pa.string()),
                pa.field("account_id", pa.string()),
                pa.field("text_source", pa.string()),
                pa.field("text_preview", pa.string()),   # first 200 chars
                pa.field("vector", pa.list_(pa.float32(), self.EMBEDDING_DIM)),
                pa.field("created_at", pa.string()),
            ])
            self.db.create_table(self.TABLE_NAME, schema=schema)
            logger.info(f"[VECTOR] Created table '{self.TABLE_NAME}'")

    @property
    def table(self):
        return self.db.open_table(self.TABLE_NAME)

    # -----------------------------------------------------------------------
    # Write Operations
    # -----------------------------------------------------------------------

    def add_embedding(
        self,
        embedding_id: str,
        content_id: str,
        account_id: str,
        vector: list[float] | np.ndarray,
        text_source: str = "caption",
        text_preview: str = "",
    ) -> None:
        """Store a single embedding vector."""
        if isinstance(vector, np.ndarray):
            vector = vector.tolist()

        data = [{
            "id": embedding_id,
            "content_id": content_id,
            "account_id": account_id,
            "text_source": text_source,
            "text_preview": text_preview[:200],
            "vector": vector,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }]
        self.table.add(data)
        logger.debug(f"[VECTOR] Added embedding {embedding_id} for content {content_id}")

    def add_embeddings_batch(
        self,
        embeddings: list[dict],
    ) -> int:
        """Batch insert embeddings. Each dict must have:
        id, content_id, account_id, vector, text_source, text_preview
        """
        if not embeddings:
            return 0

        rows = []
        for e in embeddings:
            vec = e["vector"]
            if isinstance(vec, np.ndarray):
                vec = vec.tolist()
            rows.append({
                "id": e["id"],
                "content_id": e["content_id"],
                "account_id": e["account_id"],
                "text_source": e.get("text_source", "caption"),
                "text_preview": e.get("text_preview", "")[:200],
                "vector": vec,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

        self.table.add(rows)
        logger.info(f"[VECTOR] Batch added {len(rows)} embeddings")
        return len(rows)

    # -----------------------------------------------------------------------
    # Search Operations
    # -----------------------------------------------------------------------

    def search(
        self,
        query_vector: list[float] | np.ndarray,
        limit: int = 10,
        account_id: Optional[str] = None,
    ) -> list[dict]:
        """Semantic search — find most similar content.

        Returns list of dicts with: id, content_id, account_id,
        text_source, text_preview, _distance
        """
        if isinstance(query_vector, np.ndarray):
            query_vector = query_vector.tolist()

        q = self.table.search(query_vector).limit(limit)

        if account_id:
            q = q.where(f"account_id = '{account_id}'")

        results = q.to_list()
        return results

    def find_similar(
        self,
        content_id: str,
        limit: int = 10,
        exclude_same_account: bool = False,
    ) -> list[dict]:
        """Find content similar to a given content_id.

        Zero API cost — uses stored embedding for the query vector.
        """
        # Get the source embedding
        source = self.table.search().where(f"content_id = '{content_id}'").limit(1).to_list()
        if not source:
            return []

        query_vec = source[0]["vector"]
        results = self.table.search(query_vec).limit(limit + 1).to_list()

        # Filter out the source itself
        filtered = [r for r in results if r["content_id"] != content_id]

        if exclude_same_account and source:
            src_account = source[0]["account_id"]
            filtered = [r for r in filtered if r["account_id"] != src_account]

        return filtered[:limit]

    def hybrid_search(
        self,
        query_text: str,
        query_vector: list[float] | np.ndarray,
        limit: int = 10,
        account_id: Optional[str] = None,
    ) -> list[dict]:
        """Hybrid search: BM25 keyword + cosine semantic + score fusion.

        Combines the precision of keyword search (exact terms, hashtags,
        creator names) with the recall of semantic search (meaning,
        synonyms, conceptual matches).

        Requires FTS index — call create_fts_index() first.
        """
        if isinstance(query_vector, np.ndarray):
            query_vector = query_vector.tolist()

        try:
            q = (
                self.table
                .search(query_vector, query_type="hybrid")
                .text(query_text, text_column="text_preview")
                .limit(limit)
            )
            if account_id:
                q = q.where(f"account_id = '{account_id}'")
            return q.to_list()
        except Exception as e:
            # Fallback to pure vector search if FTS index not ready
            logger.warning(f"[VECTOR] Hybrid search failed ({e}), falling back to vector-only")
            return self.search(query_vector, limit=limit, account_id=account_id)

    # -----------------------------------------------------------------------
    # Index Management
    # -----------------------------------------------------------------------

    def create_fts_index(self) -> None:
        """Create Full-Text Search index on text_preview for BM25 keyword search."""
        try:
            self.table.create_fts_index("text_preview", replace=True)
            logger.info("[VECTOR] Created FTS index on text_preview")
        except Exception as e:
            logger.warning(f"[VECTOR] FTS index creation failed: {e}")

    def create_index(self, num_partitions: int = 16, num_sub_vectors: int = 48):
        """Create IVF_PQ index for fast ANN search.

        Only needed once you have >1000 vectors. Before that,
        brute-force is fast enough on LanceDB.
        """
        count = self.table.count_rows()
        if count < 256:
            logger.info(f"[VECTOR] Only {count} vectors — skipping index (brute-force is fine)")
            return

        self.table.create_index(
            metric="cosine",
            num_partitions=min(num_partitions, count // 16),
            num_sub_vectors=num_sub_vectors,
        )
        logger.info(f"[VECTOR] Created IVF_PQ index over {count} vectors")

    # -----------------------------------------------------------------------
    # Utilities
    # -----------------------------------------------------------------------

    def count(self) -> int:
        """Total number of stored embeddings."""
        return self.table.count_rows()

    def count_for_account(self, account_id: str) -> int:
        """Count embeddings for a specific account."""
        results = self.table.search().where(f"account_id = '{account_id}'").limit(100000).to_list()
        return len(results)

    def delete_for_content(self, content_id: str) -> None:
        """Delete all embeddings for a content piece."""
        self.table.delete(f"content_id = '{content_id}'")

    def get_stats(self) -> dict:
        """Get vector store statistics."""
        total = self.count()
        return {
            "total_vectors": total,
            "embedding_dim": self.EMBEDDING_DIM,
            "storage_path": self.db_path,
            "estimated_size_mb": round(total * self.EMBEDDING_DIM * 4 / 1024 / 1024, 2),
        }
