(() => {
  const supabasePublicKey = window.SUPABASE_PUBLISHABLE_KEY || window.SUPABASE_ANON_KEY || "";
  const hasSupabase = !!(window.SUPABASE_URL && supabasePublicKey);
  const sb = hasSupabase ? window.supabase.createClient(window.SUPABASE_URL, supabasePublicKey, {
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  }) : null;
  const $ = id => document.getElementById(id);
  const qs = s => document.querySelector(s);
  const qsa = s => [...document.querySelectorAll(s)];

  let state = {
    user:null, profile:null, section:"week", person:"me",
    weekStart: startOfWeek(new Date()), currentDate: new Date(), calendarView:localStorage.getItem("week-calendar-view")==="week"?"week":"day", tasks:[], requests:[], sentRequests:[], requestTab:"incoming", templates:[], timeLogs:[], activeTimer:null,
    friends:[], friendRequests:[], sentFriendRequests:[], schedule:[], personalSchedule:[], classGroup:null, classSchedule:[], classMembers:[], classViewGroup:null, classViewSchedule:[], classExceptions:[], isWeekAdmin:false, adminGroups:[], adminClassId:null, lastClassCode:null, completionDays:[], movingTaskId:null, draggedTaskId:null,
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
    ], timeLogs:[], schedules:[], classGroups:[], classMemberships:[], classSchedules:[], classExceptions:[], completionDays:[], friendships:[{user_a:"demo-vadim",user_b:"demo-sonya"}], friendRequests:[]
  };

  function uid(){return crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random();}
  function startOfWeek(d){ const x=new Date(d); const first=localStorage.getItem("week-week-start")==="sunday"?0:1; const day=(x.getDay()-first+7)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x; }
  function iso(d){const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`}
  function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
  function fmtDate(s){return new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"short"}).format(new Date(s+"T00:00:00"))}
  function toast(msg){$("toast").textContent=msg;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2500)}
  function priorityLabel(p){return {mandatory:"обязательная",desirable:"желательная",optional:"необязательная"}[p]||p}
  function dayName(i){return ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"][i]}
  function minutes(t){return Number(t.duration)||60}
  function toMin(t){const [h,m]=t.slice(0,5).split(":").map(Number);return h*60+(m||0)}

  const APP_CFG=window.APP_CONFIG||{};
  const PX_PER_HOUR=56;
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
    "Не забывай про отдых: энергия — тоже ресурс.",
    "Чередуй работу и отдых: так легче держать темп.",
    "Оставь вечером пару минут, чтобы наметить завтрашний день.",
    "Не каждое свободное окно обязательно чем-то заполнять.",
    "Одна завершённая задача уже делает день понятнее.",
    "Если план изменился, просто обнови его.",
    "Сосредоточься на том, что действительно зависит от тебя.",
    "Большой проект начинается с понятного первого шага.",
    "Не сравнивай свой ритм с чужим расписанием.",
    "Для важного дела полезно заранее выделить время.",
    "Не забудь поесть и отдохнуть между занятиями.",
    "Лучше реалистичный план, чем список на весь день.",
    "Новые идеи удобно записывать сразу, а разбирать позже.",
    "Сначала уточни задачу, потом выбирай время.",
    "Оставь запас на дорогу и неожиданные дела.",
    "Календарь помогает увидеть, когда пора сделать паузу.",
    "Учёба занимает время, но не должна занимать весь день.",
    "Если не успел сегодня, спокойно перенеси дело на завтра.",
    "Привычка появляется постепенно, без необходимости спешить.",
    "Короткие перерывы помогают сохранять внимание.",
    "Можно попросить помощи, если задача оказалась сложной.",
    "Сначала проверь сроки, затем расставляй приоритеты.",
    "Не бойся упрощать слишком подробный план.",
    "Отмечай маленькие успехи, даже если впереди много работы.",
    "Чёткая формулировка задачи экономит время.",
    "Для отдыха тоже можно оставить место в расписании.",
    "Не все задачи одинаково срочные.",
    "Подготовь материалы для следующего урока заранее.",
    "Выбери спокойный темп, который подходит именно тебе.",
    "Встречу легче согласовать, когда видна общая занятость.",
    "Выходные существуют не только для списка дел.",
    "Один свободный час иногда полезнее ещё одной задачи.",
    "Если сроки изменились, обнови и план.",
    "Лучше запланировать меньше и выполнить задуманное.",
    "Не нужно идеально расписывать каждую минуту.",
    "Сложный день можно начать с самого понятного дела.",
    "Перед началом проверь, всё ли нужное под рукой.",
    "Время в календаре помогает сделать планы конкретными.",
    "У каждого дня может быть свой ритм.",
    "Завтра будет проще, если сегодня подготовить главное.",
    "Проверь, осталось ли время на дорогу.",
    "Домашние дела тоже заслуживают места в плане.",
    "Большую задачу можно разделить на несколько коротких.",
    "Свободный промежуток можно оставить свободным.",
    "После учёбы полезно переключиться на что-то другое.",
    "Когда знаешь следующий шаг, начинать легче.",
    "Планы нужны для удобства, а не для идеальности.",
    "Распредели сложные занятия, если есть такая возможность.",
    "Периодически пересматривай задачи, которые уже неактуальны.",
    "Можно изменить порядок дел и при этом сохранить цель.",
    "Не забывай закладывать время на обед.",
    "Срок задачи и время её выполнения не всегда одно и то же.",
    "В конце недели посмотри, что помогало тебе успевать.",
    "Хорошее расписание оставляет пространство для неожиданностей.",
    "Сложный вопрос иногда решается после короткого отдыха.",
    "Не обязательно делать несколько дел одновременно.",
    "Выбирай время для работы с учётом собственного самочувствия.",
    "Сначала закончи маленькую часть, потом берись за следующую.",
    "Если день насыщенный, особенно важны паузы.",
    "Список дел может меняться вместе с твоими планами.",
    "Удобнее заранее увидеть конфликт в расписании.",
    "Сохраняй важные даты в одном месте.",
    "Небольшая подготовка помогает меньше спешить утром.",
    "Уточни детали встречи до того, как внесёшь её в календарь.",
    "Отдых и занятия могут спокойно соседствовать в одном дне.",
    "План помогает выбрать, чему уделить внимание сейчас.",
    "Не расстраивайся из-за перенесённой задачи.",
    "Если задача неясна, запиши конкретное действие.",
    "У каждого проекта есть этап, который можно сделать сегодня.",
    "Подумай, что нужно подготовить к завтрашнему дню.",
    "Лучше спокойно поправить расписание, чем держать всё в голове.",
    "После выполнения дела можно немного переключиться.",
    "Не забывай оставлять время на себя.",
    "Небольшие привычки поддерживают большие планы.",
    "Твой календарь должен быть полезен тебе, а не наоборот.",
    "Сначала разберись со временем, потом добавляй новые планы."];

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
    return items.length?`<button class="checklist-link" type="button" data-action="open-checklist" data-id="${esc(t.seriesId||t.id)}" title="Открыть чек-лист">☑ ${items.filter(x=>x.done).length}/${items.length}</button>`:"";
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
      for(const item of scheduleOnDate(ds)){
        if(!item.start_time||!item.end_time)continue;
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

  function scheduleOnDate(dateString){
    const dow=new Date(dateString+"T00:00:00").getDay();
    const exceptions=new Map((state.classExceptions||[])
      .filter(e=>e.class_id===state.classGroup?.id&&e.lesson_date===dateString)
      .map(e=>[e.lesson_id,e]));
    return (state.schedule||[]).filter(item=>Number(item.day_of_week)===dow).flatMap(item=>{
      if(!state.classGroup||item.class_id!==state.classGroup.id)return [item];
      const override=exceptions.get(item.id);
      if(!override)return [item];
      if(override.cancelled)return [];
      return [{...item,title:override.title,start_time:override.start_time,end_time:override.end_time,_oneOff:true}];
    });
  }
  function upcomingWeekday(day){
    const date=new Date();date.setHours(0,0,0,0);
    date.setDate(date.getDate()+(Number(day)-date.getDay()+7)%7);
    return iso(date);
  }
  function combineSchedules(){
    // Для учеников класса школьные уроки общие. Личные дополнительные занятия остаются.
    return state.classGroup ? [...(state.personalSchedule||[]).filter(s=>s.kind!=="school"),...(state.classSchedule||[])] : [...(state.personalSchedule||[])];
  }
  function setDemoClassView(){
    const groups=demoData.classGroups||[];
    state.classViewGroup=groups.find(g=>g.id===state.adminClassId)||state.classGroup||(state.isWeekAdmin?groups[0]:null)||null;
    if(state.isWeekAdmin&&state.classViewGroup)state.adminClassId=state.classViewGroup.id;
    state.classViewSchedule=(demoData.classSchedules||[]).filter(s=>s.class_id===state.classViewGroup?.id);
    state.classExceptions=(demoData.classExceptions||[]).filter(e=>e.class_id===state.classGroup?.id||e.class_id===state.classViewGroup?.id);
    state.classMembers=(demoData.classMemberships||[]).filter(m=>m.class_id===state.classViewGroup?.id)
      .map(m=>{const p=demoData.profiles.find(p=>p.id===m.user_id);return p?{...p,role:m.role||"student"}:null}).filter(Boolean);
  }
  async function fetchClassContext(personalSchedule){
    const uid=state.user.id;
    const [{data:membership,error:memberErr},{data:adminRole,error:roleErr}]=await Promise.all([
      sb.from("class_members").select("class_id").eq("user_id",uid).maybeSingle(),
      sb.from("week_admins").select("user_id").eq("user_id",uid).maybeSingle()
    ]);
    if(memberErr||roleErr){console.warn("Классы: выполни MIGRATION_2_2_CLASSES.sql",memberErr||roleErr);return false;}
    state.isWeekAdmin=!!adminRole;
    let groups=[];
    if(state.isWeekAdmin){
      const {data,error}=await sb.from("class_groups").select("id,name,schedule_updated_at").order("name");
      if(error){console.warn("Классы",error);return false;}
      groups=data||[];
    }else if(membership?.class_id){
      const {data,error}=await sb.from("class_groups").select("id,name,schedule_updated_at").eq("id",membership.class_id).maybeSingle();
      if(error){console.warn("Классы",error);return false;}
      if(data)groups=[data];
    }
    state.adminGroups=state.isWeekAdmin?groups:[];
    state.classGroup=groups.find(g=>g.id===membership?.class_id)||null;
    state.classViewGroup=state.isWeekAdmin
      ?groups.find(g=>g.id===state.adminClassId)||state.classGroup||groups[0]||null
      :state.classGroup;
    if(state.isWeekAdmin)state.adminClassId=state.classViewGroup?.id||null;
    const ids=[...new Set([state.classGroup?.id,state.classViewGroup?.id].filter(Boolean))];
    let items=[];
    if(ids.length){
      const {data,error}=await sb.from("class_schedule_items").select("id,class_id,day_of_week,title,start_time,end_time").in("class_id",ids).order("day_of_week").order("start_time");
      if(error){console.warn("Расписание класса",error);return false;}
      items=data||[];
    }
    state.classSchedule=items.filter(s=>s.class_id===state.classGroup?.id).map(s=>({...s,kind:"school"}));
    state.personalSchedule=personalSchedule||[];
    state.schedule=combineSchedules();
    state.classViewSchedule=items.filter(s=>s.class_id===state.classViewGroup?.id);
    state.classExceptions=[];
    const activeClassIds=[...new Set([state.classGroup?.id,state.classViewGroup?.id].filter(Boolean))];
    if(activeClassIds.length){
      const range=calendarQueryRange();
      const {data:exceptions,error:exErr}=await sb.from("class_schedule_exceptions")
        .select("id,class_id,lesson_id,lesson_date,cancelled,title,start_time,end_time")
        .in("class_id",activeClassIds).gte("lesson_date",range.start).lte("lesson_date",range.end);
      if(exErr){console.warn("Разовые изменения: выполни MIGRATION_2_3_SCHOOL.sql",exErr);return false;}
      state.classExceptions=exceptions||[];
    }
    state.classMembers=[];
    if(state.classViewGroup){
      const {data:memberRows,error}=await sb.from("class_members").select("user_id,role").eq("class_id",state.classViewGroup.id).order("joined_at");
      if(error){console.warn("Участники",error);return false;}
      const mids=(memberRows||[]).map(m=>m.user_id);
      if(mids.length){
        const {data:profiles,error:pErr}=await sb.rpc("week_get_visible_profiles",{p_ids:mids});
        if(pErr){console.warn("Участники",pErr);return false;}
        state.classMembers=(profiles||[]).map(p=>({...p,role:memberRows.find(m=>m.user_id===p.id)?.role||"student"}))
          .sort((a,b)=>a.display_name.localeCompare(b.display_name,"ru"));
      }
    }
    return true;
  }

  function loadDemo(){
    const raw=localStorage.getItem("week-demo");
    if(raw){try{Object.assign(demoData,JSON.parse(raw))}catch{}}
    state.tasks=demoData.tasks.filter(t=>t.owner_id===currentUserId()||t.visibility==="shared");
    state.requests=demoData.requests.filter(r=>r.to_user_id===currentUserId()&&r.status==="pending");
    state.sentRequests=demoData.requests.filter(r=>r.from_user_id===currentUserId());
    state.templates=demoData.templates;
    state.timeLogs=(demoData.timeLogs||[]).filter(l=>l.user_id===currentUserId());
    const friendIds=(demoData.friendships||[]).filter(x=>x.user_a===currentUserId()||x.user_b===currentUserId()).map(x=>x.user_a===currentUserId()?x.user_b:x.user_a);
    state.friends=demoData.profiles.filter(p=>friendIds.includes(p.id));
    state.friendRequests=(demoData.friendRequests||[]).filter(r=>r.to_user_id===currentUserId()&&r.status==="pending");
    state.sentFriendRequests=(demoData.friendRequests||[]).filter(r=>r.from_user_id===currentUserId()&&r.status==="pending");
    state.personalSchedule=(demoData.schedules||[]).filter(r=>r.user_id===currentUserId());
    state.isWeekAdmin=currentUserId()==="demo-vadim";
    state.adminGroups=state.isWeekAdmin?(demoData.classGroups||[]):[];
    const membership=(demoData.classMemberships||[]).find(m=>m.user_id===currentUserId());
    state.classGroup=(demoData.classGroups||[]).find(g=>g.id===membership?.class_id)||null;
    state.classSchedule=(demoData.classSchedules||[]).filter(s=>s.class_id===state.classGroup?.id).map(s=>({...s,kind:"school"}));
    state.schedule=combineSchedules();
    setDemoClassView();
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
      const ins=await sb.rpc("week_ensure_profile");
      if(ins.error){console.error("Profile recovery failed",ins.error);toast("Не удалось подготовить профиль. Попробуй войти ещё раз.");return}
      profile=ins.data;
    }
    if(!profile){toast("Профиль аккаунта не найден. Обратись к администратору week.");return}
    state.profile=profile;
    await reloadCloud();
    showApp();
    maybeShowOnboarding();
    setupRealtimeNotifications();
    await syncPushSubscription();
  }
  // A few months around the displayed day, plus earlier open and recurring series.
  // Archived/completed historical rows are requested only when their month is opened.
  function calendarQueryRange(){
    const center=selectedDate(), start=new Date(center),end=new Date(center);
    start.setDate(start.getDate()-45);end.setDate(end.getDate()+75);
    return {start:iso(start),end:iso(end)};
  }
  function reloadCloud(){
    if(state.cloudReloadPromise)return state.cloudReloadPromise;
    const pending=fetchCloud();
    state.cloudReloadPromise=pending;
    pending.finally(()=>{if(state.cloudReloadPromise===pending)state.cloudReloadPromise=null}).catch(()=>{});
    return pending;
  }
  async function fetchCloud(){
    if(state.demo){loadDemo();return}
    const range=calendarQueryRange();
    // Time logs for the visible window plus any timer that has not ended.
    const logStart=new Date(range.start+"T00:00:00");logStart.setDate(logStart.getDate()-1);
    const logEnd=new Date(range.end+"T00:00:00");logEnd.setDate(logEnd.getDate()+2);
    const [
      {data:windowTasks,error:windowErr},
      {data:olderRecurring,error:recurringErr},
      {data:olderOpen,error:openErr},
      {data:requests,error:reqErr},{data:sentRequests,error:sentReqErr},
      {data:templates,error:tplErr},{data:logs,error:logsErr},
      {data:friendRows,error:friendsErr},
      {data:friendRequests,error:friendReqErr},
      {data:sentFriendRequests,error:sentFriendReqErr},
      {data:schedule,error:scheduleErr},
      {data:completionRows,error:completionErr}
    ]=await Promise.all([
      sb.from("tasks").select("*").gte("date",range.start).lte("date",range.end).order("date").order("start_time"),
      sb.from("tasks").select("*").lt("date",range.start).not("recurrence","is",null),
      sb.from("tasks").select("*").lt("date",range.start).eq("status","open").is("recurrence",null),
      sb.from("task_requests").select("*").eq("to_user_id",state.user.id).eq("status","pending").order("created_at",{ascending:false}),
      sb.from("task_requests").select("*").eq("from_user_id",state.user.id).order("created_at",{ascending:false}).limit(50),
      sb.from("task_templates").select("*").eq("user_id",state.user.id).order("created_at",{ascending:false}),
      sb.from("time_logs").select("*").eq("user_id",state.user.id).or(`and(started_at.gte.${logStart.toISOString()},started_at.lt.${logEnd.toISOString()}),ended_at.is.null`).order("started_at",{ascending:false}),
      sb.from("friendships").select("user_a,user_b").or(`user_a.eq.${state.user.id},user_b.eq.${state.user.id}`),
      sb.from("friend_requests").select("id,from_user_id,to_user_id,status,created_at").eq("to_user_id",state.user.id).eq("status","pending").order("created_at",{ascending:false}),
      sb.from("friend_requests").select("id,from_user_id,to_user_id,status,created_at").eq("from_user_id",state.user.id).eq("status","pending").order("created_at",{ascending:false}),
      sb.from("schedule_items").select("*").eq("user_id",state.user.id).order("day_of_week").order("start_time"),
      sb.from("task_completion_days").select("day").eq("user_id",state.user.id).order("day",{ascending:false}).limit(500)
    ]);
    const friendIds=(friendRows||[]).map(r=>r.user_a===state.user.id?r.user_b:r.user_a);
    const requesterIds=(friendRequests||[]).map(r=>r.from_user_id);
    // Names shown in the incoming/outgoing proposal lists are public profile fields only.
    const proposalProfileIds=[...(requests||[]).map(r=>r.from_user_id),...(sentRequests||[]).map(r=>r.to_user_id)];
    const profileIds=[...new Set([...friendIds,...requesterIds,...proposalProfileIds])];
    const {data:friendProfiles,error:profileErr}=profileIds.length?
      await sb.rpc("week_get_visible_profiles",{p_ids:profileIds}):{data:[],error:null};
    const allErr=windowErr||recurringErr||openErr||reqErr||sentReqErr||tplErr||logsErr||friendsErr||friendReqErr||sentFriendReqErr||scheduleErr||profileErr;
    if(completionErr)console.warn("Для серии выполнений нужна MIGRATION_2_0.sql",completionErr.message);
    if(allErr){console.error("reloadCloud error",allErr);toast("Не удалось загрузить данные. Обнови страницу или попробуй позже.");return}
    const uniqTasks=new Map();
    for(const t of [...(windowTasks||[]),...(olderRecurring||[]),...(olderOpen||[])])uniqTasks.set(t.id,t);
    state.tasks=[...uniqTasks.values()].sort((a,b)=>a.date.localeCompare(b.date)||String(a.start_time||"").localeCompare(String(b.start_time||"")));
    state.taskRange=range;
    state.requests=requests||[];state.sentRequests=sentRequests||[];state.templates=templates||[];state.timeLogs=logs||[];
    state.friends=(friendProfiles||[]).filter(p=>friendIds.includes(p.id));
    state.__profiles=friendProfiles||[];
    state.friendRequests=friendRequests||[];state.sentFriendRequests=sentFriendRequests||[];
    state.personalSchedule=schedule||[];
    state.schedule=combineSchedules();
    await fetchClassContext(state.personalSchedule);
    if(!completionErr)state.completionDays=(completionRows||[]).map(row=>row.day);
    state.lastFullRefresh=Date.now();
    state.needsReload=false;
    restoreActiveTimer();scheduleNotifications();
    $("requestBadge").textContent=state.requests.length;$("requestBadge").classList.toggle("hidden",!state.requests.length);
    if($("friendBadge")){ $("friendBadge").textContent=state.friendRequests.length;$("friendBadge").classList.toggle("hidden",!state.friendRequests.length); }
  }

  // Navigation beyond the current query window fetches the requested dates.
  async function ensureVisibleRange(){
    if(state.demo||!state.user)return;
    if(state.cloudReloadPromise)await state.cloudReloadPromise;
    const day=iso(selectedDate()),range=state.taskRange;
    const nearEdge=!range||day<range.start||day>range.end||
      (new Date(day+"T00:00:00")-new Date(range.start+"T00:00:00"))/86400000<10||
      (new Date(range.end+"T00:00:00")-new Date(day+"T00:00:00"))/86400000<10;
    if(!nearEdge)return;
    await reloadCloud();
    if(state.section==="week")renderWeek();
    if(state.section==="stats")renderStats();
  }

  // Poll only actionable requests. Reload the remaining datasets if something changed.
  async function pollChanges(){
    if(state.demo||!state.user||document.visibilityState==="hidden"||state.cloudReloadPromise)return;
    const userId=state.user.id;
    const [{data:incoming,error:inErr},{data:sent,error:sErr},{data:friendRequests,error:fErr},{data:classStamp,error:classErr}]=await Promise.all([
      sb.from("task_requests").select("id,status,created_at").eq("to_user_id",userId).eq("status","pending").order("created_at",{ascending:false}),
      sb.from("task_requests").select("id,status,created_at").eq("from_user_id",userId).order("created_at",{ascending:false}).limit(50),
      sb.from("friend_requests").select("id,from_user_id,status").eq("to_user_id",userId).eq("status","pending"),
      state.classGroup?sb.from("class_groups").select("schedule_updated_at").eq("id",state.classGroup.id).maybeSingle():Promise.resolve({data:null,error:null})
    ]);
    if(inErr||sErr||fErr||classErr)return;
    const signature=a=>JSON.stringify((a||[]).map(r=>`${r.id}:${r.status}`).sort());
    const changed=signature(incoming)!==signature(state.requests)||
      signature(sent)!==signature(state.sentRequests)||signature(friendRequests)!==signature(state.friendRequests)||
      !!(classStamp&&classStamp.schedule_updated_at!==state.classGroup?.schedule_updated_at);
    if(!changed)return;
    const beforeIncoming=state.requests.length;
    const prior=new Map(state.sentRequests.map(r=>[r.id,r.status]));
    await reloadCloud();renderAll();
    if("Notification" in window&&Notification.permission==="granted"&&notificationSettings().enabled){
      if(state.requests.length>beforeIncoming)new Notification("week.",{body:"Новое предложение задачи",tag:"week-request"});
      for(const r of state.sentRequests){
        const old=prior.get(r.id);
        if(old&&old!==r.status)new Notification("week.",{body:r.status==="accepted"?"Предложение принято":r.status==="rejected"?"Предложение отклонено":"Предложение обновлено",tag:`week-request-${r.id}`});
      }
    }
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
        if(document.visibilityState==="hidden"){
          state.needsReload=true;
          return;
        }
        await reloadCloud();
        renderAll();
      }).subscribe();
    state.__notificationChannel=channel;
  }

  function bindDynamicActions(){
    document.addEventListener("click",e=>{
      const el=e.target.closest?.("[data-action]");
      if(!el)return;
      const {action,id,date}=el.dataset;
      const run=fn=>{try{const result=fn();if(result&&typeof result.catch==="function")result.catch(err=>{console.error(err);toast("Не удалось выполнить действие")});}catch(err){console.error(err);toast("Не удалось выполнить действие")}};
      if(action==="open-checklist")return run(()=>window.openChecklist(id));
      if(action==="open-task-date")return run(()=>window.openTaskForDate(date));
      if(action==="select-calendar-day")return run(()=>window.selectCalendarDay(date));
      if(action==="task-timer")return run(()=>window.toggleTimer(id));
      if(action==="task-edit")return run(()=>window.weekEdit(id));
      if(action==="task-delete")return run(()=>window.weekDelete(id));
      if(action==="request-accept")return run(()=>window.acceptRequest(id));
      if(action==="request-reject")return run(()=>window.rejectRequest(id));
      if(action==="request-counter")return run(()=>window.counterRequest(id));
      if(action==="friend-demo-add")return run(()=>window.demoAddFriend(id));
      if(action==="friend-send")return run(()=>window.sendFriendRequest(id));
      if(action==="friend-accept")return run(()=>window.acceptFriend(id));
      if(action==="friend-reject")return run(()=>window.rejectFriend(id));
      if(action==="friend-cancel")return run(()=>window.cancelFriendRequest(id));
      if(action==="friend-unfriend")return run(()=>window.unfriend(id));
      if(action==="class-lesson-edit")return run(()=>window.openClassLessonEdit(id));
      if(action==="template-use")return run(()=>window.useTemplate(id));
    });
    document.addEventListener("change",e=>{
      const el=e.target.closest?.("[data-change-action]");
      if(!el)return;
      const action=el.dataset.changeAction,id=el.dataset.id;
      if(action==="task-toggle"){e.stopPropagation();void window.weekToggle(id,el.checked);}
      if(action==="class-role")void window.setClassMemberRole(id,el.value);
    });
  }

  function bindStatic(){
    bindDynamicActions();
    bindTimelineActions();
    qsa("[data-auth]").forEach(b=>b.onclick=()=>{state.authMode=b.dataset.auth;qsa("[data-auth]").forEach(x=>x.classList.toggle("active",x===b));$("nameField").classList.toggle("hidden",state.authMode!=="signup");$("signupClassField").classList.toggle("hidden",state.authMode!=="signup");$("authSubmit").textContent=state.authMode==="signup"?"Создать аккаунт":"Войти"});
    $("authForm").onsubmit=authSubmit;
    $("demoBtn").onclick=()=>{state.demo=true;state.user=demoData.profiles[0];state.profile=state.user;loadDemo();showApp();toast("Открыт демо-режим")};
    $("logoutBtn").onclick=logout;
    $("profileBtn").onclick=()=>switchSection("profile");
    $("settingsBtn").onclick=()=>switchSection("settings");
    $("mobileSettingsBtn").onclick=()=>switchSection("settings");
    qsa(".nav-btn").forEach(b=>b.onclick=()=>switchSection(b.dataset.section));
    qsa("[data-request-tab]").forEach(b=>b.onclick=()=>{
      state.requestTab=b.dataset.requestTab;
      renderRequests();
    });
    $("friendSearchForm").onsubmit=searchFriend;
    $("classJoinForm").onsubmit=joinClass;
    $("classCreateForm").onsubmit=createClass;
    $("adminClassSelect").onchange=async e=>{
      state.adminClassId=e.target.value||null;state.__codeGroupId=null;state.lastClassCode=null;
      $("classScheduleDetails").open=false;
      $("classCodeBox").classList.add("hidden");$("classLegacyPanel").classList.add("hidden");
      await reloadCloud();renderAll();
    };
    $("classLockOldCode").onclick=()=>lockClassCode(true);
    $("classGeneratePermanentCode").onclick=()=>lockClassCode(false);
    $("classCopyCode").onclick=async()=>{if(!state.lastClassCode)return;try{await navigator.clipboard.writeText(state.lastClassCode);toast("Код скопирован")}catch{toast("Выдели код и скопируй вручную")}};
    $("classImportMySchedule").onclick=importMySchoolScheduleToClass;
    $("classEditSchedule").onclick=openClassScheduleEditor;
    $("classAddLesson").onclick=()=>addClassLessonRow();
    $("classCancelSchedule").onclick=()=>$("classScheduleEditor").classList.add("hidden");
    $("classSaveSchedule").onclick=saveClassSchedule;
    $("classResetException").onclick=resetLessonException;
    $("lessonEditForm").onsubmit=saveLessonChange;
    $("lessonChangeMode").onchange=()=>{
      const lesson=state.classViewSchedule.find(x=>x.id===$("lessonEditModal").dataset.lessonId);
      if(lesson&&$("lessonChangeMode").value==="forever"){
        $("lessonChangeTitle").value=lesson.title;
        $("lessonChangeStart").value=String(lesson.start_time).slice(0,5);
        $("lessonChangeEnd").value=String(lesson.end_time).slice(0,5);
      }
      updateLessonEditorMode();
      if($("lessonChangeMode").value==="once")refreshLessonDateForm();
    };
    $("lessonChangeDate").onchange=()=>{refreshLessonDateForm();updateLessonEditorMode();};
    $("lessonCancelled").onchange=updateLessonEditorMode;
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
    const email=$("email").value.trim().toLowerCase(),password=$("password").value,displayName=$("displayName").value.trim();
    if(state.authMode==="signup"){
      if(password.length<10){toast("Пароль должен содержать не меньше 10 символов");return}
      if(password.length>128){toast("Пароль слишком длинный");return}
      if(displayName.length>80){toast("Имя должно быть не длиннее 80 символов");return}
      const classCode=$("signupClassCode").value.trim();
      if(classCode){
        const {data:className,error:codeError}=await sb.rpc("week_check_class_code",{p_code:classCode});
        if(codeError){toast("Не удалось проверить код класса. Проверь MIGRATION_2_2_CLASSES.sql");return}
        if(!className){toast("Код класса не найден. Проверь его у администратора");return}
      }
      const {data,error}=await sb.auth.signUp({email,password,options:{data:{display_name:displayName||email.split("@")[0],username:normalizeUsername(displayName||email.split("@")[0]),...(classCode?{class_invite_code:classCode}:{})}}});
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
    classes:["Группы","Классы, расписание уроков и одноклассники"],
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
    ["week","requests","friends","classes","templates","stats","profile","settings"].forEach(x=>$(`${x}Section`).classList.toggle("hidden",x!==s));
    if(s==="week")renderWeek();
    if(s==="requests")renderRequests();
    if(s==="friends")renderFriends();
    if(s==="classes")renderClasses();
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
    state.onboardingStep=state.classGroup?3:1;
    const school=state.profile?.studies_at_school===true?"yes":state.profile?.studies_at_school===false?"no":"";
    const hasExtra=(state.schedule||[]).some(x=>x.kind==="extra");
    qsa('input[name="school"]').forEach(x=>x.checked=x.value===(state.classGroup?"yes":school));
    qsa('input[name="extras"]').forEach(x=>x.checked=x.value===(hasExtra?"yes":state.profile?.onboarding_completed?"no":""));
    $("schoolScheduleList").innerHTML=""; $("extraScheduleList").innerHTML="";
    delete $("schoolScheduleList").dataset.lastSelectedDay;
    delete $("extraScheduleList").dataset.lastSelectedDay;
    (state.classGroup?[]:state.personalSchedule||[]).filter(x=>x.kind==="school").forEach(x=>addScheduleEditorRow("school",x));
    (state.personalSchedule||[]).filter(x=>x.kind==="extra").forEach(x=>addScheduleEditorRow("extra",x));
    updateScheduleEmpty("school");updateScheduleEmpty("extra");
    $("onboardingModal").classList.remove("hidden");updateOnboardingUI();
  }
  function selectedRadio(name){return qs(`input[name="${name}"]:checked`)?.value||""}
  function updateOnboardingUI(){
    const step=state.onboardingStep;
    qsa(".onboarding-step").forEach(x=>x.classList.toggle("hidden",Number(x.dataset.step)!==step));
    qsa("#onboardingProgress span").forEach((x,i)=>x.classList.toggle("active",i<step));
    $("onboardingBack").classList.toggle("hidden",step===1||(state.classGroup&&step===3));
    $("onboardingNext").classList.toggle("hidden",step===4);
    $("onboardingFinish").classList.toggle("hidden",step!==4);
    $("onboardingTitle").textContent=step===1?"Расскажем week. о твоём расписании":step===2?"Школьное расписание":step===3?"Дополнительные занятия":"Расписание дополнительных занятий";
    if(step===2&&selectedRadio("school")==="yes"&&!document.querySelector("#schoolScheduleList .schedule-row"))addScheduleEditorRow("school");
    if(step===4&&!document.querySelector("#extraScheduleList .schedule-row"))addScheduleEditorRow("extra");
  }
  function addScheduleEditorRow(type,item={}){
    const list=$(type==="school"?"schoolScheduleList":"extraScheduleList");
    const row=document.createElement("div");row.className="schedule-row";
    if(item.id)row.dataset.lessonId=item.id;
    // A newly added lesson inherits the last day selected in this editor.
    // Existing lessons keep their saved weekdays when the editor opens.
    const day=String(item.day_of_week ?? list.dataset.lastSelectedDay ??
      list.querySelector('.schedule-row:last-child [data-field="day"]')?.value ?? "1");
    row.innerHTML=`<label>День<select data-field="day">${DAY_OPTIONS.map(([v,n])=>`<option value="${v}" ${v===day?"selected":""}>${n}</option>`).join("")}</select></label>
      <label>${type==="school"?"Предмет":"Занятие"}<input data-field="title" required value="${esc(item.title||"")}" placeholder="${type==="school"?"Например, математика":"Например, репетитор"}"></label>
      <label>Начало<input data-field="start" type="time" required value="${esc((item.start_time||"").slice(0,5))}"></label>
      <label>Конец<input data-field="end" type="time" required value="${esc((item.end_time||"").slice(0,5))}"></label>
      <button type="button" class="schedule-remove">×</button>`;
    row.querySelector('[data-field="day"]').onchange=e=>{list.dataset.lastSelectedDay=e.target.value;};
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
    else if(state.onboardingStep===3)state.onboardingStep=state.classGroup?3:selectedRadio("school")==="yes"?2:1;
    else if(state.onboardingStep===2)state.onboardingStep=1;
    updateOnboardingUI();
  }
  async function finishOnboarding(e){
    e?.preventDefault();
    const school=selectedRadio("school"),extras=selectedRadio("extras");
    if(!school)return onboardingBack();
    if(!state.classGroup&&school==="yes"&&!collectSchedule("school").length){state.onboardingStep=2;updateOnboardingUI();return toast("Добавь хотя бы один школьный урок");}
    if(!extras){state.onboardingStep=3;updateOnboardingUI();return toast("Выбери вариант про дополнительные занятия");}
    if(extras==="yes"&&!collectSchedule("extra").length){state.onboardingStep=4;updateOnboardingUI();return toast("Добавь хотя бы одно дополнительное занятие");}
    const items=[...(state.classGroup?[]:collectSchedule("school")),...collectSchedule("extra")];
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
      state.profile=up.data;state.personalSchedule=items.map(x=>({...x,user_id:state.user.id}));state.schedule=combineSchedules();
    }
    $("onboardingModal").classList.add("hidden");renderAll();toast("Расписание сохранено");
  }

  function renderAll(){
    $("profileName").textContent=state.profile?.display_name||"Пользователь";
    $("profileEmail").textContent=state.profile?.email||state.user?.email||"";
    $("avatar").textContent=(state.profile?.display_name||"П").slice(0,1).toUpperCase();
    if($("profileScheduleHint"))$("profileScheduleHint").textContent=state.classGroup?"Уроки назначает администратор класса. Здесь редактируются твои дополнительные занятия.":"Уроки и дополнительные занятия, которые week. учитывает при планировании.";
    renderWeek();renderRequests();renderFriends();renderClasses();renderTemplates();renderStats();renderProfile();renderSettings();updateTimerBar();updateSectionHeader();
  }

  function visibleTasks(){
    // Один календарь: личные задачи текущего пользователя + общие задачи.
    // Личные задачи других пользователей Supabase не отдаёт из-за RLS.
    return state.tasks.filter(t=>t.status!=="archived");
  }

  function selectedDate(){return new Date(state.currentDate.getFullYear(),state.currentDate.getMonth(),state.currentDate.getDate())}
  function syncWeekStart(){state.weekStart=startOfWeek(selectedDate())}
  function moveDay(delta){state.currentDate.setDate(state.currentDate.getDate()+delta);syncWeekStart();renderWeek();renderStats();void ensureVisibleRange()}
  function goToday(){state.currentDate=new Date();syncWeekStart();renderWeek();renderStats();void ensureVisibleRange()}
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
    const daySchedule=scheduleOnDate(ds);
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
      const preferredHour=Number(localStorage.getItem("week-day-start")||"0");
      const dayStart=preferredHour>0?Math.min(preferredHour*60,first):
        Math.max(0,first<7*60?first-60:Math.max(7*60,first-60));
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
    if(!events.length){
      const preferredHour=Number(localStorage.getItem("week-day-start")||"0");
      if(preferredHour>0)agendaEntries.push({type:"free",start:preferredHour*60,end:Math.min(1440,(preferredHour+6)*60)});
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
        return `<div class="agenda-row agenda-schedule-row">${range}<div class="schedule-track-item ${item.kind==="school"?"schedule-school":"schedule-extra"}"><strong>${esc(item.title)}</strong><span>${esc(item._oneOff?"Разовая замена":item.kind==="school"?"Занятие":"Дополнительное занятие")}</span></div></div>`;
      }
      return `<div class="agenda-row agenda-task-row" data-task-id="${e.data.seriesId||e.data.id}" ${e.data.owner_id===currentUserId()&&!e.data.recurrence&&!(window.matchMedia&&window.matchMedia("(pointer: coarse)").matches)?'draggable="true" title="Перетащи задачу в свободный промежуток"':""}>${range}${taskBlockHtml(e.data)}</div>`;
    }).join("");
    const empty=!tasks.length && !events.length && !agendaEntries.length;
    $("weekGrid").innerHTML=`<div class="day-col ${isToday(ds)?"today-day":""}">
      <div class="day-head"><div><span class="day-name">${dayTitle(ds)}</span><div class="small muted">${isToday(ds)?"Текущий день":""}</div></div><span class="day-date">${fmtDate(ds)}</span></div>
      <div class="day-summary"><div><strong>${tasks.length}</strong><span> ${tasks.length===1?"задача":"задач"}</span></div><div class="load-line"><span class="${level}" style="width:${Math.min(100,total/600*100)}%"></span></div><span class="small muted">${Math.floor(total/60)} ч ${total%60} мин</span></div>
      ${untimed.length?`<div class="untimed-list"><div class="agenda-caption">Без времени</div>${untimed.map(taskChipHtml).join("")}</div>`:""}
      ${empty?`<div class="empty-day"><div class="empty-icon">○</div><strong>Нет дел на этот день</strong><span>Здесь пока нет задач</span><button class="secondary" data-action="open-task-date" data-date="${esc(ds)}">+ Добавить задачу</button></div>`:`<div class="day-track agenda-track"><div class="agenda-caption">Расписание по времени</div>${agenda || '<div class="agenda-untimed-only">Задачи без указания времени находятся выше</div>'}</div>`}
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
      const schedule=scheduleOnDate(ds).filter(x=>x.start_time);
      const timed=[...tasks.filter(t=>t.start_time).map(t=>({...t,_type:"task"})),
        ...schedule.map(x=>({...x,_type:"schedule"}))].sort((a,b)=>toMin(a.start_time)-toMin(b.start_time));
      const total=tasks.reduce((a,t)=>a+minutes(t),0);
      const level=total>480?"high":total>300?"mid":"low";
      return `<div class="week-day ${isToday(ds)?"today-day":""}">
        <button class="week-day-head" type="button" data-action="select-calendar-day" data-date="${esc(ds)}" aria-label="Открыть ${esc(dayTitle(ds))}">
          <span>${dayName((date.getDay()+6)%7)} <strong>${date.getDate()}</strong></span><span class="small muted">${tasks.length} задач</span>
        </button>
        <div class="load-line"><span class="${level}" style="width:${Math.min(100,total/600*100)}%"></span></div>
        <div class="week-day-content">
          ${tasks.filter(t=>!t.start_time).map(taskChipHtml).join("")}
          ${timed.map(t=>t._type==="schedule"?`<div class="week-schedule-item ${t.kind==="school"?"schedule-school":"schedule-extra"}"><span>${timeRange(toMin(t.start_time),toMin(t.end_time||t.start_time))}</span> ${esc(t.title)}${t._oneOff?'<span class="oneoff-badge"> · замена</span>':""}</div>`:`<div class="week-task-item">${taskChipHtml(t)}</div>`).join("")}
          ${!tasks.length&&!schedule.length?'<p class="small muted week-empty">Свободно</p>':""}
        </div>
        <button type="button" class="secondary week-add" data-action="open-task-date" data-date="${esc(ds)}">+ Задача</button>
      </div>`;
    }).join("");
  }
  window.selectCalendarDay=ds=>{
    state.currentDate=new Date(ds+"T00:00:00");state.calendarView="day";
    localStorage.setItem("week-calendar-view","day");renderWeek();renderStats();void ensureVisibleRange();
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
      scheduleOnDate(date).some(item=>
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
    return `<button type="button" class="task-action-btn task-timer-btn" data-action="task-timer" data-id="${esc(actionId)}" aria-label="${running?"Остановить таймер":"Запустить таймер"}" title="${running?"Остановить таймер":"Запустить таймер"}">${running?"⏹":"⏱"}</button>`;
  }
  function taskActionsHtml(actionId){
    return `<div class="task-actions" role="group" aria-label="Действия с задачей">
      ${timerButtonHtml(actionId)}
      <button type="button" class="task-action-btn" data-action="task-edit" data-id="${esc(actionId)}" aria-label="Изменить задачу" title="Изменить">✎</button>
      <button type="button" class="task-action-btn task-delete-btn" data-action="task-delete" data-id="${esc(actionId)}" aria-label="Удалить задачу" title="Удалить">🗑</button>
    </div>`;
  }
  function taskChipHtml(t){
    const done=t.status==="done";
    const actionId=t.seriesId||t.id;
    const tracked=trackedMinutesFor(actionId);
    return `<article class="task-chip ${t.priority||"optional"} ${done?"done":""}"${taskColorAttr(t)}>
      <div class="task-content">
        <div class="task-heading"><input class="check" aria-label="Отметить задачу" type="checkbox" ${done?"checked":""} data-change-action="task-toggle" data-id="${esc(actionId)}"><span class="task-title">${esc(t.title)}${t.recurrence?" 🔁":""}</span></div>
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
        <div class="task-heading"><input class="check" aria-label="Отметить задачу" type="checkbox" ${done?"checked":""} data-change-action="task-toggle" data-id="${esc(actionId)}"><span class="task-title">${esc(t.title)}${t.recurrence?" 🔁":""}</span></div>
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
      const {error}=await sb.rpc("week_set_task_checklist",{p_task_id:id,p_checklist:list});
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
    // If a date is typed manually outside the cached period, load its tasks
    // before running the overlap check. Otherwise conflicts could be missed.
    if(!state.demo && dest!=="proposal" && base.date){
      const range=state.taskRange;
      const until=new Date(base.date+"T00:00:00");
      if(base.recurrence)until.setDate(until.getDate()+35);
      const endDate=iso(until);
      if(!range||base.date<range.start||endDate>range.end){
        const [{data:atDate,error:atErr},{data:oldSeries,error:seriesErr}]=await Promise.all([
          sb.from("tasks").select("*").gte("date",base.date).lte("date",endDate),
          sb.from("tasks").select("*").lt("date",base.date).not("recurrence","is",null)
        ]);
        if(atErr||seriesErr){toast("Не удалось проверить календарь. Повтори сохранение позже.");return}
        const merged=new Map(state.tasks.map(t=>[t.id,t]));
        for(const t of [...(atDate||[]),...(oldSeries||[])])merged.set(t.id,t);
        state.tasks=[...merged.values()];
      }
    }
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
      if(!state.demo)await ensureVisibleRange();
    }
    $("taskModal").classList.add("hidden");renderAll();toast(id?"Задача обновлена":dest==="proposal"?"Предложение отправлено":"Задача создана");
  }

  window.weekToggle=async(id,checked)=>{
    const t=state.tasks.find(x=>x.id===id);if(!t)return;
    const wasDone=t.status==="done";
    if(state.demo){const original=demoData.tasks.find(x=>x.id===id);if(original)original.status=checked?"done":"open";saveDemo();loadDemo()}
    else{
      const {error}=await sb.rpc("week_set_task_status",{p_task_id:id,p_status:checked?"done":"open"});
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
    const incoming=$('requestsList'),outgoing=$('sentRequestsList');
    const viewingOutgoing=state.requestTab==='outgoing';
    qsa('[data-request-tab]').forEach(button=>{
      const selected=button.dataset.requestTab===(viewingOutgoing?'outgoing':'incoming');
      button.classList.toggle('active',selected);
      button.setAttribute('aria-selected',String(selected));
      button.tabIndex=selected?0:-1;
    });
    incoming.classList.toggle('hidden',viewingOutgoing);
    outgoing.classList.toggle('hidden',!viewingOutgoing);
    const displayPerson=userId=>{
      const profile=(state.__profiles||[]).find(p=>p.id===userId)||
        (state.friends||[]).find(p=>p.id===userId)||
        (state.demo?demoData.profiles.find(p=>p.id===userId):null);
      return profile?esc(profile.display_name||profile.username||'Пользователь'):'Пользователь';
    };
    const taskDetails=r=>`<div class="task-meta">${fmtDate(r.date)}${r.start_time?' • '+esc(String(r.start_time).slice(0,5)):''} • ${Number(r.duration)||60} мин • ${esc(r.category||'Другое')}</div>`;
    incoming.innerHTML=state.requests.length?state.requests.map(r=>`<div class="request-card"${taskColorAttr(r)}>
      <div class="small muted request-person">От: ${displayPerson(r.from_user_id)}</div>
      <strong>${esc(r.title)}</strong>
      ${taskDetails(r)}
      <p>${esc(r.description||'Без описания')}</p>
      <div class="actions"><button class="primary" data-action="request-accept" data-id="${esc(r.id)}">Принять</button><button class="secondary" data-action="request-reject" data-id="${esc(r.id)}">Отклонить</button><button class="secondary" data-action="request-counter" data-id="${esc(r.id)}">Предложить другое время</button></div>
    </div>`).join(''):'<p class="muted">Новых входящих предложений нет.</p>';
    const statusNames={pending:'Ожидает ответа',accepted:'Принято',rejected:'Отклонено'};
    outgoing.innerHTML=state.sentRequests.length?state.sentRequests.map(r=>`<div class="request-card"${taskColorAttr(r)}>
      <div class="small muted request-person">Кому: ${displayPerson(r.to_user_id)}</div>
      <strong>${esc(r.title)}</strong>
      ${taskDetails(r)}
      <p>${esc(r.description||'Без описания')}</p>
      <div class="request-status" data-status="${esc(r.status||'pending')}">${esc(statusNames[r.status]||'Статус неизвестен')}</div>
    </div>`).join(''):'<p class="muted">Ты ещё не отправлял предложений.</p>';
  }
  window.acceptRequest=async id=>{
    const r=state.requests.find(x=>x.id===id);if(!r)return;
    if(state.demo){demoData.requests=demoData.requests.map(x=>x.id===id?{...x,status:"accepted"}:x);demoData.tasks.push({id:uid(),owner_id:r.from_user_id,visibility:"shared",status:"open",title:r.title,description:r.description,date:r.date,start_time:r.start_time,duration:r.duration,category:r.category,priority:r.priority,color:taskColor(r.color),checklist:checklistFor(r)});saveDemo();loadDemo()}
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
    if(state.demo){demoData.requests=demoData.requests.map(r=>r.id===id?{...r,status:"rejected"}:r);saveDemo();loadDemo()}
    else{await sb.from("task_requests").update({status:"rejected"}).eq("id",id).eq("to_user_id",state.user.id);await reloadCloud()}
    renderAll();toast("Предложение отклонено");
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
      $("friendSearchResult").innerHTML=found?`<div class="friend-result"><div><strong>${esc(found.display_name)}</strong><div class="small muted">@${esc(found.username||username)}</div></div><button class="primary" data-action="friend-demo-add" data-id="${esc(found.id)}">Добавить</button></div>`:'<p class="muted small">Пользователь не найден.</p>';
      return;
    }
    const {data,error}=await sb.rpc("week_find_profile_by_username",{p_username:username}).maybeSingle();
    if(error){toast(error.message);return}
    if(!data){$("friendSearchResult").innerHTML='<p class="muted small">Пользователь не найден.</p>';return}
    if(friendById(data.id)){$("friendSearchResult").innerHTML='<p class="muted small">Этот пользователь уже у тебя в друзьях.</p>';return}
    const already=state.sentFriendRequests.some(r=>r.to_user_id===data.id)||state.friendRequests.some(r=>r.from_user_id===data.id);
    $("friendSearchResult").innerHTML=already?`<div class="friend-result"><div><strong>${esc(data.display_name)}</strong><div class="small muted">@${esc(data.username||"")}</div></div><span class="small muted">Заявка уже отправлена</span></div>`:`<div class="friend-result"><div><strong>${esc(data.display_name)}</strong><div class="small muted">@${esc(data.username||"")}</div></div><button class="primary" data-friend-id="${esc(data.id)}" data-action="friend-send" data-id="${esc(data.id)}">Добавить</button></div>`;
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
      await reloadCloud();renderFriends();renderClasses();toast("Заявка отправлена");
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
    renderFriends();renderClasses();toast("Заявка принята");
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
  // Classes: code issuance and schedule writes are verified by Supabase RPC, not by the UI.
  function classCodeMessage(code){
    state.lastClassCode=code;
    state.__codeGroupId=state.classViewGroup?.id||state.adminClassId;
    $("classInviteCode").textContent=code;
    $("classCodeBox").classList.remove("hidden");
  }
  async function joinClass(e){
    e.preventDefault();
    const code=$("classJoinCode").value.trim();
    if(!code)return;
    if(state.demo){
      const group=(demoData.classGroups||[]).find(g=>g.invite_code.replaceAll("-","")===code.replaceAll("-","").toUpperCase());
      if(!group){toast("Неверный код класса");return}
      if((demoData.classMemberships||[]).some(m=>m.user_id===currentUserId()&&m.class_id!==group.id)){toast("Ты уже состоишь в другом классе");return}
      demoData.classMemberships||=[];
      if(!demoData.classMemberships.some(m=>m.user_id===currentUserId()))demoData.classMemberships.push({class_id:group.id,user_id:currentUserId()});
      saveDemo();loadDemo();renderAll();toast("Ты вступил в класс");return;
    }
    const {error}=await sb.rpc("week_join_class",{p_code:code});
    if(error){toast(error.message);return}
    $("classJoinCode").value="";
    await reloadCloud();renderAll();toast("Ты вступил в класс");
  }
  async function createClass(e){
    e.preventDefault();
    if(!state.isWeekAdmin)return toast("Нет прав администратора");
    const name=$("classCreateName").value.trim();if(!name)return;
    if(state.demo){
      const raw=Array.from({length:24},()=>Math.floor(Math.random()*16).toString(16)).join("").toUpperCase();
      const code=raw.match(/.{1,6}/g).join("-");
      const group={id:uid(),name,invite_code:code,permanent_code:code};
      demoData.classGroups||=[];demoData.classGroups.push(group);
      state.adminClassId=group.id;saveDemo();loadDemo();classCodeMessage(code);renderAll();toast("Класс создан");return;
    }
    const {data,error}=await sb.rpc("week_create_class",{p_name:name});
    if(error){toast(error.message);return}
    const result=Array.isArray(data)?data[0]:data;
    if(!result?.class_id)return toast("Не получен ответ от базы");
    state.adminClassId=result.class_id;
    await reloadCloud();renderAll();classCodeMessage(result.invite_code);
    $("classCreateName").value="";toast("Класс создан");
  }
  async function showPermanentClassCode(){
    if(!state.isWeekAdmin||!state.classViewGroup)return;
    const group=state.classViewGroup, groupId=group.id;
    if(state.__codeGroupId===groupId)return;
    state.__codeGroupId=groupId;
    $("classCodeBox").classList.add("hidden");$("classLegacyPanel").classList.add("hidden");
    try{
      const code=state.demo?(demoData.classGroups||[]).find(g=>g.id===groupId)?.permanent_code||null:
        (await sb.rpc("week_get_class_invite_code",{p_class_id:groupId}));
      if(!state.isWeekAdmin||state.classViewGroup?.id!==groupId)return;
      if(state.demo){
        if(code)classCodeMessage(code);else $("classLegacyPanel").classList.remove("hidden");
      }else if(code.error){
        state.__codeGroupId=null;toast("Код класса: выполни миграцию 2.3");
      }else if(code.data)classCodeMessage(code.data);
      else $("classLegacyPanel").classList.remove("hidden");
    }catch(error){state.__codeGroupId=null;console.error(error);}
  }
  async function lockClassCode(keepExisting){
    if(!state.isWeekAdmin||!state.classViewGroup)return;
    const classId=state.classViewGroup.id;
    const oldCode=$("classExistingCode").value.trim();
    if(keepExisting&&!oldCode)return toast("Введи ранее выданный код класса");
    if(!keepExisting&&!confirm("Будет создан НОВЫЙ постоянный код. Старый код перестанет работать. Продолжить?"))return;
    if(state.demo){
      const group=demoData.classGroups.find(g=>g.id===classId);
      if(keepExisting&&oldCode.replaceAll("-","").toUpperCase()!==group.invite_code.replaceAll("-","").toUpperCase())
        return toast("Старый код не совпадает");
      if(!keepExisting){const raw=Array.from(crypto.getRandomValues(new Uint8Array(12)),x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();group.invite_code=raw.match(/.{1,6}/g).join("-");}
      group.permanent_code=group.invite_code;saveDemo();loadDemo();
      classCodeMessage(group.permanent_code);
    }else{
      const {data,error}=await sb.rpc("week_lock_class_invite_code",{
        p_class_id:classId,p_existing_code:keepExisting?oldCode:null});
      if(error)return toast(error.message);
      if(state.classViewGroup?.id!==classId)return;
      classCodeMessage(data);
    }
    $("classLegacyPanel").classList.add("hidden");
    toast("За классом закреплён постоянный код");
  }
  function addClassLessonRow(item={}){
    const list=$("classScheduleRows");
    const row=document.createElement("div");row.className="schedule-row";
    // A newly added lesson inherits the last day selected in this editor.
    // Existing lessons keep their saved weekdays when the editor opens.
    const day=String(item.day_of_week ?? list.dataset.lastSelectedDay ??
      list.querySelector('.schedule-row:last-child [data-field="day"]')?.value ?? "1");
    row.innerHTML=`<label>День<select data-field="day">${DAY_OPTIONS.map(([v,n])=>`<option value="${v}" ${v===day?"selected":""}>${n}</option>`).join("")}</select></label>
      <label>Предмет<input data-field="title" maxlength="120" value="${esc(item.title||"")}" placeholder="Например, математика" required></label>
      <label>Начало<input type="time" data-field="start" value="${esc(String(item.start_time||"").slice(0,5))}" required></label>
      <label>Конец<input type="time" data-field="end" value="${esc(String(item.end_time||"").slice(0,5))}" required></label>
      <button type="button" class="schedule-remove" aria-label="Удалить урок">×</button>`;
    row.querySelector('[data-field="day"]').onchange=e=>{list.dataset.lastSelectedDay=e.target.value;};
    row.querySelector(".schedule-remove").onclick=()=>row.remove();
    list.appendChild(row);
  }
  function openClassScheduleEditor(){
    if(!state.isWeekAdmin||!state.classViewGroup)return;
    $("classScheduleRows").innerHTML="";
    delete $("classScheduleRows").dataset.lastSelectedDay;
    (state.classViewSchedule||[]).forEach(addClassLessonRow);
    $("classScheduleDetails").open=true;
    $("classScheduleEditor").classList.remove("hidden");
  }
  async function saveClassSchedule(){
    if(!state.isWeekAdmin||!state.classViewGroup)return;
    const items=[...$("classScheduleRows").querySelectorAll(".schedule-row")].map(row=>({
      ...(row.dataset.lessonId?{id:row.dataset.lessonId}:{}),
      day_of_week:Number(row.querySelector('[data-field="day"]').value),
      title:row.querySelector('[data-field="title"]').value.trim(),
      start_time:row.querySelector('[data-field="start"]').value,
      end_time:row.querySelector('[data-field="end"]').value
    }));
    if(items.length>70||items.some(x=>!x.title||x.title.length>120||!x.start_time||!x.end_time||x.end_time<=x.start_time))
      return toast("Проверь названия, время уроков и лимит 70 записей");
    if(state.demo){
      const classId=state.classViewGroup.id;
      const oldItems=(demoData.classSchedules||[]).filter(s=>s.class_id===classId);
      const existing=new Map(oldItems.map(x=>[x.id,x]));
      const kept=new Set(items.map(x=>x.id).filter(Boolean));
      const changedDays=new Set(items.filter(x=>x.id&&existing.has(x.id)&&Number(existing.get(x.id).day_of_week)!==x.day_of_week).map(x=>x.id));
      demoData.classSchedules=(demoData.classSchedules||[]).filter(s=>s.class_id!==classId);
      demoData.classSchedules.push(...items.map(x=>({...x,class_id:classId,id:x.id||uid()})));
      demoData.classExceptions=(demoData.classExceptions||[]).filter(x=>x.class_id!==classId||(kept.has(x.lesson_id)&&!changedDays.has(x.lesson_id)));
      saveDemo();loadDemo();$("classScheduleEditor").classList.add("hidden");renderAll();toast("Расписание сохранено");return;
    }
    const {error}=await sb.rpc("week_replace_class_schedule",{p_class_id:state.classViewGroup.id,p_items:items});
    if(error){toast(error.message);return}
    await reloadCloud();$("classScheduleEditor").classList.add("hidden");renderAll();toast("Расписание сохранено для всего класса");
  }
  // Copy only the administrator's personal SCHOOL lessons into the selected class.
  // Never copy private extra lessons, delete the source, or accept an empty import.
  function schoolLessonsForClassImport(schedule){
    return (schedule||[]).filter(item=>item.kind==="school").map(item=>({
      day_of_week:Number(item.day_of_week),
      title:String(item.title||"").trim(),
      start_time:String(item.start_time||"").slice(0,5),
      end_time:String(item.end_time||"").slice(0,5)
    }));
  }
  async function importMySchoolScheduleToClass(){
    if(!state.isWeekAdmin||!state.classViewGroup)return toast("Нет прав администратора или класс не выбран");
    const button=$("classImportMySchedule");
    if(button.disabled)return;
    const classId=state.classViewGroup.id, className=state.classViewGroup.name;
    button.disabled=true;
    try{
      let source=state.personalSchedule||[];
      if(!state.demo){
        // Read the stored personal schedule afresh: the visible calendar hides
        // private school lessons after a user joins a class.
        const {data,error}=await sb.from("schedule_items")
          .select("kind,day_of_week,title,start_time,end_time")
          .eq("user_id",state.user.id).eq("kind","school")
          .order("day_of_week").order("start_time");
        if(error)throw error;
        source=data||[];
      }
      if(!state.isWeekAdmin||state.classViewGroup?.id!==classId)
        return toast("Выбранный класс изменился. Повтори перенос");
      const items=schoolLessonsForClassImport(source);
      if(!items.length)return toast("В твоём личном расписании нет школьных уроков");
      if(items.length>70||items.some(x=>!Number.isInteger(x.day_of_week)||x.day_of_week<0||x.day_of_week>6||
        !x.title||x.title.length>120||!x.start_time||!x.end_time||x.end_time<=x.start_time))
        return toast("Проверь личные уроки: названия, время и лимит 70 записей");
      const existing=(state.classViewSchedule||[]).length;
      const message=`Перенести ${items.length} школьных уроков из твоего личного расписания в класс «${className}»?\n\n`+
        (existing?`Текущее расписание класса (${existing} уроков) будет ПОЛНОСТЬЮ ЗАМЕНЕНО.\n`:
          "Для этого класса будет создано общее расписание.\n")+
        "Личное расписание останется без изменений. Дополнительные занятия не переносим.";
      if(!confirm(message))return;
      if(!state.isWeekAdmin||state.classViewGroup?.id!==classId)
        return toast("Выбранный класс изменился. Повтори перенос");
      if(state.demo){
        demoData.classSchedules=(demoData.classSchedules||[]).filter(x=>x.class_id!==classId);
        demoData.classExceptions=(demoData.classExceptions||[]).filter(x=>x.class_id!==classId);
        demoData.classSchedules.push(...items.map(x=>({...x,class_id:classId,id:uid()})));
        saveDemo();loadDemo();
      }else{
        // Existing SQL RPC checks week_admins and changes the class atomically.
        const {error}=await sb.rpc("week_replace_class_schedule",{p_class_id:classId,p_items:items});
        if(error)throw error;
        await reloadCloud();
      }
      $("classScheduleEditor").classList.add("hidden");
      renderAll();
      toast(`Перенесено ${items.length} уроков в класс «${className}»`);
    }catch(error){
      console.error("Импорт личного расписания в класс",error);
      toast(`Не удалось перенести расписание: ${error.message||"ошибка соединения"}`);
    }finally{button.disabled=false;}
  }
  function renderClasses(){
    const admin=state.isWeekAdmin, mine=state.classGroup, group=state.classViewGroup;
    $("classAdminPanel").classList.toggle("hidden",!admin);
    $("classJoinPanel").classList.toggle("hidden",!!mine);
    $("classInfo").classList.toggle("hidden",!mine);
    if(mine)$("className").textContent=mine.name;
    if(admin){
      const picker=$("adminClassSelect");
      picker.innerHTML=state.adminGroups.length?state.adminGroups.map(g=>`<option value="${g.id}" ${g.id===group?.id?"selected":""}>${esc(g.name)}</option>`).join(""):'<option value="">Классы ещё не созданы</option>';
      void showPermanentClassCode();
    }
    $("classContent").classList.toggle("hidden",!group);
    if(!group)return;
    const days=[1,2,3,4,5,6,0];
    const items=state.classViewSchedule||[];
    $("classScheduleList").innerHTML=items.length?days.map(day=>{
      const own=items.filter(i=>Number(i.day_of_week)===day);
      if(!own.length)return "";
      const label=DAY_OPTIONS.find(x=>Number(x[0])===day)?.[1]||"";
      return `<div class="class-day"><strong>${label}</strong><div>${own.map(i=>`<div class="class-lesson"><span>${esc(String(i.start_time).slice(0,5))}–${esc(String(i.end_time).slice(0,5))}</span><b>${esc(i.title)}</b>${admin?`<button type="button" class="secondary class-edit-one" data-action="class-lesson-edit" data-id="${esc(i.id)}">Изменить</button>`:""}</div>`).join("")}</div></div>`;
    }).join(""):'<p class="small muted">Расписание ещё не заполнено.</p>';
    const upcoming=(state.classExceptions||[]).filter(x=>x.class_id===group.id&&x.lesson_date>=iso(new Date()))
      .sort((a,b)=>a.lesson_date.localeCompare(b.lesson_date)).slice(0,12);
    $("classChangesList").innerHTML=upcoming.length?'<h4>Разовые изменения</h4>'+upcoming.map(x=>{
      const lesson=items.find(i=>i.id===x.lesson_id);
      if(!lesson)return "";
      return `<div class="class-change-line"><strong>${esc(x.lesson_date)}</strong> · ${esc(lesson.title)} → ${x.cancelled?"отменён":
        `${esc(x.title)} (${esc(String(x.start_time).slice(0,5))}–${esc(String(x.end_time).slice(0,5))})`}</div>`;
    }).join(""):"";
    $("classImportMySchedule").classList.toggle("hidden",!admin);
    $("classEditSchedule").classList.toggle("hidden",!admin);
    const rows=state.classMembers||[];
    $("classMembersList").innerHTML=rows.length?rows.map(f=>{
      let action="";
      if(f.id===currentUserId())action='<span class="small muted">Это ты</span>';
      else if(friendById(f.id))action='<span class="small muted">В друзьях</span>';
      else{
        const incoming=state.friendRequests.find(r=>r.from_user_id===f.id),outgoing=state.sentFriendRequests.some(r=>r.to_user_id===f.id);
        action=incoming?`<button class="primary" data-action="friend-accept" data-id="${esc(incoming.id)}">Принять</button>`:
          outgoing?'<span class="small muted">Заявка отправлена</span>':`<button class="secondary" data-action="friend-send" data-id="${esc(f.id)}">+ В друзья</button>`;
      }
      return `<div class="friend-row"><div class="avatar mini">${esc((f.display_name||"П").slice(0,1).toUpperCase())}</div><div class="class-member-name"><strong>${esc(f.display_name)}</strong><div class="small muted">@${esc(f.username||"")}</div><div class="class-role-label">${esc(CLASS_ROLE_LABELS[f.role]||CLASS_ROLE_LABELS.student)}</div></div><div class="actions">${admin?`<select class="class-role-select" aria-label="Звание участника ${esc(f.display_name)}" data-change-action="class-role" data-id="${esc(f.id)}">${Object.entries(CLASS_ROLE_LABELS).map(([v,n])=>`<option value="${v}" ${v===(f.role||"student")?"selected":""}>${n}</option>`).join("")}</select>`:""}${action}</div></div>`;
    }).join(""):'<p class="small muted">Пока участников нет.</p>';
  }

  const CLASS_ROLE_LABELS={student:"Ученик",teacher:"Учитель",homeroom_teacher:"Классный руководитель"};
  window.setClassMemberRole=async(userId,role)=>{
    if(!state.isWeekAdmin||!state.classViewGroup)return;
    const classId=state.classViewGroup.id;
    if(!CLASS_ROLE_LABELS[role])return;
    if(state.demo){
      const member=(demoData.classMemberships||[]).find(m=>m.class_id===classId&&m.user_id===userId);
      if(!member)return;member.role=role;saveDemo();loadDemo();renderClasses();toast("Звание изменено");return;
    }
    const {error}=await sb.rpc("week_set_class_member_role",{p_class_id:classId,p_user_id:userId,p_role:role});
    if(error){toast(error.message);renderClasses();return;}
    await reloadCloud();renderAll();toast("Звание изменено");
  };
  function updateLessonEditorMode(){
    const once=$("lessonChangeMode").value==="once";
    $("lessonChangeDateField").classList.toggle("hidden",!once);
    $("lessonChangeDayField").classList.toggle("hidden",once);
    $("lessonCancelOnceField").classList.toggle("hidden",!once);
    $("lessonChangeDate").required=once;
    $("lessonChangeTitle").required=!(once&&$("lessonCancelled").checked);
    $("lessonChangeStart").required=!(once&&$("lessonCancelled").checked);
    $("lessonChangeEnd").required=!(once&&$("lessonCancelled").checked);
    if(!once){$("lessonChangeDate").setCustomValidity("");$("classResetException").classList.add("hidden");}
  }
  function refreshLessonDateForm(){
    const lesson=state.classViewSchedule.find(x=>x.id===$("lessonEditModal").dataset.lessonId);
    if(!lesson||$("lessonChangeMode").value!=="once")return;
    const date=$("lessonChangeDate").value;
    const valid=date&&new Date(date+"T00:00:00").getDay()===Number(lesson.day_of_week);
    $("lessonChangeDate").setCustomValidity(valid?"":"Выбери дату с тем же днём недели, что и урок");
    const ex=(state.classExceptions||[]).find(e=>e.lesson_id===lesson.id&&e.lesson_date===date);
    $("classResetException").classList.toggle("hidden",!ex);
    $("lessonChangeTitle").value=ex&&!ex.cancelled?ex.title:lesson.title;
    $("lessonChangeStart").value=String(ex&&!ex.cancelled?ex.start_time:lesson.start_time).slice(0,5);
    $("lessonChangeEnd").value=String(ex&&!ex.cancelled?ex.end_time:lesson.end_time).slice(0,5);
    $("lessonCancelled").checked=!!ex?.cancelled;
  }
  window.openClassLessonEdit=id=>{
    if(!state.isWeekAdmin)return;
    const lesson=state.classViewSchedule.find(x=>x.id===id);
    if(!lesson)return;
    const modal=$("lessonEditModal");
    modal.dataset.lessonId=id;modal.dataset.classId=state.classViewGroup.id;
    $("lessonChangeMode").value="once";
    $("lessonChangeDay").value=String(lesson.day_of_week);
    $("lessonChangeDate").value=upcomingWeekday(lesson.day_of_week);
    $("lessonChangeTitle").value=lesson.title;
    $("lessonChangeStart").value=String(lesson.start_time).slice(0,5);
    $("lessonChangeEnd").value=String(lesson.end_time).slice(0,5);
    $("lessonCancelled").checked=false;
    updateLessonEditorMode();refreshLessonDateForm();modal.classList.remove("hidden");
  };
  async function resetLessonException(){
    if(!state.isWeekAdmin)return;
    const modal=$("lessonEditModal"),lessonId=modal.dataset.lessonId,classId=modal.dataset.classId,
      date=$("lessonChangeDate").value;
    if(state.classViewGroup?.id!==classId||!date)return;
    if(!confirm("Вернуть обычный урок на эту дату?"))return;
    if(state.demo){
      demoData.classExceptions=(demoData.classExceptions||[]).filter(x=>x.lesson_id!==lessonId||x.lesson_date!==date);
      saveDemo();loadDemo();
    }else{
      const {error}=await sb.rpc("week_remove_class_lesson_exception",{p_lesson_id:lessonId,p_date:date});
      if(error)return toast(error.message);
      await reloadCloud();
    }
    modal.classList.add("hidden");renderAll();toast("Обычное расписание восстановлено");
  }
  async function saveLessonChange(e){
    e.preventDefault();
    if(!state.isWeekAdmin)return;
    const modal=$("lessonEditModal"),classId=modal.dataset.classId,lessonId=modal.dataset.lessonId;
    if(state.classViewGroup?.id!==classId)return toast("Класс был изменён, открой урок заново");
    const mode=$("lessonChangeMode").value,date=$("lessonChangeDate").value;
    const day=Number($("lessonChangeDay").value),cancelled=mode==="once"&&$("lessonCancelled").checked;
    const title=$("lessonChangeTitle").value.trim(),start=$("lessonChangeStart").value,end=$("lessonChangeEnd").value;
    if(mode==="once"){
      const lesson=state.classViewSchedule.find(x=>x.id===lessonId);
      if(!lesson||!date||new Date(date+"T00:00:00").getDay()!==Number(lesson.day_of_week))
        return toast("Выбери правильную дату для этого урока");
    }
    if(!cancelled&&(!title||title.length>120||!start||!end||end<=start))
      return toast("Проверь название и время урока");
    if(state.demo){
      const lesson=demoData.classSchedules.find(x=>x.id===lessonId&&x.class_id===classId);
      if(!lesson)return;
      if(mode==="once"){
        demoData.classExceptions||=[];
        demoData.classExceptions=demoData.classExceptions.filter(x=>x.lesson_id!==lessonId||x.lesson_date!==date);
        demoData.classExceptions.push({id:uid(),class_id:classId,lesson_id:lessonId,lesson_date:date,cancelled,
          title:cancelled?null:title,start_time:cancelled?null:start,end_time:cancelled?null:end});
      }else{
        if(Number(lesson.day_of_week)!==day)demoData.classExceptions=(demoData.classExceptions||[]).filter(x=>x.lesson_id!==lessonId);
        Object.assign(lesson,{day_of_week:day,title,start_time:start,end_time:end});
      }
      saveDemo();loadDemo();
    }else{
      const {error}=await sb.rpc("week_change_class_lesson",{p_lesson_id:lessonId,p_mode:mode,
        p_date:mode==="once"?date:null,p_day_of_week:mode==="forever"?day:null,
        p_title:cancelled?null:title,p_start_time:cancelled?null:start,p_end_time:cancelled?null:end,p_cancelled:cancelled});
      if(error)return toast(error.message);
      await reloadCloud();
    }
    modal.classList.add("hidden");renderAll();toast(mode==="once"?"Изменён только выбранный день":"Расписание изменено на все недели");
  }
  function renderFriends(){
    const list=$("friendsList"), req=$("friendRequestsList"), sent=$("sentFriendRequestsList");
    list.innerHTML=state.friends.length?state.friends.map(f=>`<div class="friend-row"><div class="avatar mini">${esc((f.display_name||"П").slice(0,1).toUpperCase())}</div><div><strong>${esc(f.display_name)}</strong><div class="small muted">@${esc(f.username||"")}</div></div><div class="actions"><button class="secondary" data-action="friend-unfriend" data-id="${esc(f.id)}">Удалить</button></div></div>`).join(""):'<p class="muted small">Пока нет друзей.</p>';
    req.innerHTML=state.friendRequests.length?state.friendRequests.map(r=>{const f=(state.__profiles||[]).find(x=>x.id===r.from_user_id);return `<div class="friend-row"><div><strong>${esc(f?.display_name||"Новый друг")}</strong></div><div class="actions"><button class="primary" data-action="friend-accept" data-id="${esc(r.id)}">Принять</button><button class="secondary" data-action="friend-reject" data-id="${esc(r.id)}">Отклонить</button></div></div>`}).join(""):'<p class="muted small">Новых заявок нет.</p>';
    if(sent)sent.innerHTML=state.sentFriendRequests.length?state.sentFriendRequests.map(r=>{const f=(state.__profiles||[]).find(x=>x.id===r.to_user_id);return `<div class="friend-row"><div><strong>${esc(f?.display_name||"Пользователь")}</strong><div class="small muted">Ожидает ответа</div></div><div class="actions"><button class="secondary" data-action="friend-cancel" data-id="${esc(r.id)}">Отменить</button></div></div>`}).join(""):'<p class="muted small">Отправленных заявок нет.</p>';
    $("friendBadge").textContent=state.friendRequests.length;$("friendBadge").classList.toggle("hidden",!state.friendRequests.length);
    fillFriendPicker($("taskFriend")?.value||state.friends[0]?.id||"");
  }

  function renderTemplates(){
    $("templatesList").innerHTML=state.templates.length?state.templates.map(t=>`<div class="template"><strong>${esc(t.title)}</strong><div class="task-meta">${esc(t.category)} • ${t.duration} мин • ${priorityLabel(t.priority)}</div><button class="secondary" style="margin-top:12px" data-action="template-use" data-id="${esc(t.id)}">Добавить в неделю</button></div>`).join(""):"<p class='muted'>Шаблонов пока нет.</p>";
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
      const schedule=scheduleOnDate(day).filter(x=>x.start_time&&x.end_time);
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
      const label=dayName((d.date.getDay()+6)%7);
      return `<div class="bar-wrap" title="${label}: ${formatMinutes(d.total)}"><div class="small stats-bar-total">${(d.total/60).toFixed(1)} ч</div><div class="stats-bar-stack" aria-label="${label}: ${formatMinutes(d.total)}">${bar}</div><div class="bar-label">${label}</div></div>`;
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
    $("weekFirstDay").value=localStorage.getItem("week-week-start")==="sunday"?"sunday":"monday";
    $("dayStartHour").value=localStorage.getItem("week-day-start")||"0";
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
    localStorage.setItem("week-week-start",$("weekFirstDay").value);
    localStorage.setItem("week-day-start",$("dayStartHour").value);
    syncWeekStart();renderWeek();renderStats();
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

  // Lightweight 3-minute polling, suspended while the tab is hidden.
  setInterval(()=>{void pollChanges()},180000);
  async function refreshAfterReturn(){
    if(state.demo||!state.user||document.visibilityState==="hidden")return;
    if(!state.needsReload&&Date.now()-(state.lastFullRefresh||0)<90000)return;
    await reloadCloud();renderAll();
  }
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")void refreshAfterReturn()});
  window.addEventListener("online",()=>{void refreshAfterReturn()});
  applyTheme(localStorage.getItem("week-theme")||APP_CFG.theme||"system");
  if(window.matchMedia){window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>{if((localStorage.getItem("week-theme")||APP_CFG.theme)==="system")applyTheme("system")})}
  boot();
})();
