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

---

## API Reference

All routes are prefixed `/api/v1/`. Full interactive docs are available at `/api/docs` (Swagger UI) when the server is running.

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Create a new user account |
| `POST` | `/auth/login` | Public | Obtain access + refresh tokens |
| `POST` | `/auth/refresh` | Public | Rotate access token using refresh token |
| `POST` | `/auth/logout` | JWT | Revoke a refresh token |
| `GET` | `/auth/me` | JWT | Get current user profile |

### Balances

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/balances` | JWT | Get current user's balance |
| `GET` | `/balances/transactions` | JWT | Paginated transaction history |

### Top-ups

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/topups/initiate` | JWT | Start an Airtm top-up flow |
| `GET` | `/topups/:id` | JWT | Check top-up status |
| `POST` | `/topups/webhook/airtm` | HMAC | Airtm confirmation callback |

### Escrow

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/escrow` | CLIENT / MARKETPLACE | Create a new escrow |
| `GET` | `/escrow` | JWT | List escrows for current user |
| `GET` | `/escrow/:id` | JWT | Get escrow details |
| `POST` | `/escrow/:id/fund` | CLIENT / MARKETPLACE | Lock balance + deploy Stellar contract |
| `POST` | `/escrow/:id/release` | CLIENT / MARKETPLACE | Release funds to freelancer |
| `POST` | `/escrow/:id/refund` | ADMIN | Refund funds to client |

### Disputes

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/disputes` | JWT | Open a dispute on a funded escrow |
| `GET` | `/disputes/:id` | JWT | Get dispute details |
| `PATCH` | `/disputes/:id/evidence` | JWT | Add evidence to an open dispute |
| `PATCH` | `/disputes/:id/review` | ADMIN | Move dispute to UNDER_REVIEW |
| `PATCH` | `/disputes/:id/resolve` | ADMIN | Resolve dispute, trigger release or refund |

### Withdrawals

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/withdrawals` | JWT | Initiate an Airtm withdrawal |
| `GET` | `/withdrawals` | JWT | List withdrawal history |

### Webhooks

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/webhooks/endpoints` | JWT | Register a webhook endpoint |
| `GET` | `/webhooks/endpoints` | JWT | List registered endpoints |
| `PATCH` | `/webhooks/endpoints/:id` | JWT | Update endpoint URL, events, or status |
| `DELETE` | `/webhooks/endpoints/:id` | JWT | Delete an endpoint |
| `POST` | `/webhooks/endpoints/:id/rotate-secret` | JWT | Rotate HMAC signing secret |
| `GET` | `/webhooks/deliveries` | JWT | View delivery history |

### Health

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | Public | Database connectivity check |

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 14+
- Redis 7+

### Installation

```bash
# Clone the repository
git clone https://github.com/NEXUS-STE/NEXUS-HUB.git
cd NEXUS-HUB

# Install dependencies
pnpm install

# Copy and fill in environment variables
cp .env.example .env
```

### Database Setup

```bash
# Generate Prisma client
pnpm prisma:generate

# Run migrations
pnpm prisma:migrate

# (Optional) Open Prisma Studio
pnpm prisma:studio
```

### Running Locally

```bash
# Start both API and worker in watch mode
pnpm dev

# Or individually:
pnpm --filter @nexus-hub/api dev
pnpm --filter @nexus-hub/worker dev
```

The API starts on `http://localhost:3000`.
Swagger docs are at `http://localhost:3000/api/docs`.

### Building for Production

```bash
pnpm build
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values. The API will refuse to start if any required variable is missing or fails validation.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_HOST` | No | `localhost` | Redis host |
| `REDIS_PORT` | No | `6379` | Redis port |
| `REDIS_PASSWORD` | No | — | Redis password |
| `JWT_SECRET` | Yes | — | Secret for signing JWTs — minimum 32 characters |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Refresh token TTL |
| `AIRTM_API_URL` | Yes | — | Airtm API base URL |
| `AIRTM_API_KEY` | Yes | — | Airtm API key |
| `AIRTM_WEBHOOK_SECRET` | Yes | — | Shared secret for verifying Airtm webhooks |
| `TRUSTLESS_WORK_API_URL` | Yes | — | Trustless Work API base URL |
| `TRUSTLESS_WORK_API_KEY` | Yes | — | Trustless Work API key |
| `PLATFORM_FEE_BPS` | No | `100` | Platform fee in basis points (100 = 1%) |
| `PORT` | No | `3000` | API server port |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin |
| `NODE_ENV` | No | `development` | `development` / `production` / `test` |

---

## Database

All models are defined in `packages/database/prisma/schema.prisma`.

| Model | Purpose |
|---|---|
| `User` | Platform users — clients, freelancers, admins, marketplaces |
| `RefreshToken` | Issued refresh tokens with revocation support |
| `Balance` | Per-user available and reserved balances with optimistic lock version |
| `Transaction` | Immutable financial event log with idempotency key |
| `Escrow` | Escrow lifecycle state and Stellar contract reference |
| `Dispute` | Dispute raised against a funded escrow |
| `WebhookEndpoint` | Registered delivery targets per user |
| `WebhookDelivery` | Delivery attempt record with status and response |
| `AuditLog` | Append-only audit trail for all sensitive operations |

---

## Queue System

Jobs flow through four queues:

| Queue | Jobs | Description |
|---|---|---|
| `escrow` | `FUND_ESCROW`, `RELEASE_ESCROW`, `REFUND_ESCROW` | Stellar smart contract operations |
| `topup` | `PROCESS_TOPUP` | Airtm session creation and balance credit |
| `withdrawal` | `PROCESS_WITHDRAWAL` | Airtm payout and balance debit |
| `webhook` | `DELIVER_WEBHOOK` | HMAC-signed HTTP delivery to registered endpoints |

All jobs use 3 retry attempts with exponential backoff starting at 5 seconds. Stellar escrow jobs use `jobId`-based deduplication to prevent double-execution on retry.

---

## Webhook System

Marketplaces register HTTP endpoints and subscribe to specific events. Every delivery is signed with `HMAC-SHA256`.

### Verifying a webhook

```javascript
const crypto = require('crypto');

function verifySignature(secret, rawBody, signatureHeader) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader)
  );
}
```

### Available Events

| Event | Fired when |
|---|---|
| `TOPUP_COMPLETED` | Airtm confirms a top-up payment |
| `TOPUP_FAILED` | Top-up session fails or is abandoned |
| `ESCROW_FUNDED` | Stellar contract deployed and funded |
| `ESCROW_RELEASED` | Funds released to freelancer on-chain |
| `ESCROW_REFUNDED` | Funds returned to client on-chain |
| `DISPUTE_OPENED` | A dispute is raised on an escrow |
| `DISPUTE_RESOLVED` | Admin resolves a dispute |
| `WITHDRAWAL_COMPLETED` | Airtm payout confirmed |
| `WITHDRAWAL_FAILED` | Withdrawal attempt rejected by Airtm |

---

## Security

- Passwords hashed with `bcrypt` (cost factor 12)
- JWT access tokens expire in 15 minutes; refresh tokens are single-use and rotated on every refresh
- All balance mutations use optimistic locking — concurrent requests cannot double-spend
- Airtm webhook payloads are verified with `HMAC-SHA256` using `timingSafeEqual`
- Outbound webhooks are signed so marketplace servers can verify authenticity
- `passwordHash`, `secret`, and `refreshToken` fields are never returned in any API response
- All DTOs use `class-validator` with `whitelist: true` and `forbidNonWhitelisted: true`
- Config validation on startup — the server refuses to boot with missing or malformed env vars
- Rate limiting: 120 requests per minute per IP (global throttler)
