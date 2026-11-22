const express=require('express'),path=require('path'),crypto=require('crypto');
const{MongoClient}=require('mongodb');
const app=express();app.use(express.json({limit:'50kb'}));app.use(express.static(path.join(__dirname,'public')));
const PASS=process.env.ADMIN_PASSWORD||'change-me-123';
const SECRET=process.env.SECRET||'dev-secret-change';
const BRANCHES=['الغنايم - أسيوط','فيصل - القاهرة'];
const DAYS=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const DEAD=['مرفوض','ملغي'];
// ---------- قاعدة البيانات (MongoDB) ----------
let _p=null;
const getDb=()=>_p||(_p=(async()=>{
  if(!process.env.MONGODB_URI)throw new Error('MONGODB_URI غير مضبوط');
  const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:8000});await c.connect();
  const d=c.db(process.env.DB_NAME||'lawyer'),ap=d.collection('appointments');
  // منع الحجز المزدوج على مستوى قاعدة البيانات نفسها
  await ap.createIndex({date:1,time:1},{unique:true,partialFilterExpression:{active:true}});
  await ap.createIndex({phone:1,date:1},{unique:true,partialFilterExpression:{active:true}});
  return d})().catch(e=>{_p=null;throw e}));
const wrap=f=>(q,r)=>f(q,r).catch(e=>{console.error(e.message);r.status(500).json({error:'حدث خطأ، حاول مرة أخرى'})});
const id=()=>crypto.randomBytes(4).toString('hex');
const clean=s=>String(s||'').trim().slice(0,500);
const NO={projection:{_id:0}};
const sign=e=>e+'.'+crypto.createHmac('sha256',SECRET).update(String(e)).digest('hex');
const valid=t=>{const[e,h]=(t||'').split('.');return e&&+e>Date.now()&&sign(e)===t};
const auth=(q,r,n)=>valid((q.headers.authorization||'').replace('Bearer ',''))?n():r.status(401).json({error:'غير مصرح'});
// ---------- المواعيد المتاحة ----------
const defSched=()=>{const s={};for(let i=0;i<7;i++)s[i]={on:i!==5,from:'12:00',last:'20:00',step:60};return{schedule:s,off:[]}};
async function settings(){const d=await getDb(),x=await d.collection('settings').findOne({_id:'main'});return x&&x.schedule?{schedule:x.schedule,off:x.off||[]}:defSched()}
const cairo=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()).map(x=>[x.type,x.value]));return{date:`${p.year}-${p.month}-${p.day}`,min:(+p.hour%24)*60+ +p.minute}};
const toMin=t=>+t.slice(0,2)*60+ +t.slice(3);
const fmt=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
function timesFor(date,S){
  const d=new Date(date+'T12:00:00');if(!/^\d{4}-\d\d-\d\d$/.test(date)||isNaN(d)||S.off.includes(date))return[];
  const c=S.schedule[d.getDay()];if(!c||!c.on)return[];
  const out=[];for(let m=toMin(c.from);m<=toMin(c.last);m+=c.step)out.push(fmt(m));
  const n=cairo();return date<n.date?[]:date===n.date?out.filter(t=>toMin(t)>n.min):out;
}
const takenOn=async date=>(await(await getDb()).collection('appointments').find({date,active:true}).toArray()).map(a=>a.time);
// ---------- عام ----------
app.get('/api/config',wrap(async(q,r)=>{const S=await settings();r.json({days:Object.fromEntries(Object.entries(S.schedule).map(([k,v])=>[k,v.on])),off:S.off})}));
app.get('/api/slots',wrap(async(q,r)=>{const date=String(q.query.date||''),all=timesFor(date,await settings());r.json({all,taken:(await takenOn(date)).filter(t=>all.includes(t))})}));
app.post('/api/appointments',wrap(async(q,r)=>{
  const b=q.body||{},a={id:id(),name:clean(b.name),phone:clean(b.phone),branch:b.branch,type:clean(b.type),date:String(b.date||''),time:String(b.time||''),urgent:!!b.urgent,notes:clean(b.notes),status:'جديد',active:true,created:new Date().toISOString()};
  if(!a.name||!/^01\d{9}$/.test(a.phone)||!BRANCHES.includes(a.branch))return r.status(400).json({error:'راجع البيانات المدخلة'});
  if(!timesFor(a.date,await settings()).includes(a.time))return r.status(400).json({error:'الميعاد ده مش متاح، اختار ميعاد من المتاحين'});
  try{await(await getDb()).collection('appointments').insertOne(a)}
  catch(e){if(e.code===11000)return r.status(409).json({error:e.keyPattern&&e.keyPattern.phone?'عندك حجز بالفعل في نفس اليوم':'الميعاد ده اتحجز قبل كده، من فضلك اختار وقت تاني'});throw e}
  r.json({ok:true,id:a.id});
}));
// ---------- أدمن ----------
const attempts={};
app.post('/api/login',(q,r)=>{
  const ip=q.ip;attempts[ip]=attempts[ip]||0;
  if(attempts[ip]>=8)return r.status(429).json({error:'محاولات كتير، جرّب بعد شوية'});
  if((q.body||{}).password!==PASS){attempts[ip]++;setTimeout(()=>attempts[ip]--,15*60*1000).unref();return r.status(401).json({error:'كلمة المرور غلط'})}
  r.json({token:sign(Date.now()+12*3600*1000)});
});
app.get('/api/admin/data',auth,wrap(async(q,r)=>{const d=await getDb();
  const[appointments,cases]=await Promise.all([d.collection('appointments').find({},NO).toArray(),d.collection('cases').find({},NO).toArray()]);
  r.json({appointments,cases,settings:await settings()})}));
app.patch('/api/admin/appointments/:id',auth,wrap(async(q,r)=>{const c=(await getDb()).collection('appointments'),status=clean((q.body||{}).status);
  if(!status)return r.sendStatus(400);
  try{const u=await c.updateOne({id:q.params.id},{$set:{status,active:!DEAD.includes(status)}});if(!u.matchedCount)return r.sendStatus(404)}
  catch(e){if(e.code===11000)return r.status(409).json({error:'الميعاد ده اتحجز لشخص تاني'});throw e}
  r.json(await c.findOne({id:q.params.id},NO))}));
app.delete('/api/admin/appointments/:id',auth,wrap(async(q,r)=>{await(await getDb()).collection('appointments').deleteOne({id:q.params.id});r.json({ok:true})}));
const CT=['client','phone','caseNo','court','nextSession','status','notes'],CN=['fees','paid'];
app.post('/api/admin/cases',auth,wrap(async(q,r)=>{const b=q.body||{},c={id:id()};CT.forEach(k=>c[k]=clean(b[k]));CN.forEach(k=>c[k]=+b[k]||0);
  await(await getDb()).collection('cases').insertOne(c);delete c._id;r.json(c)}));
app.put('/api/admin/cases/:id',auth,wrap(async(q,r)=>{const b=q.body||{},s={};CT.forEach(k=>{if(k in b)s[k]=clean(b[k])});CN.forEach(k=>{if(k in b)s[k]=+b[k]||0});
  const c=(await getDb()).collection('cases');if(Object.keys(s).length)await c.updateOne({id:q.params.id},{$set:s});
  const x=await c.findOne({id:q.params.id},NO);x?r.json(x):r.sendStatus(404)}));
app.delete('/api/admin/cases/:id',auth,wrap(async(q,r)=>{await(await getDb()).collection('cases').deleteOne({id:q.params.id});r.json({ok:true})}));
app.get('/api/admin/settings',auth,wrap(async(q,r)=>r.json(await settings())));
app.put('/api/admin/settings',auth,wrap(async(q,r)=>{
  const b=q.body||{},sc={},T=/^([01]\d|2[0-3]):[0-5]\d$/;
  for(let i=0;i<7;i++){const c=(b.schedule||{})[i]||{},st=+c.step;
    if(!T.test(c.from)||!T.test(c.last)||toMin(c.from)>toMin(c.last)||!(st>=15&&st<=240))return r.status(400).json({error:'راجع مواعيد يوم '+DAYS[i]});
    sc[i]={on:!!c.on,from:c.from,last:c.last,step:st}}
  const off=[...new Set((b.off||[]).map(String).filter(x=>/^\d{4}-\d\d-\d\d$/.test(x)))].sort();
  await(await getDb()).collection('settings').replaceOne({_id:'main'},{_id:'main',schedule:sc,off},{upsert:true});r.json({schedule:sc,off})}));
module.exports=app;
if(require.main===module&&!process.env.VERCEL)app.listen(process.env.PORT||3000,()=>console.log('running'));
