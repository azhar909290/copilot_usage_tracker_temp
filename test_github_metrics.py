import gzip
import json
import os
import socket
import threading
import time
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
import requests
import uvicorn

import server
from github_metrics import (
    API_VERSION, COUNTERS, MAX_REPORT_BYTES, GitHubMetrics, GitHubMetricsError,
    _decode_report, _summarize_organization, _summarize_users,
)


def counts(prompts=10):
    return dict(zip(COUNTERS, (prompts, 20, 5, 40, 2)))


def organization_records():
    return [{"day_totals": [{
        "day": "2026-10-10", "daily_active_users": 2, **counts(),
        "totals_by_model_feature": [
            {"model": "gpt-4.1", "feature": "chat_panel", **counts(4)},
            {"model": "gpt-4.1", "feature": "agent_edit", **counts(6)},
        ],
        "totals_by_feature": [{"feature": "chat_panel", **counts()}],
        "totals_by_language_model": [{"model": "gpt-4.1", **counts(10)}],
    }]}]


def user_records():
    return [{
        "user_id": 1, "user_login": "octocat", **counts(),
        "ai_credits_used": 1.5, "used_agent": True, "used_chat": False,
        "used_cli": True, "used_copilot_code_review_active": None,
    }, {"user_id": 2, "user_login": "hubot", **counts(0)}]


WINDOW = {"start": "2026-09-13", "end": "2026-10-10"}
ENV = {"GITHUB_METRICS_ORG": "example-org", "GITHUB_METRICS_TOKEN": "github-secret"}


class ReportTests(unittest.TestCase):
    def test_json_arrays_objects_ndjson_and_gzip(self):
        records = user_records()
        for content in (
            json.dumps(records).encode(),
            "\n".join(json.dumps(record) for record in records).encode(),
            gzip.compress(json.dumps(records).encode()),
        ):
            self.assertEqual(_decode_report(content), records)
        self.assertEqual(_decode_report(json.dumps(records[0]).encode()), [records[0]])
        self.assertEqual(_decode_report(b""), [])
        for content in (b"bad json", b"[1]", b'{"day_totals":'):
            with self.assertRaises(GitHubMetricsError):
                _decode_report(content)

    def test_gzip_expansion_limit(self):
        with self.assertRaisesRegex(GitHubMetricsError, "size limit"):
            _decode_report(gzip.compress(b" " * (MAX_REPORT_BYTES + 1)))

    def test_sums_each_model_feature_without_counting_other_dimensions(self):
        result = _summarize_organization(organization_records())
        self.assertEqual(result["totals"], counts())
        self.assertEqual(result["models"][0]["user_initiated_interaction_count"], 10)
        self.assertEqual(result["models"][0]["code_generation_activity_count"], 40)
        self.assertEqual(result["daily"][0]["daily_active_users"], 2)
        self.assertEqual(len(result["features"]), 1)

    def test_daily_counts_sorted_not_summed_into_unique_users(self):
        records = organization_records()
        other = dict(records[0]["day_totals"][0], day="2026-10-09")
        records[0]["day_totals"].append(other)
        result = _summarize_organization(records)
        self.assertEqual([day["day"] for day in result["daily"]],
                         ["2026-10-09", "2026-10-10"])
        self.assertNotIn("active_users", result["totals"])
        self.assertEqual(result["totals"]["user_initiated_interaction_count"], 20)

    def test_missing_and_invalid_fields_are_explicit_errors(self):
        for value in (None, -1, True, "10", float("nan")):
            records = organization_records()
            records[0]["day_totals"][0]["loc_added_sum"] = value
            with self.assertRaises(GitHubMetricsError):
                _summarize_organization(records)
        with self.assertRaisesRegex(GitHubMetricsError, "duplicate"):
            _summarize_organization(organization_records() * 2)
        with self.assertRaisesRegex(GitHubMetricsError, "duplicate"):
            _summarize_users(user_records() * 2)

    def test_users_have_stable_ids_and_optional_credits_are_not_zero(self):
        users = _summarize_users(user_records())
        self.assertEqual(users[0]["login"], "octocat")
        self.assertEqual(users[0]["id"], 1)
        self.assertEqual(users[0]["features"], ["IDE agent", "CLI"])
        self.assertEqual(users[0]["ai_credits_used"], 1.5)
        self.assertIsNone(users[1]["ai_credits_used"])
        self.assertEqual(users[1]["user_initiated_interaction_count"], 0)

    def test_daily_user_rows_are_aggregated_by_id_with_latest_alias(self):
        first = dict(user_records()[0], day="2026-10-09", used_cli=False)
        second = dict(first, day="2026-10-10", user_login="new-alias",
                      used_agent=False, used_cli=True, ai_credits_used=2)
        user = _summarize_users([second, first])[0]
        self.assertEqual(user["login"], "new-alias")
        self.assertEqual(user["user_initiated_interaction_count"], 20)
        self.assertEqual(user["loc_added_sum"], 80)
        self.assertEqual(user["ai_credits_used"], 3.5)
        self.assertEqual([day["day"] for day in user["daily_usage"]],
                         ["2026-10-10", "2026-10-09"])
        self.assertEqual(sum(day["ai_credits_used"] for day in user["daily_usage"]), 3.5)
        self.assertEqual(set(user["features"]), {"IDE agent", "CLI"})
        self.assertNotIn("_latest_day", user)
        with self.assertRaisesRegex(GitHubMetricsError, "duplicate"):
            _summarize_users([first, first])
        with self.assertRaisesRegex(GitHubMetricsError, "mixes"):
            _summarize_users([first, user_records()[0]])

    def test_missing_daily_credits_do_not_produce_a_partial_total(self):
        first = dict(user_records()[0], day="2026-10-09")
        second = dict(first, day="2026-10-10")
        del second["ai_credits_used"]
        user = _summarize_users([first, second])[0]
        self.assertIsNone(user["ai_credits_used"])
        self.assertIsNone(user["daily_usage"][0]["ai_credits_used"])
        self.assertEqual(user["daily_usage"][1]["ai_credits_used"], 1.5)

    def test_zero_credits_with_activity_are_preserved_not_estimated(self):
        records = [dict(user_records()[0], day="2026-10-09", ai_credits_used=0)]
        user = _summarize_users(records)[0]
        self.assertEqual(user["ai_credits_used"], 0)
        self.assertEqual(user["user_initiated_interaction_count"], 10)
        self.assertEqual(user["daily_usage"][0]["ai_credits_used"], 0)


class GitHubClientTests(unittest.TestCase):
    def test_api_headers_and_permission_errors_do_not_expose_credentials(self):
        client = GitHubMetrics()
        with patch("github_metrics.requests.get") as get:
            get.return_value = Mock(status_code=200)
            get.return_value.json.return_value = {"download_links": []}
            self.assertEqual(client._get_json("/orgs/test/copilot/metrics/reports/users-28-day/latest", "secret"),
                             {"download_links": []})
            self.assertEqual(get.call_args.kwargs["headers"]["X-GitHub-Api-Version"],
                             API_VERSION)
            self.assertEqual(get.call_args.kwargs["headers"]["Authorization"], "Bearer secret")
            self.assertFalse(get.call_args.kwargs["allow_redirects"])
            for status in (401, 403, 404, 429, 500):
                get.return_value.status_code = status
                with self.assertRaises(GitHubMetricsError) as failure:
                    client._get_json("/test", "secret")
                self.assertNotIn("secret", str(failure.exception))

    def test_download_signed_urls_without_authorization_or_redirects(self):
        response = Mock(status_code=200)
        response.iter_content.return_value = [json.dumps(user_records()).encode()]
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch("github_metrics.requests.get", return_value=response) as get:
            records = GitHubMetrics()._download(
                "https://reports.blob.core.windows.net/report?signature=secret",
            )
        self.assertEqual(records, user_records())
        self.assertNotIn("headers", get.call_args.kwargs)
        self.assertFalse(get.call_args.kwargs["allow_redirects"])

    def test_untrusted_download_urls_are_rejected_before_request(self):
        for url in (
            "http://reports.blob.core.windows.net/report", "https://localhost/report",
            "https://reports.blob.core.windows.net.evil.test/report",
            "https://user:pass@reports.blob.core.windows.net/report",
            "https://reports.blob.core.windows.net:1234/report",
            "https://copilot-reports.github.com.evil.test/report",
        ):
            with patch("github_metrics.requests.get") as get:
                with self.assertRaises(GitHubMetricsError):
                    GitHubMetrics()._download(url)
                get.assert_not_called()

    def test_github_copilot_report_host_is_accepted_without_forwarding_pat(self):
        response = Mock(status_code=200)
        response.iter_content.return_value = [json.dumps(user_records()).encode()]
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch("github_metrics.requests.get", return_value=response) as get:
            records = GitHubMetrics()._download(
                "https://copilot-reports.github.com/report?signature=secret",
            )
        self.assertEqual(records, user_records())
        self.assertNotIn("headers", get.call_args.kwargs)
        self.assertFalse(get.call_args.kwargs["allow_redirects"])

    def test_all_download_parts_are_combined(self):
        client = GitHubMetrics()
        metadata = {
            "report_start_day": WINDOW["start"], "report_end_day": WINDOW["end"],
            "download_links": ["https://example.blob.core.windows.net/a",
                               "https://example.blob.core.windows.net/b"],
        }
        with patch.object(client, "_get_json", return_value=metadata) as get, \
                patch.object(client, "_download", side_effect=[[user_records()[0]],
                                                              [user_records()[1]]]):
            window, records = client._report("test", "secret", "users")
        self.assertEqual(window, WINDOW)
        self.assertEqual(records, user_records())
        self.assertEqual(get.call_args.args[0],
                         "/orgs/test/copilot/metrics/reports/users-28-day/latest")

    def test_cache_and_configuration_change(self):
        client = GitHubMetrics()
        with patch.dict(os.environ, ENV), \
                patch.object(client, "_report", side_effect=[
                    (WINDOW, organization_records()), (WINDOW, user_records()),
                    (WINDOW, organization_records()), (WINDOW, user_records()),
                ]) as report:
            result = client.get()
            self.assertEqual(client.get(), result)
            self.assertEqual(report.call_count, 2)
            with patch.dict(os.environ, {"GITHUB_METRICS_ORG": "different"}):
                self.assertEqual(client.get()["organization"], "different")
            self.assertEqual(report.call_count, 4)
        self.assertNotIn("github-secret", json.dumps(result))

    def test_partial_failures_remain_visible_and_retryable(self):
        client = GitHubMetrics()
        with patch.dict(os.environ, ENV), \
                patch.object(client, "_report", side_effect=[
                    (WINDOW, organization_records()), GitHubMetricsError("User report denied"),
                    (WINDOW, organization_records()), GitHubMetricsError("User report denied"),
                ]) as report:
            result = client.get()
            self.assertIsNone(result["user_metrics"])
            self.assertEqual(result["errors"], {"user_metrics": "User report denied"})
            self.assertIsNotNone(result["organization_metrics"])
            client.get()
            self.assertEqual(report.call_count, 4)

    def test_total_failure_is_not_success_shaped(self):
        client = GitHubMetrics()
        with patch.dict(os.environ, ENV), \
                patch.object(client, "_report", side_effect=GitHubMetricsError("Denied")):
            with self.assertRaisesRegex(GitHubMetricsError, "No GitHub metrics"):
                client.get()

    def test_missing_configuration_and_invalid_slug(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(GitHubMetricsError, "Configure"):
                GitHubMetrics().get()
        with patch.dict(os.environ, dict(ENV, GITHUB_METRICS_ORG="../test")):
            with self.assertRaisesRegex(GitHubMetricsError, "slug"):
                GitHubMetrics().get()


class GitHubEndpointTests(unittest.TestCase):
    def test_metrics_load_without_dashboard_authentication(self):
        with patch.object(server.github_metrics, "get") as get:
            with patch.dict(os.environ, {}, clear=True):
                get.return_value = {"organization": "test"}
                self.assertEqual(server.get_github_metrics(),
                                 {"organization": "test"})
                get.assert_called_once_with()

    def test_upstream_failure_is_explicit(self):
        with patch.object(server.github_metrics, "get",
                          side_effect=GitHubMetricsError("Report unavailable")):
            with self.assertRaises(HTTPException) as failure:
                server.get_github_metrics()
        self.assertEqual(failure.exception.status_code, 503)
        self.assertEqual(failure.exception.detail, "Report unavailable")

    def test_http_no_login_cors_cache_control_and_normalized_payload(self):
        client = GitHubMetrics()
        metadata = {
            "report_start_day": WINDOW["start"], "report_end_day": WINDOW["end"],
            "download_links": ["https://example.blob.core.windows.net/report"],
        }
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            endpoint = f"http://127.0.0.1:{listener.getsockname()[1]}/api/v1/github/metrics"
            runner = uvicorn.Server(uvicorn.Config(server.app, log_level="error"))
            with patch.dict(os.environ, ENV, clear=True), \
                    patch.object(server, "github_metrics", client), \
                    patch.object(client, "_get_json", side_effect=[
                        metadata, metadata,
                    ]) as upstream, \
                    patch.object(client, "_download", side_effect=[
                        organization_records(), user_records(),
                    ]):
                worker = threading.Thread(
                    target=runner.run, kwargs={"sockets": [listener]}, daemon=True,
                )
                worker.start()
                try:
                    deadline = time.monotonic() + 5
                    while not runner.started and worker.is_alive() and time.monotonic() < deadline:
                        time.sleep(0.01)
                    self.assertTrue(runner.started, "Test API did not start")
                    response = requests.options(endpoint, headers={
                        "Origin": "http://localhost:3000",
                        "Access-Control-Request-Method": "GET",
                    }, timeout=5)
                    self.assertEqual(response.status_code, 200)
                    response = requests.get(endpoint, timeout=5)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["Cache-Control"], "private, no-store")
                    self.assertEqual(upstream.call_count, 2)
                    self.assertTrue(all("/billing/" not in call.args[0]
                                        for call in upstream.call_args_list))
                    payload = response.json()
                    self.assertEqual(payload["organization"], "example-org")
                    self.assertEqual(payload["organization_metrics"]["window"], WINDOW)
                    self.assertEqual(payload["organization_metrics"]["totals"], counts())
                    self.assertEqual(payload["user_metrics"]["users"][0]["login"], "octocat")
                    self.assertNotIn("seats", payload)
                    self.assertEqual(payload["errors"], {})
                    self.assertNotIn("github-secret", response.text)
                    self.assertNotIn("download_links", response.text)
                    self.assertIn("X-Request-ID", response.headers)
                finally:
                    runner.should_exit = True
                    worker.join(timeout=5)
                self.assertFalse(worker.is_alive(), "Test API did not stop")
