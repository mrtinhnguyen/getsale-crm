# Authentication Architecture

## Request Flow

1. **Client** sends request with JWT cookie or Authorization header
2. **API Gateway** verifies JWT locally using `jwt.verify(token, JWT_SECRET)`
   - Extracts: userId, organizationId, role
   - Sets headers: X-User-Id, X-Organization-Id, X-User-Role
   - Adds X-Internal-Auth header (shared secret)
3. **Downstream Service** validates X-Internal-Auth header (internalAuth middleware)
   - Extracts user context from X-User-Id, X-Organization-Id, X-User-Role headers
   - Available as `req.user` in route handlers

## WebSocket Authentication
- Socket.IO connections verify JWT locally in socket-auth middleware
- No dependency on auth-service for token verification

## Security Guarantees
- JWT_SECRET must be identical across gateway and websocket-service
- INTERNAL_AUTH_SECRET prevents direct access to downstream services
- Production guards throw on startup if secrets are default/missing

## Do NOT
- Make HTTP calls to auth-service for token verification (removed in round 2)
- Trust X-User-Id headers without internalAuth middleware
- Expose downstream services directly to the internet
