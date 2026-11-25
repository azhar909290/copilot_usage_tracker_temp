"""Print daily cost per day / agent / model from data/daily_usage.csv."""
import csv
import sys
from collections import defaultdict

path = sys.argv[1] if len(sys.argv) > 1 else "data/daily_usage.csv"
by_day = defaultdict(float)
by_agent = defaultdict(float)
with open(path, newline="", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))
for r in rows:
    by_day[r["date"]] += float(r["cost"])
    by_agent[(r["date"], r["agent"], r["model"])] += float(r["cost"])
for d in sorted(by_day):
    print(f"{d}  total ${by_day[d]:.4f}")
    for (dd, agent, model), c in sorted(by_agent.items()):
        if dd == d:
            print(f"    {agent:<28} {model:<28} ${c:.4f}")
