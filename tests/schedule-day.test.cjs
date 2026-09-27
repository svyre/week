// Regression tests for weekday inheritance in class and personal schedule editors.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  if (start === -1) throw new Error(`Missing ${name}`);
  const end = source.indexOf('\n  function ', start + 3);
  return source.slice(start, end === -1 ? undefined : end);
}
function makeList() {
  const list = { dataset: {}, rows: [], appendChild(row) { row.parent = this; this.rows.push(row); },
    querySelector(selector) {
      if (selector === '.schedule-row') return this.rows[0] || null;
      if (selector === '.schedule-row:last-child [data-field="day"]') return this.rows.at(-1)?.day ?? null;
      throw new Error('Unexpected list selector: ' + selector);
    },
    querySelectorAll(selector) { assert.equal(selector,'.schedule-row'); return this.rows; },
    set innerHTML(v) { assert.equal(v,''); this.rows = []; },
    get innerHTML() { return ''; }
  };
  return list;
}
function makeRow() {
  const row = {
    day: {value:'1', onchange:null}, button: {onclick:null},
    set innerHTML(markup) {
      const found = /<option value="([0-6])" selected>/.exec(markup);
      assert.ok(found, 'Row must have a selected weekday');
      this.day.value = found[1];
    },
    querySelector(selector) {
      if (selector === '[data-field="day"]') return this.day;
      if (selector === '.schedule-remove') return this.button;
      throw new Error('Unexpected row selector: ' + selector);
    },
    remove() {this.parent.rows.splice(this.parent.rows.indexOf(this),1);}
  };
  return row;
}
const lists = {
  classScheduleRows: makeList(),
  schoolScheduleList: makeList(),
  extraScheduleList: makeList(),
  classScheduleEditor: {classList: {remove(){}}},
  schoolScheduleEmpty: {classList: {toggle(){}}},
  extraScheduleEmpty: {classList: {toggle(){}}},
};
const context = {
  document: { createElement(tag) {assert.equal(tag,'div');return makeRow();} },
  $: id=>{assert.ok(lists[id], 'Unexpected id: '+id);return lists[id];},
  DAY_OPTIONS: [['1','Понедельник'],['2','Вторник'],['3','Среда'],['4','Четверг'],['5','Пятница'],['6','Суббота'],['0','Воскресенье']],
  esc: x=>String(x),
  state: {isWeekAdmin:true,classViewGroup:{id: 'a'},classViewSchedule:[]}
};
vm.createContext(context);
vm.runInContext(['addClassLessonRow','openClassScheduleEditor','addScheduleEditorRow','updateScheduleEmpty'].map(extract).join('\n'), context);
const { addClassLessonRow, openClassScheduleEditor, addScheduleEditorRow } = context;
const select = (row, day)=>{row.day.value=day;row.day.onchange({target:row.day});};

openClassScheduleEditor();
addClassLessonRow();
assert.equal(lists.classScheduleRows.rows.at(-1).day.value,'1', 'first lesson defaults to Monday');
select(lists.classScheduleRows.rows.at(-1),'2');
addClassLessonRow();
assert.equal(lists.classScheduleRows.rows.at(-1).day.value,'2', 'Tuesday persists for next lesson');
select(lists.classScheduleRows.rows.at(-1),'3');
addClassLessonRow();
assert.equal(lists.classScheduleRows.rows.at(-1).day.value,'3', 'Wednesday persists for next lesson');
select(lists.classScheduleRows.rows[0],'4');
addClassLessonRow();
assert.equal(lists.classScheduleRows.rows.at(-1).day.value,'4', 'last actively selected day wins');
context.state.classViewSchedule=[{day_of_week:5,title:'Lesson',start_time:'08:00',end_time:'08:40'}];
openClassScheduleEditor();
assert.equal(lists.classScheduleRows.rows[0].day.value,'5', 'saved lesson weekday stays unchanged');
addClassLessonRow();
assert.equal(lists.classScheduleRows.rows.at(-1).day.value,'5', 'a reopened class begins with its current last day');

addScheduleEditorRow('school');
select(lists.schoolScheduleList.rows.at(-1),'2');
addScheduleEditorRow('school');
assert.equal(lists.schoolScheduleList.rows.at(-1).day.value,'2','personal school lesson inherits Tuesday');
addScheduleEditorRow('extra');
assert.equal(lists.extraScheduleList.rows.at(-1).day.value,'1','extra lessons do not inherit school weekday');
select(lists.extraScheduleList.rows.at(-1),'6');
addScheduleEditorRow('extra');
assert.equal(lists.extraScheduleList.rows.at(-1).day.value,'6','extra lesson inherits Saturday');
console.log('PASS: class lessons inherit selected day; saved lessons are preserved; personal editors stay independent.');
