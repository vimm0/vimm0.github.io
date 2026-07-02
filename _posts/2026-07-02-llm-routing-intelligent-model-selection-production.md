---
layout: post
title: "LLM Routing in Production: Intelligently Selecting Models for Cost, Speed, and Quality"
date: 2026-07-02 08:00:00 +0545
categories: [AI, Engineering, Architecture]
tags: [llm, model-routing, cost-optimization, production-ai, inference, orchestration, multi-model]
---

Every production AI application eventually confronts the same economics problem: your best model is too expensive for high-volume traffic, your cheapest model is too weak for complex tasks, and your users don't want to wait for slow responses. The naive answer — pick one model and use it everywhere — leaves enormous value on the table.

LLM routing solves this by dispatching each request to the most appropriate model based on task complexity, latency requirements, cost budget, and quality thresholds. Done well, it cuts inference costs by 60–80% while maintaining or improving the quality your users actually experience.

## Why One Model Doesn't Fit All

The modern LLM landscape is explicitly tiered. You have small, fast, cheap models (Claude Haiku, GPT-4o-mini) good for classification, extraction, and simple Q&A. You have mid-tier capable models for reasoning-light generation tasks. You have frontier models (Claude Opus, GPT-4, Gemini Ultra) for complex reasoning, ambiguous instructions, and high-stakes outputs.

The reality of most applications: 70–80% of requests are simple enough that a small model handles them correctly. Only 20–30% genuinely need frontier capability. But because failure is invisible until you look at evals, teams default to the most capable model they trust and pay frontier prices for everything.

Routing is about making that 70/30 split explicit, measured, and automatic.

## The Core Routing Strategies

### Complexity-Based Routing

The most common approach: estimate request complexity before sending to the model, then route to the appropriate tier.

Complexity signals vary by domain, but common ones include:
- **Token count**: Longer inputs often signal harder tasks.
- **Question type classifiers**: A small trained classifier that labels requests as "factual lookup", "multi-step reasoning", "creative generation", etc.
- **Keyword heuristics**: Presence of words like "analyze", "compare", "explain why" correlates with harder tasks.
- **Historical similarity**: Embed the request and find similar past requests with known difficulty scores.

```python
import anthropic

client = anthropic.Anthropic()

def classify_complexity(request: str) -> str:
    """Use a tiny model to classify routing tier."""
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=10,
        system="Classify this request as 'simple' or 'complex'. Output only one word.",
        messages=[{"role": "user", "content": request}]
    )
    return response.content[0].text.strip().lower()

def route_request(request: str) -> str:
    complexity = classify_complexity(request)
    
    if complexity == "simple":
        model = "claude-haiku-4-5-20251001"
    else:
        model = "claude-opus-4-8"
    
    response = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[{"role": "user", "content": request}]
    )
    return response.content[0].text
```

The meta-question here: if classification is itself expensive, you lose the savings. Keep your classifier lightweight — a fine-tuned small model, a few embedding comparisons, or even pure heuristics.

### Cascade Routing

Instead of predicting complexity upfront, cascade routing tries the cheap model first and escalates if the output doesn't meet quality criteria.

```python
def cascade_route(request: str, quality_threshold: float = 0.85) -> dict:
    # Try cheap model first
    fast_response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[{"role": "user", "content": request}]
    )
    
    # Score the response quality
    quality_score = score_response(request, fast_response.content[0].text)
    
    if quality_score >= quality_threshold:
        return {"response": fast_response.content[0].text, "model": "haiku", "escalated": False}
    
    # Escalate to frontier model
    full_response = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[{"role": "user", "content": request}]
    )
    return {"response": full_response.content[0].text, "model": "opus", "escalated": True}
```

Cascade works best when the cheap model succeeds most of the time and quality scoring is cheap and reliable. The worst case is high escalation rates, where you pay twice for every request that cascades.

### Budget-Aware Routing

For applications with per-user or per-session budgets, route based on remaining spend:

```python
def budget_aware_route(request: str, user_id: str, session_budget_usd: float) -> str:
    spent = get_session_spend(user_id)
    remaining = session_budget_usd - spent
    
    # Reserve frontier tokens for when budget allows
    if remaining > 0.05:  # enough for ~2k tokens on Opus
        model = "claude-opus-4-8"
    elif remaining > 0.001:
        model = "claude-haiku-4-5-20251001"
    else:
        return "Session budget exhausted. Please upgrade or wait for reset."
    
    response = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[{"role": "user", "content": request}]
    )
    track_spend(user_id, calculate_cost(response))
    return response.content[0].text
```

This pattern works well for consumer-facing products where you want predictable unit economics per user.

## Building the Quality Scoring Layer

Cascade routing depends on fast, reliable quality scoring. Common approaches:

**LLM-as-judge (lightweight):** Use a small model to rate quality on a 1–5 scale. Fast and domain-general, but adds latency and cost.

**Semantic similarity:** Compare the response to a gold-standard answer or to responses from the frontier model on the same prompt. Works well for factual domains with ground truth.

**Refusal detection:** For safety-critical applications, detect if the small model refused or deflected a valid request. Automatic escalation on refusal keeps quality high for edge cases.

**Task-specific heuristics:** For structured output tasks (JSON extraction, code generation), validate the output against a schema. Parse failure = escalate.

```python
import json

def score_json_response(response: str, schema: dict) -> float:
    try:
        parsed = json.loads(response)
        # Check required fields
        required = schema.get("required", [])
        if all(k in parsed for k in required):
            return 1.0
        return 0.5
    except json.JSONDecodeError:
        return 0.0
```

## Latency-Aware Routing

Not every request needs the same speed. Background tasks (document summarization, batch enrichment) can tolerate higher latency for better quality. Real-time user-facing features (chat, autocomplete) need sub-second responses.

Tag requests with a latency class at intake:

```python
LATENCY_MODEL_MAP = {
    "realtime": "claude-haiku-4-5-20251001",      # <500ms target
    "interactive": "claude-sonnet-5",               # <2s target
    "batch": "claude-opus-4-8",                     # no latency constraint
}

def latency_route(request: str, latency_class: str) -> str:
    model = LATENCY_MODEL_MAP.get(latency_class, "claude-sonnet-5")
    response = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[{"role": "user", "content": request}]
    )
    return response.content[0].text
```

## Observability: The Non-Negotiable

Routing logic is only as good as your ability to audit it. Every routed request should log:

- Which model was selected
- Why it was selected (complexity score, latency class, budget state)
- Whether it escalated (for cascade routing)
- Response quality (if scored)
- Actual cost and latency

Without this, you're flying blind. You won't know if your classifier is misfiring, if escalation rates are creeping up, or if a model tier is silently degrading.

Aggregate these into a routing dashboard that shows:
- Model distribution over time (% requests to each tier)
- Escalation rate trend (cascade routing)
- Cost per 1k requests by route
- Quality score distribution by tier

The routing dashboard becomes your primary cost-quality lever — you tune thresholds by watching it in real time.

## Common Pitfalls

**Routing on gut instinct instead of evals.** The only way to know if your complexity classifier is calibrated correctly is to run offline evals: take a labeled dataset of easy/hard requests and measure classifier accuracy. Build this before shipping.

**Forgetting about prompt sensitivity.** Frontier models often tolerate vaguer prompts than small models. If you route the same prompt to a smaller model, you may need to add more explicit instructions. Build a prompt adapter layer into your router.

**Ignoring tail latency.** P50 latency looks fine; P99 is terrible. Cascade routing in particular can produce horrible tail latency on the requests that trigger escalation. Set hard timeouts on your fast model and escalate on timeout, not just quality failure.

**Over-routing to cheap models.** Cutting costs 80% by routing everything to Haiku sounds great until your quality evals tank and users churn. Always run a holdout evaluation before changing routing thresholds.

## Conclusion

LLM routing is the infrastructure layer that makes production AI economically viable at scale. The mental model is simple: classify each request, dispatch to the appropriate tier, score quality, escalate when needed. The execution requires discipline: labeled evals, comprehensive observability, and regular calibration cycles.

Start with a two-tier router — small model for simple requests, frontier for everything else — using a lightweight heuristic classifier. Instrument everything. Once you have baseline metrics, iterate toward cascade routing and budget-awareness as your traffic patterns become clear.

The teams running AI at the lowest cost-per-quality point aren't using smarter prompts. They're routing intelligently.
