import type { UserRole } from '@getsale/types';

export interface JwtPayload {
  userId: string;
  organizationId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface GatewayUser {
  id: string;
  organizationId: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: GatewayUser;
      correlationId?: string;
    }
  }
}

export {};
