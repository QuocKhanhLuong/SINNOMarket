import { timingSafeEqual } from 'node:crypto';
import { db, json } from '../lib/db.js';

function normalize(value,max=80){return String(value||'').replace(/\s+/g,' ').trim().slice(0,max)}
function slugify(value){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)}
function makeInitials(name){const parts=name.replace(/^(ts\.?|ths\.?|pgs\.?|gs\.?)\s*/i,'').trim().split(/\s+/).filter(Boolean);if(!parts.length)return'NA';if(parts.length===1)return parts[0].slice(0,2).toUpperCase();return`${parts[parts.length-2][0]}${parts[parts.length-1][0]}`.toUpperCase()}
function authorized(req){const expected=String(process.env.ADMIN_KEY||'').trim(),supplied=String(req.headers['x-admin-key']||req.body?.adminKey||'').trim();if(!expected)return{ok:false,status:503,error:'ADMIN_KEY is not configured in Vercel.'};if(!supplied)return{ok:false,status:401,error:'Admin key is required.'};const a=Buffer.from(expected),b=Buffer.from(supplied);return a.length===b.length&&timingSafeEqual(a,b)?{ok:true}:{ok:false,status:403,error:'Invalid admin key.'}}

export default async function handler(req,res){
 if(req.method==='PATCH')return json(res,410,{error:'Rate tuning moved to /api/admin-pricing.'});
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
 const auth=authorized(req);if(!auth.ok)return json(res,auth.status,{error:auth.error});
 try{const sql=db(),name=normalize(req.body?.name),role=normalize(req.body?.role)||'Candidate',initials=normalize(req.body?.initials,6).toUpperCase()||makeInitials(name),weightRaw=Number(req.body?.openingWeight??req.body?.seedPool??200),openingWeight=Math.floor(weightRaw);
  if(name.length<2)return json(res,400,{error:'Candidate name must be at least 2 characters.'});
  if(!Number.isFinite(openingWeight)||openingWeight<0||openingWeight>100000000)return json(res,400,{error:'Opening pricing weight must be between 0 and 100,000,000 pts.'});
  const [duplicate]=await sql`SELECT id FROM candidates WHERE lower(name)=lower(${name}) LIMIT 1`;if(duplicate)return json(res,409,{error:'This candidate already exists.'});
  const [orderRow]=await sql`SELECT COALESCE(MAX(sort_order),0)::int AS max_order FROM candidates`;const sortOrder=Number(orderRow?.max_order||0)+1;const baseId=slugify(name)||`candidate-${Date.now()}`;let id=baseId;const [sameId]=await sql`SELECT id FROM candidates WHERE id=${id} LIMIT 1`;if(sameId)id=`${baseId}-${Date.now().toString(36)}`;
  const [candidate]=await sql`INSERT INTO candidates(id,name,role,initials,sort_order,seed_pool,admin_weight) VALUES(${id},${name},${role},${initials},${sortOrder},0,${openingWeight}) RETURNING id,name,role,initials,sort_order,admin_weight`;
  return json(res,201,{ok:true,candidate});
 }catch(error){console.error('candidate api error',error);return json(res,500,{error:'Unable to add candidate.'})}
}
