---
layout: post
title: "Structured Outputs: Getting Reliable, Schema-Constrained Responses from LLMs"
date: 2026-07-01 08:00:00 +0545
categories: [AI, Engineering]
tags: [llm, structured-outputs, json-mode, pydantic, function-calling, schema, production-ai]
---

Every production AI application eventually hits the same wall: the model returns something *almost* right. A field is renamed. A number comes back as a string. A required key is missing. You add another line to your prompt asking it to "always return valid JSON" — and it works until the next edge case breaks it again.

Structured outputs solve this properly. Instead of hoping a model follows formatting instructions in natural language, you constrain the model's generation process itself so that invalid outputs are statistically impossible or mechanically rejected before they reach your code.

This post covers the landscape of structured output techniques, when to use each, and how to build reliable schema-constrained pipelines in production.

## Why Prompt Engineering Isn't Enough

The naive approach — "return a JSON object with fields X, Y, and Z" — fails for several reasons:

**Models drift under context pressure.** A prompt that reliably returns JSON in testing breaks when the conversation history gets long, when the user's input contains unusual characters, or when the model is "reasoning out loud" and embeds the JSON inside prose.

**Validation is asynchronous.** You only know the output is malformed *after* you've already paid for the inference. If parsing fails, you retry — doubling latency and cost.

**Error messages are hard to route.** A JSON parse error tells you nothing about *what* went wrong. Was a field missing? Was a value the wrong type? Did the model add extra keys? You need to handle all of these manually.

Structured outputs move validation upstream, into the generation step itself.

## The Three Approaches

### 1. JSON Mode

The simplest form. You tell the model to output only valid JSON, and the inference engine enforces this at the token level — the model can only emit tokens that form a valid JSON structure.

```python
from anthropic import Anthropic

client = Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[{
        "role": "user",
        "content": "Extract the company name, founding year, and CEO from this text: "
                   "Anthropic was founded in 2021 by Dario Amodei and Daniela Amodei. "
                   "Dario currently serves as CEO."
    }],
    system="You are a structured data extractor. Always respond with valid JSON only."
)

import json
data = json.loads(response.content[0].text)
```

JSON mode guarantees syntactically valid JSON but says nothing about *which fields* are present or what types they should be. It's a floor, not a ceiling.

### 2. Tool Use / Function Calling

The more powerful approach. You define a schema for a "tool" the model can call, and the model must populate that schema exactly. This is widely supported across providers and gives you field-level type constraints.

```python
from anthropic import Anthropic

client = Anthropic()

company_schema = {
    "name": "extract_company_info",
    "description": "Extract structured information about a company from text",
    "input_schema": {
        "type": "object",
        "properties": {
            "company_name": {
                "type": "string",
                "description": "The official name of the company"
            },
            "founding_year": {
                "type": "integer",
                "description": "The year the company was founded"
            },
            "ceo_name": {
                "type": "string",
                "description": "The full name of the current CEO"
            },
            "is_public": {
                "type": "boolean",
                "description": "Whether the company is publicly traded"
            }
        },
        "required": ["company_name", "founding_year", "ceo_name"]
    }
}

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    tools=[company_schema],
    tool_choice={"type": "tool", "name": "extract_company_info"},
    messages=[{
        "role": "user",
        "content": "Anthropic was founded in 2021 by Dario Amodei and Daniela Amodei. "
                   "Dario currently serves as CEO. The company is privately held."
    }]
)

tool_use_block = next(b for b in response.content if b.type == "tool_use")
data = tool_use_block.input
# data = {'company_name': 'Anthropic', 'founding_year': 2021, 'ceo_name': 'Dario Amodei', 'is_public': False}
```

By setting `tool_choice` to force a specific tool, you guarantee the model will call it. The response is always a valid object matching your schema — no parsing, no validation, no retries.

### 3. Grammar-Constrained Decoding

The most powerful and least portable approach. Open-source inference runtimes like `llama.cpp`, `vLLM`, and `Outlines` support grammar-constrained generation — the sampler is physically restricted to tokens that advance a valid parse of your schema.

```python
from outlines import models, generate
from pydantic import BaseModel
from typing import Optional

class CompanyInfo(BaseModel):
    company_name: str
    founding_year: int
    ceo_name: str
    is_public: bool
    employee_count: Optional[int] = None

model = models.transformers("meta-llama/Llama-3.1-8B-Instruct")
generator = generate.json(model, CompanyInfo)

result = generator(
    "Extract company info: Anthropic was founded in 2021 by Dario Amodei..."
)
# result is a CompanyInfo instance — guaranteed, no exceptions possible
```

Grammar-constrained decoding is deterministic: the output *cannot* fail to parse. The tradeoff is that it only works with models you control and adds some overhead to the sampling step (typically 5-15% latency cost for complex schemas).

## Pydantic Integration Pattern

In Python ecosystems, Pydantic is the standard layer for schema definition and validation. Defining your output schema as a Pydantic model gives you automatic JSON Schema generation, type coercion, validation error messages, and IDE autocompletion.

```python
from pydantic import BaseModel, Field, validator
from typing import List, Optional
from anthropic import Anthropic
import json

class LineItem(BaseModel):
    description: str
    quantity: int = Field(gt=0)
    unit_price: float = Field(gt=0)
    total: float

    @validator("total")
    def total_must_match(cls, v, values):
        expected = values.get("quantity", 0) * values.get("unit_price", 0)
        if abs(v - expected) > 0.01:
            raise ValueError(f"Total {v} doesn't match quantity × price {expected}")
        return v

class Invoice(BaseModel):
    invoice_number: str
    vendor: str
    line_items: List[LineItem]
    subtotal: float
    tax_rate: Optional[float] = None
    total_due: float

def extract_invoice(text: str) -> Invoice:
    client = Anthropic()
    
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        tools=[{
            "name": "extract_invoice",
            "description": "Extract structured invoice data",
            "input_schema": Invoice.model_json_schema()
        }],
        tool_choice={"type": "tool", "name": "extract_invoice"},
        messages=[{"role": "user", "content": f"Extract invoice data:\n\n{text}"}]
    )
    
    tool_block = next(b for b in response.content if b.type == "tool_use")
    return Invoice(**tool_block.input)  # Pydantic validates on construction
```

The key insight: `Invoice.model_json_schema()` generates the JSON Schema your tool call needs, so your schema lives in one place (the Pydantic model) and serves both validation and LLM instruction.

## Handling Uncertainty Explicitly

A common mistake is demanding certainty from a model that doesn't have it. If you ask for `founding_year: int` and the text doesn't mention a year, the model will hallucinate one rather than leave the field empty.

Design your schemas to accommodate uncertainty:

```python
from typing import Optional, Literal
from pydantic import BaseModel

class ExtractedDate(BaseModel):
    year: Optional[int] = None
    confidence: Literal["high", "medium", "low", "unknown"]
    source_text: Optional[str] = None  # the snippet that led to this value

class CompanyInfo(BaseModel):
    company_name: str
    founding_year: ExtractedDate
    ceo_name: Optional[str] = None
    employee_count_range: Optional[Literal[
        "1-10", "11-50", "51-200", "201-1000", "1000+"
    ]] = None
```

Using `confidence` fields and optional types forces the model to express what it actually knows versus what it's guessing. Using enum ranges instead of free integers prevents hallucinated precision ("founded in 2019" when the text says "founded in the late 2010s").

## Retry Strategies for Partial Failures

Even with tool use, edge cases happen: the model might refuse to call the tool, hit a token limit mid-schema, or populate a field with a value that passes JSON validation but fails your business logic.

A minimal retry harness:

```python
from tenacity import retry, stop_after_attempt, wait_exponential
import logging

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True
)
def extract_with_retry(text: str, schema_class: type[BaseModel]) -> BaseModel:
    try:
        result = extract_invoice(text)
        return result
    except Exception as e:
        logging.warning(f"Extraction failed: {e}. Retrying...")
        raise

def extract_with_fallback(text: str) -> dict:
    try:
        return extract_with_retry(text, Invoice).model_dump()
    except Exception:
        # Return a partial result with null fields rather than crashing
        return {"error": "extraction_failed", "raw_text": text[:500]}
```

For high-stakes extractions (financial documents, medical records, legal contracts), consider a two-pass strategy: extract with one model, then validate with a second model call that checks the output for consistency with the source text.

## Performance Considerations

Structured output techniques have different cost profiles:

| Approach | Latency overhead | Token cost | Schema complexity |
|---|---|---|---|
| Prompt instructions | None | None | Unlimited (unreliable) |
| JSON mode | Minimal | None | None (syntax only) |
| Tool use | ~50-100ms | Schema tokens per call | High — complex schemas work |
| Grammar decoding | 5-15% sampling overhead | None | Unlimited (exact) |

For schemas under ~20 fields, tool use is the practical default: portable across providers, no infrastructure changes, strong reliability. For very large schemas (100+ fields) or ultra-high-throughput pipelines, grammar-constrained decoding on self-hosted models becomes worth the operational complexity.

Cache your tool definitions when making repeated calls with the same schema. Most providers charge for schema tokens on every request — caching eliminates this cost entirely for repeated calls.

## Conclusion

Structured outputs are a forcing function for honesty: they make the gap between "what the model knows" and "what my schema demands" visible and actionable, rather than hiding it inside a lucky parse.

The progression is straightforward: start with JSON mode for basic structure, move to tool use when you need field-level typing and required fields, and consider grammar-constrained decoding only when you're running your own models at scale.

The most important design decision isn't which technique to use — it's designing schemas that express uncertainty honestly. A field typed `Optional[str]` with a `confidence` enum tells you far more than a required string that silently hallucinates when the source text is ambiguous.

Production AI systems break at the boundary between unstructured model outputs and structured application code. Structured outputs move that boundary upstream, into the generation process itself, where failures are cheap and controllable rather than silent and expensive.
