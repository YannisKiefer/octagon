"""
Octragon System — Smart Data Retention (Garbage Collector)

Automatically manages disk space by:
  1. Classifying videos as "golden nuggets" (keep permanently) or "stale" (delete)
  2. Deleting stale video files after configurable time windows
  3. Preserving DB records for analytics (only files are deleted)

Retention policy:
  - FAILED/REJECTED: Delete video files after 7 days
  - PROCESSED but NOT POSTED: Delete after 14 days
  - GOLDEN NUGGET (posted + high engagement): Keep permanently
  - ORIGINAL videos with active variations: Keep until all variations processed

Runs on the same 4-hour scheduler loop as discovery.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from loguru import logger

from octragon.config import OctragonConfig, get_config
from octragon.db import OctragonDB


# ── Retention thresholds ──────────────────────────────────────────────────

STALE_FAILED_DAYS = 7          # Delete failed/rejected content after 7 days
STALE_UNPOSTED_DAYS = 14       # Delete processed-but-not-posted after 14 days
GOLDEN_NUGGET_MIN_VIEWS = 50_000  # Never delete if views >= this threshold


# ── Classification ────────────────────────────────────────────────────────

class RetentionClass:
    GOLDEN = "golden"       # Keep forever
    ACTIVE = "active"       # Still in pipeline, don't touch
    STALE_FAILED = "stale_failed"      # Failed, can delete
    STALE_UNPOSTED = "stale_unposted"  # Done but never posted
    STALE_REJECTED = "stale_rejected"  # Rejected by user


class FileToDelete:
    """Represents a file that should be cleaned up."""
    def __init__(self, path: str, content_id: str, reason: str, age_days: int):
        self.path = path
        self.content_id = content_id
        self.reason = reason
        self.age_days = age_days
        self.size_bytes = 0
        try:
            if os.path.exists(path):
                self.size_bytes = os.path.getsize(path)
        except OSError:
            pass

    def __repr__(self):
        size_mb = self.size_bytes / (1024 * 1024)
        return f"<FileToDelete {self.path} ({size_mb:.1f}MB, {self.age_days}d, {self.reason})>"


# ── Garbage Collector ────────────────────────────────────────────────────

class GarbageCollector:
    """
    Smart retention engine.

    Scans the database and filesystem to identify stale content,
    then safely removes video files while preserving DB records.
    """

    def __init__(self, config: Optional[OctragonConfig] = None, db: Optional[OctragonDB] = None):
        self.config = config or get_config()
        self.db = db or OctragonDB(self.config.db_path)

    def scan_stale(self) -> list[FileToDelete]:
        """
        Scan the database for stale content that can be cleaned up.
        Returns a list of files to delete.
        """
        now = datetime.now(timezone.utc)
        to_delete: list[FileToDelete] = []

        # ── 1. Failed/errored scrapes older than STALE_FAILED_DAYS ────────
        cursor = self.db.conn.execute("""
            SELECT id, video_path, audio_path, created_at, scrape_status,
                   engagement_views
            FROM scraped_content
            WHERE scrape_status IN ('failed')
              AND video_path != ''
        """)
        for row in cursor.fetchall():
            age = self._age_days(row["created_at"], now)
            if age >= STALE_FAILED_DAYS:
                if row["video_path"]:
                    to_delete.append(FileToDelete(
                        row["video_path"], row["id"],
                        "failed_scrape", age
                    ))
                if row["audio_path"]:
                    to_delete.append(FileToDelete(
                        row["audio_path"], row["id"],
                        "failed_scrape_audio", age
                    ))

        # ── 2. Rejected variations older than STALE_FAILED_DAYS ───────────
        cursor = self.db.conn.execute("""
            SELECT v.id, v.video_path, v.created_at, v.scraped_content_id,
                   d.approval_status
            FROM video_variations v
            LEFT JOIN delivery_log d ON d.variation_id = v.id
            WHERE d.approval_status = 'rejected'
              AND v.video_path != ''
        """)
        for row in cursor.fetchall():
            age = self._age_days(row["created_at"], now)
            if age >= STALE_FAILED_DAYS:
                to_delete.append(FileToDelete(
                    row["video_path"], row["scraped_content_id"],
                    "rejected_variation", age
                ))

        # ── 3. Processed but never posted, older than STALE_UNPOSTED_DAYS ─
        cursor = self.db.conn.execute("""
            SELECT v.id, v.video_path, v.created_at, v.scraped_content_id,
                   sc.engagement_views
            FROM video_variations v
            JOIN scraped_content sc ON sc.id = v.scraped_content_id
            LEFT JOIN delivery_log d ON d.variation_id = v.id
            WHERE v.cleanse_status = 'done'
              AND v.video_path != ''
              AND (d.id IS NULL OR d.approval_status = 'pending')
        """)
        for row in cursor.fetchall():
            # Skip golden nuggets
            if row["engagement_views"] >= GOLDEN_NUGGET_MIN_VIEWS:
                continue
            age = self._age_days(row["created_at"], now)
            if age >= STALE_UNPOSTED_DAYS:
                to_delete.append(FileToDelete(
                    row["video_path"], row["scraped_content_id"],
                    "unposted_variation", age
                ))

        # ── 4. Orphan originals (all variations processed/deleted) ────────
        cursor = self.db.conn.execute("""
            SELECT sc.id, sc.video_path, sc.audio_path, sc.created_at,
                   sc.engagement_views
            FROM scraped_content sc
            WHERE sc.scrape_status = 'downloaded'
              AND sc.video_path != ''
              AND sc.engagement_views < ?
              AND NOT EXISTS (
                  SELECT 1 FROM video_variations v
                  WHERE v.scraped_content_id = sc.id
                    AND v.cleanse_status IN ('pending', 'processing')
              )
        """, (GOLDEN_NUGGET_MIN_VIEWS,))
        for row in cursor.fetchall():
            age = self._age_days(row["created_at"], now)
            if age >= STALE_UNPOSTED_DAYS:
                # Check if any variations are still active
                active = self.db.conn.execute(
                    "SELECT COUNT(*) c FROM delivery_log WHERE scraped_content_id = ? AND approval_status IN ('pending', 'approved')",
                    (row["id"],)
                ).fetchone()["c"]
                if active > 0:
                    continue
                if row["video_path"]:
                    to_delete.append(FileToDelete(
                        row["video_path"], row["id"],
                        "orphan_original", age
                    ))
                if row["audio_path"]:
                    to_delete.append(FileToDelete(
                        row["audio_path"], row["id"],
                        "orphan_audio", age
                    ))

        return to_delete

    def delete_files(self, files: list[FileToDelete], dry_run: bool = False) -> dict:
        """
        Delete the specified files from disk.
        Returns summary stats. Preserves DB records.
        """
        deleted = 0
        skipped = 0
        freed_bytes = 0
        errors = 0

        for f in files:
            if not os.path.exists(f.path):
                skipped += 1
                continue

            if dry_run:
                logger.info(f"[GC] DRY RUN: Would delete {f}")
                deleted += 1
                freed_bytes += f.size_bytes
                continue

            try:
                os.remove(f.path)
                freed_bytes += f.size_bytes
                deleted += 1
                logger.info(f"[GC] Deleted: {f.path} ({f.reason}, {f.age_days}d old)")

                # Clear the video_path in DB so we don't try to delete again
                self._clear_file_path(f)
            except OSError as e:
                logger.error(f"[GC] Failed to delete {f.path}: {e}")
                errors += 1

        # Clean up empty directories
        if not dry_run:
            self._cleanup_empty_dirs()

        freed_mb = freed_bytes / (1024 * 1024)
        summary = {
            "deleted": deleted,
            "skipped": skipped,
            "errors": errors,
            "freed_mb": round(freed_mb, 1),
            "dry_run": dry_run,
        }
        logger.success(f"[GC] {'DRY RUN ' if dry_run else ''}Complete: "
                       f"{deleted} files, {freed_mb:.1f}MB freed, {errors} errors")
        return summary

    def _clear_file_path(self, f: FileToDelete):
        """Clear the file path in DB after deletion."""
        try:
            if "audio" in f.reason:
                self.db.conn.execute(
                    "UPDATE scraped_content SET audio_path = '' WHERE id = ?",
                    (f.content_id,)
                )
            elif "original" in f.reason or "failed" in f.reason:
                self.db.conn.execute(
                    "UPDATE scraped_content SET video_path = '' WHERE id = ?",
                    (f.content_id,)
                )
            elif "variation" in f.reason:
                self.db.conn.execute(
                    "UPDATE video_variations SET video_path = '' WHERE video_path = ?",
                    (f.path,)
                )
            self.db.conn.commit()
        except Exception as e:
            logger.warning(f"[GC] DB clear failed for {f.path}: {e}")

    def _cleanup_empty_dirs(self):
        """Remove empty subdirectories from the videos folder."""
        videos_dir = self.config.videos_dir
        if not videos_dir.exists():
            return
        for dirpath, dirnames, filenames in os.walk(str(videos_dir), topdown=False):
            if not dirnames and not filenames and dirpath != str(videos_dir):
                try:
                    os.rmdir(dirpath)
                    logger.debug(f"[GC] Removed empty dir: {dirpath}")
                except OSError:
                    pass

    def run(self, dry_run: bool = False) -> dict:
        """Full GC cycle: scan + delete."""
        stale = self.scan_stale()
        if not stale:
            logger.info("[GC] No stale files found")
            return {"deleted": 0, "freed_mb": 0, "dry_run": dry_run}

        # Group by reason for logging
        by_reason: dict[str, int] = {}
        for f in stale:
            by_reason[f.reason] = by_reason.get(f.reason, 0) + 1
        logger.info(f"[GC] Found {len(stale)} stale files: {by_reason}")

        return self.delete_files(stale, dry_run=dry_run)

    @staticmethod
    def _age_days(created_at_str: str, now: datetime) -> int:
        """Calculate age in days from a datetime string."""
        try:
            if created_at_str.endswith("Z"):
                created_at_str = created_at_str[:-1] + "+00:00"
            created = datetime.fromisoformat(created_at_str)
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            return (now - created).days
        except (ValueError, TypeError):
            return 0


# ── CLI entry point ──────────────────────────────────────────────────────

async def run_gc(dry_run: bool = True) -> dict:
    """Run the garbage collector (used by run.py gc)."""
    config = get_config()
    db = OctragonDB(config.db_path)
    gc = GarbageCollector(config, db)
    return gc.run(dry_run=dry_run)
