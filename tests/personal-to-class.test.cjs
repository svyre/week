// Regression tests: only week. admin may copy personal SCHOOL lessons into the selected class.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const src=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const begin=src.indexOf('  function schoolLessonsForClassImport(');
const end=src.indexOf('  function renderClasses(){',begin);
assert.ok(begin>=0&&end>begin,'Import implementation exists');
const snippet=src.slice(begin,end);
const base=[
  {id:'a',user_id:'admin',kind:'school',day_of_week:2,title:'Алгебра',start_time:'08:00:00',end_time:'08:40:00'},
  {id:'b',user_id:'admin',kind:'extra',day_of_week:2,title:'Личный репетитор',start_time:'19:00:00',end_time:'20:00:00'},
  {id:'c',user_id:'admin',kind:'school',day_of_week:3,title:'Физика',start_time:'10:00:00',end_time:'10:40:00'}
];
async function run(opts={}){
  const {admin=true,confirmValue=true,personal=base,cloud=base,error=null,group={id:'class-A',name:'10А'},demo=false,viewSchedule=[{title:'Старый урок'}]}=opts;
  const events={queries:[],rpc:[],toasts:[],confirms:[],render:0,reload:0,saved:0};
  const btn={disabled:false,classList:{toggle(){}}};
  const state={isWeekAdmin:admin,classViewGroup:group,classViewSchedule:viewSchedule,personalSchedule:personal,user:{id:'admin'},demo};
  const data={classSchedules:[{class_id:'class-A',title:'Старый урок'}, {class_id:'class-B',title:'Другой класс'}]};
  const elements={classImportMySchedule:btn,classScheduleEditor:{classList:{add(k){assert.equal(k,'hidden')}}}};
  const context={
    state,demoData:data,
    $:id=>{assert.ok(elements[id],`element ${id}`);return elements[id]},
    sb:{from(table){assert.equal(table,'schedule_items');return {select(fields){events.queries.push(['select',fields]);return this},eq(k,v){events.queries.push(['eq',k,v]);return this},order(k){events.queries.push(['order',k]);return this},then(ok,fail){return Promise.resolve({data:cloud,error}).then(ok,fail)}}},async rpc(name,args){events.rpc.push([name,args]);return {error:opts.rpcError||null}}},
    confirm:msg=>{events.confirms.push(msg);return confirmValue},
    toast:msg=>events.toasts.push(msg),
    saveDemo:()=>{events.saved++},loadDemo:()=>{},
    uid:()=>`new-${events.saved}`,
    reloadCloud:async()=>{events.reload++},renderAll:()=>{events.render++},
    console:{error:()=>{}}
  };
  vm.createContext(context);
  vm.runInContext(snippet,context);
  await context.importMySchoolScheduleToClass();
  return {events,btn,state,data,copy:context.schoolLessonsForClassImport};
}
(async()=>{
  let r=await run({admin:false});
  assert.equal(r.events.queries.length,0);assert.equal(r.events.rpc.length,0);assert.match(r.events.toasts[0],/Нет прав/);

  r=await run({confirmValue:false});
  assert.equal(r.events.rpc.length,0);assert.equal(r.events.confirms.length,1);
  assert.match(r.events.confirms[0],/ПОЛНОСТЬЮ ЗАМЕНЕНО/);
  assert.equal(r.btn.disabled,false);

  r=await run();
  assert.equal(r.events.rpc.length,1);assert.equal(r.events.rpc[0][0],'week_replace_class_schedule');
  assert.equal(r.events.rpc[0][1].p_class_id,'class-A');
  const lessons=r.events.rpc[0][1].p_items;
  assert.equal(lessons.length,2);assert.deepEqual(Array.from(lessons,x=>x.title),['Алгебра','Физика']);
  assert.deepEqual(Array.from(lessons,x=>x.day_of_week),[2,3]);
  assert.deepEqual(Array.from(lessons,x=>x.start_time),['08:00','10:00']);
  assert.equal(r.events.reload,1);assert.equal(r.events.render,1);
  assert.deepEqual(base[1].title,'Личный репетитор');
  assert.equal(r.events.queries.some(q=>q[0]==='eq'&&q[1]==='user_id'&&q[2]==='admin'),true);

  r=await run({cloud:[base[1]]});
  assert.equal(r.events.rpc.length,0);assert.match(r.events.toasts[0],/нет школьных уроков/);

  r=await run({error:{message:'network failure'}});
  assert.equal(r.events.rpc.length,0);assert.match(r.events.toasts[0],/network failure/);

  r=await run({rpcError:{message:'Нет прав администратора'}});
  assert.equal(r.events.rpc.length,1);assert.equal(r.events.render,0);assert.match(r.events.toasts[0],/Нет прав администратора/);

  r=await run({demo:true});
  assert.equal(r.events.queries.length,0);assert.equal(r.events.rpc.length,0);
  assert.equal(r.data.classSchedules.filter(x=>x.class_id==='class-A').length,2);
  assert.equal(r.data.classSchedules.filter(x=>x.class_id==='class-B').length,1);
  assert.equal(r.events.saved,1);

  console.log('PASS: admin-only entry, own school lessons only, selected class, confirmation/cancel, non-destructive source, empty/error safeguards and demo.');
})().catch(err=>{console.error(err);process.exitCode=1});
