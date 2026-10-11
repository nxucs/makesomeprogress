const test = require('node:test'), assert = require('node:assert/strict');
const C = require('./calendar-preview');
const bill = {id:1,name:'Rent',amount:500,firstDueDate:'2026-01-15',dueDay:15,recurrenceInterval:'monthly'};
function fixture() {
  const b = {...bill,calendarSync:{key:'durable-key',owner:'owner',calendarId:'cal',eventId:'event',schedule:JSON.stringify([bill.firstDueDate,bill.dueDay,bill.recurrenceInterval])}};
  const e = {id:'event',etag:'version',summary:'Rent - $400.00',start:{date:'2026-01-15'},end:{date:'2026-01-16'},recurrence:['RRULE:FREQ=MONTHLY'],extendedProperties:{private:{source:'makesomeprogress',syncKey:'durable-key',owner:'owner'}}};
  return {b,e};
}
test('preview paginates using GET only and stops on repeated tokens', async()=>{
  const calls=[]; const items=await C.list(async(url,options)=>{calls.push([url,options]);return {ok:true,json:async()=>calls.length===1?{items:[1],nextPageToken:'next'}:{items:[2]}}},C.base+'/events');
  assert.deepEqual(items,[1,2]); assert.equal(calls[0][1],undefined);assert.match(calls[1][0],/pageToken=next/);
  await assert.rejects(C.list(async()=>({ok:true,json:async()=>({nextPageToken:'loop'})}),C.base+'/events'),/pagination/);
});
test('HTTP failures surface; guard aborts reads',async()=>{
  await assert.rejects(C.list(async()=>({ok:false,status:403}),C.base+'/events'),/403/);
  await assert.rejects(C.list(async()=>{throw Error('must not fetch')},C.base+'/events',()=>{throw Error('stale')}),/stale/);
});
test('reused numeric IDs and direct legacy mappings never authorize updates',()=>{
  const e={id:'old',extendedProperties:{private:{source:'makesomeprogress',billId:'1'}}};
  assert.equal(C.plan([{...bill,gcalEventId:'old'}],[e],'owner','cal')[0].kind,'conflict');
});
test('titles and managed descriptions alone cannot authorize writes or deletion',()=>{
  const rows=C.plan([bill],[{id:'unrelated',summary:'Rent',description:'Managed by MakeSomeProgress'}],'owner','cal');
  assert.equal(rows.length,1);assert.equal(rows[0].kind,'create');assert.equal(rows[0].eventId,undefined);assert.equal(rows[0].selected,undefined);
});
test('durable scoped mapping enables title-only update and leaves input immutable',()=>{
  const {b,e}=fixture(), before=JSON.stringify([b,e]);
  assert.equal(C.plan([b],[e],'owner','cal')[0].kind,'update');assert.equal(JSON.stringify([b,e]),before);
  assert.equal(C.plan([b],[e],'different','cal')[0].kind,'conflict');
  assert.equal(C.plan([b],[e],'owner','different')[0].kind,'conflict');
});
test('duplicates, cancellation, missing versions and schedule changes conflict',()=>{
  const {b,e}=fixture();
  for(const events of [[e,{...e,id:'duplicate'}],[{...e,status:'cancelled'}],[{...e,etag:null}]]) assert.equal(C.plan([b],events,'owner','cal')[0].kind,'conflict');
  const changed=C.plan([{...b,dueDay:31}],[e],'owner','cal')[0];assert.equal(changed.kind,'update');assert.equal(changed.payload.start,undefined);assert.match(changed.reason,/Historical/);
});
test('unmatched app-owned events are review-only; new bills require selection',()=>{
  const {e}=fixture();assert.equal(C.plan([], [e],'owner','cal')[0].kind,'review');
  const row=C.plan([bill],[],'owner','cal')[0];assert.equal(row.kind,'create');assert.equal(row.selected,undefined);
});
