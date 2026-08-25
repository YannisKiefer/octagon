#!/usr/bin/env python3
"""
whop-scout.py — Daily scraper for free ecom/dropshipping/shopify Whop communities.

Discovers communities on whop.com/discover/, scores them against ecommerce ICP,
enriches owner data, generates personalized DMs, and appends new leads to
whop_queue.json.

Usage:
  python3 whop-scout.py                     # full run, all keywords
  python3 whop-scout.py --test              # test mode, limit 5 results
  python3 whop-scout.py --keyword shopify   # keyword filter
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

# CRM — unified lead database (optional: degrades gracefully if not present)
_CRM_PATH = Path(__file__).parent.parent.parent / "crm"
if _CRM_PATH.exists():
    sys.path.insert(0, str(_CRM_PATH))
try:
    from crm import CRM, Platform, ActionType, EntityType
    _crm: Optional[object] = CRM()
except ImportError:
    _crm = None

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_default_base = os.environ.get(
    "WHOP_BASE_DIR",
    str(Path(__file__).parent.parent),
)
BASE_DIR = Path(_default_base).expanduser()
DATA_DIR = BASE_DIR / "data"
QUEUE_FILE = DATA_DIR / "whop_queue.json"
CONTACTED_FILE = DATA_DIR / "whop_contacted.txt"

WHOP_BASE = "https://whop.com"

DISCOVER_TAGS = [
    "ecommerce",
    "dropshipping",
    "shopify",
    "amazon-fba",
    "online-business",
    "print-on-demand",
    "digital-marketing",
    "social-media-marketing",
    "affiliate-marketing",
    "online-courses",
    "saas",
    "entrepreneurship",
]

MIN_MEMBERS = 20
TEST_LIMIT = 5

# ---------------------------------------------------------------------------
# ICP scoring weights
# ---------------------------------------------------------------------------

SCORE_STRONG = [
    "ecommerce", "e-commerce", "dropship", "shopify", "online store",
]
SCORE_MEDIUM_A = [
    "amazon fba", "fba", "private label", "wholesale", "etsy",
]
SCORE_MEDIUM_B = [
    "brand", "print on demand", "pod", "product sourcing", "alibaba",
]
SCORE_WEAK = [
    "digital product", "online business", "passive income", "side hustle",
    "make money online",
]
SCORE_EXCLUDE = [
    "crypto", "forex", "nft", "trading", "stock market", "real estate",
]

# ---------------------------------------------------------------------------
# NOT_A_NAME blocklist (shared with skool-scout pattern)
# ---------------------------------------------------------------------------

_NOT_A_NAME = frozenset({
    "ecom", "ecommerce", "shop", "shopify", "store", "online", "digital",
    "easy", "free", "learn", "grow", "scale", "build", "start", "launch",
    "amazon", "fba", "ebay", "etsy", "drop", "dropship", "brand", "elite",
    "pro", "plus", "super", "mega", "ultra", "max", "big", "top", "best",
    "the", "my", "your", "our", "new", "old", "real", "true", "pure",
    "info", "admin", "team", "group", "club", "academy", "school", "hub",
    "community", "network", "course", "program", "system", "method",
    "wifi", "wifibrands", "hello", "hey", "hi", "yo", "whop", "discord",
    "telegram", "free", "join", "premium", "vip", "insider", "members",
    "master", "class", "lab", "blueprint", "playbook", "vault",
    "n/a", "na", "none", "unknown", "anon", "anonymous", "user",
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
# Helpers — ICP scoring
# ---------------------------------------------------------------------------

def compute_icp_score(display: str, description: str, tagline: str = "") -> int:
    """
    Score a community against ecommerce ICP.

    Returns:
      -999  if excluded (SCORE_EXCLUDE hit or paid)
      int   score >= 0 otherwise (include if >= 3)
    """
    text = (display + " " + description + " " + tagline).lower()

    # Hard excludes — bail immediately
    for term in SCORE_EXCLUDE:
        if term in text:
            return -999

    score = 0
    for term in SCORE_STRONG:
        if term in text:
            score += 3
    for term in SCORE_MEDIUM_A:
        if term in text:
            score += 2
    for term in SCORE_MEDIUM_B:
        if term in text:
            score += 2
    for term in SCORE_WEAK:
        if term in text:
            score += 1

    return score


def keyword_matches(display: str, description: str, tagline: str, keyword: str) -> bool:
    """Return True if a specific keyword filter matches the community text."""
    text = (display + " " + description + " " + tagline).lower()
    return keyword.lower() in text


# ---------------------------------------------------------------------------
# Helpers — name extraction
# ---------------------------------------------------------------------------

def _is_human_name(name):
    # type: (Optional[str]) -> bool
    """Returns True only if name looks like a real human first name."""
    if not name:
        return False
    name = name.strip()
    if len(name) < 2 or len(name) > 14:
        return False
    if any(ch.isdigit() for ch in name):
        return False
    normalised = name.lower().replace("-", "").replace("_", "")
    if normalised in _NOT_A_NAME:
        return False
    # Reject compound words that contain blocklist terms
    for term in ("ecom", "shop", "drop", "brand", "market", "teach", "academy"):
        if term in normalised and len(normalised) > len(term) + 2:
            return False
    return True


def _extract_first_name_from_handle(handle: str) -> Optional[str]:
    """
    Attempt to extract a human first name from a Whop username/handle.
    e.g. "alex-becker-99" -> "alex", "shopify-expert" -> None
    """
    parts = handle.lower().split("-")

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


def _safe_opener(first_name, display):
    # type: (Optional[str], str) -> Optional[str]
    """
    Returns a confirmed human first name, or None.
    NEVER falls back to community/display name — that produces garbage like 'yo underground'.
    """
    if first_name and " " in first_name:
        first_name = first_name.split()[0]

    if _is_human_name(first_name):
        return first_name.lower()

    return None


# ---------------------------------------------------------------------------
# DM generation
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
    raw = members * 0.05 * 199
    return abbreviate_money(raw)


def generate_dm(first_name: Optional[str], display: str, members: int = 0) -> str:
    opener = _safe_opener(first_name, display)
    mem_abbr = abbreviate_members(members) if members > 0 else "your"
    monthly = compute_monthly(members) if members > 0 else "$X"

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


# ---------------------------------------------------------------------------
# WAF-aware fetch (runs inside Playwright browser context)
# Mirrors skool-scout.py pattern exactly.
# ---------------------------------------------------------------------------

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
# Discovery — Whop GraphQL API (coreDiscoverySemanticSearch)
# ---------------------------------------------------------------------------

GRAPHQL_URL = f"{WHOP_BASE}/api/graphql/coreDiscoverySemanticSearch/"
GRAPHQL_QUERY = (
    "query coreDiscoverySemanticSearch($query: String!, $limit: Int, $page: Int) {"
    "  discoverySemanticSearch(query: $query, limit: $limit, page: $page) {"
    "    found"
    "    accessPasses {"
    "      id"
    "      name"
    "      visibility"
    "      company {"
    "        id"
    "        title"
    "        route"
    "        memberCount"
    "        description"
    "      }"
    "    }"
    "  }"
    "}"
)


def discover_via_graphql(page, query_term, limit=50, max_pages=5):
    # type: (object, str, int, int) -> list
    """
    Use Whop's GraphQL coreDiscoverySemanticSearch to find communities.
    Returns list of dicts compatible with normalise_item().
    """
    all_items = []

    for page_num in range(1, max_pages + 1):
        log.info("GraphQL search: q='%s' limit=%d page=%d", query_term, limit, page_num)

        body = {
            "operationName": "coreDiscoverySemanticSearch",
            "query": GRAPHQL_QUERY,
            "variables": {"query": query_term, "limit": limit, "page": page_num},
        }

        result = waf_fetch(page, GRAPHQL_URL, method="POST", body=body)

        if not isinstance(result, dict):
            log.warning("GraphQL non-dict response for '%s' page %d", query_term, page_num)
            break

        status = result.get("status", 0)
        if status != 200:
            log.warning("GraphQL status %d for '%s' page %d", status, query_term, page_num)
            break

        data = result.get("data", {})
        if "errors" in data and not data.get("data"):
            log.warning("GraphQL error: %s", data["errors"][0].get("message", "unknown"))
            break

        search_data = data.get("data", {}).get("discoverySemanticSearch", {})
        passes = search_data.get("accessPasses", [])

        if not passes:
            log.debug("No results for '%s' page %d", query_term, page_num)
            break

        for ap in passes:
            company = ap.get("company") or {}
            route = company.get("route", "")
            if not route:
                continue

            item = {
                "slug": route,
                "name": company.get("title", ""),
                "description": company.get("description") or "",
                "member_count": company.get("memberCount", 0),
                "company_id": company.get("id", ""),
                "access_pass_name": ap.get("name", ""),
                "_source": "graphql",
            }
            all_items.append(item)

        log.info("  q='%s' page=%d: %d results (total found: %s)",
                 query_term, page_num, len(passes), search_data.get("found", "?"))

        if len(passes) < limit:
            break

        time.sleep(1.0)

    return all_items


# ---------------------------------------------------------------------------
# Whop API enrichment
# ---------------------------------------------------------------------------

def enrich_from_page(page, slug):
    # type: (object, str) -> dict
    """
    Navigate to a community page and extract owner username, real display name,
    pricing info, and description.
    Returns dict with keys: owner_username, owner_display_name, community_type, description.
    """
    url = "{}/{}".format(WHOP_BASE, slug)
    result = {
        "owner_username": None,
        "owner_display_name": None,
        "community_type": "unknown",
        "description": "",
    }
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(2500)

        info = page.evaluate("""() => {
            const out = {username: null, displayName: null, isFree: null, desc: ''};

            // --- Owner username + real display name ---
            // Whop community pages show "Created by {INITIALS}{Full Name}"
            // Profile link text format: "CCChase Chappell" or "CCChase Chappell@chasecaStaff"
            // where CC are avatar initials (first letter of each name word)

            function extractRealName(linkText) {
                // Remove @username and Staff suffix
                var cleaned = linkText.replace(/@\\w+/g, '').replace(/Staff$/i, '').trim();
                // Remove "Created by" prefix
                cleaned = cleaned.replace(/^Created\\s*by\\s*/i, '').trim();
                // Remove leading 1-3 uppercase initials before the real name
                // Pattern: uppercase chars followed by an uppercase + lowercase (start of real name)
                cleaned = cleaned.replace(/^[A-Z]{1,3}(?=[A-Z][a-z])/, '').trim();
                // Validate: must have at least 2 chars and look like a name
                if (cleaned.length >= 2 && /^[A-Z][a-z]/.test(cleaned)) {
                    return cleaned;
                }
                return null;
            }

            const profileLinks = document.querySelectorAll('a[href^="/@"]');
            for (const a of profileLinks) {
                const href = a.getAttribute('href') || '';
                const user = href.replace(/^\\/@/, '').replace(/\\/$/, '').split('/')[0];
                if (!user || user.length < 2) continue;

                // First profile link = creator/owner
                if (!out.username) {
                    out.username = user;
                }

                // Extract real display name from link text
                if (!out.displayName) {
                    const text = a.textContent.trim();
                    const name = extractRealName(text);
                    if (name) {
                        out.displayName = name;
                    }
                }

                if (out.username && out.displayName) break;
            }

            // Fallback: check page title of format "Name | Whop"
            // (only useful on profile pages, not community pages)

            // --- Free/paid detection ---
            const bodyLower = document.body.innerText.toLowerCase();
            var priceMatch = bodyLower.match(/(\\$\\d+|free|\\d+\\/mo|per month)/);
            if (priceMatch) {
                var pm = priceMatch[1];
                if (pm === 'free' || pm === '$0') {
                    out.isFree = true;
                } else {
                    out.isFree = false;
                }
            }
            var buttons = document.querySelectorAll('button, a');
            for (var i = 0; i < buttons.length; i++) {
                var t = (buttons[i].textContent || '').toLowerCase().trim();
                if (t.indexOf('join for free') >= 0 || t.indexOf('start for free') >= 0 || t === 'free') {
                    out.isFree = true;
                    break;
                }
                if (/^\\$\\d/.test(t) || t.indexOf('/mo') >= 0 || t.indexOf('per month') >= 0) {
                    out.isFree = false;
                    break;
                }
            }

            // --- Description ---
            var metaDesc = document.querySelector('meta[name="description"]');
            if (metaDesc) out.desc = metaDesc.getAttribute('content') || '';

            return out;
        }""")

        if info:
            result["owner_username"] = info.get("username")
            result["owner_display_name"] = info.get("displayName")
            is_free = info.get("isFree")
            if is_free is True:
                result["community_type"] = "free"
            elif is_free is False:
                result["community_type"] = "paid"
            desc = info.get("desc", "")
            if desc:
                result["description"] = desc

    except Exception as exc:
        log.debug("Page enrichment failed for %s: %s", slug, exc)

    return result


def get_owner_real_name(page, username):
    # type: (object, str) -> Optional[str]
    """
    Visit /@{username} profile page and extract the real display name.
    Profile page title is always '{Real Name} | Whop'.
    Body shows '{Real Name}\\n@{username}'.
    This is the most reliable source for the owner's actual name.
    """
    if not username:
        return None
    url = "{}/{}".format(WHOP_BASE, "@" + username)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(2000)

        name = page.evaluate("""() => {
            // Strategy 1: page title — always "Real Name | Whop"
            var title = document.title || '';
            var parts = title.split(' | ');
            if (parts.length >= 2 && parts[0].trim().length >= 2) {
                var candidate = parts[0].trim();
                // Reject if it's just the username or "Whop"
                if (candidate.toLowerCase() !== 'whop' && !candidate.startsWith('@')) {
                    return candidate;
                }
            }

            // Strategy 2: body text — name appears before @username
            var body = document.body.innerText || '';
            var lines = body.split('\\n');
            for (var i = 0; i < Math.min(lines.length, 30); i++) {
                var line = lines[i].trim();
                // Look for line that's just a name (2+ chars, starts uppercase, no @)
                if (line.length >= 2 && line.length <= 50
                    && /^[A-Z]/.test(line) && line.indexOf('@') < 0
                    && !/\\d/.test(line) && line.indexOf('$') < 0) {
                    // Next line should be @username
                    if (i + 1 < lines.length && lines[i + 1].trim().startsWith('@')) {
                        return line;
                    }
                }
            }

            return null;
        }""")
        if name:
            log.info("  Profile name for @%s: '%s'", username, name)
        return name
    except Exception as exc:
        log.debug("Profile name fetch failed for @%s: %s", username, exc)
        return None


def _parse_member_count(raw):
    # type: (object) -> int
    """Parse member count from various formats: int, '1.2k', '500 members', etc."""
    if raw is None:
        return 0
    if isinstance(raw, (int, float)):
        return int(raw)
    text = str(raw).lower().replace(",", "").strip()
    # Handle "1.2k" or "1k"
    m = re.match(r"^(\d+(?:\.\d+)?)\s*k$", text)
    if m:
        return int(float(m.group(1)) * 1000)
    # Handle plain number embedded in text ("500 members")
    m = re.search(r"(\d+(?:\.\d+)?)", text)
    if m:
        return int(float(m.group(1)))
    return 0



def normalise_item(item):
    # type: (dict) -> Optional[dict]
    """
    Convert a raw community item (from GraphQL or other source) into a
    normalised candidate dict. Returns None if the item should be skipped.
    """
    slug = str(
        item.get("slug")
        or item.get("route")
        or item.get("id")
        or item.get("handle")
        or ""
    ).lower().strip().lstrip("/")

    display = str(
        item.get("name")
        or item.get("title")
        or item.get("display_name")
        or slug
    ).strip()

    description = str(item.get("description") or "").strip()
    tagline = str(item.get("tagline") or item.get("access_pass_name") or "").strip()

    members_raw = (
        item.get("member_count")
        or item.get("members")
        or item.get("memberCount")
        or 0
    )
    members = _parse_member_count(members_raw)

    company_id = str(item.get("company_id") or "")

    if not slug:
        return None

    # For GraphQL items, community_type is unknown until page enrichment
    community_type = "unknown"

    return {
        "slug": slug,
        "display": display,
        "description": description,
        "tagline": tagline,
        "members": members,
        "owner_id": company_id or None,
        "owner_username": None,
        "owner_first_name": None,
        "community_type": community_type,
    }


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_scout(
    test_mode: bool = False,
    keyword_filter: Optional[str] = None,
    limit: Optional[int] = None,
):
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    existing_queue = load_json(QUEUE_FILE, default=[])
    queued_slugs = {
        entry["slug"] for entry in existing_queue if isinstance(entry, dict)
    }
    contacted = load_contacted(CONTACTED_FILE)
    skip_slugs = queued_slugs | contacted

    if _crm:
        log.info("CRM connected")

    effective_limit = limit or (TEST_LIMIT if test_mode else None)
    tags = DISCOVER_TAGS

    new_leads = []
    seen_slugs = set()  # type: set

    # Load session cookies for authenticated GraphQL requests
    session_file = DATA_DIR / "whop_session.json"

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

        # Load session cookies for WAF and auth
        if session_file.exists():
            try:
                raw = load_json(session_file, default=[])
                cookies = raw if isinstance(raw, list) else raw.get("cookies", [])
                if cookies:
                    context.add_cookies(cookies)
                    log.info("Loaded %d session cookies", len(cookies))
            except Exception as exc:
                log.warning("Cookie load error: %s", exc)

        page = context.new_page()

        # Warm up — navigate to whop.com first to establish WAF integration
        try:
            log.info("Warming up whop.com...")
            page.goto("{}/".format(WHOP_BASE), wait_until="domcontentloaded", timeout=25000)
            page.wait_for_timeout(2500)
        except Exception as exc:
            log.warning("Warm-up failed: %s", exc)

        # --- Discover via GraphQL across all search terms ---
        raw_items_all = []  # type: list
        gql_limit = 20 if test_mode else 50
        max_pages = 1 if test_mode else 3

        for tag in tags:
            if effective_limit and len(raw_items_all) >= effective_limit * 10:
                break
            items = discover_via_graphql(page, tag, limit=gql_limit, max_pages=max_pages)
            raw_items_all.extend(items)
            time.sleep(0.5)

        log.info("Total raw items collected: %d", len(raw_items_all))

        # --- Normalise & deduplicate ---
        candidates: dict = {}
        for item in raw_items_all:
            c = normalise_item(item)
            if c and c["slug"] not in candidates:
                candidates[c["slug"]] = c

        log.info("Unique candidates after normalise: %d", len(candidates))

        # --- Filter, score, and enrich ---
        processed = 0
        for slug, c in candidates.items():
            if effective_limit and processed >= effective_limit:
                break

            if slug in skip_slugs or slug in seen_slugs:
                continue

            # CRM cross-platform gate
            if _crm:
                try:
                    check = _crm.check_contact_allowed(Platform.WHOP, slug)
                    if not check:
                        log.info(
                            "CRM skip %s: %s", slug, getattr(check, "reason", "locked")
                        )
                        continue
                except Exception as exc:
                    log.debug("CRM check failed for %s: %s", slug, exc)

            display = c["display"]
            description = c["description"]
            tagline = c["tagline"]
            members = c["members"]

            # ICP score
            score = compute_icp_score(display, description, tagline)
            if score == -999:
                log.debug("Skip %s: excluded by hard filter", slug)
                continue
            if score < 3:
                log.debug("Skip %s: ICP score %d < 3", slug, score)
                continue

            # Keyword filter (CLI --keyword)
            if keyword_filter and not keyword_matches(
                display, description, tagline, keyword_filter
            ):
                log.debug("Skip %s: keyword '%s' not matched", slug, keyword_filter)
                continue

            # Member minimum
            if members > 0 and members < MIN_MEMBERS:
                log.debug("Skip %s: members %d < %d", slug, members, MIN_MEMBERS)
                continue

            log.info(
                "Processing: %s (%d members, score %d)", slug, members, score
            )

            # Enrich via API if members unknown or owner data missing
            owner_id = c.get("owner_id")
            owner_username = c.get("owner_username")
            first_name = c.get("owner_first_name")
            community_type = c.get("community_type", "free")

            # Step 1: Community page enrichment (username + type + description)
            if not owner_username or community_type == "unknown":
                page_info = enrich_from_page(page, slug)
                if page_info.get("owner_username"):
                    owner_username = page_info["owner_username"]
                    log.info("  Enriched owner: @%s", owner_username)
                if page_info.get("community_type") != "unknown":
                    community_type = page_info["community_type"]
                    log.info("  Enriched type: %s", community_type)
                # Use display name from community page as initial source
                if page_info.get("owner_display_name"):
                    real_name = page_info["owner_display_name"]
                    first_name = real_name.split()[0] if real_name else None
                    log.info("  Display name from page: '%s'", real_name)
                page_desc = page_info.get("description", "")
                if page_desc and len(page_desc) > len(description):
                    description = page_desc
                time.sleep(0.5)

            # Step 2: Profile page — most reliable source for real name
            # Always visit /@{username} to get the actual display name
            if owner_username:
                real_name = get_owner_real_name(page, owner_username)
                if real_name:
                    # Take first word of display name as first_name
                    first_name = real_name.split()[0].strip()
                    log.info("  Real name: '%s' -> first_name='%s'", real_name, first_name)
                time.sleep(0.5)

            # After all enrichment, re-check member count
            if members > 0 and members < MIN_MEMBERS:
                log.debug(
                    "Skip %s after enrichment: members %d < %d",
                    slug, members, MIN_MEMBERS,
                )
                continue

            # Validate first_name — must be a real human name, not a username
            if first_name:
                first_name = first_name.lower().strip()
            if not _is_human_name(first_name):
                first_name = None

            # Build lead entry
            dm_text = generate_dm(first_name, display, members)
            now = datetime.now(timezone.utc).isoformat()

            lead = {
                "slug": slug,
                "display": display,
                "url": "{}/{}".format(WHOP_BASE, slug),
                "owner_id": owner_id or None,
                "owner_username": owner_username,
                "members": members,
                "first_name": first_name,
                "community_type": community_type,
                "dm_text": dm_text,
                "dm_status": "pending",
                "join_status": None,
                "joined_at": None,
                "score": score,
                "scraped_at": now,
            }

            # Register in CRM
            if _crm and not test_mode:
                try:
                    _crm.add_lead(
                        platform=Platform.WHOP,
                        handle=slug,
                        canonical_name=first_name or display,
                        url=lead["url"],
                        profile_data={
                            "display": display,
                            "members": members,
                            "owner_id": owner_id,
                            "owner_username": owner_username,
                        },
                    )
                except Exception as exc:
                    log.debug("CRM add_lead failed for %s: %s", slug, exc)

            new_leads.append(lead)
            seen_slugs.add(slug)
            processed += 1

            time.sleep(1.0)

        browser.close()

    # --- Output ---
    if test_mode:
        _print_test_report(keyword_filter, new_leads)
        return

    if new_leads:
        existing_queue.extend(new_leads)
        save_json(QUEUE_FILE, existing_queue)
        log.info("Appended %d new leads to %s", len(new_leads), QUEUE_FILE)
    else:
        log.info("No new leads found this run")


# ---------------------------------------------------------------------------
# Test report
# ---------------------------------------------------------------------------

def _print_test_report(keyword: Optional[str], leads: list):
    print("\n" + "=" * 62)
    print(f"TEST MODE  keyword={keyword}  results={len(leads)}")
    print("=" * 62)

    for i, lead in enumerate(leads, 1):
        print(f"\n--- Lead {i}: {lead['display']} ---")
        print(f"  slug:       {lead['slug']}")
        print(f"  url:        {lead['url']}")
        print(f"  members:    {lead['members']}")
        print(f"  score:      {lead['score']}")
        print(f"  owner_id:   {lead['owner_id']}")
        print(f"  first_name: {lead['first_name']}")
        print(f"  dm_status:  {lead['dm_status']}")
        wc = len(lead.get("dm_text", "").split())
        print(f"  DM ({wc} words):")
        print()
        for line in lead.get("dm_text", "").splitlines():
            print(f"    {line}")
        print()

    print("=" * 62 + "\n")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Whop community scout")
    parser.add_argument(
        "--test", action="store_true",
        help=f"Test mode — no file writes, limit {TEST_LIMIT} results",
    )
    parser.add_argument(
        "--keyword", type=str, default=None,
        help="Only include communities matching this keyword",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Max results to process (overrides test limit)",
    )
    args = parser.parse_args()

    run_scout(
        test_mode=args.test,
        keyword_filter=args.keyword,
        limit=args.limit,
    )


if __name__ == "__main__":
    main()
