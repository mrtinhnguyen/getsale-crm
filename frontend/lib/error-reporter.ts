interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  organizationId?: string;
  [key: string]: unknown;
}

export function reportError(error: unknown, context?: ErrorContext): void {
  const err = error instanceof Error ? error : new Error(String(error));

  if (process.env.NODE_ENV === 'development') {
    console.error('[Error]', err.message, context);
    return;
  }

  // TODO: Replace with Sentry.captureException(err, { extra: context })
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    error: err.message,
    stack: err.stack,
    ...context,
  }));
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
