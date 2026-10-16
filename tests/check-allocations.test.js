const test=require('node:test'),assert=require('node:assert/strict');
const a=require('../check-allocations'),s=require('../bill-scheduler'),scenarios=require('../budget-scenarios');
function fixture(legacy=false){
  const bills=[{id:14,name:'M2',amount:996,category:'Transportation',firstDueDate:'2026-10-19',dueDay:19,recurrenceInterval:'weekly'},
    {id:2,name:'Mortgage Holding 1',amount:2050,category:'Housing',firstDueDate:'2026-09-30',dueDay:31,recurrenceInterval:'weekly'},
    {id:1,name:'Mortgage Holding 2',amount:2050,category:'Housing',firstDueDate:'2026-10-16',dueDay:16,recurrenceInterval:'weekly'},
    {id:40,name:'Weekly groceries',amount:50,category:'Food',firstDueDate:'2026-10-13',recurrenceInterval:'weekly'}];
  const log={id:24,startDate:'2026-10-13',endDate:'2026-10-26',items:[]};
  bills.forEach(b=>s.reconcileScheduledItems(log,{sourceType:'recurring',sourceId:b.id,name:b.name,amount:b.amount,category:b.category,dates:s.getOccurrencesInRange(b.firstDueDate,b.recurrenceInterval,log.startDate,log.endDate,b.dueDay)}));
  if(legacy) log.items.forEach(item=>{delete item.scheduleValues;delete item.scheduleDueDate;});
  return {bills,checkLogs:[{id:23,startDate:'2026-09-29',endDate:'2026-10-12',items:[{id:1,bill:'Paid history',cost:10,paid:true}]},log],oneTimeExpenses:[]};
}
test('reviewed Check 24 repair changes three settings and four excess rows, preserving amounts and other logs',()=>{
  for(const legacy of [false,true]){
    const tracker=fixture(legacy),before=JSON.stringify(tracker),plan=a.preview(tracker);
    assert.equal(JSON.stringify(tracker),before);assert.deepEqual(plan.conflicts,[]);
    assert.equal(plan.changes.filter(c=>c.kind==='setting').length,3);
    assert.deepEqual(plan.changes.filter(c=>c.kind==='remove').map(c=>[c.bill,c.dueDate]),[['M2','2026-10-26'],['Mortgage Holding 1','2026-10-14'],['Mortgage Holding 1','2026-10-21'],['Mortgage Holding 2','2026-10-23']]);
    const history=JSON.stringify(tracker.checkLogs[0]),weekly=JSON.stringify(tracker.checkLogs[1].items.filter(i=>i.scheduleSourceId===40));
    const receipt=a.apply(tracker,plan);
    assert.equal(JSON.stringify(tracker.checkLogs[0]),history);
    assert.equal(JSON.stringify(tracker.checkLogs[1].items.filter(i=>i.scheduleSourceId===40)),weekly);
    assert.deepEqual(tracker.checkLogs[1].items.filter(i=>i.scheduleSourceId!==40).map(i=>[i.bill,i.cost,i.dueDate]),[['M2',996,'2026-10-19'],['Mortgage Holding 2',2050,'2026-10-13']]);
    assert.deepEqual(tracker.bills.map(b=>b.amount),[996,2050,2050,50]);
    assert.equal(tracker.bills[0].firstDueDate,'2026-10-19');assert.equal(tracker.bills[0].dueDay,19);
    const repaired=JSON.stringify(tracker);
    for(let i=0;i<3;i++)assert.deepEqual(a.preview(JSON.parse(repaired)).changes,[]);
    tracker.checkLogs[1].items.reverse();a.undo(tracker,receipt);
    assert.equal(JSON.stringify(tracker),before);
  }
});
test('two legacy holding templates allocate once per actual check across early access, February and year boundaries',()=>{
  const tracker=fixture();a.apply(tracker,a.preview(tracker));
  const holdings=tracker.bills.filter(b=>b.recurrenceInterval==='percheck');
  for(const date of ['2026-10-13','2026-10-15','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2027-02-26','2027-02-28','2028-02-29','2026-12-28','2027-01-13']){
    const log={startDate:date,endDate:date,items:[]};
    for(let repeat=0;repeat<3;repeat++)holdings.forEach(b=>s.reconcileScheduledItems(log,{sourceId:b.id,name:b.name,amount:b.amount,category:b.category,dates:a.dates(b,log,tracker.bills)}));
    assert.equal(log.items.length,1,date);assert.equal(log.items[0].cost,2050);assert.equal(log.items[0].dueDate,date);
    assert.equal(log.items[0].scheduleSourceId,Number(date.slice(-2))<=20?1:2);
  }
  const boundary={startDate:'2027-01-01',scheduledPayDate:'2026-12-31'};
  assert.equal(holdings.filter(b=>a.selected(b,boundary,tracker.bills))[0].id,2);
});
test('paid or edited selected holding is linked without rewriting its financial fields or adding another allocation',()=>{
  const tracker=fixture();const item=tracker.checkLogs[1].items.find(i=>i.scheduleSourceId===1);
  item.paid=true;item.cost=2000;item.userEdited=true;
  const fields=[item.bill,item.cost,item.category,item.dueDate,item.paid];
  const plan=a.preview(tracker);assert.deepEqual(plan.conflicts,[]);a.apply(tracker,plan);
  const holding=tracker.bills.find(b=>b.id===1),log=tracker.checkLogs[1];
  for(let n=0;n<3;n++)s.reconcileScheduledItems(log,{sourceId:1,name:holding.name,amount:holding.amount,category:holding.category,dates:a.dates(holding,log,tracker.bills)});
  const found=log.items.filter(i=>i.scheduleSourceId===1);assert.equal(found.length,1);
  assert.deepEqual([found[0].bill,found[0].cost,found[0].category,found[0].dueDate,found[0].paid],fields);
  assert.equal(found[0].scheduleDueDate,'2026-10-13');
});
test('paid, bank-linked, edited or uncertain excess rows block destructive repair',()=>{
  for(const extra of [{paid:true},{bankTransactionId:'tx'},{userEdited:true},{cost:1},{dueDate:'2026-10-25'}]){
    const tracker=fixture();Object.assign(tracker.checkLogs[1].items.find(i=>i.scheduleSourceId===2),extra);
    const before=JSON.stringify(tracker),plan=a.preview(tracker);
    assert.ok(plan.conflicts.length);assert.throws(()=>a.apply(tracker,plan),/review/);assert.equal(JSON.stringify(tracker),before);
  }
});
test('stale preview and stale undo are rejected; unrelated newer logs survive undo',()=>{
  const tracker=fixture(),plan=a.preview(tracker);tracker.checkLogs[0].items[0].cost=11;
  assert.throws(()=>a.apply(tracker,plan),/changed/);
  const receipt=a.apply(tracker,a.preview(tracker));tracker.checkLogs.push({id:25,items:[]});a.undo(tracker,receipt);
  assert.equal(tracker.checkLogs.at(-1).id,25);assert.equal(tracker.checkLogs[0].items[0].cost,11);
  const receipt2=a.apply(tracker,a.preview(tracker));tracker.checkLogs[1].items[0].cost++;
  assert.throws(()=>a.undo(tracker,receipt2),/changed/);
});
test('ambiguous templates and wrong Check 24 dates are refused',()=>{
  const tracker=fixture();tracker.bills.push({...tracker.bills[1],id:99});assert.throws(()=>a.preview(tracker),/unambiguous/);
  const wrong=fixture();wrong.checkLogs[1].endDate='2026-10-27';assert.throws(()=>a.preview(wrong),/restricted/);
  const slots=fixture();slots.bills[1].dueDay=15;assert.throws(()=>a.preview(slots),/one mid-month/);
});
test('manual same-name expenses survive repair and undated financial rows block it',()=>{
  const tracker=fixture();const manual={id:99,bill:'Mortgage Holding 2',cost:2050,dueDate:'2026-10-17',manualEntry:true};
  tracker.checkLogs[1].items.push(manual);a.apply(tracker,a.preview(tracker));
  assert.deepEqual(tracker.checkLogs[1].items.find(i=>i.id===99),manual);
  assert.equal(tracker.checkLogs[1].items.filter(i=>[1,2].includes(i.scheduleSourceId)).length,1);
  const undated=fixture();delete undated.checkLogs[1].items.find(i=>i.scheduleSourceId===1).dueDate;
  assert.ok(a.preview(undated).conflicts.some(c=>c.includes('Undated')));
});
test('other checks with legacy or protected holding rows require review before any new allocation',()=>{
  const tracker=fixture(),old=JSON.parse(JSON.stringify(tracker.checkLogs[1]));
  old.id=25;old.items.find(i=>i.scheduleSourceId===2).paid=true;
  a.apply(tracker,a.preview(tracker));
  const before=JSON.stringify(old);
  assert.throws(()=>a.assertLogCanSync(old,tracker.bills),/preserved/);assert.equal(JSON.stringify(old),before);
  assert.doesNotThrow(()=>a.assertLogCanSync(tracker.checkLogs[1],tracker.bills));
  const single=JSON.parse(before);single.items=single.items.filter(i=>i.scheduleSourceId===1).slice(0,1);
  assert.throws(()=>a.assertLogCanSync(single,tracker.bills),/Review/);
});
test('per-check templates do not expand into invented weekly/monthly calendar dates; projections retain two allocations',()=>{
  assert.deepEqual(s.getOccurrencesInRange('2026-10-16','percheck','2026-10-01','2026-10-31'),[]);
  assert.equal(s.getNextDueDate('2026-10-16','percheck'),null);
  const tracker=fixture();a.apply(tracker,a.preview(tracker));
  const onlyHoldings={bills:tracker.bills.filter(b=>b.recurrenceInterval==='percheck')};
  assert.deepEqual(scenarios.project(onlyHoldings,{startDate:'2027-02-01'}).map(row=>row.baseline),[4100,4100,4100]);
  const calendar=require('../calendar-preview');
  const rows=calendar.plan(onlyHoldings.bills,[],'synthetic-owner','synthetic-calendar',{today:'2026-10-16'});
  assert.equal(rows.filter(row=>row.kind!=='conflict').length,0);
});
