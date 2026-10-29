"""Environment-driven settings."""
import os
import re
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo

_TZ_PATTERN = re.compile(r"^[A-Za-z0-9_+\-/]{1,64}$")


def _int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


def _float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    return float(raw) if raw else default


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    return default if not raw else raw in {"1", "true", "yes", "on"}


def _list(name: str, default: str) -> tuple[str, ...]:
    return tuple(p.strip() for p in os.getenv(name, default).split(",") if p.strip())


def _timezone(name: str) -> str:
    # The name is interpolated into KQL, so it must be a real IANA zone.
    value = name.strip() or "UTC"
    if not _TZ_PATTERN.match(value):
        raise ValueError(f"Invalid DAILY_TZ: {value!r}")
    ZoneInfo(value)
    return value


@dataclass(frozen=True)
class Settings:
    # Azure targets. Provisioning needs the ARM id; runtime needs the other three.
    workspace_resource_id: str = ""
    location: str = ""
    workspace_id: str = ""
    ingestion_endpoint: str = ""
    dcr_immutable_id: str = ""
    auto_provision: bool = False
    retention_days: int = 90

    # Ingest path
    ingest_token: str = ""
    max_body_bytes: int = 8 * 1024 * 1024
    batch_rows: int = 1000
    flush_interval: float = 2.0
    max_pending_rows: int = 200_000
    upload_attempts: int = 5

    # Identity
    identity_attributes: tuple[str, ...] = ("user.name", "enduser.id", "user.id")
    skip_operations: tuple[str, ...] = ("invoke_agent",)

    # Read path
    daily_tz: str = "UTC"
    cache_ttl: float = 30.0
    query_timeout: float = 60.0
    default_days: int = 90
    max_days: int = 365
    events_limit: int = 1000
    max_events_limit: int = 10_000
    price_per_million: float = 0.99
    data_dir: str = "data"
    frontend_origins: tuple[str, ...] = field(
        default=("http://localhost:3000", "http://127.0.0.1:3000")
    )

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            workspace_resource_id=os.getenv("LOG_ANALYTICS_RESOURCE_ID", "").strip(),
            location=os.getenv("AZURE_LOCATION", "").strip(),
            workspace_id=os.getenv("LOG_ANALYTICS_WORKSPACE_ID", "").strip(),
            ingestion_endpoint=os.getenv("LOGS_INGESTION_ENDPOINT", "").strip(),
            dcr_immutable_id=os.getenv("DCR_IMMUTABLE_ID", "").strip(),
            auto_provision=_bool("AUTO_PROVISION", False),
            retention_days=_int("TABLE_RETENTION_DAYS", 90),
            ingest_token=os.getenv("INGEST_TOKEN", "").strip(),
            max_body_bytes=_int("MAX_BODY_BYTES", 8 * 1024 * 1024),
            batch_rows=_int("INGEST_BATCH_ROWS", 1000),
            flush_interval=_float("INGEST_FLUSH_SECONDS", 2.0),
            max_pending_rows=_int("INGEST_MAX_PENDING_ROWS", 200_000),
            upload_attempts=_int("INGEST_UPLOAD_ATTEMPTS", 5),
            identity_attributes=_list("IDENTITY_ATTRIBUTES", "user.name,enduser.id,user.id"),
            skip_operations=_list("SKIP_OPERATIONS", "invoke_agent"),
            daily_tz=_timezone(os.getenv("DAILY_TZ", "UTC")),
            cache_ttl=_float("CACHE_TTL_SECONDS", 30.0),
            query_timeout=_float("QUERY_TIMEOUT_SECONDS", 60.0),
            default_days=_int("DEFAULT_DAYS", 90),
            max_days=_int("MAX_DAYS", 365),
            events_limit=_int("EVENTS_LIMIT", 1000),
            max_events_limit=_int("MAX_EVENTS_LIMIT", 10_000),
            price_per_million=_float("PRICE_PER_MILLION", 0.99),
            data_dir=os.getenv("DATA_DIR", "data"),
            frontend_origins=_list(
                "FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
            ),
        )
