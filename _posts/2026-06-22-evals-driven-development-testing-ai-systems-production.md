---
layout: post
title: "Evals-Driven Development: Testing and Measuring AI Systems in Production"
date: 2026-06-22 08:00:00 +0545
categories: [AI, Engineering]
tags: [llm, evals, testing, ai-systems, production, benchmarks, reliability]
---

Software engineers have decades of testing wisdom: unit tests, integration tests, end-to-end tests. But when your system is a large language model, traditional assertions crumble. You can't write `assert output == expected` when outputs are probabilistic, context-sensitive, and measured in degrees of quality rather than binary correctness.

Evals-driven development (EDD) is the emerging discipline that fills this gap. It treats evaluation as a first-class engineering concern — the foundation on which reliable AI systems are built, not an afterthought bolted on before launch.

## Why Traditional Testing Fails for LLMs

Unit tests assume determinism. Given input X, you always get output Y. LLMs violate this assumption by design — the same prompt at temperature 0.7 will produce meaningfully different outputs across runs. More importantly, two outputs can be semantically identical yet lexically different, or share the same tokens yet mean opposite things.

Consider a customer support bot that answers billing questions. A test asserting the exact response string will fail constantly due to rephrasing. But a test that only checks "did the response mention the refund policy?" misses cases where the model mentions it incorrectly.

The core challenge: **we're evaluating meaning, not syntax**.

## The Three Layers of AI Evaluation

Mature evaluation systems operate at three levels:

### 1. Deterministic Checks (Fast, Cheap)

Some things about LLM outputs can be checked exactly:

```python
def eval_response_format(response: str) -> EvalResult:
    # Check structural guarantees
    assert len(response) < 2000, "Response too long"
    assert not response.startswith(" "), "No leading whitespace"
    assert "```" not in response or response.count("```") % 2 == 0, "Unclosed code block"
    return EvalResult(passed=True, score=1.0)

def eval_no_pii(response: str) -> EvalResult:
    import re
    # Simple regex for obvious PII leakage
    patterns = [
        r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b',  # credit card
        r'\b\d{3}-\d{2}-\d{4}\b',  # SSN
    ]
    for pattern in patterns:
        if re.search(pattern, response):
            return EvalResult(passed=False, score=0.0, reason="PII detected")
    return EvalResult(passed=True, score=1.0)
```

These run in milliseconds and catch obvious failures before anything else runs. Build a battery of them.

### 2. Model-Graded Evaluation (Slower, More Expressive)

For semantic quality, use a stronger or specialized model as the judge:

```python
GRADER_PROMPT = """
You are evaluating a customer support response.

User question: {question}
Bot response: {response}

Score the response on:
1. Accuracy (0-10): Is the information correct?
2. Helpfulness (0-10): Does it actually solve the user's problem?
3. Tone (0-10): Is it professional and empathetic?

Respond in JSON: {{"accuracy": N, "helpfulness": N, "tone": N, "reasoning": "..."}}
"""

async def model_grade(question: str, response: str) -> GradeResult:
    result = await claude.messages.create(
        model="claude-opus-4-8",
        messages=[{
            "role": "user",
            "content": GRADER_PROMPT.format(question=question, response=response)
        }]
    )
    return GradeResult.from_json(result.content[0].text)
```

Key insight: your grader model should be **stronger** than your production model when possible, or at minimum specialized for evaluation. Grading is easier than generating, so a mid-tier model often grades reliably even if it can't generate as well.

### 3. Human Evaluation (Ground Truth)

Automated evals drift. Models can game their own evaluators. Human preference data — even a small, carefully sampled set — serves as the anchor:

- Label 200-500 examples per major capability area
- Rotate fresh annotators periodically to prevent anchoring
- Use pairwise comparison (A vs B) rather than absolute scoring when possible — humans are much more consistent at relative judgments

Your automated evals should be **calibrated against human labels**. If your model-graded eval gives 8.5/10 but humans consistently rate those same examples at 6/10, your eval is miscalibrated and your metrics are lying to you.

## Building an Eval Dataset That Actually Catches Regressions

A common mistake: building evals from your success cases. You write 100 example inputs, get good outputs, store them as golden data, and call it a test suite. This catches nothing useful — you're asserting the system does what it already did well.

Good eval datasets are adversarially constructed:

**Edge cases found in production.** Every time a user complaint comes in, ask: "What eval case would have caught this?" Add it.

**Capability probes.** Don't just test average cases — probe the boundaries. For a coding assistant: minimal context, ambiguous requirements, conflicting constraints, extremely long files.

**Regression tests.** When you fix a bug in a prompt, add the original failing case to the eval suite so you'll know if the bug comes back.

```python
class EvalCase:
    input: str
    expected_behavior: str  # Natural language description, not exact output
    tags: list[str]         # ["edge_case", "regression_2026-05-15", "billing"]
    min_score: float        # Minimum acceptable score on this case
```

Note the `expected_behavior` is a description, not a fixed output string. Your grader uses this description to evaluate whether the response matches intent.

## Tracking Evals Over Time

A single eval score is meaningless. What matters is the **trend**.

```
Eval Suite: customer-support-v2
─────────────────────────────────────
Date        Accuracy  Helpfulness  Tone   Pass Rate
────────────────────────────────────────────────────
2026-06-01   8.2       7.9         8.5    91%
2026-06-08   8.4       8.1         8.6    93%
2026-06-15   7.1       6.8         8.4    78%  ← regression!
2026-06-22   8.3       8.0         8.5    92%
```

The regression on June 15th might correspond to a prompt change, a model update, or new data entering the system. Without tracked evals, you'd never know until user complaints spiked.

Store every eval run with:
- Model version and configuration
- Prompt hash (so you can trace which prompt produced which results)
- Timestamp and trigger (manual, CI, scheduled)
- Per-case results, not just aggregates

## Eval-Gated Deployments

Once your eval suite is reliable, gate deployments on it:

```yaml
# .github/workflows/deploy.yml
- name: Run evals
  run: |
    python run_evals.py --suite production --threshold 0.85
    
- name: Deploy (only if evals pass)
  if: steps.run-evals.outputs.pass_rate >= 0.85
  run: ./deploy.sh
```

This is **not** the same as running unit tests in CI. Eval runs are slower and more expensive. A pragmatic approach:

- **Pre-merge**: Run a small "smoke" eval suite (50-100 cases) that catches obvious regressions. Fast, cheap.
- **Pre-deploy**: Run the full suite against the production candidate. Accept higher latency here.
- **Post-deploy**: Run evals on a sample of real traffic using your model-grader to catch distribution shift.

## The Calibration Problem

Your biggest long-term enemy is eval drift: evals that pass but no longer measure what you care about. This happens when:

1. **The model learns to game the grader.** If your grader and your generation model share similar training, the generation model can produce outputs that score well on the grader metric while being unhelpful to users.

2. **The task distribution shifts.** Users ask different questions in Q4 than Q2. An eval suite built in June might miss entirely new failure modes by October.

3. **Your grader prompt rots.** Grader prompts are software. They need review and updates as your understanding of quality evolves.

Combat this with quarterly "eval audits": sample 50 cases where your automated eval gave high scores and have humans rate them. If the human-automated correlation drops below ~0.7, your eval needs recalibration.

## Practical Starting Point

Don't build a perfect eval system on day one. Build a minimal one that runs:

1. 20-30 deterministic checks (format, safety, obvious failures)
2. 50-100 model-graded examples covering your key user flows
3. A weekly human spot-check of 10-20 random production outputs

Track scores week-over-week. Add cases whenever production fails. Upgrade your grader when you have evidence it's miscalibrated.

## Conclusion

Evals-driven development reframes AI quality from a launch-time concern to a continuous engineering discipline. The goal isn't to achieve a high eval score — it's to build an evaluation system accurate enough that a high score genuinely means your users are well-served.

The best AI teams treat their eval suites with the same care as their production code: version-controlled, continuously maintained, and treated as the primary feedback signal for every model and prompt change. Build this infrastructure early, and it will pay dividends every time you ship.

The question is no longer "does this work?" but "how do we know it still works?" — and evals are the answer.
