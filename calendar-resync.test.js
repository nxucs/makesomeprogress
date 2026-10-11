const test=require('node:test'),assert=require('node:assert/strict'),C=require('./calendar-preview');
const key='0123456789abcdef0123456789abcdef',today='2026-10-11';
const baseBill={id:3,name:'Mortgage',amount:2050,category:'Housing',firstDueDate:'2026-09-30',dueDay:30,recurrenceInterval:'monthly'};
function remote(initial=[],behavior={}) {
 const events=new Map(initial.map(e=>[e.id,structuredClone(e)])),calls=[];let serial=0;
 const request=async(url,opts)=>{
  const id=decodeURIComponent(url.split('/').pop());calls.push({id,method:opts?.method||'GET',body:opts?.body});
  if(!opts?.method && url.includes('/events?'))return {ok:true,status:200,json:async()=>({items:[...events.values()]})};
  if(!opts?.method)return {ok:events.has(id),status:events.has(id)?200:404,json:async()=>structuredClone(events.get(id))};
  const payload=JSON.parse(opts.body);
  if(behavior.failBefore)throw Error('network before write');
  if(opts.method==='POST'){
   if(events.has(payload.id))return {ok:false,status:409};
   events.set(payload.id,{...payload,etag:'v'+(++serial)});
  } else {
   if(!events.has(id))return {ok:false,status:404};
   if(events.get(id).etag!==opts.headers['If-Match'])return {ok:false,status:412};
   events.set(id,{...events.get(id),...payload,etag:'v'+(++serial)});
  }
  if(behavior.loseResponse)throw Error('response lost');
  return {ok:true,status:200,json:async()=>structuredClone(events.get(opts.method==='POST'?payload.id:id))};
 };
 return {request,events,calls};
}
function legacy() {return {id:'legacy',etag:'old',summary:'Mortgage - $1900.00',description:'Category: Housing',start:{date:'2026-09-30',timeZone:'America/Chicago'},end:{date:'2026-10-01',timeZone:'America/Chicago'},recurrence:['RRULE:FREQ=MONTHLY'],extendedProperties:{private:{source:'makesomeprogress',billId:'3',other:'preserve'}}};}
function rows(bills,events){return C.plan(bills,events,'owner','cal',{today});}
function persistence(bills, fail=false){return async(row,mapping)=>{if(fail)throw Error('storage full');bills[row.billIndex].calendarSync=structuredClone(mapping)};}
test('explicit legacy enrollment then update preserves historical dates and financial fields',async()=>{
 const bills=[{...baseBill,gcalEventId:'legacy'}],financial=JSON.stringify(bills[0]),r=remote([legacy()]);
 let plan=rows(bills,[legacy()]);assert.equal(plan[0].kind,'adopt');
 assert.equal(await C.apply(plan,r.request,'cal','owner',()=>{},persistence(bills),()=>key),0);assert.equal(r.calls.length,0);
 plan[0].selected=true;assert.equal(await C.apply(plan,r.request,'cal','owner',()=>{},persistence(bills),()=>key),1);
 assert.equal(bills[0].calendarSync.key,key);assert.equal(r.events.get('legacy').extendedProperties.private.other,'preserve');
 plan=rows(bills,[r.events.get('legacy')]);assert.equal(plan[0].kind,'update');assert.match(plan[0].reason,/Historical/);assert.equal(plan[0].payload.start,undefined);
 plan[0].selected=true;await C.apply(plan,r.request,'cal','owner',()=>{},persistence(bills),()=>key);
 assert.equal(r.events.get('legacy').summary,'Mortgage - $2050.00');assert.equal(r.events.get('legacy').start.date,'2026-09-30');assert.deepEqual(r.events.get('legacy').recurrence,['RRULE:FREQ=MONTHLY']);
 const {calendarSync,...fields}=bills[0];assert.equal(JSON.stringify(fields),financial);
});
test('weak numeric matches, duplicate legacy maps and cross-owner markers cannot enroll',()=>{
 assert.equal(rows([baseBill],[legacy()])[0].kind,'conflict');
 const b={...baseBill,gcalEventId:'legacy'};assert.equal(rows([b,b],[legacy()])[0].kind,'conflict');
 const e=legacy();e.extendedProperties.private.owner='someone-else';assert.equal(rows([b],[e])[0].kind,'conflict');
});
test('enrollment preflight detects edited Calendar version and performs no writes',async()=>{
 const bills=[{...baseBill,gcalEventId:'legacy'}],row=rows(bills,[legacy()])[0];row.selected=true;
 const r=remote([{...legacy(),etag:'changed'}]);await assert.rejects(C.apply([row],r.request,'cal','owner',()=>{},persistence(bills),()=>key),/changed after preview/);
 assert.deepEqual(r.calls.map(c=>c.method),['GET']);assert.equal(bills[0].calendarSync,undefined);
});
test('uncertain accepted insert recovers by exact durable ID without duplicate POST',async()=>{
 const bills=[{...baseBill}],r=remote([],{loseResponse:true}),row=rows(bills,[])[0];row.selected=true;
 assert.equal(await C.apply([row],r.request,'cal','owner',()=>{},persistence(bills),()=>key),1);
 assert.equal(r.calls.filter(c=>c.method==='POST').length,1);assert.equal(r.events.size,1);assert.equal(bills[0].calendarSync.status,'synced');
 const next=rows(bills,[...r.events.values()]);assert.equal(next[0].kind,'unchanged');
});
test('failed insert retains pending ID; next review resumes same ID and creates once',async()=>{
 const bills=[{...baseBill}],r=remote([],{failBefore:true});let row=rows(bills,[])[0];row.selected=true;
 await assert.rejects(C.apply([row],r.request,'cal','owner',()=>{},persistence(bills),()=>key),/pending identity retained/i);
 const id=bills[0].calendarSync.eventId;assert.equal(id,'msp'+key);assert.equal(bills[0].calendarSync.status,'pending-create');
 const retry=remote();row=rows(bills,[])[0];row.selected=true;await C.apply([row],retry.request,'cal','owner',()=>{},persistence(bills),()=>{throw Error('must reuse')});
 assert.equal([...retry.events.keys()][0],id);assert.equal(retry.events.size,1);
});
test('existing deterministic ID with foreign ownership is never overwritten',async()=>{
 const mapping={key,owner:'owner',calendarId:'cal',eventId:'msp'+key,status:'pending-create'},bills=[{...baseBill,calendarSync:mapping}],r=remote([{id:mapping.eventId,etag:'v',extendedProperties:{private:{owner:'foreign',syncKey:key}}}]);
 const row=rows(bills,[])[0];row.selected=true;await assert.rejects(C.apply([row],r.request,'cal','owner',()=>{},persistence(bills),()=>key),/ownership conflict/);assert.equal(r.calls.some(c=>c.method==='POST'||c.method==='PATCH'),false);
});
test('local recovery storage failure blocks remote insert',async()=>{
 const bills=[{...baseBill}],r=remote(),row=rows(bills,[])[0];row.selected=true;
 await assert.rejects(C.apply([row],r.request,'cal','owner',()=>{},persistence(bills,true),()=>key),/storage full/);assert.equal(r.calls.some(c=>c.method!=='GET'),false);
});
test('changed future recurrence updates dates; past recurrence preserves dates',()=>{
 const b={...baseBill,firstDueDate:'2026-11-01',dueDay:1,recurrenceInterval:'weekly'},e={...legacy(),start:{date:'2026-11-01'},end:{date:'2026-11-02'},extendedProperties:{private:{source:'makesomeprogress',owner:'owner',syncKey:key}}};
 b.calendarSync={key,owner:'owner',calendarId:'cal',eventId:e.id,schedule:'old',remote:C.managed(e)};
 let row=rows([b],[e])[0];assert.equal(row.kind,'update');assert.deepEqual(row.payload.recurrence,['RRULE:FREQ=WEEKLY']);
 const past={...e,start:{date:'2026-09-01'},end:{date:'2026-09-02'}};b.calendarSync.remote=C.managed(past);row=rows([b],[past])[0];assert.equal(row.payload.start,undefined);assert.match(row.reason,/Historical/);
});
test('calendar edits since last successful sync remain conflicts',()=>{
 const e=legacy(),b={...baseBill,calendarSync:{key,owner:'owner',calendarId:'cal',eventId:e.id}};e.extendedProperties.private={source:'makesomeprogress',syncKey:key,owner:'owner'};b.calendarSync.remote=C.managed(e);e.description='Calendar user edited this';assert.equal(rows([b],[e])[0].kind,'conflict');
});
test('date-only schedules clamp February and maintain month interval phase',()=>{
 const b={...baseBill,firstDueDate:'2026-01-31',dueDay:31};
 const feb=C.schedule(b,'2026-02-01');assert.equal(feb.start.date,'2026-02-28');assert.equal(feb.end.date,'2026-03-01');assert.match(feb.recurrence[0],/BYMONTHDAY=28,29,30,31;BYSETPOS=-1/);
 assert.equal(C.equivalentSchedule(feb,b,C.schedule(b,'2026-03-01')),true);
 assert.equal(C.schedule({...b,recurrenceInterval:'quarterly'},'2026-02-01').start.date,'2026-04-30');
 assert.equal(C.schedule({...b,recurrenceInterval:'annual'},'2027-01-01').start.date,'2027-01-31');
 assert.throws(()=>C.schedule({...b,firstDueDate:'2026-02-31'},today),/Invalid due date/);
});
test('stale guard halts creation before identity persistence or API write',async()=>{
 const bills=[{...baseBill}],r=remote(),row=rows(bills,[])[0];row.selected=true;
 await assert.rejects(C.apply([row],r.request,'cal','owner',()=>{throw Error('stale preview')},persistence(bills),()=>key),/stale/);assert.equal(r.calls.length,0);assert.equal(bills[0].calendarSync,undefined);
});
test('future recurrence Apply uses If-Match PATCH and preserves unrelated event fields',async()=>{
 const b={...baseBill,firstDueDate:'2026-11-01',dueDay:1,recurrenceInterval:'weekly'},e={...legacy(),start:{date:'2026-11-01'},end:{date:'2026-11-02'},colorId:'9',reminders:{useDefault:false,overrides:[{method:'popup',minutes:30}]},extendedProperties:{private:{source:'makesomeprogress',owner:'owner',syncKey:key}}};
 b.calendarSync={key,owner:'owner',calendarId:'cal',eventId:e.id,schedule:'old',remote:C.managed(e)};
 const bills=[b],r=remote([e]),row=rows(bills,[e])[0];row.selected=true;
 await C.apply([row],r.request,'cal','owner',()=>{},persistence(bills),()=>key);
 assert.deepEqual(r.events.get(e.id).recurrence,['RRULE:FREQ=WEEKLY']);assert.deepEqual(r.events.get(e.id).reminders,e.reminders);assert.equal(r.events.get(e.id).colorId,'9');assert.equal(b.calendarSync.status,'synced');
});
test('a recurring exception added since preview stops a future schedule update',async()=>{
 const b={...baseBill,firstDueDate:'2026-11-01',dueDay:1,recurrenceInterval:'weekly'},e={...legacy(),start:{date:'2026-11-01'},end:{date:'2026-11-02'},extendedProperties:{private:{source:'makesomeprogress',owner:'owner',syncKey:key}}};b.calendarSync={key,owner:'owner',calendarId:'cal',eventId:e.id,schedule:'old',remote:C.managed(e)};
 const row=rows([b],[e])[0];row.selected=true;const r=remote([e,{id:'exception',recurringEventId:e.id}]);
 await assert.rejects(C.apply([row],r.request,'cal','owner',()=>{},persistence([b]),()=>key),/exceptions/);assert.equal(r.calls.some(c=>c.method==='PATCH'),false);
});
test('a concurrent app-marked event stops a missing-event create',async()=>{
 const bills=[{...baseBill}],row=rows(bills,[])[0];row.selected=true;const r=remote([legacy()]);
 await assert.rejects(C.apply([row],r.request,'cal','owner',()=>{},persistence(bills),()=>key),/appeared since preview/);assert.equal(r.calls.some(c=>c.method==='POST'),false);
});
test('lost enrollment response recovers ownership and date-only API normalization is accepted',async()=>{
 const bills=[{...baseBill,gcalEventId:'legacy'}],r=remote([legacy()],{loseResponse:true}),row=rows(bills,[legacy()])[0];row.selected=true;
 await C.apply([row],r.request,'cal','owner',()=>{},persistence(bills),()=>key);assert.equal(bills[0].calendarSync.status,'synced');
 const newBills=[{...baseBill}],r2=remote();const request=async(url,opts)=>{const response=await r2.request(url,opts);if(opts?.method==='POST'){const result=await response.json();delete result.start.timeZone;delete result.end.timeZone;return {...response,json:async()=>result};}return response;};
 const create=rows(newBills,[])[0];create.selected=true;await C.apply([create],request,'cal','owner',()=>{},persistence(newBills),()=>key);assert.equal(newBills[0].calendarSync.status,'synced');
});
test('recurring exceptions are not mistaken for duplicate master identities',()=>{
 const e=legacy(),b={...baseBill,gcalEventId:'legacy'};
 const exception={...e,id:'exception',recurringEventId:e.id};assert.equal(rows([b],[e,exception])[0].kind,'adopt');
 e.extendedProperties.private={source:'makesomeprogress',owner:'owner',syncKey:key};b.calendarSync={key,owner:'owner',calendarId:'cal',eventId:e.id,remote:C.managed(e)};exception.extendedProperties.private={...e.extendedProperties.private};assert.equal(rows([b],[e,exception])[0].kind,'update');
});
test('duplicate local durable keys conflict and object key ordering does not mimic an edit',()=>{
 const e=legacy();e.extendedProperties.private={source:'makesomeprogress',owner:'owner',syncKey:key};
 const b={...baseBill,calendarSync:{key,owner:'owner',calendarId:'cal',eventId:e.id,remote:C.managed(e)}};assert.equal(rows([b,{...b,id:4}],[e])[0].kind,'conflict');
 const reordered={...e,extendedProperties:{private:{syncKey:key,owner:'owner',source:'makesomeprogress'}}};assert.equal(C.managed(reordered),C.managed(e));
});
test('a 412 between preflight and PATCH surfaces conflict without retry',async()=>{
 const e=legacy();e.extendedProperties.private={source:'makesomeprogress',owner:'owner',syncKey:key};const bills=[{...baseBill,calendarSync:{key,owner:'owner',calendarId:'cal',eventId:e.id,remote:C.managed(e)}}],r=remote([e]);let writes=0;
 const request=async(url,opts)=>{if(opts?.method==='PATCH'){writes++;return {ok:false,status:412};}return r.request(url,opts);};const row=rows(bills,[e])[0];row.selected=true;
 await assert.rejects(C.apply([row],request,'cal','owner',()=>{},persistence(bills),()=>key),/412/);assert.equal(writes,1);assert.equal(bills[0].calendarSync.status,'pending-update');
});
test('cloud financial fingerprint ignores sync metadata but detects bill and paid-log edits',()=>{
 const a={checkTracker:{bills:[baseBill],checkLogs:[{items:[{paid:true,cost:10}]}]},appStates:{googleCalendarToken:'MOCK'},calendar:{currentDate:today}},b=structuredClone(a);
 b.checkTracker.bills[0].calendarSync={key};b.appStates.googleCalendarToken='OTHER-MOCK';b.calendar.currentDate='2027-01-01';assert.equal(C.financialSnapshot(a),C.financialSnapshot(b));
 b.checkTracker.checkLogs[0].items[0].cost=20;assert.notEqual(C.financialSnapshot(a),C.financialSnapshot(b));
 b.checkTracker.checkLogs[0].items[0].cost=10;b.checkTracker.bills[0].amount=2100;assert.notEqual(C.financialSnapshot(a),C.financialSnapshot(b));
});
test('future master RRULE plus EXDATE and RDATE is refused without dropping overrides',async()=>{
 const b={...baseBill,name:'Rent',amount:500,firstDueDate:'2026-11-15',dueDay:15},e={...legacy(),summary:'Rent - $400.00',start:{date:'2026-11-15'},end:{date:'2026-11-16'},recurrence:['RRULE:FREQ=MONTHLY;BYMONTHDAY=15','EXDATE;VALUE=DATE:20261215','RDATE;VALUE=DATE:20261220'],extendedProperties:{private:{source:'makesomeprogress',owner:'owner',syncKey:key}}};
 b.calendarSync={key,owner:'owner',calendarId:'cal',eventId:e.id,remote:C.managed(e)};const r=remote([e]),row=rows([b],[e])[0];
 assert.equal(row.kind,'conflict');assert.match(row.reason,/EXDATE\/RDATE/);row.selected=true;
 assert.equal(await C.apply([row],r.request,'cal','owner',()=>{},persistence([b]),()=>key),0);assert.deepEqual(r.events.get(e.id).recurrence,e.recurrence);assert.equal(r.calls.length,0);
 // Defense in depth refuses an old/fabricated future schedule preview too.
 const stale={...row,kind:'update',payload:{...C.schedule(b,today),summary:'Rent - $500.00'}};
 await assert.rejects(C.apply([stale],r.request,'cal','owner',()=>{},persistence([b]),()=>key),/Complex recurrence overrides/);assert.equal(r.calls.some(c=>c.method==='PATCH'),false);
});
test('bounded/custom recurrence rules are not simplified by a future schedule update',()=>{
 const b={...baseBill,firstDueDate:'2026-11-15',dueDay:15},e={...legacy(),start:{date:'2026-11-15'},end:{date:'2026-11-16'},extendedProperties:{private:{source:'makesomeprogress',owner:'owner',syncKey:key}}};
 for(const rule of ['RRULE:FREQ=MONTHLY;COUNT=3','RRULE:FREQ=MONTHLY;UNTIL=20271215','RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15','RRULE:FREQ=WEEKLY;BYDAY=MO,TU']){e.recurrence=[rule];b.calendarSync={key,owner:'owner',calendarId:'cal',eventId:e.id,remote:C.managed(e)};assert.equal(rows([b],[e])[0].kind,'conflict');}
});
test('newer unselected cloud Calendar mapping is refused even with identical financial records',()=>{
 const baseline=[{...baseBill},{...baseBill,id:4,name:'Bill B'}],cloud=structuredClone(baseline);cloud[1].calendarSync={key:'different',eventId:'other',status:'synced'};
 assert.equal(C.financialSnapshot({checkTracker:{bills:baseline}}),C.financialSnapshot({checkTracker:{bills:cloud}}));assert.equal(C.cloudMappingsAgree(baseline,cloud,0),false);
 const pending={key,owner:'owner',calendarId:'cal',eventId:'msp'+key,status:'pending-create'};baseline[0].calendarSync={...pending,status:'pending-cloud'};cloud[0].calendarSync=pending;cloud[1].calendarSync=undefined;
 assert.equal(C.cloudMappingsAgree(baseline,cloud,0),true);assert.equal(C.cloudMappingsAgree(baseline,cloud,1),false);
});
test('confirmed POST is counted and receipted before final recovery persistence fails',async()=>{
 const bills=[{...baseBill}],r=remote(),row=rows(bills,[])[0];row.selected=true;let error;
 try {await C.apply([row],r.request,'cal','owner',()=>{},async(row,mapping,context)=>{bills[row.billIndex].calendarSync=structuredClone(mapping);if(context.phase==='confirmed')throw Error('Final cloud read failed.');},()=>key);}catch(e){error=e;}
 assert.equal(error.completed,1);assert.equal(error.recoveryPending,true);assert.match(error.message,/1 confirmed Calendar operations/);assert.equal(error.receipts[0].eventId,'msp'+key);assert.equal(error.receipts[0].operation,'create');assert.equal(r.events.size,1);assert.equal(r.calls.filter(c=>c.method==='POST').length,1);assert.deepEqual(bills[0].calendarSync.receipt,error.receipts[0]);
 bills[0].calendarSync.status='pending-cloud';const recovery=rows(bills,[...r.events.values()])[0];assert.equal(recovery.kind,'recover');recovery.selected=true;
 await C.apply([recovery],r.request,'cal','owner',()=>{},persistence(bills),()=>key);assert.equal(r.calls.filter(c=>c.method==='POST').length,1);assert.equal(r.calls.filter(c=>c.method==='PATCH').length,0);assert.equal(bills[0].calendarSync.status,'synced');
});
test('confirmed metadata receipt can recover even when a historical or complex schedule is unsupported',()=>{
 const e=legacy(),b={...baseBill};e.extendedProperties.private={source:'makesomeprogress',owner:'owner',syncKey:key};e.recurrence.push('EXDATE;VALUE=DATE:20261030');
 b.calendarSync={key,owner:'owner',calendarId:'cal',eventId:e.id,remote:C.managed(e),status:'pending-cloud',receipt:{operation:'adopt',eventId:e.id,etag:e.etag}};
 const row=rows([b],[e])[0];assert.equal(row.kind,'recover');assert.equal(row.payload,null);
 const edited={...e,etag:'changed',description:'someone edited this'};assert.equal(rows([b],[edited])[0].kind,'conflict');
});
for(const operation of ['POST','PATCH'])test(`${operation} quota failure after success recovers from pre-write intent after reload without another Calendar write`,async()=>{
 const e=legacy();e.extendedProperties.private={source:'makesomeprogress',owner:'owner',syncKey:key};
 let bills=operation==='POST'?[{...baseBill}]:[{...baseBill,calendarSync:{key,owner:'owner',calendarId:'cal',eventId:e.id,remote:C.managed(e)}}];
 const r=remote(operation==='POST'?[]:[e]),row=rows(bills,[...r.events.values()])[0];row.selected=true;let disk=structuredClone(bills),failure;
 try{await C.apply([row],r.request,'cal','owner',()=>{},async(row,mapping,context)=>{
   if(context.phase==='confirmed')throw Error('QuotaExceededError after confirmed Calendar write');
   bills[row.billIndex].calendarSync=structuredClone(mapping);disk=structuredClone(bills);
 },()=>key);}catch(error){failure=error;}
 assert.equal(failure.completed,1);assert.equal(r.calls.filter(c=>c.method===operation).length,1);assert.equal(disk[0].calendarSync.receipt,undefined);assert.equal(disk[0].calendarSync.intent.operation,operation==='POST'?'create':'update');
 bills=structuredClone(disk);const recovery=rows(bills,[...r.events.values()])[0];assert.equal(recovery.kind,'recover');recovery.selected=true;
 const writesBefore=r.calls.filter(c=>c.method!=='GET').length;
 await C.apply([recovery],r.request,'cal','owner',()=>{},persistence(bills),()=>{throw Error('must reuse identity')});
 assert.equal(r.calls.filter(c=>c.method!=='GET').length,writesBefore);assert.equal(r.events.size,1);assert.equal(bills[0].calendarSync.status,'synced');assert.equal(bills[0].calendarSync.receipt.operation,operation==='POST'?'create':'update');assert.equal(bills[0].calendarSync.receipt.recovered,true);
 assert.equal(bills[0].calendarSync.remote,C.managed([...r.events.values()][0]));
});
test('pre-write recovery refuses a later Calendar edit even with the same private identity',async()=>{
 const bills=[{...baseBill}],r=remote(),row=rows(bills,[])[0];row.selected=true;
 await assert.rejects(C.apply([row],r.request,'cal','owner',()=>{},async(row,mapping,context)=>{if(context.phase==='confirmed')throw Error('quota');bills[row.billIndex].calendarSync=structuredClone(mapping)},()=>key),/quota/);
 const actual=[...r.events.values()][0];actual.recurrence.push('EXDATE;VALUE=DATE:20261230');
 assert.equal(rows(bills,[actual])[0].kind,'conflict');assert.equal(r.calls.filter(c=>c.method==='POST').length,1);
});
