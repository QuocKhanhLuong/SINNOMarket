# SINNO Market

Shared prediction market parody for SINNO's 2026 leadership handover.

## Market logic

- One shared multi-candidate pool for the next SINNO President.
- Every browser gets one lightweight player identity and 10,000 virtual points.
- Public live activity is anonymous.
- No user-facing reset action.
- Odds are parimutuel and update from the shared pool: `odds = total pool / candidate pool`.
- The current roster starts with a neutral opening seed; admins can choose the opening pool when adding a new candidate.
- The UI polls the shared backend every 2 seconds to show live bets and updated odds.
- The server rejects new bets at **2026-09-01 00:00:00 GMT+7**.
- Estimated return is not locked at bet time; final return follows the final pool at market close.

## Dashboard

`/dashboard.html` shows live volume, trades, anonymous bettors, candidate odds/share/pool, pool distribution and recent bets.

The **Admin** button can add a candidate to the market pool. Candidate creation is protected by the server-side `ADMIN_KEY`; the key is never stored in the frontend.

## Stack

- Static HTML/CSS/JS frontend
- Vercel Serverless Functions under `/api`
- Neon Postgres shared state

## Required environment variables

- `DATABASE_URL` — Neon Postgres connection string.
- `ADMIN_KEY` — secret used only for candidate-management requests.

Set both in Vercel for Production (and Preview if needed). Never commit either value to the repository.

No real money, cash-out, or gambling service is involved. This is an internal virtual-points game.
