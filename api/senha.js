// Troca e redefinição de senha dos perfis protegidos. As regras do banco não deixam mais o aparelho
// sobrescrever uma senha que já existe (antes qualquer visitante conseguia trocar a senha do Presidente);
// aqui o servidor confere a senha atual — ou a senha de quem tem acesso total, para redefinir a de outra pessoa.
const G=require('./_lib/google');
const S=require('./_lib/senhas');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  if(!G.serviceAccount())return res.status(503).json({error:'nao_configurado'});
  if(!(await G.verifyFirebaseUser(G.bearer(req))))return res.status(401).json({error:'invalid_firebase_session'});
  let b;try{b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{})}catch{return res.status(400).json({error:'json'})}
  try{
    const id=S.cleanId(b.profileId);if(!id)return res.status(400).json({error:'perfil'});
    const ns=S.nsOf(b.ns);
    if(b.op==='trocar'){
      // Troca a própria senha (ou só refaz o resumo com mais rodadas: atual = nova).
      const bad=S.problema(b.nova);if(bad&&b.nova!==b.atual)return res.status(400).json({error:'fraca',mensagem:bad});
      const c=await S.confere(id,b.atual,ns);if(!c.ok)return res.status(c.status).json(c);
      await S.grava(id,b.nova,c.segredo.role||await S.cargo(id,ns),ns);return res.status(200).json({ok:true});
    }
    if(b.op==='redefinir'){
      // Quem tem acesso total apaga a senha de outra pessoa (ela cria uma nova no próximo acesso), confirmando a própria senha.
      if(S.cleanId(b.adminId)===id)return res.status(400).json({error:'admin'});
      const c=await S.confereAdmin(b.adminId,b.adminSenha,ns);if(!c.ok)return res.status(c.status).json(c);
      await G.fsDelete('profileSecrets_'+ns+'/'+id);await S.zera(id,ns);return res.status(200).json({ok:true});
    }
    if(b.op==='limpar'){
      // O perfil deixou de ter cargo com senha (mudou de cargo ou foi removido): a senha antiga é apagada,
      // senão voltaria a valer se ele recebesse o cargo de novo. O aparelho grava a mudança logo antes; espera chegar.
      for(let i=0;i<5;i++){
        if(!S.FULL.includes(await S.cargo(id,ns))){await G.fsDelete('profileSecrets_'+ns+'/'+id);await S.zera(id,ns);return res.status(200).json({ok:true})}
        if(i<4)await G.sleep(1200);
      }
      return res.status(409).json({error:'ainda_protegido'});
    }
    return res.status(400).json({error:'op'});
  }catch(err){
    console.error('senha error',err);
    return res.status(500).json({error:'falha'});
  }
};
