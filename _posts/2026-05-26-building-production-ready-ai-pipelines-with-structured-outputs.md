---
layout: post
title: "Building Production-Ready AI Pipelines with Structured Outputs"
date: 2026-05-26 08:00:00 +0545
categories: [AI, Backend]
tags: [llm, structured-outputs, json-schema, python, production]
---

Modern AI applications rarely work with raw text alone. Whether you're extracting data from documents, routing user requests, or generating reports, you need LLMs to return structured, machine-readable data — not prose. Structured outputs have become the backbone of reliable AI pipelines, and getting them right in production requires more than just asking the model to "return JSON."

## Why Raw JSON Prompting Fails in Production

The naive approach is to add "respond in JSON" to your system prompt. It works maybe 90% of the time — which sounds fine until you're handling thousands of requests per day and 10% failures mean hundreds of broken downstream processes.

Common failure modes:
- Model returns JSON wrapped in markdown code fences
- Missing or extra fields
- Wrong types (string where you expected integer)
- Nested objects collapsed into strings
- Model "explains" its JSON before or after the block

These aren't edge cases. They're predictable failure patterns that compound at scale.

## The Right Tool: JSON Schema Enforcement

Most major LLM providers now support native structured output enforcement via JSON Schema. The model's output is constrained at the token-sampling level — it literally cannot produce invalid output for your schema.

Here's a production-grade pattern using the Anthropic SDK:

```python
import anthropic
import json
from pydantic import BaseModel, ValidationError
from typing import Optional

client = anthropic.Anthropic()

class ExtractedEntity(BaseModel):
    name: str
    entity_type: str  # person, org, location, product
    confidence: float
    context: Optional[str] = None

class ExtractionResult(BaseModel):
    entities: list[ExtractedEntity]
    document_summary: str
    extraction_timestamp: str

def extract_entities(text: str) -> ExtractionResult:
    schema = ExtractionResult.model_json_schema()
    
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        tools=[{
            "name": "extract_entities",
            "description": "Extract named entities from the provided text",
            "input_schema": schema
        }],
        tool_choice={"type": "tool", "name": "extract_entities"},
        messages=[{
            "role": "user",
            "content": f"Extract all named entities from this text:\n\n{text}"
        }]
    )
    
    tool_use = next(b for b in response.content if b.type == "tool_use")
    return ExtractionResult(**tool_use.input)
```

By setting `tool_choice` to force a specific tool, you guarantee the model returns structured data matching your schema — no parsing, no guessing, no fallback logic.

## Designing Schemas That Work Well With LLMs

Not all schemas are equal. A schema that's technically valid JSON Schema may still produce poor results because LLMs respond to semantics, not just syntax.

**Use descriptive field names.** `entity_type` is better than `et`. `confidence_score_0_to_1` is better than `conf`.

**Add descriptions to your schema fields.** Most providers pass field descriptions to the model as context:

```python
from pydantic import Field

class ExtractedEntity(BaseModel):
    name: str = Field(description="The exact name as it appears in the text")
    entity_type: str = Field(
        description="Category: 'person', 'organization', 'location', or 'product'"
    )
    confidence: float = Field(
        description="Confidence score from 0.0 (uncertain) to 1.0 (certain)",
        ge=0.0, le=1.0
    )
```

**Prefer enums over open strings for categorical fields.** This dramatically reduces variance:

```python
from enum import Enum

class EntityType(str, Enum):
    PERSON = "person"
    ORGANIZATION = "organization"
    LOCATION = "location"
    PRODUCT = "product"
```

**Avoid deeply nested schemas for complex extractions.** Flatten where possible. Deeply nested schemas increase the chance of structural errors even with constrained generation.

## Validation Layers Beyond Schema Enforcement

Schema enforcement ensures structural correctness, but not semantic correctness. A confidence score of `0.97` for something the model clearly hallucinated is structurally valid but semantically wrong.

Add validation at the application layer:

```python
from datetime import datetime

def validate_extraction(result: ExtractionResult) -> list[str]:
    warnings = []
    
    # Flag suspiciously uniform confidence scores
    if result.entities:
        scores = [e.confidence for e in result.entities]
        if max(scores) - min(scores) < 0.05:
            warnings.append("All confidence scores are nearly identical — possible model uncertainty")
    
    # Flag entities without context when text is long enough to provide it
    no_context = [e.name for e in result.entities if not e.context]
    if no_context:
        warnings.append(f"Entities missing context: {no_context}")
    
    return warnings
```

This layer catches patterns that schema validation can't — and gives you telemetry on model behavior over time.

## Handling Failures Gracefully

Even with constrained generation, failures happen: network timeouts, rate limits, context window overflows. Your pipeline needs a fallback strategy.

```python
import time
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10)
)
def extract_with_retry(text: str) -> ExtractionResult:
    try:
        return extract_entities(text)
    except ValidationError as e:
        # Schema mismatch — log and re-raise, don't retry
        logger.error(f"Schema validation failed: {e}")
        raise
    except anthropic.RateLimitError:
        # Retriable — tenacity will handle backoff
        raise
    except anthropic.APIError as e:
        logger.error(f"API error: {e}")
        raise
```

Distinguish between retriable errors (rate limits, transient API failures) and non-retriable ones (validation failures, invalid inputs). Retrying a validation failure wastes money and time.

## Async Pipelines for Throughput

If you're processing documents at scale, async is non-negotiable. The Anthropic SDK supports async natively:

```python
import asyncio
import anthropic

async_client = anthropic.AsyncAnthropic()

async def extract_batch(texts: list[str]) -> list[ExtractionResult]:
    tasks = [extract_entities_async(text) for text in texts]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    successful = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            logger.error(f"Failed extraction for item {i}: {result}")
        else:
            successful.append(result)
    
    return successful

async def extract_entities_async(text: str) -> ExtractionResult:
    response = await async_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        tools=[{"name": "extract_entities", "input_schema": ExtractionResult.model_json_schema()}],
        tool_choice={"type": "tool", "name": "extract_entities"},
        messages=[{"role": "user", "content": f"Extract entities from:\n\n{text}"}]
    )
    tool_use = next(b for b in response.content if b.type == "tool_use")
    return ExtractionResult(**tool_use.input)
```

This saturates your rate limit budget rather than processing one document at a time.

## Observability: What to Log

You can't improve what you can't measure. Log these for every structured output call:

- Input token count
- Output token count  
- Schema validation pass/fail
- Application-layer validation warnings
- Latency (time to first token, total)
- Model version used

Aggregate these over time and you'll catch model drift, schema gaps, and cost anomalies before they become incidents.

## Conclusion

Structured outputs are the foundation of reliable AI pipelines. The gap between "it works in a demo" and "it works at 2am on a Tuesday" is almost entirely about error handling, validation layers, and observability — not prompt quality.

Start with JSON Schema enforcement to eliminate structural failures, add semantic validation to catch what schema can't, build retry logic that distinguishes error types, and instrument everything. These aren't optimizations to add later — they're the baseline for anything you'd call production-ready.

The models are capable. The infrastructure around them is what separates prototypes from products.
