import { db, json } from '../lib/db.js';

const RATE_CEILING = 0.95;
const RATE_FLOOR = 0.08;
const RATE_LIQUIDITY = 5000;

function bookmakerRate(userPool) {
  const volume = Math.max(0, Number(userPool || 0));
  const raw = RATE_CEILING / (1 + volume / RATE_LIQUIDITY);
  return Math.max(RATE_FLOOR, Math.min(RATE_CEILING, raw));
}

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
      SELECT
        COALESCE(SUM(stake), 0)::int AS volume,
        COUNT(*)::int AS trades,
        COUNT(DISTINCT player_id)::int AS players,
        COALESCE(SUM(stake) FILTER (WHERE created_at >= now() - interval '60 minutes'), 0)::int AS volume_60m,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '60 minutes')::int AS trades_60m
      FROM bets
    `;

    const activity = await sql`
      SELECT
        b.id,
        b.stake,
        b.created_at,
        c.id AS candidate_id,
        c.name AS candidate_name,
        c.initials
      FROM bets b
      JOIN candidates c ON c.id = b.candidate_id
      ORDER BY b.created_at DESC
      LIMIT 50
    `;

    const hourly = await sql`
      SELECT
        date_trunc('hour', created_at) AS bucket,
        COALESCE(SUM(stake), 0)::int AS volume,
        COUNT(*)::int AS trades
      FROM bets
      WHERE created_at >= now() - interval '12 hours'
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const totalPool = candidates.reduce((sum, candidate) => sum + Number(candidate.pool), 0);
    const markets = candidates.map((candidate) => {
      const pool = Number(candidate.pool);
      const userPool = Number(candidate.user_pool);
      const probability = totalPool ? pool / totalPool : 0;
      const rate = bookmakerRate(userPool);
      return {
        ...candidate,
        pool,
        user_pool: userPool,
        bet_count: Number(candidate.bet_count),
        probability,
        rate,
        decimalOdds: 1 + rate,
        odds: rate,
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
      players: Number(stats?.players || 0),
      volume60m: Number(stats?.volume_60m || 0),
      trades60m: Number(stats?.trades_60m || 0),
      rateModel: {
        type: 'bookmaker-dynamic',
        ceiling: RATE_CEILING,
        floor: RATE_FLOOR,
        liquidity: RATE_LIQUIDITY,
      },
      markets,
      hourly,
      activity: activity.map((item) => ({ ...item, bettor: 'Anonymous' })),
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Unable to load market' });
  }
}
