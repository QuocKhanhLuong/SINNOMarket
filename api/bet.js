import { db, json } from '../lib/db.js';
import { marketQuote } from '../lib/odds.js';

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
      (c.seed_pool + COALESCE(SUM(b.stake), 0))::int AS pool
    FROM candidates c
    LEFT JOIN bets b ON b.candidate_id = c.id
    GROUP BY c.id, c.seed_pool
  `;

  const totalPool = pools.reduce((sum, row) => sum + Number(row.pool), 0);
  const candidate = pools.find((row) => row.id === candidateId);
  if (!candidate) return null;

  const quote = marketQuote(Number(candidate.pool), totalPool);
  return { ...quote, totalPool, candidatePool: Number(candidate.pool) };
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

    const lockedOdds = Number(quote.decimalOdds.toFixed(4));

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
      INSERT INTO bets (player_id, candidate_id, stake, odds_at_bet)
      SELECT charged.id, c.id, ${stake}, ${lockedOdds}
      FROM charged
      JOIN candidates c ON c.id = ${candidateId}
      RETURNING id, created_at, odds_at_bet
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
      odds_at_bet: Number(inserted[0].odds_at_bet),
      stake,
      estimated_return: Math.round(stake * lockedOdds),
      estimated_profit: Math.round(stake * (lockedOdds - 1)),
    };

    return json(res, 201, { ok: true, bet, player });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Unable to place bet' });
  }
}
