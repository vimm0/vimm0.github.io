---
layout: post
title: "Model Context Protocol (MCP) in Production: Building Reliable AI Tool Integrations"
date: 2026-07-19 08:00:00 +0545
categories: [AI, Backend]
tags: [mcp, model-context-protocol, ai-agents, tool-use, llm, production, anthropic]
---

The Model Context Protocol (MCP) has rapidly emerged as the de-facto standard for connecting large language models to external tools, data sources, and services. What started as an Anthropic open standard has been adopted across the industry — from IDE plugins to enterprise data pipelines — fundamentally changing how AI agents interact with the world.

In this post, we explore what MCP is, how it works under the hood, and what you need to know to run MCP servers reliably in production.

## What Is MCP?

MCP is an open protocol that standardizes how AI applications expose tools and resources to language models. Think of it as a USB-C port for AI: a single, universal interface that lets any model connect to any tool without custom glue code.

Before MCP, every AI application had to invent its own function-calling format, authentication strategy, and transport layer. MCP solves this by defining:

- **Tools** — callable functions the model can invoke (e.g., `search_web`, `read_file`, `execute_sql`)
- **Resources** — data the model can read (e.g., files, database rows, API responses)
- **Prompts** — reusable prompt templates exposed by the server
- **Transport** — how client and server communicate (stdio, HTTP SSE, WebSockets)

The protocol is JSON-RPC 2.0 under the hood, which makes it easy to implement in any language.

## Architecture: Client, Server, and Host

An MCP deployment has three roles:

```
┌─────────────────────────────────────┐
│             Host (e.g., Claude)     │
│  ┌──────────┐      ┌─────────────┐  │
│  │  Client  │◄────►│  LLM Core   │  │
│  └────┬─────┘      └─────────────┘  │
└───────┼─────────────────────────────┘
        │ MCP Protocol (JSON-RPC 2.0)
   ┌────▼──────┐   ┌────────────┐
   │ MCP Server│   │ MCP Server │
   │ (Postgres)│   │  (GitHub)  │
   └───────────┘   └────────────┘
```

- **Host** — the AI application (Claude Code, a chatbot, an agent framework)
- **Client** — lives inside the host; manages MCP connections and routes tool calls
- **Server** — exposes tools and resources; can be local (stdio) or remote (HTTP)

A single host can connect to dozens of MCP servers simultaneously, and each server can expose any number of tools.

## Building an MCP Server

Here's a minimal Python MCP server using the official SDK:

```python
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

app = Server("weather-server")

@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="get_weather",
            description="Get current weather for a city",
            inputSchema={
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "City name"},
                    "units": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "default": "celsius"
                    }
                },
                "required": ["city"]
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "get_weather":
        city = arguments["city"]
        units = arguments.get("units", "celsius")
        # Fetch from weather API
        data = await fetch_weather(city, units)
        return [types.TextContent(type="text", text=str(data))]
    raise ValueError(f"Unknown tool: {name}")

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

The SDK handles protocol negotiation, capability exchange, and message framing — you just implement the business logic.

## Production Considerations

Running MCP in production is not the same as running it locally. Several concerns emerge at scale.

### Transport Choice Matters

**stdio** (local process) is the simplest transport. The host spawns a child process and communicates over stdin/stdout. It's zero-config but limits you to single-host deployments.

**HTTP + SSE** (Server-Sent Events) enables remote servers and multi-tenant deployments. The server exposes a standard HTTP endpoint:

```
POST /mcp/message    → send JSON-RPC request
GET  /mcp/events     → receive SSE stream of responses
```

For high-throughput scenarios, consider WebSocket transport, which avoids the overhead of HTTP handshakes per message.

### Authentication and Authorization

MCP doesn't mandate an auth scheme — that's left to the transport layer. For HTTP servers, use OAuth 2.0 or API key headers:

```python
from fastapi import FastAPI, Header, HTTPException
from mcp.server.fastapi import create_mcp_router

async def verify_token(authorization: str = Header(...)):
    token = authorization.removeprefix("Bearer ")
    if not await is_valid_token(token):
        raise HTTPException(status_code=401)
    return token

app = FastAPI()
mcp_router = create_mcp_router(mcp_server)
app.include_router(mcp_router, prefix="/mcp", dependencies=[Depends(verify_token)])
```

For multi-tenant scenarios, inject tenant context from the auth token so tool calls are scoped appropriately.

### Error Handling and Retries

MCP tool calls can fail for many reasons: network timeouts, downstream API errors, rate limits. Define a clear error taxonomy and surface it to the model:

```python
@app.call_tool()
async def call_tool(name: str, arguments: dict):
    try:
        result = await execute_tool(name, arguments)
        return [types.TextContent(type="text", text=result)]
    except RateLimitError as e:
        # Tell the model to back off
        return [types.TextContent(
            type="text",
            text=f"Rate limited. Retry after {e.retry_after} seconds."
        )]
    except PermissionError:
        return [types.TextContent(type="text", text="Access denied to this resource.")]
    except Exception as e:
        # Generic error — don't leak stack traces
        logger.exception("Tool call failed", tool=name)
        return [types.TextContent(type="text", text="Tool execution failed. Try again later.")]
```

Avoid leaking internal error details in the tool response — the model will often repeat them to the user.

### Observability

Instrument your MCP server with structured logging and metrics:

```python
import time
from prometheus_client import Counter, Histogram

tool_calls = Counter("mcp_tool_calls_total", "Total tool calls", ["tool", "status"])
tool_latency = Histogram("mcp_tool_latency_seconds", "Tool call latency", ["tool"])

@app.call_tool()
async def call_tool(name: str, arguments: dict):
    start = time.monotonic()
    try:
        result = await execute_tool(name, arguments)
        tool_calls.labels(tool=name, status="success").inc()
        return result
    except Exception:
        tool_calls.labels(tool=name, status="error").inc()
        raise
    finally:
        tool_latency.labels(tool=name).observe(time.monotonic() - start)
```

Track call volume per tool, latency percentiles, and error rates. Sudden spikes in errors often indicate upstream API changes or model behavior shifts.

### Tool Schema Design

The quality of your tool schemas directly affects how reliably the model calls your tools. A few rules:

1. **Be specific in descriptions** — vague descriptions lead to incorrect invocations. "Runs a SQL query" is worse than "Executes a read-only SELECT query against the analytics database. Do not use for writes."
2. **Enumerate valid values** — use `enum` for parameters with fixed options rather than free-form strings.
3. **Mark required fields** — missing required parameters should be caught at schema validation, not at runtime.
4. **Avoid overloaded tools** — one tool that does five things is harder for models to use correctly than five focused tools.

## Deploying at Scale

For production deployments serving multiple users:

- **Containerize each MCP server** independently so they can be scaled, updated, and restarted without affecting others
- **Use a sidecar proxy** to handle auth, rate limiting, and observability at the transport layer
- **Pin server versions** in your host configuration — a tool schema change can break model behavior silently
- **Run integration tests** against real MCP servers in CI; mock-based tests miss protocol edge cases

## Conclusion

MCP has solved a fundamental problem in AI engineering: how do you connect models to the rest of the world in a maintainable, interoperable way? The protocol is simple enough to implement in a weekend, but the production concerns — auth, observability, error handling, schema design — take real engineering effort to get right.

As the ecosystem matures, expect to see more managed MCP hosting options, standardized server catalogs, and tighter integration with agent frameworks. For now, teams that invest in solid MCP infrastructure are building a durable foundation for whatever AI capabilities come next.
