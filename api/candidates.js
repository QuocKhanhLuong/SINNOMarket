import { timingSafeEqual } from 'node:crypto';
import { db, json } from '../lib/db.js';

function normalize(value, max = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function makeInitials(name) {
  const cleaned = name
    .replace(/^(ts\.?|ths\.?|pgs\.?|gs\.?)\s*/i, '')
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return 'NA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[parts.length - 2][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function authorized(req) {
  const expected = String(process.env.ADMIN_KEY || '').trim();
  if (!expected) return { ok: false, status: 503, error: 'ADMIN_KEY is not configured in Vercel.' };

  const supplied = String(req.headers['x-admin-key'] || req.body?.adminKey || '').trim();
  if (!supplied) return { ok: false, status: 401, error: 'Admin key is required.' };

  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  const valid = a.length === b.length && timingSafeEqual(a, b);
  return valid
    ? { ok: true }
    : { ok: false, status: 403, error: 'Invalid admin key.' };
}

export default async function handler(req, res) {
  if (!['POST', 'PATCH'].includes(req.method)) {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const auth = authorized(req);
  if (!auth.ok) return json(res, auth.status, { error: auth.error });

  try {
    const sql = db();

    if (req.method === 'PATCH') {
      const candidateId = normalize(req.body?.candidateId, 80);
      const targetRate = Number(req.body?.targetRate);

      if (!candidateId) return json(res, 400, { error: 'Candidate id is required.' });
      if (!Number.isFinite(targetRate) || targetRate < 0.01 || targetRate > 100) {
        return json(res, 400, { error: 'Target rate must be between 0.01 and 100.00.' });
      }

      const rows = await sql`
        SELECT
          c.id,
          c.name,
          c.seed_pool,
          COALESCE(SUM(b.stake), 0)::int AS user_pool
        FROM candidates c
        LEFT JOIN bets b ON b.candidate_id = c.id
        GROUP BY c.id, c.name, c.seed_pool
        ORDER BY c.sort_order ASC
      `;

      const target = rows.find((row) => row.id === candidateId);
      if (!target) return json(res, 404, { error: 'Candidate not found.' });

      const otherPool = rows
        .filter((row) => row.id !== candidateId)
        .reduce((sum, row) => sum + Number(row.seed_pool) + Number(row.user_pool), 0);

      if (otherPool <= 0) return json(res, 409, { error: 'Cannot tune a single-candidate market.' });

      const desiredCandidatePool = otherPool / targetRate;
      const desiredSeed = desiredCandidatePool - Number(target.user_pool);
      const newSeed = Math.max(10, Math.min(100000, Math.round(desiredSeed)));

      const [updated] = await sql`
        UPDATE candidates
        SET seed_pool = ${newSeed}
        WHERE id = ${candidateId}
        RETURNING id, name, role, initials, sort_order, seed_pool
      `;

      const actualCandidatePool = newSeed + Number(target.user_pool);
      const actualRate = otherPool / actualCandidatePool;
      const clamped = newSeed !== Math.round(desiredSeed);

      return json(res, 200, {
        ok: true,
        candidate: updated,
        requestedRate: targetRate,
        actualRate,
        clamped,
        seedPool: newSeed,
        userPool: Number(target.user_pool),
      });
    }

    const name = normalize(req.body?.name, 80);
    const role = normalize(req.body?.role, 80) || 'Candidate';
    const initials = normalize(req.body?.initials, 6).toUpperCase() || makeInitials(name);
    const seedPoolRaw = Number(req.body?.seedPool ?? 200);
    const seedPool = Math.floor(seedPoolRaw);

    if (name.length < 2) return json(res, 400, { error: 'Candidate name must be at least 2 characters.' });
    if (!Number.isFinite(seedPool) || seedPool < 10 || seedPool > 100000) {
      return json(res, 400, { error: 'Opening pool must be between 10 and 100,000 pts.' });
    }

    const baseId = slugify(name) || `candidate-${Date.now()}`;

    const [duplicate] = await sql`
      SELECT id FROM candidates WHERE lower(name) = lower(${name}) LIMIT 1
    `;
    if (duplicate) return json(res, 409, { error: 'This candidate already exists.' });

    const [orderRow] = await sql`SELECT COALESCE(MAX(sort_order), 0)::int AS max_order FROM candidates`;
    const sortOrder = Number(orderRow?.max_order || 0) + 1;

    let id = baseId;
    const [sameId] = await sql`SELECT id FROM candidates WHERE id = ${id} LIMIT 1`;
    if (sameId) id = `${baseId}-${Date.now().toString(36)}`;

    const [candidate] = await sql`
      INSERT INTO candidates (id, name, role, initials, sort_order, seed_pool)
      VALUES (${id}, ${name}, ${role}, ${initials}, ${sortOrder}, ${seedPool})
      RETURNING id, name, role, initials, sort_order, seed_pool
    `;

    return json(res, 201, { ok: true, candidate });
  } catch (error) {
    console.error('candidate api error', error);
    return json(res, 500, { error: req.method === 'PATCH' ? 'Unable to tune rate.' : 'Unable to add candidate.' });
  }
}
