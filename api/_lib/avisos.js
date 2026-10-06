// Quem recebe cada aviso. Fica no servidor: o aparelho só diz "aconteceu tal coisa" e o servidor confere
// no banco, monta o texto e escolhe os destinatários. Assim ninguém consegue mandar aviso falso.
const G=require('./google');

const ROLES={
  nacional:['Presidente','Vice-presidente','Assistente universal'],
  estadual:['Governador','Vice-governador'],
  prefeito:['Prefeito','Vice-prefeito'],
  municipal:['Prefeito','Vice-prefeito','Secretário da Agricultura','Motorista','Servidor / Outro']
};
const scope=p=>ROLES.nacional.includes(p?.role)?'nacional':ROLES.estadual.includes(p?.role)?'estadual':ROLES.municipal.includes(p?.role)?'municipal':'administrativo';
const list=v=>Array.isArray(v)?v:[];
const isBR=c=>String(c?.nome||'').trim().toLocaleLowerCase('pt-BR')==='bom regresso';
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);

function stateLeaders(rep,stId){
  if(!stId)return [];
  const st=list(rep.estados).find(x=>x.id===stId);
  const ids=[st?.governanteId,...list(rep.profiles).filter(p=>scope(p)==='estadual'&&p.jurisdictionId===stId).map(p=>p.id)].filter(Boolean);
  return ids.length?ids:list(rep.profiles).filter(p=>scope(p)==='nacional').map(p=>p.id);
}
function cityLeaders(rep,cId){
  const c=list(rep.municipios).find(x=>x.id===cId);if(!c)return [];
  return [c.prefeitoId,...list(rep.profiles).filter(p=>p.jurisdictionId===c.id&&ROLES.prefeito.includes(p.role)).map(p=>p.id)].filter(Boolean);
}
// Público de enquetes e eventos da agenda
function audience(rep,publico){
  const ps=list(rep.profiles);
  if(publico==='governadores')return ps.filter(p=>['estadual','nacional'].includes(scope(p))).map(p=>p.id);
  if(publico==='prefeitos')return ps.filter(p=>ROLES.prefeito.includes(p.role)||scope(p)==='nacional').map(p=>p.id);
  if(publico==='presidencia')return ps.filter(p=>scope(p)==='nacional').map(p=>p.id);
  return ps.map(p=>p.id);
}
const PUBLICO_NOME={todos:'Todos',governadores:'Governadores',prefeitos:'Prefeitos',presidencia:'Presidência'};

// Atividade da República → aviso (ou nada). "cat" é o tipo que cada pessoa pode desligar no sino.
function republicaRule(rep,a){
  const c=list(rep.municipios).find(x=>x.id===a.municipio),stId=a.estado||c?.estado||'';
  switch(a.acao){
    case 'Pedido de verba':return {to:stateLeaders(rep,stId),title:'📨 Pedido de verba',cat:'pedido'};
    case 'Pedido recusado':return {to:cityLeaders(rep,a.municipio),title:'❌ Pedido de verba recusado',cat:'pedido'};
    case 'Repasse':return a.nivel==='estado'&&c?{to:cityLeaders(rep,c.id),title:'💸 Repasse do estado',cat:'repasse'}:null;
    case 'Licitação aprovada':return {to:cityLeaders(rep,a.municipio),title:'✅ Licitação aprovada',cat:'licitacao'};
    case 'Licitação negada':return {to:cityLeaders(rep,a.municipio),title:'❌ Licitação negada',cat:'licitacao'};
    case 'Nova enquete':{const e=list(rep.enquetes).find(x=>x.id===a.ref);return e?{to:audience(rep,e.publico),title:'🗳️ Nova enquete',cat:'enquete'}:null}
    case 'Novo evento':{const e=list(rep.agenda).find(x=>x.id===a.ref);return e?{to:audience(rep,e.publico),title:'📅 Novo evento na agenda',cat:'agenda'}:null}
    case 'Ato publicado':return a.nivel==='republica'?{to:list(rep.profiles).map(p=>p.id),title:'📰 Diário Oficial da República',cat:'diario'}:null;
  }
  return null;
}

// Aparelhos das pessoas, respeitando o que cada uma desligou.
function wantsRepublica(t,cat){
  if(!t?.token)return false;
  const on=t.republicaAlerts===true||(t.republicaAlerts==null&&t.notificationsEnabled!==false);
  return on&&!(t.alertTypes&&t.alertTypes[cat]===false);
}
async function allTokens(){return (await G.fsList('pushTokens_v5')).map(d=>({id:d.id,...d.data}))}
// Manda para cada aparelho e apaga os que o Google diz que não existem mais.
async function deliver(rows,data){
  const seen=new Set(),uniq=rows.filter(r=>!seen.has(r.token)&&seen.add(r.token)).slice(0,200);
  let sent=0,failed=0;const stale=[];
  for(let i=0;i<uniq.length;i+=20){
    const res=await Promise.all(uniq.slice(i,i+20).map(r=>G.fcmSend(r.token,typeof data==='function'?data(r):data).catch(()=>({ok:false}))));
    res.forEach((x,j)=>{if(x.ok)sent++;else{failed++;if(x.stale)stale.push(uniq[i+j])}});
  }
  await Promise.all(stale.map(r=>G.fsDelete('pushTokens_v5/'+r.id).catch(()=>{})));
  return {sent,failed,removidos:stale.length};
}
async function sendRepublica({to,title,cat},body,messageId,exclude){
  const ids=new Set(to.filter(x=>x&&x!==exclude));if(!ids.size)return {sent:0,failed:0,removidos:0};
  const rows=(await allTokens()).filter(t=>ids.has(t.operatorId)&&wantsRepublica(t,cat));
  return deliver(rows,{type:'republica',title,body:String(body||'').slice(0,200),messageId,url:'/?open=atividades'});
}

module.exports={ROLES,scope,isBR,money,stateLeaders,cityLeaders,audience,PUBLICO_NOME,republicaRule,wantsRepublica,allTokens,deliver,sendRepublica};
