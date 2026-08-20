import { timingSafeEqual } from 'node:crypto';
import { db, json } from '../lib/db.js';

function authorized(req) {
  const expected = String(process.env.ADMIN_KEY || '').trim();
  if (!expected) return { ok: false, status: 503, error: 'ADMIN_KEY is not configured in Vercel.' };

  const supplied = String(req.headers['x-admin-key'] || '').trim();
  if (!supplied) return { ok: false, status: 401, error: 'Admin key is required.' };

  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  const valid = a.length === b.length && timingSafeEqual(a, b);
  return valid
    ? { ok: true }
    : { ok: false, status: 403, error: 'Invalid admin key.' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const auth = authorized(req);
  if (!auth.ok) return json(res, auth.status, { error: auth.error });

  const candidateId = String(req.body?.candidateId || '').trim();
  const amount = Math.floor(Number(req.body?.amount));

  if (!candidateId) return json(res, 400, { error: 'Candidate is required.' });
  if (!Number.isFinite(amount) || amount < 10 || amount > 1000000) {
    return json(res, 400, { error: 'Liquidity buff must be between 10 and 1,000,000 pts.' });
  }

  try {
    const sql = db();
    const [candidate] = await sql`
      UPDATE candidates
      SET seed_pool = seed_pool + ${amount}
      WHERE id = ${candidateId}
      RETURNING id, name, seed_pool
    `;

    if (!candidate) return json(res, 404, { error: 'Candidate not found.' });

    const [usage] = await sql`
      SELECT COALESCE(SUM(stake), 0)::int AS user_volume,
             COUNT(*)::int AS bet_count
      FROM bets
      WHERE candidate_id = ${candidateId}
    `;

    return json(res, 200, {
      ok: true,
      candidate: {
        ...candidate,
        admin_liquidity: Number(candidate.seed_pool),
        user_volume: Number(usage?.user_volume || 0),
        bet_count: Number(usage?.bet_count || 0),
        total_pool: Number(candidate.seed_pool) + Number(usage?.user_volume || 0),
      },
      added: amount,
    });
  } catch (error) {
    console.error('admin liquidity api error', error);
    return json(res, 500, { error: 'Unable to buff candidate liquidity.' });
  }
}
