---
layout: post
title: "Semantic Caching: Reducing LLM Costs and Latency at Scale"
date: 2026-05-24 08:00:00 +0545
categories: [AI, Backend]
tags: [llm, caching, semantic-search, vector-databases, cost-optimization, production-ai]
---

As LLM-powered applications mature, two problems surface at scale: cost and latency. A single GPT-4-class model call can cost $0.01–$0.10 and take 2–10 seconds. Multiply that by millions of daily users and the math gets uncomfortable fast. Traditional caching won't help — users rarely ask the *exact* same question twice. Semantic caching does.

## What Is Semantic Caching?

Semantic caching stores LLM responses indexed by the *meaning* of the query, not its exact text. When a new request arrives, the system checks whether a semantically similar query has been answered before. If the cached response is close enough, it's returned immediately — no model call required.

The key insight: "What's the capital of France?" and "Can you tell me the capital city of France?" mean the same thing. A traditional cache misses the second query. A semantic cache hits it.

## How It Works

The architecture has three components:

**1. Embedding Layer**  
Every incoming query is embedded into a dense vector using a lightweight embedding model (e.g., `text-embedding-3-small`, BGE, or a locally hosted model like `nomic-embed-text`).

**2. Vector Store**  
Cached responses are stored in a vector database (Qdrant, Weaviate, Redis with vector support) alongside their embeddings. On each request, the system performs a nearest-neighbor search.

**3. Similarity Threshold**  
A cosine similarity threshold (typically 0.92–0.97) determines whether the cached response is close enough to return. Too low and you return wrong answers; too high and cache hit rates drop.

```python
from openai import OpenAI
import numpy as np
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
import hashlib, uuid

client = OpenAI()
qdrant = QdrantClient(":memory:")

COLLECTION = "llm_cache"
SIMILARITY_THRESHOLD = 0.93

qdrant.create_collection(
    collection_name=COLLECTION,
    vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
)

def embed(text: str) -> list[float]:
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
    )
    return response.data[0].embedding

def cache_lookup(query: str) -> str | None:
    vector = embed(query)
    results = qdrant.search(
        collection_name=COLLECTION,
        query_vector=vector,
        limit=1,
        score_threshold=SIMILARITY_THRESHOLD,
    )
    if results:
        return results[0].payload["response"]
    return None

def cache_store(query: str, response: str) -> None:
    vector = embed(query)
    qdrant.upsert(
        collection_name=COLLECTION,
        points=[
            PointStruct(
                id=str(uuid.uuid4()),
                vector=vector,
                payload={"query": query, "response": response},
            )
        ],
    )

def ask(query: str) -> str:
    # Check cache first
    cached = cache_lookup(query)
    if cached:
        print("[CACHE HIT]")
        return cached

    # Call the LLM
    print("[CACHE MISS] Calling LLM...")
    completion = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": query}],
    )
    response = completion.choices[0].message.content

    # Store in cache
    cache_store(query, response)
    return response
```

Run this and you'll see:

```
ask("What is the capital of France?")   # CACHE MISS
ask("Tell me the capital of France")    # CACHE HIT  ← same answer, no API call
ask("France's capital city?")           # CACHE HIT
```

## Choosing the Right Similarity Threshold

This is the hardest tuning problem in semantic caching. The threshold controls the precision/recall tradeoff:

| Threshold | Behavior |
|-----------|----------|
| 0.80–0.88 | High recall, risky — may return semantically adjacent but wrong answers |
| 0.90–0.94 | Good balance for factual/FAQ workloads |
| 0.95–0.99 | Safe for nuanced queries, lower hit rate |

For **customer support bots** answering FAQ-style questions, 0.92 works well. For **code generation** or **legal/medical** contexts where precision matters, push to 0.96+.

A practical approach: measure your false-positive rate offline using a labeled dataset of query pairs, then pick the lowest threshold that keeps false positives under 0.1%.

## Cache Invalidation and TTL

Static knowledge (geography, math, historical facts) can be cached indefinitely. Dynamic knowledge needs TTLs:

```python
from datetime import datetime, timedelta

def cache_store_with_ttl(query: str, response: str, ttl_hours: int = 24) -> None:
    vector = embed(query)
    expires_at = (datetime.utcnow() + timedelta(hours=ttl_hours)).isoformat()
    qdrant.upsert(
        collection_name=COLLECTION,
        points=[
            PointStruct(
                id=str(uuid.uuid4()),
                vector=vector,
                payload={
                    "query": query,
                    "response": response,
                    "expires_at": expires_at,
                },
            )
        ],
    )

def cache_lookup_with_ttl(query: str) -> str | None:
    vector = embed(query)
    results = qdrant.search(
        collection_name=COLLECTION,
        query_vector=vector,
        limit=1,
        score_threshold=SIMILARITY_THRESHOLD,
        with_payload=True,
    )
    if not results:
        return None

    payload = results[0].payload
    if datetime.fromisoformat(payload["expires_at"]) < datetime.utcnow():
        return None  # Expired

    return payload["response"]
```

## Embedding Model Cost vs. Quality

The embedding call itself has a cost. For a cache to be economically worthwhile, the embedding should be much cheaper than the LLM call:

| Model | Cost per 1M tokens | Latency |
|-------|-------------------|---------|
| `text-embedding-3-small` | ~$0.02 | ~50ms |
| `text-embedding-3-large` | ~$0.13 | ~80ms |
| Local `nomic-embed-text` | Free | ~5ms |

For high-throughput production systems, running a local embedding model (via Ollama or a dedicated inference server) eliminates the per-embedding cost and cuts latency to single-digit milliseconds. The accuracy difference vs. OpenAI's small model is marginal for caching purposes.

## Real-World Impact

Teams deploying semantic caching on FAQ-heavy workloads report:

- **40–70% cache hit rates** on customer support queries
- **80–95% latency reduction** on cache hits (from ~3s to ~50ms)
- **30–60% cost reduction** on LLM API spend within 2–4 weeks of deployment

The hit rate compounds over time as the cache warms up. Early on, expect 10–20% hits. After a week of production traffic, you're often above 50%.

## When Semantic Caching Doesn't Help

Not every workload benefits:

- **Unique creative requests** (write me a poem about X) — every query differs enough that hits are rare
- **Personalized responses** — if the answer depends on user state, cached responses may be wrong
- **Real-time data** — stock prices, live sports scores, weather shouldn't be cached at all
- **Multi-turn conversations** — context changes the meaning of each message

For these cases, consider **prompt caching** instead (caching the KV state of large system prompts at the model layer) — most major LLM providers now offer this natively.

## Conclusion

Semantic caching is one of the highest-ROI optimizations available for production LLM systems. The implementation is straightforward — an embedding model, a vector store, and a similarity threshold — but the tuning requires care. Start conservative with your threshold, measure false positives, and let the cache warm up before judging hit rates.

For most FAQ-style AI products, semantic caching pays for its implementation cost within the first week. At scale, it's not optional — it's infrastructure.
