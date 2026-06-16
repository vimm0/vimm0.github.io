---
layout: post
title: "LLM Cost Optimization in Production: Prompt Caching, Model Routing, and Batch APIs"
date: 2026-06-16 08:00:00 +0545
categories: [ai, backend]
tags: [llm, cost-optimization, prompt-caching, model-routing, batch-api, production]
---

Running AI features in production is genuinely exciting — until the billing dashboard arrives. A single high-traffic feature using a frontier model can easily generate thousands of dollars per day in token costs. For most teams, this is the hidden ceiling on how much AI they can actually ship.

The good news is that there are three well-understood techniques that can cut LLM costs by 50–90% without degrading quality: prompt caching, intelligent model routing, and batch processing. Used together, they make the economics of production AI dramatically more sustainable.

## The Anatomy of LLM Cost

Before optimizing, it helps to understand where money goes. LLM APIs charge per input token and per output token, with input generally cheaper than output. But the hidden cost driver is usually **repeated context** — the same system prompt, few-shot examples, document context, or tool definitions sent on every request.

For a customer support agent, the system prompt might be 2,000 tokens. If you handle 100,000 requests per day, you're burning 200 million tokens just on the system prompt. That's before any actual user input or model responses.

## Technique 1: Prompt Caching

Prompt caching lets you mark portions of your prompt as cacheable. The API provider stores the KV (key-value) cache from processing that prefix, and subsequent requests that share the same prefix pay a fraction of the normal input cost — typically 50–90% less for cached tokens.

Anthropic's prompt caching uses `cache_control` markers:

```python
import anthropic

client = anthropic.Anthropic()

SYSTEM_PROMPT = """You are a senior technical support agent for Acme SaaS...
[2,000 tokens of instructions, knowledge base, and examples]
"""

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"}
        }
    ],
    messages=[
        {"role": "user", "content": user_message}
    ]
)

# Check cache usage in the response
print(response.usage.cache_read_input_tokens)   # tokens served from cache
print(response.usage.cache_creation_input_tokens)  # tokens written to cache
```

The cache lasts for 5 minutes (refreshed on each hit), which works well for high-traffic applications. For batch jobs, you may need to structure requests to hit the cache within that window.

**What to cache:** System prompts, static context (product catalogs, documentation, policy documents), few-shot examples, tool definitions, and retrieved documents that are shared across many requests.

**What not to cache:** The dynamic part of each request — the actual user query and conversation history that changes per user.

## Technique 2: Intelligent Model Routing

Not every task requires a frontier model. Routing requests to the right model for the task is often the single highest-leverage optimization.

A practical routing taxonomy:

| Task Type | Appropriate Model Tier |
|-----------|----------------------|
| Simple classification, extraction | Small/fast model |
| Structured data generation | Mid-tier model |
| Complex reasoning, code generation | Frontier model |
| Creative writing, nuanced synthesis | Frontier model |

Here's a simple router implementation:

```python
from enum import Enum
from anthropic import Anthropic

client = Anthropic()

class TaskComplexity(Enum):
    SIMPLE = "haiku"      # Classification, extraction, simple Q&A
    MEDIUM = "sonnet"     # Code generation, multi-step reasoning
    COMPLEX = "opus"      # Novel reasoning, architecture decisions

def classify_request_complexity(user_message: str) -> TaskComplexity:
    """Use a cheap model to classify request complexity."""
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=10,
        system="Classify as SIMPLE, MEDIUM, or COMPLEX. Reply with only one word.",
        messages=[{"role": "user", "content": user_message}]
    )
    label = response.content[0].text.strip().upper()
    return TaskComplexity[label] if label in TaskComplexity.__members__ else TaskComplexity.MEDIUM

def route_and_respond(user_message: str) -> str:
    complexity = classify_request_complexity(user_message)
    model_map = {
        TaskComplexity.SIMPLE: "claude-haiku-4-5-20251001",
        TaskComplexity.MEDIUM: "claude-sonnet-4-6",
        TaskComplexity.COMPLEX: "claude-opus-4-8",
    }
    model = model_map[complexity]
    response = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[{"role": "user", "content": user_message}]
    )
    return response.content[0].text
```

The classifier call itself is cheap (a few tokens on a fast model), and it pays for itself many times over when it routes even 30% of requests to a smaller model.

A more production-grade approach uses a confidence threshold and falls back to the frontier model when unsure. You can also train a lightweight local classifier (a fine-tuned BERT or similar) to make routing decisions with zero API cost.

## Technique 3: Batch Processing

For workloads that don't require real-time responses — document analysis, data enrichment, content moderation, embeddings — batch APIs offer 50% cost reduction with higher rate limits.

The tradeoff: results are returned asynchronously, typically within 24 hours.

```python
import anthropic
import json

client = anthropic.Anthropic()

# Build a batch of requests
requests = []
documents = load_documents_to_analyze()  # your data source

for doc in documents:
    requests.append({
        "custom_id": f"doc-{doc['id']}",
        "params": {
            "model": "claude-sonnet-4-6",
            "max_tokens": 512,
            "messages": [
                {
                    "role": "user",
                    "content": f"Summarize this document in 3 bullet points:\n\n{doc['content']}"
                }
            ]
        }
    })

# Submit the batch
batch = client.messages.batches.create(requests=requests)
print(f"Batch created: {batch.id}")
print(f"Status: {batch.processing_status}")

# Poll for completion (or use webhooks in production)
import time

while True:
    batch = client.messages.batches.retrieve(batch.id)
    if batch.processing_status == "ended":
        break
    print(f"Still processing... ({batch.request_counts.processing} remaining)")
    time.sleep(60)

# Process results
results = {}
for result in client.messages.batches.results(batch.id):
    if result.result.type == "succeeded":
        results[result.custom_id] = result.result.message.content[0].text
    else:
        print(f"Failed: {result.custom_id} — {result.result.error}")
```

Batch processing is particularly powerful for:
- **Nightly data pipelines**: Enriching records, classifying content, generating embeddings
- **Bulk document processing**: Contracts, reports, support tickets
- **Offline evaluation**: Running your test suite against new model versions

## Combining All Three Techniques

The real leverage comes from using these techniques together. Here's how a production system might layer them:

1. **Every request uses prompt caching** — the system prompt and static context are always cached
2. **A fast classifier routes each request** — simple queries go to a small model, complex ones to frontier
3. **Non-urgent background jobs use the batch API** — analysis, summarization, embedding generation

For a customer-facing AI feature with 100,000 requests/day:
- Prompt caching: ~70% reduction on input tokens for cached prefix
- Model routing: ~60% of requests routed to smaller models
- Combined effect: 80–90% cost reduction vs. naive implementation

## Monitoring Cost in Production

Optimization is only useful if you can measure it. Track these metrics:

```python
# After each API call, log cost data
def log_usage(response, model: str, task_type: str):
    usage = response.usage
    metrics.record({
        "model": model,
        "task_type": task_type,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "cache_read_tokens": getattr(usage, "cache_read_input_tokens", 0),
        "cache_write_tokens": getattr(usage, "cache_creation_input_tokens", 0),
    })
```

Set up cost alerts by model tier, task type, and user segment. When costs spike, you want to know immediately — before the bill arrives.

## Conclusion

LLM costs are controllable. Prompt caching eliminates the biggest waste — paying to re-process the same context on every request. Model routing ensures you're using an appropriately-sized model for each task. Batch APIs cut costs in half for workloads that can tolerate latency.

None of these require changing your product logic or accepting lower quality. They're infrastructure-level optimizations that compound on top of each other. Implementing all three together typically brings costs to a level where scaling AI features is a business decision, not a budget crisis.

Start with prompt caching — it's one API flag and the payoff is immediate. Then add a simple complexity classifier for model routing. Finally, identify which of your workloads are actually batch-compatible and move them off the real-time path. Within a sprint, you'll have a dramatically more sustainable AI cost structure.
