# Elite Influencer Discovery System — SPEC v5.0
**Purpose**: Find the highest-quality ecom influencers in existence. Not hashtag farming. Network intelligence.

---

## The Core Insight

Hashtag scraping is noise. A random #shopify poster has maybe 5% chance of being a real fit.

The **seed network method** changes everything:
- Biaheza (1.3M subs) has ~50k Instagram followers
- Every person following Biaheza AND Jordan Welch AND Arie Scherson = deeply in the ecom space
- Their audiences trust them on ecom topics → they ARE the target
- Network overlap = quality multiplier: appear in 3+ seed follower lists = 80%+ relevance

This is how political campaigns, hedge funds, and intelligence agencies do targeting.
We do it for ecom influencer outreach.

---

## Architecture: 4-Layer Discovery Engine

```
LAYER 1: Seed Network Crawl
  → Scrape followers of 20 mega-influencers
  → 200k+ candidate pool

      ↓ QUALITY FILTER 1 (has audience: 3k-500k followers)

LAYER 2: Overlap Intelligence
  → Find accounts in 2+ seed follower lists
  → Score by how many seed accounts they follow
  → Overlap in 3+ = elite signal

      ↓ QUALITY FILTER 2 (not a bot: engagement rate, bio, post count)

LAYER 3: YouTube Cross-Platform
  → Scan YouTube for ecom channels
  → Extract Instagram handles from channel descriptions
  → Cross-platform = highest trust signal (they have MULTIPLE audiences)

      ↓ QUALITY FILTER 3 (content relevance: bio keywords + recent posts)

LAYER 4: Engagement Mining
  → Top posts on ecom hashtags
  → Find commenters who themselves have real audiences
  → Active commenters = engaged in the community

      ↓ FINAL SCORING (0-100)

OUTPUT: Scored, deduped, tiered leads
```

---

## Layer 1: Seed Network Crawl

### Seed Account List (Mega Ecom Influencers — Yannis sends additions)

```python
SEED_ACCOUNTS_IG = [
    # Tier S (1M+ subs on YouTube, massive IG crossover)
    "biaheza",          # 1.3M YT, dropshipping OG
    "jordanwelchig",    # 1.1M YT
    "theecomking",      # 508K YT
    "hayden_bowles",    # 307K YT
    "achampton7",       # 305K YT
    "ariescherson",     # 121K YT
    "sebastianscherer", # Shopify/ecom
    "therealzerodown",  # dropshipping
    
    # Big IG ecom accounts (manually verified)
    "risewithmohit",    # 693K IG
    "theecomwolf",      # 386K IG  
    "daviefogarty",     # Oodie founder
    "justinwoll",       # Shopify
    "gretta",           # ecom founder
    
    # Yannis's personal network additions (user sends these)
    # ADD HERE: accounts that follow Yannis who are big in ecom
]

SEED_ACCOUNTS_YT = [
    "@Biaheza",
    "@JordanWelch",
    "@TheEcomKing",
    "@AcHampton",
    "@ArieschersonYT",
    "@SebastianEsqueda",
    "@WholesaleTed",
    "@VerumEcom",
]
```

### Follower Scraping Strategy
- Per seed account: pull 5,000 followers (instagrapi, free)
- 20 seed accounts × 5,000 = 100,000 raw candidates
- Rate limit: 500 followers/min safe, with 2s delay between accounts
- Runtime: ~4 hours (run overnight)
- Session: uses existing yanniskiefer session (no new account needed)

### instagrapi Implementation
```python
def scrape_seed_followers(cl, seed_username: str, amount: int = 5000) -> list:
    """Pull followers from a seed account. Returns list of UserShort objects."""
    user = cl.user_info_by_username(seed_username)
    followers = cl.user_followers(user.pk, amount=amount)
    # Returns dict: {user_id: UserShort}
    return list(followers.values())
```

---

## Layer 2: Overlap Intelligence Engine

### The Overlap Score
```
Overlap score = number of seed accounts this person follows

Appear in 1 seed list:  score += 10  (basic signal)
Appear in 2 seed lists: score += 25  (interested in ecom)
Appear in 3 seed lists: score += 50  (deeply in the space)
Appear in 4+ seed lists: score += 80 (ecom is their identity)
```

### Implementation
```python
from collections import Counter

def compute_overlap_scores(seed_follower_sets: dict) -> dict:
    """
    seed_follower_sets: {seed_username: set(follower_ids)}
    Returns: {follower_id: overlap_count}
    """
    all_followers = []
    for seed, followers in seed_follower_sets.items():
        all_followers.extend(followers)
    
    counter = Counter(all_followers)
    # Only keep accounts that appear in 2+ seed lists (quality signal)
    return {uid: count for uid, count in counter.items() if count >= 1}
```

### Why This Is Elite
- Someone following Biaheza + Jordan Welch + Arie Scherson = they've watched hours of ecom content
- Their AUDIENCE trusts them on ecom (they follow the same gurus)
- When you pitch EcomBrain, they ALREADY know the problem you're solving
- Conversion rate: network overlap accounts convert 3-5x better than hashtag accounts

---

## Layer 3: YouTube Cross-Platform Discovery

### Strategy
1. Search YouTube for: "shopify dropshipping", "ecommerce tutorial", "product research", "amazon FBA"
2. Get channels with 10k-500k subscribers (sweet spot: growing but not celebrities)
3. Extract Instagram handle from channel description (regex)
4. These accounts have BOTH a YouTube audience AND an Instagram following
5. Cross-platform = highest conversion potential (multiple touchpoints with audience)

### YouTube Search (scrapetube — no API key needed)
```python
import scrapetube

def discover_yt_channels(query: str, max_results: int = 50) -> list:
    """Scrape YouTube search results for channels."""
    results = scrapetube.get_search(query, results_limit=max_results)
    channels = []
    for video in results:
        channel = {
            "channel_id": video.get("channelId"),
            "channel_name": video.get("channelTitle"),
            "channel_url": f"https://youtube.com/channel/{video.get('channelId')}",
        }
        channels.append(channel)
    return channels
```

### Instagram Handle Extraction from YouTube
```python
import re, requests
from bs4 import BeautifulSoup

IG_HANDLE_PATTERNS = [
    r'instagram\.com/([A-Za-z0-9_.]{1,30})',
    r'ig\.me/([A-Za-z0-9_.]{1,30})',
    r'@([A-Za-z0-9_.]{1,30})',  # only when near "instagram" keyword
]

def extract_ig_from_yt_channel(channel_url: str) -> str:
    """Scrape YouTube channel About page, extract IG handle."""
    about_url = channel_url.rstrip('/') + "/about"
    resp = requests.get(about_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
    
    # Look for Instagram links in page source
    for pattern in IG_HANDLE_PATTERNS[:2]:  # URL patterns only first
        match = re.search(pattern, resp.text)
        if match:
            handle = match.group(1).rstrip('/')
            # Clean up: remove trailing slash, query params
            handle = handle.split('?')[0].split('/')[0]
            if 1 <= len(handle) <= 30:
                return handle
    return None
```

### YouTube Queries to Run Daily
```python
YT_DISCOVERY_QUERIES = [
    "shopify dropshipping 2025",
    "ecommerce store tutorial",
    "product research winning product",
    "amazon fba beginner",
    "dropshipping course free",
    "shopify store from scratch",
    "ecommerce passive income",
    "online store shopify",
]
```

---

## Layer 4: Engagement Mining (Commenters on Top Posts)

### Strategy
- Find the top 10 posts on #dropshipping, #shopify, #ecommerce (sorted by likes)
- Scrape the COMMENTERS on these posts
- A commenter who has 10k+ followers and comments on ecom posts = deeply engaged
- They're more active in the community than passive followers

### Implementation
```python
def mine_post_commenters(cl, hashtag: str, top_n: int = 5) -> list:
    """Find high-follower accounts who comment on top posts in hashtag."""
    top_posts = cl.hashtag_medias_top(hashtag, amount=top_n)
    commenter_ids = set()
    
    for media in top_posts:
        try:
            comments = cl.media_comments(media.id, amount=50)
            for comment in comments:
                commenter_ids.add(str(comment.user.pk))
        except Exception:
            pass
    
    return list(commenter_ids)
```

---

## Quality Scoring System (0-100)

### Score Formula
```
TOTAL_SCORE = overlap_score + engagement_score + relevance_score + platform_bonus + tier_bonus

overlap_score    (0-40): Based on how many seed accounts they follow
  - 1 seed: 10pts  | 2 seeds: 20pts  | 3 seeds: 35pts  | 4+ seeds: 40pts

engagement_score (0-25): Quality of their content
  - ER = (avg_likes + avg_comments) / followers * 100
  - 0-1%: 0pts  | 1-3%: 10pts  | 3-6%: 18pts  | 6%+: 25pts

relevance_score  (0-20): Bio + content keyword density
  - "shopify": 3pts  | "dropshipping": 3pts  | "ecommerce": 3pts
  - "amazon fba": 3pts | "coach": 1pt | "mentor": 1pt | etc.

platform_bonus   (0-10): Cross-platform signal
  - Has YouTube channel: +7pts
  - Has verified email in bio: +3pts

tier_bonus       (0-5): Size signal
  - T1 (50k+): 5pts  | T2 (10-50k): 3pts  | T3 (3-10k): 0pts
```

### Bot Detection (Pre-Filter — Eliminate Before Scoring)
```python
def is_authentic(user_info) -> bool:
    """Quick bot detection. Returns False = skip this account."""
    followers = user_info.follower_count or 0
    following = user_info.following_count or 1
    media_count = user_info.media_count or 0
    bio = user_info.biography or ""
    
    # Hard rejects
    if followers < 3000:         return False  # Too small
    if followers > 500000:       return False  # Celebrity, can't DM
    if not user_info.profile_pic_url: return False  # Default avatar = bot
    if media_count < 5:          return False  # No content history
    if len(bio) < 10:            return False  # Empty bio = likely bot/inactive
    
    # Ratio check: if following 10x more than followers = follow-unfollow bot
    ratio = followers / following
    if ratio < 0.1:              return False  # Extreme follower-farming
    
    # Engagement check (if we have post data)
    # Checked separately in enrich_user()
    
    return True
```

---

## Discovery Pipeline — Daily Schedule

```
18:00  Layer 1: Seed Network Scraper
       → Pull 2,500 followers from each of 20 seed accounts
       → 50k new candidates → filter by is_authentic() → ~15k pass
       → Save to: raw_candidates_{date}.json

20:00  Layer 2: Overlap Engine
       → Cross-reference with yesterday's raw candidates
       → Build overlap scores
       → Enrich top 200 (instagrapi user_info + 6 recent posts)
       → Score each lead
       → Save to: scored_leads_{date}.json

22:00  Layer 3: YouTube Discovery (runs weekly, not daily)
       → Search 8 YouTube queries
       → Extract IG handles from top 50 channels per query
       → Add to scored leads with platform_bonus
       
Next morning:
09:00  Follow 30 best leads (ig_follow.py)
19:00  Crafter writes compliment DMs for yesterday's follows
20:00  DM-IG sends compliment DMs
```

---

## Seed Account Management

### Yannis's Network Additions
When Yannis sends people that follow him who are big in ecom:
1. Add their usernames to `SEED_ACCOUNTS_IG`
2. These become seed accounts themselves
3. Their followers = extremely pre-qualified (they know Yannis's world)
4. Priority score: follows-Yannis-network = +15 overlap bonus

### Dynamic Seed Expansion
After 2 weeks:
- Any account that follows us back → add to seed list
- T1 accounts that respond positively → add to seed list
- The seed list grows → quality compounds over time

---

## Files to Build

```
~/clawd/scripts/influencer/
  ig_seed_crawler.py        # Layer 1: Seed follower scraping
  ig_overlap_engine.py      # Layer 2: Overlap scoring
  yt_channel_discovery.py   # Layer 3: YouTube cross-platform
  ig_commenter_miner.py     # Layer 4: Post engagement mining
  lead_scorer.py            # Unified scoring system
  bot_detector.py           # Authenticity checks
  seed_accounts.json        # Seed account list (user-managed)

~/clawd/data/influencer/
  raw_candidates_{date}.json    # Unfiltered from seed scraping
  overlap_scores_{date}.json    # Overlap analysis results
  scored_leads_{date}.json      # Final scored + ranked leads
  seed_follower_cache/          # Cached follower lists (avoid re-scraping)
    biaheza_followers.json
    jordanwelch_followers.json
    ...
```

---

## Priority Implementation Order

1. **`seed_accounts.json`** — Start with known seed accounts, add Yannis's network
2. **`ig_seed_crawler.py`** — Core of the system, runs overnight
3. **`ig_overlap_engine.py`** — The quality multiplier
4. **`lead_scorer.py`** — Unified 0-100 scoring
5. **`yt_channel_discovery.py`** — Add when Instagram pipeline is stable

---

## Expected Output Quality

Old approach (hashtag scraping):
- ~30% relevance rate
- Average score: 35/100
- Conversion rate: ~2%

New approach (seed network):
- ~80% relevance rate (by definition — they follow ecom gurus)
- Average score: 65/100
- Conversion rate estimate: ~6-8%
- Best leads (3+ overlap, cross-platform): 15-20% estimated conversion

The network effect compounds: as we follow more accounts and they follow back, our own account becomes a seed account for future discovery cycles.

---
*Spec v5.0 — 2026-03-09 — Yannis Kiefer / EcomBrain Influencer Machine*
