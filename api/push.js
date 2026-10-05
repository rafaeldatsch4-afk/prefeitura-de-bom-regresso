const crypto=require('crypto');

const PROJECT_ID=process.env.FIREBASE_PROJECT_ID||'prefeitura-de-bom-regresso';
const WEB_API_KEY='AIzaSyAZRB9eqv2GFqObXfOP_PZDPDg2VSyjyow';

function serviceAccount(){
  if(process.env.FIREBASE_SERVICE_ACCOUNT_JSON){
    try{
      const raw=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      return {client_email:raw.client_email,private_key:raw.private_key,project_id:raw.project_id||PROJECT_ID};
    }catch{}
  }
  if(process.env.FIREBASE_CLIENT_EMAIL&&process.env.FIREBASE_PRIVATE_KEY){
    return {
      client_email:process.env.FIREBASE_CLIENT_EMAIL,
      private_key:String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g,'\n'),
      project_id:process.env.FIREBASE_PROJECT_ID||PROJECT_ID
    };
  }
  return null;
}
function b64url(input){
  const b=Buffer.isBuffer(input)?input:Buffer.from(typeof input==='string'?input:JSON.stringify(input));
  return b.toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
async function googleAccessToken(sa){
  const now=Math.floor(Date.now()/1000);
  const header=b64url({alg:'RS256',typ:'JWT'});
  const claims=b64url({
    iss:sa.client_email,
    scope:'https://www.googleapis.com/auth/firebase.messaging',
    aud:'https://oauth2.googleapis.com/token',
    iat:now,
    exp:now+3600
  });
  const unsigned=header+'.'+claims;
  const signer=crypto.createSign('RSA-SHA256');
  signer.update(unsigned);signer.end();
  const assertion=unsigned+'.'+b64url(signer.sign(sa.private_key));
  const r=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if(!r.ok)throw new Error('OAuth '+r.status+' '+(await r.text()));
  const j=await r.json();
  if(!j.access_token)throw new Error('OAuth sem access_token');
  return j.access_token;
}
async function verifyFirebaseUser(idToken){
  if(!idToken)return false;
  const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(WEB_API_KEY),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({idToken})
  });
  if(!r.ok)return false;
  const j=await r.json();
  return !!j.users?.[0]?.localId;
}
async function sendOne(accessToken,sa,token,title,body,data){
  const payload={
    message:{
      token,
      data:Object.fromEntries(Object.entries({type:'chat',title,body,...(data||{})}).map(([k,v])=>[k,String(v??'')])),
      webpush:{headers:{Urgency:'high',TTL:'86400'}}
    }
  };
  const r=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id||PROJECT_ID)}/messages:send`,{
    method:'POST',
    headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  const text=await r.text();
  return {ok:r.ok,status:r.status,body:text};
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const sa=serviceAccount();
  if(req.method==='GET'){
    const configured=!!(sa?.client_email&&sa?.private_key);
    // Diz o que falta, sem revelar nada da credencial.
    const reason=configured?'':process.env.FIREBASE_SERVICE_ACCOUNT_JSON?'FIREBASE_SERVICE_ACCOUNT_JSON não é um JSON válido de conta de serviço':'falta a variável FIREBASE_SERVICE_ACCOUNT_JSON';
    return res.status(200).json({configured,projectId:sa?.project_id||PROJECT_ID,...(reason?{reason}:{})});
  }
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  if(!sa?.client_email||!sa?.private_key)return res.status(503).json({error:'push_not_configured'});
  const auth=String(req.headers.authorization||'');
  const idToken=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(!(await verifyFirebaseUser(idToken)))return res.status(401).json({error:'invalid_firebase_session'});
  const bodyObj=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  const tokens=[...new Set(Array.isArray(bodyObj.tokens)?bodyObj.tokens.filter(x=>typeof x==='string'&&x.length>20):[])].slice(0,50);
  if(!tokens.length)return res.status(200).json({sent:0,failed:0});
  const title=String(bodyObj.title||'Chat da República').slice(0,90);
  const body=String(bodyObj.body||'Nova mensagem').slice(0,220);
  // Só os campos que o app usa; link só para dentro do próprio site (nada de mandar a pessoa para um site falso).
  const raw=bodyObj.data&&typeof bodyObj.data==='object'?bodyObj.data:{},data={};
  for(const k of ['type','messageId','senderId','sound','vibrate','preview','url'])if(raw[k]!=null)data[k]=String(raw[k]).slice(0,200);
  if(data.url&&!/^\/(?![\/\\])/.test(data.url))delete data.url;
  try{
    const accessToken=await googleAccessToken(sa);
    const results=await Promise.all(tokens.map(t=>sendOne(accessToken,sa,t,title,body,data).catch(err=>({ok:false,status:0,body:String(err)}))));
    const sent=results.filter(x=>x.ok).length,failed=results.length-sent;
    // Registros que o FCM não reconhece mais (app desinstalado, permissão revogada): o app apaga da lista.
    const stale=tokens.filter((t,i)=>!results[i].ok&&(results[i].status===404||/UNREGISTERED|registration token is not a valid/i.test(results[i].body||'')));
    return res.status(failed===results.length?502:200).json({sent,failed,stale});
  }catch(err){
    console.error('push error',err);
    return res.status(500).json({error:'push_failed'});
  }
};
