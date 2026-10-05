const CACHE='bom-regresso-pwa-v52';
const SHELL=['/index.html','/pais/','/pais/index.html','/pais/brasao.svg','/prefeitura/','/prefeitura/index.html','/manifest.webmanifest','/app-icon.svg','/integration-manifest.json'];

try{
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey:'AIzaSyAZRB9eqv2GFqObXfOP_PZDPDg2VSyjyow',
    authDomain:'prefeitura-de-bom-regresso.firebaseapp.com',
    projectId:'prefeitura-de-bom-regresso',
    storageBucket:'prefeitura-de-bom-regresso.firebasestorage.app',
    messagingSenderId:'198816706059',
    appId:'1:198816706059:web:0cc06972a903b13867610e'
  });
  const messaging=firebase.messaging();
  messaging.onBackgroundMessage(async payload=>{
    const d=payload.data||{},chat=(d.type||'chat')==='chat';
    // Link só para dentro do próprio site.
    const url=/^\/(?![\/\\])/.test(d.url||'')?d.url:(chat?'/?open=chat':'/?open=atividades');
    const tag=chat?'bom-regresso-chat-'+(d.messageId||Date.now()):'republica-'+(d.messageId||Date.now());
    // O mesmo aviso já apareceu (o app aberto em segundo plano mostrou antes): não repete.
    if(!chat&&d.messageId&&(await self.registration.getNotifications({tag}).catch(()=>[])).length)return;
    await self.registration.showNotification(d.title||(chat?'💬 Chat da República':'🔔 República Bom Regressense'),{
      body:d.body||(chat?'Nova mensagem':'Novidade na República'),
      icon:'/app-icon.svg',
      badge:'/app-icon.svg',
      tag,
      renotify:true,
      silent:d.sound==='0',
      vibrate:d.vibrate==='0'?undefined:[70,45,70],
      timestamp:Date.now(),
      data:{type:chat?'chat':d.type,url,messageId:d.messageId||'',senderId:d.senderId||''},
      actions:chat?[{action:'open-chat',title:'Abrir chat'}]:[{action:'open',title:'Ver'}]
    });
  });
}catch(err){
  console.error('FCM service worker indisponível:',err);
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    for(const url of SHELL){
      try{
        const res=await fetch(url,{cache:'reload'});
        if(res&&res.ok)await cache.put(url,res.clone());
      }catch{}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;

  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const res=await fetch(req,{cache:'no-store'});
        if(res&&res.ok){
          const cache=await caches.open(CACHE);
          await cache.put(req,res.clone());
          if(url.pathname.startsWith('/prefeitura'))await cache.put('/prefeitura/index.html',res.clone());
          else if(url.pathname==='/'||url.pathname==='/index.html')await cache.put('/index.html',res.clone());
        }
        return res;
      }catch{
        if(url.pathname.startsWith('/prefeitura')){
          return (await caches.match(req))||(await caches.match('/prefeitura/index.html'))||Response.error();
        }
        return (await caches.match(req))||(await caches.match('/index.html'))||Response.error();
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    try{
      const res=await fetch(req,{cache:'no-store'});
      if(res&&res.ok){
        const cache=await caches.open(CACHE);
        await cache.put(req,res.clone());
      }
      return res;
    }catch{
      return (await caches.match(req))||Response.error();
    }
  })());
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    // Só abre páginas deste site, mesmo que a notificação traga outro endereço.
    const target=(()=>{try{const u=new URL(event.notification?.data?.url||'/?open=chat',self.location.origin);return u.origin===self.location.origin?u.pathname+u.search:'/?open=chat'}catch{return '/?open=chat'}})();
    const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of list){
      try{
        if('navigate' in client)await client.navigate(target);
        if(target.includes('open=chat'))client.postMessage({type:'OPEN_CHAT'});
        if('focus' in client)await client.focus();
        return
      }catch{}
    }
    if(self.clients.openWindow)await self.clients.openWindow(target);
  })());
});
