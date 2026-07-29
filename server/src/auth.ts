import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Actor } from '@chores/shared';
import type { AppConfig } from './config.js';
import type { AppDatabase } from './db.js';

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
      authTokenHash?: string;
    }
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function passwordMatches(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== 'string') return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createSession(
  db: AppDatabase,
  config: AppConfig,
  role: Actor['role'],
  userId: number | null,
): string {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionDays * 86_400_000).toISOString();
  db.prepare(
    'INSERT INTO auth_sessions (token_hash, role, user_id, expires_at) VALUES (?, ?, ?, ?)',
  ).run(hashToken(token), role, userId, expiresAt);
  return token;
}

export function requireAuth(db: AppDatabase) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authorization = req.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const tokenHash = hashToken(token);
    const row = db.prepare(`
      SELECT s.role, s.user_id AS userId, s.expires_at AS expiresAt, u.name
      FROM auth_sessions s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(tokenHash) as
      | { role: Actor['role']; userId: number | null; expiresAt: string; name: string | null }
      | undefined;

    if (!row || Date.parse(row.expiresAt) <= Date.now()) {
      if (row) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
      res.status(401).json({ error: 'Session expired' });
      return;
    }

    req.actor = {
      role: row.role,
      userId: row.userId,
      name: row.role === 'admin' ? 'Administrator' : (row.name ?? 'Household member'),
    };
    req.authTokenHash = tokenHash;
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.actor?.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access required' });
    return;
  }
  next();
}
