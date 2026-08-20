import { db, json } from '../lib/db.js';
import {
  CURVE_GAMMA,
  CURVE_MAX_ODDS,
  CURVE_MIN_ODDS,
  HOUSE_FEE_RATE,
  marketQuote,
} from '../lib/odds.js';

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
        c.admin_weight,
        COALESCE(SUM(b.stake), 0)::int AS gross_pool,
        COALESCE(SUM(b.effective_stake), 0)::int AS effective_pool,
        COALESCE(SUM(b.fee_amount), 0)::int AS fee_pool,
        COUNT(b.id)::int AS bet_count
      FROM candidates c
      LEFT JOIN bets b ON b.candidate_id = c.id
      GROUP BY c.id, c.name, c.role, c.initials, c.sort_order, c.seed_pool, c.admin_weight
      ORDER BY c.sort_order ASC
    `;

    const [stats] = await sql`
      SELECT
        COALESCE(SUM(stake), 0)::int AS gross_volume,
        COALESCE(SUM(effective_stake), 0)::int AS effective_pool,
        COALESCE(SUM(fee_amount), 0)::int AS house_fee,
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
        b.effective_stake,
        b.fee_amount,
        b.created_at,
        b.odds_at_bet,
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
        COALESCE(SUM(stake), 0)::int AS gross_volume,
        COALESCE(SUM(effective_stake), 0)::int AS effective_pool,
        COALESCE(SUM(fee_amount), 0)::int AS house_fee,
        COUNT(*)::int AS trades
      FROM bets
      WHERE created_at >= now() - interval '12 hours'
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const totalEffectivePool = Number(stats?.effective_pool || 0);
    const markets = candidates.map((candidate) => {
      const grossPool = Number(candidate.gross_pool || 0);
      const effectivePool = Number(candidate.effective_pool || 0);
      const feePool = Number(candidate.fee_pool || 0);
      const pricingWeight = Number(candidate.seed_pool || 0) + Number(candidate.admin_weight || 0);
      const quote = marketQuote(effectivePool, totalEffectivePool, pricingWeight);

      return {
        id: candidate.id,
        name: candidate.name,
        role: candidate.role,
        initials: candidate.initials,
        sort_order: candidate.sort_order,
        gross_pool: grossPool,
        effective_pool: effectivePool,
        fee_pool: feePool,
        pool: effectivePool,
        user_pool: effectivePool,
        gross_user_pool: grossPool,
        bet_count: Number(candidate.bet_count || 0),
        probability: quote.userShare,
        share: quote.userShare,
        pricingShare: quote.pricingShare,
        naturalOdds: quote.naturalOdds,
        curveOdds: quote.curveOdds,
        decimalOdds: quote.decimalOdds,
        odds: quote.decimalOdds,
        rate: quote.decimalOdds,
        profitMultiplier: quote.profitMultiplier,
      };
    });

    return json(res, 200, {
      title: config?.title || 'Who will be the next President of SINNO?',
      closeAt: config?.close_at,
      serverNow: config?.server_now,
      open: config ? new Date(config.server_now) < new Date(config.close_at) : false,
      totalPool: totalEffectivePool,
      effectivePool: totalEffectivePool,
      grossVolume: Number(stats?.gross_volume || 0),
      houseFee: Number(stats?.house_fee || 0),
      volume: Number(stats?.gross_volume || 0),
      trades: Number(stats?.trades || 0),
      players: Number(stats?.players || 0),
      volume60m: Number(stats?.volume_60m || 0),
      trades60m: Number(stats?.trades_60m || 0),
      feeRate: HOUSE_FEE_RATE,
      rateModel: {
        type: 'house-safe-curve',
        minOdds: CURVE_MIN_ODDS,
        maxOdds: CURVE_MAX_ODDS,
        gamma: CURVE_GAMMA,
        settlement: 'final-pool',
      },
      markets,
      hourly,
      activity: activity.map((item) => ({
        ...item,
        stake: Number(item.stake),
        effective_stake: Number(item.effective_stake),
        fee_amount: Number(item.fee_amount),
        odds_at_bet: item.odds_at_bet == null ? null : Number(item.odds_at_bet),
        bettor: 'Anonymous',
      })),
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Unable to load market' });
  }
}
