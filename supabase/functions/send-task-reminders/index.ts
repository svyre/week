import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

function readSecretKey(){
  const modern=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(modern){
    try{
      const parsed=JSON.parse(modern);
      if(typeof parsed?.default==="string"&&parsed.default)return parsed.default;
    }catch(_){/* fall back below */}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
}

const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
const secretKey=readSecretKey();
const vapidPublicKey=Deno.env.get("VAPID_PUBLIC_KEY")||"";
const vapidPrivateKey=Deno.env.get("VAPID_PRIVATE_KEY")||"";
const vapidSubject=Deno.env.get("VAPID_SUBJECT")||"mailto:week@example.com";

if(!supabaseUrl||!secretKey||!vapidPublicKey||!vapidPrivateKey){
  throw new Error("Missing required server secrets");
}

const admin=createClient(supabaseUrl,secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
webpush.setVapidDetails(vapidSubject,vapidPublicKey,vapidPrivateKey);

function localParts(timeZone:string){
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date());
  const get=(type:string)=>parts.find(p=>p.type===type)?.value||"00";
  return {date:`${get("year")}-${get("month")}-${get("day")}`,minute:Number(get("hour"))*60+Number(get("minute"))};
}

function taskMinute(startTime:string){
  const [h,m]=String(startTime||"").slice(0,5).split(":").map(Number);
  if(!Number.isInteger(h)||!Number.isInteger(m)||h<0||h>23||m<0||m>59)return -1;
  return h*60+m;
}

async function constantTimeEqual(a:string,b:string){
  const enc=new TextEncoder();
  const [ha,hb]=await Promise.all([
    crypto.subtle.digest("SHA-256",enc.encode(a)),
    crypto.subtle.digest("SHA-256",enc.encode(b))
  ]);
  const aa=new Uint8Array(ha),bb=new Uint8Array(hb);
  let diff=aa.length^bb.length;
  for(let i=0;i<Math.max(aa.length,bb.length);i++)diff|=(aa[i%aa.length]||0)^(bb[i%bb.length]||0);
  return diff===0;
}

function allowedPushEndpoint(endpoint:string){
  try{
    const url=new URL(endpoint);
    if(url.protocol!=="https:")return false;
    const host=url.hostname.toLowerCase();
    return host==="fcm.googleapis.com" ||
      host==="web.push.apple.com" ||
      host==="updates.push.services.mozilla.com" ||
      host.endsWith(".push.services.mozilla.com") ||
      host==="notify.windows.com" ||
      host.endsWith(".notify.windows.com");
  }catch(_){return false;}
}

function json(body:unknown,status=200){
  return Response.json(body,{status,headers:{"cache-control":"no-store","content-type":"application/json; charset=utf-8"}});
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);

  // Never run privileged work without an explicit cron secret.
  const expected=Deno.env.get("CRON_SECRET")||"";
  if(expected.length<32)return json({error:"Server cron secret is not configured"},503);
  const supplied=req.headers.get("x-cron-secret")||"";
  if(!supplied||!(await constantTimeEqual(supplied,expected)))return json({error:"Unauthorized"},401);

  const {data:subs,error:subError}=await admin
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth,lead_minutes,timezone")
    .eq("enabled",true)
    .limit(500);

  if(subError)return json({error:"Subscription query failed"},500);

  let sent=0,skipped=0,removed=0;
  const safeSubs=[];
  for(const sub of subs||[]){
    if(!allowedPushEndpoint(sub.endpoint)){
      await admin.from("push_subscriptions").delete().eq("id",sub.id);
      removed++;
      continue;
    }
    safeSubs.push(sub);
  }

  const sinceEvents=new Date(Date.now()-48*60*60*1000).toISOString();
  const {data:events,error:eventError}=await admin.from("notification_events")
    .select("id,recipient_id,title,body,created_at")
    .gte("created_at",sinceEvents).order("created_at",{ascending:false}).limit(250);

  if(!eventError&&events?.length){
    const byUser=new Map<string,typeof safeSubs>();
    for(const sub of safeSubs){
      if(!byUser.has(sub.user_id))byUser.set(sub.user_id,[]);
      byUser.get(sub.user_id)!.push(sub);
    }
    const {data:sentEvents,error:logError}=await admin.from("push_notification_event_log")
      .select("event_id,endpoint").in("event_id",events.map(e=>e.id));
    if(logError){skipped+=events.length;}
    else{
      const delivered=new Set((sentEvents||[]).map(x=>`${x.event_id}::${x.endpoint}`));
      for(const event of events){
        for(const sub of byUser.get(event.recipient_id)||[]){
          const key=`${event.id}::${sub.endpoint}`;
          if(delivered.has(key))continue;
          const payload=JSON.stringify({
            title:String(event.title||"week.").slice(0,120),
            body:String(event.body||"Новое событие").slice(0,500),
            tag:`week-event-${event.id}`,url:"./"
          });
          try{
            await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},payload,{TTL:300});
            await admin.from("push_notification_event_log").insert({event_id:event.id,endpoint:sub.endpoint});
            delivered.add(key);sent++;
          }catch(error){
            const status=(error as {statusCode?:number})?.statusCode;
            if(status===404||status===410){await admin.from("push_subscriptions").delete().eq("id",sub.id);removed++;}
            else skipped++;
          }
        }
      }
    }
  }

  const dailyTasks=new Map<string,Promise<{tasks:any[],members:Map<string,Set<string>>}>>();
  function forDate(date:string){
    const existing=dailyTasks.get(date);if(existing)return existing;
    const result=(async()=>{
      const {data:tasks,error}=await admin.from("tasks")
        .select("id,title,date,start_time,owner_id,visibility,status")
        .eq("date",date).neq("status","done").neq("status","archived").not("start_time","is",null)
        .limit(5000);
      if(error)throw error;
      const shared=(tasks||[]).filter(t=>t.visibility==="shared").map(t=>t.id);
      const members=new Map<string,Set<string>>();
      if(shared.length){
        const {data:rows,error:memberError}=await admin.from("task_members").select("task_id,user_id").in("task_id",shared);
        if(memberError)throw memberError;
        for(const row of rows||[]){
          if(!members.has(row.task_id))members.set(row.task_id,new Set());
          members.get(row.task_id)!.add(row.user_id);
        }
      }
      return {tasks:tasks||[],members};
    })();
    dailyTasks.set(date,result);return result;
  }

  for(const sub of safeSubs){
    let now:{date:string,minute:number};
    try{now=localParts(sub.timezone||"UTC");}catch(_){skipped++;continue;}
    const fromMinute=Math.max(0,now.minute);
    const toMinute=Math.min(1439,now.minute+Number(sub.lead_minutes||15));
    let dayTasks:{tasks:any[],members:Map<string,Set<string>>};
    try{dayTasks=await forDate(now.date);}catch(_){skipped++;continue;}

    for(const task of dayTasks.tasks){
      if(task.owner_id!==sub.user_id && !(task.visibility==="shared"&&dayTasks.members.get(task.id)?.has(sub.user_id)))continue;
      const minute=taskMinute(task.start_time);
      if(minute<0||minute<fromMinute||minute>toMinute)continue;

      const {data:already}=await admin.from("push_notification_log").select("id")
        .eq("user_id",sub.user_id).eq("task_id",task.id).eq("endpoint",sub.endpoint)
        .eq("kind","task_reminder").maybeSingle();
      if(already)continue;

      const minutesLeft=Math.max(0,minute-now.minute);
      const title=String(task.title||"Задача").slice(0,240);
      const payload=JSON.stringify({
        title:"week.",
        body:minutesLeft===0?`Сейчас: ${title}`:`Через ${minutesLeft} мин: ${title}`,
        tag:`week-${task.id}`,url:"./"
      });

      try{
        await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},payload,{TTL:300});
        await admin.from("push_notification_log").insert({user_id:sub.user_id,task_id:task.id,endpoint:sub.endpoint,kind:"task_reminder"});
        sent++;
      }catch(error){
        const status=(error as {statusCode?:number})?.statusCode;
        if(status===404||status===410){await admin.from("push_subscriptions").delete().eq("id",sub.id);removed++;}
        else skipped++;
      }
    }
  }

  return json({ok:true,sent,skipped,removed});
});
