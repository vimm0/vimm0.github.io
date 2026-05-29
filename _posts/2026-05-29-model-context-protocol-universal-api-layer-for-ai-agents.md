---
layout: post
title: "Model Context Protocol: The Universal API Layer for AI Agents"
date: 2026-05-29 08:00:00 +0545
categories: [AI, Architecture]
tags: [MCP, AI agents, LLM, tool-use, integration, protocol]
---

AI agents are only as powerful as the tools they can reach. A model that can reason brilliantly but can't read a file, query a database, or call an API is still just a chatbot. The **Model Context Protocol (MCP)** is emerging as the standard answer to that problem — a clean, composable interface that lets any AI agent connect to any tool or data source through a common contract.

## What Is MCP?

MCP is an open protocol that standardizes how AI models interact with external systems — files, databases, APIs, browser state, and more. Think of it as USB-C for AI: instead of every agent having bespoke integrations with every tool, you write one MCP server per tool, and any MCP-compatible client (Claude, GPT-based agents, open-source models) can use it immediately.

The protocol defines three primitives:

- **Resources** — read-only data exposed to the model (files, database rows, API responses)
- **Tools** — callable functions the model can invoke (write a file, send a Slack message, run a query)
- **Prompts** — reusable prompt templates stored server-side

This separation matters. Resources let the model pull context; tools let it take action; prompts let teams encode institutional knowledge the model can apply on demand.

## The Problem MCP Solves

Before MCP, connecting an AI agent to your internal systems meant custom glue code for every pair of (model, tool). A team building an AI coding assistant might wire Claude to their GitHub, Jira, and CI system — but that integration was theirs alone. Another team doing the same thing would start from scratch.

The surface area explodes quadratically: N models × M tools = N×M custom integrations. MCP collapses it to N + M: each model speaks MCP once, each tool exposes MCP once, and everything connects.

## How MCP Works in Practice

An MCP server is a process that speaks the MCP wire protocol (JSON-RPC over stdio or HTTP/SSE). The server advertises what it offers; the client (your agent runtime) discovers and calls those capabilities.

Here's a minimal MCP server in Python using the official SDK:

```python
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

app = Server("my-tool-server")

@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="read_file",
            description="Read a file from the local filesystem",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute file path"}
                },
                "required": ["path"]
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "read_file":
        with open(arguments["path"]) as f:
            return [types.TextContent(type="text", text=f.read())]
    raise ValueError(f"Unknown tool: {name}")

async def main():
    async with stdio_server() as streams:
        await app.run(*streams, app.create_initialization_options())

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

Wire this into your Claude Code config and the model can now read files through a standardized interface — no custom parsing, no brittle prompts about how to call a function.

## Resources vs. Tools: When to Use Each

A common early mistake is making everything a tool. Resources are cheaper: they don't require a function call round-trip, and they let the model scan context before deciding what to do.

**Use a resource when:**
- The data is read-only and the model needs it for context
- You want the model to decide whether the data is relevant (list of open issues, recent log lines)
- Latency of a live call is acceptable at context-load time

**Use a tool when:**
- The action has side effects (write, send, delete)
- The model needs to fetch data conditionally based on earlier reasoning
- The data is too large to load upfront and should be fetched on demand

A well-designed MCP server exposes both: a `list_issues` resource that loads current Jira tickets into context, and a `create_issue` tool the model calls when it decides to file a bug.

## Building Production MCP Servers

A hobby MCP server is easy to write. A production one needs more thought:

**Authentication** — MCP over HTTP supports OAuth 2.0. For internal tools, service accounts with scoped tokens are sufficient. Never pass credentials through tool arguments; inject them via environment variables at server startup.

**Idempotency** — If the agent retries a tool call after a timeout, will it create duplicate records? Build idempotency keys into write tools.

**Schema strictness** — Declare `additionalProperties: false` in your input schemas. Loose schemas let models hallucinate argument names and silently do the wrong thing.

**Observability** — Log every tool call with input, output, latency, and the model's conversation ID. You'll need this when debugging why an agent took an unexpected action.

```python
import structlog
log = structlog.get_logger()

@app.call_tool()
async def call_tool(name: str, arguments: dict):
    log.info("tool_call", tool=name, args=arguments)
    result = await dispatch(name, arguments)
    log.info("tool_result", tool=name, chars=sum(len(r.text) for r in result))
    return result
```

## The MCP Ecosystem Today

The protocol has seen rapid adoption. There are now community-maintained MCP servers for GitHub, Slack, Google Drive, PostgreSQL, Kubernetes, Figma, Linear, and dozens more. Most major agent frameworks — LangChain, LlamaIndex, Anthropic's agent SDK — have native MCP client support.

This creates a real leverage opportunity: invest in writing clean MCP servers for your internal systems once, and every AI-powered workflow your team builds going forward can use them without re-integration.

## Limitations to Know

MCP is not magic. A few real-world friction points:

- **Discovery is static** — the server declares its tools at startup. Dynamic toolsets (tools that depend on user permissions or runtime state) require workarounds like returning empty tool lists with explanatory errors.
- **Context window pressure** — listing many tools consumes tokens. Servers with 50+ tools should group them or implement filtering by category.
- **No streaming tool results** — tool responses are currently a single message. For tools that stream output (long-running jobs, live logs), you need polling patterns or out-of-band channels.

These are known gaps and active areas of protocol development.

## Conclusion

MCP is solving a real coordination problem in the AI tooling stack. By standardizing the interface between models and tools, it lets teams build integrations once and reuse them everywhere. The primitive set — resources, tools, prompts — is simple enough to implement in an afternoon but expressive enough to cover most real-world agent use cases.

If you're building AI-powered workflows on top of internal systems, the ROI on writing proper MCP servers is high: cleaner agent code, reusable integrations, and a path to connecting future models without a rewrite. Start with your highest-value data source — the one your team keeps copying into chat windows — and build from there.
