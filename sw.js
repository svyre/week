const CACHE="week-v7";
const ASSETS=["./","./index.html","./style.css","./app.js","./config.js","./manifest.webmanifest","./week.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
// Network-first: всегда пытаемся получить свежий файл с сервера и только при
// отсутствии сети откатываемся на то, что было закэшировано раньше.
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  e.respondWith(
    fetch(e.request).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy));
      return res;
    }).catch(()=>caches.match(e.request))
  );
});
self.addEventListener("push",e=>{
  let data={title:"week.",body:"Новое напоминание",tag:"week-reminder",url:"./"};
  try{if(e.data)data={...data,...e.data.json()}}catch{try{if(e.data)data.body=e.data.text()}catch{}}
  e.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.tag,data:{url:data.url},icon:"./week.png",badge:"./week.png"}));
});
self.addEventListener("notificationclick",e=>{e.notification.close();const url=e.notification.data?.url||"./";e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{for(const c of cs){if("focus"in c){c.navigate?.(url);return c.focus()}}return clients.openWindow?clients.openWindow(url):null;}));});
