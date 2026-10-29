"""GitHub username extraction from OTLP attributes.

The only trusted source is the identity attributes Copilot itself emits (``user.name``
by default). We never guess from file paths, prompts, ``process.user.name`` or host
names, and we never remap aliases: a value is either a valid GitHub login or it is
not an identity. Case is folded only for grouping (``UserKey``); GitHub logins are
case-insensitive, so ``ChandruM56`` and ``chandrum56`` are the same person.
"""
import re
from collections import Counter
from typing import Mapping

# 1-39 chars, alphanumeric or hyphen (EMU accounts also use "_" before the shortcode).
LOGIN_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,37}[A-Za-z0-9])?$")
PLACEHOLDERS = frozenset(
    {"unknown", "none", "null", "undefined", "anonymous", "n/a", "na", "default", "root", "system"}
)


class IdentityStats:
    """Counts rejected identity values by reason (no raw values kept: they may be PII)."""

    def __init__(self) -> None:
        self.rejected: Counter[str] = Counter()
        self.accepted = 0

    def snapshot(self) -> dict:
        return {"accepted": self.accepted, "rejected": dict(self.rejected)}


STATS = IdentityStats()


def normalize_login(raw: object) -> tuple[str, str] | None:
    """Return ``(login, user_key)`` for a valid GitHub login, else None."""
    if raw is None:
        return None
    value = str(raw).strip().lstrip("@")
    if not value:
        return None
    reason = None
    if value.lower() in PLACEHOLDERS:
        reason = "placeholder"
    elif "@" in value:
        reason = "email"
    elif value.isdigit():
        reason = "numeric"
    elif not LOGIN_PATTERN.match(value):
        reason = "not_a_github_login"
    if reason:
        STATS.rejected[reason] += 1
        return None
    STATS.accepted += 1
    return value, value.lower()


def extract_login(
    attributes: Mapping[str, object], keys: tuple[str, ...]
) -> tuple[str, str, str] | None:
    """Return ``(login, user_key, source_attribute)`` from the first valid identity key."""
    for key in keys:
        found = normalize_login(attributes.get(key))
        if found:
            return found[0], found[1], key
    return None
