import { db, json } from '../lib/db.js';
import { marketQuote, splitStake } from '../lib/odds.js';

const DAILY_GRANT = 10000;

async function applyDailyRefill(sql, playerId) {
  await sql`
    UPDATE players
    SET starting_balance = GREATEST(
      starting_balance,
      ${DAILY_GRANT} * (
        1 + GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int
        )
      )
    )
    WHERE id = ${playerId}
  `;
}

async function currentQuote(sql, candidateId) {
  const pools = await sql`
    SELECT
      c.id,
      c.seed_pool,
      c.admin_weight,
      COALESCE(SUM(b.effective_stake), 0)::int AS effective_pool
    FROM candidates c
    LEFT JOIN bets b ON b.candidate_id = c.id
    GROUP BY c.id, c.seed_pool, c.admin_weight
  `;

  const totalEffectivePool = pools.reduce((sum, row) => sum + Number(row.effective_pool), 0);
  const candidate = pools.find((row) => row.id === candidateId);
  if (!candidate) return null;

  const pricingWeight = Number(candidate.seed_pool || 0) + Number(candidate.admin_weight || 0);
  const quote = marketQuote(Number(candidate.effective_pool), totalEffectivePool, pricingWeight);
  return {
    ...quote,
    totalEffectivePool,
    candidateEffectivePool: Number(candidate.effective_pool),
    pricingWeight,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const playerId = String(req.body?.playerId || '').trim();
  const candidateId = String(req.body?.candidateId || '').trim();
  const stake = Math.floor(Number(req.body?.stake));

  if (!playerId || !candidateId) return json(res, 400, { error: 'Missing player or candidate' });
  if (!Number.isFinite(stake) || stake < 10) return json(res, 400, { error: 'Minimum stake is 10 pts' });

  try {
    const sql = db();
    await applyDailyRefill(sql, playerId);

    const quote = await currentQuote(sql, candidateId);
    if (!quote) return json(res, 404, { error: 'Candidate not found' });

    const { effectiveStake, feeAmount } = splitStake(stake);
    const quoteSnapshot = Number(quote.decimalOdds.toFixed(4));

    const inserted = await sql`
      WITH charged AS (
        UPDATE players
        SET spent = spent + ${stake}
        WHERE id = ${playerId}
          AND spent + ${stake} <= starting_balance
          AND EXISTS (
            SELECT 1
            FROM market_config
            WHERE id = 1 AND now() < close_at
          )
        RETURNING id
      )
      INSERT INTO bets (
        player_id,
        candidate_id,
        stake,
        effective_stake,
        fee_amount,
        odds_at_bet
      )
      SELECT charged.id, c.id, ${stake}, ${effectiveStake}, ${feeAmount}, ${quoteSnapshot}
      FROM charged
      JOIN candidates c ON c.id = ${candidateId}
      RETURNING id, created_at, odds_at_bet, stake, effective_stake, fee_amount
    `;

    if (!inserted.length) {
      const [config] = await sql`SELECT now() AS now, close_at FROM market_config WHERE id = 1`;
      if (config && new Date(config.now) >= new Date(config.close_at)) {
        return json(res, 409, { error: 'Market is closed' });
      }

      const [player] = await sql`SELECT starting_balance, spent FROM players WHERE id = ${playerId}`;
      if (!player) return json(res, 404, { error: 'Player not found' });
      return json(res, 409, { error: 'Not enough points remaining' });
    }

    const [player] = await sql`
      SELECT id, nickname, starting_balance, spent,
             (starting_balance - spent)::int AS balance,
             ${DAILY_GRANT}::int AS daily_grant,
             (
               created_at +
               ((GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 86400)) + 1) * interval '1 day')
             ) AS next_refill_at
      FROM players
      WHERE id = ${playerId}
    `;

    const bet = {
      ...inserted[0],
      stake: Number(inserted[0].stake),
      effective_stake: Number(inserted[0].effective_stake),
      fee_amount: Number(inserted[0].fee_amount),
      odds_at_bet: Number(inserted[0].odds_at_bet),
      quote_snapshot_return: Math.round(effectiveStake * quoteSnapshot),
      quote_snapshot_net: Math.round(effectiveStake * quoteSnapshot - stake),
    };

    return json(res, 201, {
      ok: true,
      bet,
      player,
      settlement: {
        mode: 'final-pool',
        note: 'Quote snapshot is for audit only. Final payout uses the market quote at close.',
      },
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Unable to place bet' });
  }
}
