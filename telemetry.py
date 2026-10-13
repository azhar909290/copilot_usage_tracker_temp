"""Export named custom-agent LLM calls as OpenTelemetry spans."""
from contextlib import contextmanager

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


class AgentTelemetry:
    def __init__(self, endpoint: str | None = None, service_name: str = "custom-agents"):
        self.provider = TracerProvider(
            resource=Resource.create({"service.name": service_name})
        )
        self.provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
        self.tracer = self.provider.get_tracer("agent-usage")

    @contextmanager
    def llm_call(self, agent_name: str, model: str, username: str | None = None):
        if not agent_name.strip():
            raise ValueError("agent_name must not be empty")
        attributes = {
            "gen_ai.operation.name": "chat",
            "gen_ai.agent.name": agent_name,
            "gen_ai.request.model": model,
        }
        if username:
            attributes["user.name"] = username
        with self.tracer.start_as_current_span(f"chat {model}", attributes=attributes) as span:
            yield span

    def flush(self) -> bool:
        return self.provider.force_flush()

    def close(self) -> None:
        self.provider.shutdown()

    def __enter__(self):
        return self

    def __exit__(self, exception_type, exception, traceback):
        self.close()