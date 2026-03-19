/**
 * API base URL for axios/fetch.
 *
 * Browser: use NEXT_PUBLIC_API_URL when set (production: https://api-crm.getsale.ai).
 * Traefik routes app.getsale.ai → Next only; /api/* on app must not be relied on unless
 * Next rewrites work. Calling the public API host avoids broken server-side rewrites.
 *
 * Server (SSR): NEXT_PUBLIC_API_URL || API_URL || localhost (Docker: API_URL=api-gateway:8000).
 *
 * Local dev: leave NEXT_PUBLIC_API_URL unset → '' in browser → same-origin /api/* + Next rewrites.
 */
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
  }
  return (
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_URL ||
    'http://localhost:8000'
  ).replace(/\/$/, '');
}
