import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cronSecret = Deno.env.get("CRON_SECRET")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
const vapidSubject = Deno.env.get("VAPID_SUBJECT")!;

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
const supabase = createClient(supabaseUrl, serviceRoleKey);

function localToUtc(dateText: string, timeText: string, timeZone: string): Date {
  const [y, m, d] = dateText.split("-").map(Number);
  const [hh, mm] = timeText.slice(0, 5).split(":").map(Number);
  const wanted = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guess = wanted;

  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value || 0);
    const actual = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), 0);
    guess += wanted - actual;
  }
  return new Date(guess);
}

function localDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const { data: subscriptions, error: subError } = await supabase
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth,lead_minutes,timezone,enabled")
    .eq("enabled", true);

  if (subError) return Response.json({ error: subError.message }, { status: 500 });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const sub of subscriptions ?? []) {
    const tz = sub.timezone || "UTC";
    const today = localDate(now, tz);
    const tomorrow = localDate(new Date(now.getTime() + 86400000), tz);

    const { data: tasks, error: taskError } = await supabase
      .from("tasks")
      .select("id,owner_id,title,date,start_time,status,visibility")
      .or(`owner_id.eq.${sub.user_id},visibility.eq.shared`)
      .in("date", [today, tomorrow])
      .neq("status", "done")
      .neq("status", "archived");

    if (taskError) {
      failed++;
      continue;
    }

    for (const task of tasks ?? []) {
      if (!task.start_time) continue;
      const taskAt = localToUtc(task.date, task.start_time, tz);
      const reminderAt = new Date(taskAt.getTime() - Number(sub.lead_minutes || 15) * 60000);
      const diff = reminderAt.getTime() - now.getTime();

      // Cron can start a little early/late. A 90-second window plus a unique log
      // guarantees that one reminder is sent once, not repeatedly.
      if (diff < -90000 || diff > 90000) {
        skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from("push_notification_log")
        .select("id")
        .eq("user_id", sub.user_id)
        .eq("task_id", task.id)
        .eq("endpoint", sub.endpoint)
        .eq("kind", "task_reminder")
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      const payload = JSON.stringify({
        title: "week.",
        body: `Через ${sub.lead_minutes || 15} мин: ${task.title}`,
        tag: `week-${task.id}`,
        url: "./",
      });

      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        }, payload);

        await supabase.from("push_notification_log").insert({
          user_id: sub.user_id,
          task_id: task.id,
          endpoint: sub.endpoint,
          kind: "task_reminder",
          sent_for: taskAt.toISOString(),
        });
        sent++;
      } catch (error) {
        failed++;
        const status = Number((error as { statusCode?: number })?.statusCode || 0);
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }
  }

  return Response.json({ ok: true, sent, skipped, failed, checked_at: now.toISOString() });
});
