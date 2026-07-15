---
layout: post
title: "AI Inference Cost Optimization: Prompt Caching, Batching, and Token Budgets in Production"
date: 2026-07-15 08:00:00 +0545
categories: [AI, Engineering]
tags: [llm, cost-optimization, prompt-caching, batching, inference, production, ai-engineering]
---

LLM API bills have a way of surprising teams. A feature that costs pennies in development mysteriously turns into hundreds of dollars a month in production. The fix isn't to abandon the feature — it's to understand where tokens are actually going and apply the right optimization for each pattern.

This post covers the three highest-leverage techniques for cutting inference costs without degrading quality: prompt caching, request batching, and token budget controls. Each targets a different cost driver and they compose well together.

## Why Inference Costs Escalate

Most teams hit cost problems for one of three reasons:

1. **Repeated system prompts** — large, unchanging context blocks sent with every request
2. **Serial requests** — one-by-one processing when batch processing would be cheaper
3. **Unconstrained output** — models generating far more tokens than the use case needs

Knowing which pattern you have tells you which optimization to apply first.

## Prompt Caching: Stop Paying for the Same Tokens Twice

If your application sends the same large block of context with every request — a long system prompt, a shared knowledge base chunk, a fixed set of tools or examples — prompt caching is likely your biggest immediate win.

With caching, the provider stores the KV (key-value) state of a prompt prefix after its first computation. Subsequent requests that share the same prefix skip the prefill step and get cache-read pricing instead. On Anthropic's API, cache reads cost roughly 10% of the standard input token price, with cache writes at 25%.

```python
import anthropic

client = anthropic.Anthropic()

SYSTEM_PROMPT = """
You are a technical support assistant for AcmeCorp's API platform.
[... 2000 tokens of documentation, policies, and examples ...]
"""

def answer_support_question(question: str) -> str:
    response = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"}  # mark for caching
            }
        ],
        messages=[{"role": "user", "content": question}]
    )
    return response.content[0].text
```

The `cache_control` block tells the API where the cacheable prefix ends. Everything before this marker is eligible to be served from cache on the next call with the same prefix.

**When caching pays off:** cache writes cost slightly more than standard input tokens, so you need at least a few calls hitting the cache before you break even. A good rule of thumb: if a prompt prefix appears in more than 3-5 requests per cache TTL (typically 5 minutes for ephemeral caches), caching saves money.

**Structural tip:** Put your static content first — system context, tools definitions, few-shot examples — and dynamic content last. The cache key is the prefix; anything after the cacheable marker is always freshly processed.

```python
# Good: static context first, user query last
messages = [
    {"role": "user", "content": STATIC_EXAMPLES},   # cached
    {"role": "assistant", "content": "Understood."},  # cached
    {"role": "user", "content": user_query}           # fresh each time
]

# Bad: user query inserted into the middle
# breaks cache key, no savings
```

## Request Batching: Serial is Usually the Wrong Default

Many pipelines process items one at a time when the items don't actually depend on each other. Batch APIs exist precisely for this: you submit a file of requests, they run asynchronously, and you pay roughly half the standard per-token price.

```python
import anthropic
import json

client = anthropic.Anthropic()

# Build a batch from a list of independent items
requests = [
    {
        "custom_id": f"summary-{i}",
        "params": {
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 256,
            "messages": [
                {"role": "user", "content": f"Summarize in 2 sentences: {article}"}
            ]
        }
    }
    for i, article in enumerate(articles)
]

# Submit the batch
batch = client.messages.batches.create(requests=requests)
print(f"Batch ID: {batch.id}, status: {batch.processing_status}")

# Poll until complete (in production, use a webhook or scheduled check)
import time
while True:
    batch = client.messages.batches.retrieve(batch.id)
    if batch.processing_status == "ended":
        break
    time.sleep(30)

# Process results
for result in client.messages.batches.results(batch.id):
    if result.result.type == "succeeded":
        print(f"{result.custom_id}: {result.result.message.content[0].text}")
```

Batch processing suits any workflow where you can tolerate up to a few hours of latency: nightly report generation, background document tagging, bulk content moderation, offline analytics.

**Model selection matters here too.** Batch jobs that don't require the strongest model are a good place to test smaller, cheaper models. A task that costs $5 with Claude Opus via batch may cost $0.50 with Claude Haiku — and for many classification or summarization tasks, Haiku performs just as well.

## Token Budget Controls: Capping What You Actually Need

The third lever is `max_tokens`. It sounds obvious but teams routinely set it too high — "just in case" — and end up paying for tokens the model generates but the application never uses.

For structured output tasks (classification, entity extraction, JSON generation), the output is almost always short and predictable. Set `max_tokens` tightly.

For extended thinking tasks, Claude 3.7+ models accept a `thinking` block with its own budget:

```python
response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 8000   # thinking uses at most this many tokens
    },
    messages=[{"role": "user", "content": complex_reasoning_task}]
)
```

Without a budget, a reasoning-heavy prompt can burn tens of thousands of thinking tokens on a problem that only needed a few hundred. Setting an explicit budget forces the model to be more efficient with its internal chain-of-thought.

**Output length signals:** if you consistently see responses much shorter than your `max_tokens` ceiling, you're probably fine. If you're hitting the ceiling often, that's worth investigating — sometimes it means truncated output (bad), sometimes it means over-generation (wasteful), and sometimes it means the task genuinely needs more space.

## Putting It Together: A Cost-Optimized Pipeline

Here's how these three techniques compose in a realistic document-processing pipeline:

```python
from anthropic import Anthropic

client = Anthropic()

EXTRACTION_SYSTEM = """
You extract structured data from documents. Always respond with valid JSON only.
[... static schema documentation and examples ...]
"""

def extract_batch(documents: list[str]) -> list[dict]:
    requests = []
    for i, doc in enumerate(documents):
        requests.append({
            "custom_id": f"doc-{i}",
            "params": {
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 512,           # tight ceiling for JSON output
                "system": [
                    {
                        "type": "text",
                        "text": EXTRACTION_SYSTEM,
                        "cache_control": {"type": "ephemeral"}  # cache the schema
                    }
                ],
                "messages": [
                    {"role": "user", "content": f"Extract data from:\n\n{doc}"}
                ]
            }
        })

    batch = client.messages.batches.create(requests=requests)
    # ... poll and return results
```

This pipeline uses all three levers: batching for 50% off, caching the system prompt across the batch, and a tight `max_tokens` for structured output. For a workload processing 10,000 documents a day, this combination typically reduces costs by 60-80% versus naive per-request calls with a large uncached system prompt.

## What to Measure

Cost optimization without measurement is guesswork. Track these per-request metrics:

- **Cache hit rate** — if it's below 70% for a prompt you expect to be mostly static, something in the prefix is changing unexpectedly
- **Output token/max_tokens ratio** — consistently below 30% suggests you can tighten the ceiling
- **Batch vs real-time split** — what fraction of your requests genuinely need sub-second latency?

Most providers expose these in usage metadata on every response:

```python
usage = response.usage
print(f"Cache read tokens: {usage.cache_read_input_tokens}")
print(f"Cache write tokens: {usage.cache_creation_input_tokens}")
print(f"Output tokens: {usage.output_tokens}")
```

Log these, aggregate them, and set alerts. An unexpected drop in cache hit rate is often the first signal of a prompt-formatting bug.

## Conclusion

Inference cost optimization comes down to three questions: Am I re-sending the same static context every request? Am I processing things serially when they could run in a batch? Am I letting the model generate more output than the task needs?

Prompt caching, batch APIs, and tight token budgets each address one of these questions. Applied together to the right workloads, they routinely cut LLM costs by half or more — without touching model quality or the user experience. The goal isn't to be cheap; it's to spend your AI budget on the parts of your system where it actually matters.
