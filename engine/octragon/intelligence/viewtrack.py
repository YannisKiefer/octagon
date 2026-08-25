"""
Octragon ViewTrack — AI Hook Analysis Engine

Extracts "Open Loops", "Bold Claims", and hook psychology patterns
from video transcripts using Gemini 3.1 Pro.

This is the Octragon equivalent of ViewTrack's content analytics,
but powered by actual LLM intelligence instead of keyword matching.
"""

from __future__ import annotations

import json
import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from loguru import logger

# Prompt for Gemini hook analysis
HOOK_ANALYSIS_PROMPT = """You are an elite social media CMO analyzing a viral video script.

SCRIPT:
{script}

ENGAGEMENT:
- Views: {views}
- Likes: {likes}
- Comments: {comments}
- Shares: {shares}

Analyze the hook strategy. Return STRICT JSON:
{{
  "hook_type": "open_loop|bold_claim|curiosity_gap|pattern_interrupt|social_proof|controversy|story_hook",
  "hook_text": "exact opening sentence or phrase used as the hook",
  "open_loops": ["list of unresolved questions/tensions created"],
  "bold_claims": ["list of strong/provocative statements"],
  "emotional_triggers": ["fear|greed|curiosity|fomo|authority|social_proof"],
  "retention_devices": ["list of techniques keeping viewers watching (e.g. 'wait for it', countdown, reveal)"],
  "cta_strength": 1-10,
  "cta_type": "direct|soft|none|implied",
  "hook_score": 1-100,
  "virality_factors": ["what makes this shareable"],
  "replication_blueprint": "one paragraph: exactly how to recreate this hook pattern for a different niche"
}}
"""

LINK_ATTRIBUTION_PROMPT = """Analyze this post's conversion potential.

POST CAPTION: {caption}
PLATFORM: {platform}
LINK: {link}
ENGAGEMENT: {engagement}

Return STRICT JSON:
{{
  "has_cta": true/false,
  "cta_type": "link_in_bio|swipe_up|direct_url|comment_keyword|dm_trigger",
  "conversion_intent": "product_sale|lead_gen|content|community|none",
  "attribution_confidence": 1-100,
  "estimated_ctr": 0.0-1.0,
  "revenue_potential": "high|medium|low|none"
}}
"""


@dataclass
class HookAnalysis:
    """Result of AI hook analysis on a single video."""
    id: str = ""
    scraped_content_id: str = ""
    account_id: str = ""

    # Hook classification
    hook_type: str = ""             # open_loop, bold_claim, etc.
    hook_text: str = ""             # exact hook phrase
    hook_score: int = 0             # 0-100

    # Deep analysis
    open_loops: list[str] = field(default_factory=list)
    bold_claims: list[str] = field(default_factory=list)
    emotional_triggers: list[str] = field(default_factory=list)
    retention_devices: list[str] = field(default_factory=list)

    # CTA
    cta_strength: int = 0
    cta_type: str = "none"

    # Virality
    virality_factors: list[str] = field(default_factory=list)
    replication_blueprint: str = ""

    analyzed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def generate_id(self) -> str:
        raw = f"hook:{self.scraped_content_id}:{self.account_id}"
        self.id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return self.id


@dataclass
class LinkAttribution:
    """Revenue attribution for a tracked link."""
    id: str = ""
    account_id: str = ""
    post_id: str = ""               # delivery_log ID

    # UTM
    utm_source: str = ""
    utm_medium: str = ""
    utm_campaign: str = ""
    utm_content: str = ""           # variation ID for A/B
    short_url: str = ""             # octragon.link/abc123

    # Attribution
    clicks: int = 0
    conversions: int = 0
    revenue: float = 0.0
    conversion_rate: float = 0.0
    attribution_confidence: int = 0  # 0-100

    # Metadata
    platform: str = ""
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_click_at: Optional[datetime] = None

    def generate_id(self) -> str:
        raw = f"link:{self.account_id}:{self.post_id}:{self.utm_campaign}"
        self.id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return self.id

    def generate_utm_url(self, base_url: str) -> str:
        """Build a full UTM-tagged URL."""
        params = []
        if self.utm_source:
            params.append(f"utm_source={self.utm_source}")
        if self.utm_medium:
            params.append(f"utm_medium={self.utm_medium}")
        if self.utm_campaign:
            params.append(f"utm_campaign={self.utm_campaign}")
        if self.utm_content:
            params.append(f"utm_content={self.utm_content}")
        separator = "&" if "?" in base_url else "?"
        return f"{base_url}{separator}{'&'.join(params)}"


class HookAnalyzer:
    """Analyzes video hooks using Gemini 3.1 Pro."""

    def __init__(self, db, gemini_client=None):
        self.db = db
        self.gemini = gemini_client

    async def analyze_hook(self, scraped_content_id: str, account_id: str,
                           script: str, views: int = 0, likes: int = 0,
                           comments: int = 0, shares: int = 0) -> Optional[HookAnalysis]:
        """Run AI hook analysis on a video script."""
        if not script or not self.gemini:
            return None

        prompt = HOOK_ANALYSIS_PROMPT.format(
            script=script[:2000],  # Token budget: max 2k chars
            views=views, likes=likes, comments=comments, shares=shares,
        )

        try:
            response = await self.gemini.generate_content_async(
                prompt,
                generation_config={"response_mime_type": "application/json"},
            )
            data = json.loads(response.text)

            analysis = HookAnalysis(
                scraped_content_id=scraped_content_id,
                account_id=account_id,
                hook_type=data.get("hook_type", "unknown"),
                hook_text=data.get("hook_text", ""),
                hook_score=data.get("hook_score", 0),
                open_loops=data.get("open_loops", []),
                bold_claims=data.get("bold_claims", []),
                emotional_triggers=data.get("emotional_triggers", []),
                retention_devices=data.get("retention_devices", []),
                cta_strength=data.get("cta_strength", 0),
                cta_type=data.get("cta_type", "none"),
                virality_factors=data.get("virality_factors", []),
                replication_blueprint=data.get("replication_blueprint", ""),
            )
            analysis.generate_id()

            # Store in DB
            self._save_analysis(analysis)
            logger.info(f"[HOOK] Analyzed {scraped_content_id}: {analysis.hook_type} (score={analysis.hook_score})")
            return analysis

        except Exception as e:
            logger.error(f"[HOOK] Analysis failed: {e}")
            return None

    def _save_analysis(self, analysis: HookAnalysis):
        self.db.conn.execute("""
            INSERT OR REPLACE INTO hook_analyses
            (id, scraped_content_id, account_id, hook_type, hook_text, hook_score,
             open_loops, bold_claims, emotional_triggers, retention_devices,
             cta_strength, cta_type, virality_factors, replication_blueprint, analyzed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            analysis.id, analysis.scraped_content_id, analysis.account_id,
            analysis.hook_type, analysis.hook_text, analysis.hook_score,
            json.dumps(analysis.open_loops), json.dumps(analysis.bold_claims),
            json.dumps(analysis.emotional_triggers), json.dumps(analysis.retention_devices),
            analysis.cta_strength, analysis.cta_type,
            json.dumps(analysis.virality_factors), analysis.replication_blueprint,
            analysis.analyzed_at.isoformat(),
        ))
        self.db.conn.commit()

    def get_top_hooks(self, account_id: str = None, limit: int = 20) -> list[dict]:
        """Get highest-scoring hooks, optionally filtered by account."""
        if account_id:
            rows = self.db.conn.execute("""
                SELECT ha.*, sc.source_url, sc.source_creator, sc.engagement_views
                FROM hook_analyses ha
                JOIN scraped_content sc ON ha.scraped_content_id = sc.id
                WHERE ha.account_id = ?
                ORDER BY ha.hook_score DESC LIMIT ?
            """, (account_id, limit)).fetchall()
        else:
            rows = self.db.conn.execute("""
                SELECT ha.*, sc.source_url, sc.source_creator, sc.engagement_views
                FROM hook_analyses ha
                JOIN scraped_content sc ON ha.scraped_content_id = sc.id
                ORDER BY ha.hook_score DESC LIMIT ?
            """, (limit,)).fetchall()

        results = []
        for r in rows:
            d = dict(r)
            for field_name in ("open_loops", "bold_claims", "emotional_triggers",
                              "retention_devices", "virality_factors"):
                d[field_name] = json.loads(d.get(field_name, "[]"))
            results.append(d)
        return results


class LinkTracker:
    """Revenue attribution via UTM-tagged links."""

    def __init__(self, db, base_domain: str = "octragon.link"):
        self.db = db
        self.base_domain = base_domain

    def create_tracked_link(self, account_id: str, post_id: str,
                            platform: str, campaign: str,
                            target_url: str, variation_id: str = "") -> LinkAttribution:
        """Generate a UTM-tagged tracking link for a post."""
        link = LinkAttribution(
            account_id=account_id,
            post_id=post_id,
            utm_source=platform,
            utm_medium="social",
            utm_campaign=campaign,
            utm_content=variation_id or post_id[:8],
            platform=platform,
        )
        link.generate_id()

        # Generate short URL
        link.short_url = f"https://{self.base_domain}/{link.id[:8]}"
        full_url = link.generate_utm_url(target_url)

        # Save to DB
        self.db.conn.execute("""
            INSERT OR REPLACE INTO link_tracking
            (id, account_id, post_id, utm_source, utm_medium, utm_campaign,
             utm_content, short_url, target_url, platform, clicks, conversions,
             revenue, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0.0, ?)
        """, (
            link.id, account_id, post_id,
            link.utm_source, link.utm_medium, link.utm_campaign,
            link.utm_content, link.short_url, full_url, platform,
            link.created_at.isoformat(),
        ))
        self.db.conn.commit()

        logger.info(f"[LINK] Created tracking link: {link.short_url} → {campaign}")
        return link

    def record_click(self, link_id: str):
        """Increment click count for a tracked link."""
        self.db.conn.execute("""
            UPDATE link_tracking
            SET clicks = clicks + 1, last_click_at = ?
            WHERE id = ?
        """, (datetime.now(timezone.utc).isoformat(), link_id))
        self.db.conn.commit()

    def record_conversion(self, link_id: str, revenue: float = 0.0):
        """Record a conversion (sale) attributed to a link."""
        self.db.conn.execute("""
            UPDATE link_tracking
            SET conversions = conversions + 1,
                revenue = revenue + ?,
                conversion_rate = CAST(conversions + 1 AS REAL) / CAST(MAX(clicks, 1) AS REAL)
            WHERE id = ?
        """, (revenue, link_id))
        self.db.conn.commit()
        logger.info(f"[LINK] Conversion recorded: {link_id} (+${revenue:.2f})")

    def get_attribution_report(self, account_id: str = None) -> list[dict]:
        """Get link performance, optionally filtered by account."""
        if account_id:
            rows = self.db.conn.execute("""
                SELECT * FROM link_tracking
                WHERE account_id = ?
                ORDER BY revenue DESC, clicks DESC
            """, (account_id,)).fetchall()
        else:
            rows = self.db.conn.execute("""
                SELECT lt.*, a.display_name, a.platform as account_platform
                FROM link_tracking lt
                JOIN accounts a ON lt.account_id = a.id
                ORDER BY lt.revenue DESC, lt.clicks DESC
                LIMIT 50
            """).fetchall()
        return [dict(r) for r in rows]

    def get_total_revenue(self, account_id: str = None) -> float:
        """Sum total attributed revenue."""
        if account_id:
            row = self.db.conn.execute(
                "SELECT COALESCE(SUM(revenue), 0) FROM link_tracking WHERE account_id = ?",
                (account_id,)
            ).fetchone()
        else:
            row = self.db.conn.execute(
                "SELECT COALESCE(SUM(revenue), 0) FROM link_tracking"
            ).fetchone()
        return row[0] if row else 0.0
