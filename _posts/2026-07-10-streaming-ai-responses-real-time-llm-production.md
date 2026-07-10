---
layout: post
title: "Streaming AI Responses: Building Real-Time LLM Experiences in Production"
date: 2026-07-10 09:00:00 +0545
categories: [AI, Backend]
tags: [streaming, llm, server-sent-events, real-time, production, websockets]
---

Users expect AI chat interfaces to feel instant. When you hit Enter and wait three seconds for a blank screen, then suddenly see 400 words appear all at once, the experience feels broken — even if the latency is identical. Streaming token-by-token output is what makes ChatGPT feel responsive and alive. This post covers how to implement LLM response streaming correctly in production: the wire protocols, the server-side patterns, the client-side rendering, and the operational gotchas that bite teams at scale.

## Why Streaming Matters

The core insight is perceptual. Time to First Token (TTFT) matters more than total generation time for user satisfaction. A response that starts appearing in 300ms and takes 4 seconds to complete feels faster than one that takes 1.5 seconds to start and 3 seconds to finish — even though the second one delivers the full response sooner.

Streaming also unlocks better UX patterns: users can start reading while the model is still generating, cancel early if the response heads in the wrong direction, and copy partial output without waiting. For long-form generation (reports, code, analysis), this is a significant quality-of-life improvement.

## The Wire Protocol: Server-Sent Events

Server-Sent Events (SSE) is the standard protocol for streaming LLM responses. It's a simple HTTP chunked response with a specific text format:

```
data: {"type":"content_block_delta","delta":{"text":"Hello"}}

data: {"type":"content_block_delta","delta":{"text":" world"}}

data: [DONE]
```

Each `data:` line is one event. The double newline separates events. The `[DONE]` sentinel signals the end of the stream.

SSE has several advantages over WebSockets for this use case: it works over standard HTTP/1.1, it's unidirectional (perfect for response streaming), it has built-in reconnection in browsers, and it's trivially proxied by CDNs and load balancers.

## Server-Side Implementation

Here's a FastAPI endpoint that streams responses from the Anthropic API:

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import anthropic
import json

app = FastAPI()
client = anthropic.Anthropic()

async def generate_stream(prompt: str):
    with client.messages.stream(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        for text in stream.text_stream:
            event = json.dumps({"delta": text})
            yield f"data: {event}\n\n"
    yield "data: [DONE]\n\n"

@app.get("/stream")
async def stream_response(prompt: str):
    return StreamingResponse(
        generate_stream(prompt),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable Nginx buffering
        },
    )
```

The `X-Accel-Buffering: no` header is critical in production. Without it, Nginx (and many reverse proxies) will buffer the entire response before forwarding it to the client, completely defeating the purpose of streaming.

## Handling Backpressure

In production, clients disconnect, networks hiccup, and clients read slower than the model generates. You need to handle backpressure — the case where your write buffer fills up because the client isn't reading fast enough.

```python
import asyncio

async def generate_stream_with_backpressure(prompt: str):
    queue = asyncio.Queue(maxsize=10)  # bounded buffer
    
    async def producer():
        with client.messages.stream(model="claude-opus-4-8", ...) as stream:
            for text in stream.text_stream:
                await queue.put(text)  # blocks if buffer full
        await queue.put(None)  # sentinel
    
    asyncio.create_task(producer())
    
    while True:
        token = await asyncio.wait_for(queue.get(), timeout=30.0)
        if token is None:
            yield "data: [DONE]\n\n"
            break
        yield f"data: {json.dumps({'delta': token})}\n\n"
```

The bounded queue ensures that if the client falls behind, the producer slows down rather than accumulating an unbounded buffer in memory. The 30-second timeout handles cases where clients disappear silently (which is more common than you'd expect on mobile networks).

## Client-Side: The EventSource API

The browser's native `EventSource` API handles SSE reconnection automatically:

```javascript
function streamCompletion(prompt, onToken, onDone) {
  const url = `/stream?prompt=${encodeURIComponent(prompt)}`;
  const source = new EventSource(url);

  source.onmessage = (event) => {
    if (event.data === "[DONE]") {
      source.close();
      onDone();
      return;
    }
    const { delta } = JSON.parse(event.data);
    onToken(delta);
  };

  source.onerror = (err) => {
    console.error("Stream error:", err);
    source.close();
  };

  return () => source.close(); // cleanup function
}
```

For React, wrap this in a hook:

```typescript
function useStreamingCompletion(prompt: string) {
  const [text, setText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    if (!prompt) return;
    setText("");
    setIsStreaming(true);

    const cleanup = streamCompletion(
      prompt,
      (delta) => setText((prev) => prev + delta),
      () => setIsStreaming(false)
    );

    return cleanup;
  }, [prompt]);

  return { text, isStreaming };
}
```

## Rendering Markdown While Streaming

Rendering Markdown in real-time as tokens arrive requires careful handling — you can't parse incomplete Markdown. The standard approach is to render raw text progressively and apply Markdown formatting only once streaming completes. But this produces a jarring visual jump.

A better pattern: parse and render incrementally, but only commit "safe" fragments — complete paragraphs, completed code blocks, finished list items. Buffer incomplete structures and render them as plain text until they're closed:

```typescript
function safeMarkdownFragment(partial: string): string {
  // Close unclosed code fences for safe rendering
  const fenceCount = (partial.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) {
    return partial + "\n```";
  }
  return partial;
}
```

Libraries like `react-markdown` with `rehype-highlight` handle most of this, but watch out for performance — re-parsing 2000 tokens of Markdown on every new token is expensive. Debounce the re-render or use a streaming-aware parser.

## Production Considerations

**Timeouts:** Set aggressive timeouts at every layer. A stuck LLM inference can hold a connection open for minutes. Set a maximum stream duration (e.g., 120 seconds) and close the connection if that limit is hit.

**Request cancellation:** When a user navigates away or cancels, cancel the upstream API call. This prevents paying for tokens nobody will read. In Python, use `asyncio.CancelledError` to trigger cleanup.

**Load balancer configuration:** Sticky sessions aren't needed for SSE, but ensure your load balancer doesn't have a shorter timeout than your stream duration. AWS ALB has a default 60-second idle timeout — bump it to 300+ seconds for long generations.

**Monitoring:** Track TTFT (Time to First Token) and streaming throughput (tokens/second) as separate metrics from total request latency. Regressions in TTFT are invisible to p99 latency metrics but users notice them immediately.

**Rate limiting:** SSE connections are long-lived, which means a rate limiter that counts requests by the second won't protect you from a user holding 50 concurrent streaming connections. Limit concurrent streams per user, not just request rate.

## Conclusion

Streaming LLM responses is table stakes for any user-facing AI product. The implementation looks simple — just forward chunks as they arrive — but production-grade streaming requires attention to backpressure handling, proxy configuration, incremental rendering, and connection lifecycle management.

Start with SSE rather than WebSockets unless you need bidirectional communication. Set `X-Accel-Buffering: no` on day one or you'll spend an afternoon debugging why your staging environment streams but production doesn't. And instrument TTFT separately — it's the metric your users care about most, and it won't show up in your existing latency dashboards.
