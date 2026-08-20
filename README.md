# SINNO Market

Shared prediction market parody for SINNO's 2026 leadership handover.

## Market logic

- One shared multi-candidate pool for the next SINNO President.
- Every browser gets one lightweight player identity and 10,000 virtual points.
- No user-facing reset action.
- Odds are parimutuel and update from the shared pool: `odds = total pool / candidate pool`.
- Opening seed is calibrated so the current front-runner starts around `1.97:1`.
- The UI polls the shared backend every 2 seconds to show live bets and updated odds.
- The server rejects new bets at **2026-09-01 00:00:00 GMT+7**.
- Estimated return is not locked at bet time; final return follows the final pool at market close.

## Stack

- Static HTML/CSS/JS frontend
- Vercel Serverless Functions under `/api`
- Neon Postgres shared state

## Required environment variable

`DATABASE_URL`

No real money, cash-out, or gambling service is involved. This is an internal virtual-points game.
