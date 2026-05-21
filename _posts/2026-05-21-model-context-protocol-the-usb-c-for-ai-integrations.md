---
layout: post
title: "Model Context Protocol: The USB-C for AI Integrations"
date: 2026-05-21 07:00:00 +0545
categories: [AI, Integration]
tags: [mcp, llm, ai-agents, tools, protocol, anthropic]
---

The AI ecosystem has a wiring problem. Every tool, every data source, every API that an LLM might need access to requires custom glue code — written once per model, per platform, per version. Teams spend more time building connectors than building products. The **Model Context Protocol (MCP)** is Anthropic's answer: a universal, open standard for connecting AI models to the world around them.

Think of it like USB-C for AI. One port, every device.

## What Is MCP?

MCP is an open protocol that standardizes how AI applications communicate with external tools, data sources, and services. Before MCP, if you wanted Claude (or GPT, or Gemini) to query your database, call your internal API, or read files from your file system, you had to write custom integration code for each combination.

With MCP, a **server** (your tool or data source) exposes a well-defined interface, and any **client** (an AI model or agent framework) that speaks the protocol can use it — automatically, without additional glue code.

The architecture has three roles:

- **MCP Host**: the application running the AI (Claude Desktop, an IDE plugin, a custom agent)
- **MCP Client**: embedded in the host, manages connections to servers
- **MCP Server**: a lightweight process that exposes tools, resources, or prompts

## Three Primitives: Tools, Resources, Prompts

MCP's power comes from three clean abstractions.

### Tools

Tools are functions the AI can call. They're the action layer — anything the model should *do* rather than just know about.

```json
{
  "name": "search_codebase",
  "description": "Search the codebase for a symbol or pattern",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "file_pattern": { "type": "string" }
    },
    "required": ["query"]
  }
}
```

When a model decides to call `search_codebase`, the MCP client routes that call to the right server, which executes it and returns a result. The model never sees the underlying implementation.

### Resources

Resources are readable data sources — files, database records, API responses — that the host can include in the model's context. Unlike tools, resources are pulled in passively (by the host) rather than called actively (by the model).

```
resource://filesystem/src/main.ts
resource://postgres/users/table-schema
resource://github/repos/my-org/my-repo/issues
```

### Prompts

Prompts are reusable, parameterized message templates exposed by a server. They let server authors define the *best way* to invoke their capabilities, encoding context the model might otherwise miss.

## Building a Minimal MCP Server

Here's a working MCP server in Python using the official SDK:

```python
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types
import asyncio

app = Server("weather-server")

@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="get_forecast",
            description="Get a 3-day weather forecast for a city",
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
    if name == "get_forecast":
        city = arguments["city"]
        units = arguments.get("units", "celsius")
        # Your actual weather API call here
        forecast = fetch_weather(city, units)
        return [types.TextContent(type="text", text=forecast)]
    raise ValueError(f"Unknown tool: {name}")

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
```

Install the SDK with `pip install mcp`, run this server, and any MCP-compatible client can now call `get_forecast` without knowing anything about your weather API.

## Why This Matters for Agentic Systems

Single-turn chatbots don't need MCP — they just need a system prompt. But agents are different. An agent that can browse the web, write code, check your calendar, query your CRM, and send emails needs tens or hundreds of integrations. Without a standard, that's tens of thousands of lines of glue code across frameworks.

MCP solves this at the ecosystem level. Server authors build once. Agent frameworks consume universally. The network effects compound: today there are MCP servers for GitHub, Slack, Postgres, filesystem access, web search, browser control, Linear, Jira, and hundreds of other tools — all immediately available to any compliant agent.

This is how the "agentic web" gets built: not by every AI lab writing their own integration layer, but by a shared substrate that lets the community contribute tools once and benefit everywhere.

## Security Considerations

MCP shifts security responsibility in important ways. When a model can invoke arbitrary tools through an open protocol, you need to think carefully about:

**Tool scope**: Servers should expose the minimum capability needed. A read-only database server should never have write permissions, even if the underlying database supports it.

**Input validation**: Server implementations must validate all inputs from the model — treat them like untrusted user input, because the model can be manipulated by adversarial content it processes.

**Transport security**: For remote (HTTP-based) MCP servers, use TLS and authenticate every request. stdio-based servers (running as local subprocesses) are safer by default.

**Prompt injection awareness**: A malicious document in a resource could attempt to hijack the model's tool calls. Hosts should sandbox model actions and require confirmation for destructive operations.

## The Ecosystem Today

MCP launched in late 2024 and has seen rapid adoption. Claude Desktop, Cursor, Zed, and several other AI-native tools ship with MCP support out of the box. The official SDK exists for Python, TypeScript, and Kotlin, with community implementations in Go, Rust, and Java.

The MCP registry (modeled after npm) is growing quickly, with servers covering development tools, productivity apps, data platforms, and infrastructure providers. Most teams building serious agentic systems have standardized on MCP as their integration layer.

## Conclusion

MCP doesn't make building AI agents easy — that's still hard. But it removes one of the most tedious and duplicative parts of the work: writing the same integration code over and over for every tool your agent needs.

If you're building an agent, adopt MCP early. Connect to the existing ecosystem of servers rather than writing custom integrations. If you own an internal tool or API that agents might use, consider publishing an MCP server for it — you'll be giving every MCP-compatible agent in your organization immediate access, for free.

The protocol is open, the SDK is free, and the ecosystem is already large enough to be genuinely useful. This is the infrastructure layer for the agentic era.
