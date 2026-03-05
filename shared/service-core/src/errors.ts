export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.details != null ? { details: this.details } : {}),
    };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  CONFLICT: 'CONFLICT',
  BAD_REQUEST: 'BAD_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
