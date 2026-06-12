---
layout: post
title: "OpenTelemetry for AI Systems: Observability for LLMs and Agents in Production"
date: 2026-06-12 08:00:00 +0545
categories: [AI, DevOps]
tags: [opentelemetry, observability, llm, agents, tracing, monitoring]
---

As AI-powered applications move from prototypes into production, the operational questions shift fast. It's no longer enough to ask "does the model give good answers?" You need to ask: *why* did that request take four seconds? *Which* tool call is burning 80% of my token budget? *When* did my agent start hallucinating after a context window overflow? These are observability questions — and OpenTelemetry is increasingly the answer.

## Why AI Systems Need Specialized Observability

Traditional application tracing tracks HTTP requests, database queries, and function calls with well-understood latency and error semantics. AI systems add new dimensions: token consumption, model temperature, prompt templates, tool invocations, multi-step agent reasoning chains, and probabilistic outputs where "correctness" is hard to define.

A single user request to an AI assistant might fan out into a dozen LLM calls, several tool executions (search, code interpreter, calendar lookup), and multiple retries. Without distributed tracing stitched across all of these, debugging a degraded response is guesswork.

OpenTelemetry (OTel) is now the industry standard for vendor-neutral distributed tracing, metrics, and logs. The emerging **GenAI semantic conventions** — formalized in the OTel specification — give engineers a shared vocabulary for instrumenting language model calls.

## The GenAI Semantic Conventions

OpenTelemetry's GenAI working group has defined standard attribute names for LLM spans. Key attributes include:

| Attribute | Description |
|---|---|
| `gen_ai.system` | The AI provider (e.g., `anthropic`, `openai`) |
| `gen_ai.request.model` | The requested model ID |
| `gen_ai.response.model` | The actual model used (may differ from requested) |
| `gen_ai.usage.input_tokens` | Tokens consumed in the prompt |
| `gen_ai.usage.output_tokens` | Tokens generated in the response |
| `gen_ai.operation.name` | Operation type (`chat`, `embeddings`, `rerank`) |

These conventions mean that whether you're using Anthropic's SDK, OpenAI's client, or a framework like LangChain, your traces carry the same shape. Your dashboards, alerts, and cost attribution queries work across providers without custom glue code.

## Instrumenting an Agent with OTel

Here's a minimal example of manually instrumenting an agent tool call in Python:

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

provider = TracerProvider()
provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="http://otel-collector:4317"))
)
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("my-agent")

def call_llm(prompt: str, model: str = "claude-sonnet-4-6") -> str:
    with tracer.start_as_current_span("gen_ai.chat") as span:
        span.set_attribute("gen_ai.system", "anthropic")
        span.set_attribute("gen_ai.request.model", model)
        span.set_attribute("gen_ai.operation.name", "chat")

        response = anthropic_client.messages.create(
            model=model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        )

        span.set_attribute("gen_ai.usage.input_tokens", response.usage.input_tokens)
        span.set_attribute("gen_ai.usage.output_tokens", response.usage.output_tokens)
        span.set_attribute("gen_ai.response.model", response.model)

        return response.content[0].text
```

For agent workflows with multiple hops, each tool call becomes a child span. The trace tree lets you see exactly where latency accumulates across a reasoning chain.

## Auto-Instrumentation with opentelemetry-instrumentation-anthropic

Manual instrumentation is verbose. The emerging auto-instrumentation packages handle this for you:

```bash
pip install opentelemetry-instrumentation-anthropic
```

```python
from opentelemetry.instrumentation.anthropic import AnthropicInstrumentor

AnthropicInstrumentor().instrument()

# All subsequent Anthropic SDK calls are automatically traced
client = anthropic.Anthropic()
response = client.messages.create(...)  # span created automatically
```

Similar packages exist for OpenAI, Cohere, and LangChain. Frameworks like **OpenLLMetry** and **Traceloop** provide higher-level wrappers that integrate with popular observability backends (Datadog, Honeycomb, Grafana Tempo) out of the box.

## What to Track Beyond Latency

Latency and error rate are table stakes. AI observability adds:

**Token economics** — Track `input_tokens` and `output_tokens` per span. Aggregate by user, feature, or model version to build real cost attribution. A 5x spike in input tokens is often a prompt template regression, not increased traffic.

**Cache hit rate** — If you're using prompt caching (Anthropic's cache-control blocks, OpenAI's automatic caching), instrument whether each request hit the cache. Cache misses on what should be stable system prompts are expensive and usually indicate a bug.

**Tool call distribution** — In multi-tool agents, measure which tools get called, how often they fail, and how long they take. An agent that's calling the search tool on every turn when it shouldn't is a behavioral regression, not just a cost issue.

**Prompt version tracking** — Add a `prompt.version` attribute to spans. When you update a system prompt, you can compare latency, token usage, and error rates between versions in your observability backend. This is the AI equivalent of feature flags with metrics.

**Retry and fallback events** — Log when the agent retried a failed tool call or fell back to a simpler model. High retry rates are a leading indicator of system instability before errors surface in user-visible metrics.

## Connecting Traces to Evaluations

The most powerful pattern is linking production traces to offline evaluations. When a trace shows high latency, unexpected tool use, or a user thumbs-down, you can replay that exact request — same prompt, same tool responses — through your evaluation pipeline. This closes the loop between production observability and model quality measurement.

Store the full prompt and response content in your trace (with PII redaction where needed). Index it by trace ID. When your eval suite flags a regression, cross-reference against recent production traces to distinguish model drift from distribution shift in inputs.

## Sampling Strategy

LLM calls are expensive; tracing every token of every request in high-throughput systems can itself become a cost concern. Consider:

- **Head-based sampling**: sample a fixed percentage of all traces (e.g., 10%). Simple but misses rare errors.
- **Tail-based sampling**: collect all spans, decide at the end of a trace whether to export it — keep 100% of error traces and slow traces, sample down the fast/successful ones. Requires a tail-sampling collector.
- **Always-on for specific operations**: always trace tool call failures, cache misses, and requests that exceed a token budget threshold.

The OTel Collector's `tailsampling` processor makes this straightforward to configure without changes to application code.

## Conclusion

As AI systems grow more complex — multi-agent pipelines, retrieval-augmented generation, tool-calling loops — visibility into their behavior becomes a first-class engineering concern. OpenTelemetry's GenAI semantic conventions provide the shared language; auto-instrumentation packages lower the barrier to getting started; and tail-based sampling keeps the cost manageable at scale.

If you're running LLMs in production without distributed tracing, you're flying blind. The good news is that the ecosystem has matured rapidly — getting meaningful observability into an AI system is now a matter of hours, not weeks. Start with token attribution and latency by model version. The rest follows naturally.
