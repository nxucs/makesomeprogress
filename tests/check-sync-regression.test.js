const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../bill-scheduler');
const dates = (anchor, interval, day) => s.getOccurrencesInRange(anchor, interval, '2026-10-13', '2026-10-26', day).map(s.formatDateYMD);
const fixture = [
  {sourceId:14,name:'M2',amount:996,anchor:'2026-10-19',day:19},
  {sourceId:2,name:'Mortgage Holding 1',amount:2050,anchor:'2026-09-30',day:31},
  {sourceId:1,name:'Mortgage Holding 2',amount:2050,anchor:'2026-10-16',day:16}
];
test('Check 24 screenshot is weekly configuration, stable across repeated sync and serialization', () => {
  let log = {items:[]};
  const sync = () => fixture.forEach(b => s.reconcileScheduledItems(log,{...b,dates:dates(b.anchor,'weekly',b.day)}));
  sync();
  assert.deepEqual(log.items.map(i=>[i.bill,i.dueDate]),[
    ['M2','2026-10-19'],['M2','2026-10-26'],
    ['Mortgage Holding 1','2026-10-14'],['Mortgage Holding 1','2026-10-21'],
    ['Mortgage Holding 2','2026-10-16'],['Mortgage Holding 2','2026-10-23']]);
  const before = JSON.stringify(log);
  for(let i=0;i<4;i++){sync();log=JSON.parse(JSON.stringify(log));}
  assert.equal(JSON.stringify(log),before);
  const monthly={items:[]};
  fixture.forEach(b=>s.reconcileScheduledItems(monthly,{...b,dates:dates(b.anchor,'monthly',b.day)}));
  assert.deepEqual(monthly.items.map(i=>[i.bill,i.dueDate]),[['M2','2026-10-19'],['Mortgage Holding 2','2026-10-16']]);
});
test('edited occurrence date, name, cost and category survive sync without recreating original date',()=>{
  let log={items:[]};
  const schedule={sourceId:1,name:'Mortgage',amount:2050,category:'Housing',dates:['2026-10-16']};
  s.reconcileScheduledItems(log,schedule);
  Object.assign(log.items[0],{bill:'Adjusted holding',cost:2000,dueDate:'2026-10-17',category:'Other'});
  log=JSON.parse(JSON.stringify(log));
  const before=JSON.stringify(log);
  assert.equal(s.reconcileScheduledItems(log,schedule),false);
  assert.equal(JSON.stringify(log),before);
  s.reconcileScheduledItems(log,{...schedule,dates:[]});
  assert.equal(JSON.stringify(log),before);
});
test('manual same-name rows and bank-linked rows are retained; unrelated legacy surplus is preserved',()=>{
  const manual={id:1,bill:'Gym',cost:12,dueDate:'2026-10-16',manualEntry:true};
  const log={items:[structuredClone(manual),{id:2,bill:'Gym',cost:20,dueDate:'2026-10-16',paid:true,bankTransactionId:'tx'}]};
  const schedule={sourceId:1,name:'Gym',amount:25,dates:['2026-10-16']};
  s.reconcileScheduledItems(log,schedule);
  assert.equal(log.items.length,2);assert.deepEqual(log.items[0],manual);assert.equal(log.items[1].cost,20);
  const legacy={items:[{id:1,bill:'Gym',cost:25,dueDate:'2026-10-16'},{id:2,bill:'Gym',cost:5,dueDate:'2026-10-18'}]};
  s.reconcileScheduledItems(legacy,schedule);assert.equal(legacy.items.length,2);
});
test('ambiguous legacy names never consume or append expenses; distinct tagged sources coexist',()=>{
  const log={items:[{id:1,bill:'Payment',cost:15,dueDate:'2026-10-16'}]};
  const before=JSON.stringify(log);
  assert.equal(s.reconcileScheduledItems(log,{sourceId:1,name:'Payment',amount:15,dates:['2026-10-16'],allowLegacyMatch:false}),false);
  assert.equal(JSON.stringify(log),before);
  const fresh={items:[]};
  [1,2].forEach(sourceId=>s.reconcileScheduledItems(fresh,{sourceId,name:'Payment',amount:15,dates:['2026-10-16']}));
  assert.deepEqual(fresh.items.map(i=>i.scheduleSourceId),[1,2]);
});
test('ordinary sync preserves pre-fix rows whose original values are unknown',()=>{
  const log={items:[{id:1,bill:'Mortgage',cost:1900,category:'Other',dueDate:'2026-10-16',scheduleSourceType:'recurring',scheduleSourceId:1}]};
  const before=JSON.stringify(log);
  s.reconcileScheduledItems(log,{sourceId:1,name:'Mortgage',amount:2050,category:'Housing',dates:['2026-10-16'],preserveLegacyValues:true});
  assert.equal(JSON.stringify(log),before);
});
test('undated legacy occurrences require review rather than appending potential duplicates',()=>{
  const log={items:[{id:1,bill:'Mortgage',cost:1900,paid:true}]};
  const before=JSON.stringify(log);
  assert.equal(s.reconcileScheduledItems(log,{sourceId:1,name:'Mortgage',amount:2050,dates:['2026-10-16'],preserveLegacyValues:true}),false);
  assert.equal(JSON.stringify(log),before);
});
