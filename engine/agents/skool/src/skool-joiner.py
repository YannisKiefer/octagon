#!/usr/bin/env python3
"""
skool-joiner.py — Join Skool communities from queue with human-like delays.

Joins up to 200/day. Tracks timestamps in joined.json for the 24h DM rule.

Usage:
  python3 skool-joiner.py
  python3 skool-joiner.py --dry-run
"""

import argparse
import json
import logging
import os
import random
import sys
import time
from datetime import datetime, timezone, date
from pathlib import Path

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

# CRM — unified lead database (optional, degrades gracefully)
_CRM_PATH = Path(__file__).parent.parent.parent / "crm"
if _CRM_PATH.exists():
    sys.path.insert(0, str(_CRM_PATH))
try:
    from crm import CRM, Platform, ActionType
    _crm: "CRM | None" = CRM()
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

MAX_JOINS_PER_DAY = 200
JOIN_DELAY_MIN = 30   # seconds
JOIN_DELAY_MAX = 60   # seconds

# Survey contextual answers
SURVEY_ANSWERS = {
    "email": "kieferyannis@gmail.com",
    "erfahrung": "Ja, ich habe bereits eigene Shopify Stores betrieben und bin mit E-Commerce vertraut.",
    "experience": "Yes, I have run Shopify stores and have experience in e-commerce.",
    "angestellt": "Nein, ich bin selbstständig als Gründer tätig.",
    "beruf": "Nein, ich bin selbstständig als Gründer tätig.",
    "job": "I am self-employed as a founder and entrepreneur.",
    "warum": "Um mein E-Commerce Business weiter zu skalieren und von der Community zu lernen.",
    "why": "To scale my e-commerce business and learn from the community.",
    "goal": "To grow my Shopify store and connect with other e-commerce entrepreneurs.",
    "ziel": "Um mein E-Commerce Business weiter zu skalieren.",
    "default_de": "Ich bin Gründer und betreibe mehrere Shopify Stores.",
    "default_en": "I am a founder running multiple Shopify stores.",
}

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
# File I/O helpers
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


def load_session_cookies(session_file: Path) -> list:
    data = load_json(session_file, default={})
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("cookies", [])
    return []


# ---------------------------------------------------------------------------
# Cross-platform name matching
# ---------------------------------------------------------------------------

def _try_cross_platform_link(crm, entity_id: str, name: str, skip_platform, skip_handle: str):
    """
    Check if a person with this name already exists on another platform.
    If found, link the entities to prevent duplicate outreach.
    """
    import sqlite3 as _sq
    name_lower = name.strip().lower()
    if len(name_lower) < 3:
        return

    try:
        with crm._connect() as conn:
            # Find entities with matching canonical_name on OTHER platforms
            rows = conn.execute("""
                SELECT DISTINCT e.id, e.canonical_name, i.platform, i.handle
                FROM entities e
                JOIN identities i ON i.entity_id = e.id
                WHERE LOWER(e.canonical_name) = ?
                  AND e.id != ?
                  AND NOT (i.platform = ? AND i.handle = ?)
            """, (name_lower, entity_id, skip_platform.value, skip_handle)).fetchall()

            for row in rows:
                other_id = row["id"]
                other_platform = row["platform"]
                log.info(
                    "Cross-platform match: '%s' on %s:%s = %s:%s — linking entities",
                    name_lower, skip_platform.value, skip_handle,
                    other_platform, row["handle"],
                )
                crm.link_entities(entity_id, other_id, confidence=0.9, resolved_by="name_match")
    except Exception as exc:
        log.debug("Cross-platform link error for %s: %s", name, exc)


# ---------------------------------------------------------------------------
# WAF-aware fetch
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
            const text = await resp.text();
            let data;
            try {{ data = JSON.parse(text); }} catch(e) {{ data = text; }}
            return {{ status: resp.status, data: data }};
        }} catch(e) {{
            return {{ status: 0, data: e.toString() }};
        }}
    }})()"""
    return page.evaluate(js)


# ---------------------------------------------------------------------------
# Survey handling
# ---------------------------------------------------------------------------

def pick_survey_answer(question_text: str, question_type: str, options=None) -> str:
    """Pick an appropriate survey answer based on question context."""
    q_lower = question_text.lower() if question_text else ""

    # Email fields
    if question_type == "email" or "email" in q_lower:
        return SURVEY_ANSWERS["email"]

    # Option-type: prefer "yes" option or first
    if question_type in ("radio", "checkbox", "select") and options:
        for opt in options:
            opt_str = str(opt.get("value") or opt.get("label") or opt).lower()
            if "yes" in opt_str or "ja" in opt_str:
                return str(opt.get("value") or opt.get("id") or opt_str)
        # fallback: first option
        first = options[0]
        return str(first.get("value") or first.get("id") or first)

    # Text/textarea — match by keyword
    for key, answer in SURVEY_ANSWERS.items():
        if key in ("email", "default_de", "default_en"):
            continue
        if key in q_lower:
            return answer

    # German vs English default
    german_markers = ["ich", "sie", "und", "die", "der", "das", "ist", "für", "warum", "wie"]
    is_german = any(m in q_lower for m in german_markers)
    return SURVEY_ANSWERS["default_de"] if is_german else SURVEY_ANSWERS["default_en"]


def handle_survey(page, slug: str, group_id: str, join_response: dict = None) -> bool:
    """
    Handle survey after join-group API returns needs_survey.
    Full page-based approach: navigate to group, click Join, fill survey dialog.
    Returns True on success, False on failure.
    """
    log.info("Handling survey for %s via page", slug)
    try:
        # Navigate to group page (domcontentloaded avoids networkidle timeouts)
        page.goto(f"https://www.skool.com/{slug}", wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(3000)

        # --- Step 1: Click the Join / Request to join button ---
        # After API returned needs_survey, the page should show the group with a join prompt
        # Look for various join button texts Skool uses
        join_selectors = [
            "button:has-text('Answer questions')",
            "button:has-text('Complete')",
            "button:has-text('Request to join')",
            "button:has-text('Join for free')",
            "button:has-text('Join group')",
            "button:has-text('Join')",
            "a:has-text('Answer questions')",
            "a:has-text('Join')",
        ]

        join_clicked = False
        for sel in join_selectors:
            btn = page.query_selector(sel)
            if btn and btn.is_visible():
                log.info("Clicking '%s' for %s", btn.inner_text().strip()[:40], slug)
                btn.click()
                page.wait_for_timeout(3000)
                join_clicked = True
                break

        if not join_clicked:
            log.debug("No join button found on page for %s — checking for inline form", slug)

        # --- Step 2: Find survey inputs (dialog, modal, or inline form) ---
        # Skool survey dialog uses various containers
        input_selectors = [
            # Dialog/modal inputs
            "[role='dialog'] input:not([type='hidden'])",
            "[role='dialog'] textarea",
            "[role='dialog'] select",
            # Overlay / form containers
            "[class*='modal'] input:not([type='hidden'])",
            "[class*='modal'] textarea",
            "[class*='dialog'] input:not([type='hidden'])",
            "[class*='dialog'] textarea",
            # Generic form inputs (excluding search/nav)
            "form input[type='text']",
            "form input[type='email']",
            "form textarea",
            "form select",
        ]

        all_inputs = []
        for sel in input_selectors:
            elements = page.query_selector_all(sel)
            for el in elements:
                if el.is_visible():
                    all_inputs.append(el)

        # Deduplicate by element handle
        seen_handles = set()
        unique_inputs = []
        for inp in all_inputs:
            box = inp.bounding_box()
            key = (int(box["x"]), int(box["y"])) if box else id(inp)
            if key not in seen_handles:
                seen_handles.add(key)
                unique_inputs.append(inp)

        radio_inputs = []
        for sel in ["[role='dialog'] input[type='radio']", "form input[type='radio']"]:
            for el in page.query_selector_all(sel):
                if el.is_visible():
                    radio_inputs.append(el)

        log.info("Found %d inputs and %d radios for %s", len(unique_inputs), len(radio_inputs), slug)

        if not unique_inputs and not radio_inputs:
            # Last resort: take screenshot-style debug — dump page text
            page_text = page.inner_text("body")[:500] if page.query_selector("body") else ""
            log.warning("No survey fields found on page for %s. Page text: %s", slug, page_text[:200])
            return False

        filled = 0

        # --- Step 3: Fill inputs ---
        for inp in unique_inputs:
            tag = inp.evaluate("el => el.tagName.toLowerCase()")
            inp_type = inp.get_attribute("type") or "text"

            # Skip hidden, submit, search inputs
            if inp_type in ("hidden", "submit", "button", "search"):
                continue

            # Find label text
            label_text = ""
            inp_id = inp.get_attribute("id") or ""
            if inp_id:
                label_el = page.query_selector(f"label[for='{inp_id}']")
                if label_el:
                    label_text = label_el.inner_text()
            if not label_text:
                placeholder = inp.get_attribute("placeholder") or ""
                label_text = placeholder
            if not label_text:
                # Check parent or preceding sibling for label text
                label_text = inp.evaluate("""el => {
                    const prev = el.previousElementSibling;
                    if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'P' || prev.tagName === 'SPAN'))
                        return prev.innerText || '';
                    const parent = el.closest('[class*=field], [class*=question]');
                    if (parent) {
                        const lbl = parent.querySelector('label, p, span');
                        if (lbl) return lbl.innerText || '';
                    }
                    return '';
                }""")

            answer = pick_survey_answer(label_text, inp_type, None)

            if tag == "select":
                # For select: pick first non-empty option
                options = inp.query_selector_all("option")
                for opt in options:
                    val = opt.get_attribute("value")
                    if val:
                        inp.select_option(value=val)
                        filled += 1
                        break
            elif tag == "textarea" or inp_type in ("text", "email"):
                inp.fill(answer)
                filled += 1

            log.debug("Filled '%s' (%s) with '%s'", label_text[:40], inp_type, answer[:40])

        # Handle radio buttons
        seen_names = set()
        for radio in radio_inputs:
            name = radio.get_attribute("name") or ""
            if name in seen_names:
                continue
            seen_names.add(name)
            radio.check()
            filled += 1

        if filled == 0:
            log.warning("Could not fill any survey fields for %s", slug)
            return False

        # --- Step 4: Submit ---
        submit_selectors = [
            "[role='dialog'] button[type='submit']",
            "[role='dialog'] button:has-text('Submit')",
            "[role='dialog'] button:has-text('Done')",
            "[role='dialog'] button:has-text('Join')",
            "[role='dialog'] button:has-text('Continue')",
            "form button[type='submit']",
            "button:has-text('Submit')",
            "button:has-text('Done')",
            "button:has-text('Continue')",
        ]

        for sel in submit_selectors:
            submit_btn = page.query_selector(sel)
            if submit_btn and submit_btn.is_visible():
                submit_btn.click()
                page.wait_for_timeout(3000)
                log.info("Survey submitted for %s (%d fields filled, button: '%s')", slug, filled, submit_btn.inner_text().strip()[:20])
                return True

        # If no explicit submit, try pressing Enter on last input
        if unique_inputs:
            unique_inputs[-1].press("Enter")
            page.wait_for_timeout(3000)
            log.info("Survey submitted via Enter for %s (%d fields filled)", slug, filled)
            return True

        log.warning("No submit button found for survey on %s", slug)
        return False

    except Exception as exc:
        log.warning("Page-based survey failed for %s: %s", slug, exc)
        return False


def try_page_join(page, slug: str) -> bool:
    """
    Full page-based join: navigate to group, click Join, handle survey if needed.
    Returns True if successfully joined.
    """
    try:
        page.goto(f"https://www.skool.com/{slug}", wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(3000)

        # Find join button
        join_selectors = [
            "button:has-text('Join for free')",
            "button:has-text('Join group')",
            "button:has-text('Request to join')",
            "button:has-text('Join')",
            "a:has-text('Join for free')",
            "a:has-text('Join')",
        ]

        for sel in join_selectors:
            btn = page.query_selector(sel)
            if btn and btn.is_visible():
                btn.click()
                page.wait_for_timeout(4000)

                # Check if survey dialog appeared
                dialog_inputs = page.query_selector_all(
                    "[role='dialog'] input:not([type='hidden']), "
                    "[role='dialog'] textarea, "
                    "[class*='modal'] input:not([type='hidden']), "
                    "[class*='modal'] textarea"
                )
                visible_inputs = [i for i in dialog_inputs if i.is_visible()]

                if visible_inputs:
                    # Fill survey
                    filled = 0
                    for inp in visible_inputs:
                        inp_type = inp.get_attribute("type") or "text"
                        if inp_type in ("hidden", "submit"):
                            continue
                        label_text = inp.get_attribute("placeholder") or ""
                        if not label_text:
                            inp_id = inp.get_attribute("id") or ""
                            if inp_id:
                                lbl = page.query_selector(f"label[for='{inp_id}']")
                                if lbl:
                                    label_text = lbl.inner_text()
                        answer = pick_survey_answer(label_text, inp_type, None)
                        inp.fill(answer)
                        filled += 1

                    # Submit survey
                    for sub_sel in [
                        "[role='dialog'] button[type='submit']",
                        "[role='dialog'] button:has-text('Submit')",
                        "[role='dialog'] button:has-text('Done')",
                        "[role='dialog'] button:has-text('Continue')",
                        "button[type='submit']",
                        "button:has-text('Submit')",
                    ]:
                        sub_btn = page.query_selector(sub_sel)
                        if sub_btn and sub_btn.is_visible():
                            sub_btn.click()
                            page.wait_for_timeout(3000)
                            log.info("Page join with survey for %s (%d fields)", slug, filled)
                            return True

                # Check if we're now a member (no survey needed)
                # Look for indicators of membership: community feed, welcome message
                member_indicators = page.query_selector_all(
                    "[data-testid='community-feed'], "
                    "button:has-text('Leave'), "
                    "a:has-text('Community'), a:has-text('Classroom')"
                )
                if member_indicators:
                    log.info("Page join succeeded for %s (no survey)", slug)
                    return True

                # Check URL changed (might redirect to community page)
                current_url = page.url
                if f"/{slug}" in current_url and "discover" not in current_url:
                    log.info("Page join likely succeeded for %s (URL: %s)", slug, current_url)
                    return True

                return False

        log.warning("No join button found on page for %s", slug)
        return False

    except Exception as exc:
        log.warning("Page join failed for %s: %s", slug, exc)
        return False


# ---------------------------------------------------------------------------
# Daily join count
# ---------------------------------------------------------------------------

def count_joins_today(joined: list) -> int:
    today_str = date.today().isoformat()
    count = 0
    for entry in joined:
        joined_at = entry.get("joined_at", "")
        if joined_at.startswith(today_str):
            count += 1
    return count


# ---------------------------------------------------------------------------
# Main join loop
# ---------------------------------------------------------------------------

def run_joiner(dry_run: bool = False):
    queue = load_json(QUEUE_FILE, default=[])
    joined = load_json(JOINED_FILE, default=[])
    contacted = load_contacted(CONTACTED_FILE)

    joined_slugs = {entry["slug"] for entry in joined if isinstance(entry, dict)}
    today_count = count_joins_today(joined)

    log.info("Today's join count so far: %d / %d", today_count, MAX_JOINS_PER_DAY)

    if today_count >= MAX_JOINS_PER_DAY:
        log.info("Daily limit reached. Exiting.")
        return

    # Filter queue: only queued status, not already joined or contacted
    candidates = [
        entry for entry in queue
        if (
            isinstance(entry, dict)
            and entry.get("status") == "queued"
            and entry.get("slug") not in joined_slugs
            and entry.get("slug") not in contacted
        )
    ]

    # Sort by score descending
    candidates.sort(key=lambda x: x.get("score", 0), reverse=True)

    log.info("Candidates to join: %d", len(candidates))

    if dry_run:
        log.info("DRY RUN — no API calls will be made")
        for c in candidates[:5]:
            log.info("  Would join: %s (%s members, score %s)", c["slug"], c.get("members"), c.get("score"))
        return

    joins_this_run = 0
    queue_updates = {}  # slug -> status

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
            log.warning("No session cookies — running unauthenticated")

        page = context.new_page()

        # Warm up
        try:
            page.goto(f"{SKOOL_BASE}/", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(2000)
        except Exception as exc:
            log.warning("Warm-up failed: %s", exc)

        for candidate in candidates:
            if today_count + joins_this_run >= MAX_JOINS_PER_DAY:
                log.info("Daily limit reached during run")
                break

            slug = candidate["slug"]
            group_id = candidate.get("group_id") or slug

            # CRM gate — cross-platform check before joining
            if _crm:
                check = _crm.check_contact_allowed(Platform.SKOOL, slug)
                if not check:
                    log.info(
                        "CRM block %s: %s (locked by %s)",
                        slug, check.reason, check.locked_by,
                    )
                    queue_updates[slug] = f"crm_block:{check.reason}"
                    continue

            log.info("Joining: %s", slug)

            join_url = f"{API_BASE}/groups/{slug}/join-group"
            result = waf_fetch(page, join_url, method="POST", body={})

            status_code = result.get("status", 0)
            response_data = result.get("data", {})

            if status_code in (200, 201, 204):
                log.info("Join API returned %d for %s — checking survey requirement", status_code, slug)

                # Check if survey required (API uses snake_case: needs_survey)
                needs_survey = False
                if isinstance(response_data, dict):
                    needs_survey = (
                        response_data.get("needs_survey")
                        or response_data.get("needsSurvey")
                        or response_data.get("surveyRequired")
                        or response_data.get("survey_required")
                        or response_data.get("status") == "survey_required"
                    )

                survey_ok = True
                if needs_survey:
                    log.info("Survey required for %s — submitting (response keys: %s)", slug, list(response_data.keys()) if isinstance(response_data, dict) else type(response_data).__name__)
                    survey_ok = handle_survey(page, slug, str(group_id), join_response=response_data)
                    if not survey_ok:
                        log.warning("Survey submission failed for %s — join incomplete", slug)
                        queue_updates[slug] = "survey_failed"
                        continue

                log.info("Joined %s successfully (survey: %s)", slug, "submitted" if needs_survey else "not needed")

                # CRM: log join action (sets context, does NOT lock — DM lock set when DM sent)
                if _crm:
                    try:
                        owner_name = candidate.get("first_name") or ""
                        owner_username = candidate.get("owner_username") or ""
                        display_name = candidate.get("display") or slug
                        # Canonical name: owner's real name, fallback to display
                        canonical = owner_name if owner_name else display_name

                        entity_id, is_new = _crm.add_lead(
                            platform=Platform.SKOOL,
                            handle=slug,
                            canonical_name=canonical,
                            profile_data={
                                "display": display_name,
                                "members": candidate.get("members"),
                                "owner_id": candidate.get("owner_id"),
                                "owner_username": owner_username,
                                "first_name": owner_name,
                            },
                        )

                        # Cross-platform name match: check if this person exists on other platforms
                        if owner_name and len(owner_name) > 2:
                            _try_cross_platform_link(_crm, entity_id, owner_name, Platform.SKOOL, slug)

                        _crm.log_contact(
                            platform=Platform.SKOOL,
                            handle=slug,
                            action=ActionType.JOINED_GROUP,
                            agent_id="skool-joiner",
                            metadata={"group_id": str(group_id)},
                            lock_days=0,  # Join only — no lock yet (DM sets the lock)
                        )
                    except Exception as exc:
                        log.debug("CRM error for %s: %s", slug, exc)

                # Record in joined.json
                joined_entry = {
                    "slug": slug,
                    "group_id": candidate.get("group_id"),
                    "owner_id": candidate.get("owner_id"),
                    "first_name": candidate.get("first_name"),
                    "display": candidate.get("display"),
                    "members": candidate.get("members", 0),
                    "dm_text": candidate.get("dm_text"),
                    "joined_at": datetime.now(timezone.utc).isoformat(),
                    "dm_status": "pending",
                }
                joined.append(joined_entry)
                joined_slugs.add(slug)
                queue_updates[slug] = "joined"
                joins_this_run += 1

                # Save progress incrementally
                save_json(JOINED_FILE, joined)

                queue_remaining = len(candidates) - joins_this_run
                tg.send(
                    "Joined %s (%s members). %d joined today, %d in queue."
                    % (slug, candidate.get("members", "?"), today_count + joins_this_run, queue_remaining)
                )

            elif status_code == 400:
                error_msg = str(response_data).lower() if response_data else ""
                if "membership billing" in error_msg or "payment" in error_msg:
                    log.info("Paid community, skipping: %s", slug)
                    queue_updates[slug] = "paid_skip"
                elif "already" in error_msg or "member" in error_msg:
                    log.info("Already a member of %s — recording as joined", slug)
                    queue_updates[slug] = "joined"
                    joined_entry = {
                        "slug": slug,
                        "group_id": candidate.get("group_id"),
                        "owner_id": candidate.get("owner_id"),
                        "first_name": candidate.get("first_name"),
                        "display": candidate.get("display"),
                        "members": candidate.get("members", 0),
                        "dm_text": candidate.get("dm_text"),
                        "joined_at": datetime.now(timezone.utc).isoformat(),
                        "dm_status": "pending",
                    }
                    joined.append(joined_entry)
                    joined_slugs.add(slug)
                    save_json(JOINED_FILE, joined)
                else:
                    # "invalid request" — try page-based join as fallback
                    log.info("400 '%s' for %s — trying page-based join", error_msg[:60], slug)
                    page_joined = try_page_join(page, slug)
                    if page_joined:
                        log.info("Page-based join succeeded for %s", slug)
                        queue_updates[slug] = "joined"
                        joined_entry = {
                            "slug": slug,
                            "group_id": candidate.get("group_id"),
                            "owner_id": candidate.get("owner_id"),
                            "first_name": candidate.get("first_name"),
                            "display": candidate.get("display"),
                            "members": candidate.get("members", 0),
                            "dm_text": candidate.get("dm_text"),
                            "joined_at": datetime.now(timezone.utc).isoformat(),
                            "dm_status": "pending",
                        }
                        joined.append(joined_entry)
                        joined_slugs.add(slug)
                        joins_this_run += 1
                        save_json(JOINED_FILE, joined)
                        tg.send(
                            "Joined %s (%s members) via page. %d joined today."
                            % (slug, candidate.get("members", "?"), today_count + joins_this_run)
                        )
                    else:
                        queue_updates[slug] = "error"

            elif status_code == 424:
                log.info("Paid community, skipping: %s", slug)
                queue_updates[slug] = "paid_skip"

            elif status_code == 429:
                log.warning("Rate limited on %s — stopping for today", slug)
                break

            elif status_code == 401 or status_code == 403:
                log.error("Auth error %d on %s — check session cookies", status_code, slug)
                break

            else:
                log.warning("Unexpected status %d for %s: %s", status_code, slug, str(response_data)[:200])
                queue_updates[slug] = "error"

            # Human-like delay between actual join attempts only
            if queue_updates.get(slug) not in ("error", "paid_skip", "survey_failed"):
                delay = random.uniform(JOIN_DELAY_MIN, JOIN_DELAY_MAX)
                log.info("Waiting %.0fs before next join...", delay)
                time.sleep(delay)

        browser.close()

    # Update queue statuses
    for entry in queue:
        if isinstance(entry, dict) and entry.get("slug") in queue_updates:
            entry["status"] = queue_updates[entry["slug"]]
    save_json(QUEUE_FILE, queue)

    log.info(
        "Run complete. Joined: %d. Total today: %d",
        joins_this_run,
        today_count + joins_this_run,
    )

    # Remaining queue count (candidates not yet joined minus what we joined)
    remaining_queue = len([
        e for e in load_json(QUEUE_FILE, default=[])
        if isinstance(e, dict) and e.get("status") == "queued"
    ])
    tg.send(
        "Skool joiner complete. Joined: %d today. Queue remaining: %d."
        % (today_count + joins_this_run, remaining_queue)
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Skool community joiner")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview only — no API calls or file writes",
    )
    args = parser.parse_args()
    run_joiner(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
