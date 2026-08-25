"""
Octragon System — Database Factory

Provides a unified entry point to get the correct database backend.
Switch between SQLite (local dev) and Supabase (production) via env var.
"""

from __future__ import annotations

import os
from typing import Union

from loguru import logger


def get_db(backend: str | None = None) -> Union["OctragonDB", "OctragonSupabaseDB"]:
    """Get the configured database backend.

    Args:
        backend: Force a specific backend ("sqlite" or "supabase").
                 Defaults to OCTAGON_DB_BACKEND env var, fallback "sqlite".

    Returns:
        OctragonDB (SQLite) or OctragonSupabaseDB (Supabase)
    """
    backend = (backend or os.environ.get("OCTAGON_DB_BACKEND", "sqlite")).lower()

    if backend == "supabase":
        from .db_supabase import OctragonSupabaseDB
        logger.info("[DB FACTORY] Using Supabase backend")
        return OctragonSupabaseDB()
    else:
        from .db import OctragonDB
        logger.info("[DB FACTORY] Using SQLite backend")
        return OctragonDB()


def get_vector_store():
    """Get the LanceDB vector store (always local)."""
    from .intelligence.vector_store import OctragonVectorStore
    return OctragonVectorStore()
