---
layout: post
title: "AI Agent Memory Architectures: Building Stateful Intelligent Systems"
date: 2026-05-23 08:00:00 +0545
categories: [AI, Architecture]
tags: [ai-agents, memory, llm, stateful-systems, vector-databases]
---

Modern AI agents that can only act on what's in their current context window are fundamentally limited. They forget conversations, lose track of long-running tasks, and can't accumulate knowledge over time. Memory architectures solve this — and they're becoming one of the most critical design decisions when building production AI systems.

This post explores the four core memory types for AI agents, when to use each, and how to wire them together effectively.

## Why Memory Matters

An LLM's context window is ephemeral. Once a conversation ends or a task completes, everything in that window disappears. For one-shot tasks this is fine, but real-world agents need to:

- Remember user preferences across sessions
- Track multi-step task progress over hours or days
- Accumulate domain knowledge from past interactions
- Reference historical decisions when making new ones

Without a memory layer, every agent interaction starts from zero. With it, agents become genuinely useful collaborators.

## The Four Memory Types

### 1. Sensory / In-Context Memory

This is your agent's working memory — everything currently in the context window. It's fast, immediately accessible, and requires no retrieval step.

```python
messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "My name is Alice and I prefer Python."},
    {"role": "assistant", "content": "Got it, Alice! I'll use Python examples."},
    {"role": "user", "content": "Show me how to read a CSV file."}
]
```

**Tradeoffs:** Limited by context length. Disappears when the session ends. Great for short-lived, focused tasks.

### 2. Episodic Memory

Episodic memory stores past interactions and experiences that can be retrieved later — similar to human autobiographical memory. It answers the question: *"What happened before?"*

Implementation typically uses a vector database to store conversation summaries or key moments:

```python
from openai import OpenAI
import chromadb

client = OpenAI()
db = chromadb.Client()
collection = db.create_collection("episodic_memory")

def store_episode(session_id: str, summary: str):
    embedding = client.embeddings.create(
        model="text-embedding-3-small",
        input=summary
    ).data[0].embedding
    
    collection.add(
        documents=[summary],
        embeddings=[embedding],
        ids=[session_id]
    )

def recall_episodes(query: str, n_results: int = 3) -> list[str]:
    query_embedding = client.embeddings.create(
        model="text-embedding-3-small",
        input=query
    ).data[0].embedding
    
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=n_results
    )
    return results["documents"][0]
```

**Best for:** User preference learning, customer support agents, personal assistants that need continuity across sessions.

### 3. Semantic Memory

Semantic memory is your agent's knowledge base — facts about the world, your domain, your product. Unlike episodic memory (what happened), semantic memory stores what is true in general.

This is where RAG (Retrieval-Augmented Generation) lives:

```python
def build_semantic_memory(docs: list[str]) -> None:
    """Index domain knowledge into vector store."""
    for i, doc in enumerate(docs):
        embedding = client.embeddings.create(
            model="text-embedding-3-small",
            input=doc
        ).data[0].embedding
        
        collection.add(
            documents=[doc],
            embeddings=[embedding],
            ids=[f"doc_{i}"]
        )

def retrieve_context(query: str) -> str:
    """Pull relevant knowledge for a query."""
    results = recall_episodes(query, n_results=5)
    return "\n\n".join(results)

def answer_with_context(question: str) -> str:
    context = retrieve_context(question)
    response = client.chat.completions.create(
        model="claude-sonnet-4-6",
        messages=[
            {"role": "system", "content": f"Use this context:\n{context}"},
            {"role": "user", "content": question}
        ]
    )
    return response.choices[0].message.content
```

**Best for:** Support bots with product documentation, legal assistants with case law, research agents with scientific literature.

### 4. Procedural Memory

Procedural memory stores *how to do things* — skills, workflows, and learned behaviors. In agent systems, this often manifests as:

- Fine-tuned model weights (learned implicitly)
- Explicit tool definitions and their usage patterns
- Stored prompt templates that worked well

```python
PROCEDURAL_MEMORY = {
    "summarize_document": {
        "prompt_template": "Summarize the following in 3 bullet points:\n\n{document}",
        "model": "claude-haiku-4-5",
        "learned_from": "500 user feedback sessions"
    },
    "debug_python": {
        "prompt_template": "You are a Python debugger. Analyze this error:\n\n{error}\n\nCode:\n{code}",
        "model": "claude-sonnet-4-6",
        "tools": ["code_executor", "documentation_search"]
    }
}

def execute_procedure(procedure_name: str, **kwargs) -> str:
    proc = PROCEDURAL_MEMORY[procedure_name]
    prompt = proc["prompt_template"].format(**kwargs)
    # execute with appropriate model and tools
    ...
```

**Best for:** Agents that need consistent, optimized behavior for repeated task types.

## Wiring It All Together

A production agent typically combines all four layers. Here's a simplified orchestration pattern:

```python
class StatefulAgent:
    def __init__(self):
        self.episodic_store = EpisodicMemory()
        self.semantic_store = SemanticMemory()
        self.procedures = ProceduralMemory()
    
    def respond(self, user_id: str, message: str) -> str:
        # 1. Retrieve relevant past episodes
        past_context = self.episodic_store.recall(
            user_id=user_id, 
            query=message
        )
        
        # 2. Pull relevant semantic knowledge
        domain_knowledge = self.semantic_store.retrieve(message)
        
        # 3. Select appropriate procedure
        procedure = self.procedures.select(message)
        
        # 4. Build in-context memory (sensory)
        system_prompt = f"""
        User history: {past_context}
        Domain knowledge: {domain_knowledge}
        Follow this procedure: {procedure}
        """
        
        response = llm_call(system_prompt, message)
        
        # 5. Store this episode for future retrieval
        self.episodic_store.store(user_id, message, response)
        
        return response
```

## Memory Management Challenges

### Context Length Pressure

The more memory you retrieve, the less room you have for the actual response. Use relevance scoring aggressively — don't retrieve everything, retrieve what matters:

```python
def smart_retrieve(query: str, budget_tokens: int = 2000) -> str:
    candidates = semantic_store.retrieve(query, n_results=20)
    selected = []
    total_tokens = 0
    
    for candidate in candidates:  # already ranked by relevance
        tokens = count_tokens(candidate)
        if total_tokens + tokens > budget_tokens:
            break
        selected.append(candidate)
        total_tokens += tokens
    
    return "\n".join(selected)
```

### Memory Decay and Staleness

Old memories can mislead. Implement time-weighted retrieval or explicit invalidation:

```python
def time_weighted_score(similarity: float, age_days: int) -> float:
    decay_factor = 0.95 ** age_days  # 5% decay per day
    return similarity * decay_factor
```

### Privacy and Isolation

User memories must be strictly isolated. A memory that leaks between users is a serious security vulnerability. Always partition by user ID at the storage level, not just at query time.

## When to Use What

| Memory Type | Use When | Avoid When |
|-------------|----------|------------|
| In-context | Short tasks, single session | Multi-day workflows |
| Episodic | User personalization, continuity | Factual knowledge retrieval |
| Semantic | Domain knowledge, RAG | Personal user history |
| Procedural | Repeated task patterns | One-off tasks |

## Conclusion

Memory is what transforms a stateless language model into a genuine agent capable of long-term collaboration. The right architecture depends on your use case: a customer support bot needs semantic memory for your product docs and episodic memory for customer history. A coding assistant needs procedural memory for language patterns and episodic memory for a developer's codebase preferences.

Start simple — episodic memory alone solves a huge portion of continuity problems. Add semantic and procedural layers as your agents mature and your users' needs grow more sophisticated.

The agents that win in production aren't necessarily the ones with the smartest base model. They're the ones that remember.
