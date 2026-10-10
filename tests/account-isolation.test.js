const test=require('node:test'),assert=require('node:assert/strict');
const isolation=require('../account-isolation');
function fixture(values={}) { const data=new Map(Object.entries(values)); return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}; }
test('unassigned legacy records are quarantined, never inherited by a new account',()=>{
  const storage=fixture({dashboard:'old-records',chat:'old-chat',logs:'old-logs'});
  const gate=isolation.create(storage,['dashboard','chat','logs']);
  gate.switchTo('new-account');
  assert.equal(storage.getItem('dashboard'),null);
  assert.equal(storage.getItem('chat'),null);
  assert.equal(storage.getItem('logs'),null);
  assert.equal(JSON.parse(storage.getItem('msp-account-recovery-v1:unassigned')).values.dashboard,'old-records');
});
test('logout clears active data while account-scoped recovery preserves same-account persistence',()=>{
  const storage=fixture({'msp-active-account-v1':'A',dashboard:'A records',chat:'A chat',logs:'A logs'});
  const gate=isolation.create(storage,['dashboard','chat','logs']);
  gate.switchTo(null);
  for(const key of ['dashboard','chat','logs'])assert.equal(storage.getItem(key),null);
  gate.switchTo('B');assert.equal(storage.getItem('dashboard'),null);
  storage.setItem('dashboard','B records');
  gate.switchTo('A');assert.equal(storage.getItem('dashboard'),'A records');
  gate.switchTo('B');assert.equal(storage.getItem('dashboard'),'B records');
  assert.equal(gate.switchTo('B'),false);
});
test('stale and interrupted operations are invalidated without destroying data',()=>{
  const storage=fixture({'msp-active-account-v1':'A',dashboard:'A records'});
  const gate=isolation.create(storage,['dashboard']);
  const token=gate.token();gate.invalidate();assert.equal(gate.valid(token),false);
  assert.equal(storage.getItem('dashboard'),'A records');
  const fresh=gate.token();gate.switchTo('B');assert.equal(gate.valid(fresh),false);
});
test('failed recovery write stops transition before clearing original records',()=>{
  const storage=fixture({dashboard:'irreplaceable'});
  const gate=isolation.create({...storage,setItem:()=>{throw new Error('Storage full')}},['dashboard']);
  assert.throws(()=>gate.switchTo('B'),/Storage full/);
  assert.equal(storage.getItem('dashboard'),'irreplaceable');
  assert.equal(gate.owner(),'unassigned');
});

test('damaged recovery cache opens a safe empty account instead of retaining prior records',()=>{
  const storage=fixture({'msp-active-account-v1':'A',dashboard:'A data','msp-account-recovery-v1:B':'invalid json'});
  const gate=isolation.create(storage,['dashboard']);
  assert.doesNotThrow(()=>gate.switchTo('B'));
  assert.equal(storage.getItem('dashboard'),null);
  assert.equal(gate.owner(),'B');
});
