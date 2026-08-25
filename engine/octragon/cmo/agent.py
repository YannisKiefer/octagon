"""
Octragon System — CMO AI Agent (Elite v2.0)

ELITE REWRITE:
- 10-axis scoring framework fully wired into content analysis
- Viral DNA Genome synthesis with trajectory intelligence
- Content cluster analysis using multimodal embedding centroids
- Async-safe Gemini File API with state polling
- Graceful embedding fallback (text-only when video unavailable)
- Rich DB migration for all new axis fields
- Win-rate and engagement-rate computed metrics injected into prompts
- Competitive gap identification loop
- A/B prescription generation with single-variable test suggestions
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

from google import genai
from google.genai import types
from loguru import logger

from octragon.config import OctragonConfig, get_config
from octragon.db import OctragonDB
from octragon.cmo.prompts import (
    CMO_SYSTEM_PROMPT,
    HOOK_ANALYSIS_PROMPT,
    FORGERY_AB_TEST_PROMPT,
    MASTER_STRATEGY_PROMPT,
    CONTENT_WHY_ANALYSIS_PROMPT,
    VIRAL_DNA_PROMPT,
    NEXT_POST_PROMPT,
    DAILY_TODO_PROMPT,
    ACCOUNT_HEALTH_PROMPT,
    COMPETITOR_BENCHMARK_PROMPT,
    CONTENT_CLUSTER_PROMPT,
)
from octragon.models import (
    ContentAnalysis, CMOVerdict, ViralDNAProfile,
    NextPostQueue, NextPostStatus, SourcePlatform,
    NicheType, Account,
)

# Platform-specific algorithm notes injected into prescriptions
PLATFORM_NOTES = {
    "tiktok": "First-0.5s completion rate is the primary ranking signal. Loops heavily weighted. Avoid >90s.",
    "instagram": "Saves are the highest-weight signal. Carousel edu-content saves 3x more than video.",
    "linkedin": "Dwell time > reactions. Long-form personal narratives consistently outperform all formats.",
    "youtube": "Click-through rate and session watch time. First 30s determines recommendation fate.",
}


class CMOAgent:
    """The Chief Marketing Officer AI for Octragon — Elite v2.0."""

    def __init__(self, config: Optional[OctragonConfig] = None, db: Optional[OctragonDB] = None):
        self.config = config or get_config()
        self.db = db or OctragonDB(self.config.db_path)

        # Ensure CMO output directory exists
        self.cmo_dir = self.config.db_path.parent.parent / "cmo"
        self.cmo_dir.mkdir(parents=True, exist_ok=True)

        if not self.config.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is required for the CMO Agent.")

        self.client = genai.Client(api_key=self.config.gemini_api_key)
        # Gemini 2.5 Pro for deep strategic analysis; Flash for fast operational tasks
        self.model_pro = "gemini-2.5-pro"
        self.model_flash = "gemini-2.0-flash"
        self.model_name = self.model_pro  # Backwards compat
        self.embedding_model = "gemini-embedding-2-preview"

        # Ensure DB schema is up to date for all new axis fields
        self._ensure_schema_migrations()

    # ─── Schema Migrations ────────────────────────────────────────────────────

    def _ensure_schema_migrations(self):
        """Ensure all new elite fields exist in the DB."""
        new_columns = [
            # ContentAnalysis - 10 axis scores
            ("content_analysis", "axis_hook_power", "INTEGER DEFAULT 0"),
            ("content_analysis", "axis_curiosity_gap", "INTEGER DEFAULT 0"),
            ("content_analysis", "axis_emotional_velocity", "INTEGER DEFAULT 0"),
            ("content_analysis", "axis_retention_architecture", "INTEGER DEFAULT 0"),
            ("content_analysis", "axis_social_currency", "INTEGER DEFAULT 0"),
            ("content_analysis", "axis_platform_fitness", "INTEGER DEFAULT 0"),
            ("content_analysis", "axis_niche_authority", "INTEGER DEFAULT 0"),
            ("content_analysis", "axis_caption_amplification", "INTEGER DEFAULT 0"),
            ("content_analysis", "axis_shareability_trigger", "INTEGER DEFAULT 0"),
            ("content_analysis", "axis_algorithm_hygiene", "INTEGER DEFAULT 0"),
            # ContentAnalysis - strategic fields
            ("content_analysis", "highest_leverage_intervention", "TEXT DEFAULT ''"),
            ("content_analysis", "viral_atoms_json", "TEXT DEFAULT '[]'"),
            ("content_analysis", "clone_priority", "TEXT DEFAULT 'medium'"),
            # ViralDNAProfile - genome fields
            ("viral_dna_profile", "genome_signature", "TEXT DEFAULT ''"),
            ("viral_dna_profile", "competitor_exploitation_gap", "TEXT DEFAULT ''"),
            ("viral_dna_profile", "viral_atoms_library", "TEXT DEFAULT '[]'"),
            ("viral_dna_profile", "optimal_duration_range", "TEXT DEFAULT '[15,30]'"),
            ("viral_dna_profile", "dominant_axis_strengths", "TEXT DEFAULT '[]'"),
            ("viral_dna_profile", "critical_axis_weaknesses", "TEXT DEFAULT '[]'"),
            ("viral_dna_profile", "trajectory_note", "TEXT DEFAULT ''"),
            ("viral_dna_profile", "viral_win_count", "INTEGER DEFAULT 0"),
            ("viral_dna_profile", "rejection_count", "INTEGER DEFAULT 0"),
            ("viral_dna_profile", "cluster_labels", "TEXT DEFAULT '[]'"),
        ]
        for table, col, typedef in new_columns:
            try:
                existing = [r["name"] for r in self.db.conn.execute(f"PRAGMA table_info({table})").fetchall()]
                if col not in existing:
                    self.db.conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typedef}")
            except Exception:
                pass
        self.db.conn.commit()

    # ─── Core Gemini Interface ────────────────────────────────────────────────

    def _call_gemini(self, prompt: str, model: Optional[str] = None, temperature: float = 0.1) -> dict:
        """Call Gemini and return parsed JSON. Always returns a dict."""
        target_model = model or self.model_pro
        response = None
        try:
            response = self.client.models.generate_content(
                model=target_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=CMO_SYSTEM_PROMPT,
                    temperature=temperature,
                    response_mime_type="application/json",
                ),
            )
            text = response.text.strip()
            # Strip any markdown wrappers the model may add despite mime_type hint
            if text.startswith("```"):
                text = text.split("```", 2)[-1].split("```")[0].lstrip("json").strip()
            return json.loads(text)
        except json.JSONDecodeError as e:
            raw = response.text if response else ""
            logger.error(f"[CMO] JSON parse failed: {e} | raw[:200]: {raw[:200]}")
            return {"error": "json_parse_error", "raw": raw[:500]}
        except Exception as e:
            logger.error(f"[CMO] Gemini call failed ({target_model}): {e}")
            return {"error": str(e)}

    def _upload_file_with_poll(self, file_path: str, max_wait: int = 90) -> Optional[Any]:
        """Upload a file to Gemini Files API and wait until it's ACTIVE."""
        try:
            uploaded = self.client.files.upload(file=file_path)
            start = time.time()
            while uploaded.state and uploaded.state.name != "ACTIVE":
                if time.time() - start > max_wait:
                    logger.warning(f"[CMO] File {file_path} upload timed out after {max_wait}s.")
                    return None
                time.sleep(2)
                # Re-fetch the file status
                uploaded = self.client.files.get(name=uploaded.name)
            return uploaded
        except Exception as e:
            logger.warning(f"[CMO] File upload failed for {file_path}: {e}")
            return None

    # ─── Multimodal Embedding ─────────────────────────────────────────────────

    def get_multimodal_embedding(
        self,
        video_path: Optional[str] = None,
        audio_path: Optional[str] = None,
        text: Optional[str] = None,
    ) -> List[float]:
        """
        Generate a multimodal embedding using gemini-embedding-2-preview.
        Gracefully degrades to text-only if video/audio is unavailable.
        Maps text, video, and audio into a single unified vector space.
        """
        contents: List[Any] = []
        if text:
            contents.append(text)

        # Upload video — the most signal-rich modality
        if video_path and os.path.exists(video_path):
            f = self._upload_file_with_poll(video_path)
            if f:
                contents.append(f)
                logger.debug(f"[CMO] Video uploaded: {f.name}")

        # Upload audio separately if it differs from video or if video upload failed
        if audio_path and os.path.exists(audio_path) and audio_path != video_path:
            f = self._upload_file_with_poll(audio_path)
            if f:
                contents.append(f)

        if not contents:
            return []

        try:
            logger.info(f"[CMO] Generating multimodal embedding ({len(contents)} modalities: {'video' if video_path else ''} {'audio' if audio_path else ''} {'text' if text else ''})...")
            res = self.client.models.embed_content(
                model=self.embedding_model,
                contents=contents,
            )
            if res.embeddings and len(res.embeddings) > 0:
                values = list(res.embeddings[0].values)
                logger.success(f"[CMO] Embedding generated: {len(values)} dims")
                return values
        except Exception as e:
            logger.warning(f"[CMO] Multimodal embedding failed, falling back to text-only: {e}")
            # Graceful fallback: text-only embedding
            if text:
                try:
                    res = self.client.models.embed_content(
                        model=self.embedding_model,
                        contents=[text],
                    )
                    if res.embeddings:
                        return list(res.embeddings[0].values)
                except Exception as e2:
                    logger.error(f"[CMO] Text-only embedding also failed: {e2}")
        return []

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """Cosine similarity between two embedding vectors."""
        if not a or not b or len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    def _centroid(self, vectors: List[List[float]]) -> List[float]:
        """Compute the centroid (mean vector) of a list of embedding vectors."""
        if not vectors:
            return []
        dim = len(vectors[0])
        return [sum(v[i] for v in vectors) / len(vectors) for i in range(dim)]

    # ─── Content "Why Analysis" ───────────────────────────────────────────────

    def analyze_content(
        self,
        scraped_content_id: str,
        account_id: str = "",
        model: Optional[str] = None
    ) -> ContentAnalysis:
        """
        Perform surgical post-mortem analysis on a single video.
        Returns a comprehensive ContentAnalysis with 10-axis scores,
        viral atoms, and a multimodal embedding.
        """
        logger.info(f"[CMO] ═══ Running Elite Why Analysis: {scraped_content_id[:8]} ═══")

        sc = self.db.get_scraped_content(scraped_content_id)
        if not sc:
            logger.warning(f"[CMO] Content {scraped_content_id} not found.")
            return ContentAnalysis(scraped_content_id=scraped_content_id)

        # Compute engagement metrics for context injection
        avg_views = self.db.conn.execute(
            "SELECT AVG(engagement_views) FROM scraped_content WHERE target_phone = ?",
            (sc.target_phone,)
        ).fetchone()[0] or 1000

        views = sc.engagement_views or 0
        likes = sc.engagement_likes or 0
        comments = sc.engagement_comments or 0
        shares = sc.engagement_shares or 0
        duration = sc.duration_seconds or 15

        engagement_rate = round(((likes + comments + shares) / max(1, views)) * 100, 2)
        share_ratio = round(shares / max(1, views), 4)
        performance_delta = round(((views - avg_views) / max(1, avg_views)) * 100, 0)

        platform_val = sc.source_platform.value if hasattr(sc.source_platform, 'value') else str(sc.source_platform)
        niche_val = sc.target_niche.value if hasattr(sc.target_niche, 'value') else str(sc.target_niche)

        prompt = CONTENT_WHY_ANALYSIS_PROMPT.format(
            source_creator=sc.source_creator,
            source_platform=platform_val,
            caption=sc.caption[:400],
            duration=duration,
            views=views,
            likes=likes,
            comments=comments,
            shares=shares,
            niche=niche_val,
            engagement_rate=engagement_rate,
            share_ratio=share_ratio,
            avg_views=int(avg_views),
            performance_delta=performance_delta,
        )

        # 1. Strategic Analysis (Override model if provided, default to Flash for high-volume sensing)
        default_sensing_model = self.model_flash if account_id else self.model_pro
        target_model = model or default_sensing_model
        result = self._call_gemini(prompt, model=target_model, temperature=0.1)

        # 2. Multimodal Embedding (best-effort, graceful fallback)
        embedding = self.get_multimodal_embedding(
            video_path=sc.video_path,
            audio_path=sc.audio_path,
            text=sc.caption,
        )

        # Parse 10-axis scores from result
        axes = result.get("axis_scores", {})

        ca = ContentAnalysis(
            scraped_content_id=scraped_content_id,
            account_id=account_id,
            verdict=self._safe_verdict(result.get("verdict", "neutral")),
            why_worked=result.get("why_worked", ""),
            why_failed=result.get("why_failed", ""),
            cmo_score=int(result.get("cmo_score", 0)),
            hook_type=result.get("hook_type", "none"),
            content_type=result.get("content_type", "other"),
            emotional_tone=result.get("emotional_tone", "neutral"),
            ideal_duration_seconds=int(result.get("ideal_duration_seconds", duration)),
            timing_analysis=result.get("timing_analysis", ""),
            clone_priority=result.get("clone_priority", "medium"),
            # 10-axis scores
            axis_hook_power=int(axes.get("hook_power", 0)),
            axis_curiosity_gap=int(axes.get("curiosity_gap", 0)),
            axis_emotional_velocity=int(axes.get("emotional_velocity", 0)),
            axis_retention_architecture=int(axes.get("retention_architecture", 0)),
            axis_social_currency=int(axes.get("social_currency", 0)),
            axis_platform_fitness=int(axes.get("platform_fitness", 0)),
            axis_niche_authority=int(axes.get("niche_authority", 0)),
            axis_caption_amplification=int(axes.get("caption_amplification", 0)),
            axis_shareability_trigger=int(axes.get("shareability_trigger", 0)),
            axis_algorithm_hygiene=int(axes.get("algorithm_hygiene", 0)),
            # Strategic insights
            highest_leverage_intervention=result.get("highest_leverage_intervention", ""),
            viral_atoms_json=json.dumps(result.get("viral_atoms", [])),
            engagement_delta_pct=performance_delta,
            embedding_json=json.dumps(embedding) if embedding else "[]",
        )
        ca.generate_id()
        self.db.save_content_analysis(ca)

        axis_sum = ca.axis_composite_score
        logger.success(
            f"[CMO] ✅ {ca.verdict.value} | CMO:{ca.cmo_score} | Axis:{axis_sum:.0f} | Clone:{ca.clone_priority} | {ca.hook_type}"
        )
        return ca

    def _safe_verdict(self, val: str) -> CMOVerdict:
        """Parse verdict string safely."""
        try:
            return CMOVerdict(val)
        except ValueError:
            return CMOVerdict.NEUTRAL

    # ─── Viral DNA Profile Synthesis ──────────────────────────────────────────

    def update_viral_dna(self, account_id: str) -> ViralDNAProfile:
        """
        Synthesize the elite Viral DNA Profile from content analyses.
        Includes trajectory analysis, axis weakness profiling, and
        multimodal genome embedding cluster synthesis.
        """
        logger.info(f"[CMO] ═══ Updating Viral DNA: {account_id[:8]} ═══")

        account = self.db.get_account(account_id)
        if not account:
            logger.warning(f"[CMO] Account {account_id} not found.")
            return ViralDNAProfile(account_id=account_id)

        analyses = self.db.get_analyses_for_account(account_id, limit=50)

        if len(analyses) < 1:
            logger.warning(f"[CMO] No analyses found for @{account.handle}. Cannot update DNA.")
            return ViralDNAProfile(account_id=account_id, total_analyzed=0)

        if len(analyses) < 3:
            logger.warning(f"[CMO] Low data for DNA synthesis ({len(analyses)} items). Results may be jittery.")

        # Compute aggregate metrics for smarter prompt injection
        verdicts = [a.get("verdict", "neutral") if isinstance(a, dict) else getattr(a, "verdict", "neutral") for a in analyses]
        win_count = sum(1 for v in verdicts if v in ("viral_win", "promising"))
        rejection_count = sum(1 for v in verdicts if v == "rejected")
        win_rate = round(win_count / len(analyses) * 100, 1)

        scores = [a.get("cmo_score", 0) if isinstance(a, dict) else getattr(a, "cmo_score", 0) for a in analyses]
        avg_cmo_score = round(statistics.mean(scores), 1) if scores else 0

        # Build axis distribution for the prompt
        axis_fields = [
            "axis_hook_power", "axis_curiosity_gap", "axis_emotional_velocity",
            "axis_retention_architecture", "axis_social_currency", "axis_platform_fitness",
            "axis_niche_authority", "axis_caption_amplification",
            "axis_shareability_trigger", "axis_algorithm_hygiene",
        ]
        axis_distribution: Dict[str, Any] = {}
        for ax in axis_fields:
            vals = [a.get(ax, 0) if isinstance(a, dict) else getattr(a, ax, 0) for a in analyses]
            vals = [v for v in vals if isinstance(v, (int, float)) and v > 0]
            axis_distribution[ax.replace("axis_", "")] = {
                "avg": round(statistics.mean(vals), 1) if vals else 0,
                "max": max(vals) if vals else 0,
                "min": min(vals) if vals else 0,
            }

        # Identify weakest axis for targeted prescriptions
        weak_axes = sorted(
            axis_distribution.items(),
            key=lambda x: x[1]["avg"]
        )[:3]
        weak_axis_names = [n for n, _ in weak_axes]

        # Serialize analyses for the prompt (cap at 30 to manage context)
        analyses_payload = []
        for a in analyses[:30]:
            if isinstance(a, dict):
                analyses_payload.append({
                    "verdict": a.get("verdict"),
                    "cmo_score": a.get("cmo_score"),
                    "hook_type": a.get("hook_type"),
                    "content_type": a.get("content_type"),
                    "emotional_tone": a.get("emotional_tone"),
                    "why_worked": a.get("why_worked", "")[:100],
                    "why_failed": a.get("why_failed", "")[:100],
                    "viral_atoms": a.get("viral_atoms_json", "[]"),
                    "clone_priority": a.get("clone_priority", "medium"),
                })
            else:
                analyses_payload.append({
                    "verdict": getattr(a, "verdict", CMOVerdict.NEUTRAL).value if hasattr(getattr(a, "verdict", None), "value") else str(getattr(a, "verdict", "")),
                    "cmo_score": getattr(a, "cmo_score", 0),
                    "hook_type": getattr(a, "hook_type", ""),
                    "content_type": getattr(a, "content_type", ""),
                    "emotional_tone": getattr(a, "emotional_tone", ""),
                    "why_worked": getattr(a, "why_worked", "")[:100],
                    "viral_atoms": getattr(a, "viral_atoms_json", "[]"),
                    "clone_priority": getattr(a, "clone_priority", "medium"),
                })

        platform_val = account.platform.value if hasattr(account.platform, "value") else str(account.platform)
        niche_val = account.niche.value if hasattr(account.niche, "value") else str(account.niche)

        prompt = VIRAL_DNA_PROMPT.format(
            handle=account.handle,
            platform=platform_val,
            niche=niche_val,
            total_analyzed=len(analyses),
            win_rate=win_rate,
            avg_cmo_score=avg_cmo_score,
            analysis_count=len(analyses_payload),
            analyses_json=json.dumps(analyses_payload, indent=2),
            axis_distribution_json=json.dumps(axis_distribution, indent=2),
        )

        result = self._call_gemini(prompt, model=self.model_pro, temperature=0.15)

        # Synthesize genome embedding from high-performer embeddings
        genome_embedding = self._synthesize_genome_embedding(account_id, analyses)

        vdna = ViralDNAProfile(
            account_id=account_id,
            genome_signature=result.get("genome_signature", ""),
            competitor_exploitation_gap=result.get("competitor_exploitation_gap", ""),
            top_hooks=result.get("top_hooks", []),
            viral_atoms_library=result.get("viral_atoms_library", []),
            optimal_posting_times=result.get("optimal_posting_times", []),
            winning_formats=result.get("winning_formats", []),
            winning_emotions=result.get("winning_emotions", []),
            optimal_duration_range=result.get("optimal_duration_range_seconds", [15, 30]),
            dominant_axis_strengths=result.get("dominant_axis_strengths", []),
            critical_axis_weaknesses=result.get("critical_axis_weaknesses", weak_axis_names),
            avg_engagement_rate=float(result.get("avg_engagement_rate", 0.0)),
            trend_direction=result.get("trend_direction", "neutral"),
            trajectory_note=result.get("trajectory_note", ""),
            total_analyzed=len(analyses),
            viral_win_count=win_count,
            rejection_count=rejection_count,
            genome_embedding_json=json.dumps(genome_embedding) if genome_embedding else None,
        )

        self.db.save_viral_dna(vdna)

        # Cluster enrichment: k-means (k=3-5) + Gemini-labelled archetypes
        cluster_labels = self._enrich_with_clusters(account_id, analyses)
        if cluster_labels:
            try:
                self.db.conn.execute(
                    "UPDATE viral_dna_profile SET cluster_labels = ? WHERE account_id = ?",
                    (json.dumps(cluster_labels), account_id)
                )
                self.db.conn.commit()
                logger.info(f"[CMO] Cluster labels stored: {len(cluster_labels)} clusters for {account_id[:8]}")
            except Exception as e:
                logger.warning(f"[CMO] Cluster label persist failed: {e}")

        logger.success(
            f"[CMO] ✅ DNA updated @{account.handle} | Trend:{vdna.trend_direction} | Win:{win_rate}% | Axes↓:{','.join(weak_axis_names[:2])}"
        )
        return vdna

    def _synthesize_genome_embedding(self, account_id: str, analyses: list) -> List[float]:
        """
        Compute the genome embedding: the centroid of all high-performer embeddings.
        This is the 'center of virality' in multi-dimensional content space.
        """
        high_performer_vecs: List[List[float]] = []
        for a in analyses:
            verdict = a.get("verdict") if isinstance(a, dict) else getattr(a, "verdict", "")
            if isinstance(verdict, CMOVerdict):
                verdict = verdict.value
            if verdict not in ("viral_win", "promising"):
                continue
            emb_json = a.get("embedding_json") if isinstance(a, dict) else getattr(a, "embedding_json", None)
            if not emb_json or emb_json == "[]":
                continue
            try:
                vec = json.loads(emb_json)
                if isinstance(vec, list) and len(vec) > 0:
                    high_performer_vecs.append(vec)
            except (json.JSONDecodeError, ValueError):
                continue

        if not high_performer_vecs:
            return []

        centroid = self._centroid(high_performer_vecs)
        logger.info(f"[CMO] Genome embedded from {len(high_performer_vecs)} high-performers ({len(centroid)} dims).")
        return centroid

    def _enrich_with_clusters(self, account_id: str, analyses: list) -> List[dict]:
        """
        K-means cluster enrichment for Viral DNA (k=3 to 5).

        Groups all analysis embeddings into 3-5 thematic clusters using
        mini-batch k-means, then asks Gemini Flash to label each cluster
        with a 1-sentence archetype description.

        Returns a list of cluster dicts:
          [{"cluster_id": 0, "label": "...", "size": N, "avg_score": X}, ...]
        Stored as JSON in viral_dna_profile.cluster_labels.
        """
        # Collect all embedding vectors
        vecs: List[List[float]] = []
        captions: List[str] = []
        scores: List[int] = []
        for a in analyses:
            emb_json = a.get("embedding_json") if isinstance(a, dict) else getattr(a, "embedding_json", None)
            if not emb_json or emb_json == "[]":
                continue
            try:
                vec = json.loads(emb_json)
                if isinstance(vec, list) and len(vec) > 0:
                    vecs.append(vec)
                    captions.append((a.get("why_worked", "") if isinstance(a, dict) else getattr(a, "why_worked", ""))[:80])
                    scores.append(int(a.get("cmo_score", 0) if isinstance(a, dict) else getattr(a, "cmo_score", 0)))
            except (json.JSONDecodeError, ValueError):
                continue

        if len(vecs) < 3:
            return []

        # Determine k (3–5 depending on data volume)
        k = min(5, max(3, len(vecs) // 4))

        try:
            import numpy as np

            X = np.array(vecs, dtype=np.float32)
            # Simple k-means using pure numpy (no scipy dependency)
            rng = np.random.default_rng(42)
            centroids = X[rng.choice(len(X), k, replace=False)]

            for _ in range(30):  # max 30 iterations
                dists = np.array([[np.linalg.norm(x - c) for c in centroids] for x in X])
                labels = np.argmin(dists, axis=1)
                new_centroids = np.array([
                    X[labels == i].mean(axis=0) if (labels == i).any() else centroids[i]
                    for i in range(k)
                ])
                if np.allclose(centroids, new_centroids, atol=1e-5):
                    break
                centroids = new_centroids

            # Build cluster summary payloads for Gemini labelling
            cluster_summaries = []
            for i in range(k):
                mask = labels == i
                cluster_captions = [captions[j] for j in range(len(vecs)) if mask[j]]
                cluster_scores = [scores[j] for j in range(len(vecs)) if mask[j]]
                cluster_summaries.append({
                    "cluster_id": i,
                    "size": int(mask.sum()),
                    "avg_score": round(float(np.mean(cluster_scores)), 1) if cluster_scores else 0,
                    "sample_insights": cluster_captions[:4],
                })

            # Ask Gemini Flash to label each cluster
            label_prompt = (
                "You are a viral content strategist. Below are content clusters found by k-means "
                "analysis across this account's content portfolio. For each cluster, write a single-sentence "
                "archetype label (8-15 words) that precisely describes the content strategy that cluster represents.\n\n"
                f"CLUSTERS:\n{json.dumps(cluster_summaries, indent=2)}\n\n"
                "Return a JSON array with exactly the same cluster_ids and a 'label' key added to each:\n"
                "[{\"cluster_id\": 0, \"label\": \"...\", \"size\": N, \"avg_score\": X}, ...]"
            )

            try:
                response = self.client.models.generate_content(
                    model=self.model_flash,
                    contents=label_prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.2,
                        response_mime_type="application/json",
                    ),
                )
                text = response.text.strip()
                if text.startswith("```"):
                    text = text.split("```", 2)[-1].split("```")[0].lstrip("json").strip()
                labelled = json.loads(text)
                if isinstance(labelled, list):
                    logger.info(f"[CMO] Cluster enrichment: {k} clusters labelled for {account_id[:8]}")
                    return labelled
            except Exception as label_err:
                logger.warning(f"[CMO] Cluster labelling failed: {label_err}")
                # Return unlabelled cluster summaries as fallback
                for cs in cluster_summaries:
                    cs["label"] = f"Cluster {cs['cluster_id']} ({cs['size']} items, avg score {cs['avg_score']})"
                return cluster_summaries

        except Exception as e:
            logger.warning(f"[CMO] Cluster enrichment failed: {e}")
        return []

    # ─── Next Post Prescription ───────────────────────────────────────────────

    def prescribe_next_post(self, account_id: str) -> NextPostQueue:
        """
        Generate an elite 'Next Post' prescription.
        Includes A/B test suggestion, optimal posting time, and visual direction.
        """
        logger.info(f"[CMO] ═══ Prescribing Next Post: {account_id[:8]} ═══")

        vdna = self.db.get_viral_dna(account_id)
        if not vdna or vdna.total_analyzed < 1:
            logger.warning("[CMO] No Viral DNA available for prescription.")
            return NextPostQueue(account_id=account_id)

        account = self.db.get_account(account_id)
        platform_val = account.platform.value if account and hasattr(account.platform, "value") else "tiktok"
        platform_notes = PLATFORM_NOTES.get(platform_val, "")

        # Pull top wins with axis data
        top_wins = self.db.conn.execute("""
            SELECT ca.why_worked, ca.hook_type, ca.content_type, sc.caption,
                   ca.cmo_score, ca.axis_hook_power, ca.axis_curiosity_gap,
                   ca.viral_atoms_json, ca.clone_priority
            FROM content_analysis ca
            JOIN scraped_content sc ON ca.scraped_content_id = sc.id
            WHERE ca.account_id = ? AND ca.verdict IN ('viral_win', 'promising')
            ORDER BY ca.cmo_score DESC LIMIT 5
        """, (account_id,)).fetchall()

        # Get scraper bounties from latest strategy
        bounties: list = []
        try:
            latest = self.cmo_dir / "latest.json"
            if latest.exists():
                with open(latest) as f:
                    data = json.load(f)
                bounties = data.get("strategy", {}).get("scraper_bounties", [])
        except Exception:
            pass

        # Trending topics is a placeholder — could be wired to RadarScanner in future
        trending_topics = "No trending data available — use Viral DNA as primary signal."

        # Pull top-3 semantically similar viral videos via niche-scoped embedding search.
        # Scraped content is competitor research — not account-specific — so we search
        # by niche (the account's content category) across the full corpus.
        similar_videos_context = []
        try:
            from octragon.intelligence.search import SemanticSearch
            searcher = SemanticSearch(db=self.db)
            niche_val = account.niche.value if account and hasattr(account.niche, "value") else ""
            # Build a rich query seed: genome signature + top hook patterns + winning formats.
            # Falls back to trend_direction if genome is empty (cold-start), then to niche alone.
            seed_parts = []
            if vdna.genome_signature:
                seed_parts.append(vdna.genome_signature)
            if isinstance(vdna.top_hooks, list) and vdna.top_hooks:
                hook_texts = [h.get("pattern", h) if isinstance(h, dict) else str(h) for h in vdna.top_hooks[:2]]
                seed_parts.extend(hook_texts)
            if isinstance(vdna.winning_formats, list) and vdna.winning_formats:
                seed_parts.append(" ".join(str(f) for f in vdna.winning_formats[:2]))
            if not seed_parts and vdna.trend_direction:
                seed_parts.append(vdna.trend_direction)
            if not seed_parts and niche_val:
                seed_parts.append(niche_val)
            query_text = " ".join(seed_parts).strip()
            if query_text:
                similar_hits = searcher.search(query_text, niche=niche_val, limit=10)
                seen_ids = set()
                for hit in similar_hits:
                    cid = hit.get("content_id", "")
                    if cid and cid not in seen_ids:
                        # Virality gate: only include clips that were analyzed as viral_win
                        # or promising, OR that have meaningful engagement (views > 10k).
                        sc_row = self.db.conn.execute("""
                            SELECT sc.caption, sc.source_creator, sc.engagement_views,
                                   sc.engagement_likes, ca.verdict
                            FROM scraped_content sc
                            LEFT JOIN content_analysis ca ON ca.scraped_content_id = sc.id
                            WHERE sc.id = ?
                            ORDER BY ca.cmo_score DESC LIMIT 1
                        """, (cid,)).fetchone()
                        if sc_row:
                            views = sc_row[2] or 0
                            verdict = sc_row[4] or ""
                            is_viral = verdict in ("viral_win", "promising") or views >= 10000
                            if is_viral:
                                similar_videos_context.append({
                                    "content_id": cid,
                                    "creator": sc_row[1],
                                    "caption_preview": (sc_row[0] or "")[:120],
                                    "views": views,
                                    "likes": sc_row[3] or 0,
                                    "verdict": verdict,
                                    "semantic_score": round(hit.get("score", 0), 3),
                                })
                            seen_ids.add(cid)
                    if len(similar_videos_context) >= 3:
                        break
        except Exception as e:
            logger.warning(f"[CMO] Semantic similar-videos lookup failed (numpy or search error): {e}")

        viral_dna_payload = {
            "genome_signature": vdna.genome_signature,
            "top_hooks": vdna.top_hooks[:3] if isinstance(vdna.top_hooks, list) else [],
            "winning_formats": vdna.winning_formats[:3] if isinstance(vdna.winning_formats, list) else [],
            "winning_emotions": vdna.winning_emotions[:2] if isinstance(vdna.winning_emotions, list) else [],
            "optimal_posting_times": vdna.optimal_posting_times if isinstance(vdna.optimal_posting_times, list) else [],
            "optimal_duration_range": vdna.optimal_duration_range if isinstance(vdna.optimal_duration_range, list) else [15, 30],
            "avg_engagement_rate": vdna.avg_engagement_rate,
            "trend_direction": vdna.trend_direction,
            "critical_axis_weaknesses": vdna.critical_axis_weaknesses if isinstance(vdna.critical_axis_weaknesses, list) else [],
        }

        prompt = NEXT_POST_PROMPT.format(
            viral_dna_json=json.dumps(viral_dna_payload, indent=2),
            top_wins_json=json.dumps([dict(r) for r in top_wins], indent=2, default=str),
            similar_videos_json=json.dumps(similar_videos_context, indent=2),
            bounties_json=json.dumps(bounties, indent=2),
            platform_notes=platform_notes,
            trending_topics=trending_topics,
        )

        result = self._call_gemini(prompt, model=self.model_pro, temperature=0.3)

        np_item = NextPostQueue(
            account_id=account_id,
            script=result.get("script", ""),
            hook=result.get("hook", ""),
            reference_content_id=result.get("reference_content_id", ""),
            format_type=result.get("format_type", ""),
            rationale=result.get("rationale", ""),
            priority=int(result.get("priority", 3)),
        )
        np_item.generate_id()
        self.db.save_next_post(np_item)

        logger.success(
            f"[CMO] ✅ Prescribed: '{np_item.hook[:60]}' | Priority:{np_item.priority} | Predicted:{result.get('predicted_performance','?')}"
        )

        # Persist the full prescription detail to disk
        prescription_file = self.cmo_dir / f"prescription_{account_id[:8]}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.json"
        with open(prescription_file, "w") as f:
            json.dump({"account_id": account_id, "generated_at": datetime.now(timezone.utc).isoformat(), "prescription": result}, f, indent=2)

        return np_item

    # ─── Hook & A/B Analysis ──────────────────────────────────────────────────

    def analyze_hooks(self, days: int = 7) -> dict:
        """Analyze recent hook performance across posted content."""
        logger.info(f"[CMO] Analyzing hooks over last {days} days...")
        data = self.db.get_posted_videos_with_stats(days)

        if not data:
            return {"top_hooks": [], "failing_formats": [], "golden_keywords": [], "algorithm_pulse": "No data.", "scraper_directive": "No data."}

        payload = []
        for d in data:
            eng = d.get("post_engagement", {})
            views = eng.get("view_count", 0)
            likes = eng.get("like_count", 0)
            comments = eng.get("comment_count", 0)
            payload.append({
                "niche": d.get("target_niche"),
                "creator": d.get("source_creator"),
                "caption": d.get("caption", "")[:200],
                "views": views,
                "likes": likes,
                "comments": comments,
                "engagement_rate": round(((likes + comments) / max(1, views)) * 100, 2),
            })

        prompt = HOOK_ANALYSIS_PROMPT.format(data_json=json.dumps(payload, indent=2))
        return self._call_gemini(prompt, model=self.model_flash, temperature=0.1)

    def analyze_variations(self, days: int = 7) -> dict:
        """Analyze A/B/C forgery parameter performance."""
        logger.info(f"[CMO] Analyzing forgery A/B tests over last {days} days...")
        data = self.db.get_ab_test_data(days)

        if not data:
            return {"winning_profile": "Unknown", "bypass_confidence": 0, "critical_parameter": {}, "shadow_suppression_flags": [], "next_preset_adjustment": {}}

        payload = []
        for d in data:
            eng = d.get("post_engagement", {})
            params = d.get("forge_params", {})
            idx = d.get("variation_index", 0)
            profile = ["A", "B", "C"][min(idx, 2)]
            views = eng.get("view_count", 0)
            likes = eng.get("like_count", 0)
            payload.append({
                "profile": profile,
                "platform": d.get("target_platform"),
                "views": views,
                "likes": likes,
                "engagement_rate": round(likes / max(1, views) * 100, 2),
                "fps": params.get("fps"),
                "audio_pitch": params.get("audio_pitch_shift"),
                "codec": params.get("codec"),
                "crf": params.get("crf", 22),
                "gop_size": params.get("gop_size"),
                "preset": params.get("preset"),
            })

        prompt = FORGERY_AB_TEST_PROMPT.format(data_json=json.dumps(payload, indent=2))
        return self._call_gemini(prompt, model=self.model_flash, temperature=0.1)

    def generate_strategy(self, days: int = 7) -> dict:
        """Generate the Weekly Master Strategy Memo."""
        logger.info("[CMO] ═══ Generating Master Strategy Memo ═══")
        hook_insights = self.analyze_hooks(days)
        forgery_insights = self.analyze_variations(days)
        stats = self.db.get_pipeline_stats()

        prompt = MASTER_STRATEGY_PROMPT.format(
            hook_insights=json.dumps(hook_insights, indent=2),
            forgery_insights=json.dumps(forgery_insights, indent=2),
            pipeline_stats=json.dumps(stats, indent=2),
        )
        memo = self._call_gemini(prompt, model=self.model_pro, temperature=0.2)

        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        output_file = self.cmo_dir / f"strategy_{now_str}.json"
        final_doc = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "hook_insights": hook_insights,
            "forgery_insights": forgery_insights,
            "strategy": memo,
        }
        for path in [output_file, self.cmo_dir / "latest.json"]:
            with open(path, "w") as f:
                json.dump(final_doc, f, indent=2)

        logger.success(f"[CMO] Strategy memo saved → {output_file}")
        return final_doc

    # ─── Daily Briefing ────────────────────────────────────────────────────────

    def generate_daily_todos(self, account_id: str) -> list:
        """Generate elite, hyper-specific daily to-dos for an account."""
        acct = self.db.get_account(account_id)
        if not acct:
            return []

        vdna = self.db.get_viral_dna(account_id)
        analyses_raw = self.db.get_analyses_for_account(account_id, limit=5)

        # Build a rich recent performance payload
        recent_perf = []
        for a in analyses_raw[:3]:
            if isinstance(a, dict):
                recent_perf.append({"verdict": a.get("verdict"), "score": a.get("cmo_score"), "hook": a.get("hook_type")})
            else:
                recent_perf.append({"verdict": getattr(a, "verdict", ""), "score": getattr(a, "cmo_score", 0), "hook": getattr(a, "hook_type", "")})

        viral_dna_summary = "No DNA profile yet."
        if vdna:
            viral_dna_summary = json.dumps({
                "trend": vdna.trend_direction,
                "genome": vdna.genome_signature,
                "viral_wins": vdna.viral_win_count,
                "top_hooks_count": len(vdna.top_hooks) if isinstance(vdna.top_hooks, list) else 0,
                "weak_axes": vdna.critical_axis_weaknesses[:2] if isinstance(vdna.critical_axis_weaknesses, list) else [],
            })

        platform_val = acct.platform.value if hasattr(acct.platform, "value") else "tiktok"
        niche_val = acct.niche.value if hasattr(acct.niche, "value") else ""

        prompt = DAILY_TODO_PROMPT.format(
            platform=platform_val,
            handle=acct.handle,
            niche=niche_val,
            account_type=acct.account_type.value if hasattr(acct.account_type, "value") else "",
            follower_count=acct.follower_count,
            trend=vdna.trend_direction if vdna else "unknown",
            viral_dna_summary=viral_dna_summary,
            recent_performance=json.dumps(recent_perf),
            last_posts="See recent performance",
        )

        response = self._call_gemini(prompt, model=self.model_flash, temperature=0.3)

        # Handle both list and wrapped dict responses
        todos = response if isinstance(response, list) else response.get("todos", response.get("items", []))
        if not isinstance(todos, list):
            todos = []

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        for todo in todos:
            todo_id = hashlib.sha256(
                f"{account_id}:{today}:{todo.get('action', '')[:50]}".encode()
            ).hexdigest()[:16]
            try:
                self.db.conn.execute("""
                    INSERT OR IGNORE INTO daily_todos
                    (id, account_id, date, priority, action, category, rationale, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                """, (
                    todo_id, account_id, today,
                    todo.get("priority", 3),
                    todo.get("action", ""),
                    todo.get("category", "content"),
                    todo.get("rationale", ""),
                    datetime.now(timezone.utc).isoformat(),
                ))
            except Exception as e:
                logger.warning(f"[CMO] Todo insert failed: {e}")
        self.db.conn.commit()
        logger.info(f"[CMO] Generated {len(todos)} todos for @{acct.handle}")
        return todos

    def generate_account_health(self, account_id: str) -> Optional[dict]:
        """Generate an elite, institution-grade health report with decision framework."""
        acct = self.db.get_account(account_id)
        if not acct:
            return None

        vdna = self.db.get_viral_dna(account_id)
        analyses = self.db.get_analyses_for_account(account_id)

        viral_wins = sum(1 for a in analyses if (a.get("verdict") if isinstance(a, dict) else getattr(a, "verdict", "")) in ("viral_win",))
        rejections = sum(1 for a in analyses if (a.get("verdict") if isinstance(a, dict) else getattr(a, "verdict", "")) == "rejected")
        win_rate = round(viral_wins / max(1, len(analyses)) * 100, 1) if analyses else 0.0

        # Compute average engagement from recent analyses
        eng_rates = []
        for a in analyses[:10]:
            score = a.get("cmo_score", 0) if isinstance(a, dict) else getattr(a, "cmo_score", 0)
            eng_rates.append(score)
        avg_engagement = round(statistics.mean(eng_rates), 2) if eng_rates else 0.0

        # Axis weakness profile
        if vdna and isinstance(vdna.critical_axis_weaknesses, list):
            weak = ", ".join(vdna.critical_axis_weaknesses[:3])
        else:
            weak = "unknown"

        viral_dna_summary = "No DNA yet."
        if vdna:
            viral_dna_summary = json.dumps({
                "trend": vdna.trend_direction,
                "genome": vdna.genome_signature,
                "avg_engagement": vdna.avg_engagement_rate,
                "winning_formats": vdna.winning_formats,
            })

        platform_val = acct.platform.value if hasattr(acct.platform, "value") else ""
        niche_val = acct.niche.value if hasattr(acct.niche, "value") else ""

        prompt = ACCOUNT_HEALTH_PROMPT.format(
            platform=platform_val,
            handle=acct.handle,
            niche=niche_val,
            account_type=acct.account_type.value if hasattr(acct.account_type, "value") else "",
            follower_count=acct.follower_count,
            total_scraped=self.db.conn.execute(
                "SELECT COUNT(*) FROM scraped_content WHERE target_phone = ?", (acct.phone_number,)
            ).fetchone()[0],
            total_analyzed=len(analyses),
            viral_wins=viral_wins,
            rejections=rejections,
            win_rate=win_rate,
            avg_engagement=avg_engagement,
            viral_dna_summary=viral_dna_summary,
            recent_performance=json.dumps([
                {"verdict": a.get("verdict") if isinstance(a, dict) else getattr(a, "verdict", ""), "score": a.get("cmo_score", 0) if isinstance(a, dict) else getattr(a, "cmo_score", 0)}
                for a in analyses[:5]
            ]),
            trend=vdna.trend_direction if vdna else "unknown",
            axis_weakness_profile=weak,
        )

        response = self._call_gemini(prompt, model=self.model_flash, temperature=0.1)
        if isinstance(response, dict) and "cmo_score" in response:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            health_id = hashlib.sha256(f"{account_id}:{today}".encode()).hexdigest()[:16]
            try:
                self.db.conn.execute("""
                    INSERT OR REPLACE INTO account_health
                    (id, account_id, date, cmo_score, trend, strengths, weaknesses, recommendations, raw_report, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    health_id, account_id, today,
                    response.get("cmo_score", 0),
                    response.get("trend", "neutral"),
                    json.dumps(response.get("strengths", [])),
                    json.dumps(response.get("immediate_interventions", [])),
                    json.dumps(response.get("immediate_interventions", [])),
                    json.dumps(response),
                    datetime.now(timezone.utc).isoformat(),
                ))
                self.db.conn.commit()
            except Exception as e:
                logger.error(f"[CMO] Health persist failed: {e}")
            logger.info(f"[CMO] @{acct.handle} Health: {response.get('cmo_score')}/100 | Decision: {response.get('decision', '?')}")
            return response
        return None

    # ─── Orchestrators ────────────────────────────────────────────────────────

    def run_deep_analysis(self) -> dict:
        """Full deep analysis loop: Why Analysis → Viral DNA → Prescription for all accounts."""
        logger.info("[CMO] ═══════ DEEP ANALYSIS LOOP STARTING ═══════")
        accounts = self.db.get_all_accounts()
        results = {"accounts": 0, "analyses": 0, "dna_updated": 0, "posts_prescribed": 0, "errors": 0}

        for acct in accounts:
            logger.info(f"[CMO] Processing @{acct.handle} ({acct.platform.value if hasattr(acct.platform,'value') else ''})...")
            unanalyzed = self.db.conn.execute("""
                SELECT sc.id FROM scraped_content sc
                LEFT JOIN content_analysis ca ON sc.id = ca.scraped_content_id
                WHERE sc.target_phone = ? AND ca.id IS NULL
                ORDER BY sc.engagement_views DESC LIMIT 10
            """, (acct.phone_number,)).fetchall()

            for row in unanalyzed:
                try:
                    self.analyze_content(row[0], acct.id)
                    results["analyses"] += 1
                except Exception as e:
                    logger.error(f"[CMO] Analysis failed {row[0]}: {e}")
                    results["errors"] += 1

            analyses = self.db.get_analyses_for_account(acct.id)
            if len(analyses) >= 3:
                try:
                    self.update_viral_dna(acct.id)
                    results["dna_updated"] += 1
                    self.prescribe_next_post(acct.id)
                    results["posts_prescribed"] += 1
                except Exception as e:
                    logger.error(f"[CMO] DNA/Prescription failed: {e}")
                    results["errors"] += 1

            results["accounts"] += 1

        logger.success(f"[CMO] ═══════ DEEP ANALYSIS COMPLETE ═══════ {results}")
        return results

    def run_daily_briefing(self) -> dict:
        """Daily briefing: health scores + to-dos for all accounts. Uses Flash for speed."""
        logger.info("[CMO] ═════ DAILY BRIEFING ═════")
        accounts = self.db.get_all_accounts()
        results = {"accounts": 0, "health_scored": 0, "todos": 0, "errors": 0}

        for acct in accounts:
            try:
                health = self.generate_account_health(acct.id)
                if health:
                    results["health_scored"] += 1
                todos = self.generate_daily_todos(acct.id)
                results["todos"] += len(todos)
                results["accounts"] += 1
            except Exception as e:
                logger.error(f"[CMO] Briefing failed @{acct.handle}: {e}")
                results["errors"] += 1

        logger.success(f"[CMO] ═════ BRIEFING COMPLETE ═════ {results}")
        return results

    # ─── Smart Account Audit Orchestration (v2.1) ──────────────────────────────

    async def audit_account_smart(self, handle: str, platform: str = "tiktok") -> dict:
        """
        Perform a 'Smart Audit' on an account:
        1. Discover 20 latest videos.
        2. Pick High-Signal videos: Top 3 Viral + 2 Most Recent.
        3. Analyze 5 videos using Gemini 2.0 Flash (Sensing).
        4. Synthesize Viral DNA using Gemini 2.5 Pro (Strategy).
        5. Prescribe Next Post using Gemini 2.5 Pro.
        """
        from octragon.scraper.discovery import CompetitorDiscovery
        discovery = CompetitorDiscovery(self.config)
        
        logger.info(f"[CMO] Starting Smart Audit for @{handle}...")
        
        # 1. Discover 20 candidates (Raw fetch, skip standard discovery filters)
        raw = await discovery._fetch_creator_videos(
            handle=handle,
            platform=SourcePlatform(platform) if isinstance(platform, str) else platform,
            max_videos=20,
            cookies_path=discovery._cookies_path(platform)
        )
        if not raw:
            return {"error": "No videos found for creator"}
            
        # 2. Pick High-Signal videos
        selected_candidates = self._pick_high_signal_videos(raw)
        logger.info(f"[CMO] Selected {len(selected_candidates)} high-signal videos for deep audit.")
        
        # Ensure account exists in DB
        account = self.db.get_account_by_handle_and_platform(handle, platform)
        if not account:
            # Fallback for manual handles not yet in watchlist
            account = Account(handle=handle, platform=SourcePlatform(platform) if isinstance(platform, str) else platform, niche=NicheType.ECOM, phone=1)
            account.generate_id()
            self.db.save_account(account)

        # 3. Analyze the 5 videos (Flash Sensing)
        from octragon.scraper.engine import OctragonScraper
        scraper = OctragonScraper(self.config)
        
        analyses = []
        for cand in selected_candidates:
            try:
                # Scrape video
                sc = await scraper.scrape(cand["url"])
                self.db.save_scraped_content(sc)  # auto-embeds via _auto_embed_after_upsert

                # Deep multmodal analysis (Explicitly use Flash for bulk sensing)
                ca = self.analyze_content(sc.id, account_id=account.id, model=self.model_flash)
                analyses.append(ca)
            except Exception as e:
                logger.warning(f"[CMO] Failed to analyze {cand['url']}: {e}")
                continue

        if not analyses:
            return {"error": "All video analyses failed"}

        # 4. Synthesize Viral DNA (Pro Strategy)
        vdna = self.update_viral_dna(account.id)
        
        # 5. Prescribe Next Post (Pro Strategy)
        next_post = self.prescribe_next_post(account.id)

        return {
            "account_id": account.id,
            "videos_analyzed": len(analyses),
            "viral_dna": vdna.genome_signature,
            "next_post_hook": next_post.hook,
            "win_rate": f"{vdna.viral_win_count}/{vdna.total_analyzed}",
        }

    def _pick_high_signal_videos(self, candidates: list) -> list:
        """
        Surgical selection:
        - Sort by view_count: Pick Top 3 (The 'Why' of Success).
        - Sort by date: Pick Top 2 (The 'Current Meta').
        - Deduplicate by URL.
        """
        # Viral Peaks (Top 3)
        viral = sorted(candidates, key=lambda x: x.get('view_count', 0), reverse=True)[:3]
        
        # Newest Meta (Latest 2)
        # discovery.py candidates are already somewhat reverse-chronological
        recent = candidates[:5] 
        
        # Combine and deduplicate
        combined = {c["url"]: c for c in (viral + recent)}
        
        # Final cut: Limit to 5 max total to keep it "smart"
        results = list(combined.values())[:5]
        return results

    def close(self):
        """Release DB resources."""
        if hasattr(self.db, "close"):
            self.db.close()
