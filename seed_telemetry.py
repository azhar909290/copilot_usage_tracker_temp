#!/usr/bin/env python3
"""Generates FABRICATED historical telemetry (10M - 40M tokens/day) for demos.

Sends OTLP/JSON to /v1/traces. Everything sent lands in the Log Analytics tables, so
point --endpoint at a non-production receiver. As in real Copilot traffic, each trace
is sent as an LLM call without identity, then the agent invocation span carrying
``user.name`` in a later request.
"""
import argparse
import json
import os
import random
import secrets
from datetime import datetime, timezone
import urllib.request

TEAM_GITHUB_USERS = [
    "AnirudhTrivedi", "anishkgeorge", "ar-arunkumar", "Ashik1598753", "azhar909290",
    "Beaulah10", "chaitanyakarra1", "ChandruM56", "codebyjay", "ESavitha", "eswarasai-25",
    "Ganeshkumar-Balu", "gnaneeshwar-a-d", "gokulkv2003", "guna2sam", "gunasekart",
    "Hariharan07082002", "HarshaSivakumar", "Keerthana-purushothaman", "Kumaravel-V10",
    "njpp", "parth-bisht-tcs", "rajasekar1809", "rajeshwarinarasimhan", "RamyaMurugan-tcs",
    "rishi-tcs", "san-bha", "Sanjay-Kumar-S-3", "seshadrisastrykvss", "shanmugajaganathan",
    "Skamalesh16", "Srivatsan133", "tcs-dineshsharma", "Vikas1610-S", "Yaswanth77545",
]

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


def generate_trace_payloads(user: str, agent: str, req_model: str, resp_model: str,
                            input_tokens: int, output_tokens: int,
                            timestamp_dt: datetime) -> list[dict]:
    """[LLM-call payload without identity, agent-invocation payload with user.name]."""
    trace_id = secrets.token_hex(16)
    root_id = secrets.token_hex(8)
    start_ns = int(timestamp_dt.timestamp() * 1e9)
    end_ns = start_ns + int(random.randint(1200, 4800) * 1e6)

    def payload(span: dict) -> dict:
        return {"resourceSpans": [{
            "resource": {"attributes": [_attribute("service.name", "copilot-chat")]},
            "scopeSpans": [{"spans": [span]}],
        }]}

    call = {
        "traceId": trace_id, "spanId": secrets.token_hex(8), "parentSpanId": root_id,
        "startTimeUnixNano": str(start_ns), "endTimeUnixNano": str(end_ns),
        "attributes": [
            _attribute("gen_ai.operation.name", "chat"),
            _attribute("gen_ai.agent.name", agent),
            _attribute("gen_ai.request.model", req_model),
            _attribute("gen_ai.response.model", resp_model),
            _attribute("gen_ai.usage.input_tokens", input_tokens),
            _attribute("gen_ai.usage.output_tokens", output_tokens),
        ],
    }
    invocation = {
        "traceId": trace_id, "spanId": root_id,
        "startTimeUnixNano": str(start_ns), "endTimeUnixNano": str(end_ns + 1_000_000),
        "attributes": [
            _attribute("gen_ai.operation.name", "invoke_agent"),
            _attribute("gen_ai.agent.name", agent),
            _attribute("user.name", user),
        ],
    }
    return [payload(call), payload(invocation)]


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

            payloads = generate_trace_payloads(
                user=user,
                agent=agent,
                req_model=req_model,
                resp_model=resp_model,
                input_tokens=inp,
                output_tokens=out,
                timestamp_dt=call_dt,
            )
            batches.extend(payloads)

        daily_plan[date_str] = accumulated_tokens

    return batches, daily_plan


def main():
    parser = argparse.ArgumentParser(description="Seed 10M-40M tokens/day historical Copilot usage.")
    parser.add_argument(
        "--endpoint",
        default=os.getenv("OTLP_ENDPOINT", "http://127.0.0.1:4318"),
        help="Receiver base URL (default: local, or OTLP_ENDPOINT env)",
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
