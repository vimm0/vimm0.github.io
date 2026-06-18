---
layout: post
title: "Context Engineering: The New Discipline of Managing What Your LLM Sees"
date: 2026-06-18 08:00:00 +0545
categories: [AI, Engineering]
tags: [context-engineering, llm, prompt-engineering, agents, rag, production, context-window]
---

Prompt engineering got the spotlight for years, but something bigger has quietly taken over: *context engineering*. As context windows grew from 4K to 200K tokens — and beyond — the hard problem stopped being "how do I phrase this" and became "what do I put in front of the model at all." This discipline is now a core competency for anyone building serious AI systems.

## What Is Context Engineering?

Context engineering is the practice of deliberately selecting, structuring, and managing the information that populates an LLM's context window at runtime. Where prompt engineering focuses on the wording of instructions, context engineering focuses on the composition of the entire input: what documents to include, in what order, how to compress history, when to truncate, and how to prioritize competing sources of information.

The shift matters because models are now highly sensitive to *what* they see, not just *how they're asked*. A 200K-token window sounds unlimited, but studies show model performance degrades for facts buried in the middle of a long context — the "lost in the middle" problem. Shoving everything in and hoping the model sorts it out is not a strategy.

## The Context Budget Mental Model

Think of your context window as a budget with hard limits and soft costs:

```
Total budget: 200,000 tokens
─────────────────────────────────────
System prompt:          ~1,000  tokens  (instructions, persona)
Retrieved documents:   ~50,000  tokens  (RAG results)  
Conversation history:  ~10,000  tokens  (compressed chat turns)
Current user message:   ~1,000  tokens  (the actual question)
Tool outputs:           ~5,000  tokens  (function results)
Reserved for output:   ~10,000  tokens  (generation budget)
─────────────────────────────────────
Headroom:             ~123,000  tokens  (waste if not used wisely)
```

The goal isn't to fill every token — it's to maximize the *relevance density* of what's included. Irrelevant content doesn't just waste tokens; it dilutes the signal and degrades answer quality.

## Core Patterns

### 1. Hierarchical Context Compression

Long conversation histories are one of the biggest context budget drains. Naive implementations append every turn and hit limits fast. Instead, compress older turns progressively:

```python
from anthropic import Anthropic

client = Anthropic()

def compress_history(turns: list[dict], keep_recent: int = 5) -> list[dict]:
    """Summarize old turns, keep recent ones verbatim."""
    if len(turns) <= keep_recent:
        return turns
    
    old_turns = turns[:-keep_recent]
    recent_turns = turns[-keep_recent:]
    
    # Summarize the old turns into a single system-level summary
    history_text = "\n".join(
        f"{t['role'].upper()}: {t['content']}" for t in old_turns
    )
    
    summary_response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{
            "role": "user",
            "content": (
                f"Summarize this conversation history into 3-5 bullet points "
                f"capturing key decisions, facts established, and user intent:\n\n{history_text}"
            )
        }]
    )
    
    summary_turn = {
        "role": "user",
        "content": f"[Conversation summary so far]\n{summary_response.content[0].text}"
    }
    
    return [summary_turn] + recent_turns
```

This pattern keeps recent turns verbatim (where precision matters) while compressing older context to a fraction of its original size.

### 2. Relevance-Ranked Retrieval Placement

When doing RAG, the order of retrieved chunks matters as much as which chunks you retrieve. Place the most relevant content immediately before the question, not at the top of a long document dump:

```python
def build_rag_context(
    query: str,
    retrieved_chunks: list[dict],
    max_tokens: int = 50_000,
) -> str:
    """Build context with most relevant chunks closest to the query."""
    
    # Sort by relevance score descending
    ranked = sorted(retrieved_chunks, key=lambda c: c["score"], reverse=True)
    
    # Token-budget-aware selection
    selected = []
    token_count = 0
    
    for chunk in ranked:
        chunk_tokens = len(chunk["content"].split()) * 1.3  # rough estimate
        if token_count + chunk_tokens > max_tokens:
            break
        selected.append(chunk)
        token_count += chunk_tokens
    
    # Place highest-relevance content last (closest to the question)
    # This counteracts the "lost in the middle" degradation
    selected.reverse()
    
    sections = []
    for i, chunk in enumerate(selected):
        sections.append(
            f"[Source {i+1}: {chunk['source']} | relevance: {chunk['score']:.2f}]\n"
            f"{chunk['content']}"
        )
    
    return "\n\n---\n\n".join(sections)
```

The reversal is intentional: LLMs attend more reliably to content at the beginning and end of context. By placing the highest-relevance chunks just before the question, you maximize recall.

### 3. Dynamic System Prompt Assembly

Static system prompts waste context budget. Build system prompts dynamically based on the task detected:

```python
PERSONA_BASE = "You are a helpful assistant for Acme Corp."

TOOL_INSTRUCTIONS = {
    "code_review": "Focus on security, readability, and performance. Be specific about line numbers.",
    "customer_support": "Be empathetic and concise. Escalate billing issues to the human queue.",
    "data_analysis": "Show your reasoning. Include confidence levels when making predictions.",
}

DOMAIN_CONTEXT = {
    "code_review": lambda user: f"Reviewing {user.primary_language} code. Team conventions: {user.style_guide}.",
    "customer_support": lambda user: f"Customer tier: {user.plan}. Account since: {user.created_at.year}.",
}

def build_system_prompt(task_type: str, user_context: dict) -> str:
    parts = [PERSONA_BASE]
    
    if task_type in TOOL_INSTRUCTIONS:
        parts.append(TOOL_INSTRUCTIONS[task_type])
    
    if task_type in DOMAIN_CONTEXT:
        parts.append(DOMAIN_CONTEXT[task_type](user_context))
    
    # Only include tool definitions relevant to this task
    if task_type == "code_review":
        parts.append(get_code_tool_definitions())
    
    return "\n\n".join(parts)
```

A dynamic system prompt for a customer support interaction might be 200 tokens instead of 2,000 — and the model performs better because there's less irrelevant instruction to wade through.

### 4. Context Window State Machines

For long-running agent tasks, treat context as a state machine with explicit transitions. Define what lives in context at each phase:

```python
from enum import Enum
from dataclasses import dataclass

class AgentPhase(Enum):
    PLANNING = "planning"
    EXECUTING = "executing"  
    SYNTHESIZING = "synthesizing"

@dataclass
class ContextState:
    phase: AgentPhase
    goal: str
    plan: list[str] | None = None
    completed_steps: list[dict] | None = None
    
    def to_context_block(self) -> str:
        parts = [f"CURRENT GOAL: {self.goal}"]
        
        if self.phase == AgentPhase.EXECUTING and self.plan:
            remaining = [s for s in self.plan if s not in self.completed_steps]
            parts.append(f"REMAINING STEPS:\n" + "\n".join(f"- {s}" for s in remaining))
            # Only include last 3 completed steps to save context
            recent = (self.completed_steps or [])[-3:]
            if recent:
                parts.append(f"RECENT COMPLETIONS:\n" + "\n".join(
                    f"- {s['step']}: {s['result'][:200]}" for s in recent
                ))
        
        if self.phase == AgentPhase.SYNTHESIZING:
            # Include full results only during synthesis
            parts.append(f"ALL RESULTS:\n" + "\n".join(
                f"- {s['step']}: {s['result']}" for s in (self.completed_steps or [])
            ))
        
        return "\n\n".join(parts)
```

This pattern keeps execution-phase context lean (recent steps only) and expands it only when the model needs a complete picture for synthesis.

## Measuring Context Quality

You can't improve what you don't measure. Two metrics worth tracking:

**Relevance density** — average similarity score of retrieved content to the actual query. Low scores mean your retrieval is pulling junk into the context.

**Context utilization** — what fraction of retrieved context gets referenced in the model's output (measurable via citation tracking or attention-based attribution). If the model consistently ignores half your retrieved chunks, you're wasting budget.

```python
def measure_context_quality(prompt_chunks: list[str], response: str) -> dict:
    cited = sum(1 for chunk in prompt_chunks if any(
        phrase in response 
        for phrase in chunk.split(". ")[:3]  # first few sentences as fingerprint
    ))
    return {
        "chunks_provided": len(prompt_chunks),
        "chunks_referenced": cited,
        "utilization_rate": cited / len(prompt_chunks) if prompt_chunks else 0,
    }
```

Aim for utilization rates above 60%. Below that, you're either over-retrieving or the retrieved content is off-topic.

## The Context Engineering Checklist

Before shipping any AI feature, ask:

- [ ] Is the system prompt scoped to what this specific task needs?
- [ ] Is conversation history compressed past a certain depth?
- [ ] Are retrieved documents ranked by relevance and placed near the query?
- [ ] Is there a token budget defined and enforced per slot (system / history / retrieved)?
- [ ] Are tool outputs summarized before re-injection into context?
- [ ] Is context utilization monitored in production?

## Conclusion

Context engineering is what separates toy demos from production AI systems. Prompt engineering taught us to ask better questions; context engineering teaches us to provide better answers to those questions by controlling exactly what the model works with.

The good news: these patterns are not exotic. Compression, ranking, dynamic assembly, and state machines are standard engineering tools applied to a new domain. The discipline is young enough that getting these fundamentals right puts you significantly ahead of most teams still thinking only about prompt wording.

As models get more capable and context windows continue to grow, the quality of what you put in front of them will matter more, not less. Start treating context as a first-class resource.
