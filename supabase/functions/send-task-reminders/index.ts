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

  // Send event-driven notifications (proposal created/accepted/rejected, shared task done).
  const {data:events,error:eventError}=await admin
    .from("notification_events")
    .select("id,recipient_id,type,title,body,data,created_at")
    .order("created_at",{ascending:false})
    .limit(100);
  if(!eventError){
    for(const event of events || []){
      const {data:eventSubs}=await admin
        .from("push_subscriptions")
        .select("id,endpoint,p256dh,auth")
        .eq("enabled",true)
        .eq("user_id",event.recipient_id);
      for(const sub of eventSubs || []){
        const {data:already}=await admin
          .from("push_notification_event_log")
          .select("id")
          .eq("event_id",event.id)
          .eq("endpoint",sub.endpoint)
          .maybeSingle();
        if(already) continue;
        const payload=JSON.stringify({
          title:event.title || "week.",
          body:event.body || "Новое событие",
          tag:`week-event-${event.id}`,
          url:"./"
        });
        try{
          await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},payload,{TTL:300});
          await admin.from("push_notification_event_log").insert({event_id:event.id,endpoint:sub.endpoint});
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
  }

  for(const sub of subs || []){
    const now=localParts(sub.timezone || "UTC");
    const fromMinute=Math.max(0,now.minute);
    const toMinute=Math.min(1439,now.minute + Number(sub.lead_minutes || 15));

    const {data:tasks,error:taskError}=await admin
      .from("tasks")
      .select("id,title,date,start_time,owner_id,visibility,status")
      .eq("date",now.date)
      .neq("status","done")
      .neq("status","archived")
      .not("start_time","is",null)
      .or(`owner_id.eq.${sub.user_id},visibility.eq.shared`);

    if(taskError){skipped++;continue;}

    for(const task of tasks || []){
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
