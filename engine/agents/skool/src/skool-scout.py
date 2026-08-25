#!/usr/bin/env python3
"""
skool-scout.py — Daily scraper for free ecom/dropshipping/shopify Skool communities.

Finds communities, enriches owner profiles, generates personalized DMs,
and appends new leads to queue.json.

Usage:
  python3 skool-scout.py                        # full run, all keywords
  python3 skool-scout.py --test --keyword dropshipping --limit 5
"""

import argparse
import json
import logging
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from typing import Optional

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

# Telegram notifications
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "shared"))
try:
    import telegram_notify as tg
except ImportError:
    class _FakeTg:
        def send(self, msg):
            pass
    tg = _FakeTg()

# CRM — unified lead database (optional: degrades gracefully if not present)
_CRM_PATH = Path(__file__).parent.parent.parent / "crm"
if _CRM_PATH.exists():
    sys.path.insert(0, str(_CRM_PATH))
try:
    from crm import CRM, Platform, ActionType, EntityType
    _crm: Optional[CRM] = CRM()
except ImportError:
    _crm = None

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_default_base = os.environ.get(
    "SKOOL_BASE_DIR",
    str(Path(__file__).parent.parent),  # default: skool-whop-team/
)
BASE_DIR = Path(_default_base).expanduser()
DATA_DIR = BASE_DIR / "data"
SESSION_FILE = DATA_DIR / "skool_session.json"
QUEUE_FILE = DATA_DIR / "queue.json"
JOINED_FILE = DATA_DIR / "joined.json"
CONTACTED_FILE = DATA_DIR / "contacted.txt"

SKOOL_BASE = "https://www.skool.com"
API_BASE = "https://api2.skool.com"

KEYWORDS = [
    # Core ecom
    "dropshipping",
    "ecommerce",
    "shopify",
    "ecom",
    "online store",
    "dropship",
    "branded ecom",
    "print on demand",
    "amazon fba",
    # Expanded discovery
    "ecom automation",
    "ecom growth",
    "niche ecom",
    "store optimization",
    "amazon sellers",
    "etsy sellers",
    "ebay sellers",
    "product research",
    "ecom coaching",
    "ecom mentorship",
    "wholesale business",
    "supplier sourcing",
    "marketplace selling",
    "ecom course",
    "shopify scaling",
    "shopify store",
    "ecommerce brand",
    "d2c brand",
    "reseller",
    "fulfillment",
]

RELEVANCE_KEYWORDS = [
    "dropshipping", "dropship", "ecommerce", "ecom", "shopify", "shop",
    "online store", "store", "amazon", "fba", "print on demand", "pod",
    "etsy", "ebay", "alibaba", "aliexpress", "branded", "product",
    "supplier", "fulfillment", "scaling", "revenue", "profit", "sales",
    "conversion", "ads", "marketing", "klaviyo", "meta", "facebook",
    "instagram", "tiktok", "wholesale", "retail", "inventory", "listing",
]

DACH_INDICATORS = [
    "germany", "deutschland", "berlin", "munich", "münchen", "hamburg",
    "frankfurt", "cologne", "köln", "düsseldorf", "austria", "österreich",
    "wien", "vienna", "graz", "switzerland", "schweiz", "zürich", "zurich",
    "bern", "basel",
]

GERMAN_STOP_WORDS = [
    " und ", " der ", " die ", " das ", " ist ", " für ", " mit ",
    " eine ", " ein ", " von ", " zu ", " an ", " auf ", " im ",
    " ich ", " wir ", " sie ", " es ", " habe ", " hat ",
    " wird ", " werden ", " kann ", " mehr ", " auch ",
]

BANNED_WORDS = [
    "excited", "leverage", "synergies", "game-changer",
    "platform", "solution", "would love to",
]

# Hard-negative keywords — any match returns -999 and skips the profile immediately
_HARD_NEGATIVES = frozenset({
    "crypto", "forex", "nft", "web3", "defi", "trading", "mlm",
    "pyramid", "scheme", "betting", "casino", "gambling", "adult",
    "affiliate marketing",
})

# Languages accepted for outreach
ALLOWED_LANGUAGES = {"EN"}

# Words that look like a first name extracted from a slug but are not people's names.
# Prevents openers like "ecom\n\n" or "easy\n\n" going out to real leads.
_NOT_A_NAME = frozenset({
    "ecom", "ecomm", "ecommerce", "shop", "shopify", "store", "online", "digital",
    "easy", "free", "learn", "grow", "scale", "build", "start", "launch",
    "amazon", "fba", "ebay", "etsy", "drop", "dropship", "brand", "elite",
    "pro", "plus", "super", "mega", "ultra", "max", "big", "top", "best",
    "the", "my", "your", "our", "new", "old", "real", "true", "pure",
    "info", "admin", "team", "group", "club", "academy", "school", "hub",
    "community", "network", "course", "program", "system", "method",
    "wifi", "wifibrands", "hello", "hey", "hi", "yo",
})

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers — file I/O
# ---------------------------------------------------------------------------

def load_json(path: Path, default=None):
    if default is None:
        default = []
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        log.warning("Could not load %s: %s", path, exc)
        return default


def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def load_contacted(path: Path) -> set:
    if not path.exists():
        return set()
    with open(path, "r", encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


# ---------------------------------------------------------------------------
# Helpers — price parsing
# ---------------------------------------------------------------------------

def is_free_group(item: dict) -> bool:
    """
    Determine if a group from __NEXT_DATA__ is free.
    Free groups: displayPrice is null, or JSON with amount == 0.
    """
    meta = item.get("group", {}).get("metadata", {})
    display_price = meta.get("displayPrice")
    if display_price is None:
        return True
    if isinstance(display_price, (int, float)):
        return display_price == 0
    if isinstance(display_price, str):
        try:
            price_data = json.loads(display_price)
            amount = price_data.get("amount", 0)
            return amount == 0
        except Exception:
            return False
    return False


# ---------------------------------------------------------------------------
# Helpers — text/language
# ---------------------------------------------------------------------------

def abbreviate_members(n: int) -> str:
    """1938 -> '1.9k', 747 -> '747', 15000 -> '15k'"""
    if n >= 1000:
        k = n / 1000
        if k == int(k):
            return f"{int(k)}k"
        return f"{k:.1f}k"
    return str(n)


def abbreviate_money(amount: float) -> str:
    """1678.5 -> '$1.7k', 500 -> '$500'"""
    if amount >= 1000:
        k = amount / 1000
        if k == int(k):
            return f"${int(k)}k"
        return f"${k:.1f}k"
    return f"${int(amount)}"


def compute_monthly(members: int) -> str:
    """Partner revenue: 5% conversion × $199 per user (30% of product price)."""
    raw = members * 0.05 * 199
    return abbreviate_money(raw)


def compute_relevance_score(name: str, description: str) -> int:
    text = (name + " " + description).lower()
    hits = sum(1 for kw in RELEVANCE_KEYWORDS if kw in text)
    return min(100, hits * 10)


def detect_language(name: str, description: str, location: str, bio: str) -> str:
    """Returns 'DE' only for DACH communities, 'EN' for everything else."""
    combined = f" {(name + ' ' + description + ' ' + location + ' ' + bio).lower()} "
    # Check for German word patterns in content
    german_hits = sum(1 for w in GERMAN_STOP_WORDS if w in combined)
    if german_hits >= 3:
        return "DE"
    # Check location for DACH
    loc_lower = location.lower()
    for indicator in DACH_INDICATORS:
        if indicator in loc_lower or indicator in combined:
            return "DE"
    return "EN"


def determine_tier(members: int) -> int:
    if members >= 3000:
        return 1
    if members >= 1000:
        return 2
    return 3


def extract_specific_observation(description: str, bio: str, location: str) -> str:
    """
    Extract a single specific observation from community description/bio/location.
    Returns a lowercase phrase for embedding in DM body.
    """
    desc = (description or "").strip()
    if desc:
        desc_clean = re.sub(r"<[^>]+>", "", desc)
        desc_clean = re.sub(r"\*+", "", desc_clean)
        desc_clean = desc_clean.replace("\n", " ").strip()
        sentences = re.split(r"[.!?]", desc_clean)
        for s in sentences:
            s = s.strip()
            # Strip dashes/em-dashes that would violate DM voice rules
            s = re.sub(r"\s*[-–—]+\s*", " ", s).strip()
            if len(s) > 15:
                if len(s) > 65:
                    s = s[:62].rsplit(" ", 1)[0] + "..."
                return s.lower()
    if location:
        return f"based in {location.lower()}"
    if bio:
        bio_clean = re.sub(r"<[^>]+>", "", (bio or "")).strip()
        if len(bio_clean) > 15:
            return bio_clean[:65].lower()
    return ""


def _extract_first_name_from_slug(username: str) -> Optional[str]:
    """
    Extract a human first name from a Skool username slug like "thomas-zipf-2066".

    Rules:
    - Strip trailing numeric suffix ("thomas-zipf-2066" → ["thomas", "zipf"])
    - Take the first segment
    - Reject if it's in _NOT_A_NAME (generic/company words)
    - Reject if it's a single character
    - Reject if it contains digits (e.g. "b2b-store")
    - Reject if it looks like a company acronym (all caps, 2-4 chars)

    Returns None if no clean first name can be extracted.
    """
    parts = username.lower().split("-")

    # Strip trailing numeric segments
    while parts and parts[-1].isdigit():
        parts = parts[:-1]

    if not parts:
        return None

    candidate = parts[0].strip()

    if not candidate:
        return None
    if len(candidate) < 2:
        return None
    if any(ch.isdigit() for ch in candidate):
        return None
    if candidate in _NOT_A_NAME:
        return None

    return candidate


def validate_dm(text: str) -> list:
    """Returns list of violations. Empty list = clean."""
    violations = []
    for word in BANNED_WORDS:
        if word.lower() in text.lower():
            violations.append(f"BANNED WORD: '{word}'")
    if " - " in text or " — " in text or "\u2013" in text or " -- " in text:
        violations.append("CONTAINS DASH/EM-DASH")
    word_count = len(text.split())
    if word_count > 130:
        violations.append(f"OVER 130 WORDS: {word_count}")
    if not text.strip().endswith("yannis"):
        violations.append("MISSING SIGN-OFF 'yannis'")
    # Check for emojis (basic range)
    import unicodedata
    for ch in text:
        if unicodedata.category(ch).startswith("So"):
            violations.append("CONTAINS EMOJI")
            break
    return violations


# ---------------------------------------------------------------------------
# DM Generation
# ---------------------------------------------------------------------------

def _is_human_name(name: Optional[str]) -> bool:
    """
    Returns True only if `name` looks like a real human first name.
    Rejects: single chars, digits, generic words, hyphenated compound words.
    """
    if not name:
        return False
    name = name.strip()
    if len(name) < 2:
        return False
    if any(ch.isdigit() for ch in name):
        return False
    # Normalise hyphens: "e-commerce" → "ecommerce" for blocklist check
    normalised = name.lower().replace("-", "").replace("_", "")
    if normalised in _NOT_A_NAME:
        return False
    # Reject multi-word: "bashar j" → take only first word later
    # (handled at call site by splitting on space first)
    return True


def _safe_opener(first_name: Optional[str], display: str) -> Optional[str]:
    """
    Returns a confirmed human first name, or None.
    NEVER falls back to community/display name — that produces garbage like 'yo underground'.
    """
    if first_name and " " in first_name:
        first_name = first_name.split()[0]

    if _is_human_name(first_name):
        return first_name.lower()

    return None


def generate_dm_en(
    first_name: Optional[str],
    display: str,
    members: int,
    tier: int,
    observation: str,
    monthly: str,
) -> str:
    opener = _safe_opener(first_name, display)
    mem_abbr = abbreviate_members(members)

    greeting = f"yo {opener}" if opener else "yo"

    dm = (
        f"{greeting}\n\n"
        f"been following your community for a bit. group is actually active "
        f"and i really like the vibe there. lots of value and you seem real.\n\n"
        f"i'm behind ecombrain. its an autonomous ai for ecommerce. plugs into "
        f"your entire store and just runs everything on its own.\n\n"
        f"we are opening up a few exclusive partner spots right now. "
        f"you seem cool and i think this could really work for your audience.\n\n"
        f"math is simple. 30% recurring revenue for every member you bring in. "
        f"5% of your {mem_abbr} members would look like {monthly}/mo.\n\n"
        f"if this sounds interesting just let me know and i will see if "
        f"we can open a spot for you.\n\n"
        f"yannis"
    )
    return dm.strip()


def generate_dm_de(
    first_name: Optional[str],
    display: str,
    members: int,
    tier: int,
    observation: str,
    monthly: str,
) -> str:
    opener = _safe_opener(first_name, display)
    mem_abbr = abbreviate_members(members)

    greeting = f"yo {opener}" if opener else "yo"

    dm = (
        f"{greeting}\n\n"
        f"verfolge deine community schon eine weile. die gruppe ist echt aktiv "
        f"und mir gefaellt der vibe. viel mehrwert und du wirkst authentisch.\n\n"
        f"ich stehe hinter ecombrain. eine autonome ki fuer ecommerce. "
        f"dockt an deinen ganzen store an und laeuft komplett von alleine.\n\n"
        f"wir oeffnen gerade ein paar exklusive partner plaetze. "
        f"du wirkst cool und ich denke das koennte echt gut zu deiner audience passen.\n\n"
        f"rechnung ist simpel. 30% recurring revenue fuer jedes mitglied das du bringst. "
        f"5% deiner {mem_abbr} mitglieder wuerde so aussehen: {monthly}/mo.\n\n"
        f"wenn das interessant klingt sag bescheid und ich schau ob "
        f"wir einen platz fuer dich aufmachen koennen.\n\n"
        f"yannis"
    )
    return dm.strip()


def generate_dm(lead: dict) -> str:
    first_name = lead.get("first_name")
    display = lead["display"]
    members = lead["members"]
    tier = lead["tier"]
    observation = lead.get("observation", "")
    monthly = compute_monthly(members)
    lang = lead.get("language", "EN")

    dm = (
        generate_dm_de(first_name, display, members, tier, observation, monthly)
        if lang == "DE"
        else generate_dm_en(first_name, display, members, tier, observation, monthly)
    )

    violations = validate_dm(dm)
    if violations:
        log.warning("DM for %s has violations: %s", display, violations)

    return dm


# ---------------------------------------------------------------------------
# WAF-aware fetch (runs inside Playwright browser context)
# ---------------------------------------------------------------------------

WAF_FETCH_JS = """async (url, method, body) => {
    const waf = (window.AwsWafIntegration && window.AwsWafIntegration.fetch)
        ? window.AwsWafIntegration.fetch.bind(window.AwsWafIntegration) : fetch;
    const opts = {
        method: method,
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        credentials: 'include'
    };
    if (method !== 'GET' && body !== null) {
        opts.body = JSON.stringify(body);
    }
    try {
        const resp = await waf(url, opts);
        const data = await resp.json();
        return { status: resp.status, data: data };
    } catch(e) {
        return { status: 0, data: e.toString() };
    }
}"""


def waf_fetch(page, url: str, method: str = "GET", body=None):
    body_js = json.dumps(body) if body is not None else "null"
    js = f"""(async () => {{
        const url = {json.dumps(url)};
        const method = {json.dumps(method)};
        const body = {body_js};
        const waf = (window.AwsWafIntegration && window.AwsWafIntegration.fetch)
            ? window.AwsWafIntegration.fetch.bind(window.AwsWafIntegration) : fetch;
        const opts = {{
            method: method,
            headers: {{'Content-Type': 'application/json', 'Accept': 'application/json'}},
            credentials: 'include'
        }};
        if (method !== 'GET' && body !== null) {{
            opts.body = JSON.stringify(body);
        }}
        try {{
            const resp = await waf(url, opts);
            const data = await resp.json();
            return {{ status: resp.status, data: data }};
        }} catch(e) {{
            return {{ status: 0, data: e.toString() }};
        }}
    }})()"""
    return page.evaluate(js)


# ---------------------------------------------------------------------------
# Session loading
# ---------------------------------------------------------------------------

def load_session_cookies(session_file: Path) -> list:
    data = load_json(session_file, default={})
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("cookies", [])
    return []


# ---------------------------------------------------------------------------
# Scraping — marketplace pages
# ---------------------------------------------------------------------------

def extract_groups_from_next_data(page) -> list:
    """Extract groups array from __NEXT_DATA__ embedded in page HTML."""
    try:
        next_data_raw = page.evaluate("""() => {
            const el = document.getElementById('__NEXT_DATA__');
            return el ? el.textContent : null;
        }""")
        if not next_data_raw:
            return []
        next_data = json.loads(next_data_raw)
        groups = (
            next_data.get("props", {})
            .get("pageProps", {})
            .get("groups", [])
        )
        return groups if isinstance(groups, list) else []
    except Exception as exc:
        log.debug("__NEXT_DATA__ extraction failed: %s", exc)
        return []


def scrape_keyword(page, keyword: str, max_pages: int = 5) -> list:
    """Scrape all pages for a given keyword. Returns list of raw group items."""
    all_items = []
    encoded_kw = keyword.replace(" ", "%20")

    for page_num in range(1, max_pages + 1):
        if page_num == 1:
            url = f"{SKOOL_BASE}/?q={encoded_kw}&price=free"
        else:
            url = f"{SKOOL_BASE}/?q={encoded_kw}&price=free&page={page_num}"

        log.info("Scraping: %s", url)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2500)
        except PlaywrightTimeoutError:
            log.warning("Timeout on %s", url)

        items = extract_groups_from_next_data(page)
        if not items:
            log.debug("No groups on page %d for '%s'", page_num, keyword)
            break

        all_items.extend(items)
        log.info("  Found %d groups on page %d", len(items), page_num)

        # Fewer than 20 results = last page
        if len(items) < 20:
            break

        time.sleep(1.5)

    return all_items


def scrape_discover_pages(page) -> list:
    """Scrape discover/category pages for additional coverage."""
    all_items = []
    discover_urls = [
        f"{SKOOL_BASE}/discover?category=business&price=free",
        f"{SKOOL_BASE}/discover?category=entrepreneurship&price=free",
        f"{SKOOL_BASE}/discover?category=marketing&price=free",
        f"{SKOOL_BASE}/discover?category=sales&price=free",
        f"{SKOOL_BASE}/discover?category=finance&price=free",
        f"{SKOOL_BASE}/discover?category=tech&price=free",
        f"{SKOOL_BASE}/discover?category=side-hustle&price=free",
        f"{SKOOL_BASE}/discover?category=startups&price=free",
    ]
    for url in discover_urls:
        log.info("Scraping discover: %s", url)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2500)
        except PlaywrightTimeoutError:
            log.warning("Timeout on discover page %s", url)
            continue
        items = extract_groups_from_next_data(page)
        all_items.extend(items)
        time.sleep(1.5)
    return all_items


# ---------------------------------------------------------------------------
# Normalisation — raw group item -> candidate dict
# ---------------------------------------------------------------------------

def normalise_item(item: dict) -> Optional[dict]:
    """
    Convert a __NEXT_DATA__ group item (shape: {group: {...}, rank: ..., tags: ...})
    into a normalised candidate dict. Returns None if should skip.
    """
    group = item.get("group", {})
    if not group:
        return None

    meta = group.get("metadata", {})
    if not meta:
        return None

    group_id = group.get("id", "")
    slug = group.get("name", "").lower().strip()
    display = meta.get("display_name") or meta.get("displayName") or slug
    description = meta.get("description") or ""
    members = meta.get("total_members") or meta.get("totalMembers") or meta.get("memberCount") or 0

    # Owner from metadata.owner object or metadata.created_by
    owner_obj = meta.get("owner")
    owner_id = None
    owner_username = None
    if isinstance(owner_obj, dict):
        owner_id = owner_obj.get("id")
        owner_username = owner_obj.get("name")
    if not owner_id:
        owner_id = meta.get("created_by")

    if not slug:
        return None

    # Price check — skip paid groups
    if not is_free_group(item):
        return None

    return {
        "slug": slug,
        "group_id": group_id,
        "owner_id": owner_id,
        "owner_username": owner_username,
        "display": display,
        "members": int(members) if members else 0,
        "description": description,
    }


# ---------------------------------------------------------------------------
# Enrichment via API
# ---------------------------------------------------------------------------

def enrich_group_api(page, slug: str) -> Optional[dict]:
    """Fetch full group data from API to get owner info and richer description."""
    url = f"{API_BASE}/groups/{slug}"
    result = waf_fetch(page, url)
    if result.get("status") != 200:
        log.debug("Group API %s returned %d", slug, result.get("status"))
        return None
    data = result.get("data")
    if not isinstance(data, dict):
        return None
    return data


def enrich_owner_api(page, owner_id: str) -> Optional[dict]:
    """Fetch owner profile from API."""
    url = f"{API_BASE}/users/{owner_id}"
    result = waf_fetch(page, url)
    if result.get("status") != 200:
        log.debug("User API %s returned %d", owner_id, result.get("status"))
        return None
    data = result.get("data")
    if not isinstance(data, dict):
        return None
    return data


def _parse_owner_object(owner_raw) -> dict:
    """
    The Skool API returns metadata.owner as a JSON *string* (not a nested object).
    Parse it safely and return a dict.
    """
    if owner_raw is None:
        return {}
    if isinstance(owner_raw, dict):
        return owner_raw
    if isinstance(owner_raw, str):
        try:
            parsed = json.loads(owner_raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def extract_from_group_api(api_data: dict) -> dict:
    """
    Extract useful fields from the full group API response.
    metadata.owner is a JSON string — parse it to get first_name etc.
    """
    meta = api_data.get("metadata", {})
    if not isinstance(meta, dict):
        meta = {}

    owner_obj = _parse_owner_object(meta.get("owner"))
    owner_id = owner_obj.get("id") or meta.get("created_by")
    owner_username = owner_obj.get("name")
    description = meta.get("description") or ""
    members = meta.get("total_members") or 0

    # Owner metadata may contain bio and location
    owner_meta = owner_obj.get("metadata", {}) or {}
    if isinstance(owner_meta, str):
        try:
            owner_meta = json.loads(owner_meta)
        except Exception:
            owner_meta = {}

    # first_name/last_name at owner top level
    first_name = owner_obj.get("first_name") or None
    owner_location = owner_meta.get("location") or ""
    owner_bio = owner_meta.get("bio") or ""

    return {
        "owner_id": owner_id,
        "owner_username": owner_username,
        "first_name": first_name.lower() if first_name else None,
        "owner_location": owner_location,
        "owner_bio": owner_bio,
        "description": description,
        "members": int(members) if members else 0,
    }


def extract_from_user_api(api_data: dict) -> dict:
    """Extract useful fields from user API response."""
    meta = api_data.get("metadata", {}) or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
    # User API returns first_name/last_name at top level
    first_name = api_data.get("first_name") or None
    username = api_data.get("name") or None  # e.g. "thomas-zipf-2066"
    location = meta.get("location") or ""
    bio = meta.get("bio") or ""
    return {
        "first_name": first_name.lower() if first_name else None,
        "owner_username": username,
        "location": location,
        "bio": bio,
    }


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_scout(test_mode: bool = False, test_keyword: str = None, limit: int = None):
    # Load exclusion lists
    joined_data = load_json(JOINED_FILE, default=[])
    joined_slugs = {entry["slug"] for entry in joined_data if isinstance(entry, dict)}
    contacted = load_contacted(CONTACTED_FILE)
    existing_queue = load_json(QUEUE_FILE, default=[])
    queued_slugs = {entry["slug"] for entry in existing_queue if isinstance(entry, dict)}
    skip_slugs = joined_slugs | contacted | queued_slugs

    if _crm:
        log.info("CRM connected: %s", _crm.db_path)

    keywords = [test_keyword] if (test_mode and test_keyword) else KEYWORDS

    new_leads = []
    seen_slugs: set = set()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )

        cookies = load_session_cookies(SESSION_FILE)
        if cookies:
            try:
                context.add_cookies(cookies)
                log.info("Loaded %d session cookies", len(cookies))
            except Exception as exc:
                log.warning("Cookie load error: %s", exc)
        else:
            log.warning("No session cookies — running unauthenticated (enrichment will be limited)")

        page = context.new_page()

        # Warm up — navigate to skool.com first to establish WAF integration
        try:
            page.goto(f"{SKOOL_BASE}/", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(2000)
        except Exception as exc:
            log.warning("Warm-up failed: %s", exc)

        # --- Scrape raw items ---
        raw_items_all = []
        for keyword in keywords:
            raw_items_all.extend(
                scrape_keyword(page, keyword, max_pages=2 if test_mode else 10)
            )

        if not test_mode:
            raw_items_all.extend(scrape_discover_pages(page))

        log.info("Total raw items collected: %d", len(raw_items_all))

        # --- Normalise & deduplicate ---
        candidates: dict[str, dict] = {}
        for item in raw_items_all:
            c = normalise_item(item)
            if c and c["slug"] not in candidates:
                candidates[c["slug"]] = c

        log.info("Unique free groups after normalise: %d", len(candidates))

        # --- Filter & enrich ---
        processed = 0
        for slug, c in candidates.items():
            if limit and processed >= limit:
                break

            if slug in skip_slugs or slug in seen_slugs:
                continue

            # Cross-platform CRM gate — skip if contacted on ANY platform
            if _crm:
                check = _crm.check_contact_allowed(Platform.SKOOL, slug)
                if not check:
                    log.info("CRM skip %s: %s (locked by %s)", slug, check.reason, check.locked_by)
                    continue

            members = c["members"]
            description = c["description"]
            display = c["display"]

            # Member count check — only hard filter
            if members < 20:
                log.debug("Skip %s: members %d < 20", slug, members)
                continue

            # Relevance check — keep anything ecom/dropship/shopify related.
            # A community passes if its slug OR display name contains an ecom
            # keyword (slug-match), OR if its description scores at least 10
            # (1 keyword hit anywhere in the text).
            SLUG_KEYWORDS = [
                "ecom", "dropship", "shopify", "shop", "store", "amazon",
                "fba", "print", "pod", "supplier", "wholesal", "branded",
                "klaviyo", "aliexpress", "alibaba", "etsy", "ebay",
                "retail", "revenue", "profit", "scaling", "ecommerce",
            ]
            slug_lower = slug.lower()
            display_lower = display.lower()
            slug_hit = any(kw in slug_lower or kw in display_lower for kw in SLUG_KEYWORDS)
            score = compute_relevance_score(display, description)
            if not slug_hit and score < 10:
                log.debug("Skip %s: no slug hit and score %d < 10", slug, score)
                continue

            log.info("Enriching: %s (%d members, score %d)", slug, members, score)

            # Enrich from group API (reliable owner data + richer description)
            # Group API returns owner as embedded JSON string including first_name
            owner_id = c.get("owner_id")
            owner_username = c.get("owner_username")
            first_name = None
            owner_location = ""
            owner_bio = ""

            group_api = enrich_group_api(page, slug)
            if group_api:
                extracted = extract_from_group_api(group_api)
                if extracted.get("owner_id"):
                    owner_id = extracted["owner_id"]
                if extracted.get("owner_username"):
                    owner_username = extracted["owner_username"]
                if len(extracted.get("description", "")) > len(description):
                    description = extracted["description"]
                if extracted.get("members", 0) > members:
                    members = extracted["members"]
                # Group API embeds owner's first_name, location, bio directly
                if extracted.get("first_name"):
                    first_name = extracted["first_name"]
                if extracted.get("owner_location"):
                    owner_location = extracted["owner_location"]
                if extracted.get("owner_bio"):
                    owner_bio = extracted["owner_bio"]

            # If we still don't have first_name, try user API as fallback
            if not first_name and owner_id:
                user_api = enrich_owner_api(page, str(owner_id))
                if user_api:
                    user_info = extract_from_user_api(user_api)
                    if user_info.get("first_name"):
                        first_name = user_info["first_name"]
                    if not owner_location and user_info.get("location"):
                        owner_location = user_info["location"]
                    if not owner_bio and user_info.get("bio"):
                        owner_bio = user_info["bio"]
                    if not owner_username and user_info.get("owner_username"):
                        owner_username = user_info["owner_username"]

            # Fallback first name from username slug if nothing else worked.
            # Strictly validated — must look like a real human first name.
            if not first_name and owner_username:
                first_name = _extract_first_name_from_slug(owner_username)

            # Final guard: ensure first_name is a genuine human name
            if first_name and " " in first_name:
                first_name = first_name.split()[0]  # "bashar j" → "bashar"
            if not _is_human_name(first_name):
                first_name = None

            # Language detection
            language = detect_language(display, description, owner_location, owner_bio)

            # Language gate — only outreach to ALLOWED_LANGUAGES
            if language not in ALLOWED_LANGUAGES:
                log.debug("Skip %s: language %s not in %s", slug, language, ALLOWED_LANGUAGES)
                seen_slugs.add(slug)
                continue

            # Tier and observation
            tier = determine_tier(members)
            observation = extract_specific_observation(description, owner_bio, owner_location)

            # Build lead
            lead = {
                "slug": slug,
                "group_id": c.get("group_id"),
                "owner_id": str(owner_id) if owner_id else None,
                "owner_username": owner_username or None,
                "first_name": first_name,
                "display": display,
                "members": members,
                "tier": tier,
                "language": language,
                "observation": observation,
                "score": score,
                "scraped_at": datetime.now(timezone.utc).isoformat(),
                "status": "queued",
            }

            lead["dm_text"] = generate_dm(lead)

            # Register in CRM as PROSPECT (no lock — just awareness)
            if _crm and not test_mode:
                _crm.add_lead(
                    platform=Platform.SKOOL,
                    handle=slug,
                    canonical_name=lead.get("first_name") or display,
                    url=f"https://www.skool.com/{slug}",
                    profile_data={
                        "display": display,
                        "members": members,
                        "owner_id": str(owner_id) if owner_id else None,
                        "owner_username": owner_username,
                    },
                )

            new_leads.append(lead)
            seen_slugs.add(slug)
            processed += 1

            # Throttle between API enrichment calls
            time.sleep(1.5)

        browser.close()

    # --- Output ---
    if test_mode:
        _print_test_report(test_keyword, new_leads)
        return

    if new_leads:
        existing_queue.extend(new_leads)
        save_json(QUEUE_FILE, existing_queue)
        log.info("Appended %d new leads to %s", len(new_leads), QUEUE_FILE)
    else:
        log.info("No new leads found this run")

    total_queued = len([
        e for e in load_json(QUEUE_FILE, default=[])
        if isinstance(e, dict) and e.get("status") == "queued"
    ])
    tg.send(
        "Skool scout complete. Found %d new leads. Queue now has %d communities."
        % (len(new_leads), total_queued)
    )


def _print_test_report(keyword: Optional[str], leads: list):
    print("\n" + "=" * 62)
    print(f"TEST MODE  keyword={keyword}  results={len(leads)}")
    print("=" * 62)

    quality_points = 0
    max_points = 0

    for i, lead in enumerate(leads, 1):
        violations = validate_dm(lead.get("dm_text", ""))
        wc = len(lead.get("dm_text", "").split())

        print(f"\n--- Lead {i}: {lead['display']} ---")
        print(f"  slug:        {lead['slug']}")
        print(f"  group_id:    {lead['group_id']}")
        print(f"  members:     {lead['members']}")
        print(f"  tier:        T{lead['tier']}")
        print(f"  score:       {lead['score']}")
        print(f"  language:    {lead['language']}")
        print(f"  owner_id:    {lead['owner_id']}")
        print(f"  owner_user:  {lead['owner_username']}")
        print(f"  first_name:  {lead['first_name']}")
        print(f"  location:    {lead.get('location', 'N/A')}")
        print(f"  observation: {lead.get('observation', '')}")
        print(f"  DM ({wc} words): {'VIOLATIONS: ' + str(violations) if violations else 'no violations'}")
        print(f"\n  {lead.get('dm_text', '')}\n")

        max_points += 10
        if lead["group_id"]:
            quality_points += 2
        if lead["owner_id"]:
            quality_points += 2
        if lead["first_name"]:
            quality_points += 2
        if not violations:
            quality_points += 2
        if lead.get("observation"):
            quality_points += 2

    overall = round(quality_points / max_points * 10) if max_points else 0
    print(f"\nQuality Score: {overall}/10")
    print("=" * 62 + "\n")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Skool community scout")
    parser.add_argument("--test", action="store_true", help="Test mode — no file writes")
    parser.add_argument("--keyword", type=str, help="Single keyword to test")
    parser.add_argument("--limit", type=int, default=None, help="Max results to enrich")
    args = parser.parse_args()

    if args.test and not args.keyword:
        parser.error("--test requires --keyword")

    run_scout(
        test_mode=args.test,
        test_keyword=args.keyword,
        limit=args.limit,
    )


if __name__ == "__main__":
    main()
