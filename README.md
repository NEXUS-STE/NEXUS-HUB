# NEXUS-HUB

A production-grade, trustless payments orchestration platform for freelance and e-commerce marketplaces. NEXUS-HUB enables marketplaces to offer escrow-protected payments with a Web2-like developer experience — balances, top-ups, withdrawals — backed by non-custodial Stellar blockchain escrows via [Trustless Work](https://trustlesswork.com), with [Airtm](https://www.airtm.com) handling fiat on/off-ramp.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Queue System](#queue-system)
- [Webhook System](#webhook-system)
- [Security](#security)

---

## Overview

NEXUS-HUB sits between a marketplace platform and two external services:

```
Marketplace App
      │
      ▼
 NEXUS-HUB API  ──── PostgreSQL + Redis
      │
      ├── Airtm          (fiat on/off-ramp)
      └── Trustless Work (Stellar smart contract escrows)
```

A typical payment flow:

1. **Client tops up** their NEXUS balance via Airtm (fiat → platform balance)
2. **Client creates an escrow**, locking funds for a specific freelancer
3. **Stellar contract is deployed** by the worker — funds are locked on-chain
4. Work is delivered; **client releases** the escrow
5. **Freelancer receives funds** — Stellar contract executes, balance credited
6. **Freelancer withdraws** to their Airtm account (platform balance → fiat)

Every step fires a signed **webhook event** to the marketplace's registered endpoints.

---

## Architecture

NEXUS-HUB is a **monorepo** split into two apps and two shared packages:

```
nexus-hub/
├── apps/
│   ├── api/        — NestJS REST API (HTTP layer, business logic)
│   └── worker/     — BullMQ background job processor (Stellar + Airtm calls)
└── packages/
    ├── shared/     — Shared TypeScript enums (QueueName, JobName, EscrowStatus…)
    └── database/   — Prisma schema + migrations (single source of truth)
```

### Why two apps?

All calls to external services (Trustless Work, Airtm) are **async** — the API never calls them inline. Every external operation is enqueued as a BullMQ job. This means:

- HTTP responses are always fast (no waiting on Stellar tx confirmation)
- External failures are retried automatically with exponential backoff
- The API and worker scale independently

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Language | TypeScript 5.4 |
| API Framework | NestJS 10 |
| ORM | Prisma 5 |
| Database | PostgreSQL |
| Cache / Queue broker | Redis |
| Job queue | BullMQ |
| Blockchain | Stellar (via Trustless Work API) |
| Fiat on/off-ramp | Airtm API |
| Auth | JWT (access + refresh tokens) |
| Monorepo tooling | pnpm workspaces + Turborepo |
| API docs | Swagger / OpenAPI |

---

## Project Structure

```
apps/api/src/
├── auth/           JWT registration, login, refresh, logout
├── users/          User profile management, admin status control
├── balances/       Balance enquiry and transaction history
├── topups/         Airtm top-up initiation and webhook receiver
├── escrow/         Escrow lifecycle — create, fund, release, refund
├── disputes/       Dispute opening, evidence, admin resolution
├── webhooks/       Endpoint registration, delivery history, secret rotation
├── health/         Liveness/readiness check via @nestjs/terminus
└── common/
    ├── decorators/ @CurrentUser, @Roles, @Public, @IdempotencyKey
    ├── guards/     JwtAuthGuard, RolesGuard
    ├── filters/    HttpExceptionFilter (global)
    ├── interceptors/ ResponseInterceptor, LoggingInterceptor (global)
    ├── dto/        PaginationDto (shared)
    └── prisma/     PrismaService (global module)

apps/worker/src/
├── processors/
│   ├── escrow.processor.ts      Stellar contract deploy, release, refund
│   ├── topup.processor.ts       Airtm session creation + balance credit
│   ├── withdrawal.processor.ts  Airtm withdrawal + balance debit
│   └── webhook.processor.ts     HMAC-signed delivery with retry
└── services/
    ├── trustless-work.service.ts  Stellar escrow API client
    └── airtm.service.ts           Airtm payment API client

packages/
├── shared/src/enums/index.ts   QueueName, JobName, UserRole, EscrowStatus…
└── database/prisma/schema.prisma
```

---

## Core Concepts

### Idempotency

Every POST endpoint that creates a financial transaction requires an `X-Idempotency-Key` header. Submitting the same key twice returns the original response — safe to retry on network failure.

```http
POST /api/v1/topups/initiate
X-Idempotency-Key: my-unique-request-id-123
```

### Optimistic Locking on Balances

All balance mutations include a `version` field in the `WHERE` clause. If two requests try to update the same balance simultaneously, one will detect a version mismatch and fail fast — eliminating double-spend without serializable transactions.

```sql
UPDATE balances
SET available_amount = available_amount - 500, version = version + 1
WHERE user_id = '...' AND version = 42;
-- 0 rows updated → conflict detected → retry
```

### Async External Calls

No HTTP handler ever calls Trustless Work or Airtm directly. Everything goes through BullMQ:

```
HTTP Request → API Service → BullMQ Queue → Worker Processor → External API
```

Jobs are configured with 3 attempts and exponential backoff (5s base). Stellar escrow jobs use `jobId`-based deduplication — enqueueing the same escrow action twice is a no-op.

### Response Shape

Every API response is wrapped by a global `ResponseInterceptor`:

```json
{
  "success": true,
  "statusCode": 200,
  "data": { },
  "timestamp": "2026-06-18T10:00:00.000Z"
}
```

Errors follow the same envelope with `"success": false` and a `message` field.
