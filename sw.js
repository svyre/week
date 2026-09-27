const CACHE="week-v231-requests";
const ASSETS=["./","./index.html","./style.css","./app.js","./config.js","./manifest.webmanifest","./week.png","./weekdark.png","./favicon.ico","./week-32.png","./week-180.png","./week-192.png","./week-512.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
// Network-first: всегда пытаемся получить свежий файл с сервера и только при
// отсутствии сети откатываемся на то, что было закэшировано раньше.
self.addEventListener("fetch",e=>{
  // Only static assets from this site's origin. Do not cache authenticated API responses.
  if(e.request.method!=="GET" || new URL(e.request.url).origin!==self.location.origin)return;
  const allowed=["document","script","style","image","font","manifest"].includes(e.request.destination);
  if(!allowed)return;
  e.respondWith(fetch(e.request).then(res=>{
    if(res.ok && res.status===200){
      const copy=res.clone();
      e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{}));
    }
    return res;
  }).catch(()=>caches.match(e.request).then(c=>c||Response.error())));
});
self.addEventListener("push",e=>{
  let data={title:"week.",body:"Новое напоминание",tag:"week-reminder",url:"./"};
  try{if(e.data)data={...data,...e.data.json()}}catch{try{if(e.data)data.body=e.data.text()}catch{}}
  e.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.tag,data:{url:data.url},icon:"./week.png",badge:"./week.png"}));
});
self.addEventListener("notificationclick",e=>{e.notification.close();const url=e.notification.data?.url||"./";e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{for(const c of cs){if("focus"in c){c.navigate?.(url);return c.focus()}}return clients.openWindow?clients.openWindow(url):null;}));});
