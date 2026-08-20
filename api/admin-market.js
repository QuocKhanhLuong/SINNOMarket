import { timingSafeEqual } from 'node:crypto';
import { db, json } from '../lib/db.js';
import { HOUSE_EDGE, MAX_DECIMAL_ODDS, MIN_DECIMAL_ODDS, marketQuote } from '../lib/odds.js';

const DAILY_GRANT = 10000;

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
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const auth = authorized(req);
  if (!auth.ok) return json(res, auth.status, { error: auth.error });

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
        COUNT(*) FILTER (WHERE created_at >= now() - interval '60 minutes')::int AS trades_60m,
        COUNT(*) FILTER (WHERE odds_at_bet IS NULL)::int AS legacy_bets,
        COALESCE(SUM(stake) FILTER (WHERE odds_at_bet IS NULL), 0)::int AS legacy_stake
      FROM bets
    `;

    const activity = await sql`
      SELECT
        b.id,
        b.stake,
        b.created_at,
        b.odds_at_bet,
        p.nickname,
        c.id AS candidate_id,
        c.name AS candidate_name,
        c.initials
      FROM bets b
      JOIN players p ON p.id = b.player_id
      JOIN candidates c ON c.id = b.candidate_id
      ORDER BY b.created_at DESC
      LIMIT 100
    `;

    const bettors = await sql`
      SELECT
        p.id,
        p.nickname,
        COUNT(b.id)::int AS bet_count,
        COALESCE(SUM(b.stake), 0)::int AS total_stake,
        (
          GREATEST(
            p.starting_balance,
            ${DAILY_GRANT} * (
              1 + GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - p.created_at)) / 86400)::int)
            )
          ) - p.spent
        )::int AS balance,
        MAX(b.created_at) AS last_bet_at,
        (
          p.created_at +
          ((GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - p.created_at)) / 86400)) + 1) * interval '1 day')
        ) AS next_refill_at
      FROM players p
      LEFT JOIN bets b ON b.player_id = p.id
      GROUP BY p.id, p.nickname, p.starting_balance, p.spent, p.created_at
      HAVING COUNT(b.id) > 0
      ORDER BY total_stake DESC, last_bet_at DESC
      LIMIT 100
    `;

    const settlementRows = await sql`
      SELECT
        b.candidate_id,
        p.id AS player_id,
        p.nickname,
        COUNT(*)::int AS bet_count,
        COALESCE(SUM(b.stake), 0)::int AS stake,
        COUNT(*) FILTER (WHERE b.odds_at_bet IS NULL)::int AS legacy_bets,
        COALESCE(SUM(b.stake) FILTER (WHERE b.odds_at_bet IS NULL), 0)::int AS legacy_stake,
        COALESCE(SUM(b.stake * b.odds_at_bet) FILTER (WHERE b.odds_at_bet IS NOT NULL), 0)::numeric AS locked_payout
      FROM bets b
      JOIN players p ON p.id = b.player_id
      GROUP BY b.candidate_id, p.id, p.nickname
    `;

    const totalPool = candidates.reduce((sum, candidate) => sum + Number(candidate.pool), 0);
    const adminLiquidity = candidates.reduce((sum, candidate) => sum + Number(candidate.seed_pool), 0);
    const totalUserVolume = Number(stats?.volume || 0);

    const markets = candidates.map((candidate) => {
      const pool = Number(candidate.pool);
      const userPool = Number(candidate.user_pool);
      const seedPool = Number(candidate.seed_pool);
      const quote = marketQuote(pool, totalPool);
      return {
        ...candidate,
        seed_pool: seedPool,
        admin_liquidity: seedPool,
        pool,
        user_pool: userPool,
        user_volume: userPool,
        bet_count: Number(candidate.bet_count),
        probability: quote.share,
        share: quote.share,
        decimalOdds: quote.decimalOdds,
        odds: quote.decimalOdds,
        profitMultiplier: quote.profitMultiplier,
      };
    });

    const marketById = new Map(markets.map((item) => [item.id, item]));
    const settlement = markets.map((candidate) => {
      const rows = settlementRows.filter((row) => row.candidate_id === candidate.id);
      const players = rows.map((row) => {
        const stake = Number(row.stake || 0);
        const legacyStake = Number(row.legacy_stake || 0);
        const lockedPayout = Number(row.locked_payout || 0);
        const estimatedLegacyPayout = legacyStake * candidate.decimalOdds;
        const payout = lockedPayout + estimatedLegacyPayout;
        return {
          playerId: row.player_id,
          nickname: row.nickname,
          betCount: Number(row.bet_count || 0),
          legacyBets: Number(row.legacy_bets || 0),
          stake,
          lockedPayout,
          estimatedLegacyPayout,
          payout,
          profit: payout - stake,
        };
      });

      const payoutLiability = players.reduce((sum, player) => sum + player.payout, 0);
      const winningStake = players.reduce((sum, player) => sum + player.stake, 0);
      const biggestWinner = [...players].sort((a, b) => b.payout - a.payout)[0] || null;

      return {
        candidateId: candidate.id,
        candidateName: candidate.name,
        share: candidate.share,
        currentOdds: candidate.decimalOdds,
        winningStake,
        payoutLiability,
        housePL: totalUserVolume - payoutLiability,
        biggestWinner,
        legacyEstimated: players.some((player) => player.legacyBets > 0),
      };
    });

    const currentLeader = [...markets].sort((a, b) => b.share - a.share)[0] || null;
    const leaderSettlement = currentLeader
      ? settlement.find((row) => row.candidateId === currentLeader.id) || null
      : null;
    const worstCase = [...settlement].sort((a, b) => a.housePL - b.housePL)[0] || null;
    const bestCase = [...settlement].sort((a, b) => b.housePL - a.housePL)[0] || null;

    return json(res, 200, {
      title: config?.title || 'Who will be the next President of SINNO?',
      closeAt: config?.close_at,
      serverNow: config?.server_now,
      open: config ? new Date(config.server_now) < new Date(config.close_at) : false,
      totalPool,
      adminLiquidity,
      volume: totalUserVolume,
      trades: Number(stats?.trades || 0),
      players: Number(stats?.players || 0),
      volume60m: Number(stats?.volume_60m || 0),
      trades60m: Number(stats?.trades_60m || 0),
      legacyBets: Number(stats?.legacy_bets || 0),
      legacyStake: Number(stats?.legacy_stake || 0),
      dailyGrant: DAILY_GRANT,
      rateModel: {
        type: 'share-bookmaker',
        houseEdge: HOUSE_EDGE,
        minDecimalOdds: MIN_DECIMAL_ODDS,
        maxDecimalOdds: MAX_DECIMAL_ODDS,
      },
      markets,
      settlement,
      leaderSettlement,
      worstCase,
      bestCase,
      activity: activity.map((item) => ({
        ...item,
        odds_at_bet: item.odds_at_bet == null ? null : Number(item.odds_at_bet),
      })),
      bettors,
    });
  } catch (error) {
    console.error('admin market api error', error);
    return json(res, 500, { error: 'Unable to load admin market.' });
  }
}
