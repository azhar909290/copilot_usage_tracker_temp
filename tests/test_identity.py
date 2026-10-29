import pytest

from tracker.identity import STATS, extract_login, normalize_login


@pytest.mark.parametrize("raw,expected", [
    ("octocat", ("octocat", "octocat")),
    ("ChandruM56", ("ChandruM56", "chandrum56")),
    ("  @Azhar909290 ", ("Azhar909290", "azhar909290")),
    ("Keerthana-purushothaman", ("Keerthana-purushothaman", "keerthana-purushothaman")),
    ("jane_acme", ("jane_acme", "jane_acme")),  # enterprise managed user
])
def test_valid_logins(raw, expected):
    assert normalize_login(raw) == expected


@pytest.mark.parametrize("raw", [
    None, "", "  ", "unknown", "Unknown", "root",
    "2869784",              # employee id
    "alex.novak",           # OS / corporate style name
    "HomePage.tsx",         # file name
    "a@b.com",              # email
    "-leading", "trailing-", "x" * 40, "has space",
])
def test_invalid_values_are_not_identities(raw):
    assert normalize_login(raw) is None


def test_extract_uses_attribute_priority_and_skips_invalid():
    attrs = {"user.name": "alex.novak", "enduser.id": "octocat", "process.user.name": "azharudeens"}
    assert extract_login(attrs, ("user.name", "enduser.id", "user.id")) == (
        "octocat", "octocat", "enduser.id")


def test_os_user_is_never_an_identity():
    assert extract_login({"process.user.name": "azharudeens", "host.name": "laptop"},
                         ("user.name", "enduser.id", "user.id")) is None


def test_rejections_are_counted_without_values():
    before = STATS.rejected["email"]
    normalize_login("someone@example.com")
    assert STATS.rejected["email"] == before + 1
    assert "someone" not in str(STATS.snapshot())
