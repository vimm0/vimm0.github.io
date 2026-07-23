---
layout: post
title: "AI Gateway Patterns: Managing LLM Traffic, Auth, and Rate Limiting in Production"
date: 2026-07-23 08:00:00 +0545
categories: [AI, Architecture]
tags: [ai-gateway, llm, rate-limiting, authentication, production, api-management]
---

As organizations scale their AI applications, a recurring pain point emerges: every team is solving the same problems independently. Authentication to multiple LLM providers, cost tracking per team, rate limiting to avoid runaway spend, fallback logic when one model is down — all of this ends up scattered across dozens of services. The answer that's emerged in 2026 is the **AI Gateway**: a dedicated infrastructure layer that sits between your applications and LLM providers.

This post covers the core patterns for building or adopting an AI gateway in production, including authentication, routing, rate limiting, observability, and fallback strategies.

## What Is an AI Gateway?

An AI gateway functions like a traditional API gateway but is purpose-built for LLM workloads. It intercepts all requests to AI providers (OpenAI, Anthropic, Google, self-hosted models, etc.) and applies cross-cutting concerns centrally:

- **Authentication & authorization** — manage API keys in one place
- **Cost tracking** — attribute token spend to teams, projects, or users
- **Rate limiting** — enforce spend and request budgets
- **Model routing** — send requests to the right model based on rules
- **Caching** — return cached responses for identical prompts
- **Fallback** — retry on a different model when the primary fails
- **Observability** — trace every LLM call for debugging

Popular options include open-source tools like LiteLLM Proxy and PortKey, as well as enterprise offerings from cloud providers.

## Pattern 1: Centralized Credential Management

The most immediate win from an AI gateway is removing API keys from individual services. Instead of every team storing `OPENAI_API_KEY` in their `.env`, they authenticate to the gateway using internal credentials and the gateway holds the provider keys.

```python
# Before: each service holds provider keys
import openai
client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])

# After: services authenticate to the gateway
client = openai.OpenAI(
    api_key=os.environ["GATEWAY_VIRTUAL_KEY"],  # internal key
    base_url="https://ai-gateway.internal/v1"
)
```

The gateway maps each virtual key to a team and enforces permissions. You can rotate provider keys, add new models, or switch providers without touching application code.

```yaml
# Gateway configuration (LiteLLM-style)
virtual_keys:
  - key: "sk-team-backend-prod"
    team_id: "backend"
    max_budget: 500.00      # monthly USD cap
    budget_duration: "1mo"
    models: ["gpt-4o", "claude-sonnet-5"]
  
  - key: "sk-team-ml-research"
    team_id: "ml-research"
    max_budget: 2000.00
    models: ["*"]            # all models allowed
```

## Pattern 2: Smart Model Routing

Not every request should go to your most expensive model. An AI gateway can route based on request properties, letting you optimize cost without changing application code.

```yaml
# Route by model alias — applications request "fast" or "smart"
model_list:
  - model_name: "fast"
    litellm_params:
      model: "claude-haiku-4-5"
      api_base: "https://api.anthropic.com"
  
  - model_name: "smart"
    litellm_params:
      model: "claude-opus-4-8"
      api_base: "https://api.anthropic.com"
  
  - model_name: "smart"      # fallback for "smart"
    litellm_params:
      model: "gpt-4o"
      api_base: "https://api.openai.com/v1"
```

You can extend this with custom routing logic based on request metadata:

```python
# Middleware that routes by request tags
@app.middleware("http")
async def route_by_tier(request: Request, call_next):
    body = await request.json()
    metadata = body.get("metadata", {})
    
    if metadata.get("tier") == "realtime":
        # Force fast model for latency-sensitive paths
        body["model"] = "fast"
    elif metadata.get("task") == "analysis":
        # Use powerful model for analytical tasks
        body["model"] = "smart"
    
    request._body = json.dumps(body).encode()
    return await call_next(request)
```

## Pattern 3: Semantic Caching

LLM calls are expensive. If your application frequently sends similar prompts (like FAQ answering, code documentation, or templated reports), semantic caching can dramatically cut costs. Unlike exact-match caching, semantic caching uses vector similarity to return cached responses for semantically equivalent prompts.

```python
from litellm.caching import Cache

# Configure semantic cache with Redis
litellm.cache = Cache(
    type="redis-semantic",
    host=os.environ["REDIS_HOST"],
    port=6379,
    similarity_threshold=0.92,   # 92% cosine similarity = cache hit
    embedding_model="text-embedding-3-small"
)

# Subsequent similar requests get cached responses
response = litellm.completion(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Explain async/await in Python"}],
    cachecontrol="cache"
)
print(response._hidden_params["cache_hit"])  # True on repeated calls
```

Real-world cache hit rates of 30-50% are achievable for internal tools where users ask similar questions repeatedly. At $15/1M output tokens for top models, this adds up quickly.

## Pattern 4: Rate Limiting and Budget Guardrails

Runaway AI costs are a real risk. A misconfigured loop, an unexpected traffic spike, or a malicious user can generate thousands of dollars in API charges in minutes. The gateway enforces hard limits:

```python
# Budget exceeded → gateway returns 429 before hitting provider
try:
    response = client.chat.completions.create(
        model="claude-opus-4-8",
        messages=[{"role": "user", "content": prompt}],
        extra_headers={"x-team-id": "backend"}
    )
except openai.RateLimitError as e:
    if "budget" in str(e).lower():
        # Handle budget exceeded gracefully
        return {"error": "AI budget exhausted for this month", "fallback": True}
    raise
```

Rate limiting operates at multiple levels simultaneously:

| Level | Limit type | Example |
|-------|-----------|---------|
| Provider | Requests per minute | Anthropic: 2000 RPM |
| Gateway | Tokens per team per day | Backend team: 5M tokens/day |
| Virtual key | Spend per month | sk-team-...: $500/month |
| User | Requests per minute | Individual user: 60 RPM |

## Pattern 5: Fallback Chains

Provider outages happen. Having a fallback chain ensures continuity:

```yaml
# LiteLLM fallback configuration
router_settings:
  allowed_fails: 3
  cooldown_time: 60     # seconds before retrying failed provider

fallbacks:
  - "claude-opus-4-8":
      - "claude-sonnet-5"
      - "gpt-4o"
  - "claude-sonnet-5":
      - "gpt-4o"
      - "gemini-2.0-pro"
```

The application code doesn't need to know about failover — it just calls `claude-opus-4-8` and the gateway handles retries transparently. You can also weight models for A/B testing:

```yaml
model_list:
  - model_name: "default"
    litellm_params:
      model: "claude-sonnet-5"
    weight: 70    # 70% of traffic
  
  - model_name: "default"
    litellm_params:
      model: "gpt-4o"
    weight: 30    # 30% of traffic (A/B test)
```

## Pattern 6: Prompt Logging and Audit Trails

In regulated industries, you may need to log every LLM interaction for compliance. Even outside compliance requirements, full request/response logging is invaluable for debugging, prompt improvement, and cost analysis.

```python
# Gateway callback for logging
import litellm

def log_to_datastore(kwargs, response_obj, start_time, end_time):
    log_entry = {
        "timestamp": start_time.isoformat(),
        "model": kwargs.get("model"),
        "team_id": kwargs.get("metadata", {}).get("team_id"),
        "user_id": kwargs.get("user"),
        "prompt_tokens": response_obj.usage.prompt_tokens,
        "completion_tokens": response_obj.usage.completion_tokens,
        "latency_ms": (end_time - start_time).total_seconds() * 1000,
        "cost_usd": litellm.completion_cost(completion_response=response_obj)
    }
    audit_db.insert(log_entry)

litellm.success_callback = [log_to_datastore]
```

This data feeds dashboards showing cost per team, latency trends, model performance comparisons, and anomaly detection when spend spikes unexpectedly.

## Deployment Considerations

For production deployments, run the gateway as a horizontally scalable service behind a load balancer. Key considerations:

- **State**: Rate limit counters must be shared — use Redis, not in-process memory
- **Latency**: The gateway adds ~1-5ms; keep it co-located with your application tier
- **Security**: Restrict gateway ingress to internal networks; never expose it publicly
- **HA**: Run at least 3 replicas; provider API calls are stateless so failover is trivial

```dockerfile
FROM ghcr.io/berriai/litellm:main-latest

COPY config.yaml /app/config.yaml
ENV LITELLM_LOG="INFO"

CMD ["--config", "/app/config.yaml", "--port", "4000", "--num_workers", "4"]
```

## Conclusion

An AI gateway centralizes the operational concerns that otherwise creep into every service that touches an LLM. Authentication, cost tracking, rate limiting, routing, caching, and fallback logic are all better managed in one place than scattered across teams.

The patterns here apply whether you're running open-source tools like LiteLLM or building a custom proxy. The key insight is treating LLM providers the same way you'd treat any third-party dependency: behind an abstraction layer your team controls. As model providers evolve rapidly, that abstraction layer becomes the difference between a painful migration and a one-line config change.

Start with centralized credentials and basic rate limiting — the ROI is immediate. Layer in semantic caching and model routing once you have visibility into your actual usage patterns.
