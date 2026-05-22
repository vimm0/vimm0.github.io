---
layout: post
title: "LLM Observability: Tracing and Debugging AI Systems in Production"
date: 2026-05-22 10:00:00 +0545
categories: [AI, DevOps, Production]
tags: [llm, observability, tracing, opentelemetry, langfuse, debugging, monitoring]
---

Building an AI feature that works in a demo is one thing. Keeping it reliable when real users hit it at 3 AM is a different problem entirely. Traditional application monitoring tells you that a request took 2.3 seconds and returned HTTP 200 — but it tells you nothing about *why* your agent looped five times before answering, or which retrieved chunk caused the hallucination.

LLM observability fills that gap. It gives you the same visibility into AI systems that OpenTelemetry gives you into microservices: distributed traces, structured spans, token budgets, and evaluation scores — all queryable after the fact.

## Why Standard APM Falls Short

Application Performance Monitoring tools measure latency, error rates, and throughput. These metrics still matter for LLM workloads, but they miss the domain-specific signals that actually tell you whether the system is working.

An LLM call can return `200 OK` in 800 ms and still be completely wrong. The model may have ignored the context, fabricated a citation, or answered a different question than the one asked. None of that shows up in a latency histogram.

What you actually need to observe:

- **Prompt and completion text** — the raw inputs and outputs, so you can reproduce failures
- **Token usage per step** — to understand cost and where your context budget goes
- **Retrieval quality** — which chunks were fetched, their similarity scores, and whether they were actually used
- **Tool call chains** — which tools fired, in what order, with what arguments
- **Evaluation scores** — faithfulness, relevance, and correctness, computed inline or in a batch job

## The Anatomy of an LLM Trace

Think of a trace as a tree. The root span represents the top-level user request. Child spans represent each LLM call, retrieval step, or tool invocation. Each span carries attributes — the model name, temperature, token counts, and any application-level metadata you attach.

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

tracer = trace.get_tracer("rag-service")

def answer_question(question: str, user_id: str) -> str:
    with tracer.start_as_current_span("rag.answer") as root:
        root.set_attribute("user.id", user_id)
        root.set_attribute("question.length", len(question))

        with tracer.start_as_current_span("retrieval") as ret_span:
            chunks = retrieve(question)
            ret_span.set_attribute("chunks.count", len(chunks))
            ret_span.set_attribute("top.score", chunks[0].score if chunks else 0)

        with tracer.start_as_current_span("generation") as gen_span:
            response = generate(question, chunks)
            gen_span.set_attribute("tokens.prompt", response.usage.prompt_tokens)
            gen_span.set_attribute("tokens.completion", response.usage.completion_tokens)
            return response.content
```

This trace structure lets you see at a glance whether a slow request was bottlenecked in retrieval or generation, and whether the retrieved chunks had high confidence scores.

## Instrumenting with Langfuse

[Langfuse](https://langfuse.com) is one of the most widely adopted open-source LLM observability platforms. It provides a Python/TypeScript SDK, a self-hostable backend, and a UI for browsing traces and running evals.

```python
from langfuse import Langfuse
from langfuse.decorators import observe, langfuse_context

langfuse = Langfuse()

@observe()
def retrieve_context(query: str) -> list[str]:
    # your retrieval logic
    chunks = vector_store.search(query, top_k=5)
    langfuse_context.update_current_observation(
        metadata={"top_score": chunks[0].score}
    )
    return [c.text for c in chunks]

@observe(as_type="generation")
def call_llm(prompt: str) -> str:
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )
    langfuse_context.update_current_observation(
        usage={"input": response.usage.input_tokens, "output": response.usage.output_tokens},
        model="claude-sonnet-4-6"
    )
    return response.content[0].text
```

The `@observe()` decorator automatically wraps each function as a span and wires up the parent-child relationship. You get a full trace tree with no manual span management.

## Evaluations as First-Class Signals

Traces tell you *what* happened. Evaluations tell you *how well* it happened. The most useful evaluations for RAG systems are:

**Faithfulness** — does the answer stick to the retrieved context, or does it introduce facts not present in the chunks? This catches hallucinations tied to over-generation.

**Context recall** — does the retrieved context actually contain the information needed to answer the question? Low recall means your retrieval step is the bottleneck.

**Answer relevance** — is the generated response actually answering what was asked? Useful for catching topic drift in multi-turn conversations.

You can run these as LLM-as-judge evaluations inline at request time, or batch them asynchronously against a sample of production traces:

```python
from langfuse import Langfuse

lf = Langfuse()

# Attach a score to a trace after the fact
lf.score(
    trace_id=trace_id,
    name="faithfulness",
    value=0.87,
    comment="Answer references only retrieved chunks"
)
```

Scoring against a slice of live traffic — say 5% of requests — gives you a rolling quality signal without the latency cost of evaluating every call.

## Alerting on Degradation

Once you have structured traces and eval scores flowing, you can set up alerts the same way you would for any metrics backend. A few patterns that work well:

**P95 latency by model** — LLM providers occasionally degrade silently. Tracking latency per model lets you detect this before users notice and swap to a fallback.

**Token budget exhaustion rate** — if a rising fraction of your requests are hitting `max_tokens`, your prompts are growing and you're truncating completions. This often surfaces as mysteriously incomplete answers before it causes hard errors.

**Eval score rolling average** — a 10% drop in faithfulness scores over a 24-hour window is a signal that something upstream changed (a new chunk schema, a prompt edit, a retriever configuration).

**Tool call failure rate** — in agentic systems, failed tool calls often fail silently. Instrumenting them as spans lets you set an alert threshold and catch broken integrations quickly.

## Debugging a Real Failure

Here is what the investigation workflow looks like in practice. A user reports that the assistant gave an answer that contradicts a document they uploaded yesterday.

1. **Find the trace** — filter by user ID and approximate timestamp in the observability UI.
2. **Inspect the retrieval span** — check which chunks were returned. Was the relevant document actually retrieved? If not, the problem is in chunking or embeddings, not generation.
3. **Check the prompt** — look at the full prompt sent to the model. Is the context too long? Did an older, contradictory chunk crowd out the new one?
4. **Review the eval scores** — if faithfulness is low, the model generated content beyond the retrieved context. If context recall is low, the right information never made it into the prompt.
5. **Replay the trace** — some platforms let you re-run the exact same inputs with a different model or prompt version to compare outputs side by side.

That workflow turns a vague bug report into a concrete, reproducible root cause in minutes instead of hours.

## Choosing a Platform

The ecosystem has consolidated around a few strong options in 2026:

- **Langfuse** — open source, self-hostable, strong Python/JS SDKs, good eval pipeline. Best for teams that want full control.
- **Arize Phoenix** — strong on evaluation and dataset management, integrates well with Arize's broader ML monitoring platform.
- **LangSmith** — tightly integrated with LangChain/LangGraph, good for teams already in that ecosystem.
- **OpenTelemetry + custom backend** — if you already run Jaeger or Tempo, you can route LLM spans there. Less LLM-specific tooling but fits existing ops workflows.

All of them export to standard formats (OTLP, JSON), so switching is not catastrophic if your needs evolve.

## Conclusion

The gap between a working prototype and a trustworthy production system is mostly an observability problem. Without traces and evals, you are flying blind — you know requests are failing but not why, and you cannot tell whether the fixes you ship are actually improving things.

Instrumenting your LLM calls does not require a complete infrastructure overhaul. Start with a decorator around your generation function, attach token counts and a trace ID, and ship it. Once you have data flowing, the right questions become obvious — and so do the answers.

Observability is not a nice-to-have for AI systems. It is the difference between a system you can maintain and one you can only apologize for.
