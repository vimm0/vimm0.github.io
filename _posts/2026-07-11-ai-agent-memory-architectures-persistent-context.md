---
layout: post
title: "AI Agent Memory Architectures: Giving Agents Persistent Context and Long-Term Knowledge"
date: 2026-07-11 09:00:00 +0545
categories: [AI, Backend]
tags: [agents, memory, rag, embeddings, llm, production, langchain, context]
---

Agents that forget everything after each conversation aren't really agents — they're stateless request handlers with a language model attached. The moment you need an AI system to remember a user's preferences, learn from past mistakes, or accumulate knowledge across sessions, you need a memory architecture. This post covers the four types of agent memory, how to implement each in production, and the tradeoffs that determine which combination to reach for.

## Why Agent Memory Is Hard

The core problem is the context window. Every LLM call is stateless — you send tokens in, you get tokens back, and the model retains nothing. All "memory" in agent systems is an illusion maintained by the application layer: you're deciding what to retrieve, what to summarize, and what to inject into the next prompt.

This creates a fundamental tension. More context means better decisions but higher cost and latency. Less context means faster, cheaper calls but the agent loses coherence over long tasks. The four memory types map to different points on that tradeoff curve.

## The Four Memory Types

### 1. In-Context Memory (Working Memory)

This is the conversation history — messages appended to the prompt on every turn. It's zero infrastructure, perfectly accurate, and limited to one session.

```python
from anthropic import Anthropic

client = Anthropic()
conversation_history = []

def chat(user_message: str) -> str:
    conversation_history.append({
        "role": "user",
        "content": user_message
    })
    
    response = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=conversation_history
    )
    
    assistant_message = response.content[0].text
    conversation_history.append({
        "role": "assistant", 
        "content": assistant_message
    })
    
    return assistant_message
```

The problem: conversation history grows unbounded. A 128K context window sounds large until your agent is running a multi-step task and each tool call adds another 500 tokens. You need a truncation or summarization strategy before you hit the limit.

```python
def trim_history(history: list, max_tokens: int = 50000) -> list:
    # Always keep system prompt and recent messages
    # Summarize or drop older messages when approaching limit
    estimated_tokens = sum(len(m["content"]) // 4 for m in history)
    
    while estimated_tokens > max_tokens and len(history) > 4:
        # Drop the oldest non-system message pair
        history.pop(1)
        if len(history) > 1:
            history.pop(1)
        estimated_tokens = sum(len(m["content"]) // 4 for m in history)
    
    return history
```

### 2. External Memory (Episodic and Semantic)

For cross-session persistence, you need a database. The two dominant patterns are episodic (storing raw interaction logs) and semantic (storing embedded chunks for similarity search).

**Episodic memory** — a timestamped log of what happened:

```python
import sqlite3
from datetime import datetime

class EpisodicMemory:
    def __init__(self, db_path: str):
        self.conn = sqlite3.connect(db_path)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS episodes (
                id INTEGER PRIMARY KEY,
                session_id TEXT,
                timestamp TEXT,
                role TEXT,
                content TEXT,
                metadata TEXT
            )
        """)
    
    def store(self, session_id: str, role: str, content: str, metadata: dict = None):
        self.conn.execute(
            "INSERT INTO episodes VALUES (NULL, ?, ?, ?, ?, ?)",
            (session_id, datetime.utcnow().isoformat(), role, content, 
             str(metadata or {}))
        )
        self.conn.commit()
    
    def retrieve_recent(self, session_id: str, limit: int = 20) -> list:
        cursor = self.conn.execute(
            "SELECT role, content FROM episodes WHERE session_id = ? "
            "ORDER BY timestamp DESC LIMIT ?",
            (session_id, limit)
        )
        rows = cursor.fetchall()
        return [{"role": r[0], "content": r[1]} for r in reversed(rows)]
```

**Semantic memory** — embed content and retrieve by similarity:

```python
import numpy as np
from anthropic import Anthropic

client = Anthropic()

class SemanticMemory:
    def __init__(self, vector_store):
        self.store = vector_store  # e.g., pgvector, Pinecone, Qdrant
    
    def embed(self, text: str) -> list[float]:
        # Use your embedding model of choice
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1,
            messages=[{"role": "user", "content": f"Embed: {text}"}]
        )
        # In practice, use a dedicated embedding API endpoint
        # This is illustrative — use voyage-3 or text-embedding-3-large
        return []
    
    def remember(self, content: str, metadata: dict):
        embedding = self.embed(content)
        self.store.upsert(embedding=embedding, content=content, metadata=metadata)
    
    def recall(self, query: str, top_k: int = 5) -> list[dict]:
        query_embedding = self.embed(query)
        return self.store.query(embedding=query_embedding, top_k=top_k)
```

### 3. Procedural Memory (Skills and Instructions)

This is knowledge about *how* to do things — system prompts, tool definitions, few-shot examples, and learned behavioral patterns. It changes rarely but shapes every interaction.

The key insight: procedural memory should be versioned and tested like code. Teams that treat system prompts as mutable strings in a database end up with agents that behave inconsistently across sessions.

```python
class ProceduralMemory:
    def __init__(self, skills_dir: str):
        self.skills_dir = skills_dir
        self._cache = {}
    
    def load_skill(self, skill_name: str) -> str:
        if skill_name not in self._cache:
            path = f"{self.skills_dir}/{skill_name}.md"
            with open(path) as f:
                self._cache[skill_name] = f.read()
        return self._cache[skill_name]
    
    def build_system_prompt(self, active_skills: list[str]) -> str:
        sections = []
        for skill in active_skills:
            sections.append(self.load_skill(skill))
        return "\n\n---\n\n".join(sections)
```

### 4. Cache-Augmented Memory

Anthropic's prompt caching lets you prefix large, stable context blocks — documents, tool definitions, reference material — once and reuse them across many calls without re-paying the input token cost.

```python
response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": large_knowledge_base,  # 50K tokens of reference docs
            "cache_control": {"type": "ephemeral"}
        }
    ],
    messages=[
        {"role": "user", "content": user_query}
    ]
)
```

Cached tokens cost ~10% of normal input token prices and have a 5-minute TTL that resets on each use. For agents with stable context (customer data, product catalogs, codebase snapshots), this can cut inference costs by 60–80%.

## Putting It Together: A Layered Memory System

Production agents rarely use just one memory type. A practical architecture layers them:

```python
class AgentMemory:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.working = []          # In-context conversation history
        self.episodic = EpisodicMemory("agent.db")
        self.semantic = SemanticMemory(vector_store)
        self.procedural = ProceduralMemory("./skills")
    
    def before_turn(self, user_message: str) -> dict:
        # 1. Retrieve relevant memories based on the incoming message
        relevant_memories = self.semantic.recall(user_message, top_k=3)
        recent_history = self.episodic.retrieve_recent(self.user_id, limit=10)
        
        # 2. Build the context to inject
        memory_context = self._format_memories(relevant_memories)
        
        # 3. Prepend to working memory if not already there
        if memory_context:
            self.working.insert(0, {
                "role": "user",
                "content": f"[Relevant context from previous sessions]\n{memory_context}"
            })
            self.working.insert(1, {
                "role": "assistant",
                "content": "I've reviewed the relevant context. Ready to help."
            })
        
        return {
            "system": self.procedural.build_system_prompt(["base", "tools"]),
            "messages": self.working + [{"role": "user", "content": user_message}]
        }
    
    def after_turn(self, user_message: str, assistant_response: str):
        # Store in episodic memory
        self.episodic.store(self.user_id, "user", user_message)
        self.episodic.store(self.user_id, "assistant", assistant_response)
        
        # Embed and store notable information semantically
        if self._is_worth_remembering(assistant_response):
            self.semantic.remember(
                content=f"User asked: {user_message}\nAgent responded: {assistant_response}",
                metadata={"user_id": self.user_id, "type": "interaction"}
            )
        
        # Update working context
        self.working.append({"role": "user", "content": user_message})
        self.working.append({"role": "assistant", "content": assistant_response})
        self.working = trim_history(self.working)
    
    def _is_worth_remembering(self, response: str) -> bool:
        # Heuristic: only embed responses with substantive information
        return len(response) > 200 and not response.startswith("I don't")
    
    def _format_memories(self, memories: list) -> str:
        if not memories:
            return ""
        lines = [f"- {m['content'][:200]}..." for m in memories]
        return "\n".join(lines)
```

## Operational Considerations

**Memory decay.** Not all memories should live forever. User preferences from six months ago may be stale. Implement TTLs on episodic records and periodic re-embedding for semantic stores that drift.

**Privacy and isolation.** Memory must be strictly tenant-isolated. A vector store that leaks one user's embedded data into another user's retrieval is a serious security incident. Always include a `user_id` filter in every semantic query — never rely on embedding similarity alone to enforce isolation.

**Memory conflicts.** Users contradict themselves. "I prefer dark mode" followed three weeks later by "I've switched to light mode" creates a conflict in semantic memory. You need a deduplication or update strategy, not just append-only insertion.

**Cold start.** New users have no memory. Design the agent to function gracefully with empty retrieval results, and consider explicit onboarding flows that populate procedural memory with stated preferences.

## When to Use What

| Memory Type | Scope | Use When |
|-------------|-------|----------|
| In-context | Single session | Short tasks, conversational flows |
| Episodic | Cross-session | Audit logs, conversation history replay |
| Semantic | Cross-session | Knowledge retrieval, preference recall |
| Procedural | Persistent | Agent skills, behavioral guidelines |
| Cache-augmented | Per-call | Large stable documents, tool schemas |

## Conclusion

Agent memory is infrastructure, not an afterthought. The teams shipping production agents that users trust have invested in all four memory types and know which to reach for in which situation. Start with in-context history and episodic logging — those are table stakes. Add semantic retrieval when users need the agent to "remember" information across sessions. Layer in cache-augmented prefixes when your costs don't make sense relative to the token counts. And treat procedural memory (your system prompts and skill definitions) like production code: version-controlled, tested, and reviewed before deployment.

The context window will keep growing, but the fundamental challenge — deciding what's worth remembering and how to surface it at the right moment — will remain. That's an application-layer problem, and no model update will solve it for you.
