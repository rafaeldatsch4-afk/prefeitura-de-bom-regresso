// Notificações push. O aparelho só avisa "aconteceu isto" (mensagem do chat, atividade da República ou
// licitação enviada); o servidor confere no banco que é real e recente, monta o texto, escolhe quem recebe
// e manda cada aviso uma vez só. Antes o aparelho mandava texto e lista de aparelhos, e qualquer um podia
// mandar aviso falso para todo mundo.
const G=require('./_lib/google');
const A=require('./_lib/avisos');

const RECENTE=15*60*1000;
const recente=iso=>{const t=Date.parse(iso||'');return Number.isFinite(t)&&Math.abs(Date.now()-t)<RECENTE};
const cleanId=v=>String(v||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,120);
// O aparelho chama logo depois de gravar; espera um pouco se o registro ainda não chegou ao banco.
async function esperar(ler,ok){for(let i=0;i<4;i++){const v=await ler();if(v&&ok(v))return v;if(i<3)await G.sleep(1200)}return null}

async function chat(body){
  const id=cleanId(body.messageId);if(!id)return {status:400,error:'messageId'};
  const m=await esperar(()=>G.fsGet('chatMessages_v5/'+id),m=>!!m.senderId);
  if(!m||!recente(m.createdAt))return {status:404,error:'mensagem_nao_encontrada'};
  if(!(await G.fsCreateOnce('pushSent_v1','chat-'+id,{at:new Date().toISOString(),kind:'chat'})))return {duplicate:true,sent:0};
  const mentions=new Set(Array.isArray(m.mentions)?m.mentions:[]);
  const a=m.attachment,label=a?.kind==='image'?'📷 Imagem':a?.kind==='audio'?'🎙️ Mensagem de voz':a?'📎 Arquivo':'';
  const text=String(m.text||label||'Nova mensagem').slice(0,180);
  // Quem silenciou o chat ainda recebe quando é mencionado (@nome).
  const rows=(await A.allTokens()).filter(t=>t.token&&t.operatorId!==m.senderId&&(t.notificationsEnabled!==false||mentions.has(t.operatorId)));
  return A.deliver(rows,t=>{
    const preview=t.previewEnabled!==false,mencionado=mentions.has(t.operatorId);
    return {type:'chat',messageId:id,senderId:m.senderId,
      title:mencionado?`@ ${m.senderName||'Alguém'} mencionou você`:'💬 '+(m.senderName||'Chat da República'),
      body:preview?text:(mencionado?'Você foi mencionado no Chat da República':'Nova mensagem no Chat da República'),
      sound:t.soundEnabled===false?'0':'1',vibrate:t.vibrateEnabled===false?'0':'1',preview:preview?'1':'0'};
  });
}

async function republica(body){
  const id=String(body.activityId||'').slice(0,120);if(!id)return {status:400,error:'activityId'};
  const rep=await esperar(()=>G.fsGet('republica/dados_v1'),d=>Array.isArray(d.atividades)&&d.atividades.some(x=>x.id===id));
  const a=rep?.atividades.find(x=>x.id===id);
  if(!a||!recente(a.at))return {status:404,error:'atividade_nao_encontrada'};
  const rule=A.republicaRule(rep,a);if(!rule)return {sent:0,semAviso:true};
  if(!(await G.fsCreateOnce('pushSent_v1','rep-'+cleanId(id),{at:new Date().toISOString(),kind:'republica'})))return {duplicate:true,sent:0};
  return A.sendRepublica(rule,a.texto,id,a.autorId);
}

// Licitação enviada pela prefeitura (de dentro da República ou com o app da Prefeitura aberto sozinho).
async function licitacao(body){
  const cityId=cleanId(body.cityId),lid=cleanId(body.licitId);if(!lid)return {status:400,error:'licitId'};
  const path=cityId?'prefeituras_v5/'+cityId:'municipio/dados_v5';
  const doc=await esperar(()=>G.fsGet(path),d=>Array.isArray(d.licitations)&&d.licitations.some(x=>x.id===lid));
  const l=doc?.licitations.find(x=>x.id===lid);
  if(!l||!recente(l.createdAt)||!['Aguardando o estado','Aguardando confirmação'].includes(l.status))return {status:404,error:'licitacao_nao_encontrada'};
  const rep=await G.fsGet('republica/dados_v1');if(!rep)return {status:404,error:'republica'};
  const c=(rep.municipios||[]).find(x=>cityId?x.id===cityId:A.isBR(x));if(!c?.estado)return {sent:0,semEstado:true};
  if(!(await G.fsCreateOnce('pushSent_v1','lic-'+lid,{at:new Date().toISOString(),kind:'licitacao'})))return {duplicate:true,sent:0};
  const valor=Number(l.valor)>0?` de ${A.money(l.valor)}`:'';
  return A.sendRepublica({to:A.stateLeaders(rep,c.estado),title:'📑 Licitação para aprovar',cat:'licitacao'},`${c.nome} enviou a licitação "${String(l.title||'').slice(0,80)}"${valor} para o governo aprovar`,'lic-'+lid,'');
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET'){
    const sa=G.serviceAccount(),reason=G.configReason();
    return res.status(200).json({configured:!!sa,projectId:sa?.project_id||G.PROJECT_ID,...(reason?{reason}:{})});
  }
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  if(!G.serviceAccount())return res.status(503).json({error:'push_not_configured'});
  if(!(await G.verifyFirebaseUser(G.bearer(req))))return res.status(401).json({error:'invalid_firebase_session'});
  let body;try{body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{})}catch{return res.status(400).json({error:'json'})}
  try{
    const fn={chat,republica,licitacao}[body.kind];
    if(!fn)return res.status(400).json({error:'kind'});
    const out=await fn(body);
    return res.status(out.status||200).json(out);
  }catch(err){
    console.error('push error',err);
    return res.status(500).json({error:'push_failed'});
  }
};
