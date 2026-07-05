---
layout: post
title: "Model Context Protocol (MCP): Building Tool-Connected AI Agents"
date: 2026-07-05 08:00:00 +0545
categories: [AI, Backend]
tags: [mcp, model-context-protocol, ai-agents, tools, llm, anthropic, production]
---

The fundamental challenge with AI agents is not intelligence — it's connectivity. An LLM that can only reason over text it was trained on has a short shelf life. The real leverage comes when agents can read live data, call APIs, query databases, and act on external systems. For a long time, this was achieved via ad-hoc tool calling, with every team reinventing the same wheel.

**Model Context Protocol (MCP)** is Anthropic's answer: a standardized, open protocol for connecting AI models to tools, data sources, and services. It has rapidly become the de facto standard for tool-connected AI in 2026. This post covers how MCP works, how to build MCP servers, and what you need to know to run them reliably in production.

## What MCP Solves

Before MCP, connecting an LLM to external capabilities was fragmented:

- Each framework (LangChain, LlamaIndex, custom) had its own tool definition format
- Tools were tightly coupled to a specific model or SDK
- Sharing tools across teams meant copy-pasting code and reimplementing schemas
- There was no standard for how a model should discover what capabilities are available

MCP introduces a clean separation: **MCP servers** expose capabilities, and **MCP clients** (your AI application) consume them. The model sits in the middle, deciding when and how to invoke those capabilities. Any MCP-compatible client can use any MCP server without modification.

## The MCP Architecture

MCP defines three types of primitives that servers can expose:

| Primitive | What it is | Example |
|-----------|-----------|---------|
| **Tools** | Functions the model can call | `search_web`, `read_file`, `execute_sql` |
| **Resources** | Data the model can read | A file, a database row, an API response |
| **Prompts** | Pre-built prompt templates | "Summarize this document", "Debug this error" |

Communication between client and server happens over a **JSON-RPC 2.0** transport, either via `stdio` (for local servers) or HTTP with SSE (for remote servers).

```
┌─────────────────────────────────────────┐
│              Your AI App (Client)       │
│  ┌─────────────────────────────────┐    │
│  │  LLM (Claude, GPT-4, etc.)      │    │
│  └──────────────┬──────────────────┘    │
│                 │ tool calls             │
│  ┌──────────────▼──────────────────┐    │
│  │  MCP Client Layer               │    │
│  └──────────────┬──────────────────┘    │
└─────────────────┼───────────────────────┘
                  │ JSON-RPC
     ┌────────────┼─────────────────┐
     │            │                 │
┌────▼────┐  ┌────▼────┐  ┌────────▼────┐
│ DB MCP  │  │ Files   │  │  Slack MCP  │
│ Server  │  │ MCP     │  │  Server     │
└─────────┘  └─────────┘  └─────────────┘
```

## Building Your First MCP Server

The MCP Python SDK makes it straightforward to expose tools. Here's a minimal server that gives an AI agent access to a PostgreSQL database:

```python
from mcp.server import Server
from mcp.server.models import InitializationOptions
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent
import asyncpg
import json

app = Server("postgres-mcp")

DATABASE_URL = "postgresql://user:pass@localhost/mydb"

@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="execute_query",
            description="Execute a read-only SQL query against the database",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The SQL SELECT query to execute"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum rows to return (default 100)",
                        "default": 100
                    }
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="list_tables",
            description="List all tables in the database with their column schemas",
            inputSchema={
                "type": "object",
                "properties": {}
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        if name == "list_tables":
            rows = await conn.fetch("""
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                ORDER BY table_name, ordinal_position
            """)
            tables = {}
            for row in rows:
                t = row["table_name"]
                tables.setdefault(t, []).append(
                    f"{row['column_name']} ({row['data_type']})"
                )
            result = "\n".join(
                f"{t}: {', '.join(cols)}" for t, cols in tables.items()
            )
            return [TextContent(type="text", text=result)]

        elif name == "execute_query":
            query = arguments["query"]
            limit = arguments.get("limit", 100)
            # Safety: reject non-SELECT queries
            if not query.strip().upper().startswith("SELECT"):
                return [TextContent(type="text", text="Error: only SELECT queries are allowed")]
            rows = await conn.fetch(f"{query} LIMIT {limit}")
            result = json.dumps([dict(r) for r in rows], default=str, indent=2)
            return [TextContent(type="text", text=result)]
    finally:
        await conn.close()

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="postgres-mcp",
                server_version="1.0.0"
            )
        )

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

## Connecting a Client

On the client side, any MCP-compatible host (Claude Desktop, Claude Code, or your own app using the MCP SDK) can discover and call these tools:

```python
import anthropic
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def run_agent_with_mcp():
    server_params = StdioServerParameters(
        command="python",
        args=["postgres_mcp_server.py"]
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # Discover available tools
            tools = await session.list_tools()
            tool_schemas = [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.inputSchema
                }
                for tool in tools.tools
            ]

            client = anthropic.Anthropic()
            messages = [{"role": "user", "content": "What tables are in the database and how many users do we have?"}]

            # Agentic loop
            while True:
                response = client.messages.create(
                    model="claude-opus-4-8",
                    max_tokens=4096,
                    tools=tool_schemas,
                    messages=messages
                )

                if response.stop_reason == "end_turn":
                    print(response.content[0].text)
                    break

                # Handle tool calls
                messages.append({"role": "assistant", "content": response.content})
                tool_results = []
                for block in response.content:
                    if block.type == "tool_use":
                        result = await session.call_tool(block.name, block.input)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result.content[0].text
                        })
                messages.append({"role": "user", "content": tool_results})
```

## Production Considerations

### Security

MCP servers can be powerful attack surfaces. Apply these guards:

**Input validation** — never pass raw LLM output to `eval()`, shell commands, or file paths without sanitization. The SQL example above rejects non-SELECT queries; similar guards belong everywhere.

**Authentication** — for remote HTTP servers, require API keys or OAuth tokens. The MCP spec supports `Authorization` headers on HTTP transports.

**Scoping** — expose only the capabilities the agent actually needs. A customer support agent doesn't need `execute_arbitrary_code` even if you have a server for it. Pass only relevant tools per agent role.

```python
# Scope tools by agent role
SUPPORT_TOOLS = ["get_ticket", "update_ticket", "search_knowledge_base"]
ANALYST_TOOLS = ["execute_query", "list_tables", "export_csv"]

def get_tools_for_role(role: str, all_tools: list) -> list:
    allowed = SUPPORT_TOOLS if role == "support" else ANALYST_TOOLS
    return [t for t in all_tools if t["name"] in allowed]
```

### Reliability

**Timeouts** — MCP calls can block indefinitely if a downstream service hangs. Set explicit timeouts in your transport configuration and handle `asyncio.TimeoutError` in your tool implementations.

**Error propagation** — return structured errors from tools rather than raising exceptions. The model needs to see the error message to handle it gracefully.

```python
@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    try:
        # ... tool logic
    except asyncpg.PostgresError as e:
        return [TextContent(type="text", text=f"Database error: {e}")]
    except Exception as e:
        return [TextContent(type="text", text=f"Unexpected error: {type(e).__name__}: {e}")]
```

**Retries** — implement exponential backoff for transient failures, especially on HTTP-transport servers calling external APIs.

### Observability

Log every tool call with its arguments, result, and latency. This is your primary debugging surface when an agent does something unexpected.

```python
import time
import logging

logger = logging.getLogger(__name__)

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    start = time.monotonic()
    try:
        result = await _execute_tool(name, arguments)
        logger.info("tool_call", extra={
            "tool": name,
            "args": arguments,
            "latency_ms": (time.monotonic() - start) * 1000,
            "status": "success"
        })
        return result
    except Exception as e:
        logger.error("tool_call", extra={
            "tool": name,
            "args": arguments,
            "latency_ms": (time.monotonic() - start) * 1000,
            "status": "error",
            "error": str(e)
        })
        raise
```

## The Ecosystem in 2026

The MCP ecosystem has grown substantially. There are now production-ready servers for:

- **Databases**: PostgreSQL, MySQL, SQLite, MongoDB
- **Code**: GitHub, GitLab, filesystem access
- **Productivity**: Slack, Notion, Google Drive, Jira
- **Observability**: Datadog, Grafana, Sentry
- **Cloud**: AWS, GCP, Azure management APIs

For greenfield projects, check the MCP registry before building custom servers — the tool you need may already exist and be actively maintained.

## Conclusion

MCP shifts the mental model from "an LLM with some tools bolted on" to "a standardized bus where any capable system can be connected to any AI agent." The protocol overhead is minimal, the security model is explicit, and the ecosystem is growing fast enough that you can often wire up capabilities in hours rather than days.

The pattern worth internalizing: build your MCP servers to be narrow and correct, not broad and approximate. A server that does one thing reliably — read your database, search your docs, call your internal API — is far more valuable than one that tries to do everything and fails unpredictably. Your agents will only be as reliable as the tools underneath them.
