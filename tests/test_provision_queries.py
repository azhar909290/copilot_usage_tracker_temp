from unittest.mock import Mock

import pytest

from tracker import queries
from tracker.config import Settings
from tracker.provision import ProvisionError, Provisioner, dcr_body, table_body
from tracker.schema import CALLS, IDENTITY

WS = ("/subscriptions/sub1/resourceGroups/rg1/providers/"
      "Microsoft.OperationalInsights/workspaces/ws1")


def test_table_and_dcr_bodies():
    body = table_body(CALLS, 90)["properties"]
    assert body["schema"]["name"] == "CopilotLlmCalls_CL" and body["retentionInDays"] == 90
    assert {"name": "TimeGenerated", "type": "dateTime"} in body["schema"]["columns"]
    dcr = dcr_body("westindia", WS)
    assert dcr["kind"] == "Direct"
    decl = dcr["properties"]["streamDeclarations"]
    # TimeGenerated is added by the transform, so clients never send it.
    assert all(c["name"] != "TimeGenerated" for c in decl["Custom-CopilotIdentity_CL"]["columns"])
    assert {f["outputStream"] for f in dcr["properties"]["dataFlows"]} == {
        CALLS.stream, IDENTITY.stream}


def test_provisioner_creates_tables_then_dcr_and_returns_ingest_settings():
    calls = []

    def request(method, url, params=None, json=None, headers=None, timeout=None):
        calls.append((method, url.split("management.azure.com")[1]))
        response = Mock(status_code=200, content=b"x")
        path = url.lower()
        if method == "GET" and path.endswith("/workspaces/ws1"):
            response.json.return_value = {"location": "westindia", "properties": {"customerId": "guid"}}
        elif "/tables/" in path:
            response.json.return_value = {"properties": {"provisioningState": "Succeeded"}}
        else:
            response.json.return_value = {
                "id": "/dcr/id",
                "properties": {"immutableId": "dcr-abc", "endpoints": {"logsIngestion": "https://x.ingest"}}}
        return response

    http = Mock(request=request)
    out = Provisioner(Settings(workspace_resource_id=WS), session=http, token="t").run()
    assert (out.workspace_id, out.dcr_immutable_id, out.ingestion_endpoint) == (
        "guid", "dcr-abc", "https://x.ingest")
    puts = [p for m, p in calls if m == "PUT"]
    assert [p.rsplit("/", 1)[1] for p in puts] == [
        "CopilotLlmCalls_CL", "CopilotIdentity_CL", "copilot-usage-dcr"]


def test_provisioner_rejects_bad_resource_id_and_http_errors():
    with pytest.raises(ProvisionError):
        Provisioner(Settings(workspace_resource_id="nope"))
    http = Mock(request=Mock(return_value=Mock(status_code=403, text="forbidden", content=b"x")))
    with pytest.raises(ProvisionError, match="403"):
        Provisioner(Settings(workspace_resource_id=WS), session=http, token="t").run()


def test_kql_binds_identity_at_read_time_and_dedupes():
    kql = queries.daily_usage(30, "UTC")
    assert "arg_min(TimeGenerated, *) by CallKey" in kql
    assert "TTier == 2" in kql and "STier == 2" in kql
    assert "process.user" not in kql
    assert "datetime_utc_to_local" not in kql
    assert "datetime_utc_to_local(EventTime, 'Asia/Kolkata')" in queries.daily_usage(30, "Asia/Kolkata")
    assert "top 50 by EventTime desc" in queries.recent_events(7, 50, "UTC")
    assert "{" not in kql and "ago(37d)" in kql


def test_timezone_must_be_a_real_zone():
    from tracker.config import _timezone

    assert _timezone("Asia/Kolkata") == "Asia/Kolkata"
    for bad in ("x'); drop table", "Not/AZone"):
        with pytest.raises(Exception):
            _timezone(bad)
