import { randomUUID } from 'node:crypto';
import { cleanNickname, db, json } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    const sql = db();

    if (req.method === 'GET') {
      const id = String(req.query?.id || '').trim();
      if (!id) return json(res, 400, { error: 'Missing player id' });

      const [player] = await sql`
        SELECT id, nickname, starting_balance, spent,
               (starting_balance - spent)::int AS balance
        FROM players
        WHERE id = ${id}
      `;

      if (!player) return json(res, 404, { error: 'Player not found' });
      return json(res, 200, player);
    }

    if (req.method === 'POST') {
      const nickname = cleanNickname(req.body?.nickname);
      const id = String(req.body?.id || randomUUID()).trim();

      const [player] = await sql`
        INSERT INTO players (id, nickname)
        VALUES (${id}, ${nickname})
        ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname
        RETURNING id, nickname, starting_balance, spent,
                  (starting_balance - spent)::int AS balance
      `;

      return json(res, 200, player);
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    return json(res, 400, { error: error.message || 'Unable to save player' });
  }
}
