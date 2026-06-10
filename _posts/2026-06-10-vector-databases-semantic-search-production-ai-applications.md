---
layout: post
title: "Vector Databases: The Backbone of Semantic Search in Production AI Applications"
date: 2026-06-10 08:00:00 +0545
categories: [AI, Backend]
tags: [vector-databases, semantic-search, embeddings, pgvector, pinecone, rag]
---

Modern AI applications increasingly depend on the ability to find semantically similar content — not just exact keyword matches, but conceptually related information. Vector databases have emerged as the critical infrastructure layer that makes this possible at scale. Whether you're building a RAG pipeline, a recommendation engine, or a code search tool, understanding how to work with vector databases in production is essential.

## What Makes Vector Databases Different

Traditional databases excel at structured queries: "find all records where `status = 'active'`." But semantic search requires answering questions like "find content similar in meaning to this query," which requires a fundamentally different approach.

Vector databases store high-dimensional numerical representations (embeddings) of your data and enable efficient nearest-neighbor search across millions or billions of vectors. The core operation is Approximate Nearest Neighbor (ANN) search — finding the k vectors most similar to a query vector by some distance metric (cosine similarity, dot product, or Euclidean distance).

The challenge is that exact nearest-neighbor search over millions of vectors is prohibitively slow. Vector databases solve this using index structures like HNSW (Hierarchical Navigable Small World graphs) or IVF (Inverted File Index) that trade a small amount of recall accuracy for orders-of-magnitude speedup.

## Choosing the Right Solution

The landscape has three main tiers:

**Dedicated vector databases** (Pinecone, Weaviate, Qdrant, Milvus) are purpose-built for this use case. They offer the best performance at scale, rich filtering capabilities, and managed infrastructure. The tradeoff is operational complexity and cost if you're already running a different primary database.

**Extensions on existing databases** (pgvector for PostgreSQL, Redis Vector, Elasticsearch dense vectors) let you add vector search without a new infrastructure dependency. pgvector in particular has become popular for teams already on PostgreSQL — you get "good enough" performance for many use cases without adding another system to operate.

**Embedded solutions** (ChromaDB, LanceDB, FAISS) run in-process, which is excellent for prototyping and smaller datasets. They're not suited for multi-tenant production systems but can be a pragmatic choice for single-server deployments.

## Working with pgvector

For many production applications, pgvector is the right starting point. Here's a practical setup:

```sql
-- Enable the extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create a table with an embedding column
CREATE TABLE documents (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    metadata JSONB,
    embedding VECTOR(1536)  -- 1536 dims for OpenAI text-embedding-3-small
);

-- Create an HNSW index for fast approximate search
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

Inserting documents with embeddings:

```python
import psycopg2
from openai import OpenAI

client = OpenAI()

def embed(text: str) -> list[float]:
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return response.data[0].embedding

def insert_document(conn, content: str, metadata: dict):
    embedding = embed(content)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO documents (content, metadata, embedding) VALUES (%s, %s, %s)",
            (content, json.dumps(metadata), embedding)
        )
    conn.commit()
```

Semantic search with metadata filtering:

```python
def semantic_search(conn, query: str, k: int = 5, filter_tag: str = None):
    query_embedding = embed(query)
    
    sql = """
        SELECT id, content, metadata,
               1 - (embedding <=> %s::vector) AS similarity
        FROM documents
        WHERE ($2::text IS NULL OR metadata->>'tag' = $2)
        ORDER BY embedding <=> %s::vector
        LIMIT %s
    """
    
    with conn.cursor() as cur:
        cur.execute(sql, (query_embedding, filter_tag, query_embedding, k))
        return cur.fetchall()
```

The `<=>` operator computes cosine distance. pgvector also supports `<->` (L2/Euclidean) and `<#>` (negative inner product for dot product similarity).

## Scaling Considerations

**Index tuning is critical.** For HNSW indexes, `m` controls the number of connections per node (higher = better recall, more memory), and `ef_construction` controls index build quality. For search, you can set `hnsw.ef_search` to trade recall for speed:

```sql
SET hnsw.ef_search = 100;  -- higher = better recall, slower search
```

**Partitioning for large datasets.** When you have tens of millions of vectors, consider partitioning by a high-cardinality metadata field (like tenant ID) so each partition's index stays manageable and queries can target specific partitions.

**Batching embeddings.** Embedding API calls are the bottleneck in most pipelines. Batch your requests to maximize throughput:

```python
def batch_embed(texts: list[str], batch_size: int = 100) -> list[list[float]]:
    embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=batch
        )
        embeddings.extend([d.embedding for d in response.data])
    return embeddings
```

**Caching query embeddings.** The same query string always produces the same embedding. Cache these aggressively — it's often the highest-impact optimization in a semantic search pipeline.

## Hybrid Search: The Best of Both Worlds

Pure semantic search misses exact keyword matches. A user searching for a specific function name or error code wants keyword precision, not semantic approximation. Production systems increasingly use hybrid search that combines both:

```sql
-- Using pg_trgm for keyword search alongside pgvector
SELECT id, content,
    (0.7 * (1 - (embedding <=> $1::vector))) +
    (0.3 * similarity(content, $2)) AS combined_score
FROM documents
ORDER BY combined_score DESC
LIMIT 10
```

The weights (0.7 semantic / 0.3 keyword) are a starting point — tune them based on your use case. Alternatively, use Reciprocal Rank Fusion (RRF) to combine ranked lists from both systems without needing to calibrate score scales.

## Metadata Filtering: A Common Pitfall

Most vector databases support pre-filtering (filter before ANN search) and post-filtering (filter after). Pre-filtering is more accurate but can degrade index performance significantly when the filter is highly selective — the ANN index may not return enough candidates after filtering.

The standard approach is to set `ef_search` high enough that the candidate pool before filtering contains sufficient results, or to use a query planner that can decide between the two strategies based on selectivity estimates.

When building multi-tenant applications, always filter by tenant ID as the primary constraint before vector similarity. Index your vectors partitioned or tagged by tenant to ensure queries never scan another tenant's data.

## Monitoring in Production

Key metrics to track:

- **Recall@k**: sample queries with known-good results; measure what fraction appear in top-k results. Degradation here often indicates index corruption or misconfigured ef_search.
- **P99 search latency**: ANN search should be sub-10ms for most datasets. Spikes indicate index fragmentation or resource contention.
- **Index size vs. dataset size**: HNSW indexes are typically 2-4x the raw vector data size. Plan storage accordingly.
- **Embedding model drift**: if you retrain or swap your embedding model, existing vectors become incompatible. Version your embeddings and backfill when changing models.

## Conclusion

Vector databases are no longer experimental infrastructure — they're a production requirement for any AI application doing semantic search or retrieval. The key decisions are choosing between a dedicated vector database and an extension like pgvector (lean toward pgvector until you need it), tuning your HNSW indexes for your recall/latency tradeoff, and implementing hybrid search to cover both semantic and keyword use cases.

The embedding generation pipeline often matters as much as the database itself. Batch efficiently, cache aggressively, and version your embedding models carefully. Get these fundamentals right, and vector search becomes a reliable building block rather than a source of production incidents.
