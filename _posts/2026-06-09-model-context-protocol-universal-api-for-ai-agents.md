---
layout: post
title: "Model Context Protocol: The Universal API for AI Agents"
date: 2026-06-09 08:00:00 +0545
categories: [AI, Development]
tags: [mcp, ai-agents, llm, tooling, anthropic, protocol]
---

The way AI assistants connect to the outside world has long been fragmented. Every LLM provider, every agent framework, and every tool integration required its own bespoke wiring. The Model Context Protocol (MCP) is Anthropic's answer to that chaos — a standardized, open protocol that lets AI models talk to external tools, data sources, and services through a single, consistent interface.

If REST is the lingua franca for web services, MCP aims to be the same for AI agent integrations.

## What Is MCP?

MCP defines a client-server protocol where:

- **MCP servers** expose capabilities — tools, resources, and prompts
- **MCP clients** (AI models, agents, IDEs) consume those capabilities
- **The transport layer** is flexible: stdio for local processes, HTTP+SSE for remote services

The key insight is that the *model* doesn't need to know anything about the underlying service. It sees a list of tools with JSON Schema definitions and calls them by name. The MCP server handles all the domain-specific logic.

```json
{
  "name": "read_file",
  "description": "Read contents of a file from the filesystem",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute path to the file"
      }
    },
    "required": ["path"]
  }
}
```

The model sees this schema, decides when to call `read_file`, passes the right arguments, and receives the result — without any hardcoded integration code.

## The Three Primitives

MCP organizes server capabilities into three categories:

### 1. Tools

Tools are callable functions — the verbs of your integration. They accept structured input, perform an action, and return a result. Tools map closely to REST endpoints or function calls.

```python
@server.tool()
async def search_database(query: str, limit: int = 10) -> list[dict]:
    results = await db.execute(
        "SELECT * FROM records WHERE content ILIKE $1 LIMIT $2",
        f"%{query}%", limit
    )
    return [dict(row) for row in results]
```

### 2. Resources

Resources are data that the model can read — file contents, database rows, API responses. Unlike tools, they're identified by URI and are meant to be consumed as context rather than triggering side effects.

```
resource://postgres/tables/users
resource://github/repos/my-org/my-repo/README.md
resource://slack/channels/engineering/messages?since=yesterday
```

### 3. Prompts

Prompts are reusable, parameterized prompt templates that servers can expose. They let a server define *how* to best use its tools — encoding domain knowledge into the protocol itself.

## Why MCP Matters for Agentic AI

Before MCP, connecting an AI agent to a new data source meant:

1. Writing custom integration code
2. Translating the API into tool definitions the model could understand
3. Handling auth, retries, and error normalization yourself
4. Repeating this for every model and every framework you use

With MCP, you write the server once. Any MCP-compatible client — Claude, VS Code extensions, custom agents, CI pipelines — can use it immediately.

This is the network effect play: as more servers get published (GitHub, Slack, Linear, databases, cloud providers), every MCP-compatible client gains capabilities for free.

## Building Your First MCP Server

The Python SDK makes it straightforward:

```bash
pip install mcp
```

```python
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

server = Server("my-weather-server")

@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="get_weather",
            description="Get current weather for a city",
            inputSchema={
                "type": "object",
                "properties": {
                    "city": {"type": "string"}
                },
                "required": ["city"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "get_weather":
        city = arguments["city"]
        # Your weather API call here
        weather_data = await fetch_weather(city)
        return [types.TextContent(
            type="text",
            text=f"Weather in {city}: {weather_data}"
        )]

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

The server communicates over stdin/stdout by default, making it easy to run as a subprocess from any MCP client.

## Remote MCP Servers

Local stdio servers are great for developer tools, but production agentic systems need remote, authenticated servers. MCP supports HTTP with Server-Sent Events (SSE) for this pattern:

```python
from mcp.server.sse import SseServerTransport
from starlette.applications import Starlette

transport = SseServerTransport("/messages")
app = Starlette(routes=[
    Route("/sse", endpoint=transport.handle_sse),
    Mount("/messages", app=transport.handle_post_message),
])
```

This lets you deploy MCP servers as regular web services — behind auth middleware, load balancers, and observability tooling you already have.

## The Emerging Ecosystem

The MCP ecosystem has grown rapidly. Servers now exist for:

- **Developer tools**: GitHub, GitLab, Jira, Linear, Notion
- **Data stores**: PostgreSQL, SQLite, Redis, Elasticsearch
- **Cloud providers**: AWS, GCP, Azure resource management
- **Communication**: Slack, email, calendar
- **Observability**: Datadog, PagerDuty, Grafana

What's particularly interesting is that the protocol itself is model-agnostic. Claude, GPT-4, Gemini — any model that supports tool calling can work with MCP servers. The same server you build for Claude today can serve other models tomorrow without any changes.

## MCP in CI/CD and Automation

One underappreciated use case: MCP servers as the backbone of AI-powered automation pipelines. Imagine a CI/CD pipeline where an AI agent:

1. Reads test failures from your test runner (resource)
2. Fetches recent commits from GitHub (tool)
3. Searches relevant documentation (tool)
4. Files a GitHub issue with a structured diagnosis (tool)

Each of these is a separate MCP server. The agent orchestrates them without any pipeline-specific glue code. The protocol handles the interface; you focus on the logic.

## Conclusion

MCP represents a maturation in how we think about AI integrations. Instead of every team reinventing tool definitions and every model requiring custom adapters, the ecosystem converges on a shared protocol.

The analogy to REST is instructive: REST didn't make APIs simpler by restricting what you could build — it made them *interoperable* by defining how you express what you build. MCP does the same for AI capabilities.

If you're building agents, internal tools, or any system where an LLM needs to interact with your infrastructure, MCP is worth understanding now. The ecosystem is young enough that early adopters will shape the conventions, but mature enough that it's production-ready for serious use.

The universal API for AI agents is here. Build your server.
