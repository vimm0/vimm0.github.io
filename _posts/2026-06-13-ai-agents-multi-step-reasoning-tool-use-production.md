---
layout: post
title: "Multi-Step Reasoning Agents: Building AI That Plans, Executes, and Recovers"
date: 2026-06-13 08:00:00 +0545
categories: [AI, Backend]
tags: [ai-agents, llm, tool-use, reasoning, production]
---

The era of single-shot LLM calls is fading. What's replacing it is something far more interesting — agents that plan multi-step tasks, call external tools, recover from failures, and produce reliable results on complex real-world problems. In 2026, multi-step reasoning agents have moved from research curiosity to production staple. This post covers how they actually work, where they break, and how to build ones that survive contact with production.

## What "Multi-Step Reasoning" Actually Means

A single LLM call takes input and produces output. A reasoning agent takes a goal and produces a *sequence* of decisions — each informed by what previous steps returned. The key components are:

1. **A planning step** — the model decides what to do next
2. **Tool execution** — the model calls external APIs, databases, or code runners
3. **Observation** — the result is fed back into the context
4. **Loop or terminate** — the model decides whether it's done

This loop — Plan → Act → Observe → Repeat — is sometimes called the ReAct loop, popularized by a 2022 paper but now the backbone of production agent frameworks.

The power is real: a well-built reasoning agent can research a topic, write code, run it, debug the output, and return a verified result — all without human intervention.

## The Architecture in Practice

Here's a minimal but production-ready agent loop in Python:

```python
import anthropic
import json

client = anthropic.Anthropic()

tools = [
    {
        "name": "run_python",
        "description": "Execute a Python code snippet and return stdout/stderr",
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Python code to execute"}
            },
            "required": ["code"]
        }
    },
    {
        "name": "web_search",
        "description": "Search the web and return top results",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"}
            },
            "required": ["query"]
        }
    }
]

def run_tool(name: str, inputs: dict) -> str:
    if name == "run_python":
        # sandboxed execution
        return execute_sandboxed(inputs["code"])
    elif name == "web_search":
        return search_web(inputs["query"])
    return "Unknown tool"

def agent_loop(goal: str, max_steps: int = 10) -> str:
    messages = [{"role": "user", "content": goal}]
    
    for step in range(max_steps):
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            tools=tools,
            messages=messages
        )
        
        # Add assistant response to history
        messages.append({"role": "assistant", "content": response.content})
        
        if response.stop_reason == "end_turn":
            # Extract final text response
            for block in response.content:
                if block.type == "text":
                    return block.text
            return "Task complete"
        
        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    result = run_tool(block.name, block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result
                    })
            
            messages.append({"role": "user", "content": tool_results})
    
    return "Max steps reached"
```

This loop is deceptively simple. The complexity lives in three places: **tool reliability**, **context management**, and **failure recovery**.

## Where Agents Break in Production

### 1. Context Window Exhaustion

Each observation gets appended to the message history. On a long task with verbose tool outputs, you'll hit the context limit before the agent finishes. Solutions:

- **Summarize observations** — after each tool call, optionally compress the result before appending
- **Sliding window** — keep only the last N exchanges, with a compressed summary of earlier steps
- **Structured memory** — write intermediate results to a key-value store that the agent can query on demand

```python
def compress_observation(raw: str, max_chars: int = 500) -> str:
    if len(raw) <= max_chars:
        return raw
    # Use a cheap, fast model for summarization
    summary = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        messages=[{
            "role": "user",
            "content": f"Summarize this tool output in 2-3 sentences:\n\n{raw[:2000]}"
        }]
    ).content[0].text
    return summary
```

### 2. Tool Errors Causing Agent Confusion

If a tool returns an error, the agent often tries the same call again with minor variations — burning steps and budget. Better approach: wrap tool calls with structured error types the model is explicitly trained to handle.

```python
def run_tool_safe(name: str, inputs: dict) -> dict:
    try:
        result = run_tool(name, inputs)
        return {"status": "success", "output": result}
    except PermissionError as e:
        return {"status": "error", "type": "permission_denied", "message": str(e)}
    except TimeoutError:
        return {"status": "error", "type": "timeout", "message": "Tool timed out after 30s"}
    except Exception as e:
        return {"status": "error", "type": "unknown", "message": str(e)}
```

Including the error type helps the model decide: retry, try a different approach, or surface the error to the user.

### 3. Infinite Loops

Agents can get stuck in cycles — repeatedly calling the same tool with slightly different inputs, convinced they're making progress. Defense: track a fingerprint of recent tool calls and break if the same call repeats.

```python
from collections import Counter
import hashlib

call_hashes = []

def check_loop(name: str, inputs: dict) -> bool:
    key = hashlib.md5(f"{name}{json.dumps(inputs, sort_keys=True)}".encode()).hexdigest()
    call_hashes.append(key)
    # Detect if same call made 3+ times
    counts = Counter(call_hashes[-10:])
    return counts[key] >= 3
```

## Planning vs. Reactive Agents

Not all agents use a pure reactive loop. For complex tasks, you often want explicit planning before execution:

**Reactive (ReAct):** think → act → observe → repeat  
**Plan-then-Execute:** plan all steps upfront → execute them in order  
**Hierarchical:** a planner agent delegates subtasks to specialist sub-agents

The right choice depends on task structure. Reactive agents are more flexible and handle uncertainty better. Plan-then-execute agents are faster and cheaper on well-defined tasks. Hierarchical agents excel at tasks that naturally decompose — e.g., a research agent that spawns a searcher, a summarizer, and a fact-checker in parallel.

## Streaming Agent Responses

For user-facing agents, streaming matters. Users shouldn't stare at a blank screen while the agent works. The pattern is to stream the agent's *reasoning* text as it appears, while buffering tool calls until they complete:

```python
with client.messages.stream(
    model="claude-sonnet-4-6",
    max_tokens=4096,
    tools=tools,
    messages=messages
) as stream:
    for event in stream:
        if hasattr(event, 'type'):
            if event.type == 'content_block_delta':
                if hasattr(event.delta, 'text'):
                    # Stream reasoning text to user
                    yield event.delta.text
```

This gives users real-time visibility into what the agent is thinking — building trust and making long tasks feel interactive rather than opaque.

## Observability Is Non-Negotiable

A production agent that runs invisibly is an agent you can't debug. Every agent loop should emit structured traces:

```python
import structlog

log = structlog.get_logger()

def traced_agent_loop(goal: str) -> str:
    run_id = generate_id()
    log.info("agent.start", run_id=run_id, goal=goal[:100])
    
    for step in range(max_steps):
        log.info("agent.step", run_id=run_id, step=step)
        # ... agent logic ...
        
        for tool_call in tool_calls:
            log.info("agent.tool_call", 
                run_id=run_id, 
                tool=tool_call.name, 
                inputs=tool_call.input,
                step=step)
            result = run_tool_safe(tool_call.name, tool_call.input)
            log.info("agent.tool_result",
                run_id=run_id,
                tool=tool_call.name,
                status=result["status"],
                output_length=len(str(result.get("output", ""))))
    
    log.info("agent.complete", run_id=run_id, steps_used=step)
```

Pair this with a tool like OpenTelemetry (covered in a [previous post](/2026/06/12/opentelemetry-for-ai-systems-observability-llms-agents.html)) for distributed tracing across multi-agent workflows.

## Conclusion

Multi-step reasoning agents are powerful precisely because they break down complexity into manageable, observable steps. But that power comes with real failure modes: context exhaustion, tool errors, infinite loops, and invisible failures. The agents that work in production are the ones built with explicit defenses against all of these — compact observations, structured error types, loop detection, and full observability.

The underlying pattern — Plan, Act, Observe, Repeat — is simple. Making it reliable is where the engineering lives.
