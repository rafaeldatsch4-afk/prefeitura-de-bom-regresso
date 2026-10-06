// Rotina diária da Vercel (vercel.json → crons): agenda do dia, lembretes (pedido parado, obra atrasada,
// enquete fechando, relatório do mês) e cópia de segurança semanal.
// Tudo aqui é idempotente (cada lembrete sai uma vez por dia; a cópia só é feita se a última tem 6+ dias).
const G=require('./_lib/google');
const B=require('./_lib/backup');
const L=require('./_lib/lembretes');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const secret=process.env.CRON_SECRET;
  const auth=String(req.headers?.authorization||''),ua=String(req.headers?.['user-agent']||'');
  if(secret?auth!=='Bearer '+secret:!/vercel-cron/i.test(ua))return res.status(401).json({error:'unauthorized'});
  if(!G.serviceAccount())return res.status(503).json({error:'nao_configurado'});
  const out={};
  try{out.agenda=await B.lembretesAgenda()}catch(err){console.error('cron agenda',err);out.agenda={erro:true}}
  try{out.lembretes=await L.lembretes()}catch(err){console.error('cron lembretes',err);out.lembretes={erro:true}}
  try{
    const ultimo=await B.ultimoBackup();
    if(!ultimo||Date.now()-Date.parse(ultimo)>6*24*3600*1000)out.backup=await B.fazerBackup('semanal');
    else out.backup={pulado:true,ultimo};
  }catch(err){console.error('cron backup',err);out.backup={erro:true}}
  return res.status(200).json(out);
};
