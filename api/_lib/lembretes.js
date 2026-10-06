// Lembretes da rotina diária: pedido sem resposta, obra atrasada, enquete que fecha amanhã e relatório do mês.
// Cada lembrete tem uma chave em pushSent_v1, então rodar a rotina de novo no mesmo dia não repete nada.
const G=require('./google');
const A=require('./avisos');

const DIA=864e5;
const dataBR=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(d);
const fmt=iso=>String(iso||'').split('-').reverse().join('/');
const limpa=v=>String(v||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,80);
const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

async function uma(chave,fn){if(!(await G.fsCreateOnce('pushSent_v1',chave,{at:new Date().toISOString(),kind:'lembrete'})))return 0;const r=await fn();return r?.sent||0}

async function lembretes(agora=new Date()){
  const rep=await G.fsGet('republica/dados_v1');if(!rep)return {enviados:0};
  const hoje=dataBR(agora),amanha=dataBR(new Date(agora.getTime()+DIA)),cidade=id=>(rep.municipios||[]).find(c=>c.id===id)?.nome||'';
  let enviados=0;const feitos=[];
  for(const st of rep.estados||[]){
    // Pedido de verba parado: avisa o governo de novo a cada 3 dias.
    for(const p of (st.pedidos||[]).filter(x=>x.status==='pendente')){
      const dias=Math.floor((agora-Date.parse(p.criadoEm))/DIA);if(!(dias>=3&&dias%3===0))continue;
      enviados+=await uma(`lemb-ped-${limpa(p.id)}-${dias}`,()=>A.sendRepublica({to:A.stateLeaders(rep,st.id),title:'⏰ Pedido esperando resposta',cat:'pedido'},
        `${cidade(p.municipio)||'Um município'} pediu ${A.money(p.valor)} há ${dias} dias: ${String(p.motivo||'').slice(0,90)}`,'lemb-ped-'+p.id,''));
      feitos.push('pedido '+p.id);
    }
    // Obra que passou do prazo: no primeiro dia e depois uma vez por semana.
    for(const o of (st.obras||[]).filter(x=>x.status!=='concluida'&&/^\d{4}-\d{2}-\d{2}$/.test(x.prazo||'')&&x.prazo<hoje)){
      const atraso=Math.round((Date.parse(hoje)-Date.parse(o.prazo))/DIA);if(atraso%7!==1)continue;
      enviados+=await uma(`lemb-obra-${limpa(o.id)}-${atraso}`,()=>A.sendRepublica({to:A.stateLeaders(rep,st.id),title:'🏗️ Obra atrasada',cat:'obras'},
        `"${String(o.nome||'Obra').slice(0,60)}"${o.municipio?` em ${cidade(o.municipio)}`:''} passou do prazo (${fmt(o.prazo)}) há ${atraso} ${atraso===1?'dia':'dias'}`,'lemb-obra-'+o.id,''));
      feitos.push('obra '+o.id);
    }
  }
  // Enquete que fecha amanhã: só quem ainda não votou.
  for(const e of (rep.enquetes||[]).filter(x=>!x.encerrada&&x.prazo===amanha)){
    const votou=new Set(Object.keys(e.votos||{}));
    enviados+=await uma(`lemb-enq-${limpa(e.id)}`,()=>A.sendRepublica({to:A.audience(rep,e.publico).filter(id=>!votou.has(id)),title:'🗳️ Enquete fecha amanhã',cat:'enquete'},
      String(e.pergunta||'').slice(0,150),'lemb-enq-'+e.id,'','/?open=enquetes'));
    feitos.push('enquete '+e.id);
  }
  // Dia 1º: relatório do mês que terminou, para a Presidência.
  if(hoje.endsWith('-01')){
    const ant=new Date(Date.parse(hoje+'T12:00:00Z')-2*DIA),mes=dataBR(ant).slice(0,7),nome=MESES[Number(mes.slice(5,7))-1]+' de '+mes.slice(0,4);
    enviados+=await uma(`lemb-relatorio-${mes}`,()=>A.sendRepublica({to:A.audience(rep,'presidencia'),title:'📊 Relatório de '+nome,cat:'relatorio'},
      'O relatório do mês está pronto. Toque para abrir e baixar em PDF.','relatorio-'+mes,'','/?open=relatorios&mes='+mes));
    feitos.push('relatório '+mes);
  }
  return {hoje,enviados,verificados:feitos.length};
}
module.exports={lembretes};
