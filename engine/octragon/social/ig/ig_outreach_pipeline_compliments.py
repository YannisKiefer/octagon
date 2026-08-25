"""
REPLACEMENT _build_compliment() for ig_outreach_pipeline.py
Hunter Dickinson principles applied:
  - No "been following for a bit" opener (automation tell)
  - Jump straight to the specific observation
  - Reference their ACTUAL content (post captions, bio claims, niche specifics)
  - Peer-level recognition, not fan praise
  - Short: 3-4 lines max
  - No "no ask — just wanted to say that" (formulaic tell)
  - Goal: make them feel genuinely seen by someone who actually looked
"""
import re


def _pick_best_post(recent_posts: list) -> dict:
    """Pick the post most useful for a specific compliment."""
    if not recent_posts:
        return {}
    # Prefer posts with real captions (>50 chars) and some engagement
    captioned = [p for p in recent_posts if len(p.get("caption", "")) > 50]
    if captioned:
        # Sort by likes + comments descending
        return sorted(captioned, key=lambda p: p.get("likes", 0) + p.get("comments", 0), reverse=True)[0]
    return recent_posts[0] if recent_posts else {}


def _extract_post_hook(caption: str, lead_type: str, bio: str) -> str:
    """Extract a specific, usable hook from a post caption."""
    if not caption or len(caption) < 30:
        return ""
    caption_lower = caption.lower()
    bio_lower = bio.lower() if bio else ""

    # Revenue / number reveals
    money = re.search(r"\$[\d,.]+[mk]?\s*(in|/|revenue|profit|sales|day|month|week|made|earned|generated)", caption, re.I)
    if money:
        amount = money.group(0).strip()
        return (
            f"that {amount} post -- "
            "most people in your space hide everything until they can make it look effortless. "
            "you show it while it's happening."
        )

    # Failure / mistake content (most engaging in ecom space)
    failure_signals = ["mistake", "wrong", "failed", "lost", "don't do", "avoid", "stop", "what i wish"]
    if any(kw in caption_lower for kw in failure_signals):
        return (
            "the 'what not to do' angle -- "
            "anyone can post the win. "
            "breaking down what actually went wrong takes a different level of honesty."
        )

    # Behind-the-scenes / process content
    process_signals = ["how i", "behind the scenes", "day in the life", "real numbers", "my process", "here's how"]
    if any(kw in caption_lower for kw in process_signals):
        return (
            "the process content -- "
            "not the result, the actual how. "
            "that's the stuff that builds real trust with an audience."
        )

    # Product research / winning product content
    if any(kw in caption_lower for kw in ["product research", "winning product", "found a product", "product criteria"]):
        return (
            "the product research breakdown -- "
            "specifically the criteria part, not just 'here's a trending product'. "
            "teaching people HOW to think about it, not what to copy."
        )

    # Coaching content: teaching-specific hooks
    if lead_type == "coach" and any(kw in caption_lower for kw in ["students", "client", "my course", "i teach"]):
        return (
            "the teaching style -- "
            "building frameworks instead of just sharing wins. "
            "the people who've actually done it can tell the difference."
        )

    return ""


def _build_compliment(research: dict, lead: dict) -> str:
    """
    Stage 0 DM -- hyper-specific, zero automation tells, zero pitch.
    Hunter Dickinson: peer recognition, not fan mail.
    """
    from ig_dm_sender import _extract_first_name, _detect_lead_type

    name = _extract_first_name(lead.get("username", ""))
    opener = f"yo {name}\n\n" if name != "there" else "yo\n\n"

    hook_type = research.get("hook_type", "instagram")
    bio_raw = lead.get("bio") or ""
    bio = bio_raw.lower()
    followers = lead.get("followers") or 0
    lead_type = _detect_lead_type(lead)
    recent_posts = lead.get("recent_posts") or []

    # ── TIER 1: Research found external content (YouTube/podcast/press) ──────
    if hook_type == "youtube_video" and research.get("best_hook"):
        title = research["best_hook"][:60]
        body = (
            f"found the video -- {title}.\n"
            "the way you explain the mechanics behind it, not just the result -- "
            "most people in your space reverse-engineer wins. "
            "you show the actual decision-making."
        )
        return f"{opener}{body}\n\nyannis"

    if hook_type in ("youtube_channel", "youtube") and research.get("best_hook"):
        body = (
            "found the youtube channel. "
            "the breakdown style -- not explaining what to do, "
            "explaining why the thing actually works. "
            "rare in this space."
        )
        return f"{opener}{body}\n\nyannis"

    if hook_type == "podcast" and research.get("best_hook"):
        body = (
            "caught the podcast. "
            "the take was different -- not the 'here's how i made it' story "
            "everyone else gives. "
            "you actually talked about what broke first."
        )
        return f"{opener}{body}\n\nyannis"

    if hook_type == "article" and research.get("best_hook"):
        body = (
            "read the piece. "
            "the specifics -- not the headline, the actual breakdown. "
            "that's the content that gets saved."
        )
        return f"{opener}{body}\n\nyannis"

    if hook_type == "revenue_mention" and research.get("revenue_mention"):
        rev = research["revenue_mention"]
        body = (
            f"the {rev} mention -- "
            "most people in your space either hide the numbers or post them "
            "only when they're clean. "
            "you put the real ones out."
        )
        return f"{opener}{body}\n\nyannis"

    # ── TIER 2: Use actual post caption ──────────────────────────────────────
    best_post = _pick_best_post(recent_posts)
    if best_post:
        post_hook = _extract_post_hook(best_post.get("caption", ""), lead_type, bio_raw)
        if post_hook:
            return f"{opener}{post_hook}\n\nyannis"

    # ── TIER 3: Bio-specific hooks (actual claims, not category labels) ───────
    money_match = re.search(
        r"\$[\d,.]+[mk]?|\d+[mk\+]+\s*(in sales|revenue|gmv|profit)",
        bio_raw, re.I
    )
    if money_match:
        amount = money_match.group(0).strip()
        body = (
            f"the {amount} in your bio -- "
            "most people lead with the follower count. "
            "you lead with what you actually built."
        )
        return f"{opener}{body}\n\nyannis"

    number_match = re.search(
        r"([\d,]+\+?)\s*(students|members|clients|people|stores)",
        bio_raw, re.I
    )
    if number_match:
        count = number_match.group(1)
        label = number_match.group(2)
        body = (
            f"{count} {label} -- "
            "you can tell by the content that they're actually working. "
            "not everyone teaches that way."
        )
        return f"{opener}{body}\n\nyannis"

    # ── TIER 4: Niche-specific bio signal hooks ───────────────────────────────
    if "winning product" in bio or "product research" in bio:
        body = (
            "the winning product content -- "
            "specifically the criteria behind why something actually converts, "
            "not just 'here's what's trending on TikTok'. "
            "that's the version most people skip."
        )

    elif "turning clicks" in bio or "click to buyer" in bio or "conversion" in bio:
        body = (
            "the conversion focus -- "
            "not traffic, not followers, the actual gap between interest and purchase. "
            "that's the problem most ecom content doesn't touch."
        )

    elif "amazon" in bio and ("fba" in bio or "seller" in bio):
        body = (
            "the FBA angle from someone who's actually selling -- "
            "not someone who read it in a course and repackaged it. "
            "the difference shows in every piece of content."
        )

    elif "shopify" in bio and ("coach" in bio or "mentor" in bio or "teach" in bio):
        body = (
            "teaching shopify from the operator side -- "
            "the messy parts, not just the setup tutorial. "
            "people who've actually run stores know what that difference feels like."
        )

    elif "dropship" in bio:
        body = (
            "the dropshipping content -- "
            "specifically the parts that show what running it actually looks like "
            "past month one. "
            "most people stop documenting there."
        )

    elif lead_type == "community":
        body = (
            "the community angle -- "
            "not just selling a course, actually building something people come back to. "
            "that's a different skill set entirely."
        )

    elif lead_type == "agency":
        body = (
            "working with real stores instead of selling the idea of working with stores. "
            "the results show in how you talk about it."
        )

    elif followers >= 50_000:
        body = (
            "the consistency -- "
            "posting through the quiet periods, not just when things are compounding. "
            "most accounts in your space disappear when it gets hard."
        )

    elif followers >= 10_000:
        body = (
            "documenting what running a real store looks like day to day -- "
            "not the launch day, not the income reveal. "
            "the actual operations. "
            "that's the content that builds real trust."
        )

    else:
        body = (
            "building something real instead of just talking about it. "
            "most people in this space spend years on the theory. "
            "you skipped that."
        )

    return f"{opener}{body}\n\nyannis"
