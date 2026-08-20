import { timingSafeEqual } from 'node:crypto';
import { db, json } from '../lib/db.js';
import { MAX_ADMIN_WEIGHT, marketQuote, requiredPricingWeight } from '../lib/odds.js';

function authorized(req) {
  const expected = String(process.env.ADMIN_KEY || '').trim();
  if (!expected) return { ok: false, status: 503, error: 'ADMIN_KEY is not configured in Vercel.' };
  const supplied = String(req.headers['x-admin-key'] || '').trim();
  if (!supplied) return { ok: false, status: 401, error: 'Admin key is required.' };
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, status: 403, error: 'Invalid admin key.' };
}

async function readPools(sql) {
  return sql`
    SELECT c.id, c.name, c.seed_pool, c.admin_weight,
           COALESCE(SUM(b.effective_stake), 0)::int AS effective_pool
    FROM candidates c
    LEFT JOIN bets b ON b.candidate_id = c.id
    GROUP BY c.id, c.name, c.seed_pool, c.admin_weight
    ORDER BY c.sort_order ASC
  `;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const auth = authorized(req);
  if (!auth.ok) return json(res, auth.status, { error: auth.error });

  const candidateId = String(req.body?.candidateId || '').trim();
  const targetOdds = req.body?.targetOdds == null ? null : Number(req.body.targetOdds);
  const addWeight = req.body?.addWeight == null ? null : Math.floor(Number(req.body.addWeight));
  if (!candidateId) return json(res, 400, { error: 'Candidate is required.' });
  if (targetOdds == null && addWeight == null) return json(res, 400, { error: 'Provide targetOdds or addWeight.' });

  try {
    const sql = db();
    const pools = await readPools(sql);
    const totalEffective = pools.reduce((sum, row) => sum + Number(row.effective_pool || 0), 0);
    const target = pools.find((row) => row.id === candidateId);
    if (!target) return json(res, 404, { error: 'Candidate not found.' });

    const seedWeight = Number(target.seed_pool || 0);
    const currentAdminWeight = Number(target.admin_weight || 0);
    const currentTotalWeight = seedWeight + currentAdminWeight;
    const currentQuote = marketQuote(Number(target.effective_pool), totalEffective, currentTotalWeight);

    let nextAdminWeight = currentAdminWeight;
    if (targetOdds != null) {
      if (!Number.isFinite(targetOdds) || targetOdds < 1 || targetOdds > 15) {
        return json(res, 400, { error: 'Target odds must be between 1.00 and 15.00.' });
      }
      if (targetOdds > currentQuote.decimalOdds + 0.005) {
        return json(res, 409, { error: 'Admin weight can only lower odds. Choose a target at or below current odds.' });
      }
      const requiredTotalWeight = requiredPricingWeight(
        Number(target.effective_pool),
        totalEffective,
        targetOdds,
      );
      nextAdminWeight = Math.max(currentAdminWeight, requiredTotalWeight - seedWeight);
    } else {
      if (!Number.isFinite(addWeight) || addWeight < 1 || addWeight > 100000000) {
        return json(res, 400, { error: 'Weight increment must be between 1 and 100,000,000.' });
      }
      nextAdminWeight = currentAdminWeight + addWeight;
    }

    nextAdminWeight = Math.min(MAX_ADMIN_WEIGHT, Math.max(0, Math.ceil(nextAdminWeight)));
    const [updated] = await sql`
      UPDATE candidates
      SET admin_weight = ${nextAdminWeight}
      WHERE id = ${candidateId}
      RETURNING id, name, seed_pool, admin_weight
    `;

    const finalWeight = Number(updated.seed_pool || 0) + Number(updated.admin_weight || 0);
    const quote = marketQuote(Number(target.effective_pool), totalEffective, finalWeight);
    return json(res, 200, {
      ok: true,
      candidate: updated,
      effectivePool: Number(target.effective_pool),
      pricingWeight: finalWeight,
      previousOdds: currentQuote.decimalOdds,
      actualOdds: quote.decimalOdds,
      userShare: quote.userShare,
      pricingShare: quote.pricingShare,
    });
  } catch (error) {
    console.error('admin pricing error', error);
    return json(res, 500, { error: 'Unable to update market pricing.' });
  }
}
