import { db, json } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const playerId = String(req.body?.playerId || '').trim();
  const candidateId = String(req.body?.candidateId || '').trim();
  const stake = Math.floor(Number(req.body?.stake));

  if (!playerId || !candidateId) return json(res, 400, { error: 'Missing player or candidate' });
  if (!Number.isFinite(stake) || stake < 10) return json(res, 400, { error: 'Minimum stake is 10 pts' });

  try {
    const sql = db();

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
      INSERT INTO bets (player_id, candidate_id, stake)
      SELECT charged.id, c.id, ${stake}
      FROM charged
      JOIN candidates c ON c.id = ${candidateId}
      RETURNING id, created_at
    `;

    if (!inserted.length) {
      const [config] = await sql`SELECT now() AS now, close_at FROM market_config WHERE id = 1`;
      if (config && new Date(config.now) >= new Date(config.close_at)) {
        return json(res, 409, { error: 'Market is closed' });
      }

      const [player] = await sql`SELECT starting_balance, spent FROM players WHERE id = ${playerId}`;
      if (!player) return json(res, 404, { error: 'Player not found' });

      const [candidate] = await sql`SELECT id FROM candidates WHERE id = ${candidateId}`;
      if (!candidate) return json(res, 404, { error: 'Candidate not found' });

      return json(res, 409, { error: 'Not enough points remaining' });
    }

    const [player] = await sql`
      SELECT id, nickname, starting_balance, spent,
             (starting_balance - spent)::int AS balance
      FROM players
      WHERE id = ${playerId}
    `;

    return json(res, 201, { ok: true, bet: inserted[0], player });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Unable to place bet' });
  }
}
