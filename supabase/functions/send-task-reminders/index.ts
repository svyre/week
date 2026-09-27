import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:week@example.com";

const admin = createClient(supabaseUrl, serviceRoleKey);
webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

function localParts(timeZone: string){
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", hourCycle:"h23"
  }).formatToParts(new Date());
  const get=(type:string)=>parts.find(p=>p.type===type)?.value || "00";
  return {
    date:`${get("year")}-${get("month")}-${get("day")}`,
    minute:Number(get("hour"))*60+Number(get("minute"))
  };
}

function taskMinute(startTime:string){
  const [h,m]=startTime.slice(0,5).split(":").map(Number);
  return h*60+m;
}

Deno.serve(async (req) => {
  const expected=Deno.env.get("CRON_SECRET");
  if(expected && req.headers.get("x-cron-secret")!==expected){
    return Response.json({error:"Unauthorized"},{status:401});
  }

  const {data:subs,error:subError}=await admin
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth,lead_minutes,timezone")
    .eq("enabled",true);

  if(subError) return Response.json({error:subError.message},{status:500});

  let sent=0, skipped=0, removed=0;

  // Event delivery: use loaded subscriptions and one batch lookup for delivery logs.
  // Fetching subscriptions/logs separately for every old event caused repeated API calls.
  const sinceEvents=new Date(Date.now()-48*60*60*1000).toISOString();
  const {data:events,error:eventError}=await admin.from("notification_events")
    .select("id,recipient_id,title,body,created_at")
    .gte("created_at",sinceEvents).order("created_at",{ascending:false}).limit(250);
  if(!eventError && events?.length){
    const byUser=new Map<string,typeof subs>();
    for(const sub of subs||[]){
      if(!byUser.has(sub.user_id))byUser.set(sub.user_id,[]);
      byUser.get(sub.user_id)!.push(sub);
    }
    const {data:sentEvents,error:logError}=await admin.from("push_notification_event_log")
      .select("event_id,endpoint").in("event_id",events.map(e=>e.id));
    if(logError){skipped+=events.length}
    else{
      const delivered=new Set((sentEvents||[]).map(x=>`${x.event_id}::${x.endpoint}`));
      for(const event of events){
        for(const sub of byUser.get(event.recipient_id)||[]){
          const key=`${event.id}::${sub.endpoint}`;
          if(delivered.has(key))continue;
          const payload=JSON.stringify({
            title:event.title||"week.",body:event.body||"Новое событие",
            tag:`week-event-${event.id}`,url:"./"
          });
          try{
            await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},payload,{TTL:300});
            await admin.from("push_notification_event_log").insert({event_id:event.id,endpoint:sub.endpoint});
            delivered.add(key);sent++;
          }catch(error){
            const status=(error as {statusCode?:number})?.statusCode;
            if(status===404||status===410){
              await admin.from("push_subscriptions").delete().eq("id",sub.id);removed++;
            }else skipped++;
          }
        }
      }
    }
  }

  // One task + membership query per local date, not one full task query per device.
  // Private tasks must never be sent to other users (even if someone has a subscription).
  const dailyTasks=new Map<string,Promise<{tasks: any[],members: Map<string,Set<string>>}>>();
  function forDate(date:string){
    const existing=dailyTasks.get(date);
    if(existing)return existing;
    const result=(async()=>{
      const {data:tasks,error}=await admin.from("tasks")
        .select("id,title,date,start_time,owner_id,visibility,status")
        .eq("date",date)
        .neq("status","done")
        .neq("status","archived")
        .not("start_time","is",null);
      if(error)throw error;
      const shared=(tasks||[]).filter(t=>t.visibility==="shared").map(t=>t.id);
      const members=new Map<string,Set<string>>();
      if(shared.length){
        const {data:rows,error:memberError}=await admin.from("task_members")
          .select("task_id,user_id").in("task_id",shared);
        if(memberError)throw memberError;
        for(const row of rows||[]){
          if(!members.has(row.task_id))members.set(row.task_id,new Set());
          members.get(row.task_id)!.add(row.user_id);
        }
      }
      return {tasks:tasks||[],members};
    })();
    dailyTasks.set(date,result);
    return result;
  }

  for(const sub of subs || []){
    let now:{date:string,minute:number};
    try{now=localParts(sub.timezone || "UTC");}
    catch{skipped++;continue;}
    const fromMinute=Math.max(0,now.minute);
    const toMinute=Math.min(1439,now.minute + Number(sub.lead_minutes || 15));
    let dayTasks:{tasks:any[],members:Map<string,Set<string>>};
    try{dayTasks=await forDate(now.date)}catch{skipped++;continue;}
    for(const task of dayTasks.tasks){
      if(task.owner_id!==sub.user_id &&
        !(task.visibility==="shared"&&dayTasks.members.get(task.id)?.has(sub.user_id)))continue;
      const minute=taskMinute(task.start_time);
      if(minute < fromMinute || minute > toMinute) continue;

      const {data:already}=await admin
        .from("push_notification_log")
        .select("id")
        .eq("user_id",sub.user_id)
        .eq("task_id",task.id)
        .eq("endpoint",sub.endpoint)
        .eq("kind","task_reminder")
        .maybeSingle();
      if(already) continue;

      const minutesLeft=Math.max(0,minute-now.minute);
      const payload=JSON.stringify({
        title:"week.",
        body:minutesLeft===0 ? `Сейчас: ${task.title}` : `Через ${minutesLeft} мин: ${task.title}`,
        tag:`week-${task.id}`,
        url:"./"
      });

      try{
        await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},payload,{TTL:300});
        await admin.from("push_notification_log").insert({user_id:sub.user_id,task_id:task.id,endpoint:sub.endpoint,kind:"task_reminder"});
        sent++;
      }catch(error){
        const status=(error as {statusCode?:number})?.statusCode;
        if(status===404 || status===410){
          await admin.from("push_subscriptions").delete().eq("id",sub.id);
          removed++;
        }else skipped++;
      }
    }
  }

  return Response.json({ok:true,sent,skipped,removed});
});
