---
layout: post
title: "GraphRAG: Combining Knowledge Graphs with Vector Search for Smarter AI Retrieval"
date: 2026-05-27 08:00:00 +0545
categories: [AI, RAG]
tags: [graphrag, knowledge-graphs, vector-search, retrieval-augmented-generation, llm, ai]
---

Standard RAG pipelines have a well-known blind spot: they retrieve semantically similar chunks but miss the *relationships* between them. Ask a naive RAG system "What projects did Alice and Bob collaborate on that involved the payment team?" and it might return chunks about Alice, chunks about Bob, and chunks about the payment team — but fail to connect the dots. GraphRAG fixes this by layering a knowledge graph on top of vector retrieval, letting the system traverse relationships instead of just matching embeddings.

This post walks through how GraphRAG works, when to use it, and how to implement a working pipeline.

## What GraphRAG Actually Does

GraphRAG (popularized by Microsoft Research's 2024 paper and now widely adopted) replaces the flat "chunk → embed → retrieve" model with a two-layer structure:

1. **Knowledge graph layer** — entities and relationships extracted from your corpus, stored as nodes and edges
2. **Vector layer** — embeddings for fast semantic lookup

At query time, the system uses vector search to identify relevant entities, then *walks the graph* to surface related context that pure embedding similarity would miss. The result: answers that require multi-hop reasoning become dramatically more accurate.

A practical example: in a codebase assistant, vector search finds the `PaymentService` class. The graph then traverses its edges — "calls", "depends_on", "modified_by" — to pull in `StripeAdapter`, the last engineer who touched it, and the open bug filed against it. All of that context lands in the LLM's prompt without the user asking for each piece explicitly.

## Core Architecture

```
Documents → Entity Extraction → Knowledge Graph
     ↓                               ↓
  Chunking → Embeddings → Vector DB
                               ↓
Query → Vector Search → Seed Entities → Graph Traversal → Ranked Context → LLM
```

The graph store and vector store stay in sync: when a document is ingested, you extract entities, embed chunks, and write both. At retrieval time they work together.

## Building the Entity Extraction Pipeline

Entity extraction is the hard part. You have two main options:

**NLP-based extraction** (fast, cheap, less accurate):
```python
import spacy

nlp = spacy.load("en_core_web_trf")

def extract_entities(text: str) -> list[dict]:
    doc = nlp(text)
    entities = []
    for ent in doc.ents:
        entities.append({
            "text": ent.text,
            "label": ent.label_,
            "start": ent.start_char,
            "end": ent.end_char,
        })
    return entities
```

**LLM-based extraction** (slower, more expensive, much better for domain-specific content):
```python
from anthropic import Anthropic

client = Anthropic()

EXTRACT_PROMPT = """Extract entities and relationships from this text.
Return JSON with:
- entities: [{id, name, type, description}]
- relationships: [{source_id, target_id, type, description}]

Text: {text}"""

def extract_with_llm(text: str) -> dict:
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": EXTRACT_PROMPT.format(text=text)
        }]
    )
    import json
    return json.loads(response.content[0].text)
```

For production, use LLM extraction on high-value documents and NLP extraction for high-volume ingestion. You can always re-extract with LLMs later as a background job.

## Storing the Graph

Neo4j is the standard choice, but for smaller deployments NetworkX (in-memory) or SQLite with a recursive CTE works fine. Here's a Neo4j setup:

```python
from neo4j import GraphDatabase

class KnowledgeGraph:
    def __init__(self, uri: str, user: str, password: str):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))

    def add_entity(self, entity_id: str, name: str, entity_type: str, props: dict):
        with self.driver.session() as session:
            session.run(
                """
                MERGE (e:Entity {id: $id})
                SET e.name = $name, e.type = $type, e += $props
                """,
                id=entity_id, name=name, type=entity_type, props=props
            )

    def add_relationship(self, source_id: str, target_id: str, rel_type: str):
        with self.driver.session() as session:
            session.run(
                """
                MATCH (a:Entity {id: $source}), (b:Entity {id: $target})
                MERGE (a)-[r:RELATES {type: $rel_type}]->(b)
                """,
                source=source_id, target=target_id, rel_type=rel_type
            )

    def get_neighbors(self, entity_id: str, max_hops: int = 2) -> list[dict]:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (start:Entity {id: $id})-[*1..$hops]-(neighbor)
                RETURN DISTINCT neighbor.id as id, neighbor.name as name,
                       neighbor.type as type
                LIMIT 50
                """,
                id=entity_id, hops=max_hops
            )
            return [dict(r) for r in result]
```

## The Retrieval Query

With the graph built, the retrieval loop becomes:

```python
def graphrag_retrieve(
    query: str,
    vector_store,
    graph: KnowledgeGraph,
    top_k: int = 5,
    graph_hops: int = 2
) -> list[str]:
    # Step 1: vector search for seed chunks
    seed_chunks = vector_store.similarity_search(query, k=top_k)

    # Step 2: extract entity IDs mentioned in seed chunks
    seed_entities = []
    for chunk in seed_chunks:
        if "entity_ids" in chunk.metadata:
            seed_entities.extend(chunk.metadata["entity_ids"])

    # Step 3: graph traversal to find related entities
    related_entities = set()
    for entity_id in seed_entities:
        neighbors = graph.get_neighbors(entity_id, max_hops=graph_hops)
        for n in neighbors:
            related_entities.add(n["id"])

    # Step 4: fetch chunks associated with related entities
    expanded_chunks = vector_store.get_chunks_by_entity_ids(
        list(related_entities), limit=top_k * 3
    )

    # Step 5: deduplicate and rank
    all_chunks = seed_chunks + expanded_chunks
    seen_ids = set()
    ranked = []
    for chunk in all_chunks:
        if chunk.id not in seen_ids:
            seen_ids.add(chunk.id)
            ranked.append(chunk)

    return [c.page_content for c in ranked[:top_k * 2]]
```

## When GraphRAG Outperforms Standard RAG

GraphRAG shines for:

- **Multi-hop questions** — "Which services depend on the component Alice owns that was deprecated last quarter?"
- **Relationship-heavy domains** — legal documents, codebases, medical records, enterprise knowledge bases
- **Disambiguation** — "Apollo" (Greek myth vs. NASA mission vs. GraphQL client) resolved via graph context

It adds overhead that isn't worth it for:

- Simple factual Q&A over homogeneous documents
- High-volume, low-latency applications where graph traversal is a bottleneck
- Domains where relationships aren't structurally important

A useful heuristic: if answering a typical query requires knowing about more than one entity and their relationship, GraphRAG will outperform standard RAG. If most queries are "tell me about X", standard RAG is probably enough.

## Performance Considerations

Graph traversal adds latency. For production, mitigate this with:

1. **Precomputed subgraphs** — cache the N-hop neighborhood for frequently queried entities
2. **Depth limits** — rarely go beyond 2-3 hops; the signal-to-noise ratio drops fast
3. **Async graph expansion** — run vector search and graph traversal in parallel, merge results
4. **Graph indexes** — index by entity type and relationship type in Neo4j to keep traversal sub-10ms

```python
import asyncio

async def parallel_retrieve(query, vector_store, graph):
    vector_task = asyncio.create_task(
        asyncio.to_thread(vector_store.similarity_search, query, k=5)
    )
    # While vector search runs, prepare entity IDs from cache
    # Then kick off graph traversal
    seed_chunks = await vector_task
    # ... continue with graph expansion
```

## Conclusion

GraphRAG isn't a replacement for standard RAG — it's an upgrade for the class of problems where relationships matter as much as content. The implementation overhead is real: you need entity extraction, a graph store, and a retrieval loop that's more complex than a single similarity search. But for enterprise knowledge bases, codebases, and any domain where "how does X relate to Y" is a common question shape, the accuracy gains are substantial.

Start with LLM-based extraction on your most important documents, store the graph in Neo4j or even a simple SQLite adjacency table, and benchmark against your existing pipeline. The comparison will make the tradeoff obvious.
