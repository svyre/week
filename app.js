(() => {
  const hasSupabase = !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);
  const sb = hasSupabase ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY) : null;
  const $ = id => document.getElementById(id);
  const qs = s => document.querySelector(s);
  const qsa = s => [...document.querySelectorAll(s)];

  let state = {
    user:null, profile:null, section:"week", person:"me",
    weekStart: startOfWeek(new Date()), tasks:[], requests:[], templates:[],
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
    ]
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

  function currentUserId(){return state.user?.id || "demo-vadim";}
  function otherId(){return currentUserId()==="demo-sonya"?"demo-vadim":"demo-sonya"}
  async function getOtherUser(){
    if(state.demo)return demoData.profiles.find(p=>p.id!==currentUserId())||null;
    const {data,error}=await sb.from("profiles").select("id,display_name,email").neq("id",currentUserId()).order("created_at",{ascending:true}).limit(1).maybeSingle();
    if(error){toast(error.message);return null}
    return data||null;
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
    $("notificationsEnabled").checked=true; saveNotificationSettings(); scheduleNotifications(); toast("Уведомления включены"); return true;
  }
  function scheduleNotifications(){
    if(window.__weekTimers)window.__weekTimers.forEach(clearTimeout); window.__weekTimers=[];
    const cfg=notificationSettings();
    if(!cfg.enabled || !("Notification" in window) || Notification.permission!=="granted")return;
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
    scheduleNotifications();
  }
  function saveDemo(){localStorage.setItem("week-demo",JSON.stringify(demoData))}
  function showAuth(){$("authView").classList.remove("hidden");$("appView").classList.add("hidden")}
  function showApp(){$("authView").classList.add("hidden");$("appView").classList.remove("hidden");renderAll()}

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
  }
  async function reloadCloud(){
    if(state.demo){loadDemo();return}
    const {data:tasks}=await sb.from("tasks").select("*").order("date").order("start_time");
    const {data:requests}=await sb.from("task_requests").select("*").eq("to_user_id",state.user.id).eq("status","pending").order("created_at",{ascending:false});
    const {data:templates}=await sb.from("task_templates").select("*").eq("user_id",state.user.id).order("created_at",{ascending:false});
    state.tasks=tasks||[];state.requests=requests||[];state.templates=templates||[];
    scheduleNotifications();
    $("requestBadge").textContent=state.requests.length;$("requestBadge").classList.toggle("hidden",!state.requests.length);
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
    qsa("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).classList.add("hidden"));
    $("taskForm").onsubmit=saveTask;
    $("templateForm").onsubmit=saveTemplate;
    $("saveSettings").onclick=saveSettings;
    $("exportBtn").onclick=exportData;
    $("importFile").onchange=importData;
    $("notificationsEnabled").onchange=async e=>{if(e.target.checked){await enableNotifications()}else{saveNotificationSettings();scheduleNotifications()}};
    $("notificationLead").onchange=()=>{saveNotificationSettings();scheduleNotifications()};
    $("enableNotifications").onclick=enableNotifications;
    if("Notification" in window && Notification.permission==="granted"){$("notificationsEnabled").checked=notificationSettings().enabled;}
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
    renderWeek();renderRequests();renderTemplates();renderStats();renderSettings();
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
    const tasks=visibleTasks();
    let html="";
    for(let i=0;i<7;i++){
      const d=new Date(state.weekStart);d.setDate(d.getDate()+i);const ds=iso(d);
      const dayTasks=tasks.filter(t=>t.date===ds);
      const total=dayTasks.reduce((a,t)=>a+minutes(t),0), pct=Math.min(100,total/600*100);
      const level=total>480?"high":total>300?"mid":"low";
      html+=`<div class="day-col">
        <div class="day-head"><span class="day-name">${dayName(i)}</span><span class="day-date">${fmtDate(ds)}</span></div>
        <div class="load-line"><span class="${level}" style="width:${pct}%"></span></div>
        <div class="small muted">${Math.floor(total/60)} ч ${total%60} мин</div>
        ${dayTasks.sort((a,b)=>(a.start_time||"").localeCompare(b.start_time||"")).map(taskHtml).join("")}
      </div>`;
    }
    $("weekGrid").innerHTML=html;
  }

  function taskHtml(t){
    const done=t.status==="done";
    return `<article class="task ${t.priority||"optional"} ${done?"done":""}">
      <div><input class="check" type="checkbox" ${done?"checked":""} onchange="window.weekToggle('${t.id}',this.checked)"><span class="task-title">${esc(t.title)}</span></div>
      <div class="task-meta"><span>${esc(t.category||"Другое")}</span><span>•</span><span>${minutes(t)} мин</span>${t.start_time?`<span>• ${esc(t.start_time.slice(0,5))}</span>`:""}${t.fixed_time?"<span>• фикс.</span>":""}</div>
      <div class="task-meta">${priorityLabel(t.priority)}</div>
      <div class="task-actions"><button onclick="window.weekEdit('${t.id}')">Изменить</button><button onclick="window.weekDelete('${t.id}')">Удалить</button>${t.visibility==="shared"?"<span class='small muted'>Общая</span>":""}</div>
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
      if(id) await sb.from("tasks").update(base).eq("id",id).eq("owner_id",state.user.id);
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
    $("taskModal").classList.add("hidden");renderAll();toast(id?"Задача обновлена":dest==="proposal"?"Предложение отправлено":"Задача создана");
  }

  window.weekToggle=async(id,checked)=>{
    if(state.demo){const t=demoData.tasks.find(x=>x.id===id);if(t)t.status=checked?"done":"open";saveDemo();loadDemo()}
    else await sb.from("tasks").update({status:checked?"done":"open"}).eq("id",id);
    await reloadCloud();renderWeek();scheduleNotifications();
  };
  window.weekEdit=id=>{const t=state.tasks.find(x=>x.id===id);if(t)openTask(t)};
  window.weekDelete=async id=>{
    if(!confirm("Удалить задачу?"))return;
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
      const {error}=await sb.from("tasks").insert({owner_id:r.from_user_id,visibility:"shared",status:"open",title:r.title,description:r.description,date:r.date,start_time:r.start_time,duration:r.duration,category:r.category,priority:r.priority});
      if(error){toast(error.message);return}
      await sb.from("task_requests").update({status:"accepted"}).eq("id",id).eq("to_user_id",state.user.id);
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
    $("taskModal").classList.remove("hidden");$("taskModalTitle").textContent="Предложить другое время";
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
    const end=new Date(state.weekStart);end.setDate(end.getDate()+7);
    return state.tasks.filter(t=>new Date(t.date+"T00:00:00")>=state.weekStart&&new Date(t.date+"T00:00:00")<end);
  }
  function renderStats(){
    const ts=weekTasksForStats(),total=ts.reduce((a,t)=>a+minutes(t),0),done=ts.filter(t=>t.status==="done").length;
    const avg=total/7,loaded=[...Array(7)].map((_,i)=>ts.filter(t=>t.date===iso(new Date(state.weekStart.getTime()+i*86400000))).reduce((a,t)=>a+minutes(t),0));
    const max=loaded.indexOf(Math.max(...loaded));
    $("statsCards").innerHTML=[["Запланировано",`${Math.floor(total/60)}ч ${total%60}м`],["Задач",ts.length],["Выполнено",`${done}/${ts.length||0}`],["Среднее в день",`${Math.floor(avg/60)}ч ${Math.round(avg%60)}м`]].map(x=>`<div class="stat"><span class="muted">${x[0]}</span><strong>${x[1]}</strong></div>`).join("");
    const maxVal=Math.max(...loaded,1);
    $("statsBars").innerHTML=loaded.map((v,i)=>`<div class="bar-wrap"><div class="small">${Math.round(v/60*10)/10}ч</div><div class="bar" style="height:${Math.max(3,v/maxVal*170)}px"></div><div class="bar-label">${dayName(i)}</div></div>`).join("");
    const cats={};ts.forEach(t=>cats[t.category]=(cats[t.category]||0)+minutes(t));
    $("categoryStats").innerHTML=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)"><span>${esc(c)}</span><strong>${Math.floor(v/60)}ч ${v%60}м</strong></div>`).join("")||"<p class='muted'>Нет задач.</p>";
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