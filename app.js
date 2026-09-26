(() => {
  const hasSupabase = !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);
  const sb = hasSupabase ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY) : null;
  const $ = id => document.getElementById(id);
  const qs = s => document.querySelector(s);
  const qsa = s => [...document.querySelectorAll(s)];

  let state = {
    user:null, profile:null, section:"week", person:"me",
    weekStart: startOfWeek(new Date()), tasks:[], requests:[], templates:[], timeLogs:[], activeTimer:null,
    demo: !hasSupabase, authMode:"login"
  };

  const demoData = {
    profiles:[
      {id:"demo-vadim",display_name:"Вадим",email:"vadim@demo"},
      {id:"demo-sonya",display_name:"Соня",email:"sonya@demo"}
    ],
    tasks:[], requests:[], templates:[
      {id:"t1",title:"Сделать домашку",category:"Школа",duration:60,priority:"mandatory"},
      {id:"t2",title:"Подготовка к репетитору",category:"Репетитор",duration:45,priority:"desirable"}
    ], timeLogs:[]
  };

  function uid(){return crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random();}
  function startOfWeek(d){ const x=new Date(d); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x; }
  function iso(d){const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`}
  function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
  function fmtDate(s){return new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"short"}).format(new Date(s+"T00:00:00"))}
  function toast(msg){$("toast").textContent=msg;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2500)}
  function priorityLabel(p){return {mandatory:"обязательная",desirable:"желательная",optional:"необязательная"}[p]||p}
  function dayName(i){return ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"][i]}
  function minutes(t){return Number(t.duration)||60}
  function toMin(t){const [h,m]=t.slice(0,5).split(":").map(Number);return h*60+(m||0)}

  const GRID_START_HOUR=0, GRID_END_HOUR=24, PX_PER_HOUR=48;

  // Раскладывает задачи одного дня по колонкам-дорожкам (lanes), если время пересекается.
  function layoutDayTasks(dayTasks){
    const timed=dayTasks.filter(t=>t.start_time).sort((a,b)=>toMin(a.start_time)-toMin(b.start_time));
    const lanesEnd=[];
    const placed=timed.map(t=>{
      const start=toMin(t.start_time), end=start+minutes(t);
      let lane=lanesEnd.findIndex(e=>e<=start);
      if(lane===-1){lane=lanesEnd.length;lanesEnd.push(end)}else lanesEnd[lane]=end;
      return {...t,_start:start,_end:end,_lane:lane};
    });
    const laneCount=lanesEnd.length||1;
    return placed.map(p=>({...p,_laneCount:laneCount}));
  }

  // Разворачивает повторяющиеся задачи в отдельные "виртуальные" вхождения на нужном
  // диапазоне дат. Сама запись в базе остаётся одна — редактирование/удаление/чек
  // применяются ко всей серии.
  function expandOccurrences(tasks,rangeStart,days){
    const out=[];
    for(const t of tasks){
      if(!t.recurrence){out.push(t);continue}
      const base=new Date(t.date+"T00:00:00");
      for(let i=0;i<days;i++){
        const d=new Date(rangeStart);d.setDate(d.getDate()+i);
        if(d<base)continue;
        let matches=false;
        if(t.recurrence==="daily")matches=true;
        else if(t.recurrence==="weekly")matches=d.getDay()===base.getDay();
        else if(t.recurrence==="weekdays")matches=d.getDay()!==0&&d.getDay()!==6;
        if(!matches)continue;
        const ds=iso(d);
        if(ds===t.date)out.push(t);
        else out.push({...t,date:ds,id:`${t.id}::${ds}`,seriesId:t.id,virtual:true});
      }
    }
    return out;
  }

  function trackedMinutesFor(taskId){
    return state.timeLogs.filter(l=>l.task_id===taskId&&l.ended_at)
      .reduce((a,l)=>a+Math.round((new Date(l.ended_at)-new Date(l.started_at))/60000),0);
  }

  function currentUserId(){return state.user?.id || "demo-vadim";}
  function otherId(){return currentUserId()==="demo-sonya"?"demo-vadim":"demo-sonya"}
  async function getOtherUser(){
    if(state.demo)return demoData.profiles.find(p=>p.id!==currentUserId())||null;
    const {data,error}=await sb.from("profiles").select("id,display_name,email").neq("id",currentUserId()).order("created_at",{ascending:true}).limit(1).maybeSingle();
    if(error){toast(error.message);return null}
    return data||null;
  }

  function restoreActiveTimer(){
    const open=state.timeLogs.find(l=>!l.ended_at);
    state.activeTimer=open?{taskId:open.task_id,logId:open.id,startedAt:open.started_at}:null;
  }

  window.toggleTimer=async taskId=>{
    if(state.activeTimer && state.activeTimer.taskId===taskId){ await stopTimer(); }
    else{ if(state.activeTimer) await stopTimer(); await startTimer(taskId); }
  };

  async function startTimer(taskId){
    const startedAt=new Date().toISOString();
    if(state.demo){
      const log={id:uid(),task_id:taskId,user_id:currentUserId(),started_at:startedAt,ended_at:null};
      demoData.timeLogs.push(log);saveDemo();loadDemo();
    }else{
      const {error}=await sb.from("time_logs").insert({task_id:taskId,user_id:state.user.id,started_at:startedAt});
      if(error){toast(error.message);return}
      await reloadCloud();
    }
    renderAll();
  }

  async function stopTimer(){
    if(!state.activeTimer)return;
    const {logId}=state.activeTimer;
    const endedAt=new Date().toISOString();
    if(state.demo){
      const log=demoData.timeLogs.find(l=>l.id===logId);if(log)log.ended_at=endedAt;
      saveDemo();loadDemo();
    }else{
      const {error}=await sb.from("time_logs").update({ended_at:endedAt}).eq("id",logId).eq("user_id",state.user.id);
      if(error){toast(error.message);return}
      await reloadCloud();
    }
    renderAll();
  }

  let timerTickInterval=null;
  function updateTimerBar(){
    const bar=$("activeTimerBar");if(!bar)return;
    if(!state.activeTimer){
      bar.classList.add("hidden");
      if(timerTickInterval){clearInterval(timerTickInterval);timerTickInterval=null}
      return;
    }
    const task=state.tasks.find(t=>t.id===state.activeTimer.taskId);
    $("activeTimerTitle").textContent=task?task.title:"Задача";
    bar.classList.remove("hidden");
    const tick=()=>{
      const sec=Math.max(0,Math.floor((Date.now()-new Date(state.activeTimer.startedAt).getTime())/1000));
      const h=String(Math.floor(sec/3600)).padStart(2,"0"),m=String(Math.floor(sec%3600/60)).padStart(2,"0"),s=String(sec%60).padStart(2,"0");
      $("activeTimerElapsed").textContent=`${h}:${m}:${s}`;
    };
    tick();
    if(timerTickInterval)clearInterval(timerTickInterval);
    timerTickInterval=setInterval(tick,1000);
  }

  function urlBase64ToUint8Array(base64String){
    const padding="=".repeat((4-base64String.length%4)%4);
    const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
    const raw=atob(base64);
    return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
  }

  async function registerPushNotifications(){
    if(state.demo){toast("Push-уведомления доступны только в аккаунте");return false}
    try{
      if(!("serviceWorker" in navigator))throw new Error("Service Worker недоступен");
      if(!("PushManager" in window))throw new Error("Push API недоступен в этом браузере");
      if(!("Notification" in window))throw new Error("Notification API недоступен");
      if(!window.VAPID_PUBLIC_KEY || window.VAPID_PUBLIC_KEY.includes("YOUR_"))throw new Error("Не настроен публичный VAPID-ключ");
      const permission=Notification.permission==="granted"?"granted":await Notification.requestPermission();
      if(permission!=="granted")throw new Error(`Разрешение на уведомления: ${permission}`);
      const reg=await navigator.serviceWorker.ready;
      let sub=await reg.pushManager.getSubscription();
      if(!sub){
        sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(window.VAPID_PUBLIC_KEY)});
      }
      const json=sub.toJSON();
      if(!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)throw new Error("Браузер не вернул данные push-подписки");
      const cfg=notificationSettings();
      const {error}=await sb.from("push_subscriptions").upsert({
        user_id:state.user.id, endpoint:json.endpoint, p256dh:json.keys.p256dh, auth:json.keys.auth,
        lead_minutes:cfg.lead, timezone:Intl.DateTimeFormat().resolvedOptions().timeZone, enabled:true, updated_at:new Date().toISOString()
      },{onConflict:"user_id,endpoint"});
      if(error)throw new Error(`Supabase: ${error.message}`);
      $("notificationsEnabled").checked=true;saveNotificationSettings();
      localStorage.setItem("week-push-active","1");
      toast("Push-уведомления включены");return true;
    }catch(err){
      console.error("Push registration failed",err);
      toast(`Не удалось включить уведомления: ${err.message||err}`);
      return false;
    }
  }

  async function syncPushSubscription(){
    if(state.demo||!state.user||!sb||!("serviceWorker" in navigator)||!("PushManager" in window))return;
    try{
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.getSubscription();
      if(!sub){localStorage.removeItem("week-push-active");return;}
      localStorage.setItem("week-push-active","1");
      const json=sub.toJSON(),cfg=notificationSettings();
      await sb.from("push_subscriptions").upsert({user_id:state.user.id,endpoint:json.endpoint,p256dh:json.keys?.p256dh,auth:json.keys?.auth,lead_minutes:cfg.lead,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,enabled:cfg.enabled,updated_at:new Date().toISOString()},{onConflict:"user_id,endpoint"});
    }catch{}
  }

  async function disablePushNotifications(){
    if(state.demo)return;
    try{
      const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();
      if(sub){await sb.from("push_subscriptions").delete().eq("user_id",state.user.id).eq("endpoint",sub.endpoint);await sub.unsubscribe();}
      localStorage.removeItem("week-push-active");
    }catch{}
  }

  function notificationSettings(){
    return {enabled:localStorage.getItem("week-notifications") === "1", lead:Number(localStorage.getItem("week-notification-lead")||15)};
  }
  function saveNotificationSettings(){
    localStorage.setItem("week-notifications", $("notificationsEnabled").checked ? "1" : "0");
    localStorage.setItem("week-notification-lead", $("notificationLead").value);
  }
  async function enableNotifications(){
    if(!("Notification" in window)){toast("Этот браузер не поддерживает уведомления");return false}
    const permission=await Notification.requestPermission();
    if(permission!=="granted"){toast("Разрешение на уведомления не выдано");return false}
    $("notificationsEnabled").checked=true; saveNotificationSettings(); scheduleNotifications();
    if(!state.demo) await registerPushNotifications(); else toast("Уведомления включены");
    return true;
  }
  function scheduleNotifications(){
    if(window.__weekTimers)window.__weekTimers.forEach(clearTimeout); window.__weekTimers=[];
    const cfg=notificationSettings();
    if(!cfg.enabled || !("Notification" in window) || Notification.permission!=="granted")return;
    if(!state.demo && localStorage.getItem("week-push-active")==="1")return;
    const now=Date.now(); const today=iso(new Date());
    state.tasks.filter(t=>t.date===today && t.start_time && t.status!=="done").forEach(t=>{
      const [h,m]=t.start_time.slice(0,5).split(":").map(Number);
      const when=new Date(); when.setHours(h,m,0,0); when.setMinutes(when.getMinutes()-cfg.lead);
      const delay=when.getTime()-now;
      if(delay>0 && delay<24*60*60*1000){
        window.__weekTimers.push(setTimeout(()=>{new Notification("week.",{body:`Через ${cfg.lead} мин: ${t.title}`,tag:`week-${t.id}`});},delay));
      }
    });
  }

  async function boot(){
    bindStatic();
    if(state.demo){
      state.user=demoData.profiles[0]; state.profile=state.user;
      loadDemo(); showApp(); return;
    }
    const {data:{session}}=await sb.auth.getSession();
    if(session) await enter(session.user);
    else showAuth();
    sb.auth.onAuthStateChange(async (_event,session)=>{
      if(session) await enter(session.user); else showAuth();
    });
  }

  function loadDemo(){
    const raw=localStorage.getItem("week-demo");
    if(raw){try{Object.assign(demoData,JSON.parse(raw))}catch{}}
    state.tasks=demoData.tasks.filter(t=>t.owner_id===currentUserId()||t.visibility==="shared");
    state.requests=demoData.requests.filter(r=>r.to_user_id===currentUserId());
    state.templates=demoData.templates;
    state.timeLogs=(demoData.timeLogs||[]).filter(l=>l.user_id===currentUserId());
    restoreActiveTimer();
    scheduleNotifications();
  }
  function saveDemo(){localStorage.setItem("week-demo",JSON.stringify(demoData))}
  function showAuth(){$("authView").classList.remove("hidden");$("appView").classList.add("hidden")}
  function showApp(){$("authView").classList.add("hidden");$("appView").classList.remove("hidden");renderAll();updateNotificationStatus()}

  async function updateNotificationStatus(){
    const el=$("notificationStatus");if(!el)return;
    if(state.demo){el.textContent="Демо-режим";return}
    if(!window.Notification){el.textContent="Уведомления не поддерживаются";return}
    if(Notification.permission!=="granted"){el.textContent="Разрешение не выдано";return}
    try{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();el.textContent=sub?"Уведомления подключены":"Разрешение выдано, подписка не создана";}catch{el.textContent="Не удалось проверить подписку"}
  }

  async function enter(user){
    state.user=user;
    let profile;
    const res=await sb.from("profiles").select("*").eq("id",user.id).maybeSingle();
    profile=res.data;
    if(!profile){
      const name=(user.user_metadata?.display_name||user.email?.split("@")[0]||"Пользователь");
      const ins=await sb.from("profiles").insert({id:user.id,display_name:name,email:user.email}).select().single();
      profile=ins.data;
    }
    state.profile=profile;
    await reloadCloud();
    showApp();
    await syncPushSubscription();
  }
  async function reloadCloud(){
    if(state.demo){loadDemo();return}
    const cutoff=new Date();cutoff.setDate(cutoff.getDate()-60);
    const [{data:tasks,error:tasksErr},{data:requests,error:reqErr},{data:templates,error:tplErr},{data:logs,error:logsErr}]=await Promise.all([
      sb.from("tasks").select("*").order("date").order("start_time"),
      sb.from("task_requests").select("*").eq("to_user_id",state.user.id).eq("status","pending").order("created_at",{ascending:false}),
      sb.from("task_templates").select("*").eq("user_id",state.user.id).order("created_at",{ascending:false}),
      sb.from("time_logs").select("*").eq("user_id",state.user.id).gte("started_at",cutoff.toISOString()).order("started_at",{ascending:false})
    ]);
    if(tasksErr||reqErr||tplErr||logsErr){
      console.error("reloadCloud error",{tasksErr,reqErr,tplErr,logsErr});
      toast(`Ошибка загрузки: ${(tasksErr||reqErr||tplErr||logsErr).message}`);
    }
    state.tasks=tasks||[];state.requests=requests||[];state.templates=templates||[];state.timeLogs=logs||[];
    restoreActiveTimer();
    scheduleNotifications();
    $("requestBadge").textContent=state.requests.length;$("requestBadge").classList.toggle("hidden",!state.requests.length);
  }

  function setTaskModalNav(hidden){
    document.body.classList.toggle("task-modal-open", !!hidden);
  }

  function bindStatic(){
    qsa("[data-auth]").forEach(b=>b.onclick=()=>{state.authMode=b.dataset.auth;qsa("[data-auth]").forEach(x=>x.classList.toggle("active",x===b));$("nameField").classList.toggle("hidden",state.authMode!=="signup");$("authSubmit").textContent=state.authMode==="signup"?"Создать аккаунт":"Войти"});
    $("authForm").onsubmit=authSubmit;
    $("demoBtn").onclick=()=>{state.demo=true;state.user=demoData.profiles[0];state.profile=state.user;loadDemo();showApp();toast("Открыт демо-режим")};
    $("logoutBtn").onclick=logout;
    qsa(".nav-btn").forEach(b=>b.onclick=()=>switchSection(b.dataset.section));
    qsa("[data-person]").forEach(b=>b.onclick=()=>{state.person=b.dataset.person;qsa("[data-person]").forEach(x=>x.classList.toggle("active",x===b));renderWeek()});
    $("prevWeek").onclick=()=>{state.weekStart.setDate(state.weekStart.getDate()-7);renderWeek()};
    $("nextWeek").onclick=()=>{state.weekStart.setDate(state.weekStart.getDate()+7);renderWeek()};
    $("todayBtn").onclick=()=>{state.weekStart=startOfWeek(new Date());renderWeek()};
    $("addTaskBtn").onclick=()=>openTask();
    $("addTemplateBtn").onclick=()=>$("templateModal").classList.remove("hidden");
    $("taskRecurring").onchange=e=>$("recurrenceBox").classList.toggle("hidden",!e.target.checked);
    qsa('input[name="destination"]').forEach(r=>r.onchange=()=>$("proposalHint").classList.toggle("hidden",r.value!=="proposal"));
    qsa("[data-close]").forEach(b=>b.onclick=()=>{ $(b.dataset.close).classList.add("hidden"); if(b.dataset.close==="taskModal")setTaskModalNav(false); });
    $("taskForm").onsubmit=saveTask;
    $("templateForm").onsubmit=saveTemplate;
    $("saveSettings").onclick=saveSettings;
    $("exportBtn").onclick=exportData;
    $("importFile").onchange=importData;
    $("notificationsEnabled").onchange=async e=>{if(e.target.checked){await enableNotifications();updateNotificationStatus()}else{saveNotificationSettings();scheduleNotifications();await disablePushNotifications();updateNotificationStatus()}};
    $("notificationLead").onchange=async()=>{saveNotificationSettings();scheduleNotifications();await syncPushSubscription()};
    $("enableNotifications").onclick=async()=>{await enableNotifications();updateNotificationStatus()};
    if("Notification" in window && Notification.permission==="granted"){$("notificationsEnabled").checked=notificationSettings().enabled;}
    if($("stopTimerBtn"))$("stopTimerBtn").onclick=stopTimer;
  }

  async function authSubmit(e){
    e.preventDefault();
    const email=$("email").value.trim(),password=$("password").value,displayName=$("displayName").value.trim();
    if(state.authMode==="signup"){
      const {data,error}=await sb.auth.signUp({email,password,options:{data:{display_name:displayName||email.split("@")[0]}}});
      if(error){toast(error.message);return}
      toast(data.session?"Аккаунт создан":"Проверь почту для подтверждения");
    }else{
      const {error}=await sb.auth.signInWithPassword({email,password});
      if(error)toast(error.message);
    }
  }
  async function logout(){if(!state.demo)await sb.auth.signOut();else{state.user=null;showAuth()}}

  function switchSection(s){
    state.section=s;
    qsa(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.section===s));
    ["week","requests","templates","stats","settings"].forEach(x=>$(`${x}Section`).classList.toggle("hidden",x!==s));
    $("sectionTitle").textContent={week:"Неделя",requests:"Предложения",templates:"Частые задачи",stats:"Статистика",settings:"Настройки"}[s];
    if(s==="requests")renderRequests();if(s==="templates")renderTemplates();if(s==="stats")renderStats();if(s==="settings")renderSettings();
  }

  function renderAll(){
    $("profileName").textContent=state.profile?.display_name||"Пользователь";
    $("profileEmail").textContent=state.profile?.email||state.user?.email||"";
    $("avatar").textContent=(state.profile?.display_name||"П").slice(0,1).toUpperCase();
    $("weekLabel").textContent=`${fmtDate(iso(state.weekStart))} — ${fmtDate(iso(new Date(state.weekStart.getTime()+6*86400000)))}`;
    renderWeek();renderRequests();renderTemplates();renderStats();renderSettings();updateTimerBar();
  }

  function visibleTasks(){
    let tasks=state.tasks.filter(t=>t.status!=="archived");
    if(state.person==="me")tasks=tasks.filter(t=>t.owner_id===currentUserId()&&t.visibility!=="shared");
    if(state.person==="shared")tasks=tasks.filter(t=>t.visibility==="shared");
    if(state.person==="other")tasks=[];
    return tasks;
  }

  function renderWeek(){
    $("weekLabel").textContent=`${fmtDate(iso(state.weekStart))} — ${fmtDate(iso(new Date(state.weekStart.getTime()+6*86400000)))}`;
    const base=visibleTasks();
    const tasks=expandOccurrences(base,state.weekStart,7);
    const trackTop=GRID_START_HOUR*60, trackBottom=GRID_END_HOUR*60;
    const trackHeight=Math.round((trackBottom-trackTop)/60*PX_PER_HOUR);
    const hourLines=[...Array(GRID_END_HOUR-GRID_START_HOUR+1)].map((_,i)=>
      `<div class="hour-line" style="top:${i*PX_PER_HOUR}px" data-h="${String(GRID_START_HOUR+i).padStart(2,"0")}:00"></div>`
    ).join("");
    const todayStr=iso(new Date());
    let html="";
    for(let i=0;i<7;i++){
      const d=new Date(state.weekStart);d.setDate(d.getDate()+i);const ds=iso(d);
      const dayTasks=tasks.filter(t=>t.date===ds);
      const total=dayTasks.reduce((a,t)=>a+minutes(t),0), pct=Math.min(100,total/600*100);
      const level=total>480?"high":total>300?"mid":"low";
      const untimed=dayTasks.filter(t=>!t.start_time);
      const placed=layoutDayTasks(dayTasks);
      const blocks=placed.map(t=>{
        const top=Math.max(0,(t._start-trackTop)/60*PX_PER_HOUR);
        const height=Math.max(30,(t._end-t._start)/60*PX_PER_HOUR);
        const widthPct=100/t._laneCount, leftPct=t._lane*widthPct;
        return `<div class="track-task" style="top:${top}px;height:${height}px;left:${leftPct}%;width:calc(${widthPct}% - 4px)">${taskBlockHtml(t)}</div>`;
      }).join("");
      let nowLine="";
      if(ds===todayStr){
        const nowMin=new Date().getHours()*60+new Date().getMinutes();
        if(nowMin>=trackTop&&nowMin<=trackBottom){
          nowLine=`<div class="now-line" style="top:${(nowMin-trackTop)/60*PX_PER_HOUR}px"></div>`;
        }
      }
      html+=`<div class="day-col">
        <div class="day-head"><span class="day-name">${dayName(i)}</span><span class="day-date">${fmtDate(ds)}</span></div>
        <div class="load-line"><span class="${level}" style="width:${pct}%"></span></div>
        <div class="small muted">${Math.floor(total/60)} ч ${total%60} мин</div>
        ${untimed.length?`<div class="untimed-list">${untimed.map(taskChipHtml).join("")}</div>`:""}
        <div class="day-track" style="height:${trackHeight}px">${hourLines}${nowLine}${blocks}</div>
      </div>`;
    }
    $("weekGrid").innerHTML=html;
  }

  function timerButtonHtml(actionId){
    const running=state.activeTimer && state.activeTimer.taskId===actionId;
    return `<button onclick="window.toggleTimer('${actionId}')" title="${running?"Остановить таймер":"Запустить таймер"}">${running?"⏹":"⏱"}</button>`;
  }

  function taskChipHtml(t){
    const done=t.status==="done";
    const actionId=t.seriesId||t.id;
    const tracked=trackedMinutesFor(actionId);
    return `<div class="task-chip ${t.priority||"optional"} ${done?"done":""}">
      <input class="check" type="checkbox" ${done?"checked":""} onchange="window.weekToggle('${actionId}',this.checked)">
      <span class="task-title">${esc(t.title)}${t.recurrence?" 🔁":""}</span>
      <span class="task-meta">${minutes(t)} мин${tracked?` • ⏱${tracked}м`:""}${t.visibility==="shared"?" • Общая":""}</span>
      <span class="task-actions">${timerButtonHtml(actionId)}<button onclick="window.weekEdit('${actionId}')">✎</button><button onclick="window.weekDelete('${actionId}')">🗑</button></span>
    </div>`;
  }

  function taskBlockHtml(t){
    const done=t.status==="done";
    const actionId=t.seriesId||t.id;
    const tracked=trackedMinutesFor(actionId);
    return `<article class="task ${t.priority||"optional"} ${done?"done":""}">
      <div><input class="check" type="checkbox" ${done?"checked":""} onchange="event.stopPropagation();window.weekToggle('${actionId}',this.checked)"><span class="task-title">${esc(t.title)}${t.recurrence?" 🔁":""}</span></div>
      <div class="task-meta"><span>${esc(t.start_time.slice(0,5))}</span><span>•</span><span>${minutes(t)} мин</span>${t.fixed_time?"<span>• фикс.</span>":""}${tracked?`<span>• ⏱${tracked}м</span>`:""}</div>
      <div class="task-actions">${timerButtonHtml(actionId)}<button onclick="window.weekEdit('${actionId}')">✎</button><button onclick="window.weekDelete('${actionId}')">🗑</button>${t.visibility==="shared"?"<span class='small muted'>Общая</span>":""}</div>
    </article>`;
  }

  function openTask(task=null){
    $("taskModalTitle").textContent=task?"Изменить задачу":"Новая задача";
    $("taskId").value=task?.id||"";
    $("taskTitle").value=task?.title||"";
    $("taskDescription").value=task?.description||"";
    $("taskDate").value=task?.date||iso(new Date());
    $("taskTime").value=task?.start_time?.slice(0,5)||"";
    $("taskDuration").value=task?.duration||Number(localStorage.getItem("week-default-duration")||60);
    $("taskDeadline").value=task?.deadline?new Date(task.deadline).toISOString().slice(0,16):"";
    $("taskCategory").value=task?.category||"Школа";
    $("taskPriority").value=task?.priority||"mandatory";
    $("taskFixed").checked=!!task?.fixed_time;
    $("taskRecurring").checked=!!task?.recurrence;
    $("recurrenceBox").classList.toggle("hidden",!task?.recurrence);
    $("taskRecurrence").value=task?.recurrence||"weekly";
    qsa('input[name="destination"]').forEach(r=>r.checked=r.value===(task?.visibility==="shared"?"shared":"private"));
    $("proposalHint").classList.add("hidden");
    $("taskModal").classList.remove("hidden");
    setTaskModalNav(true);
  }

  async function saveTask(e){
    e.preventDefault();
    const id=$("taskId").value;
    const dest=qs('input[name="destination"]:checked').value;
    const base={
      title:$("taskTitle").value.trim(),description:$("taskDescription").value.trim()||null,
      date:$("taskDate").value,start_time:$("taskTime").value||null,
      duration:Number($("taskDuration").value)||60,deadline:$("taskDeadline").value?new Date($("taskDeadline").value).toISOString():null,
      category:$("taskCategory").value,priority:$("taskPriority").value,fixed_time:$("taskFixed").checked,
      recurrence:$("taskRecurring").checked?$("taskRecurrence").value:null
    };
    if(!base.title)return;
    localStorage.setItem("week-default-duration", String(base.duration));
    if(state.demo){
      if(id){const t=demoData.tasks.find(x=>x.id===id);if(t)Object.assign(t,base)}
      else if(dest==="proposal"){demoData.requests.push({id:uid(),from_user_id:currentUserId(),to_user_id:otherId(),title:base.title,description:base.description,date:base.date,start_time:base.start_time,duration:base.duration,category:base.category,priority:base.priority,status:"pending",created_at:new Date().toISOString()})}
      else demoData.tasks.push({id:uid(),owner_id:currentUserId(),visibility:dest==="shared"?"shared":"private",status:"open",...base});
      saveDemo();loadDemo();
    }else{
      if(id){
        const {error}=await sb.from("tasks").update(base).eq("id",id).eq("owner_id",state.user.id);
        if(error){toast(error.message);return}
      }
      else if(dest==="proposal"){
        const other=await getOtherUser();
        if(!other){toast("Второй пользователь ещё не зарегистрирован");return}
        const {error}=await sb.from("task_requests").insert({...base,from_user_id:state.user.id,to_user_id:other.id,status:"pending"});
        if(error){toast(error.message);return}
      }else{
        const {error}=await sb.from("tasks").insert({...base,owner_id:state.user.id,visibility:dest==="shared"?"shared":"private",status:"open"});
        if(error){toast(error.message);return}
      }
      await reloadCloud();
    }
    if(dest!=="proposal"){
      state.person=dest==="shared"?"shared":"me";
      qsa("[data-person]").forEach(x=>x.classList.toggle("active",x.dataset.person===state.person));
      state.weekStart=startOfWeek(new Date(base.date+"T00:00:00"));
    }
    $("taskModal").classList.add("hidden");
    setTaskModalNav(false);
    renderAll();toast(id?"Задача обновлена":dest==="proposal"?"Предложение отправлено":"Задача создана");
  }

  window.weekToggle=async(id,checked)=>{
    if(state.demo){const t=demoData.tasks.find(x=>x.id===id);if(t)t.status=checked?"done":"open";saveDemo();loadDemo()}
    else await sb.from("tasks").update({status:checked?"done":"open"}).eq("id",id);
    await reloadCloud();renderWeek();scheduleNotifications();
  };
  window.weekEdit=id=>{const t=state.tasks.find(x=>x.id===id);if(t)openTask(t)};
  window.weekDelete=async id=>{
    const t=state.tasks.find(x=>x.id===id);
    if(!confirm(t?.recurrence?"Удалить всю серию повторяющихся задач?":"Удалить задачу?"))return;
    if(state.demo){demoData.tasks=demoData.tasks.filter(x=>x.id!==id);saveDemo();loadDemo()}else await sb.from("tasks").delete().eq("id",id).eq("owner_id",state.user.id);
    await reloadCloud();renderWeek();toast("Удалено");
  };

  function renderRequests(){
    const el=$("requestsList");
    if(!state.requests.length){el.innerHTML='<p class="muted">Новых предложений нет.</p>';return}
    el.innerHTML=state.requests.map(r=>`<div class="request-card">
      <strong>${esc(r.title)}</strong>
      <div class="task-meta">${fmtDate(r.date)}${r.start_time?" • "+r.start_time.slice(0,5):""} • ${r.duration||60} мин • ${esc(r.category||"Другое")}</div>
      <p>${esc(r.description||"Без описания")}</p>
      <div class="actions"><button class="primary" onclick="window.acceptRequest('${r.id}')">Принять</button><button class="secondary" onclick="window.rejectRequest('${r.id}')">Отклонить</button><button class="secondary" onclick="window.counterRequest('${r.id}')">Предложить другое время</button></div>
    </div>`).join("");
  }
  window.acceptRequest=async id=>{
    const r=state.requests.find(x=>x.id===id);if(!r)return;
    if(state.demo){demoData.requests=demoData.requests.filter(x=>x.id!==id);demoData.tasks.push({id:uid(),owner_id:r.from_user_id,visibility:"shared",status:"open",title:r.title,description:r.description,date:r.date,start_time:r.start_time,duration:r.duration,category:r.category,priority:r.priority});saveDemo();loadDemo()}
    else{
      // The recipient accepts the proposal, so the shared task must be created
      // with the recipient as owner. RLS policies allow the authenticated user
      // to insert rows only for their own owner_id. The shared visibility makes
      // the task visible to both users.
      const {error:taskError}=await sb.from("tasks").insert({owner_id:state.user.id,visibility:"shared",status:"open",title:r.title,description:r.description,date:r.date,start_time:r.start_time,duration:r.duration,category:r.category,priority:r.priority});
      if(taskError){toast(`Не удалось принять предложение: ${taskError.message}`);return}
      const {error:requestError}=await sb.from("task_requests").update({status:"accepted"}).eq("id",id).eq("to_user_id",state.user.id);
      if(requestError){toast(`Задача создана, но статус предложения не обновился: ${requestError.message}`);await reloadCloud();return}
      await reloadCloud();
    }
    renderAll();toast("Предложение принято");
  };
  window.rejectRequest=async id=>{
    if(state.demo){demoData.requests=demoData.requests.map(r=>r.id===id?{...r,status:"rejected"}:r);demoData.requests=demoData.requests.filter(r=>r.status==="pending");saveDemo();loadDemo()}
    else{await sb.from("task_requests").update({status:"rejected"}).eq("id",id).eq("to_user_id",state.user.id);await reloadCloud()}
    renderRequests();toast("Предложение отклонено");
  };
  window.counterRequest=id=>{
    const r=state.requests.find(x=>x.id===id);if(!r)return;
    $("taskModal").classList.remove("hidden");
    setTaskModalNav(true);
    $("taskModalTitle").textContent="Предложить другое время";
    $("taskId").value="";$("taskTitle").value=r.title;$("taskDescription").value=r.description||"";
    $("taskDate").value=r.date;$("taskTime").value=r.start_time?.slice(0,5)||"";$("taskDuration").value=r.duration||60;
    $("taskCategory").value=r.category||"Другое";$("taskPriority").value=r.priority||"desirable";
    qs('input[name="destination"][value="proposal"]').checked=true;$("proposalHint").classList.remove("hidden");
  };

  function renderTemplates(){
    $("templatesList").innerHTML=state.templates.length?state.templates.map(t=>`<div class="template"><strong>${esc(t.title)}</strong><div class="task-meta">${esc(t.category)} • ${t.duration} мин • ${priorityLabel(t.priority)}</div><button class="secondary" style="margin-top:12px" onclick="window.useTemplate('${t.id}')">Добавить в неделю</button></div>`).join(""):"<p class='muted'>Шаблонов пока нет.</p>";
  }
  window.useTemplate=id=>{
    const t=state.templates.find(x=>x.id===id);if(!t)return;
    openTask();$("taskTitle").value=t.title;$("taskCategory").value=t.category;$("taskDuration").value=t.duration;$("taskPriority").value=t.priority;
  };
  async function saveTemplate(e){
    e.preventDefault();
    const t={id:uid(),user_id:currentUserId(),title:$("templateTitle").value.trim(),category:$("templateCategory").value,duration:Number($("templateDuration").value)||60,priority:$("templatePriority").value};
    if(state.demo){demoData.templates.push(t);saveDemo();loadDemo()}else{const {error}=await sb.from("task_templates").insert({...t,id:undefined});if(error){toast(error.message);return}await reloadCloud()}
    $("templateModal").classList.add("hidden");renderTemplates();toast("Шаблон сохранён");
  }

  function weekTasksForStats(){
    return expandOccurrences(state.tasks.filter(t=>t.status!=="archived"),state.weekStart,7);
  }
  function freeWindowsForDay(dayTasks){
    const timed=dayTasks.filter(t=>t.start_time).map(t=>({
      start:Math.max(0,toMin(t.start_time)),
      end:Math.min(1440,toMin(t.start_time)+minutes(t))
    })).filter(x=>x.end>x.start).sort((a,b)=>a.start-b.start);
    const gaps=[];
    let cursor=0;
    for(const x of timed){
      if(x.start>cursor)gaps.push([cursor,x.start]);
      cursor=Math.max(cursor,x.end);
    }
    if(cursor<1440)gaps.push([cursor,1440]);
    return gaps.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0])).slice(0,3);
  }

  function hm(min){
    const h=Math.floor(min/60),m=min%60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }

  function renderStats(){
    const ts=weekTasksForStats(),total=ts.reduce((a,t)=>a+minutes(t),0),done=ts.filter(t=>t.status==="done").length;
    const avg=total/7;
    const loaded=[...Array(7)].map((_,i)=>ts.filter(t=>t.date===iso(new Date(state.weekStart.getTime()+i*86400000))).reduce((a,t)=>a+minutes(t),0));
    const max=loaded.indexOf(Math.max(...loaded));
    const weekEnd=new Date(state.weekStart.getTime()+7*86400000);
    const trackedMin=state.timeLogs.filter(l=>l.ended_at && new Date(l.started_at)>=state.weekStart && new Date(l.started_at)<weekEnd)
      .reduce((a,l)=>a+Math.round((new Date(l.ended_at)-new Date(l.started_at))/60000),0);
    const pct=ts.length?Math.round(done/ts.length*100):0;
    const busiest=loaded[max]||0;
    $("statsCards").innerHTML=[
      ["Запланировано",`${Math.floor(total/60)}ч ${total%60}м`],
      ["Задач",ts.length],
      ["Выполнено",`${done}/${ts.length||0}`],
      ["Прогресс",`${pct}%`],
      ["Среднее в день",`${Math.floor(avg/60)}ч ${Math.round(avg%60)}м`],
      ["Отслежено таймером",`${Math.floor(trackedMin/60)}ч ${trackedMin%60}м`]
    ].map(x=>`<div class="stat"><span class="muted">${x[0]}</span><strong>${x[1]}</strong></div>`).join("");
    const maxVal=Math.max(...loaded,1);
    $("statsBars").innerHTML=loaded.map((v,i)=>`<div class="bar-wrap"><div class="small">${Math.round(v/60*10)/10}ч</div><div class="bar" style="height:${Math.max(3,v/maxVal*170)}px"></div><div class="bar-label">${dayName(i)}</div></div>`).join("");
    const cats={};ts.forEach(t=>cats[t.category]=(cats[t.category]||0)+minutes(t));
    $("categoryStats").innerHTML=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`<div class="category-row"><span>${esc(c)}</span><strong>${Math.floor(v/60)}ч ${v%60}м</strong></div>`).join("")||"<p class='muted'>Нет задач.</p>";

    const sentence=ts.length
      ? `За неделю выполнено ${pct}% задач — ${done} из ${ts.length}. Самый загруженный день: ${dayName(max)} (${Math.floor(busiest/60)}ч ${busiest%60}м).`
      : "На этой неделе пока нет задач. Можно спокойно начать с первой.";
    const pulse=$("weekPulse");
    if(pulse)pulse.innerHTML=`<strong>${esc(sentence)}</strong><span class="muted small">Свободное время считается только по задачам, которые тебе разрешено видеть.</span>`;

    const free=$("freeTimeList");
    if(free){
      free.innerHTML=[...Array(7)].map((_,i)=>{
        const ds=iso(new Date(state.weekStart.getTime()+i*86400000));
        const dayTasks=ts.filter(t=>t.date===ds);
        const gaps=freeWindowsForDay(dayTasks);
        const gapsHtml=gaps.length?gaps.map(g=>`<span>${hm(g[0])}–${hm(g[1])}</span>`).join(""):`<span class="muted">нет свободного окна</span>`;
        return `<div class="free-day"><div><strong>${dayName(i)}</strong><span class="muted small">${fmtDate(ds)}</span></div><div class="free-gaps">${gapsHtml}</div></div>`;
      }).join("");
    }
  }

  function renderSettings(){
    $("settingsName").value=state.profile?.display_name||"";
    $("defaultDuration").value=localStorage.getItem("week-default-duration")||60;
    const ns=notificationSettings();
    if($("notificationsEnabled")){ $("notificationsEnabled").checked=ns.enabled; $("notificationLead").value=String(ns.lead); }
  }
  async function saveSettings(){
    const name=$("settingsName").value.trim()||"Пользователь";
    localStorage.setItem("week-default-duration", String(Number($("defaultDuration").value)||60));
    saveNotificationSettings();
    await syncPushSubscription();
    if(state.demo){state.profile.display_name=name;demoData.profiles[0].display_name=name;saveDemo()}else{await sb.from("profiles").update({display_name:name}).eq("id",state.user.id);state.profile.display_name=name}
    renderAll();toast("Настройки сохранены");
  }
  function exportData(){
    const data={exported_at:new Date().toISOString(),profile:state.profile,tasks:state.tasks,requests:state.requests,templates:state.templates};
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));a.download="week-backup.json";a.click();URL.revokeObjectURL(a.href);
  }
  function importData(e){
    const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(reader.result);if(Array.isArray(data.tasks)){demoData.tasks.push(...data.tasks);saveDemo();loadDemo();renderAll();toast("Импортировано")}else toast("Неверный файл")}catch{toast("Не удалось прочитать JSON")}};reader.readAsText(file);
  }

  setInterval(async()=>{if(!state.demo && state.user){const before=state.requests.length;await reloadCloud();if(state.requests.length>before && "Notification" in window && Notification.permission==="granted" && notificationSettings().enabled)new Notification("week.",{body:"Новое предложение задачи",tag:"week-request"});renderRequests();}},60000);
  boot();
})();
