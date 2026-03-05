import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { Request } from 'express';
import { AppError, ErrorCodes } from '@getsale/service-core';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret';
export const JWT_EXPIRES_IN = '15m';
export const REFRESH_EXPIRES_IN = '7d';

export { JWT_SECRET, JWT_REFRESH_SECRET };

export interface JwtPayload {
  userId: string;
  organizationId: string;
  role?: string;
}

export function signAccessToken(payload: { userId: string; organizationId: string; role: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): { userId: string } {
  return jwt.verify(token, JWT_REFRESH_SECRET) as { userId: string };
}

export function extractBearerToken(req: Request): JwtPayload {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');
  if (!token) throw new AppError(401, 'Unauthorized', ErrorCodes.UNAUTHORIZED);
  try {
    return verifyAccessToken(token);
  } catch (e: unknown) {
    const err = e as Error;
    if (err.name === 'TokenExpiredError') throw new AppError(401, 'Token expired', ErrorCodes.UNAUTHORIZED);
    throw new AppError(401, 'Invalid token', ErrorCodes.UNAUTHORIZED);
  }
}

export function getClientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() || null;
  return req.ip || req.socket?.remoteAddress || null;
}

export async function canPermission(pool: Pool, role: string, resource: string, action: string): Promise<boolean> {
  const roleLower = (role || '').toLowerCase();
  try {
    const r = await pool.query(
      'SELECT 1 FROM role_permissions WHERE role = $1 AND resource = $2 AND (action = $3 OR action = \'*\') LIMIT 1',
      [roleLower, resource, action]
    );
    if (r.rows.length > 0) return true;
    if (roleLower === 'owner') return true;
    return false;
  } catch {
    if (roleLower === 'owner') return true;
    if (roleLower === 'admin') return action !== 'transfer_ownership';
    return false;
  }
}

export async function auditLog(
  pool: Pool,
  params: {
    organizationId: string; userId: string; action: string;
    resourceType?: string; resourceId?: string;
    oldValue?: object; newValue?: object; ip?: string | null;
  }
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, old_value, new_value, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.organizationId, params.userId, params.action,
        params.resourceType ?? null, params.resourceId ?? null,
        params.oldValue ? JSON.stringify(params.oldValue) : null,
        params.newValue ? JSON.stringify(params.newValue) : null,
        params.ip ?? null,
      ]
    );
  } catch {
    // best effort
  }
}

export async function resolveRole(pool: Pool, userId: string, organizationId: string, jwtRole?: string): Promise<string> {
  if (jwtRole) return jwtRole;
  const memberRow = await pool.query(
    'SELECT role FROM organization_members WHERE user_id = $1 AND organization_id = $2',
    [userId, organizationId]
  );
  return memberRow.rows[0]?.role ?? '';
}
