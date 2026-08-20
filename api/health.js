import { db, hasDatabaseConfig, json } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  if (!hasDatabaseConfig()) {
    return json(res, 503, {
      ok: false,
      database: false,
      error: 'Database environment variable is missing in Vercel.'
    });
  }

  try {
    const sql = db();
    const [row] = await sql`SELECT now() AS now`;
    return json(res, 200, { ok: true, database: true, now: row?.now });
  } catch (error) {
    console.error('health api error', error);
    return json(res, 503, { ok: false, database: false, error: 'Database connection failed.' });
  }
}
