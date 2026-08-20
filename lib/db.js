import { neon } from '@neondatabase/serverless';

function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    ''
  );
}

export function db() {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error(
      'Database is not connected. Configure DATABASE_URL (or POSTGRES_URL / NEON_DATABASE_URL) in Vercel.'
    );
  }
  return neon(url);
}

export function hasDatabaseConfig() {
  return Boolean(getDatabaseUrl());
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
