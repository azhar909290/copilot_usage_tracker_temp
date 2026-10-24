import asyncio
import os
import runpy
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException

import server
from store import UsageStore
from telemetry import AgentTelemetry


class AzureMonitorStartupTests(unittest.TestCase):
    def test_configures_monitor_before_creating_fastapi_app(self):
        connection_string = "InstrumentationKey=00000000-0000-0000-0000-000000000000"
        with (
            patch.dict(os.environ, {
                "APPLICATIONINSIGHTS_CONNECTION_STRING": f" {connection_string} ",
            }, clear=True),
            patch("dotenv.load_dotenv"),
            patch("azure.monitor.opentelemetry.configure_azure_monitor") as configure,
            patch(
                "opentelemetry.instrumentation.fastapi.FastAPIInstrumentor.instrument_app"
            ) as instrument_app,
            patch("fastapi.FastAPI", wraps=server.FastAPI) as create_app,
        ):
            calls = Mock()
            calls.attach_mock(configure, "configure")
            calls.attach_mock(create_app, "create_app")
            namespace = runpy.run_path(server.__file__)

        configure.assert_called_once_with(
            connection_string=connection_string,
            logger_name="usage_api",
        )
        self.assertEqual([call[0] for call in calls.mock_calls], ["configure", "create_app"])
        self.assertIsInstance(namespace["app"], server.FastAPI)
        instrument_app.assert_called_once_with(namespace["app"])

    def test_monitor_is_optional_without_a_connection_string(self):
        for value in (None, "", "   "):
            environment = {} if value is None else {
                "APPLICATIONINSIGHTS_CONNECTION_STRING": value,
            }
            with (
                self.subTest(value=value),
                patch.dict(os.environ, environment, clear=True),
                patch("dotenv.load_dotenv"),
                patch("azure.monitor.opentelemetry.configure_azure_monitor") as configure,
                patch(
                    "opentelemetry.instrumentation.fastapi.FastAPIInstrumentor.instrument_app"
                ) as instrument_app,
            ):
                namespace = runpy.run_path(server.__file__)
                configure.assert_not_called()
                instrument_app.assert_not_called()
                self.assertIsInstance(namespace["app"], server.FastAPI)

    def test_monitor_configuration_errors_fail_startup(self):
        with (
            patch.dict(os.environ, {
                "APPLICATIONINSIGHTS_CONNECTION_STRING": "invalid",
            }, clear=True),
            patch("dotenv.load_dotenv"),
            patch(
                "azure.monitor.opentelemetry.configure_azure_monitor",
                side_effect=ValueError("Invalid connection string"),
            ),
            patch("fastapi.FastAPI") as create_app,
        ):
            with self.assertRaisesRegex(ValueError, "Invalid connection string"):
                runpy.run_path(server.__file__)
            create_app.assert_not_called()


class AgentTelemetryTests(unittest.TestCase):
    def test_sdk_exports_agent_metrics_through_protobuf_receiver(self):
        batches = []

        class Receiver(BaseHTTPRequestHandler):
            def do_POST(self):
                batches.append(self.rfile.read(int(self.headers["Content-Length"])))
                self.send_response(200)
                self.end_headers()

            def log_message(self, format, *args):
                pass

        collector = HTTPServer(("127.0.0.1", 0), Receiver)
        worker = threading.Thread(target=collector.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(collector.server_close)
        self.addCleanup(worker.join)
        self.addCleanup(collector.shutdown)
        with tempfile.TemporaryDirectory() as directory:
            usage_store = UsageStore(directory)
            with patch.object(server, "store", usage_store):
                endpoint = f"http://127.0.0.1:{collector.server_port}/v1/traces"
                with AgentTelemetry(endpoint=endpoint) as telemetry:
                    for name in ("Planner", "Reviewer"):
                        with telemetry.llm_call(name, "test-model", "alice") as span:
                            span.set_attribute("gen_ai.usage.input_tokens", 100)
                            span.set_attribute("gen_ai.usage.output_tokens", 20)
                            span.set_attribute("gen_ai.response.model", "resolved-model")
                    self.assertTrue(telemetry.flush())
                self.assertEqual(len(batches), 1)
                request = Mock(
                    headers={"content-type": "application/x-protobuf"},
                    body=AsyncMock(return_value=batches[0]),
                )
                response = asyncio.run(server.traces(request))
                self.assertEqual(response.status_code, 200)
                rows = server.usage()["rows"]
                self.assertEqual([row["agent"] for row in rows], ["Planner", "Reviewer"])
                for row in rows:
                    self.assertEqual(row["user"], "alice")
                    self.assertEqual(row["model"], "resolved-model")
                    self.assertEqual(row["input_tokens"], 100)
                    self.assertEqual(row["output_tokens"], 20)
                    self.assertEqual(row["total_tokens"], 120)
                    self.assertIsNotNone(row["first_seen"])
                    self.assertEqual(row["first_seen"], row["last_seen"])
                    self.assertGreaterEqual(row["latency_ms_avg"], 0)
                    self.assertAlmostEqual(row["cost"], 0.000119)
                asyncio.run(server.traces(request))
                self.assertEqual(usage_store.summary(), rows)

    def test_empty_agent_name_is_rejected(self):
        with AgentTelemetry() as telemetry:
            with self.assertRaises(ValueError):
                with telemetry.llm_call(" ", "test-model"):
                    self.fail("An unnamed agent must not produce a span")


class DeleteUserUsageTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_store = server.store
        server.store = UsageStore(self.temp_dir.name)

    def tearDown(self):
        server.store = self.original_store
        self.temp_dir.cleanup()

    def test_delete_requires_separate_configured_bearer_token(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(HTTPException) as error:
                server.delete_user_usage("alice", "Bearer secret")
        self.assertEqual(error.exception.status_code, 503)

        with patch.dict(os.environ, {"USER_DATA_DELETE_TOKEN": "admin-secret"}):
            with self.assertRaises(HTTPException) as error:
                server.delete_user_usage("alice", "Bearer wrong-secret")
            self.assertEqual(error.exception.status_code, 401)

            result = server.delete_user_usage("alice", "Bearer admin-secret")
        self.assertEqual(result, {"user": "alice", "deleted_events": 0})


if __name__ == "__main__":
    unittest.main()