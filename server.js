const express=require('express'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const app=express();app.use(express.json({limit:'50kb'}));app.use(express.static(path.join(__dirname,'public')));
const PASS=process.env.ADMIN_PASSWORD||'change-me-123';          // غيّرها من إعدادات الاستضافة
const SECRET=process.env.SECRET||'dev-secret-change';
const FILE=process.env.DATA_FILE||path.join(__dirname,'data.json');
const BRANCHES=['الغنايم - أسيوط','فيصل - القاهرة'];
const HOURS=['12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];
const DEAD=['مرفوض','ملغي'];
let db={appointments:[],cases:[]};
try{db=JSON.parse(fs.readFileSync(FILE,'utf8'))}catch{}
const save=()=>{fs.writeFileSync(FILE+'.tmp',JSON.stringify(db));fs.renameSync(FILE+'.tmp',FILE)};
const id=()=>crypto.randomBytes(4).toString('hex');
const clean=s=>String(s||'').trim().slice(0,500);
const sign=e=>e+'.'+crypto.createHmac('sha256',SECRET).update(String(e)).digest('hex');
const valid=t=>{const[e,h]=(t||'').split('.');return e&&+e>Date.now()&&sign(e)===t};
const auth=(q,r,n)=>valid((q.headers.authorization||'').replace('Bearer ',''))?n():r.status(401).json({error:'غير مصرح'});
const attempts={};
// ---------- عام ----------
const DAYS=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const defSched=()=>{const s={};for(let i=0;i<7;i++)s[i]={on:i!==5,from:'12:00',last:'20:00',step:60};return{schedule:s,off:[]}};
if(!db.settings||!db.settings.schedule)db.settings=defSched();
const S=()=>db.settings;
const cairo=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()).map(x=>[x.type,x.value]));return{date:`${p.year}-${p.month}-${p.day}`,min:(+p.hour%24)*60+ +p.minute}};
const toMin=t=>+t.slice(0,2)*60+ +t.slice(3);
const fmt=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
function timesFor(date){
  const d=new Date(date+'T12:00:00');if(!/^\d{4}-\d\d-\d\d$/.test(date)||isNaN(d)||S().off.includes(date))return[];
  const c=S().schedule[d.getDay()];if(!c||!c.on)return[];
  const out=[];for(let m=toMin(c.from);m<=toMin(c.last);m+=c.step)out.push(fmt(m));
  const n=cairo();return date<n.date?[]:date===n.date?out.filter(t=>toMin(t)>n.min):out;
}
const takenOn=date=>db.appointments.filter(a=>a.date===date&&!DEAD.includes(a.status)).map(a=>a.time);
app.get('/api/config',(q,r)=>r.json({days:Object.fromEntries(Object.entries(S().schedule).map(([k,v])=>[k,v.on])),off:S().off}));
app.get('/api/slots',(q,r)=>{const date=String(q.query.date||'');const all=timesFor(date);r.json({all,taken:takenOn(date).filter(t=>all.includes(t))})});
app.post('/api/appointments',(q,r)=>{
  const b=q.body,a={id:id(),name:clean(b.name),phone:clean(b.phone),branch:b.branch,type:clean(b.type),date:String(b.date||''),time:String(b.time||''),urgent:!!b.urgent,notes:clean(b.notes),status:'جديد',created:new Date().toISOString()};
  if(!a.name||!/^01\d{9}$/.test(a.phone)||!BRANCHES.includes(a.branch))return r.status(400).json({error:'راجع البيانات المدخلة'});
  if(!timesFor(a.date).includes(a.time))return r.status(400).json({error:'الميعاد ده مش متاح، اختار ميعاد من المتاحين'});
  // المحامي شخص واحد: نفس اليوم والساعة ممنوع في أي فرع
  if(takenOn(a.date).includes(a.time))return r.status(409).json({error:'الميعاد ده اتحجز قبل كده، من فضلك اختار وقت تاني'});
  if(db.appointments.some(x=>x.phone===a.phone&&x.date===a.date&&!DEAD.includes(x.status)))return r.status(409).json({error:'عندك حجز بالفعل في نفس اليوم'});
  db.appointments.push(a);save();r.json({ok:true,id:a.id});
});
// ---------- أدمن ----------
app.post('/api/login',(q,r)=>{
  const ip=q.ip;attempts[ip]=(attempts[ip]||0);
  if(attempts[ip]>=8)return r.status(429).json({error:'محاولات كتير، جرّب بعد شوية'});
  if(q.body.password!==PASS){attempts[ip]++;setTimeout(()=>attempts[ip]--,15*60*1000);return r.status(401).json({error:'كلمة المرور غلط'})}
  r.json({token:sign(Date.now()+12*3600*1000)});
});
app.get('/api/admin/data',auth,(q,r)=>r.json(db));
app.get('/api/admin/settings',auth,(q,r)=>r.json(S()));
app.put('/api/admin/settings',auth,(q,r)=>{
  const b=q.body||{},sc={},T=/^([01]\d|2[0-3]):[0-5]\d$/;
  for(let i=0;i<7;i++){const c=(b.schedule||{})[i]||{},st=+c.step;
    if(!T.test(c.from)||!T.test(c.last)||toMin(c.from)>toMin(c.last)||!(st>=15&&st<=240))return r.status(400).json({error:'راجع مواعيد يوم '+DAYS[i]});
    sc[i]={on:!!c.on,from:c.from,last:c.last,step:st}}
  const off=[...new Set((b.off||[]).map(String).filter(x=>/^\d{4}-\d\d-\d\d$/.test(x)))].sort();
  db.settings={schedule:sc,off};save();r.json(db.settings)});

app.patch('/api/admin/appointments/:id',auth,(q,r)=>{const a=db.appointments.find(x=>x.id===q.params.id);if(!a)return r.sendStatus(404);if(q.body.status)a.status=clean(q.body.status);save();r.json(a)});
app.delete('/api/admin/appointments/:id',auth,(q,r)=>{db.appointments=db.appointments.filter(x=>x.id!==q.params.id);save();r.json({ok:true})});
app.post('/api/admin/cases',auth,(q,r)=>{const b=q.body,c={id:id()};['client','phone','caseNo','court','nextSession','status','notes'].forEach(k=>c[k]=clean(b[k]));['fees','paid'].forEach(k=>c[k]=+b[k]||0);db.cases.push(c);save();r.json(c)});
app.put('/api/admin/cases/:id',auth,(q,r)=>{const c=db.cases.find(x=>x.id===q.params.id);if(!c)return r.sendStatus(404);['client','phone','caseNo','court','nextSession','status','notes'].forEach(k=>{if(k in q.body)c[k]=clean(q.body[k])});['fees','paid'].forEach(k=>{if(k in q.body)c[k]=+q.body[k]||0});save();r.json(c)});
app.delete('/api/admin/cases/:id',auth,(q,r)=>{db.cases=db.cases.filter(x=>x.id!==q.params.id);save();r.json({ok:true})});
app.listen(process.env.PORT||3000,()=>console.log('running'));
