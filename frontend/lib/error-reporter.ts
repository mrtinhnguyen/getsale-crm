import * as Sentry from '@sentry/browser';

interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  organizationId?: string;
  [key: string]: unknown;
}

let sentryInitialized = false;
function ensureSentry(): void {
  if (sentryInitialized || typeof window === 'undefined') return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return;
  Sentry.init({ dsn, environment: process.env.NODE_ENV });
  sentryInitialized = true;
}

export function reportError(error: unknown, context?: ErrorContext): void {
  const err = error instanceof Error ? error : new Error(String(error));

  if (process.env.NODE_ENV === 'development') {
    console.error('[Error]', err.message, context);
    return;
  }

  ensureSentry();
  Sentry.captureException(err, { extra: context ?? {} });
}

export function reportWarning(message: string, context?: ErrorContext): void {
  if (process.env.NODE_ENV === 'development') {
    console.warn('[Warning]', message, context);
    return;
  }
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    warning: message,
    ...context,
  }));
}
