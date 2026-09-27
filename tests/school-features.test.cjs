const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const sql=fs.readFileSync(path.join(__dirname,'../MIGRATION_2_3_SCHOOL.sql'),'utf8');
const h=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const from=src.indexOf('  function scheduleOnDate('), to=src.indexOf('  function setDemoClassView(',from);
assert.ok(from>0&&to>from);
const state={classGroup:{id:'class-a'},schedule:[
  {id:'math',class_id:'class-a',kind:'school',day_of_week:1,title:'Алгебра',start_time:'08:00',end_time:'08:45'},
  {id:'extra',kind:'extra',day_of_week:1,title:'Репетитор',start_time:'17:00',end_time:'18:00'},
  {id:'eng',class_id:'class-a',kind:'school',day_of_week:2,title:'Английский',start_time:'09:00',end_time:'09:45'}
],classExceptions:[]};
const ctx={state,iso:d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
vm.createContext(ctx);vm.runInContext(src.slice(from,to),ctx);
const monday='2026-09-28';const nextMonday='2026-10-05';
assert.equal(ctx.scheduleOnDate(monday).length,2);
state.classExceptions.push({class_id:'class-a',lesson_id:'math',lesson_date:monday,cancelled:false,title:'Геометрия',start_time:'10:00',end_time:'10:45'});
assert.equal(ctx.scheduleOnDate(monday).find(x=>x.id==='math').title,'Геометрия');
assert.equal(ctx.scheduleOnDate(monday).find(x=>x.id==='math')._oneOff,true);
assert.equal(ctx.scheduleOnDate(monday).find(x=>x.id==='extra').title,'Репетитор');
assert.equal(ctx.scheduleOnDate(nextMonday).find(x=>x.id==='math').title,'Алгебра');
state.classExceptions[0].cancelled=true;
assert.equal(ctx.scheduleOnDate(monday).some(x=>x.id==='math'),false);
assert.equal(ctx.scheduleOnDate(nextMonday).some(x=>x.id==='math'),true);
state.classGroup=null;
assert.equal(ctx.scheduleOnDate(monday).some(x=>x.id==='math'),true);
const weekStart=src.match(/function startOfWeek\(d\)\{[^}]+\}/)[0];const store=new Map();
const wc={localStorage:{getItem:key=>store.get(key)||null}};
vm.createContext(wc);vm.runInContext(weekStart,wc);
assert.equal(wc.startOfWeek(new Date('2026-09-30T12:00:00')).getDay(),1);
store.set('week-week-start','sunday');
assert.equal(wc.startOfWeek(new Date('2026-09-30T12:00:00')).getDay(),0);
const msgs=src.match(/const loadingMessages=\[([\s\S]*?)\];/)[1];
const sentences=[...msgs.matchAll(/"([^"\\]*)"/g)].map(x=>x[1]);
assert.equal(sentences.length,90);assert.equal(new Set(sentences).size,90);
assert.ok(h.includes('classScheduleDetails')&&h.includes('Изменить единожды')&&h.includes('Изменить навсегда'));
assert.ok(h.includes('class-role-select')===false); // This select is rendered dynamically.
assert.ok(sql.includes('week_set_class_member_role')&&sql.includes('week_change_class_lesson')&&sql.includes('class_invite_secrets'));
assert.ok(sql.includes('revoke all on function public.week_rotate_class_code(uuid)'));
assert.ok(sql.includes('if not public.week_is_admin()'));
console.log('PASS: dated overrides, cancellation, independent weeks, personal schedule, Sunday/Monday start, 90 daily thoughts, UI and admin SQL safeguards.');
