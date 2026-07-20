---
layout: post
title: "AI Observability in Production: Tracing, Evaluating, and Monitoring LLM Applications"
date: 2026-07-20 10:00:00 +0545
categories: [AI, DevOps, Backend]
tags: [LLM, Observability, Monitoring, Tracing, LLMOps, OpenTelemetry, Evaluation, Production]
---

## Introduction

When a traditional API endpoint misbehaves in production, you reach for logs, traces, and metrics — the observability triad. You find the slow query, the unhandled exception, the p99 latency spike. But when your LLM application starts producing low-quality, evasive, or subtly wrong answers, none of those tools tell you why.

LLM observability is the discipline of making AI systems understandable and debuggable. In 2026, it has become a first-class concern for any team shipping LLM-powered products. This post covers what you need to monitor, how to instrument your applications, and the evaluation patterns that separate teams who can iterate confidently from those flying blind.

## Why Traditional Observability Falls Short

A standard APM tool tells you that your `/chat` endpoint took 1.2 seconds and returned HTTP 200. That's useful, but it tells you nothing about whether the answer was accurate, whether the model followed your system prompt, or whether a prompt injection slipped through.

LLM applications introduce failure modes that don't surface as errors:

- **Hallucinations** — factually wrong answers that look confident
- **Prompt drift** — model behavior that degrades as prompts are updated
- **Context window misuse** — irrelevant retrievals burying useful content in RAG pipelines
- **Latency regressions** — a new model version that's slightly slower at p95
- **Cost explosions** — a single user triggering a 50k-token chain with a crafted prompt

Catching these requires tracing at the semantic level, not just the HTTP level.

## The Three Layers of LLM Observability

### 1. Execution Tracing

Every LLM call should emit a structured trace capturing:

- **Input**: the full prompt including system message, conversation history, and injected context
- **Output**: the raw model response before any post-processing
- **Metadata**: model name, temperature, max tokens, token counts, latency, finish reason
- **Span context**: parent trace ID so the LLM call is linked to the originating user request

OpenTelemetry has become the standard carrier format. Most LLMOps platforms (LangSmith, Arize, Honeycomb, Datadog LLM Observability) accept OTLP traces and enrich them with LLM-specific attributes defined in the GenAI semantic conventions.

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

provider = TracerProvider()
provider.add_span_exporter(OTLPSpanExporter(endpoint="http://collector:4317"))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("my-llm-app")

def call_llm(prompt: str, model: str = "claude-sonnet-5") -> str:
    with tracer.start_as_current_span("llm.call") as span:
        span.set_attribute("gen_ai.system", "anthropic")
        span.set_attribute("gen_ai.request.model", model)
        span.set_attribute("gen_ai.prompt", prompt[:500])  # truncate for safety

        response = anthropic_client.messages.create(
            model=model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        )

        span.set_attribute("gen_ai.response.finish_reason", response.stop_reason)
        span.set_attribute("gen_ai.usage.input_tokens", response.usage.input_tokens)
        span.set_attribute("gen_ai.usage.output_tokens", response.usage.output_tokens)

        return response.content[0].text
```

### 2. Metric Collection

Raw traces are invaluable for debugging individual requests. Metrics are what you alert on. Key LLM metrics to track:

| Metric | Description | Alert Threshold |
|---|---|---|
| `llm.latency.p50/p95/p99` | Response time distribution | p95 > 5s |
| `llm.tokens.input` / `llm.tokens.output` | Token usage per request | Outlier detection |
| `llm.cost.per_request` | Dollar cost of each call | Budget alerts |
| `llm.error_rate` | API errors, timeouts, rate limits | > 1% |
| `llm.quality_score` | Automated evaluation score | Rolling average drop |

The last metric — quality score — requires evaluation, which we'll cover next.

### 3. Evaluation Pipelines

This is where LLM observability diverges most sharply from traditional systems monitoring. You need to continuously measure whether your model's outputs are actually good.

**Online evaluation** runs asynchronously against live traffic. A small percentage of production responses are scored by a judge LLM (or rule-based checks) and the scores are aggregated into dashboards.

```python
import anthropic

JUDGE_PROMPT = """You are evaluating whether an AI assistant's response correctly answers the user's question.

User question: {question}
Assistant response: {response}
Reference answer (ground truth): {reference}

Score from 0-10 where:
- 10: Fully correct, concise, and helpful
- 5: Partially correct or missing key details  
- 0: Incorrect, harmful, or refused incorrectly

Respond with JSON: {{"score": <int>, "reason": "<one sentence>"}}"""

def evaluate_response(question: str, response: str, reference: str) -> dict:
    client = anthropic.Anthropic()
    result = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=200,
        messages=[{
            "role": "user",
            "content": JUDGE_PROMPT.format(
                question=question,
                response=response,
                reference=reference
            )
        }]
    )
    import json
    return json.loads(result.content[0].text)
```

**Offline evaluation** runs against a curated test set before deploying prompt or model changes. Think of it as your test suite for AI behavior — run it in CI and block deploys that regress quality below a threshold.

## Prompt Version Tracking

One of the most common root causes of quality degradation is an untracked prompt change. Treat prompts as code:

- Store them in version control with semantic versioning
- Tag every LLM trace with the prompt version hash
- Run your eval suite against new prompt versions before promoting to production
- Keep a rollback path — if `prompt-v2.3` degrades quality, revert to `prompt-v2.2` immediately

```python
import hashlib

class PromptRegistry:
    def __init__(self):
        self._prompts = {}

    def register(self, name: str, template: str) -> str:
        version = hashlib.sha256(template.encode()).hexdigest()[:8]
        self._prompts[name] = {"template": template, "version": version}
        return version

    def get(self, name: str) -> tuple[str, str]:
        entry = self._prompts[name]
        return entry["template"], entry["version"]

registry = PromptRegistry()
registry.register("customer_support", "You are a helpful support agent for Acme Corp...")

template, version = registry.get("customer_support")
# Emit version in every trace span
span.set_attribute("llm.prompt.version", version)
```

## Cost and Latency Budgeting

Production LLM applications need explicit cost controls. Without them, a single viral traffic spike or adversarial user can burn through your monthly budget in hours.

Set per-request token budgets and enforce them:

```python
MAX_INPUT_TOKENS = 4096
MAX_OUTPUT_TOKENS = 512

def safe_llm_call(messages: list, system: str) -> str:
    # Estimate input tokens before calling
    estimated_input = sum(len(m["content"].split()) * 1.3 for m in messages)
    if estimated_input > MAX_INPUT_TOKENS:
        # Truncate oldest messages to fit budget
        messages = truncate_to_budget(messages, MAX_INPUT_TOKENS)

    response = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=MAX_OUTPUT_TOKENS,
        system=system,
        messages=messages
    )
    return response.content[0].text
```

Track cumulative cost per user session and implement circuit breakers that degrade gracefully — returning a cached response or a "please try again" message — when budgets are exhausted.

## Alerting on Semantic Quality

Traditional alerting on HTTP status codes won't catch a model that's started refusing legitimate requests or giving unhelpful answers. Build alerts on your quality score metrics:

- **Rolling average quality drop**: if the 1-hour rolling mean quality score drops more than 15% below the 7-day baseline, page on-call
- **Refusal rate spike**: track responses that contain "I can't help with that" or similar patterns; a sudden spike often signals a prompt injection wave or a model safety update that broke edge cases
- **Latency percentile regression**: alert if p95 latency increases more than 30% compared to the same hour yesterday

## Building a Debugging Workflow

When an issue surfaces, the investigation workflow should feel familiar to any engineer who's debugged a distributed system:

1. **Identify the symptom** from metrics — quality score drop, latency spike, error rate increase
2. **Find representative traces** — filter traces by time window and the affected metric
3. **Inspect the full prompt** — the trace should contain the exact input sent to the model, not a truncated version
4. **Check for changes** — did the prompt version change? Did a model update roll out? Did input distribution shift?
5. **Reproduce in staging** — replay the failing trace against your current prompt with the staging model
6. **Fix and verify** — update the prompt or code, run the eval suite, deploy with A/B traffic splitting

## Conclusion

LLM observability is not optional for production systems — it's the difference between shipping with confidence and hoping users don't notice quality regressions. The investment is straightforward: instrument every LLM call with structured traces, collect cost and quality metrics, build an evaluation pipeline you run in CI, and alert on semantic quality alongside the usual infrastructure metrics.

The teams winning with AI in 2026 are not necessarily using the most powerful models. They're the ones who can measure what their models actually do, catch regressions before users do, and iterate on prompts and architectures with the same rigor they apply to code. Start with the basics — trace every call, track cost and latency — and layer in automated evaluation as your traffic scales.

Observability is what transforms an LLM prototype into a product you can stand behind.
