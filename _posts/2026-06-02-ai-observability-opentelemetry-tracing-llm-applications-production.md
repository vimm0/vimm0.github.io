---
layout: post
title: "AI Observability: OpenTelemetry Tracing for LLM Applications in Production"
date: 2026-06-02 08:00:00 +0545
categories: [AI, DevOps]
tags: [opentelemetry, observability, llm, tracing, monitoring, production]
---

As LLM-powered applications move from prototype to production, one of the most pressing challenges teams face is visibility: why did this request take 12 seconds? Why did the model hallucinate here but not there? What's our actual p99 latency across different prompt lengths? Traditional APM tools weren't built for the nuances of generative AI — token streaming, non-deterministic outputs, multi-step reasoning chains, and tool calls that span multiple external services.

This post covers how to instrument LLM applications with OpenTelemetry, what metrics and traces actually matter for production AI systems, and the patterns that separate teams flying blind from those who can confidently operate at scale.

## Why Standard Observability Falls Short for LLMs

Traditional request tracing captures timing, status codes, and payload size. For LLMs, these primitives are insufficient. A single LLM call involves:

- **Prompt construction** — retrieving context, formatting few-shot examples, injecting system instructions
- **Token budgeting** — estimating input tokens, choosing between model variants based on context length
- **Inference latency** — time-to-first-token (TTFT) vs. total generation time are very different metrics
- **Tool execution** — function calls, retrieval steps, code interpreters that happen mid-generation
- **Output parsing** — structured output validation, retry logic when JSON schema enforcement fails

A span that says `POST /v1/chat/completions — 4.2s` tells you almost nothing useful. You need to know: 40% of that was prompt assembly, 55% was inference, and 5% was schema validation with one retry.

## Instrumenting with OpenTelemetry

OpenTelemetry (OTel) is the CNCF standard for distributed tracing and metrics. For LLM apps, the `opentelemetry-semantic-conventions` package now includes [GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) that standardize attribute names across providers.

### Basic Setup (Python)

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.semconv._incubating.attributes import gen_ai_attributes

# Configure provider
provider = TracerProvider()
exporter = OTLPSpanExporter(endpoint="http://otel-collector:4317")
provider.add_span_processor(BatchSpanProcessor(exporter))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("my-ai-app", "1.0.0")
```

### Wrapping LLM Calls

The key is capturing both the inputs and outputs as span attributes, along with timing breakdowns:

```python
import time
import anthropic

client = anthropic.Anthropic()

def traced_llm_call(system: str, user_message: str, model: str = "claude-sonnet-4-6"):
    with tracer.start_as_current_span("llm.chat") as span:
        # GenAI semantic conventions
        span.set_attribute("gen_ai.system", "anthropic")
        span.set_attribute("gen_ai.request.model", model)
        span.set_attribute("gen_ai.request.max_tokens", 1024)
        
        # Prompt metadata (avoid logging full prompts in high-security environments)
        span.set_attribute("gen_ai.prompt.system.length", len(system))
        span.set_attribute("gen_ai.prompt.user.length", len(user_message))
        
        request_start = time.perf_counter()
        first_token_time = None
        chunks = []
        
        with client.messages.stream(
            model=model,
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": user_message}]
        ) as stream:
            for chunk in stream:
                if first_token_time is None:
                    first_token_time = time.perf_counter()
                    span.set_attribute(
                        "gen_ai.performance.ttft_ms",
                        (first_token_time - request_start) * 1000
                    )
                chunks.append(chunk)
        
        message = stream.get_final_message()
        total_time = time.perf_counter() - request_start
        
        # Usage metrics
        span.set_attribute("gen_ai.usage.input_tokens", message.usage.input_tokens)
        span.set_attribute("gen_ai.usage.output_tokens", message.usage.output_tokens)
        span.set_attribute("gen_ai.performance.total_ms", total_time * 1000)
        span.set_attribute("gen_ai.response.finish_reason", message.stop_reason)
        
        return message
```

## Key Metrics to Track

Beyond basic latency, here are the metrics that actually inform production decisions:

### Time-to-First-Token (TTFT)
TTFT directly impacts perceived responsiveness. A 500ms TTFT with 8s total generation feels much faster than a 3s TTFT with 5s total — the streaming response starts sooner. Track this separately from total latency and set distinct SLOs for each.

### Token Throughput
Tokens-per-second during generation reveals model capacity and helps with capacity planning. If throughput degrades under load, you're hitting inference server limits before API rate limits.

```python
output_tokens = message.usage.output_tokens
generation_time = total_time - (first_token_time - request_start)
tokens_per_second = output_tokens / generation_time

span.set_attribute("gen_ai.performance.tokens_per_second", tokens_per_second)
```

### Prompt Cache Hit Rate
If you're using prompt caching (Anthropic, OpenAI, etc.), cache hits dramatically reduce both cost and latency. Track cache hit rates as a first-class metric — a drop signals prompt structure changes that broke your caching patterns.

```python
cache_read = getattr(message.usage, 'cache_read_input_tokens', 0)
cache_write = getattr(message.usage, 'cache_creation_input_tokens', 0)
total_input = message.usage.input_tokens

span.set_attribute("gen_ai.usage.cache_read_tokens", cache_read)
span.set_attribute("gen_ai.usage.cache_write_tokens", cache_write)
span.set_attribute("gen_ai.performance.cache_hit_rate", cache_read / total_input if total_input > 0 else 0)
```

### Retry Rate and Failure Modes
Track why retries happen: rate limits, schema validation failures, content policy rejections, or network timeouts. These have very different remediation strategies.

## Tracing Multi-Step Agent Workflows

For agentic applications with tool calls and multi-turn reasoning, you need nested spans that capture the full decision tree:

```python
def run_agent(user_query: str):
    with tracer.start_as_current_span("agent.run") as root_span:
        root_span.set_attribute("agent.query", user_query[:500])  # truncate
        
        iteration = 0
        while True:
            with tracer.start_as_current_span(f"agent.iteration.{iteration}") as iter_span:
                response = traced_llm_call(SYSTEM_PROMPT, build_context(user_query))
                
                if response.stop_reason == "end_turn":
                    root_span.set_attribute("agent.iterations", iteration + 1)
                    return extract_answer(response)
                
                # Tool calls
                for tool_use in extract_tool_calls(response):
                    with tracer.start_as_current_span(f"tool.{tool_use.name}") as tool_span:
                        tool_span.set_attribute("tool.name", tool_use.name)
                        tool_span.set_attribute("tool.input_size", len(str(tool_use.input)))
                        result = execute_tool(tool_use)
                        tool_span.set_attribute("tool.result_size", len(str(result)))
                
                iteration += 1
```

This gives you a waterfall view: total agent runtime at the top, each LLM call as a child span, each tool execution nested within the iteration where it was called.

## Structuring Dashboards

With traces flowing to your backend (Grafana Tempo, Honeycomb, Datadog, etc.), build dashboards around three questions:

**1. Latency profile**: P50/P95/P99 TTFT and total latency, broken down by model and prompt template. Segment by input token bucket (0-1k, 1k-4k, 4k+) to understand how context length affects performance.

**2. Cost and efficiency**: Token usage per request, cache hit rate, cost per successful completion (accounting for retries). Set up alerts when cost-per-request exceeds thresholds — this often signals prompt bloat or caching regression.

**3. Quality signals**: Stop reason distribution (did `max_tokens` truncate responses?), tool call success rates, schema validation retry rate. These are leading indicators for degraded output quality.

## Conclusion

Observability for LLM applications isn't optional at production scale — it's the foundation that lets you debug regressions, optimize costs, and build SLO confidence. The investment in proper instrumentation pays off the first time you're able to say "the p99 latency spike at 14:00 was caused by a cache miss on the new prompt template, not an upstream provider issue."

Start with the GenAI semantic conventions to stay interoperable, capture TTFT separately from total latency, and build nested spans for agent workflows. Once you have rich traces, the questions that felt unanswerable in production become straightforward to diagnose.
