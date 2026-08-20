import { randomUUID } from 'node:crypto';
import { cleanNickname, db, json } from '../lib/db.js';

const DAILY_GRANT = 10000;

async function applyDailyRefill(sql, id) {
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
    WHERE id = ${id}
  `;
}

async function readPlayer(sql, id) {
  const [player] = await sql`
    SELECT
      id,
      nickname,
      starting_balance,
      spent,
      created_at,
      (starting_balance - spent)::int AS balance,
      ${DAILY_GRANT}::int AS daily_grant,
      (
        created_at +
        ((GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 86400)) + 1) * interval '1 day')
      ) AS next_refill_at
    FROM players
    WHERE id = ${id}
  `;
  return player;
}

export default async function handler(req, res) {
  try {
    const sql = db();

    if (req.method === 'GET') {
      const id = String(req.query?.id || '').trim();
      if (!id) return json(res, 400, { error: 'Missing player id' });

      await applyDailyRefill(sql, id);
      const player = await readPlayer(sql, id);

      if (!player) return json(res, 404, { error: 'Player not found' });
      return json(res, 200, player);
    }

    if (req.method === 'POST') {
      const nickname = cleanNickname(req.body?.nickname);
      const id = String(req.body?.id || randomUUID()).trim();

      await sql`
        INSERT INTO players (id, nickname)
        VALUES (${id}, ${nickname})
        ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname
      `;

      await applyDailyRefill(sql, id);
      const player = await readPlayer(sql, id);
      return json(res, 200, player);
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('player api error', error);
    const message = error?.message || 'Unable to save player';
    const status = message.includes('Database is not connected') ? 503 : 400;
    return json(res, status, { error: message });
  }
}
