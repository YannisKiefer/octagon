"""
Free Instagram lead scraper -- uses instagrapi (zero cost, no Apify).
Uses your existing IG session to scrape hashtags directly.

Gets: username, followers, bio, recent posts (3), engagement rate, virality score.
Scores each lead: virality + engagement + relevance.
Default: T1+T2 only (50k-500k). T3 only if engagement > 5%.

Usage:
  python3 ig_scrape_free.py
  python3 ig_scrape_free.py --hashtags shopify amazonFBA
  python3 ig_scrape_free.py --limit 200
  python3 ig_scrape_free.py --all-tiers   # include T3 too
"""
import json, logging, random, sys, time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
CRM_DIR = Path.home() / "clawd" / "crm"
DATA_DIR = Path.home() / "clawd" / "data" / "influencer"
SESSION_FILE = CRM_DIR / "ig_session.json"

# Hashtags ordered: niche-specific first (higher relevance signal)
DEFAULT_HASHTAGS = [
    "ecommercecoach",
    "shopifycoach",
    "dropshippingcoach",
    "amazonFBAcoach",
    "ecommercetips",
    "shopify",
    "ecommerce",
    "amazonFBA",
    "dropshipping",
    "onlinebusiness",
    "passiveincome",
    "ecomlife",
    "shopifydropshipping",
    "ecompreneur",
]

# Follower range -- skip bots (too few) and celebrities (unreachable)
MIN_FOLLOWERS = 3_000
MAX_FOLLOWERS = 500_000

# Quality floor: skip accounts with 0 engagement (dead accounts)
MIN_ENGAGEMENT_RATE = 0.3   # 0.3% minimum -- filters completely dead accounts

# T3 only allowed if engagement > this threshold
T3_MIN_ENGAGEMENT = 3.0     # 3% engagement for T3 accounts to qualify

POSTS_PER_HASHTAG = 70

# Relevance keywords in bio -- higher score = more relevant
RELEVANCE_KEYWORDS = {
    # Strong signals (ecom operators / coaches)
    "shopify": 3, "dropshipping": 3, "ecommerce": 3, "amazon fba": 3,
    "fba": 2, "dropship": 2, "ecom": 2, "store owner": 2,
    "online store": 2, "product research": 2, "winning product": 2,
    # Medium signals
    "passive income": 1, "online business": 1, "digital marketing": 1,
    "affiliate": 1, "make money online": 1, "entrepreneur": 1,
    "coach": 1, "mentor": 1, "teach": 1,
}


def load_json(path, default):
    if Path(path).exists():
        with open(path) as f:
            return json.load(f)
    return default


def save_json(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def build_client(username, password):
    from instagrapi import Client
    cl = Client()
    cl.delay_range = [1, 3]
    if SESSION_FILE.exists():
        try:
            cl.load_settings(SESSION_FILE)
            cl.login(username, password)
            cl.get_timeline_feed()
            logger.info("Session loaded from cache")
            return cl
        except Exception as e:
            logger.warning(f"Session invalid: {e} -- re-logging in")
    cl.login(username, password)
    cl.dump_settings(SESSION_FILE)
    return cl


def scrape_hashtag(cl, hashtag, amount=POSTS_PER_HASHTAG):
    logger.info(f"Scraping #{hashtag}...")
    try:
        medias = cl.hashtag_medias_recent(hashtag, amount=amount)
        seen = {}
        for media in medias:
            uid = str(media.user.pk)
            if uid not in seen:
                seen[uid] = media.user.username
        logger.info(f"  #{hashtag}: {len(medias)} posts -> {len(seen)} unique users")
        return list(seen.items())
    except Exception as e:
        logger.error(f"Failed #{hashtag}: {e}")
        return []


def score_relevance(bio: str) -> int:
    """Bio keyword relevance score (0-20)."""
    bio_lower = bio.lower()
    score = 0
    for keyword, points in RELEVANCE_KEYWORDS.items():
        if keyword in bio_lower:
            score += points
    return min(score, 20)


def score_lead(lead: dict) -> float:
    """
    Composite lead score (0-100).
    Formula: virality(40) + engagement(30) + relevance(20) + tier_bonus(10)

    Virality  = (avg_likes + avg_comments) / followers * 100
                normalized to 0-40 (cap at 10% ER = full points)
    Engagement= same but weighted toward likes (most important signal)
    Relevance = bio keyword match (0-20)
    Tier bonus= T1=10, T2=5, T3=0
    """
    followers = lead.get("followers") or 1
    recent_posts = lead.get("recent_posts") or []
    bio = lead.get("bio") or ""

    # Compute engagement from posts
    if recent_posts:
        avg_likes = sum(p.get("likes", 0) for p in recent_posts) / len(recent_posts)
        avg_comments = sum(p.get("comments", 0) for p in recent_posts) / len(recent_posts)
        avg_views = sum(p.get("views", 0) for p in recent_posts if p.get("views")) or 0
        if avg_views:
            avg_views = avg_views / len(recent_posts)
    else:
        avg_likes = avg_comments = avg_views = 0

    # Engagement rate (likes + comments) / followers
    er = (avg_likes + avg_comments) / followers * 100
    er_score = min(er / 10 * 40, 40)  # 10% ER = 40 pts, scaled linearly

    # Virality: views / followers (video accounts only)
    virality = 0
    if avg_views > 0:
        vr = avg_views / followers * 100
        virality = min(vr / 200 * 10, 10)  # 200% view rate = 10 bonus pts

    # Relevance
    relevance_score = score_relevance(bio) * 1.0  # 0-20

    # Tier bonus
    tier_bonus = 10 if followers >= 50000 else 5 if followers >= 10000 else 0

    total = er_score + virality + relevance_score + tier_bonus
    return round(min(total, 100), 1)


def enrich_user(cl, user_id, username, all_tiers=False) -> Optional[dict]:
    """Fetch full profile + recent posts. Returns None if doesn't qualify."""
    try:
        info = cl.user_info(user_id)
        if info.is_private:
            return None

        followers = info.follower_count or 0
        if followers < MIN_FOLLOWERS or followers > MAX_FOLLOWERS:
            return None

        bio = info.biography or ""
        tier = "T1" if followers >= 50000 else "T2" if followers >= 10000 else "T3"

        # Get recent posts for quality signal
        recent_posts = []
        try:
            medias = cl.user_medias(user_id, amount=6)
            for m in medias:
                recent_posts.append({
                    "caption": m.caption_text or "",
                    "likes": m.like_count or 0,
                    "comments": m.comment_count or 0,
                    "views": getattr(m, "view_count", 0) or 0,
                    "timestamp": m.taken_at.isoformat() if m.taken_at else "",
                })
            time.sleep(random.uniform(0.5, 1.5))
        except Exception:
            pass

        # Compute engagement rate
        engagement_rate = None
        if recent_posts and followers > 0:
            avg_likes = sum(p["likes"] for p in recent_posts) / len(recent_posts)
            avg_comments = sum(p["comments"] for p in recent_posts) / len(recent_posts)
            engagement_rate = round((avg_likes + avg_comments) / followers * 100, 2)

        # Quality filter
        if engagement_rate is not None and engagement_rate < MIN_ENGAGEMENT_RATE:
            return None  # Dead account -- skip

        # T3 quality gate: only include if engagement > threshold
        if tier == "T3" and not all_tiers:
            if engagement_rate is None or engagement_rate < T3_MIN_ENGAGEMENT:
                return None

        lead = {
            "username": username,
            "platform": "instagram",
            "followers": followers,
            "bio": bio,
            "tier": tier,
            "engagement_rate": engagement_rate,
            "recent_posts": recent_posts[:3],  # 3 most recent for compliment context
            "full_name": info.full_name or "",
            "source": "instagrapi:hashtag",
        }
        lead["score"] = score_lead(lead)
        return lead

    except Exception as e:
        logger.warning(f"  Failed @{username}: {e}")
        return None


def run(hashtags=None, dry_run=False, limit=200, all_tiers=False):
    keys = load_json(CRM_DIR / "api_keys.json", {})
    ig_username = keys.get("ig_username", "")
    ig_password = keys.get("ig_password", "")
    if not ig_username or not ig_password:
        print("ERROR: ig_username / ig_password required in api_keys.json")
        return []

    hashtags = hashtags or DEFAULT_HASHTAGS
    tracker = load_json(CRM_DIR / "influence_tracker.json", {})
    blacklist = load_json(CRM_DIR / "blacklist.json", {})

    print(f"\n=== IG Scrape Free --- {TODAY} ===")
    print(f"Hashtags: {', '.join(hashtags)}")
    print(f"Tiers: {'T1+T2+T3' if all_tiers else 'T1+T2 (T3 only if >3% ER)'}")
    print(f"Mode: {'DRY RUN' if dry_run else 'LIVE'}")

    if dry_run:
        print("Dry run -- would scrape these hashtags via instagrapi (free, zero API cost).")
        return []

    cl = build_client(ig_username, ig_password)

    # Collect candidates from hashtags
    all_candidates = {}
    for tag in hashtags:
        pairs = scrape_hashtag(cl, tag)
        for uid, uname in pairs:
            all_candidates[uid] = uname
        time.sleep(random.uniform(2, 4))
        if len(all_candidates) >= limit * 4:
            break

    print(f"\nCandidates: {len(all_candidates)}")
    print(f"Already tracked: {len(tracker)} | Blacklisted: {len(blacklist)}")

    to_enrich = [
        (uid, uname) for uid, uname in all_candidates.items()
        if uname not in tracker and uname not in blacklist
    ]
    random.shuffle(to_enrich)
    print(f"New candidates: {len(to_enrich)} (enriching max {limit})\n")

    leads = []
    skipped = 0
    for i, (uid, uname) in enumerate(to_enrich):
        if len(leads) >= limit:
            break
        print(f"[{i+1}] @{uname}...", end=" ", flush=True)
        lead = enrich_user(cl, uid, uname, all_tiers=all_tiers)
        if lead:
            print(f"{lead['followers']:,} [{lead['tier']}] score={lead['score']} ER={lead['engagement_rate']}%")
            leads.append(lead)
        else:
            print("skip")
            skipped += 1
        if (i + 1) % 20 == 0:
            p = random.uniform(8, 15)
            logger.info(f"Pause {p:.0f}s...")
            time.sleep(p)

    # Sort by score descending
    leads.sort(key=lambda l: l.get("score", 0), reverse=True)

    out_path = DATA_DIR / f"scraped_leads_{TODAY}.json"
    save_json(out_path, leads)

    t1 = sum(1 for l in leads if l["tier"] == "T1")
    t2 = sum(1 for l in leads if l["tier"] == "T2")
    t3 = sum(1 for l in leads if l["tier"] == "T3")
    avg_score = round(sum(l.get("score", 0) for l in leads) / len(leads), 1) if leads else 0

    print(f"\n=== Done ===")
    print(f"Leads: {len(leads)} | T1:{t1} T2:{t2} T3:{t3} | Avg score:{avg_score}/100")
    print(f"Saved: {out_path}")
    return leads


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    all_t = "--all-tiers" in sys.argv
    limit_val = 200
    tags = None
    for i, arg in enumerate(sys.argv):
        if arg == "--hashtags" and i + 1 < len(sys.argv):
            tags = sys.argv[i+1:]
        if arg == "--limit" and i + 1 < len(sys.argv):
            try:
                limit_val = int(sys.argv[i + 1])
            except ValueError:
                pass
    run(hashtags=tags, dry_run=dry, limit=limit_val, all_tiers=all_t)
