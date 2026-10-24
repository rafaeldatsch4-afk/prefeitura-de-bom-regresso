// Apagar mensagens de outras pessoas no chat (uma, várias ou a conversa inteira).
// O banco só deixa cada aparelho apagar o que ele mesmo enviou; quem tem acesso total apaga o resto por aqui,
// confirmando a própria senha.
const G=require('./_lib/google');
const S=require('./_lib/senhas');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  if(!G.serviceAccount())return res.status(503).json({error:'nao_configurado'});
  if(!(await G.verifyFirebaseUser(G.bearer(req))))return res.status(401).json({error:'invalid_firebase_session'});
  let b;try{b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{})}catch{return res.status(400).json({error:'json'})}
  try{
    if(b.op!=='apagar')return res.status(400).json({error:'op'});
    const ns=S.nsOf(b.ns),col='chatMessages_'+ns,media='chatMedia_'+ns;
    const c=await S.confereAdmin(b.adminId,b.adminSenha,ns);if(!c.ok)return res.status(c.status).json(c);
    let alvos;
    if(b.todos===true)alvos=(await G.fsList(col,['attachment'])).map(d=>({id:d.id,mediaId:d.data?.attachment?.mediaId||''}));
    else{
      const ids=[...new Set((Array.isArray(b.ids)?b.ids:[]).map(S.cleanId).filter(Boolean))].slice(0,500);
      if(!ids.length)return res.status(400).json({error:'ids'});
      alvos=await Promise.all(ids.map(async id=>({id,mediaId:(await G.fsGet(col+'/'+id).catch(()=>null))?.attachment?.mediaId||''})));
    }
    let apagadas=0;
    for(let i=0;i<alvos.length;i+=20){
      const r=await Promise.all(alvos.slice(i,i+20).map(async a=>{
        if(a.mediaId)await G.fsDelete(media+'/'+S.cleanId(a.mediaId)).catch(()=>{});
        return G.fsDelete(col+'/'+a.id).catch(()=>false);
      }));
      apagadas+=r.filter(Boolean).length;
    }
    return res.status(200).json({ok:true,apagadas});
  }catch(err){
    console.error('chat error',err);
    return res.status(500).json({error:'falha'});
  }
};
