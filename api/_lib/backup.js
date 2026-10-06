// Cópias de segurança: o documento da República e o de cada prefeitura são copiados como estão (campo a campo,
// sem converter nada) para backups_v1. Restaurar copia de volta, guardando antes o estado atual.
const G=require('./google');
const A=require('./avisos');

const MANTER=10; // conjuntos de cópias guardados
const stampId=iso=>iso.replace(/[-:.]/g,''); // 20261006T100000123Z

async function fontes(){
  const rep=await G.fsGet('republica/dados_v1').catch(()=>null);
  const nomes=new Map((rep?.municipios||[]).map(c=>[c.id,c.nome]));
  const out=[{key:'republica',path:'republica/dados_v1',nome:'República'},{key:'bom-regresso',path:'municipio/dados_v5',nome:'Prefeitura de Bom Regresso'}];
  for(const d of await G.fsList('prefeituras_v5',['updatedAt']).catch(()=>[]))out.push({key:'cidade-'+d.id,path:'prefeituras_v5/'+d.id,nome:'Prefeitura de '+(nomes.get(d.id)||d.id)});
  return out;
}
async function copiar(fonte,setId,em,motivo){
  const raw=await G.fsGetRaw(fonte.path);if(!raw?.fields)return null;
  const fields={...raw.fields,_backup:G.encode({set:setId,origem:fonte.key,path:fonte.path,nome:fonte.nome,em,motivo})};
  await G.fsSetRawFields('backups_v1/'+setId+'--'+fonte.key,fields);
  return fonte.key;
}
async function fazerBackup(motivo,somente){
  const em=new Date().toISOString(),setId=stampId(em),feitos=[],falhas=[];
  for(const f of await fontes()){
    if(somente&&f.path!==somente)continue;
    try{if(await copiar(f,setId,em,motivo))feitos.push(f.nome)}catch(err){console.error('backup',f.path,err);falhas.push(f.nome)}
  }
  if(!somente)await limpar().catch(err=>console.error('limpar backups',err));
  return {set:setId,em,feitos,falhas};
}
async function listar(){
  const docs=await G.fsList('backups_v1',['_backup']);
  const sets=new Map();
  for(const d of docs){const b=d.data._backup||{};const s=b.set||d.id.split('--')[0];
    if(!sets.has(s))sets.set(s,{id:s,em:b.em||'',motivo:b.motivo||'',itens:[]});
    sets.get(s).itens.push({id:d.id,origem:b.origem||'',nome:b.nome||d.id,path:b.path||''})}
  return [...sets.values()].sort((a,b)=>String(b.em).localeCompare(String(a.em)));
}
async function limpar(){
  const sets=await listar();
  for(const s of sets.slice(MANTER))for(const it of s.itens)await G.fsDelete('backups_v1/'+it.id);
}
async function restaurar(id){
  const raw=await G.fsGetRaw('backups_v1/'+id);if(!raw?.fields?._backup)return {status:404,error:'copia_nao_encontrada'};
  const meta=G.decode(raw.fields._backup);
  if(!/^(republica\/dados_v1|municipio\/dados_v5|prefeituras_v5\/[A-Za-z0-9_-]+)$/.test(meta.path||''))return {status:400,error:'origem'};
  const antes=await fazerBackup('antes de restaurar',meta.path);
  const fields={...raw.fields};delete fields._backup;
  // Data nova: os aparelhos abertos recebem a versão restaurada como uma atualização normal.
  const agora=new Date().toISOString();
  if(fields.updatedAt?.stringValue!==undefined)fields.updatedAt={stringValue:agora};
  await G.fsSetRawFields(meta.path,fields);
  return {ok:true,restaurado:meta.nome,de:meta.em,copiaAntes:antes.set};
}
async function ultimoBackup(){const s=await listar().catch(()=>[]);return s.find(x=>x.motivo==='semanal'||x.motivo==='manual')?.em||''}

// Lembretes do dia da agenda (fuso de Brasília).
async function lembretesAgenda(){
  const hoje=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());
  const rep=await G.fsGet('republica/dados_v1');if(!rep)return {hoje,enviados:0};
  let enviados=0;
  for(const e of (rep.agenda||[]).filter(x=>x.data===hoje&&!x.cancelado)){
    if(!(await G.fsCreateOnce('pushSent_v1','agenda-'+String(e.id).replace(/[^A-Za-z0-9_-]/g,'')+'-'+hoje,{at:new Date().toISOString(),kind:'agenda'})))continue;
    const r=await A.sendRepublica({to:A.audience(rep,e.publico),title:'📅 Hoje: '+String(e.titulo||'Evento').slice(0,60),cat:'agenda'},[e.hora,e.local].filter(Boolean).join(' · ')||'Evento da agenda oficial','agenda-'+e.id,'');
    enviados+=r.sent;
  }
  return {hoje,enviados};
}
module.exports={fazerBackup,listar,restaurar,ultimoBackup,lembretesAgenda};
