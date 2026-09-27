(() => {
  const hasSupabase = !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);
  const sb = hasSupabase ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY) : null;
  const $ = id => document.getElementById(id);
  const qs = s => document.querySelector(s);
  const qsa = s => [...document.querySelectorAll(s)];

  let state = {
    user:null, profile:null, section:"week", person:"me",
    weekStart: startOfWeek(new Date()), currentDate: new Date(), calendarView:localStorage.getItem("week-calendar-view")==="week"?"week":"day", tasks:[], requests:[], sentRequests:[], templates:[], timeLogs:[], activeTimer:null,
    friends:[], friendRequests:[], sentFriendRequests:[], schedule:[], completionDays:[], movingTaskId:null, draggedTaskId:null,
    demo: !hasSupabase, authMode:"login", onboardingStep:1, sendingFriendIds:new Set()
  };

  const demoData = {
    profiles:[
      {id:"demo-vadim",display_name:"Вадим",username:"vadim",email:"vadim@demo",onboarding_completed:false,studies_at_school:null},
      {id:"demo-sonya",display_name:"Соня",username:"sonya",email:"sonya@demo",onboarding_completed:false,studies_at_school:null}
    ],
    tasks:[], requests:[], templates:[
      {id:"t1",title:"Сделать домашку",category:"Школа",duration:60,priority:"mandatory"},
      {id:"t2",title:"Подготовка к репетитору",category:"Репетитор",duration:45,priority:"desirable"}
    ], timeLogs:[], schedules:[], completionDays:[], friendships:[{user_a:"demo-vadim",user_b:"demo-sonya"}], friendRequests:[]
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

  const APP_CFG=window.APP_CONFIG||{};
  const GRID_START_HOUR=Number(APP_CFG.dayStartHour??0), GRID_END_HOUR=Number(APP_CFG.dayEndHour??24), PX_PER_HOUR=56;
  const LOADING_MIN_MS=5000;
  const splashStartedAt=window.__weekSplashStart||Date.now();
  const loadingMessages=[
    "Начни с одного главного дела — и день уже пойдёт лучше.",
    "Маленький шаг сегодня лучше, чем идеальный план завтра.",
    "Не перегружай день: 3 важных задачи вполне достаточно.",
    "Если дело занимает 2 минуты — сделай его сразу.",
    "Оставь немного свободного времени: паузы тоже часть продуктивности.",
    "Не жди мотивации — начни с первого маленького действия.",
    "Сложную задачу проще победить, если разбить её на шаги.",
    "Сначала важное, потом срочное — так спокойнее жить.",
    "Даже 20 минут фокуса могут сильно продвинуть тебя вперёд.",
    "Отмечай завершённые дела — это помогает видеть прогресс.",
    "Один хороший день складывается из нескольких простых решений.",
    "План нужен не для давления, а чтобы освободить голову.",
    "Сегодня не обязательно успеть всё. Достаточно сделать главное.",
    "Регулярность почти всегда сильнее редких рывков.",
    "Не забывай про отдых: энергия — тоже ресурс."];

  function resolveTheme(theme){
    return theme==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):theme;
  }
  function randomLoadingMessage(){
    // Один совет на день, меняется на следующий день в часовом поясе пользователя.
    const now=new Date();
    const localDay=Math.floor(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())/86400000);
    return loadingMessages[(localDay*7)%loadingMessages.length]||loadingMessages[0];
  }
  function updateLoadingScreen(){
    const message=$("loadingMessage");
    if(message && !message.dataset.filled){message.textContent=randomLoadingMessage();message.dataset.filled="1";}
  }
  function finishLoadingScreen(){
    const screen=$("loadingScreen");
    if(!screen||screen.dataset.done)return;
    screen.dataset.done="1";
    const delay=Math.max(0,LOADING_MIN_MS-(Date.now()-splashStartedAt));
    setTimeout(()=>screen.classList.add("hide"),delay);
  }

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

  // Keep checklists as compact JSON arrays on their tasks (no extra tables or uploads).
  function checklistFor(t){return Array.isArray(t?.checklist)?t.checklist.filter(x=>x&&typeof x.text==="string"):[]}
  function checklistSummary(t){
    const items=checklistFor(t);
    return items.length?`<button class="checklist-link" type="button" onclick="window.openChecklist('${t.seriesId||t.id}')" title="Открыть чек-лист">☑ ${items.filter(x=>x.done).length}/${items.length}</button>`:"";
  }
  function ownOverdueTasks(){
    const today=iso(new Date());
    return state.tasks.filter(t=>t.owner_id===currentUserId()&&t.status==="open"&&!t.recurrence&&t.date<today).sort((a,b)=>a.date.localeCompare(b.date));
  }
  function currentFormTask(){
    return {date:$("taskDate").value,start_time:$("taskTime").value||null,
      duration:Math.max(5,Number($("taskDuration").value)||60),
      recurrence:$("taskRecurring").checked?$("taskRecurrence").value:null};
  }
  function occursOn(t,ds){
    if(ds<t.date)return false;
    if(!t.recurrence)return ds===t.date;
    const d=new Date(ds+"T00:00:00"),base=new Date(t.date+"T00:00:00");
    return t.recurrence==="daily" || (t.recurrence==="weekly"&&d.getDay()===base.getDay()) ||
      (t.recurrence==="weekdays"&&d.getDay()!==0&&d.getDay()!==6);
  }
  function taskConflicts(candidate,editingId=""){
    if(!candidate.date||!candidate.start_time)return [];
    if(qs('input[name="destination"]:checked')?.value==="proposal")return [];
    const start=new Date(candidate.date+"T00:00:00");
    if(Number.isNaN(start.getTime()))return [];
    const first=candidate.recurrence&&start<new Date(iso(new Date())+"T00:00:00")?new Date(iso(new Date())+"T00:00:00"):start;
    const count=candidate.recurrence?35:1, result=[];
    for(let i=0;i<count;i++){
      const d=new Date(first);d.setDate(first.getDate()+i);const ds=iso(d);
      if(!occursOn(candidate,ds))continue;
      const left=toMin(candidate.start_time),right=left+candidate.duration;
      for(const t of visibleTasks()){
        if(t.id===editingId||!t.start_time||!occursOn(t,ds))continue;
        if(left<toMin(t.start_time)+minutes(t)&&right>toMin(t.start_time))
          result.push({date:ds,title:t.title,time:String(t.start_time).slice(0,5),kind:"task"});
      }
      // School and additional classes are recurring weekly schedule blocks.
      for(const item of state.schedule||[]){
        if(Number(item.day_of_week)!==d.getDay()||!item.start_time||!item.end_time)continue;
        if(left<toMin(item.end_time)&&right>toMin(item.start_time))
          result.push({date:ds,title:item.title,time:String(item.start_time).slice(0,5),kind:"schedule"});
      }
      if(result.length>=5)break;
    }
    return result;
  }
  function updateConflictWarning(){
    const box=$("taskConflictWarning"), override=$("taskConflictOverride");
    if(!box||$("taskModal").classList.contains("hidden"))return;
    const found=taskConflicts(currentFormTask(),$("taskId").value);
    box.classList.toggle("hidden",!found.length);
    if(!found.length){override.checked=false;return}
    $("taskConflictList").innerHTML=found.slice(0,4).map(c=>
      `<li><strong>${fmtDate(c.date)}</strong>, ${esc(c.time)} — ${esc(c.title)}${c.kind==="schedule"?" (занятие)":""}</li>`).join("");
    $("taskConflictExtra").textContent=found.length>4?"Показаны первые четыре совпадения.":"";
  }

  // One lightweight entry per user and calendar day, regardless of task count.
  // This is a completion-activity streak, not a count of planned lessons.
  async function recordCompletionDay(){
    const day=iso(new Date());
    if(state.demo){
      demoData.completionDays ||= [];
      if(!demoData.completionDays.some(x=>x.user_id===currentUserId()&&x.day===day))
        demoData.completionDays.push({user_id:currentUserId(),day});
      saveDemo();loadDemo();return;
    }
    const {error}=await sb.from("task_completion_days").upsert({user_id:state.user.id,day},{onConflict:"user_id,day",ignoreDuplicates:true});
    if(error){console.warn("Streak save failed:",error);toast("Задача выполнена, но серия не записана. Проверь MIGRATION_2_0.sql");return}
    if(!state.completionDays.includes(day))state.completionDays.push(day);
  }

  function trackedMinutesFor(taskId){
    return state.timeLogs.filter(l=>l.task_id===taskId&&l.ended_at)
      .reduce((a,l)=>a+Math.round((new Date(l.ended_at)-new Date(l.started_at))/60000),0);
  }

  function currentUserId(){return state.user?.id || "demo-vadim";}
  function normalizeUsername(v=""){return v.trim().replace(/^@/,'').toLowerCase().replace(/[^a-z0-9_а-яё-]/gi,'').slice(0,24)}
  function friendById(id){return state.friends.find(f=>f.id===id)||null}
  function fillFriendPicker(selected=""){
    const el=$("taskFriend"); if(!el)return;
    if(!state.friends.length){el.innerHTML='<option value="">Сначала добавь друга</option>';return}
    el.innerHTML=state.friends.map(f=>`<option value="${f.id}" ${f.id===selected?'selected':''}>${esc(f.display_name)}${f.username?` · @${esc(f.username)}`:""}</option>`).join("");
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
    updateLoadingScreen();
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
    state.requests=demoData.requests.filter(r=>r.to_user_id===currentUserId()&&r.status!=="rejected");
    state.sentRequests=demoData.requests.filter(r=>r.from_user_id===currentUserId());
    state.templates=demoData.templates;
    state.timeLogs=(demoData.timeLogs||[]).filter(l=>l.user_id===currentUserId());
    const friendIds=(demoData.friendships||[]).filter(x=>x.user_a===currentUserId()||x.user_b===currentUserId()).map(x=>x.user_a===currentUserId()?x.user_b:x.user_a);
    state.friends=demoData.profiles.filter(p=>friendIds.includes(p.id));
    state.friendRequests=(demoData.friendRequests||[]).filter(r=>r.to_user_id===currentUserId()&&r.status==="pending");
    state.sentFriendRequests=(demoData.friendRequests||[]).filter(r=>r.from_user_id===currentUserId()&&r.status==="pending");
    state.schedule=(demoData.schedules||[]).filter(r=>r.user_id===currentUserId());
    state.completionDays=(demoData.completionDays||[]).filter(x=>x.user_id===currentUserId()).map(x=>x.day);
    state.__profiles=demoData.profiles;
    restoreActiveTimer();
    scheduleNotifications();
  }
  function saveDemo(){localStorage.setItem("week-demo",JSON.stringify(demoData))}
  function showAuth(){$("authView").classList.remove("hidden");$("appView").classList.add("hidden");finishLoadingScreen()}
  function showApp(){$("authView").classList.add("hidden");$("appView").classList.remove("hidden");renderAll();updateNotificationStatus();finishLoadingScreen()}

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
    maybeShowOnboarding();
    setupRealtimeNotifications();
    await syncPushSubscription();
  }
  async function reloadCloud(){
    if(state.demo){loadDemo();return}
    const cutoff=new Date();cutoff.setDate(cutoff.getDate()-60);
    const [{data:tasks,error:tasksErr},{data:requests,error:reqErr},{data:sentRequests,error:sentReqErr},{data:templates,error:tplErr},{data:logs,error:logsErr},{data:friendRows,error:friendsErr},{data:friendRequests,error:friendReqErr},{data:sentFriendRequests,error:sentFriendReqErr},{data:schedule,error:scheduleErr},{data:completionRows,error:completionErr}]=await Promise.all([
      sb.from("tasks").select("*").order("date").order("start_time"),
      sb.from("task_requests").select("*").eq("to_user_id",state.user.id).eq("status","pending").order("created_at",{ascending:false}),
      sb.from("task_requests").select("*").eq("from_user_id",state.user.id).order("created_at",{ascending:false}).limit(50),
      sb.from("task_templates").select("*").eq("user_id",state.user.id).order("created_at",{ascending:false}),
      sb.from("time_logs").select("*").eq("user_id",state.user.id).gte("started_at",cutoff.toISOString()).order("started_at",{ascending:false}),
      sb.from("friendships").select("user_a,user_b").or(`user_a.eq.${state.user.id},user_b.eq.${state.user.id}`),
      sb.from("friend_requests").select("id,from_user_id,to_user_id,status,created_at").eq("to_user_id",state.user.id).eq("status","pending").order("created_at",{ascending:false}),
      sb.from("friend_requests").select("id,from_user_id,to_user_id,status,created_at").eq("from_user_id",state.user.id).eq("status","pending").order("created_at",{ascending:false}),
      sb.from("schedule_items").select("*").eq("user_id",state.user.id).order("day_of_week").order("start_time"),
      sb.from("task_completion_days").select("day").eq("user_id",state.user.id).order("day",{ascending:false}).limit(500)
    ]);
    const friendIds=(friendRows||[]).map(r=>r.user_a===state.user.id?r.user_b:r.user_a);
    const requesterIds=(friendRequests||[]).map(r=>r.from_user_id);
    const profileIds=[...new Set([...friendIds,...requesterIds])];
    const {data:friendProfiles}=profileIds.length?await sb.from("profiles").select("id,display_name,username").in("id",profileIds):{data:[]};
    const allErr=tasksErr||reqErr||sentReqErr||tplErr||logsErr||friendsErr||friendReqErr||sentFriendReqErr||scheduleErr;
    if(completionErr)console.warn("Для серии выполнений нужна MIGRATION_2_0.sql",completionErr.message);
    if(allErr){console.error("reloadCloud error",allErr);toast(`Ошибка загрузки: ${allErr.message}`)}
    state.tasks=tasks||[];state.requests=requests||[];state.sentRequests=sentRequests||[];state.templates=templates||[];state.timeLogs=logs||[];
    state.friends=(friendProfiles||[]).filter(p=>friendIds.includes(p.id));
    state.__profiles=friendProfiles||[];
    state.friendRequests=friendRequests||[];state.sentFriendRequests=sentFriendRequests||[];state.schedule=schedule||[];
    state.completionDays=(completionRows||[]).map(row=>row.day);
    restoreActiveTimer();scheduleNotifications();
    $("requestBadge").textContent=state.requests.length;$("requestBadge").classList.toggle("hidden",!state.requests.length);
    if($("friendBadge")){ $("friendBadge").textContent=state.friendRequests.length;$("friendBadge").classList.toggle("hidden",!state.friendRequests.length); }
  }

  function setupRealtimeNotifications(){
    if(state.demo||!sb||!state.user)return;
    if(state.__notificationChannel)sb.removeChannel(state.__notificationChannel);
    const channel=sb.channel(`week-notifications-${state.user.id}`)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"notification_events",filter:`recipient_id=eq.${state.user.id}`},async payload=>{
        const n=payload.new||{};
        if(n.type==="task_reminder")return;
        const body=n.body||"Новое событие";
        toast(body);
        if("Notification" in window && Notification.permission==="granted" && notificationSettings().enabled && document.visibilityState!=="visible")new Notification(n.title||"week.",{body,tag:`week-event-${n.id}`});
        await reloadCloud();
        renderAll();
      }).subscribe();
    state.__notificationChannel=channel;
  }

  function bindStatic(){
    bindTimelineActions();
    qsa("[data-auth]").forEach(b=>b.onclick=()=>{state.authMode=b.dataset.auth;qsa("[data-auth]").forEach(x=>x.classList.toggle("active",x===b));$("nameField").classList.toggle("hidden",state.authMode!=="signup");$("authSubmit").textContent=state.authMode==="signup"?"Создать аккаунт":"Войти"});
    $("authForm").onsubmit=authSubmit;
    $("demoBtn").onclick=()=>{state.demo=true;state.user=demoData.profiles[0];state.profile=state.user;loadDemo();showApp();toast("Открыт демо-режим")};
    $("logoutBtn").onclick=logout;
    $("profileBtn").onclick=()=>switchSection("profile");
    $("settingsBtn").onclick=()=>switchSection("settings");
    $("mobileSettingsBtn").onclick=()=>switchSection("settings");
    qsa(".nav-btn").forEach(b=>b.onclick=()=>switchSection(b.dataset.section));
    $("friendSearchForm").onsubmit=searchFriend;
    $("onboardingForm").onsubmit=finishOnboarding;
    $("onboardingNext").onclick=onboardingNext;
    $("onboardingBack").onclick=onboardingBack;
    $("onboardingClose").onclick=dismissOnboarding;
    $("onboardingSkip").onclick=dismissOnboarding;
    $("addSchoolItem").onclick=()=>addScheduleEditorRow("school");
    $("addExtraItem").onclick=()=>addScheduleEditorRow("extra");
    $("editScheduleBtn").onclick=()=>openOnboarding();
    $("prevWeek").onclick=()=>moveDay(state.calendarView==="week"?-7:-1);
    $("nextWeek").onclick=()=>moveDay(state.calendarView==="week"?7:1);
    qsa("[data-calendar-view]").forEach(b=>b.onclick=()=>{
      state.calendarView=b.dataset.calendarView;
      localStorage.setItem("week-calendar-view",state.calendarView);
      renderWeek();
    });
    $("overdueBtn").onclick=openOverdue;
    $("overdueApply").onclick=applyOverdue;
    $("overdueSelectAll").onchange=e=>qsa('#overdueList input[type="checkbox"]').forEach(input=>input.checked=e.target.checked);
    $("taskChecklistAdd").onclick=()=>addChecklistEditorRow({},true);
    $("taskChecklistRows").addEventListener("click",e=>{
      if(e.target.closest("[data-checklist-remove]"))e.target.closest(".checklist-edit-row").remove();
    });
    $("checklistItems").addEventListener("change",e=>{
      if(e.target.matches('[data-checklist-toggle]'))window.toggleChecklistItem(e.target.dataset.checklistToggle,e.target.checked);
    });
    $("checklistEditBtn").onclick=()=>{
      const t=state.tasks.find(x=>x.id===$("checklistModal").dataset.taskId);
      $("checklistModal").classList.add("hidden");if(t)openTask(t);
    };
    ["taskDate","taskTime","taskDuration","taskRecurrence","taskRecurring"].forEach(id=>{
      const changed=()=>{$("taskConflictOverride").checked=false;updateConflictWarning()};
      $(id).addEventListener("input",changed);
      $(id).addEventListener("change",changed);
    });
    $("todayBtn").onclick=()=>goToday();
    document.addEventListener("keydown",e=>{if(state.section!=="week"||$("taskModal")?.classList.contains("hidden")===false)return;if(["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName))return;if(e.key==="ArrowLeft")moveDay(state.calendarView==="week"?-7:-1);if(e.key==="ArrowRight")moveDay(state.calendarView==="week"?7:1)});
    let touchX=null;
    $("weekGrid").addEventListener("touchstart",e=>{touchX=e.changedTouches[0].clientX},{passive:true});
    $("weekGrid").addEventListener("touchend",e=>{if(touchX===null)return;if(state.movingTaskId){touchX=null;return}if(state.calendarView==="week"){touchX=null;return}const dx=e.changedTouches[0].clientX-touchX;touchX=null;if(Math.abs(dx)>45)moveDay(dx<0?(state.calendarView==="week"?7:1):(state.calendarView==="week"?-7:-1))},{passive:true});
    $("addTaskBtn").onclick=()=>openTask();
    $("addTemplateBtn").onclick=()=>$("templateModal").classList.remove("hidden");
    $("taskRecurring").onchange=e=>$("recurrenceBox").classList.toggle("hidden",!e.target.checked);
    qsa('input[name="destination"]').forEach(r=>r.onchange=()=>{updateDestinationUI();updateConflictWarning()});
    qsa("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).classList.add("hidden"));
    $("taskForm").onsubmit=saveTask;
    $("templateForm").onsubmit=saveTemplate;
    $("saveSettings").onclick=saveSettings;
    $("saveProfileBtn").onclick=saveProfile;
    if($("themeSelect")){$("themeSelect").value=localStorage.getItem("week-theme")||APP_CFG.theme||"system";$("themeSelect").onchange=e=>applyTheme(e.target.value)}
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
      const {data,error}=await sb.auth.signUp({email,password,options:{data:{display_name:displayName||email.split("@")[0],username:normalizeUsername(displayName||email.split("@")[0])}}});
      if(error){toast(error.message);return}
      toast(data.session?"Аккаунт создан":"Проверь почту для подтверждения");
    }else{
      const {error}=await sb.auth.signInWithPassword({email,password});
      if(error)toast(error.message);
    }
  }
  async function logout(){if(!state.demo)await sb.auth.signOut();else{state.user=null;showAuth()}}

  const sectionHeaders={
    requests:["Предложения","Новые задачи от друзей и ответы на твои предложения"],
    friends:["Друзья","Люди, с которыми удобно строить общие планы"],
    templates:["Частые задачи","Твои шаблоны для быстрого планирования"],
    stats:["Статистика","Посмотри, как проходит твоя неделя"],
    profile:["Мой профиль","Личные данные и твоё расписание"],
    settings:["Настройки","Оформление, уведомления и резервные копии"]
  };
  function updateSectionHeader(){
    const header=sectionHeaders[state.section];
    if(!header)return;
    $("sectionTitle").textContent=header[0];
    $("weekLabel").textContent=header[1];
  }
  function switchSection(s){
    state.section=s;
    qsa(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.section===s));
    $("profileBtn").classList.toggle("active",s==="profile");
    $("settingsBtn").classList.toggle("active",s==="settings");
    $("mobileSettingsBtn").classList.toggle("active",s==="settings");
    $("profileBtn").setAttribute("aria-pressed",String(s==="profile"));
    $("settingsBtn").setAttribute("aria-pressed",String(s==="settings"));
    $("mobileSettingsBtn").setAttribute("aria-pressed",String(s==="settings"));
    ["week","requests","friends","templates","stats","profile","settings"].forEach(x=>$(`${x}Section`).classList.toggle("hidden",x!==s));
    if(s==="week")renderWeek();
    if(s==="requests")renderRequests();
    if(s==="friends")renderFriends();
    if(s==="templates")renderTemplates();
    if(s==="stats")renderStats();
    if(s==="profile")renderProfile();
    if(s==="settings")renderSettings();
    updateSectionHeader();
  }


  const DAY_OPTIONS=[["1","Пн"],["2","Вт"],["3","Ср"],["4","Чт"],["5","Пт"],["6","Сб"],["0","Вс"]];
  function maybeShowOnboarding(){if(state.profile&&!state.profile.onboarding_completed&&localStorage.getItem("week-onboarding-dismissed")!=="1")openOnboarding();}
  window.dismissOnboarding=()=>{
    localStorage.setItem("week-onboarding-dismissed","1");
    $("onboardingModal").classList.add("hidden");
    toast("Расписание можно заполнить позже в профиле");
  };
  function openOnboarding(){
    state.onboardingStep=1;
    const school=state.profile?.studies_at_school===true?"yes":state.profile?.studies_at_school===false?"no":"";
    const hasExtra=(state.schedule||[]).some(x=>x.kind==="extra");
    qsa('input[name="school"]').forEach(x=>x.checked=x.value===school);
    qsa('input[name="extras"]').forEach(x=>x.checked=x.value===(hasExtra?"yes":state.profile?.onboarding_completed?"no":""));
    $("schoolScheduleList").innerHTML=""; $("extraScheduleList").innerHTML="";
    (state.schedule||[]).filter(x=>x.kind==="school").forEach(x=>addScheduleEditorRow("school",x));
    (state.schedule||[]).filter(x=>x.kind==="extra").forEach(x=>addScheduleEditorRow("extra",x));
    updateScheduleEmpty("school");updateScheduleEmpty("extra");
    $("onboardingModal").classList.remove("hidden");updateOnboardingUI();
  }
  function selectedRadio(name){return qs(`input[name="${name}"]:checked`)?.value||""}
  function updateOnboardingUI(){
    const step=state.onboardingStep;
    qsa(".onboarding-step").forEach(x=>x.classList.toggle("hidden",Number(x.dataset.step)!==step));
    qsa("#onboardingProgress span").forEach((x,i)=>x.classList.toggle("active",i<step));
    $("onboardingBack").classList.toggle("hidden",step===1);
    $("onboardingNext").classList.toggle("hidden",step===4);
    $("onboardingFinish").classList.toggle("hidden",step!==4);
    $("onboardingTitle").textContent=step===1?"Расскажем week. о твоём расписании":step===2?"Школьное расписание":step===3?"Дополнительные занятия":"Расписание дополнительных занятий";
    if(step===2&&selectedRadio("school")==="yes"&&!document.querySelector("#schoolScheduleList .schedule-row"))addScheduleEditorRow("school");
    if(step===4&&!document.querySelector("#extraScheduleList .schedule-row"))addScheduleEditorRow("extra");
  }
  function addScheduleEditorRow(type,item={}){
    const list=$(type==="school"?"schoolScheduleList":"extraScheduleList");
    const row=document.createElement("div");row.className="schedule-row";
    const day=String(item.day_of_week??"1");
    row.innerHTML=`<label>День<select data-field="day">${DAY_OPTIONS.map(([v,n])=>`<option value="${v}" ${v===day?"selected":""}>${n}</option>`).join("")}</select></label>
      <label>${type==="school"?"Предмет":"Занятие"}<input data-field="title" required value="${esc(item.title||"")}" placeholder="${type==="school"?"Например, математика":"Например, репетитор"}"></label>
      <label>Начало<input data-field="start" type="time" required value="${esc((item.start_time||"").slice(0,5))}"></label>
      <label>Конец<input data-field="end" type="time" required value="${esc((item.end_time||"").slice(0,5))}"></label>
      <button type="button" class="schedule-remove">×</button>`;
    row.querySelector(".schedule-remove").onclick=()=>{row.remove();updateScheduleEmpty(type)};
    list.appendChild(row);updateScheduleEmpty(type);
  }
  function updateScheduleEmpty(type){
    const list=$(type==="school"?"schoolScheduleList":"extraScheduleList");
    $(type==="school"?"schoolScheduleEmpty":"extraScheduleEmpty").classList.toggle("hidden",!!list.querySelector(".schedule-row"));
  }
  function collectSchedule(type){
    const list=$(type==="school"?"schoolScheduleList":"extraScheduleList");
    return [...list.querySelectorAll(".schedule-row")].map(row=>({
      kind:type,day_of_week:Number(row.querySelector('[data-field="day"]').value),
      title:row.querySelector('[data-field="title"]').value.trim(),
      start_time:row.querySelector('[data-field="start"]').value,
      end_time:row.querySelector('[data-field="end"]').value
    })).filter(x=>x.title&&x.start_time&&x.end_time);
  }
  function onboardingNext(){
    if(state.onboardingStep===1){
      if(!selectedRadio("school"))return toast("Выбери, учишься ли ты в школе");
      state.onboardingStep=selectedRadio("school")==="yes"?2:3;
    }else if(state.onboardingStep===2)state.onboardingStep=3;
    else if(state.onboardingStep===3){
      if(!selectedRadio("extras"))return toast("Выбери, есть ли дополнительные занятия");
      if(selectedRadio("extras")==="no")return finishOnboarding();
      state.onboardingStep=4;
    }
    updateOnboardingUI();
  }
  function onboardingBack(){
    if(state.onboardingStep===4)state.onboardingStep=3;
    else if(state.onboardingStep===3)state.onboardingStep=selectedRadio("school")==="yes"?2:1;
    else if(state.onboardingStep===2)state.onboardingStep=1;
    updateOnboardingUI();
  }
  async function finishOnboarding(e){
    e?.preventDefault();
    const school=selectedRadio("school"),extras=selectedRadio("extras");
    if(!school)return onboardingBack();
    if(school==="yes"&&!collectSchedule("school").length){state.onboardingStep=2;updateOnboardingUI();return toast("Добавь хотя бы один школьный урок");}
    if(!extras){state.onboardingStep=3;updateOnboardingUI();return toast("Выбери вариант про дополнительные занятия");}
    if(extras==="yes"&&!collectSchedule("extra").length){state.onboardingStep=4;updateOnboardingUI();return toast("Добавь хотя бы одно дополнительное занятие");}
    const items=[...collectSchedule("school"),...collectSchedule("extra")];
    if(state.demo){
      demoData.schedules=(demoData.schedules||[]).filter(x=>x.user_id!==currentUserId());
      demoData.schedules.push(...items.map(x=>({...x,id:uid(),user_id:currentUserId()})));
      const p=demoData.profiles.find(x=>x.id===currentUserId()); if(p){p.onboarding_completed=true;p.studies_at_school=school==="yes";state.profile=p;}
      saveDemo();loadDemo();
    }else{
      const d=await sb.from("schedule_items").delete().eq("user_id",state.user.id); if(d.error)return toast(d.error.message);
      if(items.length){const ins=await sb.from("schedule_items").insert(items.map(x=>({...x,user_id:state.user.id})));if(ins.error)return toast(ins.error.message);}
      const up=await sb.from("profiles").update({onboarding_completed:true,studies_at_school:school==="yes"}).eq("id",state.user.id).select().single();
      if(up.error)return toast(up.error.message);
      state.profile=up.data;state.schedule=items.map(x=>({...x,user_id:state.user.id}));
    }
    $("onboardingModal").classList.add("hidden");renderAll();toast("Расписание сохранено");
  }

  function renderAll(){
    $("profileName").textContent=state.profile?.display_name||"Пользователь";
    $("profileEmail").textContent=state.profile?.email||state.user?.email||"";
    $("avatar").textContent=(state.profile?.display_name||"П").slice(0,1).toUpperCase();
    renderWeek();renderRequests();renderFriends();renderTemplates();renderStats();renderProfile();renderSettings();updateTimerBar();updateSectionHeader();
  }

  function visibleTasks(){
    // Один календарь: личные задачи текущего пользователя + общие задачи.
    // Личные задачи других пользователей Supabase не отдаёт из-за RLS.
    return state.tasks.filter(t=>t.status!=="archived");
  }

  function selectedDate(){return new Date(state.currentDate.getFullYear(),state.currentDate.getMonth(),state.currentDate.getDate())}
  function syncWeekStart(){state.weekStart=startOfWeek(selectedDate())}
  function moveDay(delta){state.currentDate.setDate(state.currentDate.getDate()+delta);syncWeekStart();renderWeek();renderStats()}
  function goToday(){state.currentDate=new Date();syncWeekStart();renderWeek();renderStats()}
  function isToday(ds){return ds===iso(new Date())}
  function dayTitle(ds){
    const d=new Date(ds+"T00:00:00");
    const weekday=new Intl.DateTimeFormat("ru-RU",{weekday:"long"}).format(d);
    const date=new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long"}).format(d);
    return `${weekday[0].toUpperCase()+weekday.slice(1)}, ${date}`;
  }

  function clockTime(totalMinutes){
    const normalized=((totalMinutes%1440)+1440)%1440;
    return `${String(Math.floor(normalized/60)).padStart(2,"0")}:${String(normalized%60).padStart(2,"0")}`;
  }
  function timeRange(start,end){
    return `${clockTime(start)}–${clockTime(end)}${end>=1440?" (+1 день)":""}`;
  }

  function renderWeek(){
    const overdue=ownOverdueTasks();
    $("overdueBtn").classList.toggle("hidden",!overdue.length);
    $("overdueBtn").textContent=`↪ Перенести (${overdue.length})`;
    qsa("[data-calendar-view]").forEach(b=>{
      const active=b.dataset.calendarView===state.calendarView;
      b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active));
    });
    $("prevWeek").setAttribute("aria-label",state.calendarView==="week"?"Предыдущая неделя":"Предыдущий день");
    $("nextWeek").setAttribute("aria-label",state.calendarView==="week"?"Следующая неделя":"Следующий день");
    $("weekGrid").classList.toggle("week-overview",state.calendarView==="week");
    if(state.calendarView==="week"){renderWeekOverview();return}
    const ds=iso(selectedDate());
    syncWeekStart();
    if(state.section==="week"){
      $("weekLabel").textContent=isToday(ds)?"Сегодня":"";
      $("sectionTitle").textContent=dayTitle(ds);
    }
    const base=visibleTasks();
    const tasks=expandOccurrences(base,selectedDate(),1).filter(t=>t.date===ds);
    const timed=tasks.filter(t=>t.start_time);
    const jsDay=selectedDate().getDay();
    const daySchedule=(state.schedule||[]).filter(x=>Number(x.day_of_week)===jsDay);
    const total=tasks.reduce((a,t)=>a+minutes(t),0);
    const level=total>480?"high":total>300?"mid":"low";
    const untimed=tasks.filter(t=>!t.start_time);
    // The day view is a chronological agenda. Rows do not depend on task duration,
    // so even a five-minute task has fully accessible controls on mobile.
    const events=[
      ...timed.map(t=>({type:"task",start:toMin(t.start_time),end:toMin(t.start_time)+minutes(t),data:t})),
      ...daySchedule.filter(x=>x.start_time&&x.end_time).map(x=>({type:"schedule",start:toMin(x.start_time),end:toMin(x.end_time),data:x}))
    ].sort((a,b)=>a.start-b.start || a.end-b.end || (a.type==="schedule"?-1:1));
    // Keep an hour of context around the first/last event without displaying
    // the night. An early or late task expands the range so it remains visible.
    const agendaEntries=[];
    if(events.length){
      const first=events[0].start;
      const last=Math.max(...events.map(e=>e.end));
      const dayStart=Math.max(0,first<7*60?first-60:Math.max(7*60,first-60));
      const dayEnd=Math.min(1440,last>23*60?last+60:Math.min(23*60,last+60));
      // occupiedUntil is the end of the union of all occupied intervals.
      // Overlapping tasks must not create imaginary gaps.
      let occupiedUntil=dayStart;
      for(const event of events){
        if(event.start>occupiedUntil){
          agendaEntries.push({type:"free",start:occupiedUntil,end:event.start});
        }
        agendaEntries.push(event);
        occupiedUntil=Math.max(occupiedUntil,event.end);
      }
      if(occupiedUntil<dayEnd){
        agendaEntries.push({type:"free",start:occupiedUntil,end:dayEnd});
      }
    }
    const agenda=agendaEntries.map((e,index)=>{
      if(e.type==="free"){
        const duration=e.end-e.start;
        // Blank vertical space represents the interval. No "free" label is
        // drawn; hour markers continue the timeline between task cards.
        const height=Math.round(Math.max(24,Math.min(420,duration*.86)));
        const marks=[];
        const addMark=(minute,offset,edge="")=>{
          const label=minute===1440?"24:00":clockTime(minute);
          marks.push(`<div class="agenda-hour-mark ${edge}" style="top:${offset}px"><time>${label}</time><span aria-hidden="true"></span></div>`);
        };
        if(index===0)addMark(e.start,0,"agenda-hour-first");
        for(let minute=Math.ceil(e.start/60)*60;minute<e.end;minute+=60){
          if(minute<=e.start)continue;
          const offset=Math.round((minute-e.start)/duration*height);
          if(offset>15&&height-offset>15)addMark(minute,offset);
        }
        if(index===agendaEntries.length-1)addMark(e.end,height,"agenda-hour-last");
        return `<div class="agenda-row agenda-free-row" style="height:${height}px" data-gap-start="${e.start}" data-gap-end="${e.end}" data-gap-minutes="${duration}" data-date="${ds}" aria-label="Промежуток ${clockTime(e.start)}–${e.end===1440?"24:00":clockTime(e.end)}">
          <div class="agenda-free-space">${duration>=10?'<button type="button" class="gap-add-button" data-quick-add aria-label="Добавить задачу в этот промежуток" title="Добавить задачу здесь">＋</button>':""}</div>${marks.join("")}
        </div>`;
      }
      const range=`<div class="agenda-time" aria-label="${esc(timeRange(e.start,e.end))}"><time>${clockTime(e.start)}</time><span class="agenda-time-dash">–</span><time>${clockTime(e.end)}</time>${e.end>=1440?'<span class="agenda-next-day">+1 день</span>':""}</div>`;
      if(e.type==="schedule"){
        const item=e.data;
        return `<div class="agenda-row agenda-schedule-row">${range}<div class="schedule-track-item ${item.kind==="school"?"schedule-school":"schedule-extra"}"><strong>${esc(item.title)}</strong><span>${esc(item.kind==="school"?"Занятие":"Дополнительное занятие")}</span></div></div>`;
      }
      return `<div class="agenda-row agenda-task-row" data-task-id="${e.data.seriesId||e.data.id}" ${e.data.owner_id===currentUserId()&&!e.data.recurrence&&!(window.matchMedia&&window.matchMedia("(pointer: coarse)").matches)?'draggable="true" title="Перетащи задачу в свободный промежуток"':""}>${range}${taskBlockHtml(e.data)}</div>`;
    }).join("");
    const empty=!tasks.length && !events.length;
    $("weekGrid").innerHTML=`<div class="day-col ${isToday(ds)?"today-day":""}">
      <div class="day-head"><div><span class="day-name">${dayTitle(ds)}</span><div class="small muted">${isToday(ds)?"Текущий день":""}</div></div><span class="day-date">${fmtDate(ds)}</span></div>
      <div class="day-summary"><div><strong>${tasks.length}</strong><span> ${tasks.length===1?"задача":"задач"}</span></div><div class="load-line"><span class="${level}" style="width:${Math.min(100,total/600*100)}%"></span></div><span class="small muted">${Math.floor(total/60)} ч ${total%60} мин</span></div>
      ${untimed.length?`<div class="untimed-list"><div class="agenda-caption">Без времени</div>${untimed.map(taskChipHtml).join("")}</div>`:""}
      ${empty?`<div class="empty-day"><div class="empty-icon">○</div><strong>Нет дел на этот день</strong><span>Здесь пока нет задач</span><button class="secondary" onclick="window.openTaskForDate('${ds}')">+ Добавить задачу</button></div>`:`<div class="day-track agenda-track"><div class="agenda-caption">Расписание по времени</div>${agenda || '<div class="agenda-untimed-only">Задачи без указания времени находятся выше</div>'}</div>`}
    </div>`;
    $("prevWeek").classList.toggle("muted-nav",false);
  }

  function renderWeekOverview(){
    syncWeekStart();
    const dates=Array.from({length:7},(_,i)=>{const d=new Date(state.weekStart);d.setDate(d.getDate()+i);return d});
    const last=dates[6];
    if(state.section==="week"){
      $("sectionTitle").textContent=`${fmtDate(iso(dates[0]))} — ${fmtDate(iso(last))}`;
      $("weekLabel").textContent="Неделя · нажми на день, чтобы открыть подробное расписание";
    }
    const occurrences=expandOccurrences(visibleTasks(),state.weekStart,7);
    $("weekGrid").innerHTML=dates.map((date,i)=>{
      const ds=iso(date),tasks=occurrences.filter(t=>t.date===ds);
      const schedule=(state.schedule||[]).filter(x=>Number(x.day_of_week)===date.getDay()&&x.start_time);
      const timed=[...tasks.filter(t=>t.start_time).map(t=>({...t,_type:"task"})),
        ...schedule.map(x=>({...x,_type:"schedule"}))].sort((a,b)=>toMin(a.start_time)-toMin(b.start_time));
      const total=tasks.reduce((a,t)=>a+minutes(t),0);
      const level=total>480?"high":total>300?"mid":"low";
      return `<div class="week-day ${isToday(ds)?"today-day":""}">
        <button class="week-day-head" type="button" onclick="window.selectCalendarDay('${ds}')" aria-label="Открыть ${esc(dayTitle(ds))}">
          <span>${dayName(i)} <strong>${date.getDate()}</strong></span><span class="small muted">${tasks.length} задач</span>
        </button>
        <div class="load-line"><span class="${level}" style="width:${Math.min(100,total/600*100)}%"></span></div>
        <div class="week-day-content">
          ${tasks.filter(t=>!t.start_time).map(taskChipHtml).join("")}
          ${timed.map(t=>t._type==="schedule"?`<div class="week-schedule-item ${t.kind==="school"?"schedule-school":"schedule-extra"}"><span>${timeRange(toMin(t.start_time),toMin(t.end_time||t.start_time))}</span> ${esc(t.title)}</div>`:`<div class="week-task-item">${taskChipHtml(t)}</div>`).join("")}
          ${!tasks.length&&!schedule.length?'<p class="small muted week-empty">Свободно</p>':""}
        </div>
        <button type="button" class="secondary week-add" onclick="window.openTaskForDate('${ds}')">+ Задача</button>
      </div>`;
    }).join("");
  }
  window.selectCalendarDay=ds=>{
    state.currentDate=new Date(ds+"T00:00:00");state.calendarView="day";
    localStorage.setItem("week-calendar-view","day");renderWeek();renderStats();
  };
  window.openTaskForDate=ds=>{openTask();$("taskDate").value=ds;updateConflictWarning()};

  // Click in a free interval to create a task; drop or long-press to move one.
  // Snap to 5 minutes and never silently overlap another scheduled block.
  function gapTime(gap,clientY,duration){
    const start=Number(gap.dataset.gapStart),end=Number(gap.dataset.gapEnd);
    if(end-start<duration)return null;
    const rect=gap.getBoundingClientRect();
    const ratio=rect.height>0?Math.max(0,Math.min(1,(clientY-rect.top)/rect.height)):0;
    const raw=start+(end-start)*ratio;
    const snapped=Math.round(raw/5)*5;
    return Math.max(start,Math.min(snapped,end-duration,1440-duration));
  }
  function openTaskInGap(gap,clientY){
    const free=Number(gap.dataset.gapEnd)-Number(gap.dataset.gapStart);
    if(free<5){toast("В этом промежутке слишком мало времени");return}
    const preferred=Math.max(5,Number(localStorage.getItem("week-default-duration")||60));
    const duration=Math.min(Math.max(5,Math.floor(preferred/5)*5),Math.floor(free/5)*5);
    const start=gapTime(gap,clientY,duration);
    if(start===null)return;
    openTask();$("taskDate").value=gap.dataset.date;
    $("taskTime").value=clockTime(start);
    $("taskDuration").value=duration;
    updateConflictWarning();
  }
  function cancelMove(){
    state.movingTaskId=null;state.draggedTaskId=null;
    $("weekGrid").classList.remove("timeline-moving");
    $("timelineMoveHint").classList.add("hidden");
    qsa(".agenda-drag-source,.agenda-drop-hover").forEach(x=>x.classList.remove("agenda-drag-source","agenda-drop-hover"));
  }
  function startMove(id){
    const task=state.tasks.find(x=>x.id===id);
    if(!task||task.owner_id!==currentUserId()||task.recurrence){
      toast("Перемещение доступно для своих неповторяющихся задач");return;
    }
    state.movingTaskId=id;
    $("weekGrid").classList.add("timeline-moving");
    $("timelineMoveHint").classList.remove("hidden");
    qsa(".agenda-task-row").forEach(x=>x.classList.toggle("agenda-drag-source",x.dataset.taskId===id));
  }
  async function moveTaskToGap(id,gap,clientY){
    const task=state.tasks.find(x=>x.id===id);
    if(!task||task.owner_id!==currentUserId()||task.recurrence){toast("Такую задачу нельзя переместить здесь");cancelMove();return}
    const start=gapTime(gap,clientY,minutes(task));
    if(start===null){toast("Задача не помещается в выбранный промежуток");return}
    const date=gap.dataset.date,time=clockTime(start);
    if(date===task.date&&String(task.start_time||"").slice(0,5)===time){cancelMove();return}
    const candidate={...task,date,start_time:time};
    // The gap is computed from all task and schedule intervals. Recheck before persisting.
    const conflict=visibleTasks().some(t=>t.id!==id&&t.start_time&&occursOn(t,date)&&
      start<toMin(t.start_time)+minutes(t)&&start+minutes(task)>toMin(t.start_time)) ||
      state.schedule.some(item=>Number(item.day_of_week)===new Date(date+"T00:00:00").getDay()&&
        item.start_time&&item.end_time&&start<toMin(item.end_time)&&start+minutes(task)>toMin(item.start_time));
    if(conflict){toast("Это время уже занято. Выбери другой промежуток");return}
    if(state.demo){const original=demoData.tasks.find(x=>x.id===id);if(original){original.date=date;original.start_time=time;original.fixed_time=true}saveDemo();loadDemo()}
    else{
      const {error}=await sb.from("tasks").update({date,start_time:time,fixed_time:true}).eq("id",id).eq("owner_id",state.user.id);
      if(error){toast(error.message);return}
      await reloadCloud();
    }
    cancelMove();renderAll();toast(`Перенесено на ${time}`);
  }
  function bindTimelineActions(){
    const grid=$("weekGrid");
    grid.addEventListener("click",e=>{
      const gap=e.target.closest(".agenda-free-row");
      if(!gap)return;
      if(!e.target.closest(".agenda-free-space"))return;
      if(state.movingTaskId){void moveTaskToGap(state.movingTaskId,gap,e.clientY);return}
      if(e.target.closest("[data-quick-add]"))openTaskInGap(gap,e.clientY);
    });
    grid.addEventListener("dragstart",e=>{
      const row=e.target.closest(".agenda-task-row");
      if(!row||e.target.closest("button,input,a")){e.preventDefault();return}
      const task=state.tasks.find(t=>t.id===row.dataset.taskId);
      if(!task||task.recurrence||task.owner_id!==currentUserId()){e.preventDefault();return}
      state.draggedTaskId=task.id;
      grid.classList.add("timeline-moving");
      row.classList.add("agenda-drag-source");
      e.dataTransfer.effectAllowed="move";
      e.dataTransfer.setData("text/plain",task.id);
    });
    grid.addEventListener("dragover",e=>{
      const gap=e.target.closest(".agenda-free-row");
      if(!gap||!state.draggedTaskId)return;
      e.preventDefault();e.dataTransfer.dropEffect="move";
      qsa(".agenda-drop-hover").forEach(x=>x.classList.remove("agenda-drop-hover"));
      gap.classList.add("agenda-drop-hover");
    });
    grid.addEventListener("drop",e=>{
      const gap=e.target.closest(".agenda-free-row");
      if(!gap||!state.draggedTaskId)return;
      e.preventDefault();const id=state.draggedTaskId;
      void moveTaskToGap(id,gap,e.clientY);
    });
    grid.addEventListener("dragend",()=>cancelMove());
    // On touch screens, hold the card, then tap the desired free interval.
    let pressTimer=null,startX=0,startY=0,pressId="";
    const clearPress=()=>{clearTimeout(pressTimer);pressTimer=null};
    grid.addEventListener("pointerdown",e=>{
      if(e.pointerType!=="touch"||state.calendarView!=="day")return;
      const row=e.target.closest(".agenda-task-row");
      if(!row||e.target.closest("button,input,a"))return;
      startX=e.clientX;startY=e.clientY;pressId=row.dataset.taskId;
      clearPress();pressTimer=setTimeout(()=>{startMove(pressId);pressTimer=null},480);
    });
    grid.addEventListener("pointermove",e=>{if(pressTimer&&(Math.abs(e.clientX-startX)>12||Math.abs(e.clientY-startY)>12))clearPress()});
    grid.addEventListener("pointerup",clearPress);
    grid.addEventListener("pointercancel",clearPress);
    $("cancelTimelineMove").onclick=cancelMove;
  }


  function applyTheme(theme){
    localStorage.setItem("week-theme",theme);
    const resolved=resolveTheme(theme);
    document.documentElement.dataset.theme=resolved;
    const meta=$("themeColor");if(meta)meta.setAttribute("content",resolved==="dark"?"#101114":"#f4f3ef");
    updateLoadingScreen(resolved);
  }

  // Fixed palette instead of arbitrary CSS or a separate color table.
  const TASK_COLORS=new Set(["default","lavender","blue","mint","amber","coral","rose","slate"]);
  function taskColor(value){return TASK_COLORS.has(value)?value:"default"}
  function taskColorAttr(task){
    const value=taskColor(task.color);
    return value==="default"?"":` data-color="${value}"`;
  }
  function timerButtonHtml(actionId){
    const running=state.activeTimer && state.activeTimer.taskId===actionId;
    return `<button type="button" class="task-action-btn task-timer-btn" onclick="window.toggleTimer('${actionId}')" aria-label="${running?"Остановить таймер":"Запустить таймер"}" title="${running?"Остановить таймер":"Запустить таймер"}">${running?"⏹":"⏱"}</button>`;
  }
  function taskActionsHtml(actionId){
    return `<div class="task-actions" role="group" aria-label="Действия с задачей">
      ${timerButtonHtml(actionId)}
      <button type="button" class="task-action-btn" onclick="window.weekEdit('${actionId}')" aria-label="Изменить задачу" title="Изменить">✎</button>
      <button type="button" class="task-action-btn task-delete-btn" onclick="window.weekDelete('${actionId}')" aria-label="Удалить задачу" title="Удалить">🗑</button>
    </div>`;
  }
  function taskChipHtml(t){
    const done=t.status==="done";
    const actionId=t.seriesId||t.id;
    const tracked=trackedMinutesFor(actionId);
    return `<article class="task-chip ${t.priority||"optional"} ${done?"done":""}"${taskColorAttr(t)}>
      <div class="task-content">
        <div class="task-heading"><input class="check" aria-label="Отметить задачу" type="checkbox" ${done?"checked":""} onchange="window.weekToggle('${actionId}',this.checked)"><span class="task-title">${esc(t.title)}${t.recurrence?" 🔁":""}</span></div>
        <div class="task-meta">${t.start_time?timeRange(toMin(t.start_time),toMin(t.start_time)+minutes(t))+" • ":""}${minutes(t)} мин${tracked?` • ⏱${tracked}м`:""}${t.visibility==="shared"?" • Общая":""}</div>
        ${checklistSummary(t)}
      </div>
      ${taskActionsHtml(actionId)}
    </article>`;
  }
  function taskBlockHtml(t){
    const done=t.status==="done";
    const actionId=t.seriesId||t.id;
    const tracked=trackedMinutesFor(actionId);
    return `<article class="task ${t.priority||"optional"} ${done?"done":""}"${taskColorAttr(t)}>
      <div class="task-content">
        <div class="task-heading"><input class="check" aria-label="Отметить задачу" type="checkbox" ${done?"checked":""} onchange="event.stopPropagation();window.weekToggle('${actionId}',this.checked)"><span class="task-title">${esc(t.title)}${t.recurrence?" 🔁":""}</span></div>
        <div class="task-meta"><span>${minutes(t)} мин</span>${t.fixed_time?"<span>• фикс.</span>":""}${tracked?`<span>• ⏱${tracked}м</span>`:""}${t.visibility==="shared"?"<span>• Общая</span>":""}</div>
        ${checklistSummary(t)}
      </div>
      ${taskActionsHtml(actionId)}
    </article>`;
  }

  function openTask(task=null){
    $("taskModalTitle").textContent=task?"Изменить задачу":"Новая задача";
    $("taskId").value=task?.id||"";
    $("taskTitle").value=task?.title||"";
    $("taskDescription").value=task?.description||"";
    $("taskDate").value=task?.date||iso(selectedDate());
    $("taskTime").value=task?.start_time?.slice(0,5)||"";
    $("taskDuration").value=task?.duration||Number(localStorage.getItem("week-default-duration")||60);
    $("taskDeadline").value=task?.deadline?new Date(task.deadline).toISOString().slice(0,16):"";
    $("taskCategory").value=task?.category||"Школа";
    $("taskPriority").value=task?.priority||"mandatory";
    const selectedColor=taskColor(task?.color);
    qsa('input[name="taskColor"]').forEach(input=>input.checked=input.value===selectedColor);
    $("taskFixed").checked=!!task?.fixed_time;
    $("taskRecurring").checked=!!task?.recurrence;
    $("recurrenceBox").classList.toggle("hidden",!task?.recurrence);
    $("taskRecurrence").value=task?.recurrence||"weekly";
    $("taskChecklistRows").innerHTML="";
    checklistFor(task).forEach(item=>addChecklistEditorRow(item));
    $("taskConflictOverride").checked=false;
    qsa('input[name="destination"]').forEach(r=>r.checked=r.value===(task?.visibility==="shared"?"shared":"private"));
    fillFriendPicker(task?.friend_id||state.friends[0]?.id||"");
    updateDestinationUI();
    $("taskModal").classList.remove("hidden");
    updateConflictWarning();
  }

  function addChecklistEditorRow(item={},focus=false){
    if($("taskChecklistRows").children.length>=50){toast("В чек-листе может быть максимум 50 пунктов");return}
    const row=document.createElement("div");row.className="checklist-edit-row";
    row.innerHTML=`<input type="checkbox" class="checklist-edit-done" aria-label="Пункт выполнен" ${item.done?"checked":""}>
      <input type="text" class="checklist-edit-text" maxlength="240" placeholder="Новый пункт" aria-label="Текст пункта" value="${esc(item.text||"")}">
      <button type="button" class="secondary" data-checklist-remove title="Удалить пункт" aria-label="Удалить пункт">×</button>`;
    $("taskChecklistRows").append(row);
    if(focus)row.querySelector(".checklist-edit-text").focus();
  }
  function collectChecklist(){
    return qsa("#taskChecklistRows .checklist-edit-row").map(row=>({
      text:row.querySelector(".checklist-edit-text").value.trim(),
      done:row.querySelector(".checklist-edit-done").checked
    })).filter(x=>x.text).slice(0,50);
  }
  window.openChecklist=id=>{
    const t=state.tasks.find(x=>x.id===id);if(!t)return;
    $("checklistModal").dataset.taskId=id;
    $("checklistModalTitle").textContent=t.title;
    renderChecklistModal(t);
    $("checklistModal").classList.remove("hidden");
  };
  function renderChecklistModal(t){
    const items=checklistFor(t),done=items.filter(x=>x.done).length;
    $("checklistProgress").textContent=`Готово: ${done} из ${items.length}`;
    $("checklistItems").innerHTML=items.map((item,i)=>`<label class="checklist-view-row">
      <input type="checkbox" data-checklist-toggle="${i}" ${item.done?"checked":""}>
      <span class="${item.done?"done":""}">${esc(item.text)}</span>
    </label>`).join("") || '<p class="muted">Пока нет пунктов. Добавь их при редактировании задачи.</p>';
  }
  window.toggleChecklistItem=async(index,done)=>{
    const id=$("checklistModal").dataset.taskId,t=state.tasks.find(x=>x.id===id);
    const list=checklistFor(t).map(x=>({...x}));if(!t||!list[Number(index)])return;
    list[Number(index)].done=done;
    if(state.demo){const original=demoData.tasks.find(x=>x.id===id);if(original)original.checklist=list;saveDemo();loadDemo()}
    else{
      const {error}=await sb.from("tasks").update({checklist:list}).eq("id",id);
      if(error){toast(error.message);renderChecklistModal(t);return}
      t.checklist=list;await reloadCloud();
    }
    const updated=state.tasks.find(x=>x.id===id);
    if(updated)renderChecklistModal(updated);
    renderWeek();
  };

  function openOverdue(){
    const tasks=ownOverdueTasks();if(!tasks.length)return;
    $("overdueSelectAll").checked=true;
    $("overdueList").innerHTML=tasks.map(t=>`<label class="overdue-row"><input type="checkbox" data-overdue-id="${t.id}" checked>
      <span><strong>${esc(t.title)}</strong><span class="small muted">${fmtDate(t.date)}${t.start_time?" · "+esc(String(t.start_time).slice(0,5)):""}</span></span>
    </label>`).join("");
    $("overdueModal").classList.remove("hidden");
  }
  async function applyOverdue(){
    const ids=qsa("#overdueList input:checked[data-overdue-id]").map(x=>x.dataset.overdueId);
    if(!ids.length){toast("Выбери хотя бы одну задачу");return}
    $("overdueApply").disabled=true;
    const date=iso(new Date());
    try{
      if(state.demo){
        for(const t of demoData.tasks)if(ids.includes(t.id)&&t.owner_id===currentUserId()&&t.status==="open"&&!t.recurrence&&t.date<date){t.date=date;t.start_time=null;t.fixed_time=false}
        saveDemo();loadDemo();
      }else{
        const {error}=await sb.from("tasks").update({date,start_time:null,fixed_time:false})
          .in("id",ids).eq("owner_id",state.user.id).eq("status","open").is("recurrence",null).lt("date",date);
        if(error){toast(error.message);return}
        await reloadCloud();
      }
      state.currentDate=new Date(date+"T00:00:00");syncWeekStart();
      $("overdueModal").classList.add("hidden");renderAll();toast(`Перенесено задач: ${ids.length}`);
    }finally{$("overdueApply").disabled=false}
  }

  async function saveTask(e){
    e.preventDefault();
    const id=$("taskId").value;
    const dest=qs('input[name="destination"]:checked').value;
    const base={
      title:$("taskTitle").value.trim(),description:$("taskDescription").value.trim()||null,
      date:$("taskDate").value,start_time:$("taskTime").value||null,
      duration:Number($("taskDuration").value)||60,deadline:$("taskDeadline").value?new Date($("taskDeadline").value).toISOString():null,
      category:$("taskCategory").value,priority:$("taskPriority").value,
      color:taskColor(qs('input[name="taskColor"]:checked')?.value),fixed_time:$("taskFixed").checked,
      recurrence:$("taskRecurring").checked?$("taskRecurrence").value:null
    };
    if(!base.title)return;
    base.checklist=collectChecklist();
    const overlaps=taskConflicts(base,id);
    if(overlaps.length&&!$("taskConflictOverride").checked){
      updateConflictWarning();$("taskConflictWarning").scrollIntoView({behavior:"smooth",block:"nearest"});
      toast("Проверь пересечения или разреши сохранить задачу");return;
    }
    if(state.demo){
      if(id){const t=demoData.tasks.find(x=>x.id===id);if(t)Object.assign(t,base)}
      else if(dest==="proposal"){const friendId=$("taskFriend").value||state.friends[0]?.id||otherId();demoData.requests.push({id:uid(),from_user_id:currentUserId(),to_user_id:friendId,title:base.title,description:base.description,date:base.date,start_time:base.start_time,duration:base.duration,category:base.category,priority:base.priority,color:base.color,checklist:base.checklist,status:"pending",created_at:new Date().toISOString()})}
      else {const friendId=$("taskFriend").value||state.friends[0]?.id;demoData.tasks.push({id:uid(),owner_id:currentUserId(),visibility:dest==="shared"?"shared":"private",friend_id:friendId,status:"open",...base});}
      saveDemo();loadDemo();
    }else{
      if(id){
        const {error}=await sb.from("tasks").update(base).eq("id",id).eq("owner_id",state.user.id);
        if(error){toast(error.message);return}
      }
      else if(dest==="proposal"){
        const friendId=$("taskFriend").value;
        if(!friendId){toast("Сначала выбери друга");return}
        const {error}=await sb.from("task_requests").insert({...base,from_user_id:state.user.id,to_user_id:friendId,status:"pending"});
        if(error){toast(error.message);return}
      }else{
        const payload={...base,owner_id:state.user.id,visibility:dest==="shared"?"shared":"private",status:"open"};
        const {data:newTask,error}=await sb.from("tasks").insert(payload).select().single();
        if(error){toast(error.message);return}
        if(dest==="shared"){
          const friendId=$("taskFriend").value;
          if(!friendId){await sb.from("tasks").delete().eq("id",newTask.id).eq("owner_id",state.user.id);toast("Сначала выбери друга для общей задачи");return}
          const {error:memberError}=await sb.from("task_members").insert([{task_id:newTask.id,user_id:state.user.id},{task_id:newTask.id,user_id:friendId}]);
          if(memberError){await sb.from("tasks").delete().eq("id",newTask.id).eq("owner_id",state.user.id);toast(memberError.message);return}
        }
      }
      await reloadCloud();
    }
    if(dest!=="proposal"){
      state.currentDate=new Date(base.date+"T00:00:00");
      state.weekStart=startOfWeek(state.currentDate);
    }
    $("taskModal").classList.add("hidden");renderAll();toast(id?"Задача обновлена":dest==="proposal"?"Предложение отправлено":"Задача создана");
  }

  window.weekToggle=async(id,checked)=>{
    const t=state.tasks.find(x=>x.id===id);if(!t)return;
    const wasDone=t.status==="done";
    if(state.demo){const original=demoData.tasks.find(x=>x.id===id);if(original)original.status=checked?"done":"open";saveDemo();loadDemo()}
    else{
      const {error}=await sb.from("tasks").update({status:checked?"done":"open"}).eq("id",id);
      if(error){toast(error.message);return}
    }
    // A day counts when the user completes at least one task. School schedule
    // and plain task creation never mark an activity day.
    if(checked&&!wasDone)await recordCompletionDay();
    await reloadCloud();renderWeek();renderStats();scheduleNotifications();
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
    el.innerHTML=state.requests.map(r=>`<div class="request-card"${taskColorAttr(r)}>
      <strong>${esc(r.title)}</strong>
      <div class="task-meta">${fmtDate(r.date)}${r.start_time?" • "+r.start_time.slice(0,5):""} • ${r.duration||60} мин • ${esc(r.category||"Другое")}</div>
      <p>${esc(r.description||"Без описания")}</p>
      <div class="actions"><button class="primary" onclick="window.acceptRequest('${r.id}')">Принять</button><button class="secondary" onclick="window.rejectRequest('${r.id}')">Отклонить</button><button class="secondary" onclick="window.counterRequest('${r.id}')">Предложить другое время</button></div>
    </div>`).join("");
  }
  window.acceptRequest=async id=>{
    const r=state.requests.find(x=>x.id===id);if(!r)return;
    if(state.demo){demoData.requests=demoData.requests.filter(x=>x.id!==id);demoData.tasks.push({id:uid(),owner_id:r.from_user_id,visibility:"shared",status:"open",title:r.title,description:r.description,date:r.date,start_time:r.start_time,duration:r.duration,category:r.category,priority:r.priority,color:taskColor(r.color),checklist:checklistFor(r)});saveDemo();loadDemo()}
    else{
      // The recipient accepts the proposal, so the shared task must be created
      // with the recipient as owner. RLS policies allow the authenticated user
      // to insert rows only for their own owner_id. The shared visibility makes
      // the task visible to both users.
      const {data:created,error:taskError}=await sb.from("tasks").insert({owner_id:state.user.id,visibility:"shared",status:"open",title:r.title,description:r.description,date:r.date,start_time:r.start_time,duration:r.duration,category:r.category,priority:r.priority,color:taskColor(r.color),checklist:checklistFor(r)}).select().single();
      if(taskError){toast(`Не удалось принять предложение: ${taskError.message}`);return}
      const {error:memberError}=await sb.from("task_members").insert([{task_id:created.id,user_id:state.user.id},{task_id:created.id,user_id:r.from_user_id}]);
      if(memberError){await sb.from("tasks").delete().eq("id",created.id).eq("owner_id",state.user.id);toast(`Не удалось связать задачу с друзьями: ${memberError.message}`);return}
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
    openTask({...r,id:"",visibility:"private"});
    $("taskModalTitle").textContent="Предложить другое время";
    qs('input[name="destination"][value="proposal"]').checked=true;
    fillFriendPicker(r.from_user_id);
    updateDestinationUI();updateConflictWarning();
  };

  function updateDestinationUI(){
    const dest=qs('input[name="destination"]:checked')?.value||"private";
    $("friendPickerBox").classList.toggle("hidden",dest==="private");
    $("proposalHint").classList.toggle("hidden",dest!=="proposal");
    fillFriendPicker($("taskFriend")?.value||state.friends[0]?.id||"");
  }

  async function searchFriend(e){
    e.preventDefault();
    const username=normalizeUsername($("friendUsername").value);
    if(!username){$("friendSearchResult").innerHTML='<p class="muted small">Введи username.</p>';return}
    if(state.demo){
      const found=demoData.profiles.find(p=>(p.username||p.display_name.toLowerCase())===username && p.id!==currentUserId());
      $("friendSearchResult").innerHTML=found?`<div class="friend-result"><div><strong>${esc(found.display_name)}</strong><div class="small muted">@${esc(found.username||username)}</div></div><button class="primary" onclick="window.demoAddFriend('${found.id}')">Добавить</button></div>`:'<p class="muted small">Пользователь не найден.</p>';
      return;
    }
    const {data,error}=await sb.from("profiles").select("id,display_name,username").eq("username",username).neq("id",state.user.id).maybeSingle();
    if(error){toast(error.message);return}
    if(!data){$("friendSearchResult").innerHTML='<p class="muted small">Пользователь не найден.</p>';return}
    if(friendById(data.id)){$("friendSearchResult").innerHTML='<p class="muted small">Этот пользователь уже у тебя в друзьях.</p>';return}
    const already=state.sentFriendRequests.some(r=>r.to_user_id===data.id)||state.friendRequests.some(r=>r.from_user_id===data.id);
    $("friendSearchResult").innerHTML=already?`<div class="friend-result"><div><strong>${esc(data.display_name)}</strong><div class="small muted">@${esc(data.username||"")}</div></div><span class="small muted">Заявка уже отправлена</span></div>`:`<div class="friend-result"><div><strong>${esc(data.display_name)}</strong><div class="small muted">@${esc(data.username||"")}</div></div><button class="primary" data-friend-id="${data.id}" onclick="window.sendFriendRequest('${data.id}')">Добавить</button></div>`;
  }

  window.sendFriendRequest=async id=>{
    if(!id||id===state.user?.id)return;
    if(state.sendingFriendIds.has(id))return;
    if(friendById(id)||state.sentFriendRequests.some(r=>r.to_user_id===id)||state.friendRequests.some(r=>r.from_user_id===id)){
      toast("Заявка уже отправлена или вы уже друзья"); return;
    }
    state.sendingFriendIds.add(id);
    const button=$("friendSearchResult")?.querySelector(`[data-friend-id="${id}"]`);
    if(button){button.disabled=true;button.textContent="Отправляем…";}
    try{
      if(state.demo){window.demoAddFriend(id);return;}
      const {error}=await sb.from("friend_requests").insert({from_user_id:state.user.id,to_user_id:id,status:"pending"});
      if(error){
        if(String(error.code)==="23505")toast("Заявка уже отправлена");
        else toast(error.message);
        await reloadCloud();renderFriends();return;
      }
      await reloadCloud();renderFriends();toast("Заявка отправлена");
    }finally{state.sendingFriendIds.delete(id);}
  };
  window.demoAddFriend=id=>{
    if(!demoData.friendships)demoData.friendships=[];
    if(!demoData.friendships.some(x=>(x.user_a===currentUserId()&&x.user_b===id)||(x.user_a===id&&x.user_b===currentUserId())))demoData.friendships.push({user_a:currentUserId(),user_b:id});
    saveDemo();loadDemo();renderFriends();updateDestinationUI();toast("Друг добавлен");
  };
  window.acceptFriend=async id=>{
    const r=state.friendRequests.find(x=>x.id===id);if(!r)return;
    if(state.demo){window.demoAddFriend(r.from_user_id);demoData.friendRequests=(demoData.friendRequests||[]).filter(x=>x.id!==id);saveDemo();loadDemo()}
    else{const {error}=await sb.from("friend_requests").update({status:"accepted"}).eq("id",id).eq("to_user_id",state.user.id);if(error){toast(error.message);return}await reloadCloud()}
    renderFriends();toast("Заявка принята");
  };
  window.rejectFriend=async id=>{
    const r=state.friendRequests.find(x=>x.id===id);if(!r)return;
    if(state.demo){demoData.friendRequests=(demoData.friendRequests||[]).filter(x=>x.id!==id);saveDemo();loadDemo()}
    else{const {error}=await sb.from("friend_requests").update({status:"rejected"}).eq("id",id).eq("to_user_id",state.user.id);if(error){toast(error.message);return}await reloadCloud()}
    renderFriends();toast("Заявка отклонена");
  };
  window.cancelFriendRequest=async id=>{
    if(state.demo){demoData.friendRequests=(demoData.friendRequests||[]).filter(x=>x.id!==id);saveDemo();loadDemo()}
    else{const {error}=await sb.from("friend_requests").delete().eq("id",id).eq("from_user_id",state.user.id);if(error){toast(error.message);return}await reloadCloud()}
    renderFriends();toast("Заявка отменена");
  };
  window.unfriend=async id=>{
    const f=friendById(id);if(!f)return;
    if(!confirm(`Удалить ${f.display_name} из друзей? Общие задачи и предложения между вами останутся как есть.`))return;
    if(state.demo){
      demoData.friendships=(demoData.friendships||[]).filter(x=>!((x.user_a===currentUserId()&&x.user_b===id)||(x.user_a===id&&x.user_b===currentUserId())));
      saveDemo();loadDemo();
    }else{
      const {error}=await sb.from("friendships").delete().or(`and(user_a.eq.${state.user.id},user_b.eq.${id}),and(user_a.eq.${id},user_b.eq.${state.user.id})`);
      if(error){toast(error.message);return}
      await reloadCloud();
    }
    renderAll();toast("Друг удалён");
  };
  function renderFriends(){
    const list=$("friendsList"), req=$("friendRequestsList"), sent=$("sentFriendRequestsList");
    list.innerHTML=state.friends.length?state.friends.map(f=>`<div class="friend-row"><div class="avatar mini">${esc((f.display_name||"П").slice(0,1).toUpperCase())}</div><div><strong>${esc(f.display_name)}</strong><div class="small muted">@${esc(f.username||"")}</div></div><div class="actions"><button class="secondary" onclick="window.unfriend('${f.id}')">Удалить</button></div></div>`).join(""):'<p class="muted small">Пока нет друзей.</p>';
    req.innerHTML=state.friendRequests.length?state.friendRequests.map(r=>{const f=(state.__profiles||[]).find(x=>x.id===r.from_user_id);return `<div class="friend-row"><div><strong>${esc(f?.display_name||"Новый друг")}</strong></div><div class="actions"><button class="primary" onclick="window.acceptFriend('${r.id}')">Принять</button><button class="secondary" onclick="window.rejectFriend('${r.id}')">Отклонить</button></div></div>`}).join(""):'<p class="muted small">Новых заявок нет.</p>';
    if(sent)sent.innerHTML=state.sentFriendRequests.length?state.sentFriendRequests.map(r=>{const f=(state.__profiles||[]).find(x=>x.id===r.to_user_id);return `<div class="friend-row"><div><strong>${esc(f?.display_name||"Пользователь")}</strong><div class="small muted">Ожидает ответа</div></div><div class="actions"><button class="secondary" onclick="window.cancelFriendRequest('${r.id}')">Отменить</button></div></div>`}).join(""):'<p class="muted small">Отправленных заявок нет.</p>';
    $("friendBadge").textContent=state.friendRequests.length;$("friendBadge").classList.toggle("hidden",!state.friendRequests.length);
    fillFriendPicker($("taskFriend")?.value||state.friends[0]?.id||"");
  }

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
  function statsDate(offset){
    const date=new Date(state.weekStart);date.setDate(date.getDate()+offset);return date;
  }
  function formatMinutes(value){return `${Math.floor(value/60)} ч ${value%60} мин`}
  function taskCountLabel(count){
    const last=count%10, two=count%100;
    return `${count} ${two>=11&&two<=14?"задач":last===1?"задача":last>=2&&last<=4?"задачи":"задач"}`;
  }
  function completionStreak(){
    const days=new Set(state.completionDays||[]);
    let pointer=new Date();
    if(!days.has(iso(pointer)))pointer.setDate(pointer.getDate()-1);
    let current=0;
    while(days.has(iso(pointer))){current++;pointer.setDate(pointer.getDate()-1)}
    const ordered=[...days].sort();
    let longest=0,running=0,prior="";
    for(const day of ordered){
      const d=new Date(day+"T00:00:00");d.setDate(d.getDate()-1);
      running=prior===iso(d)?running+1:1;
      longest=Math.max(longest,running);prior=day;
    }
    return {current,longest,days};
  }
  function renderStats(){
    const ts=weekTasksForStats();
    const done=ts.filter(t=>t.status==="done").length;
    // The schedule is weekly recurring. Generate one occurrence for each weekday.
    const days=Array.from({length:7},(_,i)=>{
      const date=statsDate(i),day=iso(date);
      const tasks=ts.filter(t=>t.date===day);
      const schedule=(state.schedule||[]).filter(x=>Number(x.day_of_week)===date.getDay()&&x.start_time&&x.end_time);
      const taskMin=tasks.reduce((a,t)=>a+minutes(t),0);
      const schoolMin=schedule.filter(x=>x.kind==="school").reduce((a,x)=>a+Math.max(0,toMin(x.end_time)-toMin(x.start_time)),0);
      const extraMin=schedule.filter(x=>x.kind!=="school").reduce((a,x)=>a+Math.max(0,toMin(x.end_time)-toMin(x.start_time)),0);
      return {date,day,tasks,taskMin,schoolMin,extraMin,total:taskMin+schoolMin+extraMin};
    });
    const sum=key=>days.reduce((a,d)=>a+d[key],0);
    const taskMin=sum("taskMin"),schoolMin=sum("schoolMin"),extraMin=sum("extraMin"),total=sum("total");
    const completion=ts.length?Math.round(done/ts.length*100):0;
    const weekEnd=statsDate(7);
    const trackedMin=state.timeLogs.filter(l=>l.ended_at&&new Date(l.started_at)>=state.weekStart&&new Date(l.started_at)<weekEnd)
      .reduce((a,l)=>a+Math.max(0,Math.round((new Date(l.ended_at)-new Date(l.started_at))/60000)),0);
    const stats=[
      ["Вся нагрузка",formatMinutes(total),"Задачи и занятия"],
      ["Личные и общие задачи",formatMinutes(taskMin),taskCountLabel(ts.length)],
      ["Школа",formatMinutes(schoolMin),"Из расписания"],
      ["Дополнительные занятия",formatMinutes(extraMin),"Из расписания"],
      ["Выполнено",`${done} из ${ts.length}`,`${completion}% задач`],
      ["Таймер",formatMinutes(trackedMin),"Фактически отслежено"]
    ];
    $("statsCards").innerHTML=stats.map(([name,value,note],i)=>`<div class="stat stat-enhanced${i===0?" stat-primary":""}"><span class="muted">${esc(name)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join("");
    $("statsProgress").innerHTML=`<div class="stat-progress-head"><strong>${completion}%</strong><span class="muted">${done} из ${ts.length}</span></div>
      <div class="stats-progress-track" role="progressbar" aria-label="Выполнено задач" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${completion}"><span style="width:${completion}%"></span></div>
      <p class="small muted">Занятия из расписания не считаются выполненными задачами.</p>`;
    const streak=completionStreak(),today=new Date();
    const cells=Array.from({length:28},(_,i)=>{
      const d=new Date(today);d.setDate(d.getDate()-(27-i));const value=iso(d);
      return `<span class="streak-day ${streak.days.has(value)?"active":""} ${i===27?"is-today":""}" title="${value}${streak.days.has(value)?" · задача выполнена":""}" aria-label="${value}${streak.days.has(value)?": есть выполненная задача":": без выполненных задач"}"></span>`;
    }).join("");
    $("statsStreak").innerHTML=`<div class="streak-count">${streak.current}<span> ${streak.current===1?"день":"дней"} подряд</span></div>
      <p class="small muted">Рекорд: ${streak.longest} дн. Серия сохраняется, если ты выполнил хотя бы одну задачу за день.</p>
      <div class="streak-grid" role="group" aria-label="Отметки выполнения за 28 дней">${cells}</div>
      <p class="small muted">Каждый фиолетовый квадрат означает день с выполненной задачей. Сегодня или вчера может быть последним днём серии.</p>`;
    const maxVal=Math.max(1,...days.map(d=>d.total));
    $("statsBars").innerHTML=days.map((d,i)=>{
      const segments=[["tasks",d.taskMin],["school",d.schoolMin],["extra",d.extraMin]];
      const bar=segments.filter(([,v])=>v>0).map(([type,v])=>`<span class="stat-bar-${type}" style="height:${Math.max(2,v/maxVal*178)}px" title="${type==="tasks"?"Задачи":type==="school"?"Школа":"Доп. занятия"}: ${formatMinutes(v)}"></span>`).join("");
      return `<div class="bar-wrap" title="${dayName(i)}: ${formatMinutes(d.total)}"><div class="small stats-bar-total">${(d.total/60).toFixed(1)} ч</div><div class="stats-bar-stack" aria-label="${dayName(i)}: ${formatMinutes(d.total)}">${bar}</div><div class="bar-label">${dayName(i)}</div></div>`;
    }).join("");
    const cats={};
    ts.forEach(t=>cats[t.category||"Другое"]=(cats[t.category||"Другое"]||0)+minutes(t));
    if(schoolMin)cats["Школьные занятия"]=(cats["Школьные занятия"]||0)+schoolMin;
    if(extraMin)cats["Дополнительные занятия"]=(cats["Дополнительные занятия"]||0)+extraMin;
    $("categoryStats").innerHTML=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([name,value])=>{
      const pct=total?Math.round(value/total*100):0;
      return `<div class="stats-category-row"><div class="stats-category-head"><span>${esc(name)}</span><strong>${formatMinutes(value)}</strong></div>
        <div class="stats-category-track"><span style="width:${pct}%"></span></div></div>`;
    }).join("")||"<p class='muted'>На этой неделе нет задач и занятий.</p>";
  }

  function renderProfile(){
    $("settingsName").value=state.profile?.display_name||"";
    $("settingsUsername").value=state.profile?.username||"";
  }
  function renderSettings(){
    $("defaultDuration").value=localStorage.getItem("week-default-duration")||60;
    if($("themeSelect"))$("themeSelect").value=localStorage.getItem("week-theme")||APP_CFG.theme||"system";
    const ns=notificationSettings();
    if($("notificationsEnabled")){ $("notificationsEnabled").checked=ns.enabled; $("notificationLead").value=String(ns.lead); }
  }
  async function saveProfile(){
    const name=$("settingsName").value.trim()||"Пользователь";
    const username=normalizeUsername($("settingsUsername").value);
    if(!username){toast("Укажи username");return}
    if(state.demo){
      state.profile.display_name=name;state.profile.username=username;
      const profile=demoData.profiles.find(x=>x.id===currentUserId());
      if(profile){profile.display_name=name;profile.username=username}
      saveDemo();
    }else{
      const {error}=await sb.from("profiles").update({display_name:name,username}).eq("id",state.user.id);
      if(error){toast(error.message);return}
      state.profile.display_name=name;state.profile.username=username;
    }
    renderAll();toast("Профиль сохранён");
  }
  async function saveSettings(){
    const duration=Number($("defaultDuration").value);
    if(!Number.isFinite(duration)||duration<5||duration>1440){toast("Укажи длительность от 5 до 1440 минут");return}
    localStorage.setItem("week-default-duration",String(duration));
    saveNotificationSettings();
    await syncPushSubscription();
    toast("Настройки сохранены");
  }
  function exportData(){
    const data={exported_at:new Date().toISOString(),profile:state.profile,schedule:state.schedule,tasks:state.tasks,requests:state.requests,templates:state.templates};
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));a.download="week-backup.json";a.click();URL.revokeObjectURL(a.href);
  }
  function importData(e){
    const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(reader.result);if(Array.isArray(data.tasks)){demoData.tasks.push(...data.tasks);saveDemo();loadDemo();renderAll();toast("Импортировано")}else toast("Неверный файл")}catch{toast("Не удалось прочитать JSON")}};reader.readAsText(file);
  }

  setInterval(async()=>{if(!state.demo && state.user){const beforeIncoming=state.requests.length;const beforeStatuses=new Map((state.sentRequests||[]).map(r=>[r.id,r.status]));await reloadCloud();if(state.requests.length>beforeIncoming && "Notification" in window && Notification.permission==="granted" && notificationSettings().enabled)new Notification("week.",{body:"Новое предложение задачи",tag:"week-request"});for(const r of state.sentRequests||[]){const old=beforeStatuses.get(r.id);if(old&&old!==r.status){const name=r.status==="accepted"?"Предложение принято":r.status==="rejected"?"Предложение отклонено":"Предложение обновлено";if("Notification" in window && Notification.permission==="granted" && notificationSettings().enabled)new Notification("week.",{body:name,tag:`week-request-${r.id}`});}}renderRequests();renderWeek();}},60000);
  applyTheme(localStorage.getItem("week-theme")||APP_CFG.theme||"system");
  if(window.matchMedia){window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>{if((localStorage.getItem("week-theme")||APP_CFG.theme)==="system")applyTheme("system")})}
  boot();
})();
