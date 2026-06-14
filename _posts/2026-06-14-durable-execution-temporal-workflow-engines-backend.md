---
layout: post
title: "Durable Execution: How Temporal and Workflow Engines Are Changing Backend Development"
date: 2026-06-14 08:00:00 +0545
categories: [backend, architecture]
tags: [temporal, workflows, durable-execution, distributed-systems, backend]
---

Long-running processes have always been painful in traditional backend systems. You write a function that calls three external APIs, sends an email, updates a database, and charges a payment gateway — and somewhere in the middle, a network blip kills the process. Now you're left wondering: did the charge go through? Was the email sent? Do you retry everything and risk double-charging a customer?

Durable execution is the architectural answer to this problem, and tools like [Temporal](https://temporal.io) are making it mainstream. The idea is simple but profound: your code runs as if failures don't exist, because the execution engine handles retries, persistence, and recovery transparently.

## What Is Durable Execution?

Durable execution means your workflow code is automatically persisted at every step. If the process crashes, it resumes from exactly where it left off — not from the beginning, not from some checkpoint you manually defined, but from the precise line of code where execution stopped.

This is fundamentally different from:

- **Job queues** (like Sidekiq or BullMQ): You retry entire jobs, not individual steps
- **Saga patterns**: You write compensating transactions manually
- **State machines**: You manage state persistence and transitions yourself

With durable execution, the framework intercepts every async operation and records it to a persistent event log. On recovery, it replays that log to restore program state, then continues forward.

## Temporal: The Leading Durable Execution Engine

Temporal (forked from Cadence at Uber) is currently the most widely adopted durable execution platform. It supports Go, Java, Python, TypeScript, and .NET SDKs.

Here's what a typical workflow looks like in TypeScript:

```typescript
import { proxyActivities, sleep } from '@temporalio/workflow';
import type * as activities from './activities';

const { chargePayment, sendConfirmationEmail, updateOrderStatus } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '30 seconds',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 2,
    },
  });

export async function orderFulfillmentWorkflow(orderId: string): Promise<void> {
  await updateOrderStatus(orderId, 'processing');

  const charged = await chargePayment(orderId);
  if (!charged) {
    await updateOrderStatus(orderId, 'payment_failed');
    return;
  }

  await updateOrderStatus(orderId, 'paid');

  // Even if the service crashes here, it resumes from this point
  await sleep('1 hour'); // Wait for warehouse pickup
  await sendConfirmationEmail(orderId);
  await updateOrderStatus(orderId, 'fulfilled');
}
```

The `sleep('1 hour')` call is especially striking. In a normal server process, sleeping for an hour wastes resources and risks process death. In Temporal, the worker process exits during the sleep and is re-scheduled when the timer fires — no threads held, no heartbeating required.

## Activities vs Workflows

Temporal separates code into two layers:

**Workflows** define the business logic and control flow. They must be deterministic — no random numbers, no `Date.now()`, no direct I/O. The framework may replay them multiple times.

**Activities** are the side effects — database writes, HTTP calls, file operations. These run once per invocation and can be retried independently.

```typescript
// activities.ts - these can fail and be retried safely
export async function chargePayment(orderId: string): Promise<boolean> {
  const order = await db.orders.findById(orderId);
  const result = await stripe.charges.create({
    amount: order.totalCents,
    currency: 'usd',
    customer: order.customerId,
    idempotencyKey: `charge-${orderId}`, // Critical: idempotency
  });
  return result.status === 'succeeded';
}
```

Notice the `idempotencyKey` — activities must be idempotent because they can be retried on failure. This is the contract you need to uphold; Temporal handles everything else.

## Why This Changes Backend Architecture

### Eliminating Distributed Transaction Complexity

Traditional distributed systems require either 2-phase commit (slow, complex) or saga patterns (lots of manual compensating logic). With durable execution, you write linear code and the engine handles the failure modes.

### Long-Running Processes Become Trivial

Workflows that span days, months, or even years are no problem:

```typescript
export async function subscriptionLifecycleWorkflow(userId: string): Promise<void> {
  while (true) {
    await sleep('30 days');
    
    const shouldRenew = await checkSubscriptionStatus(userId);
    if (!shouldRenew) {
      await cancelSubscription(userId);
      return;
    }
    
    await chargeRenewal(userId);
    await sendRenewalReceipt(userId);
  }
}
```

This workflow runs indefinitely, billing the user monthly. The worker process handling it might be replaced dozens of times. The logic is oblivious to that.

### Human-in-the-Loop Workflows

Temporal supports waiting for external signals — perfect for approval flows, two-factor authentication, or any process that requires human input:

```typescript
import { defineSignal, setHandler, condition } from '@temporalio/workflow';

const approveSignal = defineSignal<[boolean]>('approve');

export async function expenseApprovalWorkflow(expenseId: string): Promise<string> {
  let approved = false;
  let signalReceived = false;

  setHandler(approveSignal, (isApproved: boolean) => {
    approved = isApproved;
    signalReceived = true;
  });

  await sendApprovalRequest(expenseId);

  // Wait up to 7 days for manager approval
  const timedOut = !(await condition(() => signalReceived, '7 days'));

  if (timedOut) return 'expired';
  return approved ? 'approved' : 'rejected';
}
```

## Alternatives and Ecosystem

Temporal isn't the only player:

- **[Restate](https://restate.dev)**: Newer, simpler API, built on Rust — gaining traction for serverless use cases
- **[Inngest](https://inngest.com)**: Managed service with a great DX, targets Node.js and serverless
- **[AWS Step Functions**: Managed but JSON-based; verbose to write, hard to test locally
- **[Hatchet](https://hatchet.run)**: Open-source, Postgres-backed, simpler operational profile

For teams already on Kubernetes with an ops culture, Temporal's self-hosted option is excellent. For teams wanting zero infrastructure, Inngest or Temporal Cloud are worth evaluating.

## Operational Considerations

Durable execution isn't free from operational complexity:

**Versioning is hard.** If you change a workflow while it's running, old executions may break during replay. Temporal provides versioning APIs but they require discipline.

**Debugging is different.** You can't just read logs linearly — you need to understand the event history. Temporal's web UI and `tctl` CLI help, but it's a mindset shift.

**Testing requires the testing framework.** Temporal's Go and TypeScript SDKs include testing utilities that let you simulate time and mock activities, but you need to invest in learning the patterns.

## When to Reach for Durable Execution

Durable execution is overkill for simple CRUD APIs. Reach for it when you have:

- Multi-step workflows that span external services
- Processes that can run for more than a few minutes
- Business logic where partial completion is dangerous
- Approval flows or human-in-the-loop requirements
- Scheduled recurring logic with complex state

## Conclusion

Durable execution inverts the traditional relationship between code and infrastructure. Instead of writing defensive code that handles every failure scenario, you write straightforward business logic and let the execution engine manage resilience. The cognitive load shifts from "how do I survive failures" to "what is the business process."

Temporal has proven this model at Uber, Stripe, Coinbase, and Netflix scale. The tooling has matured, the SDKs are production-ready, and the community has solved most of the common operational challenges.

If your backend has a graveyard of retry queues, saga compensating transactions, and defensive polling loops — it's worth spending a day with the Temporal TypeScript SDK. The model is different enough to be surprising, and surprising enough to be genuinely valuable.
