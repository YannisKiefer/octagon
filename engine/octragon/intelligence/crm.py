"""
Octragon Intelligence — Cross-Platform CRM

Tracks DM activity, contact interactions, and cross-platform relationships
across all 20 accounts. Token-efficient: only logs new interactions via
content-hash dedup.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Optional

from loguru import logger


class CRMEngine:
    """Cross-platform contact relationship manager."""

    def __init__(self, db=None):
        from octragon.db import OctragonDB
        self.db = db or OctragonDB()

    def log_interaction(
        self,
        account_id: str,
        contact_handle: str,
        platform: str,
        direction: str = "inbound",  # inbound | outbound
        summary: str = "",
        sentiment: str = "neutral",  # positive | neutral | negative
        tags: list[str] | None = None,
        occurred_at: Optional[datetime] = None,
    ) -> bool:
        """Log a DM or interaction. Deduplicates by content hash."""
        # Generate dedup hash
        dedup_key = f"{account_id}:{contact_handle}:{platform}:{summary[:100]}"
        interaction_id = hashlib.sha256(dedup_key.encode()).hexdigest()[:16]

        # Check for duplicate
        existing = self.db.conn.execute(
            "SELECT id FROM crm_interactions WHERE id = ?", (interaction_id,)
        ).fetchone()
        if existing:
            return False  # Already logged

        now = datetime.now(timezone.utc).isoformat()
        self.db.conn.execute("""
            INSERT INTO crm_interactions
            (id, account_id, contact_handle, platform, direction,
             summary, sentiment, tags, occurred_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            interaction_id, account_id, contact_handle, platform,
            direction, summary, sentiment,
            ",".join(tags) if tags else "",
            (occurred_at or datetime.now(timezone.utc)).isoformat(),
            now,
        ))
        self.db.conn.commit()
        return True

    def get_account_interactions(
        self,
        account_id: str,
        limit: int = 20,
    ) -> list[dict]:
        """Get recent interactions for an account."""
        rows = self.db.conn.execute("""
            SELECT * FROM crm_interactions
            WHERE account_id = ?
            ORDER BY occurred_at DESC LIMIT ?
        """, (account_id, limit)).fetchall()
        return [dict(r) for r in rows]

    def get_cross_platform_contacts(self) -> list[dict]:
        """Find contacts that appear across multiple accounts/platforms."""
        rows = self.db.conn.execute("""
            SELECT contact_handle,
                   COUNT(DISTINCT account_id) as account_count,
                   COUNT(DISTINCT platform) as platform_count,
                   COUNT(*) as interaction_count,
                   GROUP_CONCAT(DISTINCT platform) as platforms
            FROM crm_interactions
            GROUP BY contact_handle
            HAVING account_count > 1 OR platform_count > 1
            ORDER BY interaction_count DESC
        """).fetchall()
        return [dict(r) for r in rows]

    def get_recent_activity(self, limit: int = 30) -> list[dict]:
        """Get most recent DM activity across all accounts."""
        rows = self.db.conn.execute("""
            SELECT ci.*, a.display_name as account_name, a.platform as account_platform
            FROM crm_interactions ci
            JOIN accounts a ON ci.account_id = a.id
            ORDER BY ci.occurred_at DESC LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]
