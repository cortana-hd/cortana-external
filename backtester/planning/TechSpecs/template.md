# Technical Specification - [Project Title]

**Document Status:** Not Started

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | @mention owner |
| Epic | *Include Epic* |

---

## Development Overview

Describe briefly the approach you're taking to solve this problem. This should be enough for the reader to imagine possible solution directions and get a very rough sense of the scope of this project. This should be the same as the Development Overview in the PRD. Please keep them in sync.

---

## Data Storage Changes

### Database Changes

Detail any changes required to the existing database schema, such as adding, modifying, or deleting tables, columns, indexes, or constraints.

#### [NEW] schema.tablename

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| | | | |

#### [UPDATE] schema.tablename

| Constraints | Column Name | Column Type | Notes |
|-------------|-------------|-------------|-------|
| | | | |

---

## Infrastructure Changes (if any?)

### SNS Topic Changes

Explain the need for creating, modifying, or removing topic queues (format examples).

### SQS Queue Changes

Explain the need for creating, modifying, or removing message queues (format examples).

### Cache Changes

Describe changes to caching strategies, including any new caching layers or modifications to existing ones.

### S3 Changes

Explain the need for creating, modifying, or removing S3 buckets (see S3 Bucket examples for notation).

### Secrets Changes

Describe any new secrets (like API keys, tokens, passwords) that need to be created or modified (secrets manager examples for notation).

### Network/Security Changes

Detail any changes to security groups, IAM roles or policies, or any similar network or security controls in AWS (see security group examples for notation).

---

## Behavior Changes

Explain how the user-facing behavior of the system will change. This could include UI/UX changes, business logic modifications, or other functional adjustments.

---

## Application/Script Changes

Detail any new scripts that need to be developed or existing scripts that need to be modified, such as automation scripts, data processing scripts, or migration scripts.

---

## API Changes

Detail the new API endpoints, or modifications to existing ones (see Portal API Documentation for notation).

### [NEW] | [UPDATE] [API Name]

| Field | Value |
|-------|-------|
| **API** | `GET /api/v2/[category]/[endpoint]` |
| **Description** | |
| **Additional Notes** | |

| Field | Detail |
|-------|--------|
| **Authentication** | Auth0 JWT Token, API Key |
| **URL Params** | |
| **Request** | |
| **Success Response** | |
| **Error Responses** | |

---

## Process Changes

Describe any changes to existing processes, such as CI/CD pipelines, deployment strategies, or development workflows.

---

## Orchestration Changes

Detail any changes to orchestration layers, including updates to tools like Kubernetes, Docker, or serverless functions.

---

## Test Plan

*Describe the testing strategy, including unit tests, integration tests, E2E tests, and any manual testing required.*
