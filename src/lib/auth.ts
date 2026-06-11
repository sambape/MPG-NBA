import { cookies } from 'next/headers';
import crypto from 'crypto';
import { getDb } from './db';

const SESSION_COOKIE = 'mpg_session';
const SECRET = process.env.SESSION_SECRET || 'mpg-nba-dev-secret-change-me';

export interface User {
  id: number;
  username: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function sign(value: string): string {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}

export function sessionToken(userId: number): string {
  const payload = String(userId);
  return `${payload}.${sign(payload)}`;
}

export async function setSession(userId: number) {
  const store = await cookies();
  store.set(SESSION_COOKIE, sessionToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  const id = Number(payload);
  if (!Number.isInteger(id)) return null;
  const row = getDb().prepare('SELECT id, username FROM users WHERE id = ?').get(id) as User | undefined;
  return row ?? null;
}
