---
layout: post
title: "Event-Driven AI: Building Reactive Systems That Combine LLMs with Message Queues"
date: 2026-06-17 08:00:00 +0545
categories: [AI, Architecture]
tags: [event-driven, kafka, llm, message-queues, ai-architecture, reactive-systems, production]
---

Modern AI workloads rarely happen in isolation. Users click buttons, orders arrive, sensors fire — and somewhere in that stream of events, an LLM needs to classify, summarize, route, or respond. The naive approach is to wire LLM calls directly into request handlers, but this breaks under load, creates tight coupling, and makes retries a nightmare. Event-driven architecture solves these problems elegantly — if you know how to integrate AI into it correctly.

## Why Event-Driven and AI Are a Natural Fit

Traditional synchronous AI calls have a fundamental mismatch with production traffic patterns: LLM latency is measured in seconds, while user expectations are measured in milliseconds. When you receive 10,000 events per minute and each LLM call takes 2-3 seconds, you can't afford to block.

Event-driven architectures decouple producers from consumers, buffer spikes behind queues, and allow AI processing to happen at the pace that makes sense — not the pace that callers demand. The result is a system that:

- **Absorbs traffic spikes** without dropping requests
- **Retries automatically** when LLM providers throttle or error
- **Scales consumers independently** of producers
- **Maintains ordering guarantees** where needed (e.g., document processing pipelines)

## Core Architecture Patterns

### Pattern 1: The AI Fan-Out Consumer

The most common pattern: events arrive on a topic, and an AI consumer enriches each event before writing it downstream.

```python
# kafka_ai_consumer.py
from kafka import KafkaConsumer, KafkaProducer
from anthropic import Anthropic
import json

client = Anthropic()
consumer = KafkaConsumer(
    "raw-customer-feedback",
    bootstrap_servers="kafka:9092",
    group_id="sentiment-enrichment",
    value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    max_poll_records=10,  # batch size for efficiency
)
producer = KafkaProducer(
    bootstrap_servers="kafka:9092",
    value_serializer=lambda v: json.dumps(v).encode("utf-8"),
)

def classify_sentiment(text: str) -> dict:
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=64,
        messages=[{
            "role": "user",
            "content": f"Classify the sentiment of this feedback as positive, negative, or neutral. "
                       f"Respond with JSON: {{\"sentiment\": \"...\", \"score\": 0.0-1.0}}\n\n{text}"
        }],
    )
    return json.loads(response.content[0].text)

for message in consumer:
    event = message.value
    try:
        enrichment = classify_sentiment(event["feedback_text"])
        enriched_event = {**event, "ai_analysis": enrichment}
        producer.send("enriched-customer-feedback", value=enriched_event)
        consumer.commit()
    except Exception as e:
        # Send to dead-letter queue instead of crashing
        producer.send("feedback-dlq", value={"original": event, "error": str(e)})
```

The key decision here is using `claude-haiku` for high-throughput classification tasks. Save the more capable models for complex reasoning where it matters.

### Pattern 2: Event-Driven RAG Pipeline

Retrieval-Augmented Generation (RAG) works exceptionally well as an event-driven pipeline. Documents arrive, get chunked, embedded, and stored — all asynchronously.

```python
# document_pipeline.py
import asyncio
from dataclasses import dataclass
from typing import AsyncGenerator

@dataclass
class PipelineEvent:
    document_id: str
    content: str
    stage: str

async def chunk_document(event: PipelineEvent) -> AsyncGenerator[PipelineEvent, None]:
    """Split large documents into overlapping chunks."""
    chunk_size = 512
    overlap = 64
    words = event.content.split()
    
    for i in range(0, len(words), chunk_size - overlap):
        chunk = " ".join(words[i:i + chunk_size])
        yield PipelineEvent(
            document_id=f"{event.document_id}_chunk_{i}",
            content=chunk,
            stage="chunked"
        )

async def embed_chunk(event: PipelineEvent, embedder) -> PipelineEvent:
    """Generate vector embedding for a chunk."""
    embedding = await embedder.embed(event.content)
    return PipelineEvent(
        document_id=event.document_id,
        content=event.content,
        stage="embedded",
    )

async def process_pipeline(raw_document: PipelineEvent):
    async for chunk in chunk_document(raw_document):
        embedded = await embed_chunk(chunk, embedder=get_embedder())
        await vector_store.upsert(embedded)
```

By making each stage a separate consumer group on Kafka, you get independent scaling: chunking is CPU-bound, embedding is I/O-bound, and storage is disk-bound — each can scale to different replica counts.

### Pattern 3: Backpressure-Aware AI Processing

One of the most overlooked challenges: what happens when your AI provider rate-limits you? The answer is backpressure — slow down consumption when the downstream can't keep up.

```python
import asyncio
import time
from collections import deque

class RateLimitedAIConsumer:
    def __init__(self, requests_per_minute: int = 60):
        self.rpm_limit = requests_per_minute
        self.request_timestamps = deque()
    
    def _wait_for_rate_limit(self):
        now = time.monotonic()
        # Remove timestamps older than 1 minute
        while self.request_timestamps and now - self.request_timestamps[0] > 60:
            self.request_timestamps.popleft()
        
        if len(self.request_timestamps) >= self.rpm_limit:
            sleep_time = 60 - (now - self.request_timestamps[0])
            if sleep_time > 0:
                time.sleep(sleep_time)
        
        self.request_timestamps.append(time.monotonic())
    
    def process_event(self, event: dict) -> dict:
        self._wait_for_rate_limit()
        # Make your AI call here
        return call_llm(event)
```

This pattern ensures you never exceed provider limits, automatically throttling Kafka consumption as a side effect.

## Dead-Letter Queues for AI Failures

AI calls fail — models go down, context windows overflow, rate limits hit unexpectedly. Every event-driven AI system needs a dead-letter queue (DLQ) strategy.

```yaml
# kafka-topics.yaml for a complete AI pipeline
topics:
  - name: raw-events
    partitions: 12
    replication-factor: 3
    
  - name: ai-processed-events  
    partitions: 12
    replication-factor: 3
    
  - name: ai-events-dlq
    partitions: 3
    replication-factor: 3
    config:
      retention.ms: 604800000  # 7 days — time to debug and replay
      
  - name: ai-events-retry
    partitions: 6
    replication-factor: 3
    config:
      retention.ms: 86400000  # 1 day
```

A robust failure strategy involves three queues: the main topic, a retry topic with exponential backoff, and a final DLQ for events that have exhausted retries. Events in the DLQ get human review before being replayed or discarded.

## Exactly-Once Semantics with AI

The trickiest part of event-driven AI is idempotency. LLM calls are expensive and non-deterministic — you don't want to process the same event twice and pay twice, or generate inconsistent results.

```python
import hashlib
import redis

class IdempotentAIProcessor:
    def __init__(self, redis_client: redis.Redis, ttl_seconds: int = 86400):
        self.cache = redis_client
        self.ttl = ttl_seconds
    
    def process(self, event: dict, processor_fn) -> dict:
        # Create a deterministic key from event content
        event_key = hashlib.sha256(
            json.dumps(event, sort_keys=True).encode()
        ).hexdigest()
        
        cache_key = f"ai_result:{event_key}"
        
        # Check if we've already processed this event
        cached = self.cache.get(cache_key)
        if cached:
            return json.loads(cached)
        
        # Process and cache the result
        result = processor_fn(event)
        self.cache.setex(cache_key, self.ttl, json.dumps(result))
        return result
```

Redis-backed idempotency gives you cheap deduplication within a 24-hour window, which covers most transient failure scenarios.

## Monitoring Your Event-Driven AI Pipeline

A healthy pipeline needs three layers of visibility:

**Consumer lag** — how far behind is your AI consumer from the latest event? If this grows, your AI is too slow for incoming volume.

**Error rates by stage** — distinguish between Kafka errors, LLM provider errors, and application errors. Each requires a different response.

**Token spend per event type** — event-driven AI can silently blow up your LLM budget. Track tokens consumed per consumer group to catch runaway prompts early.

```python
from prometheus_client import Counter, Histogram, Gauge

ai_events_processed = Counter(
    "ai_events_processed_total",
    "Total events processed by AI pipeline",
    ["consumer_group", "status"]
)
ai_tokens_consumed = Counter(
    "ai_tokens_consumed_total",
    "Total tokens consumed",
    ["consumer_group", "model"]
)
ai_processing_latency = Histogram(
    "ai_processing_latency_seconds",
    "Time to process a single event through AI",
    ["consumer_group"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]
)
consumer_lag = Gauge(
    "kafka_consumer_lag",
    "Consumer group lag in messages",
    ["consumer_group", "topic"]
)
```

## When Not to Use Event-Driven AI

Not everything needs a message queue. Avoid this pattern when:

- **Latency is truly critical** and you need sub-500ms responses — queues add latency
- **Event volume is low** (< 100/minute) — the operational overhead isn't worth it
- **Strong consistency is required** — eventual consistency is inherent to async systems
- **The workflow is short and linear** — sometimes a simple synchronous call is the right tool

The sweet spot is high-volume, latency-tolerant workloads: document processing, content moderation, sentiment analysis, background enrichment, and async summarization pipelines.

## Conclusion

Event-driven architecture and AI are complementary technologies. Queues provide the reliability, backpressure, and retry semantics that make LLM calls production-worthy at scale. The patterns covered here — fan-out consumers, rate-limited processing, idempotent caching, and DLQ strategies — form the foundation of any serious event-driven AI system.

Start small: pick one high-volume, low-latency-tolerance AI call in your existing system, move it behind a queue, and observe how the system behaves under load. The decoupling benefits become immediately obvious, and you'll find yourself reaching for this pattern again and again as your AI workloads grow.

The future of production AI isn't just smarter models — it's smarter infrastructure around those models.
