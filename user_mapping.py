"""User identity normalization and alias mapping.

Maps corporate OS usernames, employee IDs, and case variants to canonical GitHub handles.
Supports dynamic overrides via USER_MAPPINGS environment variable (JSON object).
"""
import json
import os
import re

# File extensions that should never be treated as usernames (e.g. HomePage.tsx)
FILE_EXTENSION_PATTERN = re.compile(
    r"\.(?:tsx?|jsx?|py|json|html?|css|md|txt|ya?ml|c|cpp|h|java|cs|go|rs|rb|php|sh|bat|cmd|xml|sql)$",
    re.IGNORECASE,
)

IGNORED_USERS = {
    "root",
    "daemon",
    "nobody",
    "runner",
    "system",
    "administrator",
    "admin",
    "service",
    "public",
    "default",
    "shared",
    "local-os-user",
    "unknown",
}

# Canonical team GitHub accounts
TEAM_GITHUB_USERS = [
    "AnirudhTrivedi",
    "azhagesan",
    "yedukrishnan",
    "anishkgeorge",
    "ar-arunkumar",
    "Ashik1598753",
    "azhar909290",
    "Beaulah10",
    "chaitanyakarra1",
    "ChandruM56",
    "codebyjay",
    "ESavitha",
    "eswarasai-25",
    "Ganeshkumar-Balu",
    "gnaneeshwar-a-d",
    "gokulkv2003",
    "guna2sam",
    "gunasekart",
    "Hariharan07082002",
    "HarshaSivakumar",
    "Keerthana-purushothaman",
    "Kumaravel-V10",
    "njpp",
    "parth-bisht-tcs",
    "rajasekar1809",
    "rajeshwarinarasimhan",
    "RamyaMurugan-tcs",
    "rishi-tcs",
    "san-bha",
    "Sanjay-Kumar-S-3",
    "seshadrisastrykvss",
    "shanmugajaganathan",
    "Skamalesh16",
    "Srivatsan133",
    "tcs-dineshsharma",
    "Vikas1610-S",
    "Yaswanth77545",
]

# Explicit alias / employee ID / OS login -> canonical GitHub account
DEFAULT_USER_MAPPINGS = {
    "azharudeens": "azhar909290",
    "EswaraGollangi": "eswarasai-25",
    "2860041": "eswarasai-25",
    "2734450": "azhagesan",
    "2722102": "yedukrishnan",
    "chandru": "ChandruM56",
    "2869784": "Hariharan07082002",
    "2862531": "Ashik1598753",
    "2584949": "Skamalesh16",
    "2814343": "parth-bisht-tcs",
    "rajasekars": "rajasekar1809",
    "125191": "san-bha",
    "kvssseshadrisastry": "seshadrisastrykvss",
    "saimaniyaswanthrejet": "Yaswanth77545",
    "alex.novak": "san-bha",
    "ananya.sharma": "Yaswanth77545",
    "carlos.mendez": "azhar909290",
    "david.kim": "HarshaSivakumar",
    "elena.rostova": "ChandruM56",
    "jordan.taylor": "seshadrisastrykvss",
    "lisa.wong": "rajasekar1809",
    "marcus.vance": "Hariharan07082002",
    "KeerthanaP": "Keerthana-purushothaman",
    "rachel.adams": "RamyaMurugan-tcs",
    "samuel.green": "Ganeshkumar-Balu",
    "sarah.chen": "Sanjay-Kumar-S-3",
    "GnaneeshwarAariDamod": "gnaneeshwar-a-d",
}


def _build_lookup_map() -> dict[str, str]:
    lookup = {}
    # Self-map canonical users (case-insensitively)
    for u in TEAM_GITHUB_USERS:
        clean = u.strip()
        lookup[clean.lower()] = clean

    # Map known aliases and employee IDs
    for alias, canonical in DEFAULT_USER_MAPPINGS.items():
        lookup[alias.strip().lower()] = canonical.strip()

    # Dynamic overrides from environment variable (JSON format e.g. {"2722102": "username"})
    env_str = os.getenv("USER_MAPPINGS", "").strip()
    if env_str:
        try:
            custom = json.loads(env_str)
            if isinstance(custom, dict):
                for k, v in custom.items():
                    if isinstance(k, str) and isinstance(v, str):
                        lookup[k.strip().lower()] = v.strip()
        except Exception:
            pass

    return lookup


_LOOKUP_MAP = _build_lookup_map()


def reload_mappings() -> None:
    """Reload mapping table (useful after changing environment variables)."""
    global _LOOKUP_MAP
    _LOOKUP_MAP = _build_lookup_map()


def normalize_user(raw_user: str | None) -> str | None:
    """Normalize a username to its canonical GitHub handle.

    Returns None if the value is empty, an ignored system username, or a filename.
    """
    if not raw_user:
        return None
    val = str(raw_user).strip()
    if not val or len(val) < 2:
        return None

    lower_val = val.lower()
    if lower_val in IGNORED_USERS or lower_val == "unknown":
        return None

    # Discard file names (e.g. HomePage.tsx, index.ts, etc.)
    if FILE_EXTENSION_PATTERN.search(val):
        return None

    # Return mapped canonical name if recognized, else preserve original string
    return _LOOKUP_MAP.get(lower_val, val)
