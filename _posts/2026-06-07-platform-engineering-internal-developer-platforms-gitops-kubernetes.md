---
layout: post
title: "Platform Engineering: Building Internal Developer Platforms with GitOps and Kubernetes"
date: 2026-06-07 10:00:00 +0545
categories: [DevOps, Platform Engineering, Kubernetes]
tags: [Platform Engineering, IDP, GitOps, Kubernetes, Backstage, ArgoCD, Developer Experience, DevOps]
---

## Introduction

The term "DevOps" once promised developers the ability to own the full lifecycle of their software — from commit to production. In practice, it often delivered something else: developers who now had to become part-time infrastructure engineers, learning Kubernetes YAML, managing Helm charts, and debugging cluster networking issues on top of their actual job.

Platform engineering is the industry's response to that overreach. Rather than pushing all infrastructure complexity down to every developer, platform teams build *Internal Developer Platforms* (IDPs) — self-service systems that abstract the complexity of Kubernetes, networking, secrets, and deployments behind interfaces developers actually want to use.

This post covers what a modern IDP looks like, how GitOps underpins it, and the practical implementation decisions you'll face when building one.

## What Is an Internal Developer Platform?

An IDP is not a product you buy — it's a system you build. At minimum, it provides:

- **Self-service infrastructure provisioning**: developers can create environments without filing a ticket.
- **Standardized deployment pipelines**: one paved path for getting code to production.
- **Secrets and configuration management**: securely delivered, not copy-pasted from Slack.
- **Observability by default**: logs, metrics, and traces wired up automatically.
- **Service catalog**: a single source of truth for what services exist and who owns them.

The canonical open-source starting point for the service catalog layer is [Backstage](https://backstage.io/), originally built by Spotify. It won't build your platform, but it gives you a framework for surfacing it.

## GitOps as the Operating Model

GitOps is the principle that git is the single source of truth for both application code *and* infrastructure state. Desired cluster state lives in git; a controller in the cluster continuously reconciles actual state to match it.

The two dominant tools are **ArgoCD** and **Flux**. Both follow the same reconciliation model — the key difference is in their architecture and UI:

- **ArgoCD** is application-centric with a strong web UI. Better if your teams are less CLI-fluent.
- **Flux** is more composable and better suited to large multi-team environments with many repositories.

A minimal ArgoCD setup that deploys an application from a git repo:

```yaml
# application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-api
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/gitops-config
    targetRevision: main
    path: apps/my-api/overlays/production
  destination:
    server: https://kubernetes.default.svc
    namespace: my-api
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

The key properties: `automated.prune` removes resources deleted from git, `selfHeal` reverts manual changes made directly to the cluster. Both are essential for treating git as the actual truth, not just a suggestion.

## Structuring Your GitOps Repositories

The biggest architectural decision in GitOps is how to structure your repositories. Two common patterns:

### Mono-repo

All application configs live in one repository. Simple to start, easy to enforce standards, but can become a bottleneck as teams scale and merge queues grow.

```
gitops-config/
  apps/
    api-service/
      base/
        deployment.yaml
        service.yaml
        kustomization.yaml
      overlays/
        staging/
        production/
    worker-service/
      ...
  infra/
    networking/
    cert-manager/
    monitoring/
```

### Poly-repo (App-of-Apps)

Each team owns their own config repository. A root ArgoCD `Application` points to a "bootstrap" repo that defines all other `Application` resources:

```yaml
# root app — manages other apps
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root-app
spec:
  source:
    path: apps/  # directory full of Application CRDs
  destination:
    namespace: argocd
```

This scales better across teams but requires discipline around interface contracts between the platform team and app teams.

## Self-Service with Crossplane or Terraform Cloud

Kubernetes manifests cover workloads, but applications also need databases, queues, and blob storage. **Crossplane** extends the Kubernetes API to provision cloud resources using the same GitOps model:

```yaml
apiVersion: database.example.org/v1alpha1
kind: PostgreSQLInstance
metadata:
  name: my-api-db
  namespace: my-api
spec:
  parameters:
    storageGB: 20
    version: "15"
  compositionRef:
    name: postgresql-aws
  writeConnectionSecretToRef:
    name: my-api-db-credentials
```

When a developer applies this manifest, Crossplane provisions an RDS instance on AWS and writes the connection string into a Kubernetes secret — no IAM policies to configure, no Terraform state to understand. The platform team defines the `Composition` once; developers use it without knowing the underlying cloud details.

This is the *golden path* in practice: a well-lit route where doing the right thing is also the easy thing.

## Secrets Management

Never store secrets in git, even encrypted. The standard approach is to combine **External Secrets Operator** (ESO) with a secrets backend (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager):

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: api-credentials
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secretsmanager
    kind: ClusterSecretStore
  target:
    name: api-credentials  # creates this Kubernetes Secret
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: production/my-api
        property: database_url
    - secretKey: API_KEY
      remoteRef:
        key: production/my-api
        property: api_key
```

ESO syncs the external secret into a Kubernetes `Secret` on a configurable interval. Rotation in the backend propagates to the cluster automatically within the refresh window.

## Measuring Developer Experience

The whole point of a platform is to make developers faster. Measure it:

- **DORA metrics**: deployment frequency, lead time for changes, change failure rate, time to restore. These measure delivery performance, not platform adoption.
- **Time to first deployment** for a new service: if this takes days, the platform isn't doing its job.
- **P50/P99 of ticket wait time** for infrastructure provisioning: if it's non-zero, you have self-service gaps.
- **Paved path adoption rate**: what percentage of deployments go through the standard path versus bespoke ones.

The last metric is often revealing. Low adoption means the platform's path is harder than going around it — a signal to fix usability, not write more policies.

## Pitfalls to Avoid

**Don't build a platform for your current scale.** Platform work is genuinely exciting, and it's easy to over-engineer. Start with the highest-friction pain points, solve those, and iterate.

**Don't own the platform in isolation.** Embed platform engineers in product teams periodically. If they never feel the friction they're abstracting, they'll abstract the wrong things.

**Don't mistake Backstage for the platform.** Backstage is a portal on top of your platform. If the underlying infrastructure isn't self-service, a pretty catalog doesn't help.

**Don't skip contract testing between platform and app teams.** When the platform team changes a `Composition` or a base Helm chart, app teams shouldn't be surprised in production. Treat breaking changes like API changes — version them, announce them, run them in parallel during migration.

## Conclusion

Platform engineering is fundamentally about shifting toil. The toil of configuring Kubernetes, managing secrets, wiring up observability, and provisioning cloud resources belongs on the platform team's plate — not spread across every developer in the organization.

GitOps is the operating model that makes this tractable. When desired state is in git and controllers reconcile to it continuously, you get auditability, rollback, and consistency for free. Crossplane and ESO extend that model to cloud resources and secrets respectively.

The right IDP isn't the most technically impressive one — it's the one developers actually use. Optimize for that.
