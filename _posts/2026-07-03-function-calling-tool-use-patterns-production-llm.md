---
layout: post
title: "Function Calling & Tool Use Patterns in Production LLM Applications"
date: 2026-07-03 08:00:00 +0545
categories: [AI, Engineering, Architecture]
tags: [llm, function-calling, tool-use, agents, production-ai, api-design, orchestration]
---

Function calling transformed large language models from sophisticated text generators into active participants in software systems. When a model can invoke a weather API, query a database, or trigger a deployment pipeline, the application surface area expands dramatically — but so does the engineering surface for failure. Getting tool use right in production requires thoughtful API design, careful error handling, and explicit patterns for the tricky cases that tutorials rarely cover.

## How Function Calling Actually Works

At the protocol level, function calling is surprisingly simple. You describe available tools in your API request, the model responds with a tool invocation instead of text, your code executes the tool, and you return the result so the model can continue reasoning. The Claude API and OpenAI API both follow this basic loop.

```python
import anthropic

client = anthropic.Anthropic()

tools = [
    {
        "name": "get_order_status",
        "description": "Retrieve the current status and estimated delivery date for a customer order.",
        "input_schema": {
            "type": "object",
            "properties": {
                "order_id": {
                    "type": "string",
                    "description": "The unique order identifier, e.g. 'ORD-12345'"
                }
            },
            "required": ["order_id"]
        }
    }
]

messages = [{"role": "user", "content": "What's the status of order ORD-98765?"}]

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    tools=tools,
    messages=messages
)

# Model returns tool_use stop_reason when it wants to call a tool
if response.stop_reason == "tool_use":
    tool_use_block = next(b for b in response.content if b.type == "tool_use")
    tool_name = tool_use_block.name
    tool_input = tool_use_block.input
    tool_use_id = tool_use_block.id

    # Execute the actual tool
    result = execute_tool(tool_name, tool_input)

    # Feed result back to model
    messages.append({"role": "assistant", "content": response.content})
    messages.append({
        "role": "user",
        "content": [{
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": str(result)
        }]
    })

    final_response = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        tools=tools,
        messages=messages
    )
```

This single-turn tool invocation pattern handles most use cases. The real complexity emerges when tools fail, when multiple tools need to run in parallel, or when the model needs to chain tool calls across many steps.

## Parallel Tool Calls

Modern LLMs can request multiple tool invocations in a single response — a huge throughput win when independent operations can run concurrently. A travel assistant asking for flight availability, hotel prices, and weather forecasts simultaneously runs 3x faster than sequential calls.

```python
import asyncio

async def handle_parallel_tools(response, tools_map):
    tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
    
    if not tool_use_blocks:
        return response
    
    # Execute all tool calls concurrently
    tasks = [
        execute_tool_async(block.name, block.input)
        for block in tool_use_blocks
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    tool_results = []
    for block, result in zip(tool_use_blocks, results):
        if isinstance(result, Exception):
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": f"Error: {str(result)}",
                "is_error": True
            })
        else:
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": str(result)
            })
    
    return tool_results
```

Always check whether your tool execution environment supports concurrency. External APIs often have rate limits — fire five simultaneous calls at a rate-limited endpoint and you'll lose the speed benefit while generating errors the model then has to reason about.

## Designing Tool Schemas That Work

The quality of your tool schemas directly determines how reliably models invoke them correctly. A few principles that make a significant difference:

**Be explicit about edge cases in descriptions.** Don't just say "Searches for products." Say "Searches the product catalog by name, SKU, or description. Returns up to 20 results sorted by relevance. Use `category` to filter by department. Returns empty list if no matches found."

**Use enums for constrained inputs.** If a `status` field can only be "active", "inactive", or "pending", declare it as an enum. Models are far less likely to hallucinate values they can see explicitly enumerated.

**Separate concerns into distinct tools.** A `manage_user` tool that can create, update, and delete users based on an `action` parameter is harder for models to use correctly than three separate `create_user`, `update_user`, and `delete_user` tools with clear, minimal schemas.

```python
# Fragile: action-based multipurpose tool
{
    "name": "manage_user",
    "input_schema": {
        "properties": {
            "action": {"type": "string"},  # create/update/delete?
            "user_id": {"type": "string"},  # required for update/delete, ignored for create
            "data": {"type": "object"}       # varies by action
        }
    }
}

# Better: purpose-specific tools
{
    "name": "create_user",
    "input_schema": {
        "properties": {
            "email": {"type": "string", "format": "email"},
            "name": {"type": "string"},
            "role": {"type": "string", "enum": ["admin", "editor", "viewer"]}
        },
        "required": ["email", "name", "role"]
    }
}
```

## Handling Tool Errors Gracefully

Production tools fail. Databases timeout, APIs return 429s, external services go down. How you surface these errors back to the model determines whether the agent degrades gracefully or produces nonsense.

The `is_error` flag in tool results signals to the model that the tool execution failed without halting the conversation. A well-prompted model will attempt to explain the failure to the user or try an alternative approach.

```python
async def safe_tool_execution(tool_name: str, tool_input: dict, max_retries: int = 2):
    for attempt in range(max_retries + 1):
        try:
            result = await execute_tool(tool_name, tool_input)
            return {"success": True, "result": result}
        except RateLimitError as e:
            if attempt < max_retries:
                await asyncio.sleep(2 ** attempt)  # exponential backoff
                continue
            return {
                "success": False,
                "error": "Rate limit exceeded. Please try again in a moment.",
                "is_error": True
            }
        except TimeoutError:
            return {
                "success": False,
                "error": f"The {tool_name} tool timed out after 30 seconds.",
                "is_error": True
            }
        except PermissionError as e:
            return {
                "success": False,
                "error": f"Insufficient permissions to call {tool_name}: {str(e)}",
                "is_error": True
            }
```

Include enough detail in error messages for the model to make useful decisions — "Error" is useless, "The orders database is unreachable. You can check order history via the backup read replica instead." gives the model something to work with.

## Controlling Tool Access

Not all users should have access to all tools, and the tools available should match the current task context. Dynamically assembling the tool list per request keeps the context window efficient and reduces the attack surface for prompt injection.

```python
def get_tools_for_user(user: User, context: str) -> list[dict]:
    base_tools = [TOOL_REGISTRY["search_products"], TOOL_REGISTRY["get_order_status"]]
    
    if user.has_permission("manage_orders"):
        base_tools.append(TOOL_REGISTRY["cancel_order"])
        base_tools.append(TOOL_REGISTRY["issue_refund"])
    
    if user.has_permission("admin") and context == "admin_console":
        base_tools.extend([
            TOOL_REGISTRY["manage_users"],
            TOOL_REGISTRY["view_analytics"]
        ])
    
    return base_tools
```

This also matters for multi-tenant applications where one user's tool results must never leak to another's conversation. Always scope tool implementations to the authenticated user's context, not just the tool parameters the model provides.

## Bounding Tool Call Loops

An agent with tool access can loop indefinitely if it keeps deciding that more information is needed before responding. Always enforce a maximum tool call limit per conversation turn.

```python
async def run_agent_loop(messages: list, tools: list, max_iterations: int = 10):
    for iteration in range(max_iterations):
        response = await client.messages.create(
            model="claude-opus-4-8",
            max_tokens=4096,
            tools=tools,
            messages=messages
        )
        
        if response.stop_reason == "end_turn":
            return response  # Model finished naturally
        
        if response.stop_reason == "tool_use":
            tool_results = await handle_parallel_tools(response, tools)
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
            continue
        
        break  # Unexpected stop reason
    
    # Iteration limit hit — ask model to conclude with what it has
    messages.append({
        "role": "user",
        "content": "You've reached the maximum number of tool calls. Please provide the best answer you can with the information gathered so far."
    })
    return await client.messages.create(
        model="claude-opus-4-8",
        max_tokens=4096,
        messages=messages
    )
```

Ten iterations is generous for most user-facing agents. Background processing jobs can use higher limits. Log the iteration count — consistently hitting the ceiling is a signal your tool design or system prompt needs tuning.

## Observability for Tool Use

Tool calls are invisible to standard LLM observability unless you instrument them explicitly. At minimum, trace every tool invocation with the tool name, input parameters (sanitized of PII), execution duration, and success/failure status.

```python
import time
from opentelemetry import trace

tracer = trace.get_tracer("ai-agent")

async def traced_tool_execution(tool_name: str, tool_input: dict):
    with tracer.start_as_current_span(f"tool.{tool_name}") as span:
        span.set_attribute("tool.name", tool_name)
        span.set_attribute("tool.input_keys", list(tool_input.keys()))
        
        start = time.monotonic()
        try:
            result = await execute_tool(tool_name, tool_input)
            span.set_attribute("tool.success", True)
            span.set_attribute("tool.duration_ms", (time.monotonic() - start) * 1000)
            return result
        except Exception as e:
            span.set_attribute("tool.success", False)
            span.set_attribute("tool.error", str(e))
            span.record_exception(e)
            raise
```

Track which tools are called most frequently, which fail most often, and how long each takes. This data directly informs where to invest in caching, retry logic, and fallback strategies.

## Conclusion

Function calling unlocks the transition from passive LLM responses to active AI agents that take real actions in real systems. The core loop is straightforward, but production reliability requires deliberate engineering: well-designed tool schemas that constrain model choices, parallel execution where operations are independent, explicit error surfaces that give models actionable context, user-scoped tool access for security, bounded iteration to prevent runaway loops, and observability to understand what's actually happening at runtime.

The teams shipping robust AI agents aren't doing anything exotic — they've just built the same rigor around tool execution that they'd apply to any external API integration, then added a layer of prompt engineering to help models navigate failures gracefully. Start with those fundamentals before reaching for more complex orchestration frameworks.
