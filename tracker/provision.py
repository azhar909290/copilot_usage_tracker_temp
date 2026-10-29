"""Idempotently create the custom tables and Data Collection Rule in Azure.

Run once (``python -m tracker.provision``) or set AUTO_PROVISION=true to run at startup.
Needs Contributor on the workspace's resource group. Safe to re-run: every call is a PUT.

Ingestion additionally requires the app's identity to hold "Monitoring Metrics Publisher"
on the DCR, and queries require "Log Analytics Reader" on the workspace. Role assignment
is deliberately not automated here; the CLI prints the exact commands.
"""
import logging
import re
import time
from dataclasses import dataclass

import requests

from .config import Settings
from .schema import DCR_NAME, TABLES, Table

log = logging.getLogger("usage.provision")

ARM = "https://management.azure.com"
TABLE_API = "2022-10-01"
DCR_API = "2023-03-11"
WORKSPACE_API = "2022-10-01"
_RESOURCE_ID = re.compile(
    r"^/subscriptions/([^/]+)/resourcegroups/([^/]+)/providers/microsoft\.operationalinsights/workspaces/([^/]+)$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Resolved:
    workspace_id: str
    ingestion_endpoint: str
    dcr_immutable_id: str
    dcr_resource_id: str


class ProvisionError(RuntimeError):
    pass


def _table_type(t: str) -> str:
    return "dateTime" if t == "datetime" else t


def table_body(table: Table, retention_days: int) -> dict:
    return {
        "properties": {
            "schema": {
                "name": table.name,
                "columns": [
                    {"name": n, "type": _table_type(t)} for n, t in table.columns
                ],
            },
            "retentionInDays": retention_days,
            "totalRetentionInDays": retention_days,
        }
    }


def dcr_body(location: str, workspace_resource_id: str) -> dict:
    return {
        "location": location,
        "kind": "Direct",
        "properties": {
            "streamDeclarations": {
                t.stream: {"columns": t.input_columns} for t in TABLES
            },
            "destinations": {
                "logAnalytics": [
                    {"workspaceResourceId": workspace_resource_id, "name": "workspace"}
                ]
            },
            "dataFlows": [
                {
                    "streams": [t.stream],
                    "destinations": ["workspace"],
                    "transformKql": "source | extend TimeGenerated = now()",
                    "outputStream": t.stream,
                }
                for t in TABLES
            ],
        },
    }


class Provisioner:
    def __init__(self, settings: Settings, session: requests.Session | None = None, token=None):
        match = _RESOURCE_ID.match(settings.workspace_resource_id)
        if not match:
            raise ProvisionError(
                "LOG_ANALYTICS_RESOURCE_ID must look like /subscriptions/<id>/resourceGroups/<rg>"
                "/providers/Microsoft.OperationalInsights/workspaces/<name>"
            )
        self.settings = settings
        self.workspace = settings.workspace_resource_id
        self.subscription, self.resource_group, _ = match.groups()
        self.http = session or requests.Session()
        self._token = token

    def _headers(self) -> dict:
        if self._token is None:
            from azure.identity import DefaultAzureCredential

            self._token = DefaultAzureCredential().get_token(f"{ARM}/.default").token
        return {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}

    def _call(self, method: str, path: str, api: str, body: dict | None = None) -> dict:
        response = self.http.request(
            method, f"{ARM}{path}", params={"api-version": api}, json=body,
            headers=self._headers(), timeout=60,
        )
        if response.status_code >= 300:
            raise ProvisionError(f"{method} {path} -> {response.status_code}: {response.text[:500]}")
        return response.json() if response.content else {}

    def _wait_for_table(self, table: Table, timeout: float = 180.0) -> None:
        path = f"{self.workspace}/tables/{table.name}"
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            state = self._call("GET", path, TABLE_API).get("properties", {}).get("provisioningState")
            if state == "Succeeded":
                return
            if state == "Failed":
                raise ProvisionError(f"table {table.name} provisioning failed")
            time.sleep(3)
        raise ProvisionError(f"table {table.name} not ready after {timeout:.0f}s")

    def run(self) -> Resolved:
        workspace = self._call("GET", self.workspace, WORKSPACE_API)
        location = self.settings.location or workspace["location"]
        customer_id = workspace["properties"]["customerId"]

        for table in TABLES:
            self._call(
                "PUT", f"{self.workspace}/tables/{table.name}", TABLE_API,
                table_body(table, self.settings.retention_days),
            )
            self._wait_for_table(table)
            log.info("table %s ready", table.name)

        dcr_path = (
            f"/subscriptions/{self.subscription}/resourceGroups/{self.resource_group}"
            f"/providers/Microsoft.Insights/dataCollectionRules/{DCR_NAME}"
        )
        dcr = self._call("PUT", dcr_path, DCR_API, dcr_body(location, self.workspace))
        props = dcr.get("properties", {})
        endpoint = (
            self.settings.ingestion_endpoint
            or props.get("endpoints", {}).get("logsIngestion")
        )
        if not endpoint or not props.get("immutableId"):
            raise ProvisionError(
                "DCR created without an ingestion endpoint; set LOGS_INGESTION_ENDPOINT "
                "to a Data Collection Endpoint URL and re-run"
            )
        log.info("DCR %s ready", DCR_NAME)
        return Resolved(customer_id, endpoint, props["immutableId"], dcr["id"])


def main() -> None:
    from dotenv import load_dotenv

    load_dotenv()
    logging.basicConfig(level=logging.INFO)
    resolved = Provisioner(Settings.from_env()).run()
    print("\nAdd to your environment:")
    print(f"LOG_ANALYTICS_WORKSPACE_ID={resolved.workspace_id}")
    print(f"LOGS_INGESTION_ENDPOINT={resolved.ingestion_endpoint}")
    print(f"DCR_IMMUTABLE_ID={resolved.dcr_immutable_id}")
    print("\nGrant the app identity (replace <principal-id>):")
    print(
        "az role assignment create --assignee <principal-id> "
        f'--role "Monitoring Metrics Publisher" --scope {resolved.dcr_resource_id}'
    )
    print(
        "az role assignment create --assignee <principal-id> "
        '--role "Log Analytics Reader" --scope <LOG_ANALYTICS_RESOURCE_ID>'
    )


if __name__ == "__main__":
    main()
