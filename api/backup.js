// Cópias de segurança (tela "Cópias de segurança" da Presidência): listar, fazer agora e restaurar.
const G=require('./_lib/google');
const B=require('./_lib/backup');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!G.serviceAccount())return res.status(503).json({error:'nao_configurado'});
  if(!(await G.verifyFirebaseUser(G.bearer(req))))return res.status(401).json({error:'invalid_firebase_session'});
  try{
    if(req.method==='GET')return res.status(200).json({copias:await B.listar()});
    if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    if(body.op==='agora')return res.status(200).json(await B.fazerBackup('manual'));
    if(body.op==='restaurar'){const out=await B.restaurar(String(body.id||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,200));return res.status(out.status||200).json(out)}
    return res.status(400).json({error:'op'});
  }catch(err){
    console.error('backup error',err);
    return res.status(500).json({error:'backup_failed'});
  }
};
