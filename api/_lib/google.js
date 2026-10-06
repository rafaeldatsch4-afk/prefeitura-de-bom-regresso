// Acesso do servidor ao Google: login da conta de serviço, Firestore (REST) e envio de notificações (FCM).
// A conta de serviço ignora as regras do Firestore, então tudo aqui só lê o que precisa e só grava nas
// coleções do próprio servidor (pushSent_v1, backups_v1) ou apaga registros de aparelho inválidos.
const crypto=require('crypto');

const PROJECT_ID=process.env.FIREBASE_PROJECT_ID||'prefeitura-de-bom-regresso';
const WEB_API_KEY='AIzaSyAZRB9eqv2GFqObXfOP_PZDPDg2VSyjyow';

function serviceAccount(){
  if(process.env.FIREBASE_SERVICE_ACCOUNT_JSON){
    try{
      const raw=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if(raw.client_email&&raw.private_key)return {client_email:raw.client_email,private_key:raw.private_key,project_id:raw.project_id||PROJECT_ID};
    }catch{}
  }
  if(process.env.FIREBASE_CLIENT_EMAIL&&process.env.FIREBASE_PRIVATE_KEY){
    return {client_email:process.env.FIREBASE_CLIENT_EMAIL,private_key:String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g,'\n'),project_id:process.env.FIREBASE_PROJECT_ID||PROJECT_ID};
  }
  return null;
}
function configReason(){
  if(serviceAccount())return '';
  return process.env.FIREBASE_SERVICE_ACCOUNT_JSON?'FIREBASE_SERVICE_ACCOUNT_JSON não é um JSON válido de conta de serviço':'falta a variável FIREBASE_SERVICE_ACCOUNT_JSON';
}

const b64url=o=>Buffer.from(typeof o==='string'?o:JSON.stringify(o)).toString('base64url');
let cached={token:'',exp:0};
async function accessToken(){
  if(cached.token&&Date.now()<cached.exp)return cached.token;
  const sa=serviceAccount();if(!sa)throw new Error('push_not_configured');
  const now=Math.floor(Date.now()/1000);
  const unsigned=b64url({alg:'RS256',typ:'JWT'})+'.'+b64url({
    iss:sa.client_email,
    scope:'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore',
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600
  });
  const assertion=unsigned+'.'+crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  if(!r.ok)throw new Error('OAuth '+r.status+' '+(await r.text()));
  const j=await r.json();if(!j.access_token)throw new Error('OAuth sem access_token');
  cached={token:j.access_token,exp:Date.now()+50*60*1000};
  return j.access_token;
}
// Sessão do app (login anônimo do Firebase): só confere que veio de quem abriu o app.
async function verifyFirebaseUser(idToken){
  if(!idToken)return '';
  const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(WEB_API_KEY),{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken})});
  if(!r.ok)return '';
  const j=await r.json().catch(()=>({}));
  return j.users?.[0]?.localId||'';
}
const bearer=req=>{const a=String(req.headers?.authorization||'');return a.startsWith('Bearer ')?a.slice(7):''};

// ---- Firestore REST
const FS=()=>`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount()?.project_id||PROJECT_ID)}/databases/(default)/documents`;
const docPath=p=>String(p).split('/').map(encodeURIComponent).join('/');
function decode(v){
  if(!v||typeof v!=='object')return null;
  if('stringValue' in v)return v.stringValue;
  if('integerValue' in v)return Number(v.integerValue);
  if('doubleValue' in v)return Number(v.doubleValue);
  if('booleanValue' in v)return v.booleanValue;
  if('nullValue' in v)return null;
  if('timestampValue' in v)return v.timestampValue;
  if('mapValue' in v){const o={};for(const [k,x] of Object.entries(v.mapValue.fields||{}))o[k]=decode(x);return o}
  if('arrayValue' in v)return (v.arrayValue.values||[]).map(decode);
  if('referenceValue' in v)return v.referenceValue;
  if('bytesValue' in v)return v.bytesValue;
  if('geoPointValue' in v)return v.geoPointValue;
  return null;
}
function encode(v){
  if(v===null||v===undefined)return {nullValue:null};
  if(typeof v==='boolean')return {booleanValue:v};
  if(typeof v==='number')return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if(typeof v==='string')return {stringValue:v};
  if(Array.isArray(v))return {arrayValue:{values:v.map(encode)}};
  return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
}
const decodeFields=f=>{const o={};for(const [k,x] of Object.entries(f||{}))o[k]=decode(x);return o};
const idOf=name=>decodeURIComponent(String(name).split('/').pop());
async function fs(path,opts={}){
  const r=await fetch(FS()+path,{...opts,headers:{Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json',...(opts.headers||{})}});
  return r;
}
async function fsGetRaw(path){
  const r=await fs('/'+docPath(path));
  if(r.status===404)return null;
  if(!r.ok)throw new Error('Firestore GET '+r.status+' '+(await r.text()).slice(0,200));
  return r.json();
}
async function fsGet(path){const raw=await fsGetRaw(path);return raw?decodeFields(raw.fields):null}
// Lista uma coleção inteira (só os campos pedidos, quando "fields" vem).
async function fsList(collection,fields){
  const out=[];let pageToken='';
  do{
    const q=new URLSearchParams({pageSize:'300'});if(pageToken)q.set('pageToken',pageToken);
    for(const f of fields||[])q.append('mask.fieldPaths',f);
    const r=await fs('/'+docPath(collection)+'?'+q);
    if(!r.ok)throw new Error('Firestore LIST '+r.status+' '+(await r.text()).slice(0,200));
    const j=await r.json();
    for(const d of j.documents||[])out.push({id:idOf(d.name),data:decodeFields(d.fields),raw:d});
    pageToken=j.nextPageToken||'';
  }while(pageToken&&out.length<5000);
  return out;
}
// Cria só se ainda não existe: true = criou agora, false = já existia (serve para não mandar o mesmo aviso duas vezes).
async function fsCreateOnce(collection,id,data){
  const r=await fs('/'+docPath(collection)+'?documentId='+encodeURIComponent(id),{method:'POST',body:JSON.stringify({fields:encode(data).mapValue.fields})});
  if(r.status===409)return false;
  if(!r.ok)throw new Error('Firestore CREATE '+r.status+' '+(await r.text()).slice(0,200));
  return true;
}
async function fsSetRawFields(path,fields){
  const r=await fs('/'+docPath(path),{method:'PATCH',body:JSON.stringify({fields})});
  if(!r.ok)throw new Error('Firestore SET '+r.status+' '+(await r.text()).slice(0,200));
}
async function fsDelete(path){const r=await fs('/'+docPath(path),{method:'DELETE'});return r.ok||r.status===404}

// ---- FCM: mensagem só de dados (o service worker monta a notificação)
async function fcmSend(token,data){
  const sa=serviceAccount();
  const r=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id||PROJECT_ID)}/messages:send`,{
    method:'POST',headers:{Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json'},
    body:JSON.stringify({message:{token,data:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,String(v??'').slice(0,1000)])),webpush:{headers:{Urgency:'high',TTL:'86400'}}}})
  });
  const body=await r.text();
  return {ok:r.ok,status:r.status,stale:!r.ok&&(r.status===404||/UNREGISTERED|registration token is not a valid|INVALID_ARGUMENT.*token/i.test(body))};
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
module.exports={PROJECT_ID,serviceAccount,configReason,accessToken,verifyFirebaseUser,bearer,decode,encode,decodeFields,
  fsGet,fsGetRaw,fsList,fsCreateOnce,fsSetRawFields,fsDelete,fcmSend,sleep,_resetCache:()=>{cached={token:'',exp:0}}};
