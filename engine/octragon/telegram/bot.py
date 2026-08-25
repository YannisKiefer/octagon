"""
Octragon Telegram Bot — 4-Group Distribution Engine

Monitors 4 Telegram groups (one per phone/niche).
When Yannis drops a video URL:
  1. Scrapes the video
  2. Runs the forgery pipeline (3 variations)
  3. Injects metadata
  4. Sends back 3 variation cards with SELECT buttons
  5. On approval → delivers ready video for posting

Group routing:
  Group 1 (Phone 1 / E-commerce)  → NicheType.ECOM
  Group 2 (Phone 2 / AI/Tech)     → NicheType.AI_TECH
  Group 3 (Phone 3 / Business)    → NicheType.BUSINESS
  Group 4 (Phone 4 / Lifestyle)   → NicheType.LIFESTYLE
"""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from typing import Optional

from loguru import logger
from telegram import (
    Bot,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Update,
)
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from ..config import get_config
from ..db import OctragonDB
from ..models import (
    DeliveryLog, NicheType, ScrapedContent,
    ScrapeStatus, TargetPlatform,
)
from ..scraper.engine import OctragonScraper, detect_platform
from ..forgery.pipeline import VariationGenerator
from ..metadata.injector import MetadataInjector
from ..caption.engine import CaptionEngine, Platform as CaptionPlatform, get_default_platforms
from ..video_editor.pipeline import VideoEditorPipeline, EditStatus


# URL pattern that matches TikTok, Instagram, LinkedIn video URLs
VIDEO_URL_PATTERN = re.compile(
    r"https?://((?:www\.|vm\.|vt\.)?tiktok\.com"
    r"|(?:www\.)?instagram\.com"
    r"|(?:www\.)?linkedin\.com)"
    r"\S+"
)


def extract_url(text: str) -> Optional[str]:
    """Extract first video URL from message text."""
    match = VIDEO_URL_PATTERN.search(text or "")
    return match.group(0) if match else None


def _niche_emoji(niche: NicheType) -> str:
    return {
        NicheType.ECOM: "🛒",
        NicheType.AI_TECH: "🤖",
        NicheType.BUSINESS: "💼",
        NicheType.LIFESTYLE: "🌟",
    }.get(niche, "📱")


def _platform_emoji(platform: str) -> str:
    return {"tiktok": "🎵", "instagram": "📸", "linkedin": "💼"}.get(platform.lower(), "🎬")


class OctragonBot:
    """The 4-group Telegram bot for the Octragon System."""

    def __init__(self, config=None):
        self.config = config or get_config()
        self.db = OctragonDB(self.config.db_path)
        self.scraper = OctragonScraper(self.config)
        self.forger = VariationGenerator(self.config)
        self.metadata = MetadataInjector(self.config)
        self.caption_engine = CaptionEngine(self.config)
        self.video_editor = VideoEditorPipeline(self.config) if self.config.video_editor_enabled else None

        # Build application
        self.app = (
            Application.builder()
            .token(self.config.telegram_bot_token)
            .build()
        )
        self._register_handlers()

        # Initialize niche configs in DB
        self._init_niche_configs()

    def _init_niche_configs(self):
        """Seed DB with default niche configs on first run."""
        for nc in self.config.niche_configs:
            existing = self.db.get_niche_config(nc.phone_number)
            if not existing:
                self.db.save_niche_config(nc)
                logger.info(f"[Bot] Seeded niche config: Phone {nc.phone_number} = {nc.niche_name}")

    def _register_handlers(self):
        """Register all Telegram handlers."""
        # Commands
        self.app.add_handler(CommandHandler("start", self.cmd_start))
        self.app.add_handler(CommandHandler("status", self.cmd_status))
        self.app.add_handler(CommandHandler("stats", self.cmd_stats))
        self.app.add_handler(CommandHandler("caption", self.cmd_caption))
        self.app.add_handler(CommandHandler("edit", self.cmd_edit))
        self.app.add_handler(CommandHandler("watch", self.cmd_watch))
        self.app.add_handler(CommandHandler("unwatch", self.cmd_unwatch))
        self.app.add_handler(CommandHandler("watchlist", self.cmd_watchlist))
        self.app.add_handler(CommandHandler("daily", self.cmd_daily))
        self.app.add_handler(CommandHandler("radar", self.cmd_radar))

        # Message handler — detect URLs
        self.app.add_handler(MessageHandler(
            filters.TEXT & ~filters.COMMAND,
            self.handle_message,
        ))

        # Callback handler — variation selection buttons
        self.app.add_handler(CallbackQueryHandler(
            self.handle_callback,
            pattern=r"^select_variation:",
        ))
        self.app.add_handler(CallbackQueryHandler(
            self.handle_callback,
            pattern=r"^skip:",
        ))

    # -----------------------------------------------------------------------
    # Commands
    # -----------------------------------------------------------------------

    async def cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        group_id = str(update.effective_chat.id)
        niche = self.db.get_niche_by_telegram_group(group_id)
        if niche:
            await update.message.reply_text(
                f"👋 *Octragon System — {niche.niche_name}* (Phone {niche.phone_number})\n\n"
                f"Drop any TikTok, Instagram or LinkedIn video URL and I'll process it.\n"
                f"Platforms: {', '.join(p.value.title() for p in niche.platforms)}",
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            await update.message.reply_text(
                "⚠️ This group is not configured as an Octragon group.\n"
                f"Group ID: `{group_id}`",
                parse_mode=ParseMode.MARKDOWN,
            )

    async def cmd_status(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        group_id = str(update.effective_chat.id)
        niche = self.db.get_niche_by_telegram_group(group_id)
        if not niche:
            await update.message.reply_text("❌ Not an Octragon group.")
            return
        stats = self.db.get_pipeline_stats()
        phone_stats = stats.get("by_phone", {}).get(niche.phone_number, {})
        await update.message.reply_text(
            f"📊 *Phone {niche.phone_number} — {niche.niche_name}*\n\n"
            f"📥 Scraped: {phone_stats.get('scraped', 0)}\n"
            f"✅ Posted: {phone_stats.get('posted', 0)}\n"
            f"⏳ Pending: {stats.get('pending_approvals', 0)} awaiting selection",
            parse_mode=ParseMode.MARKDOWN,
        )

    async def cmd_stats(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        stats = self.db.get_pipeline_stats()
        await update.message.reply_text(
            f"🎯 *Octragon System — Global Stats*\n\n"
            f"📥 Total scraped: {stats.get('total_scraped', 0)}\n"
            f"🎬 Variations generated: {stats.get('total_variations', 0)}\n"
            f"✅ Ready for review: {stats.get('variations_ready', 0)}\n"
            f"⏳ Pending approvals: {stats.get('pending_approvals', 0)}\n"
            f"📤 Total posted: {stats.get('total_delivered', 0)}",
            parse_mode=ParseMode.MARKDOWN,
        )

    async def cmd_caption(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """
        /caption <video context or topic>
        Generates viral captions for the niche of this group across all platforms.
        Example: /caption This is about how I went from 0 to 10k followers in 90 days
        """
        group_id = str(update.effective_chat.id)
        niche_cfg = self.db.get_niche_by_telegram_group(group_id)
        if not niche_cfg:
            await update.message.reply_text("❌ Not an Octragon group.")
            return

        context_text = " ".join(context.args) if context.args else ""
        if not context_text:
            await update.message.reply_text(
                "Usage: `/caption <describe what the video is about>`\n\n"
                "Example: `/caption founder story, went from 0 to $1M ARR in 18 months, bootstrapped`",
                parse_mode=ParseMode.MARKDOWN,
            )
            return

        ack = await update.message.reply_text(
            "✍️ Generating viral captions...",
            parse_mode=ParseMode.MARKDOWN,
        )

        try:
            platforms = get_default_platforms(niche_cfg.niche)
            results = await self.caption_engine.generate_all_platforms(
                niche=niche_cfg.niche,
                video_context=context_text,
                platforms=platforms,
            )

            # Build response card
            lines = [f"✍️ *Captions for Phone {niche_cfg.phone_number} — {niche_cfg.niche_name}*\n"]
            platform_emoji = {"tiktok": "🎵", "instagram": "📸", "linkedin": "💼"}

            for platform, result in results.items():
                if not result:
                    lines.append(f"{platform_emoji.get(platform.value, '📝')} *{platform.value.title()}*: _(generation failed)_\n")
                    continue
                emoji = platform_emoji.get(platform.value, '📝')
                lines.append(
                    f"{emoji} *{platform.value.title()}* ({result.char_count} chars)\n"
                    f"```\n{result.full_post}\n```\n"
                )

            response = "\n".join(lines)
            # Telegram has 4096 char limit; split if needed
            if len(response) > 4000:
                for i in range(0, len(response), 4000):
                    await update.message.reply_text(response[i:i+4000], parse_mode=ParseMode.MARKDOWN)
            else:
                await update.message.reply_text(response, parse_mode=ParseMode.MARKDOWN)

        except Exception as e:
            logger.exception(f"[Caption] Error: {e}")
            await update.message.reply_text(f"❌ Caption generation failed: {str(e)[:200]}")
        finally:
            await ack.delete()

    # -----------------------------------------------------------------------
    # /edit Command — Agentic Video Editor
    # -----------------------------------------------------------------------

    async def cmd_edit(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """
        /edit <url>
        Downloads a video, runs Gemini watermark analysis, crops if needed,
        and overlays the EcomBrain logo center-screen.
        """
        if not self.video_editor:
            await update.message.reply_text("❌ Video Editor is disabled in config.")
            return

        url = " ".join(context.args) if context.args else ""
        if not url:
            await update.message.reply_text(
                "Usage: `/edit <video URL>`\n\n"
                "Example: `/edit https://www.tiktok.com/@user/video/123`\n\n"
                "I'll download it in Ultra HD, analyze watermarks with AI, "
                "crop if needed, and add the EcomBrain branding.",
                parse_mode=ParseMode.MARKDOWN,
            )
            return

        # Acknowledge
        ack = await update.message.reply_text(
            "🎬 *Agentic Video Editor*\n\n"
            f"`{url[:60]}{'...' if len(url) > 60 else ''}`\n\n"
            "⏳ Step 1/4: Downloading Ultra HD...",
            parse_mode=ParseMode.MARKDOWN,
        )

        # Run pipeline in background
        asyncio.create_task(
            self._run_edit_pipeline(
                url=url,
                chat_id=update.effective_chat.id,
                ack_message_id=ack.message_id,
            )
        )

    async def _run_edit_pipeline(self, url: str, chat_id: int, ack_message_id: int):
        """Background task for the video editor pipeline."""
        bot = self.app.bot

        try:
            # Update status: downloading
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=ack_message_id,
                text=(
                    "🎬 *Agentic Video Editor*\n\n"
                    "⬇️ Step 1/4: Downloading at max quality..."
                ),
                parse_mode=ParseMode.MARKDOWN,
            )

            # Step 1: Download
            from ..video_editor.pipeline import VideoEditorPipeline
            result = await self.video_editor.process_url(url)

            if result.status == EditStatus.REJECTED:
                await bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=ack_message_id,
                    text=(
                        "🎬 *Agentic Video Editor*\n\n"
                        f"❌ *REJECTED*\n\n"
                        f"Reason: _{result.error_message}_\n\n"
                        f"The watermarks on this video cannot be cleanly removed "
                        f"without cropping too much content."
                    ),
                    parse_mode=ParseMode.MARKDOWN,
                )
                return

            if result.status == EditStatus.ERROR:
                await bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=ack_message_id,
                    text=(
                        "🎬 *Agentic Video Editor*\n\n"
                        f"❌ *Error:* {result.error_message[:200]}"
                    ),
                    parse_mode=ParseMode.MARKDOWN,
                )
                return

            # Success — send the branded video
            decision = result.decision
            action_emoji = {"ignore": "✅", "crop": "✂️", "reject": "❌"}
            action_text = decision.action.value if decision else "unknown"

            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=ack_message_id,
                text=(
                    "🎬 *Agentic Video Editor*\n\n"
                    f"{action_emoji.get(action_text, '🤔')} Watermark: *{action_text.upper()}*\n"
                    f"🧠 Confidence: {decision.confidence:.0%}\n"
                    f"⏱ Processed in {result.processing_time_seconds:.1f}s\n\n"
                    "📤 Uploading branded video..."
                ),
                parse_mode=ParseMode.MARKDOWN,
            )

            # Send the final video
            with open(result.output_path, "rb") as video_file:
                await bot.send_video(
                    chat_id=chat_id,
                    video=video_file,
                    caption=(
                        f"✅ *EcomBrain Branded Video*\n\n"
                        f"🧠 AI Decision: {action_text.upper()} "
                        f"({decision.confidence:.0%} confidence)\n"
                        f"📝 _{decision.reasoning}_"
                    ),
                    parse_mode=ParseMode.MARKDOWN,
                    supports_streaming=True,
                )

        except Exception as e:
            logger.exception(f"[VideoEditor Bot] Error: {e}")
            try:
                await bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=ack_message_id,
                    text=f"❌ Video Editor failed: {str(e)[:200]}",
                )
            except Exception:
                pass

    # -----------------------------------------------------------------------
    # Message Handler — URL detection
    # -----------------------------------------------------------------------

    async def handle_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Detect video URL in group messages and start pipeline."""
        if not update.message or not update.message.text:
            return

        group_id = str(update.effective_chat.id)
        niche = self.db.get_niche_by_telegram_group(group_id)
        if not niche:
            return  # Not an Octragon group — ignore silently

        url = extract_url(update.message.text)
        if not url:
            return  # No URL in message

        platform = detect_platform(url)
        if not platform:
            await update.message.reply_text("❌ Unsupported URL. Use TikTok, Instagram, or LinkedIn.")
            return

        # Check if already scraped
        existing = self.db.get_scraped_by_url(url)
        if existing and existing.scrape_status == ScrapeStatus.DOWNLOADED:
            await update.message.reply_text(
                f"ℹ️ Already processed this URL. Re-running pipeline..."
            )

        # Acknowledge immediately
        ack = await update.message.reply_text(
            f"{_platform_emoji(platform.value)} *Processing...*\n"
            f"`{url[:60]}{'...' if len(url) > 60 else ''}`\n\n"
            f"⏳ Scraping → Forging (3 variations) → Injecting metadata...",
            parse_mode=ParseMode.MARKDOWN,
        )

        # Run the full pipeline in background
        asyncio.create_task(
            self._run_pipeline(
                url=url,
                platform=platform,
                niche=niche,
                chat_id=update.effective_chat.id,
                ack_message_id=ack.message_id,
            )
        )

    async def _run_pipeline(
        self,
        url: str,
        platform,
        niche,
        chat_id: int,
        ack_message_id: int,
    ):
        """
        Full pipeline: scrape → forge (3 variations) → inject metadata → send to Telegram.
        Runs as a background task to avoid blocking the bot.
        """
        bot = self.app.bot

        try:
            # --- STEP 1: SCRAPE ---
            logger.info(f"[Pipeline] Starting for {url}")
            sc = await self.scraper.scrape(
                url=url,
                target_niche=niche.niche,
                target_phone=niche.phone_number,
                telegram_group_id=str(chat_id),
            )
            self.db.upsert_scraped_content(sc)  # auto-embeds via _auto_embed_after_upsert

            # Update ack message
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=ack_message_id,
                text=(
                    f"✅ Scraped: *{sc.source_creator or 'unknown creator'}*\n"
                    f"📱 {platform.value.title()} • {sc.duration_seconds}s • "
                    f"{sc.engagement_views:,} views\n\n"
                    f"🎬 Generating 3 unique variations..."
                ),
                parse_mode=ParseMode.MARKDOWN,
            )

            # --- STEP 2: FORGERY ---
            variations = await self.forger.generate(
                scraped_content_id=sc.id,
                video_path=sc.video_path,
                gps_lat_center=niche.gps_lat_center,
                gps_lon_center=niche.gps_lon_center,
                device_profile=niche.device_profile,
            )
            for var in variations:
                self.db.save_variation(var)

            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=ack_message_id,
                text=(
                    f"✅ 3 variations forged\n"
                    f"💉 Stripping metadata (mediaunicum + local)..."
                ),
                parse_mode=ParseMode.MARKDOWN,
            )

            # --- STEP 3: METADATA STRIPPING (mediaunicum.xyz + ExifTool fallback) ---
            ready_paths = await self.metadata.inject_all(variations, sc.id)

            # Pass each variation through Telethon Userbot for an extra layer of uniquification
            from ..metadata.telethon_client import MediaUnicumTelethonClient
            telethon_uniquifier = MediaUnicumTelethonClient(self.config)
            stripped_paths = []
            for i, rp in enumerate(ready_paths):
                try:
                    stripped = await telethon_uniquifier.strip_metadata(rp)
                    if stripped:
                        import shutil
                        shutil.move(str(stripped), str(rp))  # replace in-place
                        logger.info(f"[Pipeline] Telethon stripped variation {i}: {rp}")
                    else:
                        logger.info(f"[Pipeline] Telethon unavailable/session missing for var {i} — keeping ExifTool result")
                except Exception as e:
                    logger.warning(f"[Pipeline] Telethon error for var {i}: {e} — keeping ExifTool result")
                stripped_paths.append(rp)
            ready_paths = stripped_paths

            # Update variation records with metadata injection status
            for var in variations:
                self.db.update_variation_status(
                    var.id,
                    var.cleanse_status,
                    metadata_injected=True,
                )

            # --- STEP 4: CREATE DELIVERY LOGS & SEND CARDS ---
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=ack_message_id,
                text="📤 Sending variation cards...",
                parse_mode=ParseMode.MARKDOWN,
            )

            await self._send_variation_cards(
                bot=bot,
                chat_id=chat_id,
                sc=sc,
                variations=variations,
                ready_paths=ready_paths,
                niche=niche,
            )

            # Final ack update
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=ack_message_id,
                text=(
                    f"✅ *Pipeline complete!*\n"
                    f"Select a variation below to approve for posting."
                ),
                parse_mode=ParseMode.MARKDOWN,
            )
            logger.info(f"[Pipeline] Sent selection cards.")
            return sc

        except Exception as e:
            logger.exception(f"[Pipeline] Fail: {e}")
            try:
                await bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=ack_message_id,
                    text=f"❌ *Pipeline Failed*:\n`{str(e)}`",
                    parse_mode=ParseMode.MARKDOWN,
                )
            except Exception:
                pass
            return None

    async def _send_variation_cards(
        self,
        bot: Bot,
        chat_id: int,
        sc: ScrapedContent,
        variations: list,
        ready_paths: list[str],
        niche,
    ):
        """Send one card per variation with selection button and video file."""
        niche_emoji = _niche_emoji(niche.niche)
        platform_emoji = _platform_emoji(sc.source_platform.value)

        # Create delivery log entries first
        delivery_logs = []
        for var, ready_path in zip(variations, ready_paths):
            # Create delivery log for each target platform of this phone
            for target_platform in niche.platforms:
                account = ""
                if target_platform == TargetPlatform.TIKTOK:
                    account = niche.tiktok_handle
                elif target_platform == TargetPlatform.INSTAGRAM:
                    account = niche.instagram_handle
                elif target_platform == TargetPlatform.LINKEDIN:
                    account = niche.linkedin_handle

                dl = DeliveryLog(
                    variation_id=var.id,
                    scraped_content_id=sc.id,
                    phone_number=niche.phone_number,
                    target_platform=target_platform,
                    target_account=account,
                    telegram_group_id=str(chat_id),
                )
                dl.generate_id()
                delivery_logs.append((dl, var, ready_path))

        # Header card
        caption_preview = (sc.caption[:120] + "...") if len(sc.caption) > 120 else sc.caption
        header_text = (
            f"{niche_emoji} *Phone {niche.phone_number} — {niche.niche_name}*\n"
            f"{platform_emoji} Source: *{sc.source_creator or 'unknown'}*\n"
            f"👁 {sc.engagement_views:,} views • ❤️ {sc.engagement_likes:,} likes\n\n"
            f"📝 _{caption_preview}_\n\n"
            f"*Select which variation to approve:*"
        )
        await bot.send_message(chat_id=chat_id, text=header_text, parse_mode=ParseMode.MARKDOWN)

        # Send one card per variation
        for i, (var, ready_path) in enumerate(zip(variations, ready_paths)):
            label = var.variation_label  # A, B, C
            fp = var.forge_params

            card_text = (
                f"*Variation {label}*\n"
                f"fps={fp.fps} | crop={fp.crop_top}px | "
                f"pitch={fp.audio_pitch_shift:+.1%} | bitrate={fp.video_bitrate}\n"
                f"📍 GPS: {fp.gps_latitude:.4f}, {fp.gps_longitude:.4f}"
            )

            if Path(ready_path).exists():
                # Update all delivery logs for this variation with the message ID
                sent = await bot.send_video(
                    chat_id=chat_id,
                    video=open(ready_path, "rb"),
                    caption=card_text,
                    parse_mode=ParseMode.MARKDOWN,
                    reply_markup=InlineKeyboardMarkup([[
                        InlineKeyboardButton(
                            f"✅ SELECT Variation {label}",
                            callback_data=f"select_variation:{sc.id}:{var.id}",
                        ),
                        InlineKeyboardButton(
                            "❌ Skip",
                            callback_data=f"skip:{sc.id}:{var.id}",
                        ),
                    ]]),
                    supports_streaming=True,
                )
                # Update delivery logs with this telegram message ID
                for dl, dl_var, _ in delivery_logs:
                    if dl_var.id == var.id:
                        dl.telegram_message_id = sent.message_id
                        self.db.save_delivery(dl)
            else:
                # Video file missing — send text card only
                await bot.send_message(
                    chat_id=chat_id,
                    text=f"⚠️ {card_text}\n\n(Video file not found: {ready_path})",
                    parse_mode=ParseMode.MARKDOWN,
                )

    # -----------------------------------------------------------------------
    # Callback Handler — Variation Selection
    # -----------------------------------------------------------------------

    async def handle_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        query = update.callback_query
        await query.answer()

        data = query.data
        if data.startswith("select_variation:"):
            _, scraped_id, variation_id = data.split(":", 2)
            await self._handle_approval(query, scraped_id, variation_id, approved=True)

        elif data.startswith("skip:"):
            _, scraped_id, variation_id = data.split(":", 2)
            await self._handle_approval(query, scraped_id, variation_id, approved=False)

    async def _handle_approval(self, query, scraped_id: str, variation_id: str, approved: bool):
        """Handle variation approval or skip."""
        if approved:
            success = self.db.approve_variation(
                message_id=query.message.message_id,
                variation_id=variation_id,
            )
            if success:
                var = self.db.get_variation(variation_id)
                label = var.variation_label if var else "?"

                # Find the ready file path
                sc = self.db.get_scraped_content(scraped_id)
                ready_path = (
                    self.config.videos_dir / "ready" / scraped_id /
                    f"ready_{label}.mp4"
                ) if var else None

                await query.edit_message_caption(
                    caption=(
                        f"✅ *Variation {label} APPROVED*\n\n"
                        f"📱 Ready for posting on Phone "
                        f"{self.db.get_approved_pending_post()[0].phone_number if self.db.get_approved_pending_post() else '?'}\n\n"
                        f"Download path:\n`{ready_path}`"
                    ),
                    parse_mode=ParseMode.MARKDOWN,
                )
            else:
                await query.edit_message_caption(caption="⚠️ Could not approve — already processed?")
        else:
            await query.edit_message_caption(
                caption=f"❌ *Variation skipped*",
                parse_mode=ParseMode.MARKDOWN,
            )

    # -----------------------------------------------------------------------
    # Watchlist Commands
    # -----------------------------------------------------------------------

    async def cmd_watch(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """
        /watch @handle [platform]
        Add a creator to the auto-scan watchlist.
        Platform defaults to tiktok. Use 'ig' or 'instagram' for Instagram.
        Example: /watch @alexhormozi
        Example: /watch @garyvee ig
        """
        args = context.args or []
        if not args:
            await update.message.reply_text(
                "Usage: `/watch @handle [platform]`\n"
                "Platform: tiktok (default) or ig/instagram\n\n"
                "Example: `/watch @alexhormozi`\n"
                "Example: `/watch @garyvee ig`\n\n"
                "I'll automatically find viral videos from this creator every 2h.",
                parse_mode=ParseMode.MARKDOWN,
            )
            return

        handle = args[0].lstrip("@")
        platform_arg = args[1].lower() if len(args) > 1 else "tiktok"
        platform = "instagram" if platform_arg in ("ig", "instagram") else "tiktok"

        # Infer niche + phone from which group this command came from
        group_id = str(update.effective_chat.id)
        nc = self.db.get_niche_by_telegram_group(group_id)
        niche = nc.niche.value if nc and hasattr(nc.niche, 'value') else (nc.niche if nc else "ecom")
        phone = nc.phone_number if nc else 1

        self.db.add_watchlist_creator(
            handle=handle,
            platform=platform,
            niche=niche,
            phone_number=phone,
            added_via="telegram",
        )
        await update.message.reply_text(
            f"👁 *Watching* @{handle} on {platform.title()}\n\n"
            f"Niche: {niche} • Phone {phone}\n"
            f"🔄 Will auto-scan every 2h for viral content.",
            parse_mode=ParseMode.MARKDOWN,
        )

    async def cmd_unwatch(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Remove a creator from the watchlist. Usage: /unwatch @handle [platform]"""
        args = context.args or []
        if not args:
            await update.message.reply_text("Usage: `/unwatch @handle [platform]`", parse_mode=ParseMode.MARKDOWN)
            return

        handle = args[0].lstrip("@")
        platform_arg = args[1].lower() if len(args) > 1 else "tiktok"
        platform = "instagram" if platform_arg in ("ig", "instagram") else "tiktok"

        removed = self.db.remove_watchlist_creator(handle, platform)
        if removed:
            await update.message.reply_text(
                f"✅ Removed @{handle} ({platform}) from watchlist",
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            await update.message.reply_text(
                f"⚠️ @{handle} ({platform}) not found in watchlist",
                parse_mode=ParseMode.MARKDOWN,
            )

    async def cmd_watchlist(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Show all tracked creators for this group's phone."""
        group_id = str(update.effective_chat.id)
        nc = self.db.get_niche_by_telegram_group(group_id)
        phone = nc.phone_number if nc else None

        creators = self.db.get_watchlist(phone_number=phone)
        if not creators:
            await update.message.reply_text(
                "📋 *Watchlist is empty*\n\n"
                "Add creators with: `/watch @handle`",
                parse_mode=ParseMode.MARKDOWN,
            )
            return

        niche_emoji = {"ecom": "🛒", "ai_tech": "🤖", "business": "💼", "lifestyle": "🌟"}
        lines = [f"👁 *Watchlist — {len(creators)} creators*\n"]
        for c in creators[:25]:
            emoji = niche_emoji.get(c.get("niche", ""), "📱")
            hits = c.get("viral_hit_count", 0)
            last = c.get("last_scanned_at", "never")[:10] if c.get("last_scanned_at") else "never"
            lines.append(
                f"{emoji} @{c['handle']} ({c.get('platform', 'tiktok')}) "
                f"— {hits} viral hits • last: {last}"
            )
        if len(creators) > 25:
            lines.append(f"\n_...and {len(creators) - 25} more_")
        await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)

    async def cmd_daily(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Generate or show today's posting plan."""
        try:
            from octragon.db_supabase import OctragonSupabaseDB
            from octragon.posting.daily_engine import DailyEngine

            if isinstance(self.db, OctragonSupabaseDB):
                engine = DailyEngine(self.db, self.config)

                # Generate plan if it doesn't exist
                result = engine.generate_daily_plan()

                # Format and send brief
                brief = engine.format_telegram_daily_brief()
                await update.message.reply_text(brief, parse_mode=ParseMode.MARKDOWN)
            else:
                await update.message.reply_text("⚠️ Requires Supabase backend.")
        except Exception as e:
            logger.error(f"[Bot] /daily failed: {e}")
            await update.message.reply_text(f"❌ Error: {e}")

    async def cmd_radar(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/radar [start|pause|status] Controls the auto-radar background sweep."""
        args = context.args or []
        action = args[0].lower() if args else "status"

        if action in ("start", "resume", "on"):
            self.db.set_setting("radar_enabled", "true")
            await update.message.reply_text("📡 *Auto-Radar:* ACTIVE\n_Sweeping every 2 hours._", parse_mode=ParseMode.MARKDOWN)
        elif action in ("pause", "stop", "off"):
            self.db.set_setting("radar_enabled", "false")
            await update.message.reply_text("📡 *Auto-Radar:* PAUSED\n_Background sweeps stopped._", parse_mode=ParseMode.MARKDOWN)
        else:
            is_active = self.db.get_setting("radar_enabled", "false") == "true"
            state = "ACTIVE 🟢" if is_active else "PAUSED ⏸"
            await update.message.reply_text(
                f"📡 *Auto-Radar Status:* {state}\n\n"
                f"Commands:\n"
                f"`/radar start`\n"
                f"`/radar pause`",
                parse_mode=ParseMode.MARKDOWN
            )

    # -----------------------------------------------------------------------
    # Auto-Radar Scheduler — runs every 2h, sweeps watchlist + curated lists
    # -----------------------------------------------------------------------

    async def _radar_scan_loop(self):
        """
        Background task: every RADAR_INTERVAL_HOURS, scan all watchlist creators
        plus the curated NICHE_CREATORS list. For any viral candidate not already
        in the DB, trigger the full pipeline and send cards to the right group.
        """
        RADAR_INTERVAL_HOURS = 2
        logger.info(f"[Radar] Auto-scanner started — interval: every {RADAR_INTERVAL_HOURS}h")

        while True:
            if self.db.get_setting("radar_enabled", "false") != "true":
                await asyncio.sleep(60)
                continue

            try:
                await self._run_radar_sweep()
            except Exception as e:
                logger.exception(f"[Radar] Sweep error: {e}")
            await asyncio.sleep(RADAR_INTERVAL_HOURS * 3600)

    async def _run_radar_sweep(self):
        """Single radar sweep across all phones — finds viral videos and auto-processes them."""
        from ..scraper.radar import RadarScanner
        from ..scraper.discovery import NICHE_CREATORS
        from ..models import SourcePlatform

        logger.info("[Radar] 🔍 Starting sweep...")
        scanner = RadarScanner(self.config)

        for nc in self.config.niche_configs:
            niche_val = nc.niche.value if hasattr(nc.niche, 'value') else str(nc.niche)
            group_id = int(nc.telegram_group_id) if nc.telegram_group_id else None
            if not group_id:
                continue

            # Collect handles: DB watchlist + curated defaults
            db_creators = self.db.get_watchlist(phone_number=nc.phone_number)
            watchlist_handles = [(c["handle"], c["platform"]) for c in db_creators]

            niche_defaults = NICHE_CREATORS.get(nc.niche, {})
            default_tiktok = [(h.lstrip("@"), "tiktok") for h in niche_defaults.get("tiktok", [])]

            all_handles = list({(h, p) for h, p in (watchlist_handles + default_tiktok)})

            viral_found = 0
            for handle, platform in all_handles:
                platform_enum = SourcePlatform.TIKTOK if platform == "tiktok" else SourcePlatform.INSTAGRAM
                try:
                    candidates = await scanner.scan_creator(
                        handle=handle,
                        platform=platform_enum,
                        niche=nc.niche,
                        phone=nc.phone_number,
                        min_views=niche_defaults.get("min_views", 50_000) // 2,
                        min_likes=niche_defaults.get("min_likes", 2_000) // 2,
                    )
                    for candidate in candidates:
                        # Skip already processed URLs
                        if self.db.get_scraped_by_url(candidate.url):
                            continue

                        viral_found += 1
                        logger.info(f"[Radar] 🔥 Viral hit: {candidate.creator} — {candidate.view_count:,} views")

                        # Mark in watchlist as viral hit
                        self.db.update_watchlist_scanned(handle, platform, viral_hit=True)

                        # Auto-trigger full pipeline in the background
                        asyncio.create_task(
                            self._run_radar_pipeline(
                                url=candidate.url,
                                niche=nc,
                                chat_id=group_id,
                                candidate_info=f"{candidate.creator} • {candidate.view_count:,} views",
                            )
                        )
                except Exception as e:
                    logger.warning(f"[Radar] {handle}: {e}")
                    continue

                # Update last_scanned_at regardless
                self.db.update_watchlist_scanned(handle, platform, viral_hit=False)

            logger.info(f"[Radar] Phone {nc.phone_number} ({niche_val}): {viral_found} new viral videos queued")

        await scanner.close()
        logger.info("[Radar] ✅ Sweep complete")

    async def _run_radar_pipeline(
        self,
        url: str,
        niche,
        chat_id: int,
        candidate_info: str,
    ):
        """Auto-process a radar-found viral video: full pipeline then send cards."""
        from ..models import SourcePlatform
        from ..scraper.engine import detect_platform

        platform = detect_platform(url)
        if not platform:
            return

        bot = self.app.bot
        try:
            ack = await bot.send_message(
                chat_id=chat_id,
                text=(
                    f"🔍 *Radar found viral content!*\n"
                    f"{candidate_info}\n"
                    f"`{url[:60]}{'...' if len(url) > 60 else ''}`\n\n"
                    f"⏳ Auto-processing..."
                ),
                parse_mode=ParseMode.MARKDOWN,
            )
            sc = await self._run_pipeline(
                url=url,
                platform=platform,
                niche=niche,
                chat_id=chat_id,
                ack_message_id=ack.message_id,
            )

            # Deep CMO Analysis & DB Category Mapping
            if sc:
                from ..cmo.agent import CMOAgent
                cmo = CMOAgent(self.config, self.db)
                
                # Find matching account for this phone & platform
                accounts = self.db.get_accounts_for_phone(niche.phone_number)
                acct = next((a for a in accounts if a.platform.value == platform.value), None)
                acct_id = acct.id if acct else ""
                
                # CMO deep dive
                analysis = cmo.analyze_content(sc.id, account_id=acct_id)
                
                if acct:
                    # Synthesize DNA on new data
                    cmo.update_viral_dna(acct_id)
                
                await bot.send_message(
                    chat_id=chat_id,
                    text=(
                        f"🧠 *CMO Analysis* {analysis.verdict.value.upper()}\n"
                        f"Score: {analysis.cmo_score}/100 • Hook: {analysis.hook_type}\n\n"
                        f"**Why it worked:**\n_{analysis.why_worked}_\n\n"
                        f"**Target Account:** `@{acct.handle if acct else 'Unmapped'}`"
                    ),
                    parse_mode=ParseMode.MARKDOWN,
                )

        except Exception as e:
            logger.exception(f"[Radar Pipeline] Error for {url}: {e}")

    # -----------------------------------------------------------------------
    # Run
    # -----------------------------------------------------------------------

    def run(self):
        """Start the bot (blocking)."""
        logger.info("[Bot] 🚀 Octragon Bot starting...")
        for nc in self.config.niche_configs:
            logger.info(f"[Bot] Monitoring group {nc.telegram_group_id} → {nc.niche_name}")

        # Start the auto-radar scheduler as a background task
        async def _post_init(app):
            asyncio.create_task(self._radar_scan_loop())
            logger.info("[Bot] 🔍 Auto-radar scheduler started (every 2h)")

        self.app.post_init = _post_init
        self.app.run_polling(drop_pending_updates=True)
