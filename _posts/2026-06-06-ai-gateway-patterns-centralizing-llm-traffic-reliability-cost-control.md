---
layout: post
title: "AI Gateway Patterns: Centralizing LLM Traffic for Reliability and Cost Control"
date: 2026-06-06 10:00:00 +0545
categories: [AI, Infrastructure, Architecture]
tags: [LLM, AI Gateway, Cost Optimization, Prompt Caching, Load Balancing, MLOps, Production AI]
---

## Introduction

In the early days of integrating large language models into applications, teams would scatter `openai.ChatCompletion.create()` calls directly across their codebase — in API handlers, background workers, CLI scripts, and data pipelines. It worked. Until it didn't.

As AI usage matures, the direct-call pattern creates a web of problems: costs are invisible until the monthly bill arrives, retry logic is duplicated across every service, model migrations require grep-and-replace across dozens of files, and there's no single place to observe what your LLM traffic actually looks like.

The AI gateway pattern solves this. An AI gateway is a centralized proxy layer that sits between your application code and LLM providers. Like an API gateway for HTTP traffic, it owns cross-cutting concerns — routing, caching, rate limiting, fallbacks, observability, and cost allocation — so individual services don't have to.

This post covers how to design and operate an AI gateway in production.

## The Core Problem: Scattered LLM Calls

Consider a typical product with AI features at multiple layers:

```python
# In the search service
response = openai_client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": query}]
)

# In the content moderation worker
response = anthropic_client.messages.create(
    model="claude-opus-4-8",
    messages=[{"role": "user", "content": text}]
)

# In the customer support bot
response = openai_client.chat.completions.create(
    model="gpt-4o-mini",
    messages=history
)
```

Each call site handles (or ignores) its own retries, timeouts, error handling, and logging. There's no shared budget tracking, no prompt caching strategy, and swapping providers requires touching every file.

## What an AI Gateway Provides

A well-designed AI gateway centralizes:

**1. Provider Abstraction**  
Your application code targets a single API endpoint and schema. The gateway translates requests to provider-specific formats. Migrating from GPT-4o to Claude or Gemini becomes a configuration change, not a code change.

**2. Intelligent Routing**  
Route requests to different models based on cost, latency, task type, or load. Simple classification tasks go to a cheap small model; complex reasoning goes to a frontier model. The gateway makes this decision, not the caller.

**3. Prompt Caching**  
Cache the results of identical or semantically similar prompts. For high-volume applications with repetitive patterns — document summarization, structured data extraction, FAQ responses — cache hit rates above 40% are common, directly cutting costs.

**4. Fallback and Retry**  
If a provider returns a 429 or 503, the gateway automatically retries or fails over to a backup provider. Callers receive a response without knowing a failover occurred.

**5. Unified Observability**  
Every LLM call is logged with latency, token counts, model, cost estimate, and caller identity. Dashboards reveal which features drive cost, where latency lives, and when quality degrades.

## Building a Minimal AI Gateway

Here's a lightweight gateway implementation in Python using FastAPI:

```python
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
import anthropic
import openai
import hashlib
import json
import time
from typing import Literal

app = FastAPI()

# In-memory cache (use Redis in production)
cache: dict[str, dict] = {}

class CompletionRequest(BaseModel):
    messages: list[dict]
    model: str = "auto"
    max_tokens: int = 1024
    cache_ttl: int = 3600  # seconds

def cache_key(request: CompletionRequest) -> str:
    payload = json.dumps({
        "messages": request.messages,
        "model": request.model,
        "max_tokens": request.max_tokens
    }, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()

def select_model(task_hint: str) -> tuple[str, str]:
    """Route to provider+model based on task hint in model field."""
    if task_hint == "auto" or task_hint == "fast":
        return ("anthropic", "claude-haiku-4-5-20251001")
    elif task_hint == "balanced":
        return ("anthropic", "claude-sonnet-4-6")
    elif task_hint == "powerful":
        return ("anthropic", "claude-opus-4-8")
    elif task_hint.startswith("openai/"):
        return ("openai", task_hint.split("/", 1)[1])
    return ("anthropic", task_hint)

async def call_anthropic(model: str, request: CompletionRequest) -> dict:
    client = anthropic.Anthropic()
    response = client.messages.create(
        model=model,
        max_tokens=request.max_tokens,
        messages=request.messages
    )
    return {
        "content": response.content[0].text,
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
        "provider": "anthropic",
        "model": model
    }

async def call_openai(model: str, request: CompletionRequest) -> dict:
    client = openai.OpenAI()
    response = client.chat.completions.create(
        model=model,
        max_tokens=request.max_tokens,
        messages=request.messages
    )
    usage = response.usage
    return {
        "content": response.choices[0].message.content,
        "input_tokens": usage.prompt_tokens,
        "output_tokens": usage.completion_tokens,
        "provider": "openai",
        "model": model
    }

@app.post("/v1/complete")
async def complete(request: CompletionRequest, http_request: Request):
    start = time.time()
    key = cache_key(request)

    # Check cache
    if key in cache and time.time() < cache[key]["expires_at"]:
        result = cache[key]["result"]
        result["cached"] = True
        return result

    # Route to provider
    provider, model = select_model(request.model)

    try:
        if provider == "anthropic":
            result = await call_anthropic(model, request)
        elif provider == "openai":
            result = await call_openai(model, request)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")
    except Exception as e:
        # Fallback: if primary fails, try secondary
        if provider == "anthropic":
            result = await call_openai("gpt-4o-mini", request)
            result["fallback"] = True
        else:
            raise

    # Store in cache
    cache[key] = {
        "result": result,
        "expires_at": time.time() + request.cache_ttl
    }

    result["latency_ms"] = int((time.time() - start) * 1000)
    result["cached"] = False
    return result
```

Your application services now call `http://ai-gateway/v1/complete` instead of provider SDKs directly:

```python
import httpx

async def classify_content(text: str) -> str:
    response = await httpx.AsyncClient().post(
        "http://ai-gateway/v1/complete",
        json={
            "model": "fast",  # gateway routes to cheapest capable model
            "messages": [{"role": "user", "content": f"Classify: {text}"}],
            "cache_ttl": 86400
        }
    )
    return response.json()["content"]
```

## Prompt Caching at Scale

Prompt caching deserves special attention. Many production workloads have high repetition:

- Document processing pipelines that run the same extraction prompt over thousands of documents
- Customer support bots where system prompts are large and stable
- RAG systems where context chunks repeat across queries

The naive approach caches exact prompt strings. A better approach uses content-addressed caching at the message level, so only the novel parts of a conversation are sent to the provider.

Anthropic's native prompt caching (available in the API with `cache_control` headers) goes even further — it caches the KV state of the transformer for your system prompt, cutting both latency and cost for subsequent requests that share the same prefix:

```python
response = anthropic_client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    system=[{
        "type": "text",
        "text": very_long_system_prompt,
        "cache_control": {"type": "ephemeral"}
    }],
    messages=[{"role": "user", "content": user_query}]
)

# cache_read_input_tokens tells you how many tokens were served from cache
print(response.usage.cache_read_input_tokens)
```

At the gateway layer, wrap this transparently: hash the system prompt, assign it a cache control block on first use, and all subsequent requests with the same system prompt pay a fraction of the token cost.

## Cost Allocation and Budgets

One of the most underappreciated gateway capabilities is per-team or per-feature cost tracking. Tag every request at the caller level:

```python
@app.post("/v1/complete")
async def complete(request: CompletionRequest, http_request: Request):
    team = http_request.headers.get("X-Team-Id", "unknown")
    feature = http_request.headers.get("X-Feature", "unknown")
    
    # ... execute request ...
    
    # Emit cost metric
    cost = estimate_cost(result["provider"], result["model"],
                         result["input_tokens"], result["output_tokens"])
    metrics.increment("llm.cost_usd", cost, tags={"team": team, "feature": feature})
    metrics.increment("llm.tokens_in", result["input_tokens"], tags={"team": team})
```

This makes it trivial to answer: "Which feature drove 60% of last month's AI spend?" and "Which team is over their weekly budget?" Budget enforcement can live entirely in the gateway without any application code changes.

## Production Considerations

**Latency overhead**: A well-implemented gateway adds 1–3ms of overhead. Use async I/O, keep the gateway colocated with your services, and avoid synchronous database calls in the hot path.

**Cache invalidation**: Prompt caches should be keyed on both content and model version. When you upgrade a model, old cache entries may produce different results — invalidate them.

**Streaming**: If your application uses streaming responses (SSE), the gateway must proxy the stream rather than buffer it. This complicates caching but is essential for responsive UIs.

**Observability tooling**: LiteLLM Proxy, Portkey, and Helicone offer mature hosted or self-hosted gateway solutions if you'd rather not build your own. They cover routing, caching, observability, and budget controls out of the box.

## Conclusion

The AI gateway pattern applies a lesson the web services world learned a decade ago: cross-cutting concerns belong in infrastructure, not application code. As LLM usage scales across an organization, the cost of scattered direct calls — in duplicated logic, invisible costs, and fragile provider coupling — compounds quickly.

Starting a gateway early is cheap. The minimal version is a thin proxy that logs every call and handles retries. You layer in caching, routing, and cost allocation as your needs grow. What you get back is a single pane of glass over your entire LLM traffic — and the ability to make infrastructure changes without touching application code.

For teams spending more than a few hundred dollars a month on LLM APIs, the ROI on a proper gateway is typically measured in weeks.
