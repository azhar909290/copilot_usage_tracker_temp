"""Model price book loaded from prices.yaml (hot-reloaded when the file changes)."""
import os
import threading
from dataclasses import dataclass

import yaml


@dataclass(frozen=True)
class Price:
    input_per_million: float
    output_per_million: float


class PriceBook:
    def __init__(self, path: str):
        self.path = path
        self._mtime = 0.0
        self._lock = threading.Lock()
        self.currency = "USD"
        self.models: dict[str, Price] = {}
        self._load()

    def _load(self) -> None:
        with open(self.path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        self.currency = data.get("currency", "USD")
        self.models = {
            str(name).lower(): Price(
                float(v["input_per_million"]), float(v["output_per_million"])
            )
            for name, v in (data.get("models") or {}).items()
        }
        self._mtime = os.path.getmtime(self.path)

    def _refresh(self) -> None:
        try:
            if os.path.getmtime(self.path) != self._mtime:
                with self._lock:
                    self._load()
        except OSError:
            pass  # keep the last good prices

    def lookup(self, *names: str | None) -> tuple[str, Price] | None:
        """Return (matched_key, Price) for the first name that matches."""
        self._refresh()
        for name in names:
            if not name:
                continue
            n = name.lower()
            if n in self.models:
                return n, self.models[n]
            prefixes = [k for k in self.models if n.startswith(k)]
            if prefixes:
                best = max(prefixes, key=len)
                return best, self.models[best]
        return None

    def cost(self, names: list[str | None], input_tokens: int, output_tokens: int):
        """Return (matched_key | None, cost | None)."""
        hit = self.lookup(*names)
        if hit is None:
            return None, None
        key, p = hit
        c = (input_tokens * p.input_per_million + output_tokens * p.output_per_million) / 1_000_000
        return key, c
