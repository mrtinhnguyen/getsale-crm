---
description: REST API design standards for consistent, predictable APIs
globs: ["services/*/src/routes/**/*.ts"]
---

# API Design Standards

## URL Patterns

```
GET    /api/v1/{resource}          — list (paginated)
GET    /api/v1/{resource}/:id      — get one
POST   /api/v1/{resource}          — create
PUT    /api/v1/{resource}/:id      — full update
PATCH  /api/v1/{resource}/:id      — partial update
DELETE /api/v1/{resource}/:id      — delete (soft)
```

- Resource names: plural, kebab-case (`/api/v1/bd-accounts`)
- Nested resources for strong ownership: `/api/v1/pipelines/:id/stages`
- Max 2 levels of nesting

## Response Format

### Success
```json
{
  "data": { ... },
  "pagination": { "total": 100, "limit": 50, "offset": 0, "hasMore": true }
}
```

### Error
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Deal not found"
  }
}
```

- Always return consistent shape
- Error `code` is machine-readable (UPPER_SNAKE_CASE)
- Error `message` is human-readable

## HTTP Status Codes

| Code | When |
|------|------|
| 200 | Successful GET, PUT, PATCH |
| 201 | Successful POST (created) |
| 204 | Successful DELETE |
| 400 | Validation error, malformed request |
| 401 | Not authenticated |
| 403 | Not authorized (wrong role/plan) |
| 404 | Resource not found |
| 409 | Conflict (duplicate, stale data) |
| 422 | Business logic rejection |
| 429 | Rate limited |
| 500 | Internal server error |

## Filtering & Sorting

```
GET /api/v1/deals?status=active&sort=-created_at&limit=50&offset=0
```

- Filter by query params
- Sort: `-field` for DESC, `field` for ASC
- Always default to sensible sort (usually `-created_at`)

## Bulk Operations

For batch operations, use a dedicated endpoint:
```
POST /api/v1/deals/bulk-update
Body: { ids: [...], changes: { status: "won" } }
```

Return per-item results for partial failure handling.

## Search

```
GET /api/v1/search?q=term&type=contacts,deals
```

- Debounce on frontend (300ms)
- Limit results per type
- Return highlighting metadata if applicable
