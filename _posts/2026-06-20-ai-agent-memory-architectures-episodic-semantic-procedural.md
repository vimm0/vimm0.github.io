---
layout: post
title: "AI Agent Memory Architectures: Building Persistent, Contextual Memory for Long-Running Agents"
date: 2026-06-20 08:00:00 +0545
categories: [AI, Backend]
tags: [ai-agents, memory, vector-databases, rag, llm, production]
---

Modern AI agents are increasingly expected to do more than answer a single question — they maintain ongoing relationships, remember past decisions, learn from interactions, and apply accumulated knowledge to new problems. The bottleneck is no longer intelligence; it's memory.

This post explores how to architect memory systems for production AI agents, covering the four memory types that mirror human cognition: working memory, episodic memory, semantic memory, and procedural memory.

## Why LLM Context Windows Aren't Enough

An LLM's context window is essentially volatile RAM. Everything in it disappears when the conversation ends. For a simple Q&A chatbot, that's fine. For an agent that handles a month-long software project, tracks customer relationships, or manages infrastructure over time, it falls apart fast.

The core problems with context-only memory:

- **Token limits**: Even a 200k-token context window fills up quickly with long interactions.
- **Recency bias**: LLMs attend more strongly to recent tokens, causing important early context to be "forgotten" in practice.
- **No persistence**: Restart the agent and all accumulated knowledge is gone.
- **Cost**: Stuffing an entire history into every request gets expensive at scale.

A proper agent memory architecture distributes memory across tiers, each optimized for different access patterns and retention horizons.

## The Four Memory Types

### 1. Working Memory — The Context Window

Working memory is what the agent can "see" right now: the current conversation, active task state, and relevant retrieved memories. This maps directly to the LLM's context window.

Best practices:
- Keep working memory focused. Don't dump everything into context — retrieve what's relevant.
- Use structured formats (JSON, YAML) for structured data in context; prose for natural language.
- Maintain a "scratchpad" section for the agent's intermediate reasoning.

```python
class WorkingMemory:
    def __init__(self, max_tokens: int = 8000):
        self.max_tokens = max_tokens
        self.system_prompt: str = ""
        self.conversation: list[dict] = []
        self.retrieved_context: list[str] = []
        self.scratchpad: str = ""

    def build_context(self) -> str:
        parts = [
            self.system_prompt,
            "\n## Retrieved Context\n" + "\n".join(self.retrieved_context),
            "\n## Scratchpad\n" + self.scratchpad,
        ]
        return "\n".join(p for p in parts if p.strip())
```

### 2. Episodic Memory — What Happened

Episodic memory stores a timeline of past interactions, decisions, and events. This is where the agent answers "what did I do last Tuesday?" or "what did this user ask about last month?"

Each episode is a structured record capturing:
- The interaction summary
- Key decisions made
- Outcomes observed
- Timestamp and context metadata

```python
from dataclasses import dataclass
from datetime import datetime
import uuid

@dataclass
class Episode:
    id: str
    timestamp: datetime
    session_id: str
    summary: str
    key_decisions: list[str]
    outcome: str
    entities_mentioned: list[str]
    embedding: list[float] | None = None

def create_episode(session_summary: str, llm_client, embed_client) -> Episode:
    # Use LLM to extract structured episode data
    extraction = llm_client.extract_episode(session_summary)
    embedding = embed_client.embed(session_summary)
    
    return Episode(
        id=str(uuid.uuid4()),
        timestamp=datetime.utcnow(),
        session_id=extraction["session_id"],
        summary=extraction["summary"],
        key_decisions=extraction["decisions"],
        outcome=extraction["outcome"],
        entities_mentioned=extraction["entities"],
        embedding=embedding,
    )
```

Episodes are stored in a vector database with their embeddings. At the start of a new session, relevant episodes are retrieved using semantic search and injected into working memory.

### 3. Semantic Memory — What the Agent Knows

Semantic memory is the agent's knowledge base: facts, learned preferences, domain knowledge, and accumulated insights. Unlike episodic memory (which remembers events), semantic memory stores distilled facts that persist regardless of when they were learned.

Think of it as the agent's long-term belief store:

```python
@dataclass
class SemanticFact:
    id: str
    subject: str          # "user:alice"
    predicate: str        # "prefers"
    object: str           # "Python over JavaScript"
    confidence: float     # 0.0 - 1.0
    source_episode_ids: list[str]
    created_at: datetime
    last_confirmed_at: datetime
    embedding: list[float]

class SemanticMemoryStore:
    def __init__(self, vector_db, relational_db):
        self.vector_db = vector_db
        self.db = relational_db

    def upsert_fact(self, fact: SemanticFact):
        # Check for contradicting facts
        existing = self.find_contradicting(fact)
        if existing:
            self.resolve_conflict(existing, fact)
        else:
            self.vector_db.upsert(fact.id, fact.embedding, fact.dict())
            self.db.upsert("semantic_facts", fact.dict())

    def query(self, query_text: str, subject_filter: str | None = None) -> list[SemanticFact]:
        embedding = self.embed(query_text)
        results = self.vector_db.search(embedding, filter={"subject": subject_filter})
        return [SemanticFact(**r) for r in results]
```

Conflict resolution is important here. If the agent learns "Alice prefers Python" and later learns "Alice has switched to TypeScript", the system needs to update the belief rather than accumulate contradictions.

### 4. Procedural Memory — How to Do Things

Procedural memory stores skills, workflows, and tool-use patterns. It answers "how do I accomplish X?" and encodes reusable procedures the agent has learned to execute.

This is often implemented as:
- **Tool definitions** — what capabilities the agent has
- **Workflow templates** — multi-step procedures for common tasks
- **Learned heuristics** — "when the user asks about deployment, always check the CI status first"

```python
@dataclass  
class Procedure:
    id: str
    name: str
    description: str
    trigger_conditions: list[str]
    steps: list[dict]
    success_rate: float
    last_used: datetime

class ProceduralMemory:
    def retrieve_applicable(self, task_description: str) -> list[Procedure]:
        embedding = self.embed(task_description)
        candidates = self.vector_db.search(embedding, top_k=5)
        # Filter by success rate threshold
        return [p for p in candidates if p.success_rate > 0.7]

    def record_execution(self, procedure_id: str, success: bool):
        proc = self.get(procedure_id)
        # Exponential moving average of success rate
        alpha = 0.1
        proc.success_rate = alpha * int(success) + (1 - alpha) * proc.success_rate
        self.update(proc)
```

## Putting It Together: The Memory Pipeline

A production agent memory system ties all four tiers into a coherent pipeline:

```python
class AgentMemorySystem:
    def __init__(self, episodic, semantic, procedural, vector_db):
        self.episodic = episodic
        self.semantic = semantic
        self.procedural = procedural
        self.working = WorkingMemory()

    async def before_session(self, user_id: str, task: str) -> str:
        """Hydrate working memory before the agent begins."""
        # Retrieve relevant past episodes
        past_episodes = await self.episodic.search(task, user_id=user_id, limit=3)
        
        # Retrieve relevant semantic facts about this user/domain
        known_facts = await self.semantic.query(task, subject_filter=f"user:{user_id}")
        
        # Find applicable procedures
        procedures = await self.procedural.retrieve_applicable(task)
        
        context_parts = []
        if past_episodes:
            context_parts.append("## Relevant Past Interactions\n" +
                "\n".join(f"- {ep.summary}" for ep in past_episodes))
        
        if known_facts:
            context_parts.append("## Known Facts\n" +
                "\n".join(f"- {f.subject} {f.predicate} {f.object}" for f in known_facts))
        
        if procedures:
            context_parts.append("## Available Procedures\n" +
                "\n".join(f"- {p.name}: {p.description}" for p in procedures))
        
        return "\n\n".join(context_parts)

    async def after_session(self, session_transcript: str, user_id: str):
        """Consolidate memories after a session ends."""
        # Create episode from this session
        episode = await self.episodic.consolidate(session_transcript)
        
        # Extract new semantic facts
        new_facts = await self.semantic.extract_from_episode(episode, user_id)
        for fact in new_facts:
            await self.semantic.upsert_fact(fact)
        
        # Update procedure success rates
        executed = await self.extract_executed_procedures(session_transcript)
        for proc_id, success in executed:
            await self.procedural.record_execution(proc_id, success)
```

## Memory Consolidation: The Sleeping Agent Pattern

One challenge with continuous agents is that they accumulate memories faster than they can be organized. A common pattern — inspired by how human memory consolidates during sleep — is to run an async consolidation job during idle periods:

```python
async def consolidate_memories(agent_id: str, memory_system: AgentMemorySystem):
    """Run periodically to merge, prune, and strengthen memories."""
    
    # Merge near-duplicate semantic facts
    await memory_system.semantic.deduplicate()
    
    # Decay confidence on facts that haven't been confirmed recently
    await memory_system.semantic.apply_time_decay(half_life_days=30)
    
    # Prune low-confidence facts below threshold
    await memory_system.semantic.prune(min_confidence=0.2)
    
    # Summarize clusters of related episodes into higher-level abstractions
    clusters = await memory_system.episodic.cluster_recent(days=7)
    for cluster in clusters:
        summary = await llm.summarize_episodes(cluster.episodes)
        await memory_system.episodic.create_abstraction(cluster, summary)
```

## Choosing Your Storage Stack

| Memory Type | Storage | Access Pattern |
|---|---|---|
| Working | In-process (dict/list) | Synchronous, ms latency |
| Episodic | Vector DB + RDBMS | Semantic search + time-range queries |
| Semantic | Vector DB + RDBMS | Semantic + filtered entity lookups |
| Procedural | Vector DB | Semantic similarity search |

**Vector DB options**: Qdrant, Weaviate, and pgvector (if you're already on Postgres) are the most production-ready choices. Qdrant handles filtered vector search especially well, which matters for scoping episodic and semantic queries to a specific user.

## Conclusion

Building agents that truly accumulate knowledge over time requires thinking beyond the context window. The four-tier architecture — working, episodic, semantic, and procedural memory — gives agents the ability to remember interactions, distill facts, and apply learned skills across sessions.

The engineering challenge isn't any one tier in isolation; it's the consolidation pipeline that keeps memories coherent, relevant, and up-to-date. Agents that consolidate well get *smarter* with use. Agents without consolidation just accumulate noise.

As agentic workloads move to production, memory architecture is becoming as important a design decision as database schema. Invest in it early.
