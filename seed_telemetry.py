#!/usr/bin/env python3
"""Generates fabricated historical telemetry for previous dates (10M - 40M tokens/day).

Can either:
1. Write directly to the local data/ ledger using UsageStore (--direct).
2. Send OTLP/JSON batches over HTTP to /v1/traces (--endpoint).
"""
import argparse
import json
import os
import random
import secrets
from datetime import datetime, timezone
import urllib.request

from pricing import PriceBook
from parser import parse_spans
from store import UsageStore
from user_mapping import TEAM_GITHUB_USERS

AGENTS = [
    "a1.1-product-discovery",
    "a2.1-requirements-discovery",
    "a4.1-architecture-context",
    "a5.1-test-strategy",
    "a6.2-software-engineer",
    "b1.1-tibco-extraction",
    "b3.1-swing-decomposition-analysis",
    "d1.1-automated-data-engineering",
    "copilot-chat",
]

MODELS = [
    ("gpt-4o", "gpt-4o-2024-08-06"),
    ("gpt-4o-mini", "gpt-4o-mini-2024-07-18"),
    ("claude-3-5-sonnet", "claude-3-5-sonnet-20241022"),
    ("gpt-6-luna", "gpt-6-luna"),
]

PRIMARY_USERS = [
    "san-bha",
    "Yaswanth77545",
    "azhar909290",
    "HarshaSivakumar",
    "ChandruM56",
    "seshadrisastrykvss",
    "rajasekar1809",
    "Hariharan07082002",
]
SECONDARY_USERS = [
    u for u in TEAM_GITHUB_USERS if u not in PRIMARY_USERS
]


def _attribute(key: str, val):
    if isinstance(val, int):
        return {"key": key, "value": {"intValue": str(val)}}
    return {"key": key, "value": {"stringValue": str(val)}}


def generate_trace_payload(user: str, agent: str, req_model: str, resp_model: str,
                           input_tokens: int, output_tokens: int,
                           timestamp_dt: datetime) -> dict:
    trace_id = secrets.token_hex(16)
    span_id = secrets.token_hex(8)
    start_ns = int(timestamp_dt.timestamp() * 1e9)
    latency_ms = random.randint(1200, 4800)
    end_ns = start_ns + int(latency_ms * 1e6)

    return {
        "resourceSpans": [
            {
                "resource": {
                    "attributes": [
                        _attribute("service.name", "copilot-chat"),
                        _attribute("user.name", user),
                    ]
                },
                "scopeSpans": [
                    {
                        "spans": [
                            {
                                "traceId": trace_id,
                                "spanId": span_id,
                                "startTimeUnixNano": str(start_ns),
                                "endTimeUnixNano": str(end_ns),
                                "attributes": [
                                    _attribute("gen_ai.operation.name", "chat"),
                                    _attribute("gen_ai.agent.name", agent),
                                    _attribute("gen_ai.request.model", req_model),
                                    _attribute("gen_ai.response.model", resp_model),
                                    _attribute("gen_ai.usage.input_tokens", input_tokens),
                                    _attribute("gen_ai.usage.output_tokens", output_tokens),
                                ],
                            }
                        ]
                    }
                ],
            }
        ]
    }


def build_scaled_historical_batches(
    days_back: int = 6,
    min_tokens: int = 16_000_000,
    max_tokens: int = 36_000_000,
) -> tuple[list[dict], dict[str, int]]:
    """Builds spans targeting 10M-40M tokens for each day from (today - days_back) to (today - 1)."""
    batches = []
    daily_plan = {}
    anchor_dt = datetime(2026, 10, 28, 12, 0, 0, tzinfo=timezone.utc)

    # Generate for days_back down to 1 (yesterday)
    # Today (d=0) already has 48M on the remote server
    for d in range(days_back, 0, -1):
        day_date = anchor_dt.day - d
        target_tokens = random.randint(min_tokens, max_tokens)
        accumulated_tokens = 0
        date_str = f"2026-10-{day_date:02d}"

        # Generate calls until target is reached (~25-35 calls)
        call_idx = 0
        while accumulated_tokens < target_tokens:
            call_idx += 1
            if random.random() < 0.72:
                user = random.choice(PRIMARY_USERS)
            else:
                user = random.choice(SECONDARY_USERS)

            agent = random.choice(AGENTS)
            req_model, resp_model = random.choice(MODELS)

            remaining = target_tokens - accumulated_tokens
            if remaining < 400_000:
                inp = remaining
            else:
                inp = random.randint(450_000, min(1_500_000, remaining + 50_000))

            out = random.randint(3_000, 22_000)
            accumulated_tokens += inp + out

            # Spread calls across the working hours
            hour = 8 + int((call_idx / 35.0) * 11) % 12
            minute = random.randint(0, 59)
            second = random.randint(0, 59)
            call_dt = datetime(2026, 10, day_date, hour, minute, second, tzinfo=timezone.utc)

            payload = generate_trace_payload(
                user=user,
                agent=agent,
                req_model=req_model,
                resp_model=resp_model,
                input_tokens=inp,
                output_tokens=out,
                timestamp_dt=call_dt,
            )
            batches.append(payload)

        daily_plan[date_str] = accumulated_tokens

    return batches, daily_plan


def main():
    parser = argparse.ArgumentParser(description="Seed 10M-40M tokens/day historical Copilot usage.")
    parser.add_argument(
        "--endpoint",
        default=os.getenv("OTLP_ENDPOINT", "https://otel-data-h3f2g0fqgrc4e6bn.westindia-01.azurewebsites.net"),
        help="Target endpoint base URL (default: Azure App Service URL or OTLP_ENDPOINT env)",
    )
    parser.add_argument(
        "--direct",
        action="store_true",
        help="Directly write events into data/ without HTTP.",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=6,
        help="Number of previous days to generate (default: 6, representing Oct 22 to Oct 27).",
    )
    parser.add_argument(
        "--min-tokens",
        type=int,
        default=18_000_000,
        help="Minimum target tokens per day (default: 18M).",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=36_000_000,
        help="Maximum target tokens per day (default: 36M).",
    )
    args = parser.parse_args()

    batches, plan = build_scaled_historical_batches(
        days_back=args.days,
        min_tokens=args.min_tokens,
        max_tokens=args.max_tokens,
    )

    print("--- TARGET DAILY TOKENS PLAN ---")
    for date_str, tokens in plan.items():
        print(f"  {date_str}: {tokens:,} tokens (~{tokens / 1e6:.1f}M)")

    print(f"\nTotal batches to push: {len(batches)}")

    if args.direct:
        price_book = PriceBook()
        store = UsageStore("data")
        total_added = 0
        for payload in batches:
            events = parse_spans(payload, price_book)
            added = store.add_events(events)
            total_added += added
        print(f"Successfully wrote {total_added} events directly to data/events.jsonl and data/daily_usage.csv!")
        return

    # HTTP Push mode
    endpoint = args.endpoint.rstrip("/")
    url = f"{endpoint}/v1/traces"
    print(f"Pushing batches to {url} ...")

    success_count = 0
    fail_count = 0

    for idx, payload in enumerate(batches, 1):
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status == 200:
                    success_count += 1
                else:
                    fail_count += 1
        except Exception as err:
            fail_count += 1
            if idx <= 3:
                print(f"  Batch {idx} failed: {err}")

        if idx % 25 == 0 or idx == len(batches):
            print(f"  Progress: {idx}/{len(batches)} (Success: {success_count}, Failed: {fail_count})")

    print(f"\nFinished! Total sent: {success_count} succeeded, {fail_count} failed.")


if __name__ == "__main__":
    main()
