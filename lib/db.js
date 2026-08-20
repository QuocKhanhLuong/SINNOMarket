import { neon } from '@neondatabase/serverless';

export function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(process.env.DATABASE_URL);
}

export function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(payload));
}

export function cleanNickname(value) {
  const nickname = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (nickname.length < 2) throw new Error('Nickname must be at least 2 characters');
  return nickname;
}
