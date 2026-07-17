---
layout: post
title: "AI Model Routing and Load Balancing: Optimizing LLM Traffic in Production"
date: 2026-07-17 08:00:00 +0545
categories: [AI, Production]
tags: [llm, routing, load-balancing, cost-optimization, ai-infrastructure, production]
---

Not every user request needs GPT-4 or Claude Opus. Sending every query to your most powerful model is like shipping all packages overnight when most of them could go standard mail — it works, but you're burning budget on speed you don't need.

AI model routing solves this: intelligently directing each request to the model best suited for it based on complexity, cost, latency requirements, and current availability. Production AI systems that get this right often cut costs by 60–80% while maintaining or even improving overall quality.

## What Is AI Model Routing?

Model routing is a middleware layer that sits between your application and your LLM providers. Instead of hardcoding which model handles requests, the router evaluates each incoming request and selects the optimal model dynamically.

```python
from anthropic import Anthropic

client = Anthropic()

def route_request(prompt: str, context: dict) -> str:
    complexity = classify_complexity(prompt)
    
    model_map = {
        "simple":   "claude-haiku-4-5-20251001",
        "medium":   "claude-sonnet-5",
        "complex":  "claude-opus-4-8",
    }
    
    model = model_map[complexity]
    
    response = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )
    
    return response.content[0].text
```

The key challenge is that `classify_complexity` function — getting it right is what separates a naive router from one that actually saves money without sacrificing quality.

## Routing Strategies

### 1. Rule-Based Routing

The simplest approach: define heuristics based on observable request properties.

```python
def classify_complexity(prompt: str) -> str:
    token_count = len(prompt.split())
    
    # Simple factual or short tasks
    if token_count < 50 and not any(kw in prompt.lower() 
        for kw in ["analyze", "compare", "explain", "write", "code"]):
        return "simple"
    
    # Code generation, analysis, long-form writing
    if any(kw in prompt.lower() 
        for kw in ["code", "implement", "debug", "architecture", "design"]):
        return "complex"
    
    return "medium"
```

**Pros:** Fast, zero latency overhead, fully predictable.  
**Cons:** Brittle. Rule coverage gaps cause routing errors, and maintenance becomes a nightmare as use cases grow.

### 2. Classifier-Based Routing

Use a lightweight ML model or a cheap LLM call to classify requests before routing them.

```python
import anthropic

_router_client = anthropic.Anthropic()

def classify_with_llm(prompt: str) -> str:
    """Use Haiku to classify — costs fractions of a cent."""
    classification = _router_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=10,
        system=(
            "Classify the complexity of this user request as one word: "
            "simple, medium, or complex. "
            "Simple: factual Q&A, translations, short summaries. "
            "Medium: explanations, structured writing, basic code. "
            "Complex: multi-step reasoning, large codebases, nuanced analysis."
        ),
        messages=[{"role": "user", "content": prompt[:500]}]
    )
    
    label = classification.content[0].text.strip().lower()
    return label if label in ("simple", "medium", "complex") else "medium"
```

This approach costs roughly $0.00025 per classification call — negligible compared to what you save by routing simple requests away from Opus.

### 3. Semantic Similarity Routing

For applications where you can pre-categorize request types (customer support, code help, creative writing), embed incoming requests and compare against category centroids.

```python
import numpy as np

CATEGORY_MODELS = {
    "customer_support": "claude-haiku-4-5-20251001",
    "code_generation":  "claude-opus-4-8",
    "creative_writing":  "claude-sonnet-5",
    "data_analysis":     "claude-sonnet-5",
}

def semantic_route(prompt: str, embedder, category_embeddings: dict) -> str:
    prompt_embedding = embedder.embed(prompt)
    
    best_category = max(
        category_embeddings,
        key=lambda cat: cosine_similarity(
            prompt_embedding, 
            category_embeddings[cat]
        )
    )
    
    return CATEGORY_MODELS[best_category]

def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
```

## Load Balancing Across Providers

Model routing isn't just about picking cheap vs. expensive — it's also about resilience. When a provider rate-limits you or goes down, you need automatic failover.

```python
import asyncio
import random
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class ModelEndpoint:
    provider: str
    model: str
    weight: int = 1
    max_rpm: int = 1000
    current_rpm: int = 0
    error_count: int = 0
    available: bool = True

class LoadBalancer:
    def __init__(self, endpoints: list[ModelEndpoint]):
        self.endpoints = endpoints
        self._lock = asyncio.Lock()

    async def get_endpoint(self) -> Optional[ModelEndpoint]:
        async with self._lock:
            available = [
                e for e in self.endpoints 
                if e.available and e.current_rpm < e.max_rpm
            ]
            
            if not available:
                return None
            
            # Weighted random selection
            total_weight = sum(e.weight for e in available)
            rand = random.uniform(0, total_weight)
            cumulative = 0
            for endpoint in available:
                cumulative += endpoint.weight
                if rand <= cumulative:
                    endpoint.current_rpm += 1
                    return endpoint
            
            return available[-1]

    async def report_error(self, endpoint: ModelEndpoint):
        async with self._lock:
            endpoint.error_count += 1
            if endpoint.error_count >= 3:
                endpoint.available = False
                # Schedule recovery check after 60s
                asyncio.create_task(self._recover_after(endpoint, 60))

    async def _recover_after(self, endpoint: ModelEndpoint, seconds: int):
        await asyncio.sleep(seconds)
        async with self._lock:
            endpoint.error_count = 0
            endpoint.available = True
```

## Fallback Chains

Beyond load balancing, implement explicit fallback chains so degradation is graceful rather than catastrophic.

```python
from typing import Callable

async def with_fallback(
    prompt: str,
    models: list[str],
    call_fn: Callable[[str, str], str]
) -> str:
    last_error = None
    
    for model in models:
        try:
            return await call_fn(prompt, model)
        except RateLimitError:
            continue
        except APIError as e:
            last_error = e
            continue
    
    raise RuntimeError(
        f"All models exhausted. Last error: {last_error}"
    )

# Usage
result = await with_fallback(
    prompt=user_query,
    models=["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
    call_fn=call_anthropic
)
```

## Tracking Routing Quality

A router you can't measure is a router you can't improve. Log every routing decision:

```python
import time
from dataclasses import dataclass

@dataclass
class RoutingEvent:
    request_id: str
    prompt_tokens: int
    selected_model: str
    routing_strategy: str
    latency_ms: float
    cost_usd: float
    user_rating: Optional[int] = None  # from thumbs up/down

def log_routing_decision(event: RoutingEvent):
    # Ship to your analytics pipeline (Datadog, PostHog, custom)
    analytics.track("llm_routing_decision", {
        "model": event.selected_model,
        "strategy": event.routing_strategy,
        "latency_ms": event.latency_ms,
        "cost_usd": event.cost_usd,
        "prompt_tokens": event.prompt_tokens,
    })
```

Track these metrics weekly:
- **Routing accuracy**: % of requests that needed escalation after initial routing
- **Cost per category**: are you over-routing to expensive models?
- **Latency by model**: is Haiku actually faster for your use case?
- **Fallback rate**: how often are you hitting backups?

## Real-World Cost Impact

Here's a typical routing distribution for a production AI assistant serving 1M requests/month:

| Request Type        | % of Traffic | Model Used      | Cost/1K tokens |
|---------------------|:------------:|-----------------|:--------------:|
| Simple lookups      |     40%      | Haiku           |    $0.001      |
| Explanations/Q&A    |     35%      | Sonnet          |    $0.015      |
| Complex analysis    |     25%      | Opus            |    $0.075      |

Without routing (all Opus): ~$75,000/month  
With routing: ~$28,000/month  
**Savings: 63%**

## Conclusion

AI model routing is one of the highest-leverage infrastructure improvements you can make once you're past initial deployment. The implementation investment is relatively modest — a few hundred lines of well-structured code — and the payoff scales linearly with traffic.

Start simple: a classifier-based router using Haiku to classify requests, routing to Haiku/Sonnet/Opus based on complexity. Add load balancing and fallback chains as your traffic grows. Instrument everything from day one — your routing quality data is what lets you tune the system over time.

The goal isn't to use the cheapest model. It's to use the *right* model for each request. When you get that right, quality goes up alongside cost going down.
