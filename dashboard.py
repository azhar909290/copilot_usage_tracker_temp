"""Dashboard for the usage receiver's daily aggregates."""
import os

import pandas as pd
import plotly.express as px
import requests
import streamlit as st

API = os.getenv("USAGE_API_URL", "http://127.0.0.1:4318").rstrip("/")
FIELDS = [
    "date", "user", "agent", "model", "requests", "input_tokens",
    "output_tokens", "cost", "unpriced_requests",
]
NUMERIC_FIELDS = FIELDS[4:]

st.set_page_config(page_title="Copilot Usage", layout="wide")
st.title("Copilot Usage")
days = st.sidebar.slider("History (days)", 1, 90, 30)
auto_refresh = st.sidebar.toggle("Auto-refresh", value=True)


@st.fragment(run_every="10s" if auto_refresh else None)
def usage_dashboard():
    st.button("Refresh", icon=":material/refresh:")
    try:
        response = requests.get(f"{API}/usage", timeout=5)
        response.raise_for_status()
        payload = response.json()
        currency = payload["currency"]
        usage = pd.DataFrame(payload["rows"], columns=FIELDS)
        usage["date"] = pd.to_datetime(usage["date"], errors="raise")
        for field in NUMERIC_FIELDS:
            usage[field] = pd.to_numeric(usage[field], errors="raise").fillna(0)
    except (requests.RequestException, ValueError, KeyError, TypeError) as error:
        st.error(f"Cannot load usage from {API}: {error}")
        st.code("python3 run.py", language="bash")
        return

    cutoff = pd.Timestamp.now(tz="UTC").normalize().tz_localize(None) - pd.Timedelta(days=days - 1)
    usage = usage.loc[usage["date"] >= cutoff].copy()
    if usage.empty:
        st.info("No recorded LLM usage in this period.")
        return

    user_filter, agent_filter, model_filter = st.columns(3)
    users = user_filter.multiselect("Users", sorted(usage["user"].unique()))
    agents = agent_filter.multiselect("Agents", sorted(usage["agent"].unique()))
    models = model_filter.multiselect("Models", sorted(usage["model"].unique()))
    for field, selected in [("user", users), ("agent", agents), ("model", models)]:
        if selected:
            usage = usage.loc[usage[field].isin(selected)]
    if usage.empty:
        st.info("No usage matches these filters.")
        return

    totals = usage[NUMERIC_FIELDS].sum()
    metrics = st.columns(3)
    metrics[0].metric("LLM calls", f"{int(totals['requests']):,}")
    metrics[1].metric("Input tokens", f"{int(totals['input_tokens']):,}")
    metrics[2].metric("Output tokens", f"{int(totals['output_tokens']):,}")
    metrics = st.columns(3)
    metrics[0].metric("Total tokens", f"{int(totals['input_tokens'] + totals['output_tokens']):,}")
    metrics[1].metric(f"Estimated cost ({currency})", f"{totals['cost']:,.6f}")
    metrics[2].metric("Unpriced calls", f"{int(totals['unpriced_requests']):,}")
    st.caption("Costs use configured model rates, not your Copilot invoice.")
    if totals["unpriced_requests"]:
        st.warning("Some models have no configured price; their cost is recorded as zero.")

    st.divider()
    daily = usage.groupby("date", as_index=False)[NUMERIC_FIELDS].sum()
    left, right = st.columns(2)
    with left:
        st.plotly_chart(
            px.bar(daily, x="date", y=["input_tokens", "output_tokens"],
                   title="Daily token usage", barmode="group",
                   color_discrete_sequence=["#168579", "#dd5471"]),
            width="stretch",
        )
    with right:
        st.plotly_chart(
            px.line(daily, x="date", y="requests", markers=True,
                    title="LLM calls per day", color_discrete_sequence=["#168579"]),
            width="stretch",
        )

    st.subheader("Model usage")
    by_model = usage.groupby("model", as_index=False)[NUMERIC_FIELDS].sum()
    by_model["total_tokens"] = by_model["input_tokens"] + by_model["output_tokens"]
    st.dataframe(by_model.sort_values("requests", ascending=False),
                 width="stretch", hide_index=True)

    st.subheader("Agent usage")
    by_agent = usage.groupby("agent", as_index=False)[NUMERIC_FIELDS].sum()
    st.dataframe(by_agent.sort_values("requests", ascending=False),
                 width="stretch", hide_index=True)

    st.subheader("Daily usage")
    display = usage.sort_values(["date", "agent", "model"], ascending=[False, True, True]).copy()
    display["date"] = display["date"].dt.strftime("%Y-%m-%d")
    st.dataframe(display, width="stretch", hide_index=True)
    st.download_button("Download CSV", display.to_csv(index=False),
                       file_name="copilot_usage.csv", mime="text/csv",
                       icon=":material/download:")


usage_dashboard()