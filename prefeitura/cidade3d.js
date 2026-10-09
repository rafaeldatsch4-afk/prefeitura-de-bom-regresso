// Projeção 3D da cidade: mapa em blocos onde a prefeitura monta a cidade (prédios, UBS, escolas, ruas…).
// Cada município tem o próprio mapa em cidade3d_v1/{município}; todos veem, só quem tem acesso total edita.
// Three.js fica em vendor/three (licença MIT) e só é baixado quando esta página abre.
import * as THREE from './vendor/three/three.module.min.js';
import {OrbitControls} from './vendor/three/OrbitControls.js';

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const ease=t=>1-Math.pow(1-t,3);
const easeBack=t=>{const c=1.7;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2)};
const REDUCED=matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCHY=matchMedia('(pointer: coarse)').matches;
const P=new URLSearchParams(location.search);
const CITY_ID=String(P.get('city')||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,80);
const CITY_KEY=CITY_ID||'bom-regresso';
const N=40;               // lotes por lado
const MAX_ITEMS=2400;
const MAX_DEL_POR_ENVIO=250; // as regras recusam uma gravação que some com muitos itens de uma vez
const CACHE_KEY='cidade3d_v1__'+CITY_KEY,PEND_KEY='cidade3d_v1_pend__'+CITY_KEY,NIGHT_KEY='cidade3d_noite',LBL_KEY='cidade3d_nomes',HELP_KEY='cidade3d_ajuda_vista';
const FIREBASE_CONFIG={
  apiKey:'AIzaSyAZRB9eqv2GFqObXfOP_PZDPDg2VSyjyow',
  authDomain:'prefeitura-de-bom-regresso.firebaseapp.com',
  projectId:'prefeitura-de-bom-regresso',
  storageBucket:'prefeitura-de-bom-regresso.firebasestorage.app',
  messagingSenderId:'198816706059',
  appId:'1:198816706059:web:0cc06972a903b13867610e'
};
const ls={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}},del(k){try{localStorage.removeItem(k)}catch{}}};

// Quem está usando vem do sistema da Prefeitura (a página abre dentro dele ou numa aba aberta por ele).
function readCtx(){
  const wins=[];try{if(window.parent!==window)wins.push(window.parent)}catch{}try{if(window.opener)wins.push(window.opener)}catch{}
  for(const w of wins){try{const c=w.__cidade3dCtx;if(c&&c.cityKey===CITY_KEY)return {api:typeof c.charge==='function'?c:(c.api||null),cityKey:String(c.cityKey),cityName:String(c.cityName||''),operatorName:String(c.operatorName||''),role:String(c.role||''),canEdit:c.canEdit===true,primary:String(c.primary||''),accent:String(c.accent||'')}}catch{}}
  return null;
}
const CTX=readCtx();
window.__cidade3dCtx=CTX;
const CAN_EDIT=!!CTX?.canEdit;

// ---------------------------------------------------------------- Preços (pagos com o saldo de Finanças da Prefeitura)
const PRECO={prefeitura:500000,delegacia:150000,bombeiros:200000,ubs:100000,hospital:1000000,escola:250000,casa:10000,predio:50000,mercado:80000,posto:60000,igreja:120000,praca:40000,campo:80000,arvore:500,lago:30000,lavoura:20000,rua:5000};
const ANDAR=15000;
const precoTipo=(t,h)=>PRECO[t]+(t==='predio'?(h||6)*ANDAR:0);
const price=it=>precoTipo(it.t,it.h);
function fmtR(v){v=Math.round(Number(v)||0);const a=Math.abs(v),s=v<0?'−':'';
  if(a>=1e6)return `${s}R$ ${(a/1e6).toLocaleString('pt-BR',{maximumFractionDigits:a>=1e7?0:1})} mi`;
  if(a>=1000)return `${s}R$ ${(a/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} mil`;return `${s}R$ ${a}`}
const fmtFull=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}).format(Number(v)||0);
let saldoAtual=NaN;
function lerSaldo(){try{const v=Number(CTX?.api?.saldo());saldoAtual=Number.isFinite(v)?v:NaN}catch{saldoAtual=NaN}return saldoAtual}
const temCaixa=()=>Number.isFinite(saldoAtual);
function cobrar(desc,valor){
  if(!CTX?.api)return {ok:false,motivo:'Abra a projeção pela Prefeitura para construir.'};
  try{const r=CTX.api.charge('Projeção 3D: '+desc,valor);const o={ok:!!r?.ok,id:String(r?.id||''),motivo:String(r?.motivo||''),falta:Number(r?.falta)||0};lerSaldo();atualizaDinheiro();return o}
  catch{return {ok:false,motivo:'A Prefeitura foi fechada. Abra a projeção de novo pela Prefeitura.'}}
}
function devolver(id){if(!id||!CTX?.api)return false;try{const r=CTX.api.refund(id);lerSaldo();atualizaDinheiro();return !!r?.ok}catch{return false}}
function avisoCobranca(r){toast(r.motivo==='saldo'?`Saldo insuficiente: faltam ${fmtR(r.falta)}. Lance receitas em Finanças.`:r.motivo||'Não deu para pagar a obra')}
function atualizaDinheiro(){if(tool==='construir')renderCatalog();updHint();updSummary();if(selId)renderCard();if(typeof updGhost==='function'&&ghost?.visible)updGhost()}
const WHO=(CTX?.operatorName||'').slice(0,60);
const CITY_NAME=(CTX?.cityName||String(P.get('cityName')||'').trim()).slice(0,60)||(CITY_ID?'Município':'Bom Regresso');
const EMBED=(()=>{try{return window.parent!==window&&typeof window.parent.App?.systemBack==='function'}catch{return false}})();
{const hex=v=>/^#[0-9a-f]{6}$/i.test(v)?v:'';const r=document.documentElement.style;if(hex(CTX?.primary))r.setProperty('--acc',CTX.primary);if(hex(CTX?.accent))r.setProperty('--gold',CTX.accent)}

function rng(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);

// ---------------------------------------------------------------- Catálogo
const CATS=[['gov','Governo e segurança'],['saude','Saúde e educação'],['mor','Moradia'],['com','Comércio'],['laz','Comunidade e lazer'],['campo','Campo'],['rua','Ruas']];
const T={
  prefeitura:{nome:'Prefeitura',ic:'🏛️',w:3,d:2,cat:'gov',label:true},
  delegacia:{nome:'Delegacia',ic:'🚓',w:2,d:2,cat:'gov',label:true},
  bombeiros:{nome:'Bombeiros',longo:'Corpo de Bombeiros',ic:'🚒',w:2,d:2,cat:'gov',label:true},
  ubs:{nome:'UBS',longo:'Unidade Básica de Saúde',ic:'🩺',w:2,d:2,cat:'saude',label:true},
  hospital:{nome:'Hospital',ic:'🏥',w:3,d:3,cat:'saude',label:true},
  escola:{nome:'Escola',ic:'🏫',w:3,d:2,cat:'saude',label:true},
  casa:{nome:'Casa',ic:'🏠',w:1,d:1,cat:'mor',vars:6,varNome:'Cor',varNomes:['Areia','Verde-água','Salmão','Azul','Branca','Lilás'],rand:true},
  predio:{nome:'Prédio',ic:'🏢',w:2,d:2,cat:'mor',vars:4,varNome:'Cor',varNomes:['Cinza','Bege','Azul','Creme'],floors:true,rand:true},
  mercado:{nome:'Mercado',ic:'🛒',w:2,d:2,cat:'com',label:true},
  posto:{nome:'Posto',longo:'Posto de combustível',ic:'⛽',w:2,d:2,cat:'com',label:true},
  igreja:{nome:'Igreja',ic:'⛪',w:2,d:3,cat:'laz',label:true},
  praca:{nome:'Praça',ic:'⛲',w:3,d:3,cat:'laz',label:true},
  campo:{nome:'Campo de futebol',ic:'⚽',w:4,d:3,cat:'laz',label:true},
  arvore:{nome:'Árvore',ic:'🌳',w:1,d:1,cat:'laz',vars:4,varNome:'Espécie',varNomes:['Copa redonda','Pinheiro','Ipê-amarelo','Ipê-roxo'],rand:true},
  lago:{nome:'Lago',ic:'💧',w:3,d:3,cat:'laz'},
  lavoura:{nome:'Lavoura',ic:'🌾',w:3,d:3,cat:'campo',vars:4,varNome:'Cultura',varNomes:['Soja','Milho','Café','Cana']},
  rua:{nome:'Rua',ic:'🛣️',w:1,d:1,cat:'rua'}
};
const typeName=it=>it.n||T[it.t]?.nome||'';

// ---------------------------------------------------------------- Modelos (peças simples juntadas numa malha só)
const _c=new THREE.Color();
function paint(g,hex){const n=g.attributes.position.count,a=new Float32Array(n*3);_c.set(hex);for(let i=0;i<n;i++){a[i*3]=_c.r;a[i*3+1]=_c.g;a[i*3+2]=_c.b}g.setAttribute('color',new THREE.BufferAttribute(a,3))}
function merge(list){
  if(!list.length)return null;
  let n=0;for(const g of list)n+=g.attributes.position.count;
  const pos=new Float32Array(n*3),nor=new Float32Array(n*3),col=new Float32Array(n*3);let o=0;
  for(const g of list){pos.set(g.attributes.position.array,o*3);nor.set(g.attributes.normal.array,o*3);col.set(g.attributes.color.array,o*3);o+=g.attributes.position.count;g.dispose()}
  const m=new THREE.BufferGeometry();
  m.setAttribute('position',new THREE.BufferAttribute(pos,3));m.setAttribute('normal',new THREE.BufferAttribute(nor,3));m.setAttribute('color',new THREE.BufferAttribute(col,3));
  m.computeBoundingBox();m.computeBoundingSphere();return m;
}
const LAYERS=['solid','lit','dark','sign','lamp','water'];
class Kit{
  constructor(rnd){this.L={};for(const k of LAYERS)this.L[k]=[];this.rnd=rnd||Math.random}
  put(g,hex,x,y,z,o={}){
    if(g.index)g=g.toNonIndexed();
    if(g.attributes.uv)g.deleteAttribute('uv');
    if(o.sx||o.sz)g.scale(o.sx||1,1,o.sz||1);
    if(o.rx)g.rotateX(o.rx);if(o.rz)g.rotateZ(o.rz);if(o.ry)g.rotateY(o.ry);
    g.translate(x,y,z);paint(g,hex);this.L[o.m||'solid'].push(g);return this;
  }
  box(w,h,d,x,y,z,hex,o){return this.put(new THREE.BoxGeometry(w,h,d),hex,x,y+h/2,z,o)}
  cyl(rt,rb,h,x,y,z,hex,seg=10,o){return this.put(new THREE.CylinderGeometry(rt,rb,h,seg),hex,x,y+h/2,z,o)}
  cone(r,h,x,y,z,hex,seg=8,o){return this.put(new THREE.ConeGeometry(r,h,seg),hex,x,y+h/2,z,o)}
  ball(r,x,y,z,hex,o={}){return this.put(new THREE.IcosahedronGeometry(r,o.det??0),hex,x,y,z,o)}
  dome(r,x,y,z,hex){return this.put(new THREE.SphereGeometry(r,14,7,0,Math.PI*2,0,Math.PI/2),hex,x,y,z)}
  // Telhado de duas águas; a cumeeira corre ao longo de "axis"
  gable(w,h,d,x,y,z,hex,axis='x'){
    const a=axis==='x'?d:w,len=axis==='x'?w:d,s=new THREE.Shape();
    s.moveTo(-a/2,0);s.lineTo(a/2,0);s.lineTo(0,h);s.closePath();
    const g=new THREE.ExtrudeGeometry(s,{depth:len,bevelEnabled:false});g.translate(0,0,-len/2);if(axis==='x')g.rotateY(Math.PI/2);
    return this.put(g,hex,x,y,z);
  }
  hip(w,h,d,x,y,z,hex){const g=new THREE.ConeGeometry(Math.SQRT1_2,h,4);g.rotateY(Math.PI/4);g.scale(w,1,d);return this.put(g,hex,x,y+h/2,z)}
  // Janelas numa face de um bloco (f = frente +z, b = fundos, l = esquerda -x, r = direita +x); acesas ou não à noite
  wins(cx,cz,w,d,y0,rows,rowH,face,cols,o={}){
    const ww=o.ww||0.12,wh=o.wh||rowH*0.5,lit=o.lit??0.62,span=face==='f'||face==='b'?w:d,spread=o.spread??0.8;
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const along=((c+0.5)/cols-0.5)*span*spread,y=y0+r*rowH+(rowH-wh)/2,m=this.rnd()<lit?'lit':'dark';
      if(face==='f'||face==='b')this.put(new THREE.BoxGeometry(ww,wh,0.02),'#fff',cx+along,y+wh/2,cz+(face==='f'?d/2+0.006:-d/2-0.006),{m});
      else this.put(new THREE.BoxGeometry(0.02,wh,ww),'#fff',cx+(face==='r'?w/2+0.006:-w/2-0.006),y+wh/2,cz+along,{m});
    }
    return this;
  }
  sub(fn,x,y,z,ry=0){const s=new Kit(this.rnd);fn(s);for(const k of LAYERS)for(const g of s.L[k]){if(ry)g.rotateY(ry);g.translate(x,y,z);this.L[k].push(g)}return this}
  build(){const o={};for(const k of LAYERS)o[k]=merge(this.L[k]);return o}
}

const C={grass:'#7cb556',walk:'#cfd2cf',stone:'#d6cfbf',white:'#fbfaf6',wood:'#7a4b2a',trunk:'#7a5236',leaf:'#4c9a3f',leaf2:'#5aa84a',metal:'#9aa3ad',dark:'#3d4650'};
function tree(k,x,z,s=1,col=C.leaf){k.cyl(0.035*s,0.05*s,0.28*s,x,0,z,C.trunk,6);k.ball(0.22*s,x,0.44*s,z,col);k.ball(0.14*s,x+0.08*s,0.56*s,z+0.04*s,C.leaf2)}
function lamp(k,x,z,h=0.55){k.cyl(0.013,0.018,h,x,0,z,C.dark,6);k.ball(0.045,x,h+0.03,z,'#fff3c4',{m:'lamp',det:1})}
function vehicle(k,kind='car',col='#d64541'){
  const wheel=(x,z,r=0.04)=>k.put(new THREE.CylinderGeometry(r,r,0.035,10),'#22262b',x,r,z,{rz:Math.PI/2});
  const lights=(z,y=0.07,dx=0.055)=>{k.box(0.035,0.02,0.01,-dx,y,z,'#fff6d5',{m:'lamp'});k.box(0.035,0.02,0.01,dx,y,z,'#fff6d5',{m:'lamp'})};
  if(kind==='truck'){
    k.box(0.21,0.17,0.36,0,0.035,-0.07,col);k.box(0.21,0.19,0.15,0,0.035,0.19,col);
    k.box(0.212,0.025,0.362,0,0.1,-0.07,'#f4f4f4');
    k.box(0.18,0.07,0.01,0,0.13,0.266,'#2b3a4a',{m:'dark'});
    k.box(0.07,0.02,0.36,0,0.205,-0.07,'#c9ced3');
    k.box(0.05,0.025,0.04,-0.05,0.225,0.19,'#ff3b30',{m:'sign'});k.box(0.05,0.025,0.04,0.05,0.225,0.19,'#ff3b30',{m:'sign'});
    for(const z of [-0.17,0,0.19]){wheel(-0.105,z);wheel(0.105,z)}
    lights(0.266,0.08,0.07);
  }else if(kind==='amb'){
    k.box(0.18,0.16,0.36,0,0.035,0,'#ffffff');k.box(0.182,0.03,0.362,0,0.09,0,'#e03a3a');
    k.box(0.16,0.06,0.01,0,0.12,0.181,'#2b3a4a',{m:'dark'});
    k.box(0.1,0.006,0.03,0,0.195,-0.05,'#e03a3a',{m:'sign'});k.box(0.03,0.006,0.1,0,0.195,-0.05,'#e03a3a',{m:'sign'});
    k.box(0.06,0.025,0.03,0,0.195,0.12,'#3b82f6',{m:'sign'});
    wheel(-0.09,-0.11);wheel(0.09,-0.11);wheel(-0.09,0.11);wheel(0.09,0.11);lights(0.181);
  }else{
    const c=kind==='police'?'#f4f6f8':col;
    k.box(0.17,0.07,0.3,0,0.035,0,c);k.box(0.148,0.065,0.16,0,0.105,-0.02,c);
    k.box(0.152,0.045,0.13,0,0.112,-0.02,'#2b3a4a',{m:'dark'});
    if(kind==='police'){k.box(0.172,0.025,0.302,0,0.06,0,'#1f4f8f');k.box(0.035,0.022,0.04,-0.025,0.17,-0.02,'#ff3b30',{m:'sign'});k.box(0.035,0.022,0.04,0.025,0.17,-0.02,'#2f6bff',{m:'sign'})}
    wheel(-0.085,-0.095);wheel(0.085,-0.095);wheel(-0.085,0.095);wheel(0.085,0.095);
    lights(0.151);k.box(0.035,0.02,0.01,-0.055,0.07,-0.151,'#e03a3a',{m:'sign'});k.box(0.035,0.02,0.01,0.055,0.07,-0.151,'#e03a3a',{m:'sign'});
  }
}
function redCross(k,x,y,z,s=1,m='sign'){k.box(0.34*s,0.34*s,0.025,x,y,z,'#ffffff',{m});k.box(0.22*s,0.07*s,0.03,x,y+0.135*s,z+0.004,'#e23b3b',{m});k.box(0.07*s,0.22*s,0.03,x,y+0.06*s,z+0.004,'#e23b3b',{m})}

// Todos os modelos olham para +z (frente) e ficam centrados no próprio terreno.
const MODELS={
  prefeitura(k){
    const cream='#f3e9d2';
    k.box(2.92,0.03,1.92,0,0,0,'#cfc8b6');
    k.box(2.6,0.12,1.3,0,0.03,-0.25,C.stone);
    k.box(2.4,0.95,1.1,0,0.15,-0.25,cream);
    k.box(2.5,0.07,1.2,0,1.1,-0.25,C.white);
    k.hip(2.4,0.22,1.1,0,1.17,-0.25,'#5f7183');
    k.box(0.5,0.45,0.5,0,1.1,-0.25,cream);k.box(0.58,0.05,0.58,0,1.55,-0.25,C.white);k.dome(0.25,0,1.6,-0.25,'#c9a14a');
    k.cyl(0.012,0.012,0.22,0,1.84,-0.25,C.metal,5);
    k.put(new THREE.CylinderGeometry(0.13,0.13,0.02,18),'#ffffff',0,1.34,0.005,{rx:Math.PI/2,m:'sign'});
    k.box(0.016,0.09,0.012,0,1.33,0.02,'#222');k.box(0.07,0.016,0.012,0.03,1.33,0.02,'#222');
    k.box(1.3,0.06,0.5,0,0.15,0.55,C.stone);
    for(const x of [-0.5,-0.17,0.17,0.5])k.cyl(0.05,0.056,0.78,x,0.21,0.72,C.white,10);
    k.box(1.36,0.1,0.56,0,0.99,0.55,C.white);
    k.gable(1.36,0.3,0.56,0,1.09,0.55,C.white,'z');
    k.box(1.2,0.06,0.22,0,0.03,0.88,C.stone);k.box(1.2,0.12,0.12,0,0.03,0.8,C.stone);
    k.box(0.3,0.52,0.02,0,0.15,0.31,C.wood);
    k.wins(-0.9,-0.25,0.6,1.1,0.22,2,0.42,'f',2,{ww:0.13,wh:0.25});
    k.wins(0.9,-0.25,0.6,1.1,0.22,2,0.42,'f',2,{ww:0.13,wh:0.25});
    k.wins(0,-0.25,2.4,1.1,0.22,2,0.42,'b',6,{ww:0.13,wh:0.25});
    k.wins(0,-0.25,2.4,1.1,0.22,2,0.42,'l',3,{ww:0.13,wh:0.25});
    k.wins(0,-0.25,2.4,1.1,0.22,2,0.42,'r',3,{ww:0.13,wh:0.25});
    k.cyl(0.018,0.022,1.35,1.28,0.03,0.75,C.metal,6);
    k.box(0.44,0.28,0.016,1.5,1.06,0.75,'#1f9e4a');
    k.box(0.17,0.17,0.02,1.5,1.115,0.752,'#f2c230',{rz:Math.PI/4});
    k.put(new THREE.CylinderGeometry(0.055,0.055,0.024,12),'#1e4fa3',1.5,1.2,0.754,{rx:Math.PI/2});
    k.ball(0.15,-1.22,0.17,0.62,'#3f8f3a');k.ball(0.15,1.0,0.17,0.45,'#3f8f3a');k.ball(0.12,-0.8,0.15,0.75,'#4c9a3f');
    lamp(k,-0.75,0.9,0.5);lamp(k,0.75,0.9,0.5);
  },
  ubs(k){
    const teal='#1f8a74';
    k.box(1.92,0.03,1.92,0,0,0,C.walk);
    k.box(1.6,0.72,1.15,0,0.03,-0.25,'#f7f7f3');
    k.box(1.62,0.1,1.17,0,0.5,-0.25,teal);
    k.box(1.7,0.06,1.25,0,0.75,-0.25,'#d9dcdf');
    k.box(0.4,0.01,0.12,0.25,0.81,-0.3,'#e23b3b',{m:'sign'});k.box(0.12,0.01,0.4,0.25,0.81,-0.3,'#e23b3b',{m:'sign'});
    k.box(0.9,0.05,0.5,-0.2,0.55,0.57,teal);
    k.cyl(0.022,0.022,0.52,-0.6,0.03,0.77,C.metal,6);k.cyl(0.022,0.022,0.52,0.2,0.03,0.77,C.metal,6);
    k.box(0.36,0.42,0.02,-0.2,0.03,0.335,'#9ccbe0',{m:'lit'});
    redCross(k,0.5,0.1,0.34,0.9);
    k.wins(0,-0.25,1.6,1.15,0.08,1,0.42,'b',4,{ww:0.18,wh:0.22});
    k.wins(0,-0.25,1.6,1.15,0.08,1,0.42,'l',2,{ww:0.18,wh:0.22});
    k.wins(0,-0.25,1.6,1.15,0.08,1,0.42,'r',2,{ww:0.18,wh:0.22});
    k.sub(s=>vehicle(s,'amb'),0.62,0.0,0.62,Math.PI/2);
    k.ball(0.12,-0.82,0.13,0.8,'#3f8f3a');
  },
  hospital(k){
    k.box(2.94,0.03,2.94,0,0,0,C.walk);
    k.box(1.5,1.9,1.4,-0.55,0.03,-0.55,'#f7f8fa');
    k.box(1.52,0.12,1.42,-0.55,1.8,-0.55,'#2c6fb0');
    k.box(1.56,0.05,1.46,-0.55,1.93,-0.55,'#cfd5da');
    k.cyl(0.5,0.5,0.03,-0.55,1.98,-0.55,'#4b5560',22);
    k.box(0.06,0.006,0.34,-0.65,2.01,-0.55,'#ffffff',{m:'sign'});k.box(0.06,0.006,0.34,-0.45,2.01,-0.55,'#ffffff',{m:'sign'});k.box(0.2,0.006,0.06,-0.55,2.01,-0.55,'#ffffff',{m:'sign'});
    for(const f of ['b','l'])k.wins(-0.55,-0.55,1.5,1.4,0.1,4,0.42,f,4,{ww:0.17,wh:0.2});
    k.wins(-0.85,-0.55,0.9,1.4,0.1,4,0.42,'f',2,{ww:0.17,wh:0.2});
    k.wins(-0.55,-0.55,1.5,1.4,0.85,2,0.42,'r',4,{ww:0.17,wh:0.2});
    redCross(k,-0.2,1.3,0.155,1.1);
    k.box(1.3,0.78,1.5,0.75,0.03,0.25,'#e9f0f4');
    k.box(1.32,0.06,1.52,0.75,0.81,0.25,'#2c6fb0');
    k.wins(0.75,0.25,1.3,1.5,0.1,2,0.34,'r',4,{ww:0.17,wh:0.17});
    k.wins(1.0,0.25,0.8,1.5,0.1,2,0.34,'f',2,{ww:0.17,wh:0.17});
    k.box(0.36,0.4,0.02,0.4,0.03,1.01,'#9ccbe0',{m:'lit'});
    k.box(0.7,0.05,0.4,0.4,0.48,1.18,'#2c6fb0');k.cyl(0.02,0.02,0.45,0.1,0.03,1.33,C.metal,6);k.cyl(0.02,0.02,0.45,0.7,0.03,1.33,C.metal,6);
    for(let i=0;i<5;i++)k.box(0.02,0.006,0.42,-1.3+i*0.22,0.031,0.95,'#ffffff');
    k.sub(s=>vehicle(s,'amb'),-1.08,0,0.95);k.sub(s=>vehicle(s,'car','#4a6fa5'),-0.42,0,0.95);
    tree(k,1.25,-1.15,0.9);tree(k,0.55,-1.2,0.8);
  },
  escola(k){
    k.box(2.94,0.03,1.94,0,0,0,C.walk);
    k.box(2.7,0.7,0.85,0,0.03,-0.5,'#f2d27a');
    k.box(2.72,0.08,0.87,0,0.03,-0.5,'#b5533a');
    k.gable(2.86,0.32,1.0,0,0.73,-0.5,'#c0573e','x');
    k.wins(-0.75,-0.5,1.1,0.85,0.12,1,0.5,'f',3,{ww:0.18,wh:0.26});
    k.wins(0.75,-0.5,1.1,0.85,0.12,1,0.5,'f',3,{ww:0.18,wh:0.26});
    k.wins(0,-0.5,2.7,0.85,0.12,1,0.5,'b',7,{ww:0.18,wh:0.26});
    k.box(0.32,0.44,0.02,0,0.03,-0.07,C.wood);
    k.box(0.6,0.04,0.3,0,0.5,0.05,'#b5533a');
    k.box(1.5,0.02,0.72,-0.55,0.03,0.52,'#3f8a5a');
    const W='#ffffff',y=0.05;
    k.box(1.4,0.004,0.02,-0.55,y,0.2,W);k.box(1.4,0.004,0.02,-0.55,y,0.84,W);k.box(0.02,0.004,0.64,-1.25,y,0.52,W);k.box(0.02,0.004,0.64,0.15,y,0.52,W);k.box(0.02,0.004,0.64,-0.55,y,0.52,W);
    k.cyl(0.012,0.012,0.3,-1.2,0.03,0.52,C.metal,5);k.cyl(0.012,0.012,0.3,0.1,0.03,0.52,C.metal,5);
    k.box(0.22,0.18,0.06,0.68,0.03,0.5,'#e74c3c');k.box(0.06,0.24,0.06,0.88,0.03,0.5,'#3498db');k.box(0.3,0.02,0.08,0.75,0.2,0.5,'#f1c40f',{rz:-0.5});
    k.cyl(0.015,0.018,1.0,1.25,0.03,0.6,C.metal,6);k.box(0.32,0.2,0.012,1.41,0.78,0.6,'#1f9e4a');k.box(0.12,0.12,0.016,1.41,0.82,0.602,'#f2c230',{rz:Math.PI/4});
    k.box(2.9,0.08,0.04,0,0.03,0.95,'#e9e4d8');
    tree(k,1.25,0.2,0.75);
  },
  delegacia(k){
    k.box(1.92,0.03,1.92,0,0,0,C.walk);
    k.box(1.6,0.7,1.1,0,0.03,-0.3,'#eef1f5');
    k.box(1.62,0.13,1.12,0,0.55,-0.3,'#1f4f8f');
    k.box(1.66,0.05,1.16,0,0.73,-0.3,'#9aa6b2');
    k.box(0.7,0.12,0.03,0,0.56,0.26,'#ffffff',{m:'sign'});
    k.box(0.5,0.035,0.035,0,0.6,0.28,'#1f4f8f',{m:'sign'});
    k.box(0.34,0.42,0.02,0,0.03,0.255,'#2b3a4a',{m:'dark'});
    k.wins(-0.55,-0.3,0.5,1.1,0.12,1,0.4,'f',2,{ww:0.14,wh:0.2});k.wins(0.55,-0.3,0.5,1.1,0.12,1,0.4,'f',2,{ww:0.14,wh:0.2});
    for(const f of ['b','l','r'])k.wins(0,-0.3,1.6,1.1,0.12,1,0.4,f,3,{ww:0.14,wh:0.2});
    k.sub(s=>vehicle(s,'police'),-0.45,0,0.62,Math.PI/2);k.sub(s=>vehicle(s,'police'),0.45,0,0.62,Math.PI/2);
    k.cyl(0.015,0.018,1.0,0.85,0.03,0.85,C.metal,6);k.box(0.3,0.19,0.012,1.0,0.8,0.85,'#1f9e4a');
  },
  bombeiros(k){
    const red='#c8352e';
    k.box(1.92,0.03,1.92,0,0,0,C.walk);
    k.box(1.7,0.85,1.2,0,0.03,-0.35,red);
    k.box(1.72,0.06,1.22,0,0.6,-0.35,'#f4f4f4');
    k.box(1.76,0.05,1.26,0,0.88,-0.35,'#7d2a26');
    for(const x of [-0.42,0.42]){k.box(0.6,0.52,0.02,x,0.03,0.255,'#e7e2d8');for(let i=1;i<5;i++)k.box(0.6,0.012,0.024,x,0.03+i*0.104,0.256,'#bdb6a8')}
    k.wins(0,-0.35,1.7,1.2,0.64,1,0.22,'f',5,{ww:0.13,wh:0.12});
    for(const f of ['b','l'])k.wins(0,-0.35,1.7,1.2,0.2,2,0.3,f,3,{ww:0.14,wh:0.14});
    k.box(0.4,1.55,0.4,0.62,0.03,-0.72,'#b52f29');k.box(0.46,0.06,0.46,0.62,1.58,-0.72,'#7d2a26');
    k.wins(0.62,-0.72,0.4,0.4,0.95,2,0.3,'r',1,{ww:0.14,wh:0.16});
    k.box(0.06,0.04,0.06,0.62,1.64,-0.72,'#ff3b30',{m:'sign'});
    k.sub(s=>vehicle(s,'truck',red),0.42,0,0.62);
  },
  posto(k){
    const red='#d63a2f';
    k.box(1.95,0.03,1.95,0,0,0,'#bfc3c7');
    k.cyl(0.05,0.05,0.66,-0.5,0.03,0.3,'#e8e8e8',8);k.cyl(0.05,0.05,0.66,0.5,0.03,0.3,'#e8e8e8',8);
    k.box(1.5,0.12,0.92,0,0.68,0.3,'#f7f7f7');
    k.box(1.54,0.05,0.96,0,0.72,0.3,red);
    k.box(1.2,0.01,0.6,0,0.668,0.3,'#fffbe6',{m:'lamp'});
    k.box(0.92,0.05,0.24,0,0.03,0.3,'#d8dadd');
    for(const x of [-0.25,0.25]){k.box(0.14,0.32,0.12,x,0.08,0.3,red);k.box(0.1,0.06,0.125,x,0.3,0.3,'#bfe6ff',{m:'sign'})}
    k.box(0.95,0.5,0.45,-0.45,0.03,-0.7,'#f7f7f7');k.box(0.97,0.08,0.47,-0.45,0.5,-0.7,red);
    k.box(0.62,0.26,0.02,-0.45,0.1,-0.47,'#9ccbe0',{m:'lit'});
    k.cyl(0.03,0.03,0.9,0.82,0.03,-0.78,C.metal,6);
    k.box(0.34,0.44,0.06,0.82,0.86,-0.78,red);
    for(let i=0;i<3;i++)k.box(0.24,0.06,0.065,0.82,0.92+i*0.11,-0.78,'#ffffff',{m:'sign'});
    k.sub(s=>vehicle(s,'car','#3d7dd8'),0.25,0,0.62);
  },
  mercado(k){
    k.box(1.92,0.03,1.92,0,0,0,C.walk);
    k.box(1.75,0.72,1.25,0,0.03,-0.3,'#f4efe6');
    k.box(1.77,0.14,1.27,0,0.62,-0.3,'#2a7d3e');
    k.box(1.8,0.04,1.3,0,0.76,-0.3,'#aab3ad');
    k.box(1.3,0.36,0.02,0,0.05,0.335,'#9ccbe0',{m:'lit'});
    for(let i=0;i<6;i++)k.box(0.29,0.02,0.34,-0.725+i*0.29,0.5,0.48,i%2?'#f7f7f7':'#d63a2f',{rx:0.38});
    k.box(1.0,0.24,0.05,0,0.78,0.22,'#2a7d3e');
    k.box(0.7,0.07,0.055,0,0.86,0.222,'#ffffff',{m:'sign'});
    for(let i=0;i<5;i++)k.box(0.02,0.005,0.3,-0.7+i*0.3,0.031,0.8,'#ffffff');
    k.sub(s=>vehicle(s,'car','#e0a526'),-0.55,0,0.8);
    k.ball(0.1,0.85,0.12,0.4,'#3f8f3a');k.ball(0.1,-0.85,0.12,0.4,'#3f8f3a');
  },
  igreja(k){
    const white='#fbfaf6',roof='#b4533c',blue='#3a6ea5';
    k.box(1.92,0.03,2.92,0,0,0,'#d9d3c4');
    k.box(1.1,0.85,1.9,0,0.03,-0.4,white);
    k.box(1.12,0.08,1.92,0,0.03,-0.4,blue);
    k.gable(1.24,0.45,2.0,0,0.88,-0.4,roof,'z');
    k.wins(0,-0.4,1.1,1.9,0.18,1,0.6,'l',4,{ww:0.12,wh:0.38,lit:0.8});
    k.wins(0,-0.4,1.1,1.9,0.18,1,0.6,'r',4,{ww:0.12,wh:0.38,lit:0.8});
    k.box(0.56,1.65,0.56,0,0.03,0.75,white);
    k.box(0.6,0.06,0.6,0,0.85,0.75,blue);k.box(0.6,0.06,0.6,0,1.62,0.75,blue);
    for(const [dx,dz,ry] of [[0,0.281,0],[0,-0.281,0],[0.281,0,1],[-0.281,0,1]])k.box(ry?0.02:0.2,0.28,ry?0.2:0.02,dx,1.18,0.75+dz,'#3a2a20');
    k.hip(0.62,0.6,0.62,0,1.68,0.75,roof);
    k.box(0.035,0.3,0.035,0,2.26,0.75,'#d9b24a');k.box(0.17,0.035,0.035,0,2.43,0.75,'#d9b24a');
    k.box(0.24,0.44,0.02,0,0.03,1.035,C.wood);
    k.put(new THREE.CylinderGeometry(0.09,0.09,0.02,16),'#fff',0,0.66,1.036,{rx:Math.PI/2,m:'lit'});
    k.box(0.62,0.05,0.28,0,0.0,1.2,C.stone);
    tree(k,-0.72,1.15,0.8);tree(k,0.72,1.15,0.8);
  },
  casa(k,v){
    const walls=['#f2d9a6','#bfe0d2','#f6c6b2','#cfdcf2','#f4f1ea','#e8c7e0'],roofs=['#c0573e','#a8483a','#b86b45','#8f5a46'];
    const wall=walls[v%6],roof=roofs[(v*3+1)%4];
    k.box(0.94,0.02,0.94,0,0,0,'#86bd5c');
    if(v%2===0){
      k.box(0.6,0.4,0.5,0,0.02,-0.08,wall);k.gable(0.7,0.26,0.62,0,0.42,-0.08,roof,'x');
      k.box(0.12,0.24,0.02,-0.05,0.02,0.175,C.wood);
      k.box(0.12,0.12,0.02,0.16,0.16,0.176,'#fff',{m:'lit'});k.box(0.12,0.12,0.02,-0.22,0.16,0.176,'#fff',{m:v%3?'dark':'lit'});
      k.box(0.02,0.12,0.12,0.306,0.16,-0.08,'#fff',{m:'dark'});
      k.box(0.12,0.022,0.3,-0.05,0,0.33,'#d8cfbd');
    }else{
      k.box(0.52,0.4,0.62,-0.04,0.02,-0.05,wall);k.gable(0.62,0.26,0.72,-0.04,0.42,-0.05,roof,'z');
      k.box(0.12,0.24,0.02,-0.12,0.02,0.265,C.wood);
      k.box(0.12,0.12,0.02,0.09,0.16,0.266,'#fff',{m:'lit'});
      k.box(0.02,0.12,0.12,-0.306,0.16,-0.12,'#fff',{m:v%3?'lit':'dark'});
      k.box(0.12,0.022,0.2,-0.12,0,0.38,'#d8cfbd');
    }
    if(v%3===1){k.box(0.26,0.28,0.34,0.33,0.02,-0.04,wall);k.box(0.28,0.03,0.36,0.33,0.3,-0.04,'#8a8f96');k.box(0.2,0.2,0.02,0.33,0.02,0.135,'#d9d9d9')}
    if(v%4===2)k.box(0.08,0.22,0.08,-0.18,0.5,-0.22,'#9b5b45');
    if(v%3!==1)k.ball(0.1,0.36,0.12,0.34,'#3f8f3a');
  },
  predio(k,v,h){
    const f=clamp(h||6,3,16),fh=0.3,body=['#d9dde2','#eadcc6','#c8d6e4','#efe8dc'][v%4],trim=['#7f8b98','#a88f6a','#5f7f9e','#b08f7a'][v%4];
    k.box(1.94,0.03,1.94,0,0,0,C.walk);
    k.box(1.45,0.36,1.45,0,0.03,0,trim);
    k.box(1.0,0.24,0.02,0,0.07,0.735,'#9ccbe0',{m:'lit'});
    k.box(1.4,f*fh,1.4,0,0.39,0,body);
    for(const face of ['f','b','l','r'])k.wins(0,0,1.4,1.4,0.39,f,fh,face,4,{ww:0.18,wh:0.15,lit:0.55,spread:0.86});
    for(const [x,z] of [[-0.7,-0.7],[0.7,-0.7],[-0.7,0.7],[0.7,0.7]])k.box(0.07,f*fh,0.07,x,0.39,z,trim);
    k.box(1.5,0.08,1.5,0,0.39+f*fh,0,trim);
    k.box(0.45,0.28,0.35,0.3,0.47+f*fh,-0.3,'#e9ecef');k.box(0.3,0.16,0.3,-0.35,0.47+f*fh,0.25,'#b9c0c7');
    k.box(0.5,0.04,0.28,0,0.32,0.86,trim);
    tree(k,-0.78,0.8,0.6);tree(k,0.78,0.8,0.6);
  },
  praca(k){
    k.box(2.94,0.03,2.94,0,0,0,'#d8cfbd');
    for(const sx of [-1,1])for(const sz of [-1,1]){k.box(1.08,0.045,1.08,sx*0.84,0,sz*0.84,'#6fae4f');tree(k,sx*0.98,sz*0.98,0.95);k.ball(0.09,sx*0.55,0.1,sz*1.15,'#e86f9a');k.ball(0.09,sx*1.15,0.1,sz*0.55,'#f2c94c')}
    k.cyl(0.42,0.46,0.12,0,0.03,0,'#cfc6b4',18);
    k.cyl(0.36,0.36,0.02,0,0.12,0,'#5fb3e0',18,{m:'water'});
    k.cyl(0.05,0.07,0.32,0,0.12,0,'#cfc6b4',8);k.cyl(0.15,0.1,0.04,0,0.42,0,'#cfc6b4',12);
    k.ball(0.06,0,0.5,0,'#bfe6ff',{m:'water',det:1});
    for(const [x,z,ry] of [[0,-0.62,0],[0,0.62,0],[-0.62,0,1],[0.62,0,1]]){k.box(ry?0.09:0.3,0.05,ry?0.3:0.09,x,0.05,z,C.wood);k.box(ry?0.03:0.3,0.08,ry?0.3:0.03,x+(ry?Math.sign(x)*0.04:0),0.08,z+(ry?0:Math.sign(z)*0.04),C.wood)}
    for(const sx of [-1,1])for(const sz of [-1,1])lamp(k,sx*0.36,sz*0.36,0.5);
  },
  campo(k){
    k.box(3.94,0.03,2.94,0,0,0,'#5d9f4a');
    for(let i=0;i<8;i++)if(i%2)k.box(0.4375,0.035,2.5,-1.75+0.4375*(i+0.5),0,0.05,'#6cb556');
    const W='#ffffff',y=0.036,m='sign';
    k.box(3.5,0.005,0.03,0,y,-1.2,W,{m});k.box(3.5,0.005,0.03,0,y,1.3,W,{m});k.box(0.03,0.005,2.5,-1.75,y,0.05,W,{m});k.box(0.03,0.005,2.5,1.75,y,0.05,W,{m});k.box(0.03,0.005,2.5,0,y,0.05,W,{m});
    k.put(new THREE.RingGeometry(0.3,0.33,30),W,0,0.04,0.05,{rx:-Math.PI/2,m});
    for(const sx of [-1,1]){k.box(0.03,0.005,0.9,sx*1.35,y,0.05,W,{m});k.box(0.4,0.005,0.03,sx*1.55,y,-0.4,W,{m});k.box(0.4,0.005,0.03,sx*1.55,y,0.5,W,{m});
      const x=sx*1.78;k.cyl(0.012,0.012,0.22,x,0.03,-0.22,W,6);k.cyl(0.012,0.012,0.22,x,0.03,0.32,W,6);k.box(0.024,0.024,0.56,x,0.24,0.05,W)}
    k.box(2.4,0.07,0.07,0,0.03,-1.27,'#cfd5dc');k.box(2.4,0.14,0.07,0,0.03,-1.34,'#c3cad3');k.box(2.4,0.21,0.07,0,0.03,-1.41,'#b7bfc9');
    for(const sx of [-1,1])for(const sz of [-1,1]){k.cyl(0.02,0.026,1.0,sx*1.88,0.03,sz*1.4,C.dark,6);k.box(0.18,0.08,0.05,sx*1.88,1.02,sz*1.4,'#fff6d5',{m:'lamp'})}
  },
  arvore(k,v){
    if(v===1){k.cyl(0.035,0.05,0.2,0,0,0,C.trunk,6);k.cone(0.27,0.4,0,0.16,0,'#2f7a43',7);k.cone(0.21,0.34,0,0.38,0,'#358a4a',7);k.cone(0.14,0.28,0,0.6,0,'#3d9a52',7);return}
    const crown=v===2?['#e9c13b','#f2d35c']:v===3?['#b25bb8','#c77fd0']:[C.leaf,C.leaf2];
    k.cyl(0.035,0.055,v>=2?0.38:0.3,0,0,0,C.trunk,6);
    k.ball(0.26,0,v>=2?0.56:0.48,0,crown[0]);k.ball(0.16,0.12,v>=2?0.7:0.62,0.05,crown[1]);k.ball(0.13,-0.12,v>=2?0.62:0.54,-0.06,crown[1]);
  },
  lago(k){
    k.put(new THREE.CylinderGeometry(1.44,1.44,0.03,24),'#d8c891',0,0.015,0,{sz:0.92});
    k.put(new THREE.CylinderGeometry(1.26,1.26,0.03,24),'#3f8fc9',0,0.03,0,{sz:0.9,m:'water'});
    for(const [x,z,r] of [[1.15,0.45,0.1],[1.0,0.7,0.07],[-1.2,-0.3,0.09],[0.3,-1.2,0.08]])k.ball(r,x,0.05,z,'#9aa0a6',{det:0});
    for(const [x,z] of [[-0.9,0.75],[-1.05,0.6],[-0.8,0.9],[1.05,-0.6],[0.95,-0.78]])k.cyl(0.008,0.012,0.25,x,0.03,z,'#5b8a3a',4);
    for(const [x,z] of [[0.4,0.3],[0.55,0.15],[-0.3,-0.4]])k.cyl(0.07,0.07,0.006,x,0.046,z,'#4f9e46',10);
    k.box(0.16,0.03,0.72,-0.45,0.07,0.85,'#9b6b43');for(const z of [0.55,1.15])for(const x of [-0.52,-0.38])k.cyl(0.015,0.015,0.09,x,0,z,'#6d4a2e',5);
  },
  lavoura(k,v){
    k.box(2.94,0.04,2.94,0,0,0,'#8a5a3b');
    const rows=8,sp=2.7/rows;
    for(let i=0;i<rows;i++){
      const z=-1.35+sp*(i+0.5);
      if(v===1){k.box(2.7,0.26,0.14,0,0.04,z,'#9bbf3c');k.box(2.7,0.03,0.06,0,0.3,z,'#d9c45a')}
      else if(v===2){for(let j=0;j<9;j++)k.ball(0.13,-1.3+j*0.325,0.17,z,'#2f6f3a')}
      else if(v===3)k.box(2.7,0.42,0.17,0,0.04,z,'#8cc152');
      else k.box(2.7,0.09,0.2,0,0.04,z,'#5c9e3a');
    }
    for(const sx of [-1,1])for(const sz of [-1,1])k.cyl(0.015,0.015,0.16,sx*1.43,0.04,sz*1.43,'#8b6b4a',4);
  }
};
// Rua: encaixa sozinha nas vizinhas (máscara N=1, L=2, S=4, O=8)
function roadKit(k,mask,poste){
  k.box(1,0.03,1,0,0,0,'#50565d');
  const walk='#c9c4ba',sides=[[1,0,-0.42,true],[2,0.42,0,false],[4,0,0.42,true],[8,-0.42,0,false]];
  for(const [bit,x,z,horiz] of sides)if(!(mask&bit))k.box(horiz?1:0.16,0.05,horiz?0.16:1,x,0,z,walk);
  for(const [a,b,x,z] of [[1,2,0.42,-0.42],[2,4,0.42,0.42],[4,8,-0.42,0.42],[8,1,-0.42,-0.42]])if((mask&a)&&(mask&b))k.box(0.16,0.05,0.16,x,0,z,walk);
  const links=[[1,0,-1],[2,1,0],[4,0,1],[8,-1,0]].filter(([b])=>mask&b);
  if(links.length&&links.length<=2)for(const [,dx,dz] of links)for(const o of [0.14,0.38])k.box(dx?0.15:0.045,0.004,dz?0.15:0.045,dx*o,0.03,dz*o,'#f2c94c');
  if(poste){const free=sides.find(([b])=>!(mask&b));if(free){const [,x,z,horiz]=free;const px=horiz?0.38:x*1.05,pz=horiz?z*1.05:0.38;lamp(k,px,pz,0.55)}}
}
const MODEL_CACHE=new Map();
function modelGeo(mk){
  let g=MODEL_CACHE.get(mk);if(g)return g;
  const [t,a,b]=mk.split(':'),k=new Kit(rng(hash(mk)));
  if(t==='rua')roadKit(k,+a,b==='1');else if(t==='carro')vehicle(k,'car',a);else MODELS[t](k,+a||0,+b||0);
  g=k.build();g.height=g.solid?g.solid.boundingBox.max.y:0.3;MODEL_CACHE.set(mk,g);return g;
}

// ---------------------------------------------------------------- Cena
const canvas=$('#c3d');
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'})}
catch(err){console.error(err);$('#loading').innerHTML='<div class="glass"><div class="em">😕</div><h2>Este aparelho não mostra 3D</h2><p>O navegador não liberou o WebGL. Tente atualizar o navegador ou abrir em outro aparelho.</p></div>';throw err}
renderer.setPixelRatio(Math.min(devicePixelRatio||1,TOUCHY?1.75:2));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(40,1,0.1,600);
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;controls.dampingFactor=0.09;controls.minDistance=4;controls.maxDistance=80;
controls.maxPolarAngle=1.38;controls.minPolarAngle=0.08;controls.screenSpacePanning=false;controls.zoomToCursor=true;controls.rotateSpeed=0.7;
const HOME={r:50,phi:0.92,theta:Math.PI/4};
function setSph(r,phi,theta){const s=new THREE.Spherical(r,phi,theta);camera.position.setFromSpherical(s).add(controls.target)}
setSph(HOME.r,HOME.phi,HOME.theta);controls.update();

const M={
  solid:new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.86,metalness:0,flatShading:true}),
  lit:new THREE.MeshStandardMaterial({color:0x3b5876,roughness:0.3,metalness:0.15,emissive:0xffc46b,emissiveIntensity:0}),
  dark:new THREE.MeshStandardMaterial({color:0x34506d,roughness:0.3,metalness:0.15}),
  sign:new THREE.MeshBasicMaterial({vertexColors:true}),
  lamp:new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.5,emissive:0xffdf9a,emissiveIntensity:0}),
  water:new THREE.MeshStandardMaterial({color:0x3f8fc9,roughness:0.12,metalness:0.25,transparent:true,opacity:0.92})
};
const hemi=new THREE.HemisphereLight(0xdff1ff,0x6b8f4e,1.0);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xfff1d6,2.4);sun.position.set(-18,32,14);sun.castShadow=true;
sun.shadow.mapSize.set(TOUCHY?1024:2048,TOUCHY?1024:2048);
Object.assign(sun.shadow.camera,{left:-27,right:27,top:27,bottom:-27,near:1,far:100});sun.shadow.bias=-0.0004;sun.shadow.normalBias=0.03;
scene.add(sun,sun.target);

// Céu em degradê, estrelas e nuvens
const skyU={top:{value:new THREE.Color()},bot:{value:new THREE.Color()}};
const sky=new THREE.Mesh(new THREE.SphereGeometry(400,24,12),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,uniforms:skyU,
  vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'uniform vec3 top;uniform vec3 bot;varying vec3 vP;void main(){float h=normalize(vP).y;gl_FragColor=vec4(mix(bot,top,smoothstep(-0.02,0.55,h)),1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'}));
scene.add(sky);
const stars=(()=>{const n=600,a=new Float32Array(n*3),r=rng(9);for(let i=0;i<n;i++){const th=r()*Math.PI*2,ph=Math.acos(r()*0.95),R=380;a[i*3]=R*Math.sin(ph)*Math.cos(th);a[i*3+1]=R*Math.cos(ph);a[i*3+2]=R*Math.sin(ph)*Math.sin(th)}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(a,3));return new THREE.Points(g,new THREE.PointsMaterial({color:0xffffff,size:1.8,sizeAttenuation:false,transparent:true,opacity:0,fog:false,depthWrite:false}))})();
scene.add(stars);
scene.fog=new THREE.Fog(0xcfeaf7,90,230);
const cloudMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true,transparent:true,opacity:0.94,depthWrite:false});
const clouds=[];let cloudOpacity=0.94;
{const r=rng(4);for(let i=0;i<8;i++){const parts=[];const n=3+Math.floor(r()*3);for(let j=0;j<n;j++){const g=new THREE.IcosahedronGeometry(1.2+r()*1.1,1);g.translate(j*1.5-n*0.7,r()*0.6,(r()-0.5)*1.4);if(g.index)parts.push(g.toNonIndexed());else parts.push(g)}
  const geo=new THREE.BufferGeometry();let cnt=0;for(const p of parts)cnt+=p.attributes.position.count;const pos=new Float32Array(cnt*3),nor=new Float32Array(cnt*3);let o=0;for(const p of parts){pos.set(p.attributes.position.array,o*3);nor.set(p.attributes.normal.array,o*3);o+=p.attributes.position.count}
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('normal',new THREE.BufferAttribute(nor,3));
  const m=new THREE.Mesh(geo,cloudMat.clone());m.position.set((r()-0.5)*110,24+r()*8,(r()-0.5)*90);m.scale.setScalar(0.9+r()*0.7);m.userData.v=0.5+r()*0.6;scene.add(m);clouds.push(m)}}

// Maquete: base de terra com gramado em cima e um chão ao redor
const base=new THREE.Group();scene.add(base);
{const S=N+0.8;
  const top=new THREE.Mesh(new THREE.BoxGeometry(S,0.16,S),[0x6fa84c,0x6fa84c,0x86bd5c,0x6fa84c,0x6fa84c,0x6fa84c].map(c=>new THREE.MeshStandardMaterial({color:c,roughness:0.95})));top.position.y=-0.08;top.receiveShadow=true;base.add(top);
  const earth=new THREE.Mesh(new THREE.BoxGeometry(S,1.3,S),new THREE.MeshStandardMaterial({color:0x8a6a48,roughness:1}));earth.position.y=-0.81;base.add(earth);
  const rock=new THREE.Mesh(new THREE.BoxGeometry(S-0.4,0.5,S-0.4),new THREE.MeshStandardMaterial({color:0x6f5a45,roughness:1}));rock.position.y=-1.66;base.add(rock);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(900,900),new THREE.MeshStandardMaterial({color:0x9db98a,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-1.9;floor.receiveShadow=true;scene.add(floor);base.userData.floor=floor;
}
const gridLines=(()=>{const a=[];for(let i=0;i<=N;i++){const p=i-N/2;a.push(-N/2,0.045,p,N/2,0.045,p,p,0.045,-N/2,p,0.045,N/2)}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(a,3));return new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false}))})();
scene.add(gridLines);
const hoverTile=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.35,depthWrite:false}));hoverTile.rotation.x=-Math.PI/2;hoverTile.visible=false;scene.add(hoverTile);
const selRing=new THREE.Group();scene.add(selRing);
const selMat=new THREE.MeshBasicMaterial({color:0xD7A93E,transparent:true,opacity:0.9,depthWrite:false});
{const ac=getComputedStyle(document.documentElement).getPropertyValue('--gold').trim();if(/^#[0-9a-f]{6}$/i.test(ac))selMat.color.set(ac)}

// Construções do mesmo modelo dividem uma malha (instanciada): poucas chamadas de desenho, roda liso no celular.
const _m4=new THREE.Matrix4(),_q=new THREE.Quaternion(),_v=new THREE.Vector3(),_s=new THREE.Vector3(),_up=new THREE.Vector3(0,1,0);
class Batch{
  constructor(mk){this.mk=mk;this.geo=modelGeo(mk);this.ids=[];this.index=new Map();this.meshes=[];this.cap=0;this.grow(4)}
  grow(cap){
    const old=this.meshes,n=this.ids.length;this.meshes=[];
    for(const layer of LAYERS){const g=this.geo[layer];if(!g)continue;
      const im=new THREE.InstancedMesh(g,M[layer],cap);im.count=n;im.frustumCulled=false;im.castShadow=layer==='solid';im.receiveShadow=layer==='solid';im.userData={batch:this,layer};
      const o=old.find(x=>x.userData.layer===layer);if(o&&n)im.instanceMatrix.array.set(o.instanceMatrix.array.subarray(0,n*16));
      this.meshes.push(im);scene.add(im)}
    for(const o of old){scene.remove(o);o.dispose()}
    this.cap=cap;
  }
  touch(){for(const m of this.meshes){m.count=this.ids.length;m.instanceMatrix.needsUpdate=true;m.boundingSphere=null;m.boundingBox=null}}
  add(id,mx){if(this.ids.length>=this.cap)this.grow(this.cap*2);const i=this.ids.length;this.ids.push(id);this.index.set(id,i);for(const m of this.meshes)m.setMatrixAt(i,mx);this.touch()}
  set(id,mx){const i=this.index.get(id);if(i==null)return;for(const m of this.meshes)m.setMatrixAt(i,mx);this.touch()}
  remove(id){const i=this.index.get(id);if(i==null)return;const last=this.ids.length-1;
    if(i!==last){const lid=this.ids[last];this.ids[i]=lid;this.index.set(lid,i);for(const m of this.meshes){m.getMatrixAt(last,_m4);m.setMatrixAt(i,_m4)}}
    this.ids.pop();this.index.delete(id);this.touch()}
}
const batches=new Map();
const batchFor=mk=>{let b=batches.get(mk);if(!b){b=new Batch(mk);batches.set(mk,b)}return b};

// ---------------------------------------------------------------- Estado e nuvem
let remote=new Map(),pending=[],inflight=null,items=new Map(),meta={updatedAt:'',updatedBy:''};
let cloudOk=false,loadedOnce=false,saveTimer=0,retryMs=1500,saveError='';
const occ=new Map(),tk=(x,z)=>x*100+z;
const undoStack=[],redoStack=[];
function dims(t,r){const d=T[t];return r%2?[d.d,d.w]:[d.w,d.d]}
function cleanItem(i){
  if(!i||typeof i!=='object'||!T[i.t])return null;
  const id=String(i.id||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,40);if(!id)return null;
  const r=(Math.round(+i.r)||0)&3,[W,D]=dims(i.t,r),x=Math.round(+i.x),z=Math.round(+i.z);
  if(!(x>=0&&z>=0&&x+W<=N&&z+D<=N))return null;
  const o={id,t:i.t,x,z,r};
  if(T[i.t].vars)o.v=clamp(Math.round(+i.v)||0,0,T[i.t].vars-1);
  if(T[i.t].floors)o.h=clamp(Math.round(+i.h)||6,3,16);
  if(i.n)o.n=String(i.n).replace(/\s+/g,' ').trim().slice(0,40);if(!o.n)delete o.n;
  if(i.by)o.by=String(i.by).slice(0,60);
  if(i.at&&!isNaN(Date.parse(i.at)))o.at=String(i.at).slice(0,30);
  return o;
}
const cleanList=a=>(Array.isArray(a)?a:[]).map(cleanItem).filter(Boolean);
function view(){const m=new Map(remote);for(const op of [...(inflight||[]),...pending])op.item?m.set(op.id,op.item):m.delete(op.id);return m}
function rebuildOcc(){occ.clear();for(const it of items.values()){const [W,D]=dims(it.t,it.r);for(let i=0;i<W;i++)for(let j=0;j<D;j++)occ.set(tk(it.x+i,it.z+j),it.id)}}
function fits(t,x,z,r,ignore){const [W,D]=dims(t,r);if(x<0||z<0||x+W>N||z+D>N)return false;for(let i=0;i<W;i++)for(let j=0;j<D;j++){const o=occ.get(tk(x+i,z+j));if(o&&o!==ignore)return false}return true}
const isRoad=(x,z)=>{const id=occ.get(tk(x,z));return !!id&&items.get(id)?.t==='rua'};
function roadMask(x,z){return (isRoad(x,z-1)?1:0)|(isRoad(x+1,z)?2:0)|(isRoad(x,z+1)?4:0)|(isRoad(x-1,z)?8:0)}
function modelKey(it){
  if(it.t==='rua'){const m=roadMask(it.x,it.z);return 'rua:'+m+':'+(((it.x*7+it.z*3)%5===0&&m!==15)?1:0)}
  return it.t+':'+(it.v|0)+':'+(it.t==='predio'?(it.h||6):0);
}
function center(it){const [W,D]=dims(it.t,it.r);return [it.x+W/2-N/2,it.z+D/2-N/2]}

function setStatus(){
  const el=$('#status');let cls='',txt='';
  if(!loadedOnce&&!cloudOk){cls='view';txt='Conectando…'}
  else if(saveError){cls='err';txt=saveError}
  else if(inflight||pending.length){cls='saving';txt='Salvando…'}
  else if(!CAN_EDIT){cls='view';txt='Só visualização'}
  else{cls='';txt=cloudOk?'Salvo na nuvem':'Salvo neste aparelho'}
  el.className='chip '+cls;el.querySelector('span').textContent=txt;
  el.title=CAN_EDIT?'As mudanças são salvas sozinhas e aparecem para todo mundo':'Só o prefeito, o vice e quem tem acesso total podem editar o mapa';
}
function cacheLocal(){ls.set(CACHE_KEY,JSON.stringify({items:[...remote.values()],...meta}))}
function savePendingLocal(){if(!CAN_EDIT)return;const all=[...(inflight||[]),...pending];all.length?ls.set(PEND_KEY,JSON.stringify(all)):ls.del(PEND_KEY)}
function scheduleFlush(ms=650){clearTimeout(saveTimer);saveTimer=setTimeout(flush,ms)}
let docRef=null,fsDb=null;
async function flush(){
  if(!docRef||inflight||!pending.length||!CAN_EDIT)return;
  // Manda em partes quando há muita remoção de uma vez (desfazer uma cidade modelo, recomeçar).
  let dels=0,cut=pending.length;
  for(let i=0;i<pending.length;i++){if(!pending[i].item&&++dels>MAX_DEL_POR_ENVIO){cut=i;break}}
  inflight=pending.slice(0,cut);pending=pending.slice(cut);setStatus();
  try{
    await fsDb.runTransaction(async tx=>{
      const s=await tx.get(docRef),cur=new Map(cleanList(s.exists?s.data().items:[]).map(i=>[i.id,i]));
      for(const op of inflight)op.item?cur.set(op.id,op.item):cur.delete(op.id);
      tx.set(docRef,{items:[...cur.values()].slice(0,MAX_ITEMS),updatedAt:new Date().toISOString(),updatedBy:WHO,cityKey:CITY_KEY,schemaVersion:1});
    });
    for(const op of inflight)op.item?remote.set(op.id,op.item):remote.delete(op.id);
    meta={updatedAt:new Date().toISOString(),updatedBy:WHO};
    inflight=null;saveError='';retryMs=1500;cacheLocal();savePendingLocal();setStatus();updSummary();
    if(pending.length)scheduleFlush(120);
  }catch(err){
    console.error('Projeção 3D: falha ao salvar',err);
    pending=inflight.concat(pending);inflight=null;savePendingLocal();
    saveError=err?.code==='permission-denied'?'Sem permissão para salvar':'Sem conexão · tentando de novo';setStatus();
    scheduleFlush(retryMs);retryMs=Math.min(retryMs*2,30000);
  }
}
async function initCloud(){
  try{
    if(!window.firebase)throw new Error('Firebase não carregou');
    if(!firebase.apps.length)firebase.initializeApp(FIREBASE_CONFIG);
    const auth=firebase.auth(),fs=firebase.firestore();
    if(!auth.currentUser)await auth.signInAnonymously();
    fsDb=fs;docRef=fs.collection('cidade3d_v1').doc(CITY_KEY);
    docRef.onSnapshot(s=>{
      const d=s.exists?s.data():null,first=!loadedOnce;
      remote=new Map(cleanList(d?.items).map(i=>[i.id,i]));meta={updatedAt:String(d?.updatedAt||''),updatedBy:String(d?.updatedBy||'')};
      cloudOk=true;loadedOnce=true;cacheLocal();refresh({intro:first&&!hadCache});setStatus();
      if(pending.length)scheduleFlush(200);
    },err=>{console.error('Projeção 3D: leitura',err);cloudOk=false;saveError=err?.code==='permission-denied'?'Sem permissão':'Sem conexão';setStatus();if(!loadedOnce){loadedOnce=true;refresh()}});
  }catch(err){console.error('Projeção 3D: nuvem',err);saveError='Sem conexão';loadedOnce=true;setStatus();refresh()}
}

// Uma mudança do usuário: aplica na hora, guarda para enviar e entra no desfazer.
function apply(changes,{record=true,anim=true,intro=false}={}){
  if(!CAN_EDIT||!changes.length)return;
  for(const c of changes)pending.push({id:c.id,item:c.after?{...c.after}:null});
  savePendingLocal();scheduleFlush();refresh({anim,intro});
  if(record){undoStack.push(changes);if(undoStack.length>100)undoStack.shift();redoStack.length=0}
  updUndo();
}
function doUndo(){const g=undoStack.pop();if(!g)return;const devolveu=g.fin?.id?devolver(g.fin.id):false;if(g.fin)g.fin.id='';apply(g.map(c=>({id:c.id,before:c.after,after:c.before})).reverse(),{record:false});redoStack.push(g);updUndo();toast(devolveu?`Desfeito: ${fmtR(g.fin.valor)} voltaram ao saldo`:'Desfeito')}
function doRedo(){const g=redoStack.pop();if(!g)return;if(g.fin){const r=cobrar(g.fin.desc,g.fin.valor);if(!r.ok){redoStack.push(g);avisoCobranca(r);return}g.fin.id=r.id}apply(g,{record:false});undoStack.push(g);updUndo();toast('Refeito')}
function updUndo(){$('#undoBtn').disabled=!undoStack.length;$('#redoBtn').disabled=!redoStack.length}

// ---------------------------------------------------------------- Cena ← estado
const objs=new Map(); // id → {batch, mk, it, h}
const anims=new Map(); // id → {t0,dur,out,delay}
function baseMatrix(it,scaleY=1,lift=0,scaleXZ=1){const [cx,cz]=center(it);_q.setFromAxisAngle(_up,it.t==='rua'?0:it.r*Math.PI/2);_s.set(scaleXZ,scaleY,scaleXZ);_v.set(cx,lift,cz);return _m4.compose(_v,_q,_s)}
let selId=null,introPending=false;
function refresh({anim=true,intro=false}={}){
  items=view();rebuildOcc();
  const now=performance.now(),animate=anim&&!REDUCED&&loadedOnce;
  for(const [id,o] of objs)if(!items.has(id)&&!o.dying){
    if(animate){o.dying=true;anims.set(id,{t0:now,dur:220,out:true})}else{o.batch.remove(id);objs.delete(id)}
  }
  for(const it of items.values()){
    const mk=modelKey(it),o=objs.get(it.id);
    if(o&&o.dying){o.batch.remove(it.id);objs.delete(it.id);anims.delete(it.id)}
    const cur=objs.get(it.id);
    if(cur&&cur.mk===mk){if(cur.it!==it&&JSON.stringify(cur.it)!==JSON.stringify(it)){cur.it=it;cur.batch.set(it.id,baseMatrix(it,1,it.id===selId?0.05:0))}else cur.it=it;continue}
    const isNew=!cur;if(cur)cur.batch.remove(it.id);
    const b=batchFor(mk);
    let a=null;
    if(intro&&!REDUCED){const [cx,cz]=center(it);a={t0:now,dur:520,delay:Math.min(1400,Math.hypot(cx,cz)*45+Math.random()*120)}}
    else if(isNew&&animate&&it.t!=='rua')a={t0:now,dur:420};
    else if(isNew&&animate)a={t0:now,dur:180};
    b.add(it.id,baseMatrix(it,a?0.001:1,it.id===selId?0.05:0));
    objs.set(it.id,{batch:b,mk,it,h:b.geo.height});
    if(a)anims.set(it.id,a);
  }
  if(selId&&!items.has(selId))select(null);
  updCars();updSummary();updEmpty();updLabels(true);
  if(selId)renderCard();
}
function stepAnims(now){
  for(const [id,a] of anims){const o=objs.get(id);if(!o){anims.delete(id);continue}
    const t=clamp((now-a.t0-(a.delay||0))/a.dur,0,1);
    if(a.out){const s=1-ease(t);o.batch.set(id,baseMatrix(o.it,Math.max(0.001,s),0,0.6+0.4*s));if(t>=1){o.batch.remove(id);objs.delete(id);anims.delete(id)}}
    else{const s=a.dur>300?easeBack(t):ease(t);o.batch.set(id,baseMatrix(o.it,Math.max(0.001,s),id===selId?0.05:0,0.85+0.15*Math.min(1,s)));if(t>=1)anims.delete(id)}
  }
}

// Carrinhos andando pelas ruas (mão inglesa não: aqui é pela direita)
const CAR_COLORS=['#d64541','#3d7dd8','#f2f2f2','#2b2f36','#e0a526','#4caf7a','#9b59b6'];
const cars=[];const carGroup=new THREE.Group();scene.add(carGroup);
function carMesh(col){const g=modelGeo('carro:'+col),grp=new THREE.Group();for(const l of LAYERS)if(g[l]){const m=new THREE.Mesh(g[l],M[l]);m.castShadow=l==='solid';grp.add(m)}return grp}
function roadNbs(x,z){const out=[];for(const [dx,dz] of [[0,-1],[1,0],[0,1],[-1,0]])if(isRoad(x+dx,z+dz))out.push([x+dx,z+dz]);return out}
function spawnCar(c){
  const roads=[...items.values()].filter(i=>i.t==='rua'&&roadNbs(i.x,i.z).length);if(!roads.length)return false;
  const r=roads[Math.floor(Math.random()*roads.length)],nb=roadNbs(r.x,r.z);
  Object.assign(c,{cur:[r.x,r.z],next:nb[Math.floor(Math.random()*nb.length)],t:Math.random(),yaw:null});c.g.visible=true;return true;
}
function updCars(){
  const roadCount=[...items.values()].filter(i=>i.t==='rua').length,want=REDUCED?0:Math.min(TOUCHY?16:28,Math.floor(roadCount/6));
  while(cars.length>want){const c=cars.pop();carGroup.remove(c.g)}
  while(cars.length<want){const c={g:carMesh(CAR_COLORS[cars.length%CAR_COLORS.length]),speed:0.8+Math.random()*0.7};carGroup.add(c.g);cars.push(c);if(!spawnCar(c)){c.g.visible=false}}
}
function stepCars(dt){
  for(const c of cars){
    if(!c.cur||!isRoad(...c.cur)||!isRoad(...c.next)){if(!spawnCar(c)){c.g.visible=false;continue}}
    c.t+=dt*c.speed;
    while(c.t>=1){c.t-=1;const prev=c.cur;c.cur=c.next;let nb=roadNbs(...c.cur).filter(n=>n[0]!==prev[0]||n[1]!==prev[1]);if(!nb.length)nb=[prev];c.next=nb[Math.floor(Math.random()*nb.length)]}
    const ax=c.cur[0]+0.5-N/2,az=c.cur[1]+0.5-N/2,dx=c.next[0]-c.cur[0],dz=c.next[1]-c.cur[1];
    const tx=ax+dx*c.t-dz*0.2,tz=az+dz*c.t+dx*0.2,yaw=Math.atan2(dx,dz);
    if(c.yaw==null){c.yaw=yaw;c.g.position.set(tx,0.03,tz)}
    let d=yaw-c.yaw;d=Math.atan2(Math.sin(d),Math.cos(d));c.yaw+=d*Math.min(1,dt*9);
    c.g.position.x=lerp(c.g.position.x,tx,Math.min(1,dt*12));c.g.position.z=lerp(c.g.position.z,tz,Math.min(1,dt*12));c.g.position.y=0.03;
    c.g.rotation.y=c.yaw;
  }
}

// ---------------------------------------------------------------- Dia e noite
let night=(()=>{const v=ls.get(NIGHT_KEY);if(v==='1')return 1;if(v==='0')return 0;const h=new Date().getHours();return h>=19||h<6?1:0})(),nightT=night;
const COL={dayTop:new THREE.Color('#4f9fe0'),dayBot:new THREE.Color('#cfeaf7'),nightTop:new THREE.Color('#0a1736'),nightBot:new THREE.Color('#2b4170'),
  sunDay:new THREE.Color('#fff1d6'),sunNight:new THREE.Color('#8fa8ff'),hemiDay:new THREE.Color('#dff1ff'),hemiNight:new THREE.Color('#6f86c4'),floorDay:new THREE.Color('#9db98a'),floorNight:new THREE.Color('#3b5466')};
function applyNight(t){
  skyU.top.value.copy(COL.dayTop).lerp(COL.nightTop,t);skyU.bot.value.copy(COL.dayBot).lerp(COL.nightBot,t);
  scene.fog.color.copy(skyU.bot.value);
  hemi.intensity=lerp(1.0,0.62,t);hemi.color.copy(COL.hemiDay).lerp(COL.hemiNight,t);
  sun.intensity=lerp(2.4,0.95,t);sun.color.copy(COL.sunDay).lerp(COL.sunNight,t);sun.position.set(lerp(-18,16,t),lerp(32,26,t),lerp(14,-12,t));
  M.lit.emissiveIntensity=t*1.9;M.lamp.emissiveIntensity=t*2.6;M.water.color.setHex(0x3f8fc9).lerp(new THREE.Color('#1c3a66'),t);
  stars.material.opacity=Math.max(0,t*1.1-0.1);cloudOpacity=lerp(0.94,0.32,t);cloudMat.color.setHex(0xffffff).lerp(new THREE.Color('#6d80a8'),t);
  base.userData.floor.material.color.copy(COL.floorDay).lerp(COL.floorNight,t);
  renderer.toneMappingExposure=lerp(1.05,1.3,t);
  document.body.classList.toggle('night',t>0.5);
  document.querySelector('meta[name=theme-color]').content=t>0.5?'#0b1730':'#0B2E59';
}
applyNight(nightT);
$('#nightBtn').textContent=night?'☀️':'🌙';
$('#nightBtn').onclick=()=>{night=night?0:1;ls.set(NIGHT_KEY,String(night));$('#nightBtn').textContent=night?'☀️':'🌙';if(REDUCED){nightT=night;applyNight(nightT)}};

// ---------------------------------------------------------------- Câmera
let camTween=null;
function camTo({r,phi,theta,target},dur=700){
  const s=new THREE.Spherical().setFromVector3(_v.copy(camera.position).sub(controls.target));
  const to={r:r??s.radius,phi:phi??s.phi,theta:theta??s.theta,target:(target||controls.target).clone()};
  let dth=to.theta-s.theta;dth=Math.atan2(Math.sin(dth),Math.cos(dth));
  const from={r:s.radius,phi:s.phi,theta:s.theta,target:controls.target.clone()};
  if(REDUCED||dur<=0){controls.target.copy(to.target);setSph(clamp(to.r,controls.minDistance,controls.maxDistance),to.phi,from.theta+dth);controls.update();return}
  camTween={from,to:{...to,theta:from.theta+dth},t0:performance.now(),dur};
}
function stepCam(now){
  if(!camTween)return;const k=ease(clamp((now-camTween.t0)/camTween.dur,0,1)),f=camTween.from,t=camTween.to;
  controls.target.lerpVectors(f.target,t.target,k);setSph(clamp(lerp(f.r,t.r,k),controls.minDistance,controls.maxDistance),lerp(f.phi,t.phi,k),lerp(f.theta,t.theta,k));
  if(k>=1)camTween=null;
}
function curSph(){return new THREE.Spherical().setFromVector3(_v.copy(camera.position).sub(controls.target))}
document.querySelectorAll('[data-cam]').forEach(b=>b.onclick=()=>{
  const s=curSph(),k=b.dataset.cam;
  if(k==='in')camTo({r:s.radius*0.72},380);else if(k==='out')camTo({r:s.radius*1.38},380);
  else if(k==='left')camTo({theta:s.theta-Math.PI/4},520);else if(k==='right')camTo({theta:s.theta+Math.PI/4},520);
  else if(k==='top')camTo({phi:s.phi<0.3?HOME.phi:0.09},650);else if(k==='home')camTo({...HOME,target:new THREE.Vector3()},800);
});
function focusItem(id){const it=items.get(id);if(!it)return;const [cx,cz]=center(it),[W,D]=dims(it.t,it.r);camTo({target:new THREE.Vector3(cx,0,cz),r:clamp(Math.max(W,D)*3.2+4,6,22),phi:Math.min(curSph().phi,1.0)},750)}
controls.addEventListener('start',()=>{camTween=null});
controls.addEventListener('change',()=>{const t=controls.target;const cx=clamp(t.x,-N/2,N/2),cz=clamp(t.z,-N/2,N/2);if(cx!==t.x||cz!==t.z||t.y!==0){const dx=cx-t.x,dz=cz-t.z;t.set(cx,0,cz);camera.position.x+=dx;camera.position.z+=dz}});

// ---------------------------------------------------------------- Ferramentas
let tool='ver',place=null,ghostTile=null,moveId=null,stroke=null,hoverId=null;
const ghost=new THREE.Group();ghost.visible=false;scene.add(ghost);
const ghostMat=new THREE.MeshBasicMaterial({color:0x35d07f,transparent:true,opacity:0.5,depthWrite:false});
const ghostPad=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0x35d07f,transparent:true,opacity:0.35,depthWrite:false}));ghostPad.rotation.x=-Math.PI/2;ghostPad.position.y=0.05;
let ghostMk='';
function ghostItem(){if(!place||!ghostTile)return null;const it={id:moveId||'ghost',t:place.t,x:ghostTile[0],z:ghostTile[1],r:place.r||0,v:place.v,h:place.h};return it}
function updGhost(){
  const it=ghostItem();if(!it){ghost.visible=false;updHint();return}
  const mk=modelKey({...it,t:it.t==='rua'?'casa':it.t});
  if(mk!==ghostMk){ghost.clear();ghostMk=mk;const g=modelGeo(mk);for(const l of LAYERS)if(g[l])ghost.add(new THREE.Mesh(g[l],ghostMat));ghost.add(ghostPad)}
  const cabe=fits(it.t,it.x,it.z,it.r,moveId),pode=tool==='mover'||!temCaixa()||price(it)<=saldoAtual,ok=cabe&&pode;const col=ok?0x35d07f:0xff4d4d;ghostMat.color.setHex(col);ghostPad.material.color.setHex(col);
  const [W,D]=dims(it.t,it.r);const [cx,cz]=center(it);ghost.position.set(cx,0.02,cz);ghost.rotation.y=it.r*Math.PI/2;
  ghostPad.scale.set(it.r%2?D:W,it.r%2?W:D,1);ghost.visible=true;ghost.userData.ok=ok;updHint();
}
function setTool(t){
  tool=t;if(t!=='construir'&&t!=='mover'){place=null;ghostTile=null;ghost.visible=false}
  if(t!=='mover')moveId=null;
  document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===(t==='mover'?'ver':t)));
  $('#catalog').classList.toggle('hidden',t!=='construir');document.body.classList.toggle('has-sheet',t==='construir');
  if(t==='construir')renderCatalog();
  const paint=t==='rua'||t==='demolir';controls.enableRotate=!paint;
  controls.mouseButtons.LEFT=paint?-1:THREE.MOUSE.ROTATE;
  hoverTile.visible=false;hoverTile.material.color.setHex(t==='demolir'?0xff4d4d:0x9fb4c8);
  if(t!=='ver'&&t!=='mover')select(null);
  canvas.style.cursor=t==='ver'?'grab':'crosshair';
  updHint();
}
function pickPlace(t){
  const d=T[t],prev=place?.t===t?place:null;
  catSel=d.cat;
  place={t,r:prev?.r||0,v:d.rand?Math.floor(Math.random()*(d.vars||1)):prev?.v||0,h:d.floors?(prev?.h||4+Math.floor(Math.random()*6)):undefined};
  ghostMk='';updGhost();renderCatalog();updHint();
}
function updHint(){
  const el=$('#hint');let html='';
  const touchNote=lastPointer==='touch';
  if(tool==='construir'&&place){const d=T[place.t];
    const pr=precoTipo(place.t,place.h),falta=temCaixa()&&pr>saldoAtual;
    html=`<span class="msg">${d.ic} <b>${esc(d.nome)}</b> · <b>${fmtR(pr)}</b> · ${falta?'<span style="color:var(--bad)">saldo insuficiente</span>':touchNote?'toque no mapa':'clique no mapa'}</span><button class="pbtn" data-h="rot" title="Girar (R)">⟳</button>${touchNote?`<button class="pbtn pri" data-h="ok" ${ghost.visible&&ghost.userData.ok?'':'disabled'}>✓ Colocar</button>`:''}<button class="pbtn" data-h="x" title="Cancelar (Esc)">✕</button>`}
  else if(tool==='construir')html='<span class="msg">Escolha uma construção no catálogo</span><button class="pbtn" data-h="x">✕</button>';
  else if(tool==='mover'&&place){const it=items.get(moveId);html=`<span class="msg">✥ Movendo <b>${esc(it?typeName(it):'')}</b> · escolha o novo lugar</span><button class="pbtn" data-h="rot">⟳</button>${touchNote?`<button class="pbtn pri" data-h="ok" ${ghost.visible&&ghost.userData.ok?'':'disabled'}>✓ Aqui</button>`:''}<button class="pbtn" data-h="x">✕</button>`}
  else if(tool==='rua')html=`<span class="msg">🛣️ Arraste para traçar ruas · <b>${fmtR(PRECO.rua)}</b> por quadra${temCaixa()?` · saldo ${fmtR(saldoAtual)}`:''}</span><button class="pbtn" data-h="x">✕</button>`;
  else if(tool==='demolir')html='<span class="msg">🧹 Toque ou arraste sobre o que quer remover</span><button class="pbtn" data-h="x">✕</button>';
  el.innerHTML=html;el.classList.toggle('hidden',!html);
}
$('#hint').addEventListener('click',e=>{const b=e.target.closest('[data-h]');if(!b)return;const k=b.dataset.h;
  if(k==='rot')rotatePlace();else if(k==='ok')commitPlace();else if(k==='x'){if(tool==='mover'){const id=moveId;setTool('ver');select(id)}else setTool('ver')}});
function rotatePlace(){if(!place)return;place.r=(place.r+1)%4;if(ghostTile){const [W,D]=dims(place.t,place.r);ghostTile=[clamp(ghostTile[0],0,N-W),clamp(ghostTile[1],0,N-D)]}updGhost()}
function commitPlace(){
  const it=ghostItem();if(!it)return;
  if(!fits(it.t,it.x,it.z,it.r,moveId)){toast('Não cabe aqui: escolha um lugar livre');return}
  if(tool==='mover'){const old=items.get(moveId);if(!old){setTool('ver');return}
    const after={...old,x:it.x,z:it.z,r:it.r};apply([{id:old.id,before:old,after}]);const id=old.id;setTool('ver');select(id);toast(`Mudou de lugar: ${typeName(old)}`);return}
  if(items.size>=MAX_ITEMS){toast('O mapa chegou ao limite de construções');return}
  const d=T[it.t],o={id:newId(),t:it.t,x:it.x,z:it.z,r:it.t==='rua'?0:it.r,by:WHO,at:new Date().toISOString()};
  if(d.vars)o.v=it.v||0;if(d.floors)o.h=it.h||6;
  const valor=price(o),desc=d.floors?`${d.nome} de ${o.h} andares`:d.nome,r=cobrar(desc,valor);
  if(!r.ok){avisoCobranca(r);updGhost();return}
  const ch=[{id:o.id,before:null,after:o}];ch.fin={id:r.id,valor,desc};apply(ch);toast(`Obra pronta: ${d.nome} · ${fmtR(valor)}`);
  if(d.rand){place.v=Math.floor(Math.random()*(d.vars||1));if(d.floors)place.h=4+Math.floor(Math.random()*6);ghostMk=''}
  updGhost();
}
function tileFromHover(ix,iz){if(!place)return null;const [W,D]=dims(place.t,place.r);return [clamp(ix-Math.floor((W-1)/2),0,N-W),clamp(iz-Math.floor((D-1)/2),0,N-D)]}
function paintAt(ix,iz){
  if(ix<0||iz<0||ix>=N||iz>=N||!stroke)return;const k=tk(ix,iz);if(stroke.seen.has(k))return;stroke.seen.add(k);
  if(tool==='rua'){if(occ.has(k)||items.size>=MAX_ITEMS)return;
    if(stroke.custo+PRECO.rua>stroke.orcamento){if(!stroke.avisou){stroke.avisou=true;toast(temCaixa()?`O saldo acabou: ${fmtR(saldoAtual)}`:'Abra a projeção pela Prefeitura para construir.')}return}
    stroke.custo+=PRECO.rua;const o={id:newId(),t:'rua',x:ix,z:iz,r:0,by:WHO,at:new Date().toISOString()};stroke.changes.push({id:o.id,before:null,after:o});apply([{id:o.id,before:null,after:o}],{record:false})}
  else if(tool==='demolir'){const id=occ.get(k);if(!id)return;const it=items.get(id);if(!it)return;stroke.changes.push({id,before:it,after:null});apply([{id,before:it,after:null}],{record:false})}
}
function endStroke(){if(!stroke)return;const ch=stroke.changes;stroke=null;if(!ch.length)return;
  if(tool==='rua'){const valor=ch.length*PRECO.rua,desc=ch.length===1?'1 quadra de rua':`${ch.length} quadras de rua`,r=cobrar(desc,valor);
    if(!r.ok){apply(ch.map(c=>({id:c.id,before:c.after,after:null})),{record:false});avisoCobranca(r);return}
    ch.fin={id:r.id,valor,desc};toast(`${desc} · ${fmtR(valor)}`)}
  undoStack.push(ch);if(undoStack.length>100)undoStack.shift();redoStack.length=0;updUndo();
  if(tool==='demolir')toast(ch.length===1?`Removido: ${typeName(ch[0].before)}`:`${ch.length} itens removidos`,{undo:true});}

// ---------------------------------------------------------------- Ponteiro
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0),hitP=new THREE.Vector3();
function setNdc(e){const r=canvas.getBoundingClientRect();ndc.set(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);ray.setFromCamera(ndc,camera)}
function tileAt(e){setNdc(e);if(!ray.ray.intersectPlane(groundPlane,hitP))return null;return [Math.floor(hitP.x+N/2),Math.floor(hitP.z+N/2)]}
function pickItem(e){
  setNdc(e);const meshes=[];for(const b of batches.values())for(const m of b.meshes)if(m.userData.layer==='solid'&&m.count)meshes.push(m);
  for(const h of ray.intersectObjects(meshes,false)){const b=h.object.userData.batch,id=b.ids[h.instanceId];const o=objs.get(id);if(id&&items.has(id)&&!o?.dying)return id}
  const t=tileAt(e);return t?occ.get(tk(t[0],t[1]))||null:null;
}
let lastPointer=TOUCHY?'touch':'mouse';const ptrs=new Map();let down=null,lastTap=null,lastPaint=null,hoverRaf=0;
canvas.addEventListener('pointerdown',e=>{
  camTween=null;ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});if(lastPointer!==e.pointerType){lastPointer=e.pointerType;updHint()}
  if(ptrs.size>1){endStroke();down=null;return}
  down={x:e.clientX,y:e.clientY,t:performance.now(),button:e.button,type:e.pointerType};
  if((tool==='rua'||tool==='demolir')&&e.button===0){stroke={changes:[],seen:new Set(),custo:0,orcamento:tool==='rua'?(temCaixa()?lerSaldo():0):Infinity};const t=tileAt(e);if(t){paintAt(...t);lastPaint=t}}
});
canvas.addEventListener('pointermove',e=>{
  if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(stroke&&ptrs.size===1){const t=tileAt(e);if(t){if(lastPaint){const [x0,z0]=lastPaint,steps=Math.max(Math.abs(t[0]-x0),Math.abs(t[1]-z0));for(let i=1;i<=steps;i++)paintAt(Math.round(lerp(x0,t[0],i/steps)),Math.round(lerp(z0,t[1],i/steps)))}else paintAt(...t);lastPaint=t}}
  if(e.pointerType==='mouse'&&!ptrs.size||stroke){
    if(hoverRaf)return;hoverRaf=requestAnimationFrame(()=>{hoverRaf=0;hover(e)});
  }
});
function hover(e){
  const t=tileAt(e);
  if((tool==='construir'||tool==='mover')&&place&&e.pointerType==='mouse'){ghostTile=t&&t[0]>=0&&t[1]>=0&&t[0]<N&&t[1]<N?tileFromHover(...t):null;updGhost()}
  if(tool==='rua'||tool==='demolir'){
    if(t&&t[0]>=0&&t[1]>=0&&t[0]<N&&t[1]<N){
      const id=tool==='demolir'?occ.get(tk(...t)):null,it=id&&items.get(id);
      if(it){const [W,D]=dims(it.t,it.r),[cx,cz]=center(it);hoverTile.position.set(cx,0.06,cz);hoverTile.scale.set(W,D,1)}else{hoverTile.position.set(t[0]+0.5-N/2,0.06,t[1]+0.5-N/2);hoverTile.scale.set(1,1,1)}
      hoverTile.visible=true;
    }else hoverTile.visible=false;
  }
  if(tool==='ver'&&e.pointerType==='mouse'){const id=pickItem(e);if(id!==hoverId){hoverId=id;canvas.style.cursor=id?'pointer':'grab'}}
}
function endPointer(e){
  const wasMulti=ptrs.size>1;ptrs.delete(e.pointerId);
  if(stroke){endStroke();lastPaint=null;down=null;return}
  if(!down||wasMulti){down=null;return}
  const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y),dt=performance.now()-down.t,d=down;down=null;
  if(e.type==='pointercancel'||moved>9||dt>600||d.button!==0)return;
  tap(e,d.type);
}
canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);
canvas.addEventListener('pointerleave',()=>{if(lastPointer==='mouse'){hoverTile.visible=false;if(tool==='construir'||tool==='mover'){ghostTile=null;updGhost()}}});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
function tap(e,type){
  const now=performance.now(),dbl=lastTap&&now-lastTap.t<320&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<24;lastTap={t:now,x:e.clientX,y:e.clientY};
  if(tool==='ver'){const id=pickItem(e);if(dbl&&id){focusItem(id);return}select(id);return}
  if((tool==='construir'||tool==='mover')&&place){
    const t=tileAt(e);if(!t||t[0]<0||t[1]<0||t[0]>=N||t[1]>=N)return;const nt=tileFromHover(...t);
    if(type==='mouse'){ghostTile=nt;updGhost();commitPlace();return}
    const same=ghostTile&&ghostTile[0]===nt[0]&&ghostTile[1]===nt[1];ghostTile=nt;updGhost();
    if(same&&dbl)commitPlace();
  }
}
addEventListener('keydown',e=>{
  if(/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName))return;
  const k=e.key.toLowerCase();
  if(k==='escape'){if(!$('#help').classList.contains('hidden')){$('#help').classList.add('hidden');return}if(tool!=='ver')setTool('ver');else select(null);return}
  if(!CAN_EDIT)return;
  if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();e.shiftKey?doRedo():doUndo();return}
  if((e.ctrlKey||e.metaKey)&&k==='y'){e.preventDefault();doRedo();return}
  if(k==='r'&&place){rotatePlace();return}
  if(k==='r'&&selId){rotateSel();return}
  if((k==='delete'||k==='backspace')&&selId){removeSel();return}
});

// ---------------------------------------------------------------- Seleção e cartão
const thumbs={};
function select(id){
  if(selId&&objs.get(selId)&&items.get(selId))objs.get(selId).batch.set(selId,baseMatrix(items.get(selId)));
  selId=id&&items.has(id)?id:null;for(const m of selRing.children)m.geometry.dispose();selRing.clear();
  if(selId){const it=items.get(selId),[W,D]=dims(it.t,it.r),[cx,cz]=center(it),th=0.07;
    objs.get(selId)?.batch.set(selId,baseMatrix(it,1,0.05));
    for(const [w,d,x,z] of [[W+0.1,th,0,-D/2-0.02],[W+0.1,th,0,D/2+0.02],[th,D+0.1,-W/2-0.02,0],[th,D+0.1,W/2+0.02,0]]){const m=new THREE.Mesh(new THREE.BoxGeometry(w,0.03,d),selMat);m.position.set(x,0.05,z);selRing.add(m)}
    selRing.position.set(cx,0,cz);
  }
  renderCard();updLabels(true);
}
function fmtWhen(iso){const t=Date.parse(iso);if(!t)return '';const s=(Date.now()-t)/1000;if(s<60)return 'agora há pouco';if(s<3600)return `há ${Math.floor(s/60)} min`;if(s<86400)return `há ${Math.floor(s/3600)} h`;return new Date(t).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})}
let renaming=false;
function renderCard(){
  const el=$('#card'),it=selId&&items.get(selId);
  document.body.classList.toggle('has-card',!!it);
  if(!it){el.classList.add('hidden');renaming=false;return}
  const d=T[it.t],[W,D]=dims(it.t,it.r),th=thumbs[it.t]?`<img src="${thumbs[it.t]}" alt="">`:d.ic;
  const sub=[d.longo||d.nome,fmtR(price(it)),W*D>1?`ocupa ${W}×${D}`:'',d.floors?`${it.h||6} andares`:'',d.vars&&d.varNomes&&it.t!=='casa'&&it.t!=='predio'?d.varNomes[it.v|0]:''].filter(Boolean).join(' · ');
  let acts='';
  if(CAN_EDIT){
    acts=`<div class="acts"><button class="pbtn" data-c="nome">✏️ Nome</button>${it.t!=='rua'?'<button class="pbtn" data-c="girar">⟳ Girar</button>':''}<button class="pbtn" data-c="mover">✥ Mover</button><button class="pbtn danger" data-c="remover">🗑️ Remover</button></div>`;
    if(d.floors)acts+=`<div class="acts"><span class="step"><button data-c="menos" aria-label="Menos andares">−</button><span>${it.h||6} andares</span><button data-c="mais" aria-label="Mais um andar por ${fmtR(ANDAR)}" title="+1 andar: ${fmtR(ANDAR)}">+</button></span><button class="pbtn" data-c="estilo">🎨 Outra cor</button></div>`;
    else if(it.t==='casa')acts+=`<div class="acts"><button class="pbtn" data-c="estilo">🎨 Outra cor e formato</button></div>`;
    else if(d.vars)acts+=`<div class="chips">${d.varNomes.map((n,i)=>`<button data-c="var" data-v="${i}" class="${(it.v|0)===i?'on':''}">${esc(n)}</button>`).join('')}</div>`;
  }
  const who=it.by?`Colocado por ${esc(it.by)}${it.at?' · '+fmtWhen(it.at):''}`:'';
  el.innerHTML=`<div class="hd"><div class="th">${th}</div><div class="nm">${renaming?`<input id="nmIn" maxlength="40" value="${esc(it.n||'')}" placeholder="${esc(d.nome)}" aria-label="Nome">`:`<b>${esc(typeName(it))}</b><small>${esc(sub)}</small>`}</div><button class="ibtn" data-c="perto" title="Ver de perto" aria-label="Ver de perto">🎯</button><button class="ibtn" data-c="fechar" title="Fechar" aria-label="Fechar">✕</button></div>${who?`<div class="meta">${who}</div>`:''}${renaming?`<div class="acts"><button class="pbtn pri" data-c="salvarNome">Salvar nome</button><button class="pbtn" data-c="cancelaNome">Cancelar</button></div>`:acts}`;
  el.classList.remove('hidden');
  if(renaming){const i=$('#nmIn');i.focus();i.select();i.onkeydown=ev=>{if(ev.key==='Enter')saveName();if(ev.key==='Escape'){renaming=false;renderCard()}}}
}
function saveName(){const it=items.get(selId),i=$('#nmIn');if(!it||!i)return;const n=i.value.replace(/\s+/g,' ').trim().slice(0,40);renaming=false;
  if((it.n||'')!==n){const after={...it};if(n)after.n=n;else delete after.n;apply([{id:it.id,before:it,after}])}else renderCard()}
function rotateSel(){const it=items.get(selId);if(!it||it.t==='rua')return;const r=(it.r+1)%4,[W,D]=dims(it.t,r);
  const x=clamp(it.x,0,N-W),z=clamp(it.z,0,N-D);if(!fits(it.t,x,z,r,it.id)){toast('Não cabe girado aqui');return}
  apply([{id:it.id,before:it,after:{...it,r,x,z}}]);select(it.id)}
function removeSel(){const it=items.get(selId);if(!it)return;apply([{id:it.id,before:it,after:null}]);select(null);toast(`Removido: ${typeName(it)}`,{undo:true})}
$('#card').addEventListener('click',e=>{
  const b=e.target.closest('[data-c]');if(!b)return;const k=b.dataset.c,it=items.get(selId);if(!it)return;
  if(k==='fechar')return select(null);
  if(k==='perto')return focusItem(it.id);
  if(!CAN_EDIT)return;
  if(k==='nome'){renaming=true;renderCard()}
  else if(k==='salvarNome')saveName();
  else if(k==='cancelaNome'){renaming=false;renderCard()}
  else if(k==='girar')rotateSel();
  else if(k==='remover')removeSel();
  else if(k==='mover'){moveId=it.id;const id=it.id;select(null);moveId=id;setTool('mover');place={t:it.t,r:it.r,v:it.v,h:it.h};ghostTile=[it.x,it.z];ghostMk='';updGhost()}
  else if(k==='mais'||k==='menos'){const h=clamp((it.h||6)+(k==='mais'?1:-1),3,16);if(h===it.h)return;const ch=[{id:it.id,before:it,after:{...it,h}}];
    if(k==='mais'){const desc=`+1 andar em ${typeName(it)}`,r=cobrar(desc,ANDAR);if(!r.ok)return avisoCobranca(r);ch.fin={id:r.id,valor:ANDAR,desc}}
    apply(ch)}
  else if(k==='estilo'){const n=T[it.t].vars;apply([{id:it.id,before:it,after:{...it,v:((it.v|0)+1)%n}}])}
  else if(k==='var'){const v=+b.dataset.v;if(v!==(it.v|0))apply([{id:it.id,before:it,after:{...it,v}}])}
});

// ---------------------------------------------------------------- Nomes flutuantes
let showLabels=ls.get(LBL_KEY)!=='0';$('#lblBtn').classList.toggle('on',showLabels);
$('#lblBtn').onclick=()=>{showLabels=!showLabels;ls.set(LBL_KEY,showLabels?'1':'0');$('#lblBtn').classList.toggle('on',showLabels);updLabels(true)};
const labelEls=new Map();let labelList=[];
function updLabels(rebuild){
  if(rebuild){
    labelList=[...items.values()].filter(it=>it.id===selId||(showLabels&&(T[it.t].label||it.n)));
    const keep=new Set(labelList.map(i=>i.id));
    for(const [id,el] of labelEls)if(!keep.has(id)){el.remove();labelEls.delete(id)}
    for(const it of labelList){let el=labelEls.get(it.id);if(!el){el=document.createElement('div');el.className='lbl';$('#labels').appendChild(el);labelEls.set(it.id,el)}
      const txt=`${T[it.t].ic} ${typeName(it)}`;if(el.textContent!==txt){el.textContent=txt;el._w=0}el.classList.toggle('sel',it.id===selId)}
  }
  const w=innerWidth,h=innerHeight,shown=[],cand=[];
  for(const it of labelList){const el=labelEls.get(it.id),o=objs.get(it.id);if(!el)continue;const [cx,cz]=center(it);
    _v.set(cx,(o?.h||0.5)+0.28+(it.id===selId?0.05:0),cz);const dist=_v.distanceTo(camera.position);_v.project(camera);
    const far=it.t==='rua'?22:64,vis=_v.z<1&&Math.abs(_v.x)<1.1&&Math.abs(_v.y)<1.1&&(it.id===selId||dist<far);
    if(!vis){if(el.style.opacity!=='0')el.style.opacity='0';continue}
    cand.push({it,el,dist,far,x:(_v.x+1)/2*w,y:(1-_v.y)/2*h,sel:it.id===selId});
  }
  // Nomes não se atropelam: o selecionado e os mais próximos da câmera ganham o lugar
  cand.sort((a,b)=>(b.sel-a.sel)||(a.dist-b.dist));
  for(const c of cand){
    const lw=c.el._w||(c.el._w=c.el.offsetWidth||90),lh=22,r={l:c.x-lw/2,r:c.x+lw/2,t:c.y-lh,b:c.y};
    const hit=!c.sel&&shown.some(q=>r.l<q.r+4&&r.r>q.l-4&&r.t<q.b+2&&r.b>q.t-2);
    if(hit){if(c.el.style.opacity!=='0')c.el.style.opacity='0';continue}
    shown.push(r);
    c.el.style.opacity=c.sel?'1':String(clamp((c.far-c.dist)/10,0.15,1));
    c.el.style.transform=`translate(${c.x.toFixed(1)}px,${c.y.toFixed(1)}px) translate(-50%,-100%)`;
  }
}

// ---------------------------------------------------------------- Resumo
const GROUPS=[['🏠','Casas',['casa']],['🏢','Prédios',['predio']],['🩺','Saúde',['ubs','hospital']],['🏫','Escolas',['escola']],['🛡️','Segurança',['delegacia','bombeiros']],['🏛️','Prefeitura',['prefeitura']],['🛒','Comércio',['mercado','posto']],['⛪','Igrejas',['igreja']],['⛲','Lazer',['praca','campo','lago']],['🌳','Árvores',['arvore']],['🌾','Lavouras',['lavoura']],['🛣️','Ruas',['rua']]];
function population(){let p=0;for(const it of items.values()){if(it.t==='casa')p+=3.2;else if(it.t==='predio')p+=(it.h||6)*4*2.8}return Math.round(p)}
const fmt=n=>new Intl.NumberFormat('pt-BR').format(n);
function valorCidade(){let v=0;for(const it of items.values())v+=price(it);return v}
function updSummary(){
  const pop=population();$('#popMini').textContent=items.size?`${fmt(pop)} hab.`:'';
  const el=$('#summary');if(el.classList.contains('hidden'))return;
  const cnt={};for(const it of items.values())cnt[it.t]=(cnt[it.t]||0)+1;
  const rows=GROUPS.map(([ic,n,ts])=>[ic,n,ts.reduce((s,t)=>s+(cnt[t]||0),0),ts]).filter(r=>r[2]);
  const ruas=cnt.rua||0,lav=(cnt.lavoura||0)*9;
  el.innerHTML=`<h3>📊 ${esc(CITY_NAME)}</h3><div class="sub">${meta.updatedAt?`Última mudança ${fmtWhen(meta.updatedAt)}${meta.updatedBy?' por '+esc(meta.updatedBy):''}`:'Mapa ainda não salvo'}</div>
    <div class="big"><div><b>${fmt(pop)}</b><span>habitantes (estimativa)</span></div><div><b>${fmt(items.size-ruas)}</b><span>construções</span></div></div>
    <div class="big"><div title="${fmtFull(valorCidade())}"><b>${fmtR(valorCidade())}</b><span>valor das construções</span></div>${temCaixa()?`<div title="${fmtFull(saldoAtual)}"><b style="color:${saldoAtual<0?'var(--bad)':'inherit'}">${fmtR(saldoAtual)}</b><span>saldo da prefeitura</span></div>`:''}</div>
    ${rows.map(([ic,n,c,ts])=>`<div class="srow"><span class="ic">${ic}</span><button data-find="${ts.join(',')}" title="Mostrar no mapa">${esc(n)}</button><span class="n">${fmt(c)}${ts[0]==='rua'?` <small>(${(c*0.1).toLocaleString('pt-BR',{maximumFractionDigits:1})} km)</small>`:ts[0]==='lavoura'?` <small>(${fmt(lav)} ha)</small>`:''}</span></div>`).join('')||'<div class="srow">Nada construído ainda.</div>'}
    <div class="srow" style="justify-content:space-between;gap:6px;flex-wrap:wrap;padding-top:10px"><button class="pbtn" data-s="ajuda">❔ Como usar</button>${CAN_EDIT&&items.size?'<button class="pbtn danger" data-s="limpar">Recomeçar do zero</button>':''}</div>`;
}
const findIdx={};
$('#summary').addEventListener('click',e=>{
  const f=e.target.closest('[data-find]');if(f){const ts=f.dataset.find.split(','),list=[...items.values()].filter(i=>ts.includes(i.t));if(!list.length)return;const k=f.dataset.find;findIdx[k]=((findIdx[k]??-1)+1)%list.length;const it=list[findIdx[k]];select(it.id);focusItem(it.id);if(innerWidth<640)toggleSummary(false);return}
  const s=e.target.closest('[data-s]');if(!s)return;
  if(s.dataset.s==='ajuda'){toggleSummary(false);showHelp()}
  if(s.dataset.s==='limpar'&&CAN_EDIT){if(!confirm(`Apagar todo o mapa de ${CITY_NAME}? Dá para desfazer em seguida com ↶.`))return;const ch=[...items.values()].map(it=>({id:it.id,before:it,after:null}));select(null);apply(ch);toast('Mapa apagado',{undo:true})}
});
function toggleSummary(open){const el=$('#summary'),o=open??el.classList.contains('hidden');el.classList.toggle('hidden',!o);$('#sumBtn').classList.toggle('hidden',o);$('#sumBtn').setAttribute('aria-expanded',String(o));if(o)updSummary()}
$('#sumBtn').onclick=()=>toggleSummary(true);
document.addEventListener('pointerdown',e=>{if(!$('#summary').classList.contains('hidden')&&!e.target.closest('#summary')&&!e.target.closest('#sumBtn'))toggleSummary(false)},true);

// ---------------------------------------------------------------- Catálogo
let catSel='gov';
function renderCatalog(){
  $('#cats').innerHTML=CATS.map(([k,n])=>`<button class="cat ${k===catSel?'on':''}" data-cat="${k}">${esc(n)}</button>`).join('');
  $('#saldoCat').innerHTML=temCaixa()?`💰 Saldo da prefeitura: <b>${fmtR(saldoAtual)}</b>`:'💰 Abra pela Prefeitura para construir';
  $('#items').innerHTML=Object.entries(T).filter(([,d])=>d.cat===catSel).map(([t,d])=>{const pr=precoTipo(t,6),caro=temCaixa()&&pr>saldoAtual;return `<button class="it ${place?.t===t?'on':''} ${caro?'caro':''}" data-t="${t}"><div class="th">${thumbs[t]?`<img src="${thumbs[t]}" alt="">`:d.ic}</div><b>${esc(d.nome)}</b><span class="pr">${t==='rua'?fmtR(pr)+'/quadra':(d.floors?'a partir de ':'')+fmtR(precoTipo(t,d.floors?3:6))}</span><small>${caro?'sem saldo':`${d.w}×${d.d}`}</small></button>`}).join('');
}
$('#cats').addEventListener('click',e=>{const b=e.target.closest('[data-cat]');if(!b)return;catSel=b.dataset.cat;renderCatalog()});
$('#items').addEventListener('click',e=>{const b=e.target.closest('[data-t]');if(!b)return;if(b.dataset.t==='rua'){setTool('rua');return}pickPlace(b.dataset.t)});
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{const t=b.dataset.tool;setTool(tool===t&&t!=='ver'?'ver':t)});
$('#undoBtn').onclick=doUndo;$('#redoBtn').onclick=doRedo;

// Miniaturas do catálogo desenhadas com os próprios modelos
function makeThumbs(){
  try{
    const cv=document.createElement('canvas');cv.width=176;cv.height=140;
    const r=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true,preserveDrawingBuffer:true});r.toneMapping=THREE.ACESFilmicToneMapping;
    const sc=new THREE.Scene();sc.add(new THREE.HemisphereLight(0xeef6ff,0x7a8f6a,1.3));const dl=new THREE.DirectionalLight(0xffffff,2.2);dl.position.set(-3,6,4);sc.add(dl);
    const cam=new THREE.PerspectiveCamera(28,176/140,0.1,100);
    for(const t of Object.keys(T)){
      const mk=t==='rua'?'rua:5:1':t+':0:'+(t==='predio'?6:0),g=modelGeo(mk),grp=new THREE.Group();
      for(const l of LAYERS)if(g[l])grp.add(new THREE.Mesh(g[l],l==='lit'?M.dark:M[l]));
      sc.add(grp);const box=new THREE.Box3().setFromObject(grp),size=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3());
      const R=Math.max(size.x,size.y*1.2,size.z)*1.25+0.4;cam.position.set(c.x+R*0.9,c.y+R*0.75,c.z+R*1.05);cam.lookAt(c);
      r.render(sc,cam);thumbs[t]=cv.toDataURL('image/png');sc.remove(grp);
    }
    r.dispose();r.forceContextLoss?.();
    if(tool==='construir')renderCatalog();if(selId)renderCard();
  }catch(err){console.warn('Miniaturas do catálogo:',err)}
}

// ---------------------------------------------------------------- Cidade vazia e cidade modelo
function updEmpty(){
  const el=$('#empty');const show=loadedOnce&&!items.size&&!pending.length;
  el.classList.toggle('hidden',!show);if(!show)return;
  el.firstElementChild.innerHTML=CAN_EDIT?`<div class="em">🏙️</div><h2>Vamos montar ${esc(CITY_NAME)}?</h2><p>Coloque prefeitura, UBS, escolas, casas, ruas e o que mais a cidade tiver. Tudo fica salvo e aparece para todos do sistema.</p><div class="row"><button class="pbtn pri" data-e="modelo">✨ Começar com uma cidade modelo</button><button class="pbtn" data-e="zero">🏗️ Começar do zero</button></div>`
    :`<div class="em">🏙️</div><h2>${esc(CITY_NAME)} ainda não foi montada</h2><p>Quando o prefeito ou o vice montarem o mapa, a cidade aparece aqui em 3D.</p>`;
}
$('#empty').addEventListener('click',e=>{const b=e.target.closest('[data-e]');if(!b)return;
  if(b.dataset.e==='zero'){$('#empty').classList.add('hidden');setTool('construir');pickPlace('prefeitura')}
  else{const list=seedTown();apply(list.map(it=>({id:it.id,before:null,after:it})),{intro:true});toast(`Cidade modelo pronta: ${list.length} itens, sem custo. As próximas obras saem do saldo.`,{undo:true})}});
function seedTown(){
  const out=[],used=new Set(),r=rng(hash(CITY_KEY)),at=new Date().toISOString();
  const put=(t,x,z,rot=0,extra={})=>{const [W,D]=dims(t,rot);if(x<0||z<0||x+W>N||z+D>N)return false;for(let i=0;i<W;i++)for(let j=0;j<D;j++)if(used.has(tk(x+i,z+j)))return false;
    for(let i=0;i<W;i++)for(let j=0;j<D;j++)used.add(tk(x+i,z+j));const o={id:newId()+out.length.toString(36),t,x,z,r:t==='rua'?0:rot,...extra,by:WHO,at};if(T[t].vars&&o.v==null)o.v=Math.floor(r()*T[t].vars);if(T[t].floors&&o.h==null)o.h=4+Math.floor(r()*6);out.push(o);return true};
  const L=[11,18,25];
  for(const z of L)for(let x=5;x<=31;x++)put('rua',x,z);
  for(const x of L)for(let z=5;z<=31;z++)put('rua',x,z);
  for(let z=32;z<N;z++)put('rua',18,z);
  put('prefeitura',13,16,0,{n:'Prefeitura Municipal'});put('praca',13,12,0,{n:'Praça Central'});
  put('igreja',19,15,0,{n:'Igreja Matriz'});put('mercado',21,16,0);put('predio',23,16,0,{h:8,v:1});
  put('escola',12,19,2,{n:'Escola Municipal'});put('ubs',15,19,2,{n:'UBS Central'});
  put('predio',19,19,2,{h:9,v:2});put('predio',21,19,2,{h:5,v:0});put('posto',23,19,2);
  put('delegacia',9,12,1);put('bombeiros',9,15,1);put('campo',6,20,0,{n:'Estádio Municipal'});
  put('hospital',26,12,3,{n:'Hospital Municipal'});put('lago',27,27,0);put('praca',19,26,0);
  // casas de frente para as ruas
  for(let x=5;x<=31;x++)for(let z=5;z<=31;z++){
    if(used.has(tk(x,z))||r()>0.7)continue;
    const rot=isRoadSeed(x,z+1)?0:isRoadSeed(x,z-1)?2:isRoadSeed(x+1,z)?1:isRoadSeed(x-1,z)?3:-1;
    if(rot>=0)put('casa',x,z,rot);
  }
  function isRoadSeed(x,z){return out.some(o=>o.t==='rua'&&o.x===x&&o.z===z)}
  for(const [x,z,v] of [[0,0,0],[0,3,1],[3,0,2],[34,1,3],[34,34,0],[1,34,1],[34,6,2],[0,30,3]])put('lavoura',x,z,0,{v});
  for(let i=0;i<220&&out.filter(o=>o.t==='arvore').length<70;i++){const x=Math.floor(r()*N),z=Math.floor(r()*N);if(x>=5&&x<=31&&z>=5&&z<=31&&r()<0.75)continue;put('arvore',x,z,Math.floor(r()*4))}
  for(const [x,z] of [[14,15],[16,15],[12,12],[12,14],[17,12],[17,14],[20,13],[22,13],[24,13]])put('arvore',x,z,0,{v:x%2?2:0});
  return out;
}

// ---------------------------------------------------------------- Barra de cima, ajuda, aviso
$('#cityTtl').textContent=CITY_NAME+(CAN_EDIT?'':' · só visualização');
$('#backBtn').onclick=()=>{if(EMBED){try{window.parent.App.systemBack();return}catch{}}if(window.opener){window.close();return}location.href='/'};
if(!EMBED){$('#tabBtn').classList.add('hidden');if(!window.opener)$('#backBtn').textContent='⌂'}
$('#tabBtn').onclick=()=>{window.open(location.href,'_blank')};
if(!document.fullscreenEnabled)$('#fsBtn').classList.add('hidden');
$('#fsBtn').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen?.();else document.documentElement.requestFullscreen?.().catch(()=>toast('Tela cheia não disponível aqui'))};
function showHelp(){$('#help').classList.remove('hidden');$('#help').querySelectorAll('.ed').forEach(e=>e.classList.toggle('hidden',!CAN_EDIT))}
$('#helpBtn').onclick=showHelp;$('#helpOk').onclick=()=>{$('#help').classList.add('hidden');ls.set(HELP_KEY,'1')};
$('#help').addEventListener('click',e=>{if(e.target===$('#help'))$('#help').classList.add('hidden')});
let toastTimer=0;
function toast(msg,{undo=false}={}){const el=$('#toast');el.innerHTML=`<span>${esc(msg)}</span>${undo&&CAN_EDIT?'<button data-u>↶ Desfazer</button>':''}`;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),undo?4200:2200)}
$('#toast').addEventListener('click',e=>{if(e.target.closest('[data-u]')){doUndo();$('#toast').classList.remove('show')}});
$('#shotBtn').onclick=()=>{
  const vis=[ghost.visible,hoverTile.visible,selRing.visible,gridLines.visible];ghost.visible=hoverTile.visible=selRing.visible=gridLines.visible=false;
  renderer.render(scene,camera);const url=canvas.toDataURL('image/png');[ghost.visible,hoverTile.visible,selRing.visible,gridLines.visible]=vis;
  const a=document.createElement('a');a.href=url;a.download=`cidade-3d-${CITY_NAME.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9]+/g,'-').toLowerCase()}.png`;document.body.appendChild(a);a.click();a.remove();toast('Foto salva')};
if(CAN_EDIT)$('#tools').classList.remove('hidden');

// ---------------------------------------------------------------- Laço
function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
addEventListener('resize',resize);resize();
let last=performance.now(),firstFrame=true;
renderer.setAnimationLoop(now=>{
  if(document.hidden)return;
  const dt=Math.min(0.05,(now-last)/1000);last=now;
  stepCam(now);controls.update();stepAnims(now);
  if(Math.abs(nightT-night)>0.001){nightT=lerp(nightT,night,Math.min(1,dt*2.6));if(Math.abs(nightT-night)<0.005)nightT=night;applyNight(nightT)}
  for(const c of clouds){if(!REDUCED){c.position.x+=c.userData.v*dt;if(c.position.x>70)c.position.x=-70}
    const d=c.position.distanceTo(camera.position);c.material.color.copy(cloudMat.color);c.material.opacity=cloudOpacity*clamp((d-10)/22,0,1);c.visible=c.material.opacity>0.02}
  if(!REDUCED)stepCars(dt);
  const want=(tool==='construir'||tool==='rua'||tool==='mover'||tool==='demolir')?0.22:0;gridLines.material.opacity=lerp(gridLines.material.opacity,want,Math.min(1,dt*8));gridLines.visible=gridLines.material.opacity>0.01;
  if(selId){selMat.opacity=0.65+0.35*Math.sin(now/260)}
  renderer.render(scene,camera);updLabels(false);
  if(firstFrame){firstFrame=false;$('#loading').classList.add('hidden');if(!ls.get(HELP_KEY)&&TOUCHY)toast('Arraste para girar · pinça para aproximar')}
});

// ---------------------------------------------------------------- Início
let hadCache=false;
{try{const c=JSON.parse(ls.get(CACHE_KEY)||'null');if(c&&Array.isArray(c.items)){remote=new Map(cleanList(c.items).map(i=>[i.id,i]));meta={updatedAt:String(c.updatedAt||''),updatedBy:String(c.updatedBy||'')};hadCache=true}}catch{}
 if(CAN_EDIT){try{const p=JSON.parse(ls.get(PEND_KEY)||'null');if(Array.isArray(p))pending=p.filter(o=>o&&typeof o.id==='string').map(o=>({id:o.id,item:o.item?cleanItem(o.item):null})).filter(o=>o.item!==undefined)}catch{}}}
if(hadCache){loadedOnce=true;refresh({anim:false})}
setStatus();initCloud();
if(CTX?.api){lerSaldo();setInterval(()=>{const a=saldoAtual;lerSaldo();if(a!==saldoAtual&&!(isNaN(a)&&isNaN(saldoAtual)))atualizaDinheiro()},4000)}
(window.requestIdleCallback||(f=>setTimeout(f,400)))(makeThumbs);
window.__cidade3d={get items(){return [...items.values()]},get pending(){return pending.length+(inflight?inflight.length:0)},canEdit:CAN_EDIT,select,setTool,pickPlace,commitPlace,focusItem,setGhost:(x,z)=>{ghostTile=[x,z];updGhost()},camera,controls,renderer};
