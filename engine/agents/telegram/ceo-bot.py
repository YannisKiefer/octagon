#!/usr/bin/env python3
"""
ceo-bot.py — Telegram bot for the EcomBrain CEO.

Helps Yannis craft replies to inbound messages from leads and partners.
Uses raw urllib (stdlib only) to talk to the Telegram Bot API.

Commands:
    /start              Welcome + help
    /reply <text>       Paste a received message, get 3 reply suggestions
    /lookup <query>     CRM lookup by name, email, or handle
    /stats              Outreach system status snapshot
    /stop <platform>    Set stop flag for a platform
    /resume <platform>  Remove stop flag for a platform
    /team <name> <msg>  Send feedback to a specific fleet team
    /fleet              Quick fleet health check

Usage:
    python3 ceo-bot.py              # run the bot (long-polling)
    python3 ceo-bot.py --self-test  # verify token + send test message
    python3 ceo-bot.py --stats      # print config status to stdout
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
WORKSPACE = SCRIPT_DIR.parent.parent
CONFIG_FILE = WORKSPACE / "config" / "api_keys.json"
CRM_DB_PATH = WORKSPACE / "crm" / "leads.db"
STATUS_SCRIPT = WORKSPACE / "status.py"

STOP_FLAGS = {
    "skool": WORKSPACE / "skool-whop-team" / "data" / "DM_STOP.flag",
    "whop": WORKSPACE / "skool-whop-team" / "data" / "WHOP_STOP.flag",
    "ig_small": WORKSPACE / "instagram-team" / "data" / "IG_SMALL_STOP.flag",
    "ig_big": WORKSPACE / "instagram-team" / "data" / "IG_BIG_STOP.flag",
    "tw_small": WORKSPACE / "twitter-team" / "data" / "TW_SMALL_STOP.flag",
    "tw_big": WORKSPACE / "twitter-team" / "data" / "TW_BIG_STOP.flag",
    "linkedin": WORKSPACE / "linkedin-team" / "data" / "LI_STOP.flag",
    "reddit": WORKSPACE / "reddit-team" / "data" / "REDDIT_STOP.flag",
}

# Fleet feedback directory (agents read this on startup)
FEEDBACK_DIR = Path("/Users/yanniskiefer/clawd/brain/founder-feedback")

# Team name aliases -> canonical slug
TEAM_ALIASES = {
    "fleet": "fleetops", "fleetops": "fleetops", "ops": "fleetops",
    "finance": "finance", "fin": "finance",
    "product": "product", "prod": "product",
    "cs": "customer-success", "customer": "customer-success", "success": "customer-success",
    "design": "design", "ux": "design",
    "email": "email", "klaviyo": "email",
    "mobile": "mobile", "app": "mobile",
    "growth": "growth",
    "paid": "paid-media", "meta": "paid-media", "ads": "paid-media",
    "store": "store-intel", "intel": "store-intel", "si": "store-intel",
    "strategy": "strategy", "strat": "strategy",
    "security": "security", "sec": "security",
    "ai": "ai-builder", "builder": "ai-builder", "agent": "ai-builder",
    "general": "general",
    "seo": "seo-geo", "geo": "seo-geo",
    "perf": "performance", "performance": "performance", "lighthouse": "performance",
    "animation": "animation", "anim": "animation",
    "leadgen": "leadgen", "leads": "leadgen",
    "onboarding": "onboarding",
    "dashboard": "dashboard",
    "all": "all",
}

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ceo-bot")
POLL_TIMEOUT = 30


def load_json(path: Path, default: Any = None) -> Any:
    if default is None:
        default = {}
    if not path.exists():
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        log.error("Failed to load %s: %s", path, exc)
        return default

# ---------------------------------------------------------------------------
# Telegram Bot API (raw urllib)
# ---------------------------------------------------------------------------

def tg_request(token: str, method: str, params: Optional[dict] = None) -> dict:
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = json.dumps(params or {}).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=POLL_TIMEOUT + 10) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            if not body.get("ok"):
                log.error("TG API error: %s", body)
            return body
    except urllib.error.HTTPError as exc:
        log.error("HTTP %s: %s", exc.code, exc.read().decode("utf-8", errors="replace"))
        return {"ok": False}
    except Exception as exc:
        log.error("Request failed: %s", exc)
        return {"ok": False}


def send_msg(token: str, chat_id: int, text: str) -> dict:
    return tg_request(token, "sendMessage", {
        "chat_id": chat_id, "text": text,
        "parse_mode": "Markdown", "disable_web_page_preview": True,
    })


def get_updates(token: str, offset: int = 0) -> list:
    r = tg_request(token, "getUpdates", {
        "offset": offset, "timeout": POLL_TIMEOUT, "allowed_updates": ["message"],
    })
    return r.get("result", [])

# ---------------------------------------------------------------------------
# CRM integration (graceful degradation)
# ---------------------------------------------------------------------------

def crm_search(query: str) -> list[dict]:
    if not CRM_DB_PATH.exists():
        return []
    try:
        conn = sqlite3.connect(str(CRM_DB_PATH), timeout=10)
        conn.row_factory = sqlite3.Row
        pattern = f"%{query.lower()}%"
        entity_ids: dict[str, bool] = {}
        for row in conn.execute(
            "SELECT id FROM entities WHERE LOWER(canonical_name) LIKE ? LIMIT 10", (pattern,)
        ):
            entity_ids[row["id"]] = True
        for row in conn.execute(
            "SELECT entity_id FROM identities WHERE LOWER(handle) LIKE ? LIMIT 10", (pattern,)
        ):
            entity_ids[row["entity_id"]] = True

        results = []
        for eid in list(entity_ids)[:5]:
            e = conn.execute("SELECT * FROM entities WHERE id = ?", (eid,)).fetchone()
            if not e:
                continue
            ids = conn.execute(
                "SELECT platform, handle FROM identities WHERE entity_id = ?", (eid,)
            ).fetchall()
            logs = conn.execute(
                "SELECT platform, action, agent_id, message_preview, created_at "
                "FROM contact_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 5",
                (eid,),
            ).fetchall()
            results.append({
                "name": e["canonical_name"], "status": e["status"],
                "confidence": e["confidence"], "locked_by": e["locked_by"],
                "locked_until": e["locked_until"],
                "identities": [{"platform": i["platform"], "handle": i["handle"]} for i in ids],
                "actions": [dict(l) for l in logs],
            })
        conn.close()
        return results
    except Exception as exc:
        log.error("CRM search failed: %s", exc)
        return []


def fmt_crm(m: dict) -> str:
    lines = [f"*{m['name']}* ({m['status']}, score {m['confidence']})"]
    if m.get("locked_by"):
        lines.append(f"  Locked: {m['locked_by']} until {(m.get('locked_until') or '')[:16]}")
    if m["identities"]:
        lines.append("  " + ", ".join(f"{i['platform']}:{i['handle']}" for i in m["identities"]))
    for a in m["actions"][:3]:
        preview = a["message_preview"][:60]
        lines.append(f"  {a['created_at'][:16]} {a['platform']} {a['action']}")
        if preview:
            lines.append(f"    \"{preview}\"")
    return "\n".join(lines)

# ---------------------------------------------------------------------------
# Reply suggestion engine
# ---------------------------------------------------------------------------

def generate_replies(inbound: str, ctx: Optional[dict]) -> list[dict]:
    name = ""
    if ctx:
        full = ctx.get("name", "")
        name = full.split()[0].lower() if full else ""
    g = f"yo {name}" if name else "yo"
    hey = f"hey {name}" if name else "hey"
    lo = inbound.lower()
    is_price = any(w in lo for w in ("price", "pricing", "cost", "how much", "fee"))
    is_demo = any(w in lo for w in ("demo", "show me", "walkthrough", "see it"))

    if is_price:
        return [
            {"label": "Casual", "text": (
                f"{g}\n\nstarts at 149/mo. roi depends on your store size. "
                "happy to look at your case if you send over a quick application")},
            {"label": "Professional", "text": (
                f"{hey}\n\nplans start at $149/mo for the core suite. performance tier "
                "at $299 for stores doing 50k+/mo. best way to figure out fit is a quick "
                "15 min call. want me to send some times?")},
            {"label": "Closing", "text": (
                f"{g}\n\n149/mo and it runs your entire shopify klaviyo and meta stack "
                "on autopilot. zero dashboards. most stores see roi in the first week. "
                "send over a quick application and we will take a close look at your case")},
        ]
    if is_demo:
        return [
            {"label": "Casual", "text": (
                f"{g}\n\nyeah for sure. easier if i just show you how it works on a real "
                "store. whats your availability this week")},
            {"label": "Professional", "text": (
                f"{hey}\n\nabsolutely. i can do a live walkthrough so you see how it handles "
                "everything end to end. does this week work for 15 min?")},
            {"label": "Closing", "text": (
                f"{g}\n\nlets do it. i can show you a live store where the ai is running "
                "everything right now. no slides no bs. drop your calendar link or i send mine")},
        ]
    return [
        {"label": "Casual", "text": (
            f"{g}\n\nthanks for reaching out. happy to chat more. "
            "whats the best way to connect")},
        {"label": "Professional", "text": (
            f"{hey}\n\nthanks for the message. would love to learn more about your store "
            "and see if we can help. happy to jump on a quick call or send details first. "
            "what works best?")},
        {"label": "Closing", "text": (
            f"{g}\n\nyeah this is exactly the kind of store we built it for. send over a "
            "quick application and we will take a close look at your case. if its a fit "
            "i can set everything up this week")},
    ]

# ---------------------------------------------------------------------------
# Command handlers
# ---------------------------------------------------------------------------

def cmd_start(token: str, cid: int, _: str) -> None:
    send_msg(token, cid, (
        "*EcomBrain CEO Bot*\n\n"
        "*Outreach:*\n"
        "/reply <message> -- paste a message, get 3 reply options\n"
        "/lookup <name> -- search CRM\n"
        "/stop <platform> -- pause outreach\n"
        "/resume <platform> -- unpause\n\n"
        "*Fleet:*\n"
        "/fleet -- fleet health snapshot\n"
        "/team <name> <feedback> -- send feedback to a team\n"
        "/stats -- outreach system status\n\n"
        f"Platforms: {', '.join(sorted(STOP_FLAGS))}\n"
        f"Teams: {', '.join(sorted(set(TEAM_ALIASES.values())))}"
    ))


def cmd_reply(token: str, cid: int, text: str) -> None:
    if not text.strip():
        send_msg(token, cid, "Usage: /reply <paste the message you received>")
        return
    cleaned = text.strip().strip('"').strip("'")
    ctx = None
    name_match = re.search(r"(?:hey|hi|hello|yo)\s+(\w+)", cleaned, re.IGNORECASE)
    terms = [name_match.group(1)] if name_match else []
    terms.extend(w for w in cleaned.split()[:5] if len(w) > 3 and w.isalpha())
    for t in terms[:3]:
        matches = crm_search(t)
        if matches:
            ctx = matches[0]
            break

    parts = [f"*Inbound:*\n{cleaned}\n"]
    if ctx:
        parts.extend(["*CRM Match:*", fmt_crm(ctx)])
    else:
        parts.append("_Not in CRM. New lead or untracked contact._")
    parts.append("\n*Reply Options:*\n")
    for i, opt in enumerate(generate_replies(cleaned, ctx), 1):
        parts.extend([f"*{i}. {opt['label']}:*", opt["text"], ""])
    parts.append("_Pick a number or write your own._")
    send_msg(token, cid, "\n".join(parts))


def cmd_lookup(token: str, cid: int, query: str) -> None:
    if not query.strip():
        send_msg(token, cid, "Usage: /lookup <name, email, or handle>")
        return
    matches = crm_search(query.strip())
    if not matches:
        send_msg(token, cid, f"No results for \"{query.strip()}\"")
        return
    parts = [f"*CRM Results for \"{query.strip()}\":*\n"]
    for m in matches[:5]:
        parts.extend([fmt_crm(m), ""])
    send_msg(token, cid, "\n".join(parts))


def cmd_stats(token: str, cid: int, _: str) -> None:
    if not STATUS_SCRIPT.exists():
        send_msg(token, cid, "status.py not found.")
        return
    try:
        r = subprocess.run(
            [sys.executable, str(STATUS_SCRIPT)],
            capture_output=True, text=True, timeout=15, cwd=str(WORKSPACE),
        )
        out = (r.stdout.strip() or r.stderr.strip() or "No output.")[:3900]
        send_msg(token, cid, f"```\n{out}\n```")
    except subprocess.TimeoutExpired:
        send_msg(token, cid, "status.py timed out.")
    except Exception as exc:
        send_msg(token, cid, f"Error: {exc}")


def cmd_stop(token: str, cid: int, platform: str) -> None:
    p = platform.strip().lower()
    if p not in STOP_FLAGS:
        send_msg(token, cid, f"Unknown. Available: {', '.join(sorted(STOP_FLAGS))}")
        return
    flag = STOP_FLAGS[p]
    flag.parent.mkdir(parents=True, exist_ok=True)
    flag.write_text(f"Stopped by CEO bot at {datetime.now(timezone.utc).isoformat()}\n")
    send_msg(token, cid, f"Stop flag SET for {p}. Outreach paused.")


def cmd_resume(token: str, cid: int, platform: str) -> None:
    p = platform.strip().lower()
    if p not in STOP_FLAGS:
        send_msg(token, cid, f"Unknown. Available: {', '.join(sorted(STOP_FLAGS))}")
        return
    flag = STOP_FLAGS[p]
    if flag.exists():
        flag.unlink()
        send_msg(token, cid, f"Stop flag REMOVED for {p}. Outreach resumed.")
    else:
        send_msg(token, cid, f"No stop flag set for {p}. Already running.")

def cmd_team(token: str, cid: int, text: str) -> None:
    """Route founder feedback to a specific team.
    Usage: /team <name> <feedback message>
    The feedback is saved to a file that agents read on their next run.
    """
    parts = text.strip().split(None, 1)
    if len(parts) < 2:
        teams_list = ", ".join(sorted(set(TEAM_ALIASES.values())))
        send_msg(token, cid, (
            "*Usage:* /team <name> <your feedback>\n\n"
            f"*Teams:* {teams_list}\n\n"
            "*Examples:*\n"
            "/team perf fix the LCP, stop just reporting it\n"
            "/team email the segmentation agent is broken again\n"
            "/team all stop using Vercel, push to GitHub only"
        ))
        return

    team_input = parts[0].lower()
    feedback = parts[1]

    slug = TEAM_ALIASES.get(team_input)
    if not slug:
        close = [k for k in TEAM_ALIASES if k.startswith(team_input[:3])]
        hint = f" Did you mean: {', '.join(close[:3])}?" if close else ""
        send_msg(token, cid, f"Unknown team '{team_input}'.{hint}")
        return

    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y-%m-%d %H:%M UTC")
    today = now.strftime("%Y-%m-%d")

    FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)

    if slug == "all":
        fpath = FEEDBACK_DIR / f"ALL-TEAMS-{today}.md"
    else:
        fpath = FEEDBACK_DIR / f"{slug}-{today}.md"

    with open(fpath, "a", encoding="utf-8") as f:
        f.write(f"\n## Founder Feedback — {ts}\n")
        f.write(f"To: {slug}\n")
        f.write(f"{feedback}\n")

    send_msg(token, cid, (
        f"Feedback saved for *{slug}*.\n"
        f"File: `{fpath.name}`\n"
        f"All agents in {slug} will read this on their next run."
    ))


def cmd_fleet(token: str, cid: int, _: str) -> None:
    """Quick fleet health check — reads jobs.json for error summary."""
    jobs_file = Path("/Users/yanniskiefer/.openclaw/cron/jobs.json")
    if not jobs_file.exists():
        send_msg(token, cid, "jobs.json not found.")
        return
    try:
        with open(jobs_file, encoding="utf-8") as f:
            jobs = json.load(f)["jobs"]

        enabled = [j for j in jobs if j.get("enabled")]
        erroring = [
            j for j in enabled
            if j.get("state", {}).get("consecutiveErrors", 0) > 0
        ]
        total = len(enabled)
        ok = total - len(erroring)
        err_pct = round(len(erroring) / total * 100, 1) if total else 0

        lines = [
            f"*Fleet Health*\n",
            f"Total: {total} | OK: {ok} | Errors: {len(erroring)} ({err_pct}%)\n",
        ]

        if erroring:
            lines.append("*Top errors:*")
            for j in sorted(erroring,
                            key=lambda x: x.get("state", {}).get("consecutiveErrors", 0),
                            reverse=True)[:8]:
                name = j.get("name", "?")[:35]
                ce = j.get("state", {}).get("consecutiveErrors", 0)
                err = j.get("state", {}).get("lastError", "")[:50]
                lines.append(f"  {name} ({ce}x) {err}")

        # Check auto-fix log
        fix_log = Path("/tmp/fleet-auto-fix.log")
        if fix_log.exists():
            last_lines = fix_log.read_text().strip().split("\n")
            summary = [l for l in last_lines if "SUMMARY:" in l]
            if summary:
                lines.extend(["", f"*Auto-fixer:* {summary[-1].split('] ')[-1]}"])

        send_msg(token, cid, "\n".join(lines))
    except Exception as exc:
        send_msg(token, cid, f"Error reading fleet: {exc}")


# ---------------------------------------------------------------------------
# Security gate + dispatcher
# ---------------------------------------------------------------------------

COMMANDS = {
    "/start": cmd_start, "/reply": cmd_reply, "/lookup": cmd_lookup,
    "/stats": cmd_stats, "/stop": cmd_stop, "/resume": cmd_resume,
    "/team": cmd_team, "/fleet": cmd_fleet,
}


def dispatch(token: str, owner_id: int, update: dict) -> None:
    msg = update.get("message", {})
    text = msg.get("text", "")
    cid = msg.get("chat", {}).get("id")
    uid = msg.get("from", {}).get("id", 0)
    if not text or not cid:
        return
    if uid != owner_id and cid != owner_id:
        log.warning("Unauthorized: chat_id=%s", cid)
        send_msg(token, cid, "Unauthorized. This bot is private.")
        return
    for prefix, handler in COMMANDS.items():
        if text.startswith(prefix):
            handler(token, cid, text[len(prefix):].strip())
            return

    # Smart routing: if Yannis sends free text, try to detect intent
    lo = text.lower().strip()

    # Check if it looks like team feedback (starts with a team name)
    first_word = lo.split()[0] if lo.split() else ""
    if first_word in TEAM_ALIASES and len(text.split()) > 2:
        cmd_team(token, cid, text.strip())
        return

    # Otherwise suggest commands
    send_msg(token, cid, (
        "No command detected. Try:\n"
        "/team <name> <feedback> -- send feedback to a team\n"
        "/fleet -- fleet health\n"
        "/start -- all commands"
    ))

# ---------------------------------------------------------------------------
# Main loop + CLI
# ---------------------------------------------------------------------------

def run_bot(token: str, owner_id: int) -> None:
    log.info("Starting. owner_id=%s", owner_id)
    me = tg_request(token, "getMe")
    if not me.get("ok"):
        log.error("Invalid token. getMe failed.")
        sys.exit(1)
    log.info("Online: @%s", me.get("result", {}).get("username", "?"))
    offset = 0
    while True:
        try:
            for u in get_updates(token, offset):
                offset = u.get("update_id", 0) + 1
                try:
                    dispatch(token, owner_id, u)
                except Exception as exc:
                    log.error("Handler error: %s", exc)
        except KeyboardInterrupt:
            log.info("Shutting down.")
            break
        except Exception as exc:
            log.error("Poll error: %s. Retry in 5s.", exc)
            time.sleep(5)


def self_test(token: str, cid: int) -> None:
    print("Self-test...")
    me = tg_request(token, "getMe")
    if not me.get("ok"):
        print(f"  FAILED: getMe error")
        sys.exit(1)
    print(f"  Bot: @{me['result'].get('username')} (id: {me['result'].get('id')})")
    now_s = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    r = send_msg(token, cid, f"CEO Bot self-test at {now_s}. All systems operational.")
    print(f"  Message: {'sent' if r.get('ok') else 'FAILED'}")
    print(f"  CRM: {'connected' if CRM_DB_PATH.exists() else 'unavailable'}")
    print(f"  status.py: {'found' if STATUS_SCRIPT.exists() else 'MISSING'}")


def print_config_stats() -> None:
    cfg = load_json(CONFIG_FILE)
    print("CEO Bot Config")
    print(f"  Token: {'SET' if cfg.get('telegram_bot_token', '').strip() else 'MISSING'}")
    print(f"  Chat ID: {cfg.get('telegram_chat_id', 'MISSING')}")
    print(f"  CRM: {'EXISTS' if CRM_DB_PATH.exists() else 'MISSING'}")
    print(f"  status.py: {'EXISTS' if STATUS_SCRIPT.exists() else 'MISSING'}")
    print("\nStop flags:")
    for name, path in sorted(STOP_FLAGS.items()):
        print(f"  {name}: {'SET' if path.exists() else 'clear'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="EcomBrain CEO Telegram Bot")
    parser.add_argument("--self-test", action="store_true", help="Verify token + send test")
    parser.add_argument("--stats", action="store_true", help="Print config status")
    args = parser.parse_args()

    if args.stats:
        print_config_stats()
        return

    cfg = load_json(CONFIG_FILE)
    token = cfg.get("telegram_bot_token", "").strip()
    if not token:
        log.error("telegram_bot_token missing in %s", CONFIG_FILE)
        sys.exit(1)
    try:
        owner_id = int(cfg.get("telegram_chat_id", ""))
    except (ValueError, TypeError):
        log.error("telegram_chat_id invalid in %s", CONFIG_FILE)
        sys.exit(1)

    if args.self_test:
        self_test(token, owner_id)
        return
    run_bot(token, owner_id)


if __name__ == "__main__":
    main()
