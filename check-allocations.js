(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./bill-scheduler') : root.BillScheduler);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CheckAllocations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(scheduler) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const key = value => String(value || '').trim().toLowerCase();
  function affected(tracker,receipt) {
    return JSON.stringify({bills:tracker.bills.filter(b=>receipt.sourceIds.includes(b.id)).slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))),items:tracker.checkLogs.find(l=>l.id===receipt.logId)?.items.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))});
  }
  function slot(log) {
    const date = scheduler.parseDateOnly(log.scheduledPayDate || log.expectedAvailabilityDate || log.startDate);
    if (!date) throw Error('The check needs a valid paycheck date.');
    return date.getDate() <= 20 ? 'mid-month' : 'month-end';
  }
  function selected(bill, log, bills) {
    if (bill.recurrenceInterval !== 'percheck') return false;
    if (!bill.checkAllocation) return true;
    const { group } = bill.checkAllocation;
    if (!group || !['mid-month','month-end'].includes(bill.checkAllocation.slot)) throw Error('Review the check allocation group and slot.');
    const candidates = bills.filter(b => b.recurrenceInterval === 'percheck' && b.checkAllocation?.group === group);
    const chosen = candidates.filter(b => b.checkAllocation?.slot === slot(log));
    if (chosen.length !== 1) throw Error('Review the mortgage allocation templates: exactly one template is required for this check slot.');
    return chosen[0] === bill;
  }
  function dates(bill, log, bills) {
    return selected(bill, log, bills) ? [log.startDate] : [];
  }
  function protectedRow(item, bill) {
    const values = {bill:item.bill,cost:item.cost,category:item.category,dueDate:item.dueDate};
    return item.paid || item.userEdited || item.bankTransactionId || item.manualEntry ||
      (item.scheduleValues && JSON.stringify(values) !== JSON.stringify(item.scheduleValues)) ||
      item.bill !== bill.name || Number(item.cost) !== Number(bill.amount) ||
      (item.category && item.category !== bill.category);
  }
  function preview(tracker) {
    const before = JSON.stringify(tracker);
    const bills = tracker.bills || [], logs = tracker.checkLogs || [];
    const names = ['M2','Mortgage Holding 1','Mortgage Holding 2'];
    const sources = names.map(name => {
      const found = bills.filter(b => key(b.name) === key(name));
      if(found.length !== 1) throw Error('Repair requires one unambiguous bill named '+name+'.');
      if(!Number.isFinite(Number(found[0].amount)) || Number(found[0].amount) <= 0) throw Error('Review the bill amount before repair.');
      return found[0];
    });
    if(new Set(sources.map(b=>String(b.id))).size !== 3) throw Error('Bill IDs are ambiguous.');
    const check = logs.filter(l => Number(l.id) === 24 && l.startDate === '2026-10-13' && l.endDate === '2026-10-26');
    if(check.length !== 1) throw Error('Repair is restricted to Check 24, October 13–26, 2026.');
    const log = check[0], next = clone(tracker), changes = [], conflicts = [];
    const nextSources = sources.map(source=>next.bills.find(b=>String(b.id)===String(source.id)));
    const [m2,...holdings] = nextSources;
    m2.recurrenceInterval = 'monthly';
    holdings.forEach(b=>{
      b.recurrenceInterval = 'percheck';
      b.checkAllocation = {group:'mortgage-holding',slot:Number(b.dueDay) <= 20 ? 'mid-month' : 'month-end'};
    });
    if(new Set(holdings.map(b=>b.checkAllocation.slot)).size !== 2) throw Error('Review the holding due days: one mid-month and one month-end template is required.');
    nextSources.forEach((b,i)=>{
      if(JSON.stringify(b)!==JSON.stringify(sources[i])) changes.push({kind:'setting',billId:b.id,bill:b.name,amount:b.amount,before:sources[i].recurrenceInterval||'legacy monthly',after:b.recurrenceInterval,slot:b.checkAllocation?.slot,firstDueDate:b.firstDueDate,dueDay:b.dueDay});
    });
    const nextLog = next.checkLogs.find(l=>l.id===log.id);
    const selectedHolding = holdings.find(b=>selected(b,log,next.bills));
    const sourceFor = item => {
      if(item.manualEntry) return undefined;
      if(item.scheduleSourceType) return item.scheduleSourceType === 'recurring' ? sources.find(b=>String(b.id)===String(item.scheduleSourceId)) : undefined;
      return sources.find(b=>key(b.name)===key(item.bill));
    };
    const dues = m2.firstDueDate
      ? scheduler.getOccurrencesInRange(m2.firstDueDate,'monthly',log.startDate,log.endDate,m2.dueDay).map(scheduler.formatDateYMD)
      : [scheduler.formatDateYMD(new Date(2026,9,Math.min(31,Math.max(1,Number(m2.dueDay)||1))))].filter(d=>d>=log.startDate&&d<=log.endDate);
    const wanted = [{bill:selectedHolding,date:log.startDate},...dues.map(date=>({bill:m2,date}))];
    const relevant = nextLog.items.filter(item=>sourceFor(item));
    relevant.filter(item=>!scheduler.parseDateOnly(item.dueDate)).forEach(item=>conflicts.push('Undated row '+item.id+' requires review.'));
    const kept = new Set();
    wanted.forEach(({bill,date})=>{
      const candidates = relevant.filter(item=>String(sourceFor(item).id)===String(bill.id)&&!kept.has(item));
      const protectedCandidates = candidates.filter(item=>protectedRow(item,bill));
      if(protectedCandidates.length>1){conflicts.push('Multiple protected rows for '+bill.name);return;}
      let item = protectedCandidates[0] || candidates.find(item=>(item.scheduleDueDate||item.dueDate)===date) || candidates[0];
      if(!item){
        item={id:Math.max(0,...nextLog.items.map(i=>Number(i.id)||0))+1,bill:bill.name,cost:Number(bill.amount),category:bill.category||'Other',dueDate:date,paid:false};
        nextLog.items.push(item);changes.push({kind:'add',itemId:item.id,bill:bill.name,cost:item.cost,dueDate:date});
      }
      const old=clone(item), preserve=protectedRow(item,bill);
      if(!preserve) item.dueDate=date;
      item.scheduleSourceType='recurring';item.scheduleSourceId=bill.id;item.scheduleDueDate=date;
      if(!preserve) item.scheduleValues={bill:item.bill,cost:item.cost,category:item.category,dueDate:item.dueDate};
      kept.add(item);
      if(JSON.stringify(old)!==JSON.stringify(item)) changes.push({kind:'update',itemId:item.id,bill:item.bill,cost:item.cost,oldDueDate:old.dueDate,dueDate:item.dueDate,occurrenceDate:date,preserveFinancialFields:!!preserve});
    });
    relevant.filter(item=>!kept.has(item)).forEach(item=>{
      const source=sourceFor(item);
      const validDate = source.firstDueDate && scheduler.getOccurrencesInRange(source.firstDueDate,source.recurrenceInterval||'monthly',log.startDate,log.endDate,source.dueDay).map(scheduler.formatDateYMD).includes(item.dueDate);
      if(protectedRow(item,source)||!validDate){conflicts.push('Preserve/review '+item.bill+' row '+item.id+' due '+item.dueDate);return;}
      nextLog.items=nextLog.items.filter(i=>i!==item);
      changes.push({kind:'remove',itemId:item.id,bill:item.bill,cost:item.cost,dueDate:item.dueDate});
    });
    return {before,next,changes,conflicts,sourceIds:sources.map(b=>b.id),logId:log.id};
  }
  function apply(tracker, plan) {
    if(plan.conflicts.length) throw Error('Protected or ambiguous rows require review; no repair applied.');
    if(JSON.stringify(tracker)!==plan.before) throw Error('Records changed since preview. Preview again.');
    const receipt={beforeBills:clone(tracker.bills.filter(b=>plan.sourceIds.includes(b.id))),beforeItems:clone(tracker.checkLogs.find(l=>l.id===plan.logId).items),sourceIds:plan.sourceIds,logId:plan.logId};
    plan.sourceIds.forEach(id=>{const index=tracker.bills.findIndex(b=>b.id===id);tracker.bills[index]=clone(plan.next.bills.find(b=>b.id===id));});
    tracker.checkLogs.find(l=>l.id===plan.logId).items=clone(plan.next.checkLogs.find(l=>l.id===plan.logId).items);
    receipt.after=affected(tracker,receipt);
    return receipt;
  }
  function undo(tracker,receipt) {
    const log=tracker.checkLogs.find(l=>l.id===receipt.logId);
    const current=affected(tracker,receipt);
    if(current!==receipt.after) throw Error('Affected records changed after repair. Review before restoring.');
    receipt.beforeBills.forEach(b=>{tracker.bills[tracker.bills.findIndex(item=>item.id===b.id)]=clone(b);});
    log.items=clone(receipt.beforeItems);
  }
  return {slot,selected,dates,preview,apply,undo};
});
