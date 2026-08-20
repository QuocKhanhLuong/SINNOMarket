import { db, json } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  try {
    const sql = db();
    const [config] = await sql`
      SELECT title, close_at, now() AS server_now
      FROM market_config
      WHERE id = 1
    `;

    const candidates = await sql`
      SELECT
        c.id,
        c.name,
        c.role,
        c.initials,
        c.sort_order,
        c.seed_pool,
        (c.seed_pool + COALESCE(SUM(b.stake), 0))::int AS pool,
        COALESCE(SUM(b.stake), 0)::int AS user_pool,
        COUNT(b.id)::int AS bet_count
      FROM candidates c
      LEFT JOIN bets b ON b.candidate_id = c.id
      GROUP BY c.id, c.name, c.role, c.initials, c.sort_order, c.seed_pool
      ORDER BY c.sort_order ASC
    `;

    const [stats] = await sql`
      SELECT COALESCE(SUM(stake), 0)::int AS volume, COUNT(*)::int AS trades
      FROM bets
    `;

    const activity = await sql`
      SELECT
        b.id,
        b.stake,
        b.created_at,
        p.nickname,
        c.id AS candidate_id,
        c.name AS candidate_name,
        c.initials
      FROM bets b
      JOIN players p ON p.id = b.player_id
      JOIN candidates c ON c.id = b.candidate_id
      ORDER BY b.created_at DESC
      LIMIT 40
    `;

    const totalPool = candidates.reduce((sum, candidate) => sum + Number(candidate.pool), 0);
    const markets = candidates.map((candidate) => {
      const pool = Number(candidate.pool);
      const probability = totalPool ? pool / totalPool : 0;
      const odds = pool ? totalPool / pool : 0;
      return {
        ...candidate,
        pool,
        user_pool: Number(candidate.user_pool),
        bet_count: Number(candidate.bet_count),
        probability,
        odds,
      };
    });

    return json(res, 200, {
      title: config?.title || 'Who will be the next President of SINNO?',
      closeAt: config?.close_at,
      serverNow: config?.server_now,
      open: config ? new Date(config.server_now) < new Date(config.close_at) : false,
      totalPool,
      volume: Number(stats?.volume || 0),
      trades: Number(stats?.trades || 0),
      markets,
      activity,
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Unable to load market' });
  }
}
