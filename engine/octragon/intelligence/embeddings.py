"""
Octragon Intelligence — Gemini Embeddings Engine

Uses `gemini-embedding-001` (3072 dims full, 768 compressed via MRL) for
semantic search across all scraped content, captions, and CMO analyses.

Token-efficient: embed once on ingest, search is pure cosine math (zero API calls).
"""

from __future__ import annotations

import struct
from typing import Optional

import numpy as np
from loguru import logger

from octragon.config import get_config


class EmbeddingEngine:
    """Semantic embedding using Gemini's embedding model."""

    MODEL = "gemini-embedding-001"
    DIMENSIONS = 768  # MRL-compressed for storage efficiency
    TASK_TYPES = {
        "document": "RETRIEVAL_DOCUMENT",
        "query": "RETRIEVAL_QUERY",
        "similarity": "SEMANTIC_SIMILARITY",
        "classification": "CLASSIFICATION",
    }

    def __init__(self):
        import google.generativeai as genai
        config = get_config()
        genai.configure(api_key=config.gemini_api_key)
        self._genai = genai

    def embed_content(
        self,
        text: str,
        task_type: str = "document",
    ) -> list[float]:
        """Embed a single text. Returns 768-dim vector."""
        if not text or not text.strip():
            return [0.0] * self.DIMENSIONS

        # Truncate to ~2000 tokens (~8000 chars) to stay within limits
        text = text[:8000]

        try:
            result = self._genai.embed_content(
                model=f"models/{self.MODEL}",
                content=text,
                task_type=self.TASK_TYPES.get(task_type, "RETRIEVAL_DOCUMENT"),
                output_dimensionality=self.DIMENSIONS,
            )
            return result["embedding"]
        except Exception as e:
            logger.warning(f"[Embedding] Failed: {e}")
            return [0.0] * self.DIMENSIONS

    def embed_batch(
        self,
        texts: list[str],
        task_type: str = "document",
    ) -> list[list[float]]:
        """Batch embed multiple texts. Returns list of 768-dim vectors."""
        results = []
        # Process in chunks of 20 (API limit)
        for i in range(0, len(texts), 20):
            chunk = texts[i:i + 20]
            chunk = [t[:8000] if t else "" for t in chunk]
            try:
                result = self._genai.embed_content(
                    model=f"models/{self.MODEL}",
                    content=chunk,
                    task_type=self.TASK_TYPES.get(task_type, "RETRIEVAL_DOCUMENT"),
                    output_dimensionality=self.DIMENSIONS,
                )
                results.extend(result["embedding"])
            except Exception as e:
                logger.warning(f"[Embedding] Batch failed chunk {i}: {e}")
                results.extend([[0.0] * self.DIMENSIONS] * len(chunk))
        return results

    @staticmethod
    def to_blob(embedding: list[float]) -> bytes:
        """Serialize embedding to binary BLOB for SQLite storage."""
        return struct.pack(f"{len(embedding)}f", *embedding)

    @staticmethod
    def from_blob(blob: bytes, dim: int = 768) -> np.ndarray:
        """Deserialize BLOB back to numpy array."""
        return np.array(struct.unpack(f"{dim}f", blob), dtype=np.float32)

    @staticmethod
    def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        """Compute cosine similarity between two vectors."""
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(np.dot(a, b) / (norm_a * norm_b))
