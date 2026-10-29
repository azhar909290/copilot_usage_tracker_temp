import json
from pathlib import Path

from tracker.arm import build_template


def test_template_is_in_sync_with_schema_and_valid():
    template = build_template()
    types = [r["type"] for r in template["resources"]]
    assert types.count("Microsoft.OperationalInsights/workspaces/tables") == 2
    dcr = next(r for r in template["resources"] if r["type"].endswith("dataCollectionRules"))
    assert dcr["kind"] == "Direct" and len(dcr["dependsOn"]) == 2
    assert set(template["outputs"]) == {
        "LOG_ANALYTICS_WORKSPACE_ID", "LOGS_INGESTION_ENDPOINT", "DCR_IMMUTABLE_ID"}
    # The workspace is not part of the template, so nothing may depend on or scope to it.
    text = json.dumps([r for r in template["resources"] if "workspaces/tables" not in r["type"]])
    assert "workspaces/'" not in text.replace("workspaceResourceId", "")
    roles = [r for r in template["resources"] if r["type"].endswith("roleAssignments")]
    assert len(roles) == 1 and "appPrincipalId" in roles[0]["condition"]
    assert roles[0]["scope"].startswith("[concat('Microsoft.Insights/dataCollectionRules/'")
    committed = Path(__file__).resolve().parent.parent / "infra" / "azuredeploy.json"
    assert json.loads(committed.read_text()) == template, "run: python -m tracker.arm"
