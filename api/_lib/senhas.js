// Senhas dos perfis protegidos (PBKDF2-SHA-256), conferidas no servidor: troca de senha, redefinição,
// e confirmação de quem tem acesso total antes de ações perigosas (restaurar cópia, apagar mensagens de outros).
const crypto=require('crypto');
const G=require('./google');

const ITER=600000,SCHEMA=2,MAX_FALHAS=5,BLOQUEIO=5*60*1000;
// Cargos com senha e acesso total (os mesmos nos dois sistemas).
const FULL=['Presidente','Vice-presidente','Prefeito','Vice-prefeito','Assistente universal'];
const cleanId=v=>String(v||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,120);
// Cada sistema tem as próprias senhas: v5 (República e Prefeitura) e ind1 (cópia independente em /bom-regresso/).
const NS=['v5','ind1'];
const nsOf=v=>NS.includes(v)?v:'v5';
const tentativas=(id,ns)=>'senhaTentativas_v1/'+(ns==='v5'?'':ns+'_')+id;
const hash=(senha,salt,iter)=>crypto.pbkdf2Sync(Buffer.from(String(senha||''),'utf8'),Buffer.from(String(salt||''),'base64'),iter,32,'sha256').toString('base64');
const igual=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
function problema(v){v=String(v||'');if(v.length<6)return 'A senha precisa ter pelo menos 6 caracteres.';if(v.length>200)return 'Senha longa demais.';if(/^(.)\1+$/.test(v)||['123456','1234567','12345678','123456789','654321','111111','000000','123123','abcdef','qwerty','senha1','senha123','abc123','bomregresso'].includes(v.toLowerCase()))return 'Essa senha é muito fácil de adivinhar. Escolha outra.';return ''}

// Tentativas erradas: depois de 5 seguidas, o perfil espera 5 minutos.
async function bloqueado(id,ns){const t=await G.fsGet(tentativas(id,ns)).catch(()=>null);return t&&t.ate&&Date.parse(t.ate)>Date.now()?Date.parse(t.ate)-Date.now():0}
async function falhou(id,ns){const t=await G.fsGet(tentativas(id,ns)).catch(()=>null)||{};const n=(Number(t.n)||0)+1;
  await G.fsSetRawFields(tentativas(id,ns),G.encode({n,ate:n>=MAX_FALHAS?new Date(Date.now()+BLOQUEIO).toISOString():''}).mapValue.fields)}
const zera=(id,ns)=>G.fsDelete(tentativas(id,ns)).catch(()=>{});
async function confere(id,senha,ns){
  const espera=await bloqueado(id,ns);if(espera)return {status:429,error:'bloqueado',segundos:Math.ceil(espera/1000)};
  const s=await G.fsGet('profileSecrets_'+ns+'/'+id);if(!s?.hash||!s?.salt)return {status:404,error:'sem_senha'};
  if(!igual(hash(senha,s.salt,Number(s.iterations)||120000),s.hash)){await falhou(id,ns);await G.sleep(800);return {status:403,error:'senha_incorreta'}}
  await zera(id,ns);return {ok:true,segredo:s};
}
async function grava(id,senha,role,ns){
  const salt=crypto.randomBytes(16).toString('base64');
  await G.fsSetRawFields('profileSecrets_'+ns+'/'+id,G.encode({hash:hash(senha,salt,ITER),salt,iterations:ITER,role:String(role||'').slice(0,60),schemaVersion:SCHEMA,updatedAt:new Date().toISOString()}).mapValue.fields);
}
// Cargo da pessoa: perfis da República e, se não estiver lá, os do sistema municipal.
// Na cópia independente só valem os perfis dela.
async function cargo(id,ns){
  if(ns!=='v5'){const d=await G.fsGet('municipio/dados_'+ns).catch(()=>null);return (d?.operators||[]).find(x=>x.id===id)?.role||''}
  const rep=await G.fsGet('republica/dados_v1').catch(()=>null);
  const p=(rep?.profiles||[]).find(x=>x.id===id);if(p)return p.role||'';
  const br=await G.fsGet('municipio/dados_v5').catch(()=>null);
  const o=(br?.operators||[]).find(x=>x.id===id||x.federatedProfileId===id);return o?.role||'';
}
// Quem tem acesso total confirma a própria senha. Devolve {ok:true} ou {status,error} para responder.
async function confereAdmin(adminId,senha,ns){
  const adm=cleanId(adminId);if(!adm)return {status:400,error:'admin'};
  if(!FULL.includes(await cargo(adm,ns)))return {status:403,error:'sem_permissao'};
  return confere(adm,senha,ns);
}

module.exports={FULL,NS,nsOf,cleanId,problema,confere,confereAdmin,grava,cargo,zera};
