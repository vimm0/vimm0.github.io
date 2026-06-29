---
layout: post
title: "Context Caching in Production: Cutting LLM Costs and Latency at Scale"
date: 2026-06-29 08:00:00 +0545
categories: [AI, Performance]
tags: [llm, prompt-caching, context-caching, cost-optimization, production-ai, anthropic, latency]
---

If you're running LLMs in production at any meaningful scale, token costs and latency are the two problems that keep showing up in your budget reports. One of the most impactful — and underutilized — techniques to tackle both simultaneously is **context caching**, sometimes called prompt caching or KV caching at the API level.

This post breaks down how context caching works, when to use it, how to implement it with real code, and what the gotchas are in production.

## What Is Context Caching?

Large language models process tokens through a transformer's attention mechanism, building up a key-value (KV) cache as they go. Normally, every new request starts from scratch — even if 90% of the prompt is identical to the last request. That repeated computation costs tokens, time, and money.

**Context caching** lets providers cache the KV state of a prompt prefix and reuse it across requests. You pay full price to process tokens once; subsequent requests that share the cached prefix pay a fraction of the normal rate (often 10–25% of input token cost) and get faster responses because the model skips recomputation.

The economics are compelling:
- Anthropic's prompt caching charges **10% of normal input cost** for cache hits on Claude 3.5+ models
- Cache reads are also faster — Claude reports roughly **2–5x lower latency** for cached prefixes
- OpenAI's context caching on GPT-4o charges **50% of normal input cost** for cache hits

For applications with large system prompts, extensive tool definitions, or long documents that stay constant across requests, this is essentially free money on the table.

## When Caching Pays Off

Context caching works best when you have a large, stable prefix followed by variable user content. Common patterns:

**Long system prompts**: A detailed system prompt (persona, instructions, constraints) that doesn't change across user sessions. If it's 2000 tokens and you serve 100,000 requests/day, you're processing 200M tokens in system prompts alone. With caching, that becomes ~20M tokens in cost terms.

**Document Q&A**: Upload a large document or codebase as context once, then answer many questions against it. The document stays in the cache; only the questions vary.

**Few-shot examples**: Large collections of examples that establish model behavior. These are ideal cache candidates — expensive to process, never changing.

**Tool definitions**: If your agent has 30+ tool definitions at ~50 tokens each, that's 1500 tokens per request. Cache them.

**Conversational history up to a stable point**: Cache everything up to a checkpoint in a long conversation, then extend from there.

## Implementation: Anthropic Prompt Caching

Anthropic's API uses an explicit `cache_control` marker — you tell it exactly where to cache. This is more predictable than implicit caching.

```python
import anthropic

client = anthropic.Anthropic()

# Large system prompt + tools — cache both
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": LARGE_SYSTEM_PROMPT,  # e.g. 2000+ tokens
            "cache_control": {"type": "ephemeral"}
        }
    ],
    tools=[
        {
            "name": "search_docs",
            "description": "Search the knowledge base",
            "input_schema": { ... },
            "cache_control": {"type": "ephemeral"}  # cache tool definitions
        },
        # ... more tools
    ],
    messages=[
        {"role": "user", "content": user_message}
    ]
)

# Check cache performance in usage stats
usage = response.usage
print(f"Cache read tokens: {usage.cache_read_input_tokens}")
print(f"Cache write tokens: {usage.cache_creation_input_tokens}")
print(f"Regular input tokens: {usage.input_tokens}")
```

The `cache_control: {"type": "ephemeral"}` marker tells Claude to cache up to that point. The cache TTL is **5 minutes** — requests within that window reuse the cached KV state.

For document Q&A, cache the document itself:

```python
def ask_about_document(document_text: str, question: str) -> str:
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system="You are a helpful assistant that answers questions about documents.",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"Here is the document:\n\n{document_text}",
                        "cache_control": {"type": "ephemeral"}
                    },
                    {
                        "type": "text",
                        "text": f"\nQuestion: {question}"
                    }
                ]
            }
        ]
    )
    return response.content[0].text
```

The document is cached on the first call and reused for subsequent questions — as long as they arrive within the 5-minute TTL window.

## Implementation: OpenAI Prompt Caching

OpenAI's approach is implicit — no markers needed. The API automatically caches prompt prefixes longer than 1024 tokens. You just need to structure your prompts so the stable prefix comes first.

```python
from openai import OpenAI

client = OpenAI()

def chat_with_caching(system_prompt: str, conversation_history: list, new_message: str):
    messages = [
        {"role": "system", "content": system_prompt},  # stable — cached automatically
        *conversation_history,                           # grows over time
        {"role": "user", "content": new_message}
    ]
    
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages
    )
    
    # Cache stats in the usage object
    usage = response.usage
    if hasattr(usage, 'prompt_tokens_details'):
        cached = usage.prompt_tokens_details.cached_tokens
        print(f"Cached tokens: {cached} / {usage.prompt_tokens}")
    
    return response.choices[0].message.content
```

The key constraint: the **cached prefix must be identical** — same tokens in the same order. Even a single changed character before the cache boundary busts the cache. This means your system prompt must be completely static; don't interpolate anything dynamic into it.

## Production Patterns

### Track Cache Hit Rate

Cache hits aren't guaranteed on the first call, and hit rates degrade if your system prompts vary. Instrument your cache performance:

```python
from dataclasses import dataclass
from prometheus_client import Counter, Histogram

cache_hits = Counter('llm_cache_hits_total', 'LLM prompt cache hits')
cache_misses = Counter('llm_cache_misses_total', 'LLM prompt cache misses')
cache_savings = Counter('llm_tokens_saved_total', 'Tokens saved via caching')

def track_cache_performance(usage):
    if hasattr(usage, 'cache_read_input_tokens') and usage.cache_read_input_tokens > 0:
        cache_hits.inc()
        cache_savings.inc(usage.cache_read_input_tokens)
    else:
        cache_misses.inc()
```

Target cache hit rates above 80% for high-volume endpoints. Below that, something is busting your cache unnecessarily.

### Warm the Cache Proactively

For batch workloads, send a "warmup" request before the main burst to ensure the cache is populated:

```python
import asyncio

async def warm_cache_then_process(system_prompt: str, items: list[str]) -> list[str]:
    # Warm the cache with a cheap throwaway request
    await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": "hi"}]
    )
    
    # Now fire all real requests — they'll hit the warm cache
    tasks = [process_item(system_prompt, item) for item in items]
    return await asyncio.gather(*tasks)
```

### Separate Static and Dynamic Prompt Segments

Never mix dynamic content into your cache-eligible prefix. A common mistake:

```python
# BAD — timestamp busts cache every second
system_prompt = f"You are a helpful assistant. Current time: {datetime.now()}"

# GOOD — dynamic content goes in the user turn
system_prompt = "You are a helpful assistant."
user_message = f"Current time: {datetime.now()}\n\n{actual_question}"
```

### Multi-Turn Conversation Checkpointing

For long conversations, cache a "checkpoint" of the conversation history up to a stable point:

```python
def build_messages_with_checkpoint(history: list, checkpoint_index: int, new_message: str):
    messages = []
    
    for i, msg in enumerate(history):
        if i == checkpoint_index:
            # Mark the checkpoint — everything before here gets cached
            messages.append({
                **msg,
                "cache_control": {"type": "ephemeral"} if msg["role"] == "user" else None
            })
        else:
            messages.append(msg)
    
    messages.append({"role": "user", "content": new_message})
    return messages
```

## Cost Math: A Real Example

Say you're building a coding assistant with:
- 3000-token system prompt (instructions, coding standards, examples)
- 1500-token tool definitions
- Average 500-token user message
- 100,000 requests/day on Claude Sonnet

Without caching:
- Input: (3000 + 1500 + 500) × 100,000 = 500M tokens/day
- At $3/MTok: **$1,500/day**

With caching (assuming 90% hit rate):
- Cache writes: 4500 × 10,000 (10% misses) = 45M tokens at $3.75/MTok = $169
- Cache reads: 4500 × 90,000 (90% hits) at $0.30/MTok = $122
- User messages: 500 × 100,000 = 50M tokens at $3/MTok = $150
- Total: **$441/day** — a **71% reduction**

The breakeven is essentially immediate on anything above a few thousand requests per day with large system prompts.

## Limitations and Gotchas

**TTL is short**: Anthropic's 5-minute TTL means caching doesn't help for low-traffic endpoints. If requests are spaced more than 5 minutes apart, you're always paying cache write costs with no reads.

**Minimum cacheable size**: Anthropic requires at least 1024 tokens to cache. Short system prompts don't qualify. OpenAI's minimum is also 1024 tokens.

**No persistence across models**: Switching model versions busts the cache. Pin to a specific model version in production.

**Cost of cache writes**: On Anthropic, cache writes cost 25% *more* than normal input tokens. If your hit rate is low, you're paying a surcharge for nothing. Model the math before assuming caching helps.

**Streaming and caching**: Caching works with streaming responses, but the cache must be populated (via a non-streaming warmup or a previous request) to benefit.

## Conclusion

Context caching is one of the highest-ROI optimizations available for production LLM systems. The implementation is straightforward — a few extra fields in your API calls — but the cost and latency savings compound dramatically at scale.

The mental model shift: stop thinking of your system prompt as "part of each request" and start thinking of it as **shared infrastructure** that gets loaded once and amortized across many requests. Design your prompts with a clear stable prefix (everything cacheable) and a variable suffix (user-specific content), and you'll extract most of the available benefit.

For teams spending more than a few hundred dollars a month on LLM API costs, auditing your prompt structure for cache eligibility is worth doing this week.
