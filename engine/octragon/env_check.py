"""
Startup environment variable validation for the Octragon engine.
Import and call validate_env() early in startup to fail loudly
if required environment variables are missing.
"""

from __future__ import annotations
import os
import sys
from typing import NamedTuple


class EnvVar(NamedTuple):
    key: str
    description: str
    required_for_supabase: bool = False
    required_for_gemini: bool = False


ALL_VARS: list[EnvVar] = [
    EnvVar("SUPABASE_URL", "Supabase project URL", required_for_supabase=True),
    EnvVar("SUPABASE_SERVICE_KEY", "Supabase service role key", required_for_supabase=True),
    EnvVar("GEMINI_API_KEY", "Google Gemini API key", required_for_gemini=True),
]


def validate_env(
    require_supabase: bool = False,
    require_gemini: bool = False,
    fatal: bool = True,
) -> list[str]:
    """
    Check required environment variables and report any that are missing.

    Args:
        require_supabase: If True, treat Supabase vars as required.
        require_gemini: If True, treat Gemini vars as required.
        fatal: If True, sys.exit(1) on missing required vars. Otherwise just logs.

    Returns:
        List of missing variable names.
    """
    missing: list[str] = []

    for var in ALL_VARS:
        if var.required_for_supabase and not require_supabase:
            continue
        if var.required_for_gemini and not require_gemini:
            continue
        value = os.environ.get(var.key, "").strip()
        if not value:
            missing.append(var.key)

    if missing:
        border = "=" * 58
        lines = [
            "",
            border,
            "  MISSING REQUIRED ENVIRONMENT VARIABLES",
            border,
        ]
        for key in missing:
            desc = next((v.description for v in ALL_VARS if v.key == key), "")
            lines.append(f"  • {key}  —  {desc}")
        lines += [
            "",
            "  Add these to your .env file or environment.",
            border,
            "",
        ]
        print("\n".join(lines), file=sys.stderr)

        if fatal:
            sys.exit(1)

    return missing


def validate_supabase_env(fatal: bool = True) -> list[str]:
    """Validate Supabase-specific environment variables."""
    return validate_env(require_supabase=True, fatal=fatal)


def validate_gemini_env(fatal: bool = True) -> list[str]:
    """Validate Gemini-specific environment variables."""
    return validate_env(require_gemini=True, fatal=fatal)
