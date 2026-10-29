"""ARM template for the portal: ``python -m tracker.arm`` writes infra/azuredeploy.json.

Same resources as ``tracker.provision`` (tables + Direct DCR), generated from the same
schema so the two can never drift, plus an optional Metrics Publisher role on the DCR for the app identity. The workspace is
assumed to exist outside the template, so "Log Analytics Reader" on it is assigned by hand.
Deploy via Azure portal > "Deploy a custom template" > "Build your own template in the editor".
"""
import json
from pathlib import Path

from .provision import DCR_API, TABLE_API, dcr_body, table_body
from .schema import DCR_NAME, TABLES

METRICS_PUBLISHER = "3913510d-42f4-4e42-8a64-420c93043f8e"
WORKSPACE_ID_EXPR = "[resourceId('Microsoft.OperationalInsights/workspaces', parameters('workspaceName'))]"
DCR_ID_EXPR = f"[resourceId('Microsoft.Insights/dataCollectionRules', '{DCR_NAME}')]"


def _role(name_seed: str, role_guid: str, scope_expr: str, depends_on: str) -> dict:
    return {
        "condition": "[not(empty(parameters('appPrincipalId')))]",
        "type": "Microsoft.Authorization/roleAssignments",
        "apiVersion": "2022-04-01",
        "scope": scope_expr,
        "name": f"[guid(parameters('appPrincipalId'), '{name_seed}', resourceGroup().id)]",
        "dependsOn": [depends_on],
        "properties": {
            "roleDefinitionId": f"[subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '{role_guid}')]",
            "principalId": "[parameters('appPrincipalId')]",
            "principalType": "ServicePrincipal",
        },
    }


def build_template() -> dict:
    resources = []
    for table in TABLES:
        body = table_body(table, 0)["properties"]
        body["retentionInDays"] = "[parameters('retentionDays')]"
        body["totalRetentionInDays"] = "[parameters('retentionDays')]"
        resources.append({
            "type": "Microsoft.OperationalInsights/workspaces/tables",
            "apiVersion": TABLE_API,
            "name": f"[format('{{0}}/{{1}}', parameters('workspaceName'), '{table.name}')]",
            "properties": body,
        })

    dcr = dcr_body("PLACEHOLDER", "PLACEHOLDER")
    dcr["location"] = "[parameters('location')]"
    dcr["properties"]["destinations"]["logAnalytics"][0]["workspaceResourceId"] = WORKSPACE_ID_EXPR
    resources.append({
        "type": "Microsoft.Insights/dataCollectionRules",
        "apiVersion": DCR_API,
        "name": DCR_NAME,
        "location": dcr["location"],
        "kind": "Direct",
        "dependsOn": [
            f"[resourceId('Microsoft.OperationalInsights/workspaces/tables', parameters('workspaceName'), '{t.name}')]"
            for t in TABLES
        ],
        "properties": dcr["properties"],
    })
    resources.append(_role("publisher", METRICS_PUBLISHER,
                          f"[concat('Microsoft.Insights/dataCollectionRules/', '{DCR_NAME}')]", DCR_ID_EXPR))

    return {
        "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        "contentVersion": "1.0.0.0",
        "parameters": {
            "workspaceName": {"type": "string", "metadata": {
                "description": "Existing Log Analytics workspace (must be in the resource group you deploy to)."}},
            "location": {"type": "string", "defaultValue": "[resourceGroup().location]", "metadata": {
                "description": "Must be the workspace's region."}},
            "retentionDays": {"type": "int", "defaultValue": 90, "minValue": 30, "maxValue": 730},
            "appPrincipalId": {"type": "string", "defaultValue": "", "metadata": {
                "description": "Object (principal) ID of the App Service's managed identity. "
                               "Leave empty to assign the roles yourself."}},
        },
        "resources": resources,
        "outputs": {
            "LOG_ANALYTICS_WORKSPACE_ID": {
                "type": "string",
                "value": f"[reference({WORKSPACE_ID_EXPR[1:-1]}, '2022-10-01').customerId]",
            },
            "LOGS_INGESTION_ENDPOINT": {
                "type": "string",
                "value": f"[reference({DCR_ID_EXPR[1:-1]}, '{DCR_API}').endpoints.logsIngestion]",
            },
            "DCR_IMMUTABLE_ID": {
                "type": "string",
                "value": f"[reference({DCR_ID_EXPR[1:-1]}, '{DCR_API}').immutableId]",
            },
        },
    }


def main() -> None:
    path = Path(__file__).resolve().parent.parent / "infra" / "azuredeploy.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(build_template(), indent=2) + "\n")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
