---
layout: post
title: "Agent Orchestration in Production: LangGraph, CrewAI, and Multi-Agent Workflows"
date: 2026-07-04 08:00:00 +0545
categories: [AI, Backend]
tags: [ai-agents, langgraph, crewai, multi-agent, orchestration, llm, production]
---

Building a single LLM call that works is easy. Building a system of AI agents that reliably coordinate, recover from errors, and scale under real-world load is genuinely hard. Agent orchestration frameworks exist to solve exactly that gap — and in 2026, three of them have emerged as the serious options for production: **LangGraph**, **CrewAI**, and **AutoGen**.

This post covers how each framework approaches orchestration differently, when to reach for each, and the patterns that actually hold up in production.

## Why Agent Orchestration Is Hard

Naive multi-agent systems fail in predictable ways:

- **Infinite loops**: agents call each other without a termination condition
- **Context blowup**: passing full conversation history between agents fills the context window and runs up costs
- **Error propagation**: one bad tool call corrupts the entire workflow state
- **Race conditions**: parallel agents writing to shared state create non-deterministic results

An orchestration framework is essentially a runtime that enforces control flow, manages state, and provides guardrails so you don't rediscover these failure modes in production.

## LangGraph: State Machines for Agents

LangGraph (from LangChain) models agent workflows as **directed graphs** where nodes are functions (or LLM calls) and edges are transitions between them. The key insight is that you define your workflow as an explicit state machine — not a free-form conversation.

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated
import operator

class AgentState(TypedDict):
    messages: Annotated[list, operator.add]
    current_step: str
    retrieved_docs: list

def research_node(state: AgentState):
    # Call LLM to decide what to search
    docs = search_knowledge_base(state["messages"][-1])
    return {"retrieved_docs": docs, "current_step": "draft"}

def draft_node(state: AgentState):
    # Use retrieved context to generate response
    response = llm.invoke(
        system="You are a writer. Use the provided docs.",
        context=state["retrieved_docs"],
        query=state["messages"][-1]
    )
    return {"messages": [response], "current_step": "review"}

def should_revise(state: AgentState) -> str:
    # Conditional edge: route based on quality check
    if quality_score(state["messages"][-1]) < 0.8:
        return "research"
    return END

graph = StateGraph(AgentState)
graph.add_node("research", research_node)
graph.add_node("draft", draft_node)
graph.add_edge("research", "draft")
graph.add_conditional_edges("draft", should_revise)
graph.set_entry_point("research")

app = graph.compile()
```

**What makes LangGraph production-ready:**

- **Checkpointing**: Built-in persistence lets you resume a paused workflow from any node. Combine with PostgreSQL or Redis for durable state.
- **Human-in-the-loop**: You can interrupt execution at any node, await user input, then resume. This is essential for workflows that touch sensitive data or financial actions.
- **Streaming**: LangGraph streams both token output and intermediate state updates, letting you build responsive UIs over long-running workflows.

**Best fit**: Complex, stateful workflows with branching logic — research pipelines, multi-step document processing, any workflow where you need to recover from partial failures.

## CrewAI: Role-Based Agent Teams

CrewAI takes a higher-level, more opinionated approach. You define **agents** with roles and goals, and **tasks** with descriptions, then let CrewAI handle the orchestration.

```python
from crewai import Agent, Task, Crew, Process

# Define specialized agents
researcher = Agent(
    role="Senior Research Analyst",
    goal="Find accurate and up-to-date information on the topic",
    backstory="You have 10 years of experience in technical research.",
    tools=[web_search_tool, arxiv_tool],
    llm="claude-sonnet-5",
    verbose=True
)

writer = Agent(
    role="Technical Writer",
    goal="Write clear, accurate technical content",
    backstory="You specialize in making complex topics accessible.",
    llm="claude-sonnet-5"
)

# Define tasks with explicit dependencies
research_task = Task(
    description="Research the latest advances in {topic}. Summarize key findings.",
    expected_output="A structured summary with key points and sources",
    agent=researcher
)

writing_task = Task(
    description="Using the research, write a 1000-word blog post on {topic}.",
    expected_output="A complete blog post in Markdown format",
    agent=writer,
    context=[research_task]  # This task consumes research output
)

crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process=Process.sequential,  # or Process.hierarchical
    verbose=True
)

result = crew.kickoff(inputs={"topic": "AI agent memory architectures"})
```

**Key patterns for production CrewAI:**

The `Process.hierarchical` mode introduces a manager LLM that dynamically delegates subtasks — useful when you don't know the full task breakdown upfront but adds cost and latency. For well-understood workflows, `Process.sequential` or `Process.parallel` is more predictable.

CrewAI's memory system (short-term, long-term, entity, contextual) is one of its strongest features. Long-term memory uses an embedded vector store to surface relevant past runs, avoiding repeated work across executions.

**Best fit**: Document workflows, content pipelines, research automation — anywhere you can naturally describe work as a team of specialists with defined handoffs.

## AutoGen: Conversational Agent Networks

Microsoft's AutoGen takes the most open-ended approach: agents communicate via natural language messages in a group chat, with no predefined graph topology. This makes it highly flexible but harder to reason about deterministically.

```python
from autogen import AssistantAgent, UserProxyAgent, GroupChat, GroupChatManager

code_agent = AssistantAgent(
    name="CodeAgent",
    llm_config={"model": "claude-sonnet-5"},
    system_message="You write and debug Python code. Return only working code."
)

reviewer_agent = AssistantAgent(
    name="ReviewAgent",
    llm_config={"model": "claude-haiku-4-5"},
    system_message="You review code for bugs and security issues. Be concise."
)

executor = UserProxyAgent(
    name="Executor",
    human_input_mode="NEVER",
    code_execution_config={"work_dir": "/tmp/autogen_work", "use_docker": True}
)

group_chat = GroupChat(
    agents=[code_agent, reviewer_agent, executor],
    messages=[],
    max_round=10
)

manager = GroupChatManager(
    groupchat=group_chat,
    llm_config={"model": "claude-haiku-4-5"}  # Cheap model for routing
)

executor.initiate_chat(manager, message="Write a function to parse CSV files safely.")
```

AutoGen's `max_round` is critical — without it, conversations can spiral. In production, always set this along with a timeout.

**Best fit**: Code generation and review loops, exploratory data analysis, scenarios where you want agents to debate or collaborate without a fixed structure.

## Production Patterns That Work Across Frameworks

### 1. External State, Not In-Context State

Never store workflow state only in the LLM context. Use a proper data store:

```python
# Bad: state lives only in messages
state = {"step": "research", "docs": [...very large list...]}

# Good: state in Redis, only IDs in context
redis_client.set(f"workflow:{workflow_id}:docs", json.dumps(doc_ids))
state = {"step": "research", "doc_ids": doc_ids}  # small, cheap to pass
```

### 2. Budget Constraints on Every Agent

Every agent invocation should have a token budget enforced at the framework level:

```python
# LangGraph node with budget enforcement
def capped_llm_call(state, max_tokens=2000):
    response = llm.invoke(
        state["messages"],
        max_tokens=max_tokens
    )
    if response.usage.total_tokens > max_tokens * 0.9:
        log.warning(f"Agent near token limit: {response.usage}")
    return response
```

### 3. Idempotent Tool Calls

Tools called by agents must be safe to retry. Wrap all tool calls with idempotency keys:

```python
def idempotent_tool(tool_fn):
    def wrapper(*args, idempotency_key=None, **kwargs):
        if idempotency_key:
            cached = cache.get(idempotency_key)
            if cached:
                return cached
        result = tool_fn(*args, **kwargs)
        if idempotency_key:
            cache.set(idempotency_key, result, ttl=3600)
        return result
    return wrapper
```

### 4. Observability at the Agent Level

Ship traces per agent call, not just per request. LangSmith (LangGraph), LangFuse, or a custom OpenTelemetry wrapper all work. The key metric is **agent step latency distribution** — spikes usually point to a runaway tool call or context bloat.

## Framework Comparison

| | LangGraph | CrewAI | AutoGen |
|---|---|---|---|
| **Control flow** | Explicit graph | Role + task | Conversational |
| **Checkpointing** | Built-in | External | External |
| **Human-in-loop** | First-class | Plugin | Supported |
| **Learning curve** | Medium | Low | Medium |
| **Determinism** | High | Medium | Low |
| **Best for** | Complex stateful | Content/research | Code generation |

## Conclusion

The right orchestration framework depends on how much control you need over execution flow. Start with **CrewAI** for well-defined, role-based workflows — it's the fastest path from idea to working prototype. Move to **LangGraph** when you need explicit state management, error recovery, or human-in-the-loop steps. Use **AutoGen** for open-ended code generation or exploration tasks where natural language coordination beats a rigid graph.

In all cases, treat your orchestration layer like production infrastructure: add observability from day one, enforce budget limits on every agent, and store state externally. The frameworks have matured significantly in 2026, but the failure modes of agent systems are still your responsibility to design around.
