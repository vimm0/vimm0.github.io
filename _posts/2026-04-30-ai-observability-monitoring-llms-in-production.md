---
layout: post
title: "AI Observability: Monitoring LLMs in Production"
date: 2026-04-30 08:00:00 +0545
categories: [AI, DevOps]
tags: [llm, observability, monitoring, mlops, production, tracing]
---

Shipping a language model feature is the easy part. Keeping it reliable, cost-efficient, and trustworthy once real users hit it — that's where most teams stumble. Traditional application monitoring tools weren't built for probabilistic systems that can hallucinate, drift in quality, or silently degrade when the underlying model changes. In 2026, AI observability has become a discipline in its own right, and understanding it is essential for any team running LLMs in production.

## Why Standard Monitoring Falls Short

When a traditional API endpoint breaks, the symptoms are obvious: error rates spike, latency climbs, alerts fire. LLMs fail differently. A model might return a confident-sounding response that is factually wrong. Output quality might degrade subtly after a prompt change. A retrieval step might start pulling less relevant context. None of these register as errors in a conventional APM dashboard.

The core challenge is that LLM quality is semantic, not numeric. You can't just check a status code — you need to evaluate the *content* of the response. This requires a different stack:

- **Tracing** at the call level (inputs, outputs, latencies, token counts, costs)
- **Evaluation** of output quality (correctness, faithfulness, relevance, safety)
- **Drift detection** across prompt versions, model versions, and user segments
- **Feedback loops** that connect user signals back to quality metrics

## The Core Telemetry You Need

Before you can evaluate quality, you need to capture the right raw data. At minimum, every LLM call should emit a structured trace with:

```python
{
  "trace_id": "abc123",
  "timestamp": "2026-04-30T08:00:00Z",
  "model": "claude-sonnet-4-6",
  "prompt_version": "v2.3",
  "input_tokens": 842,
  "output_tokens": 315,
  "latency_ms": 1240,
  "cost_usd": 0.0042,
  "user_id": "u_789",
  "session_id": "s_456",
  "tags": ["summarization", "customer-support"]
}
```

Token counts and cost are non-negotiable — LLM API bills grow faster than most teams expect, and per-feature cost attribution is the only way to catch runaway usage before it hits your budget. Latency at the p95 and p99 percentiles matters more than the mean, since LLM tail latencies tend to be much higher than averages suggest.

## Tracing Chains and Agents

Single LLM calls are simple to trace. Chains, agents, and multi-step pipelines are not. When a user request triggers a retrieval step, two model calls, and a tool execution, you need a parent-child trace structure that lets you see the whole flow — and pinpoint exactly where latency or quality degraded.

OpenTelemetry has become the standard substrate for this. Libraries like LangSmith, Langfuse, and Arize all support OTEL-compatible tracing, and building on OTEL means your LLM traces sit alongside your existing service traces in the same backend.

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

tracer = trace.get_tracer("my-llm-app")

def run_rag_pipeline(query: str) -> str:
    with tracer.start_as_current_span("rag-pipeline") as span:
        span.set_attribute("query", query)

        with tracer.start_as_current_span("retrieval"):
            docs = retrieve_relevant_docs(query)
            span.set_attribute("docs_retrieved", len(docs))

        with tracer.start_as_current_span("llm-call") as llm_span:
            response = call_llm(query, docs)
            llm_span.set_attribute("output_tokens", response.usage.output_tokens)

        return response.content
```

This gives you a waterfall view per request: you can see that retrieval took 200ms, the model call took 900ms, and the total user-perceived latency was 1.1 seconds — plus which step introduced a quality issue when you go back to debug a bad response.

## Evaluating Output Quality at Scale

Logging inputs and outputs is table stakes. The harder problem is knowing whether those outputs are *good*. There are three practical approaches, and most production systems use all three:

**1. Rule-based checks.** Fast, deterministic, cheap. Check for refusals ("I cannot help with"), check for required keywords or formats, check output length bounds. These catch the obvious failures instantly.

**2. LLM-as-judge.** Use a second model call to score the output on dimensions like faithfulness, relevance, or safety. This is more expensive but catches nuanced failures that rules miss. The key is running these evaluations asynchronously — never on the hot path — and sampling rather than evaluating every call.

```python
def evaluate_faithfulness(query: str, context: str, response: str) -> float:
    prompt = f"""
    Given the following context and response, rate how faithfully the response
    is grounded in the context on a scale of 0.0 to 1.0.

    Context: {context}
    Response: {response}

    Return only a number between 0.0 and 1.0.
    """
    score = float(call_judge_model(prompt).strip())
    return score
```

**3. Human feedback.** Thumbs up/down, correction flows, and expert annotation are ground truth. Even a small volume of labeled data is invaluable for calibrating your automated evaluators and catching systematic failure modes.

## Prompt Versioning and Regression Testing

Every prompt change is a potential regression. Teams that treat prompts like code — versioned, reviewed, and tested before deployment — catch quality regressions before users do. The workflow looks like this:

1. Maintain a dataset of representative inputs with expected outputs (your "golden set")
2. Before deploying a new prompt version, run it against the golden set and compare scores
3. Gate deployment on evaluation metrics: if faithfulness drops more than 5%, block the deploy

This is straightforward in principle but requires discipline in practice. The golden set needs to be maintained as your use cases evolve, and your evaluators need to be calibrated against human judgments regularly.

## Cost and Performance Dashboards

Beyond quality, two operational metrics dominate production LLM work: cost and latency.

For cost, track:
- Cost per user session
- Cost per feature (summarization vs. Q&A vs. generation)
- Cost trend week-over-week (the signal that something changed)

For latency, track:
- Time to first token (critical for streaming UIs)
- Total latency p50, p95, p99
- Cache hit rate (if you're using prompt caching, a low hit rate means you're leaving money on the table)

These numbers feed directly into product decisions: which features are worth the cost, where to invest in caching, when to route to a cheaper model for simpler requests.

## Alerts and On-Call Runbooks

Production AI systems need alert thresholds tuned to their specific failure modes. A good starting set:

- **Error rate > 1%** on LLM API calls (network issues, rate limits, invalid responses)
- **Latency p95 > 5s** for user-facing endpoints
- **Refusal rate spike** — sudden increase in model refusals often signals a prompt issue or input distribution shift
- **Cost per session anomaly** — 3x week-over-week cost jump usually means a prompt went off the rails

Pair each alert with a runbook: what does this alert mean, what's the likely cause, and what are the first three things to check? The goal is making the on-call experience manageable even for engineers who didn't build the AI feature.

## Conclusion

AI observability isn't a nice-to-have — it's what separates teams that confidently iterate on their LLM features from teams that are flying blind and firefighting. The investment pays off quickly: you catch quality regressions before users report them, you understand where your cost is going, and you have the data to make principled decisions about model choice, caching, and prompt design.

Start with comprehensive tracing, add automated evaluators on a sample of traffic, and build a feedback loop from user signals. Those three steps will give you more visibility into your LLM system than most teams have today.
