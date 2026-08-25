"""
Octragon Caption Engine

Generates viral social media captions for all 8 accounts across 4 phones
using Gemini with strict per-niche voice profiles.

Voice architecture:
  Phone 1 (E-commerce / DTC):     Punchy, conversion-driven, product-led
  Phone 2 (AI / Tech):            Authoritative, insight-dense, curiosity hooks
  Phone 3 (Business / Founder):   Raw, story-driven, aspirational yet honest
  Phone 4 (Lifestyle / Motivation): Emotional, empowering, identity-mirroring

Each niche has separate TikTok vs Instagram vs LinkedIn voice variants.
"""

import asyncio
import concurrent.futures
from dataclasses import dataclass
from enum import Enum
from typing import Optional

import google.generativeai as genai
from loguru import logger

from octragon.config import OctragonConfig
from octragon.models import NicheType, TargetPlatform


# ─── Platform tone modifiers ──────────────────────────────────────────────────

class Platform(str, Enum):
    TIKTOK = "tiktok"
    INSTAGRAM = "instagram"
    LINKEDIN = "linkedin"


PLATFORM_CONSTRAINTS: dict[Platform, dict] = {
    Platform.TIKTOK: {
        "max_chars": 2200,
        "hashtag_count": 5,
        "style": "ultra punchy, 1-3 sentences max, TikTok-native slang, no em dashes, reads aloud well",
        "hook_instruction": "First line is the HOOK — must stop the scroll in 0.5s",
    },
    Platform.INSTAGRAM: {
        "max_chars": 2200,
        "hashtag_count": 8,
        "style": "slightly longer, story arc possible, emoji punctuation allowed, Reels-oriented",
        "hook_instruction": "First line hooks, second expands briefly, end with CTA or question",
    },
    Platform.LINKEDIN: {
        "max_chars": 3000,
        "hashtag_count": 3,
        "style": "professional but personal, insight-first, paragraph breaks, no hollow corporate speak",
        "hook_instruction": "Open with a counterintuitive insight or contrarian take",
    },
}


# ─── Per-niche voice profiles ─────────────────────────────────────────────────

VOICE_PROFILES: dict[NicheType, dict] = {
    NicheType.ECOM: {
        "persona": "E-commerce founder who cracked the code",
        "voice": "Direct, conversion-obsessed, product evangelist. No fluff. Revenue-focused.",
        "forbidden": [
            "guru", "passive income", "hustle harder", "grind", "mindset",
            "life-changing", "viral product (without data)", "game changer"
        ],
        "power_words": ["profit margin", "sold out", "revenue", "conversion rate", "7-figure", "unit economics"],
        "tiktok_examples": [
            "This product made $120k in 48 hours. Here's the exact ad we ran 👇",
            "Nobody talks about this DTC metric. It'll save your store.",
            "I analyzed 50 viral product videos. Here's the hidden pattern.",
        ],
        "instagram_examples": [
            "The checkout page change that lifted our CVR by 34% 📊\n\nMost DTC brands obsess over traffic. The money's in the conversion.\n\nHere's exactly what we changed (and why):",
        ],
        "linkedin_examples": [
            "We killed our best ad after it scaled to $50k/day.\n\nHere's why that was the right call, and what we learned about sustainable DTC growth:",
        ],
        "hashtags": {
            "tiktok": ["ecommerce", "dtc", "shopify", "dropshipping", "productlaunch"],
            "instagram": ["ecommerce", "dtc", "shopify", "productmarketing", "conversionoptimization", "dropshipping", "brandbuilding", "entrepreneurship"],
            "linkedin": ["ecommerce", "dtc", "entrepreneurship"],
        }
    },

    NicheType.AI_TECH: {
        "persona": "AI researcher who actually ships",
        "voice": "Precise, evidence-based, mild superiority. Shows work. Dense with signal.",
        "forbidden": [
            "AGI is here", "AI will take your job", "mindblowing", "unbelievable",
            "revolutionary", "ChatGPT killer", "just dropped"
        ],
        "power_words": ["benchmarks", "latency", "token efficiency", "inference cost", "system prompt", "eval"],
        "tiktok_examples": [
            "GPT-4o vs Claude 3.5 on 200 coding tasks. The results surprised me.",
            "This system prompt cuts Claude's cost by 60%. Takes 2 minutes to implement.",
            "Why your AI agent keeps looping. And the fix.",
        ],
        "instagram_examples": [
            "I ran the same prompt through 6 LLMs for a month.\n\nThe winner wasn't who I expected 🧵\n\nThread: which model actually wins for each use case:",
        ],
        "linkedin_examples": [
            "The AI tool market is about to consolidate violently.\n\nI've been tracking 200+ AI startups for 18 months. Here's the pattern:\n\n3 categories will survive. The rest will be features in bigger products.",
        ],
        "hashtags": {
            "tiktok": ["aitools", "artificialintelligence", "machinelearning", "llm", "aiagents"],
            "instagram": ["aitools", "artificialintelligence", "llm", "techstartup", "machinelearning", "saas", "buildinpublic", "openai"],
            "linkedin": ["artificialintelligence", "aitools", "saas"],
        }
    },

    NicheType.BUSINESS: {
        "persona": "Founder who failed twice before getting it right",
        "voice": "Raw, brutally honest, story-first. Shares actual numbers. Zero toxic positivity.",
        "forbidden": [
            "10x your revenue", "crush it", "be your own boss", "freedom lifestyle",
            "quit your job", "passive income", "millionaire mindset"
        ],
        "power_words": ["burn rate", "runway", "PMF", "CAC", "retention", "churn", "cold call", "fund"],
        "tiktok_examples": [
            "I pitched 47 VCs. Got 46 rejections. Here's what the 47th asked that changed everything.",
            "We had 0 users at month 6. This is what we did at month 7.",
            "The founder lesson nobody puts in a LinkedIn post.",
        ],
        "instagram_examples": [
            "At $1M ARR we almost went bankrupt.\n\nChurn was 40%. Burn was 3x revenue.\n\nHere's the ugly truth of what had to happen to survive (and scale to $8M):",
        ],
        "linkedin_examples": [
            "I fired my highest performer. It was the best decision I ever made.\n\nThis isn't a story about toxic employees. It's about what 'performance' actually means at different stages of a company.",
        ],
        "hashtags": {
            "tiktok": ["startup", "entrepreneur", "founder", "venturecapital", "startuplife"],
            "instagram": ["startup", "entrepreneur", "founder", "venturecapital", "saas", "buildingabusiness", "startupstory", "founderlife"],
            "linkedin": ["startup", "entrepreneurship", "venturecapital"],
        }
    },

    NicheType.LIFESTYLE: {
        "persona": "Person who figured it out through discomfort, not shortcuts",
        "voice": "Deeply human, identity-affirming, contrast-driven. Makes people feel seen.",
        "forbidden": [
            "grind culture", "wake up at 4am", "no days off", "hustle",
            "toxic positivity", "good vibes only", "manifest", "universe"
        ],
        "power_words": ["identity", "systems", "compounding", "decision fatigue", "defaults", "clarity"],
        "tiktok_examples": [
            "I stopped trying to be disciplined. I became someone who didn't need to be.",
            "The habit advice is wrong. Here's what actually works after 3 years.",
            "Productivity isn't the goal. This is.",
        ],
        "instagram_examples": [
            "I don't track my habits anymore.\n\nFor 2 years I logged everything obsessively.\n\nThen I realized the point was never the tracking. Sharing what I changed and why 👇",
        ],
        "linkedin_examples": [
            "The 'morning routine' content is lying to you.\n\nNot because the habits are wrong. Because they're presenting optimization as the end goal.\n\nHere's what actually changed my output (it had nothing to do with waking up early):",
        ],
        "hashtags": {
            "tiktok": ["selfimprovement", "motivation", "productivity", "mindset", "habits"],
            "instagram": ["selfimprovement", "motivation", "productivity", "habits", "personaldevelopment", "mindset", "selfgrowth", "lifestyle"],
            "linkedin": ["personaldevelopment", "selfimprovement", "productivity"],
        }
    },
}


# ─── Caption generator ────────────────────────────────────────────────────────

@dataclass
class CaptionResult:
    caption: str
    hashtags: list[str]
    full_post: str  # caption + hashtag block
    hook: str       # first line only
    niche: NicheType
    platform: Platform
    char_count: int


class CaptionEngine:
    """
    Generates viral captions using Gemini with strict voice profile enforcement.
    """

    def __init__(self, config: OctragonConfig):
        self.config = config
        genai.configure(api_key=config.gemini_api_key)
        # gemini-3.1-pro-preview = TRUE frontier Gemini 3.1 — highest quality captions
        self.model = genai.GenerativeModel("gemini-3.1-pro-preview")
        self._timeout = 180  # seconds — 3.1 Pro needs time to think

    def _build_prompt(
        self,
        niche: NicheType,
        platform: Platform,
        video_context: str,
        original_caption: Optional[str] = None,
        repurpose_only: bool = False,
    ) -> str:
        voice = VOICE_PROFILES[niche]
        constraints = PLATFORM_CONSTRAINTS[platform]
        hashtags_for_niche = voice["hashtags"].get(platform.value, [])
        examples_key = f"{platform.value}_examples"
        examples = voice.get(examples_key, voice.get("tiktok_examples", []))

        repurpose_block = ""
        if repurpose_only and original_caption:
            repurpose_block = f"""
ORIGINAL CAPTION TO REPHRASE (keep the core idea, completely rewrite the words):
\"\"\"{original_caption}\"\"\"
"""

        return f"""You are writing a social media caption for a {niche.value.replace("_", " ").title()} account on {platform.value.title()}.

PERSONA: {voice["persona"]}
VOICE: {voice["voice"]}
PLATFORM STYLE: {constraints["style"]}
HOOK RULE: {constraints["hook_instruction"]}
MAX LENGTH: {constraints["max_chars"]} characters

STRICTLY FORBIDDEN WORDS/PHRASES:
{chr(10).join(f"- {w}" for w in voice["forbidden"])}

POWER WORDS TO POTENTIALLY USE:
{", ".join(voice["power_words"])}

REFERENCE EXAMPLES (match this energy exactly):
{chr(10).join(f"- {e}" for e in examples)}
{repurpose_block}
VIDEO CONTEXT (what the original video is about):
{video_context}

TASK:
Write 1 caption for {platform.value.title()}. 
- HOOK first (make it irresistible, native to {platform.value})
- Body (optional, platform-appropriate length)
- No hashtags in the caption body — you'll list them separately
- Do NOT include placeholder text like [your brand] or [CTA here]
- Write as if you are natively posting this content today

OUTPUT FORMAT (respond ONLY with this, no preamble):
CAPTION:
[your caption here]

HASHTAGS:
{" ".join(f"#{h}" for h in hashtags_for_niche[:constraints["hashtag_count"]])}"""

    async def generate(
        self,
        niche: NicheType,
        platform: Platform,
        video_context: str,
        original_caption: Optional[str] = None,
    ) -> Optional[CaptionResult]:
        """Generate a single viral caption."""
        prompt = self._build_prompt(niche, platform, video_context, original_caption)

        try:
            loop = asyncio.get_event_loop()
            # Use SDK-level timeout via request_options — asyncio.wait_for cannot
            # cancel blocking Google SDK HTTP calls cleanly
            response = await loop.run_in_executor(
                None,
                lambda: self.model.generate_content(
                    prompt,
                    request_options={"timeout": self._timeout},
                )
            )
            text = response.text.strip()
        except asyncio.TimeoutError:
            logger.error(f"[Caption] Gemini 3.1 timed out")
            return None
        except Exception as e:
            logger.error(f"[Caption] Gemini error: {e}")
            return None

        # Parse output
        caption = ""
        hashtags_raw = ""
        if "CAPTION:" in text and "HASHTAGS:" in text:
            parts = text.split("HASHTAGS:")
            caption = parts[0].replace("CAPTION:", "").strip()
            hashtags_raw = parts[1].strip()
        else:
            caption = text
            hashtags_raw = " ".join(
                f"#{h}" for h in VOICE_PROFILES[niche]["hashtags"].get(platform.value, [])
            )

        hashtags = [h.strip("#") for h in hashtags_raw.split() if h.startswith("#")]
        full_post = f"{caption}\n\n{hashtags_raw}".strip()
        hook = caption.split("\n")[0][:100] if caption else ""

        return CaptionResult(
            caption=caption,
            hashtags=hashtags,
            full_post=full_post,
            hook=hook,
            niche=niche,
            platform=platform,
            char_count=len(full_post),
        )

    async def generate_all_platforms(
        self,
        niche: NicheType,
        video_context: str,
        platforms: Optional[list[Platform]] = None,
        original_caption: Optional[str] = None,
    ) -> dict[Platform, Optional[CaptionResult]]:
        """Generate captions sequentially per platform (avoids Gemini 2.5 rate limits)."""
        targets = platforms or [Platform.TIKTOK, Platform.INSTAGRAM]
        results = {}
        for p in targets:
            results[p] = await self.generate(niche, p, video_context, original_caption)
            if len(targets) > 1:
                await asyncio.sleep(2)
        return results


# ─── Convenience: niche-to-platform caption getter ───────────────────────────

def get_default_platforms(niche: NicheType) -> list[Platform]:
    if niche == NicheType.BUSINESS:
        return [Platform.TIKTOK, Platform.INSTAGRAM, Platform.LINKEDIN]
    return [Platform.TIKTOK, Platform.INSTAGRAM]
