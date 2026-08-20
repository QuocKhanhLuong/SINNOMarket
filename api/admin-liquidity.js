import { timingSafeEqual } from 'node:crypto';
import { db, json } from '../lib/db.js';

function authorized(req){const expected=String(process.env.ADMIN_KEY||'').trim(),supplied=String(req.headers['x-admin-key']||'').trim();if(!expected)return{ok:false,status:503,error:'ADMIN_KEY is not configured in Vercel.'};if(!supplied)return{ok:false,status:401,error:'Admin key is required.'};const a=Buffer.from(expected),b=Buffer.from(supplied);return a.length===b.length&&timingSafeEqual(a,b)?{ok:true}:{ok:false,status:403,error:'Invalid admin key.'}}

export default async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});const auth=authorized(req);if(!auth.ok)return json(res,auth.status,{error:auth.error});
 const candidateId=String(req.body?.candidateId||'').trim(),amount=Math.floor(Number(req.body?.amount));if(!candidateId)return json(res,400,{error:'Candidate is required.'});if(!Number.isFinite(amount)||amount<1||amount>100000000)return json(res,400,{error:'Weight buff must be between 1 and 100,000,000 pts.'});
 try{const sql=db();const [candidate]=await sql`UPDATE candidates SET admin_weight=LEAST(1000000000,admin_weight+${amount}) WHERE id=${candidateId} RETURNING id,name,seed_pool,admin_weight`;if(!candidate)return json(res,404,{error:'Candidate not found.'});return json(res,200,{ok:true,candidate:{...candidate,pricing_weight:Number(candidate.seed_pool||0)+Number(candidate.admin_weight||0)},added:amount,note:'Compatibility route: liquidity buffs now change pricing weight only.'});}catch(error){console.error('admin liquidity api error',error);return json(res,500,{error:'Unable to buff candidate pricing weight.'})}
}
