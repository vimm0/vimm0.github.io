---
layout: post
title: "Multi-modal AI in Production: Vision, Audio, and Document Processing at Scale"
date: 2026-06-27 08:00:00 +0545
categories: [AI, Production]
tags: [multimodal, vision, audio, documents, llm, production, api]
---

A year ago, "AI integration" meant sending text to an LLM and parsing the response. Today's production systems are fundamentally different: they process screenshots, analyse audio recordings, extract data from scanned invoices, and reason across mixed inputs in a single request. Multi-modal AI has moved from research demo to table stakes — and the engineering challenges are non-trivial.

This post covers what you actually need to know to ship reliable multi-modal AI features at scale: API patterns, cost traps, latency management, and the failure modes that only appear in production.

## Why Multi-modal Changes the Architecture

Text-only AI pipelines are relatively simple: tokenise input, call API, parse output. Multi-modal pipelines introduce a new dimension at every step.

Images can be 10–50× the token cost of equivalent text descriptions. Audio requires transcription or direct audio processing depending on what your model supports. PDFs are neither — they're a container format that might hold text, scanned images, vector graphics, or all three. Each modality has different latency profiles, pricing models, and failure modes.

The core architectural shift is that **input preprocessing becomes a first-class concern**. You need pipelines that normalise inputs before they reach the model, not just prompts that instruct the model to handle variety.

## Image Processing Patterns

### Sizing and Compression Before API Calls

Modern vision APIs charge by image size, typically measured in tiles or megapixels. Sending a 4K screenshot to extract a single form field is the most common cost mistake teams make.

```python
from PIL import Image
import io

def prepare_image_for_api(
    image_path: str,
    max_long_edge: int = 1568,
    quality: int = 85
) -> bytes:
    with Image.open(image_path) as img:
        # Convert RGBA to RGB for JPEG
        if img.mode in ("RGBA", "LA"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1])
            img = background

        # Resize proportionally
        w, h = img.size
        if max(w, h) > max_long_edge:
            scale = max_long_edge / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        return buf.getvalue()
```

For UI screenshots with text, JPEG quality of 80–90 preserves readability while reducing size by 60–80% versus PNG. For diagrams with fine lines, stick to PNG — JPEG artifacts break OCR quality significantly.

### Choosing Between Base64 and URL References

Most APIs accept images as base64-encoded strings or publicly accessible URLs. URL references are cheaper to send (no encoding overhead) but require your images to be publicly accessible, which creates security surface for private documents.

For internal documents and user-uploaded content, base64 in the request body is safer. For high-volume public content (product images, public web screenshots), URL references reduce payload size and API latency.

### Document-Specific Preprocessing

PDFs are the worst-case input format. A PDF "with text" might have:
- Searchable text layers (fast, cheap to extract)
- Scanned pages rendered as images (slow, expensive)
- Mixed pages with both
- Tables rendered as positioned text (misleading column layout)

```python
import fitz  # PyMuPDF

def classify_pdf_pages(pdf_path: str) -> list[dict]:
    doc = fitz.open(pdf_path)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text().strip()
        image_area = sum(img[2] * img[3] for img in page.get_images())
        page_area = page.rect.width * page.rect.height

        pages.append({
            "page": i + 1,
            "has_text": len(text) > 100,
            "image_ratio": image_area / page_area if page_area > 0 else 0,
            "strategy": "text_extract" if len(text) > 100 else "vision"
        })
    return pages
```

Routing text-extractable pages to a text API call and image-heavy pages to a vision call reduces costs by 3–5× on typical invoice or contract workloads.

## Audio Processing at Scale

Direct audio processing (sending raw audio to a model) is powerful but expensive. Transcription-first pipelines are often more practical.

### When to Transcribe First vs. Direct Audio

**Transcribe first** when:
- You need speaker diarisation (who said what)
- The audio is long (>2 minutes)
- You're doing keyword search or compliance monitoring
- Cost is a primary constraint

**Direct audio** when:
- Tone, emotion, or non-verbal cues matter
- You're analysing music or environmental sound
- Latency is critical and a transcription roundtrip is too slow

### Chunking Long Audio

APIs impose file size limits. For transcription-based pipelines, chunk audio at silence boundaries rather than fixed intervals — splitting mid-word degrades accuracy measurably.

```python
from pydub import AudioSegment
from pydub.silence import detect_silence

def chunk_audio_at_silence(
    audio_path: str,
    max_chunk_ms: int = 60_000,
    silence_thresh_dbfs: int = -40,
    min_silence_ms: int = 300,
) -> list[AudioSegment]:
    audio = AudioSegment.from_file(audio_path)
    silences = detect_silence(audio, min_silence_len=min_silence_ms, silence_thresh=silence_thresh_dbfs)

    chunks = []
    start = 0
    for silence_start, silence_end in silences:
        if silence_start - start >= max_chunk_ms:
            chunks.append(audio[start:silence_start])
            start = silence_end
    chunks.append(audio[start:])
    return chunks
```

## Managing Cost and Latency in Mixed-Modal Pipelines

### Token Accounting for Images

Images are billed in tokens, but the conversion varies by API and model. As a rule of thumb: a 1568×1568 image costs roughly 1,600–2,000 tokens. A smaller 512×512 crop costs around 300–400. If you're analysing a document to extract one field, crop to the relevant region before sending.

For dashboards and monitoring, track image tokens separately from text tokens — they behave very differently under load and have different cost curves.

### Parallel Processing with Rate Limit Awareness

Multi-modal requests are heavier than text-only requests and consume rate limits faster. A single high-resolution image request might consume the token equivalent of 10 text queries.

```python
import asyncio
from collections import deque
import time

class RateLimitedPool:
    def __init__(self, requests_per_minute: int, tokens_per_minute: int):
        self.rpm = requests_per_minute
        self.tpm = tokens_per_minute
        self._request_times: deque = deque()
        self._token_counts: deque = deque()

    async def acquire(self, estimated_tokens: int) -> None:
        now = time.monotonic()
        window = 60.0

        # Evict old entries
        while self._request_times and self._request_times[0] < now - window:
            self._request_times.popleft()
        while self._token_counts and self._token_counts[0][0] < now - window:
            self._token_counts.popleft()

        current_tokens = sum(t for _, t in self._token_counts)
        wait = 0.0

        if len(self._request_times) >= self.rpm:
            wait = max(wait, window - (now - self._request_times[0]))
        if current_tokens + estimated_tokens > self.tpm:
            wait = max(wait, window - (now - self._token_counts[0][0]))

        if wait > 0:
            await asyncio.sleep(wait)

        self._request_times.append(time.monotonic())
        self._token_counts.append((time.monotonic(), estimated_tokens))
```

### Caching Strategies for Repeated Images

Identical image inputs produce identical API costs on every call. For documents that are processed repeatedly (product catalogues, template invoices, recurring reports), cache extracted results against a content hash.

```python
import hashlib
import json
from functools import wraps

def cache_by_content_hash(cache_store):
    def decorator(fn):
        @wraps(fn)
        async def wrapper(image_bytes: bytes, prompt: str, **kwargs):
            key = hashlib.sha256(image_bytes + prompt.encode()).hexdigest()
            if cached := await cache_store.get(key):
                return json.loads(cached)
            result = await fn(image_bytes, prompt, **kwargs)
            await cache_store.set(key, json.dumps(result), ex=3600)
            return result
        return wrapper
    return decorator
```

## Failure Modes Unique to Multi-modal

### Hallucination on Low-Quality Inputs

Vision models hallucinate more on blurry, low-contrast, or partially occluded images than on clean inputs. Production systems need confidence thresholds and fallback paths.

A document with a confidence score below threshold should route to human review rather than silently producing wrong extractions. Build this routing into your pipeline from day one.

### Format Drift in Structured Extraction

When extracting structured data from invoices or forms, the model may return field names that differ by punctuation, casing, or phrasing across calls. Use strict schema validation (Pydantic or JSON Schema) and reject malformed responses rather than normalising them post-hoc.

### Latency Spikes on Large Inputs

A 10MB PDF that processes in 2 seconds on average will occasionally take 45 seconds. Multi-modal requests have a much wider latency distribution than text requests. Set aggressive timeout budgets per page, not per document, and implement per-page retry logic.

## Putting It Together: A Production Checklist

Before shipping a multi-modal feature:

- **Resize images** before sending — never send raw user uploads directly
- **Classify PDFs** by page type and route to text extraction or vision accordingly
- **Track image tokens** separately in your observability stack
- **Cache results** by content hash for any repeated inputs
- **Validate outputs** with strict schemas, not lenient parsing
- **Set per-input timeouts** not per-batch timeouts
- **Build confidence thresholds** and human review fallback paths

## Conclusion

Multi-modal AI unlocks genuinely new product capabilities — processing a photo of a receipt, transcribing and summarising a meeting recording, extracting tables from scanned contracts. But the engineering surface is meaningfully larger than text-only AI.

The teams shipping these features reliably are the ones who treat input preprocessing as seriously as prompt engineering, track modality-specific costs, and build for the tail latency case from the start. The happy path is easy; the production-grade version requires intentional architecture at every layer.

Start with one modality, instrument it thoroughly, then expand. Multi-modal AI is high leverage — but only when the plumbing is solid.
