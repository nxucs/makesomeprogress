(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CalendarPreview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const base = 'https://www.googleapis.com/calendar/v3';
  function snapshot(bills) { return JSON.stringify(bills); }
  async function list(request, url, guard = () => {}) {
    const items = [], seen = new Set(); let page;
    do {
      guard();
      const next = new URL(url);
      if (page) next.searchParams.set('pageToken', page);
      const response = await request(next.toString()); guard();
      if (!response.ok) throw new Error(`Calendar read failed (${response.status}). No changes made.`);
      const data = await response.json(); guard();
      items.push(...(data.items || [])); page = data.nextPageToken;
      if (page && seen.has(page)) throw new Error('Calendar pagination repeated; preview stopped.');
      seen.add(page);
    } while (page);
    return items;
  }
  const monthSteps = {monthly:1,bimonthly:2,quarterly:3,semiannual:6,annual:12};
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const d = new Date(value + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0,10) === value ? d : null;
  }
  function schedule(bill, today) {
    const reference = date(today); if (!reference) throw Error('Invalid preview date.');
    const cadence = bill.recurrenceInterval || 'monthly';
    let anchor = date(bill.firstDueDate);
    const day = Number(bill.dueDay || anchor?.getUTCDate());
    if (!anchor && !bill.firstDueDate && day >= 1 && day <= 31) anchor = new Date(Date.UTC(reference.getUTCFullYear(),reference.getUTCMonth(),Math.min(day,new Date(Date.UTC(reference.getUTCFullYear(),reference.getUTCMonth()+1,0)).getUTCDate())));
    if (!anchor || !Number.isInteger(day) || day < 1 || day > 31) throw Error('Invalid due date or due day.');
    let start, rule;
    if (cadence === 'weekly' || cadence === 'biweekly') {
      const step = cadence === 'weekly' ? 7 : 14;
      const n = Math.max(0,Math.ceil((reference-anchor)/86400000/step));
      start = new Date(+anchor+n*step*86400000);
      rule = 'RRULE:FREQ=WEEKLY' + (step === 14 ? ';INTERVAL=2' : '');
    } else {
      const step = monthSteps[cadence]; if (!step) throw Error('Unsupported recurrence: ' + cadence);
      let n = Math.max(0,Math.floor(((reference.getUTCFullYear()-anchor.getUTCFullYear())*12+reference.getUTCMonth()-anchor.getUTCMonth())/step));
      do {
        const first = new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+n*step,1));
        const last = new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
        start = new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(day,last))); n++;
      } while (start < reference || start < anchor);
      // Monthly intervals preserve phase; clamp days 29-31 in short months.
      rule = 'RRULE:FREQ=MONTHLY' + (step !== 1 ? ';INTERVAL='+step : '') + (day > 28 ? ';BYMONTHDAY='+Array.from({length:day-27},(_,i)=>28+i).join(',')+';BYSETPOS=-1' : ';BYMONTHDAY='+day);
    }
    const end = new Date(+start+86400000);
    return {start:{date:start.toISOString().slice(0,10),timeZone:'America/Chicago'},end:{date:end.toISOString().slice(0,10),timeZone:'America/Chicago'},recurrence:[rule]};
  }
  function canonical(value) {
    if(Array.isArray(value))return value.map(canonical);
    if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
    return value;
  }
  function managed(event) { return JSON.stringify(canonical([event.summary || '',event.description || '',event.start,event.end,event.recurrence || [],event.extendedProperties?.private || {},event.attendees || [],event.status || 'confirmed'])); }
  function financialSnapshot(state) {
    const copy=structuredClone(state);
    for(const bill of copy.checkTracker?.bills || [])delete bill.calendarSync;
    delete copy.calendar;
    if(copy.dashboard)delete copy.dashboard.isEditing;
    if(copy.appStates)for(const key of ['googleCalendarToken','makeSomeProgressCalendarId','lastCalSync'])delete copy.appStates[key];
    return JSON.stringify(canonical(copy));
  }
  function cloudMappingsAgree(baseline,cloudBills,selectedIndex) {
    if(baseline.length!==cloudBills.length)return false;
    return baseline.every((bill,index)=>{
      const expected=bill.calendarSync || null,current=cloudBills[index].calendarSync || null;
      if(JSON.stringify(canonical(expected))===JSON.stringify(canonical(current)))return true;
      if(index!==selectedIndex || !expected)return false;
      // A failed prepare can leave its verified local journal ahead of cloud.
      if(!current)return /^pending-/.test(expected.status || '');
      return /^pending-/.test(current.status || '') && expected.key===current.key && expected.owner===current.owner && expected.calendarId===current.calendarId && expected.eventId===current.eventId;
    });
  }
  function simpleRecurrence(event) {
    if(!Array.isArray(event.recurrence) || event.recurrence.length!==1)return false;
    const rule=event.recurrence[0];if(typeof rule!=='string' || !rule.startsWith('RRULE:'))return false;
    const parts=rule.slice(6).split(';'),seen=new Set();
    for(const part of parts){const [key,value,...extra]=part.split('=');if(extra.length || !value || seen.has(key) || !['FREQ','INTERVAL','BYMONTHDAY','BYSETPOS'].includes(key))return false;seen.add(key);}
    const fields=Object.fromEntries(parts.map(part=>part.split('=')));
    if(!['WEEKLY','MONTHLY','YEARLY'].includes(fields.FREQ))return false;
    if(fields.FREQ!=='MONTHLY' && (fields.BYMONTHDAY || fields.BYSETPOS))return false;
    if(fields.INTERVAL && !/^[1-9]\d*$/.test(fields.INTERVAL))return false;
    if(fields.BYSETPOS && fields.BYSETPOS!=='-1')return false;
    if(fields.BYMONTHDAY){
      const days=fields.BYMONTHDAY.split(',').map(Number);
      if(days.some(day=>!Number.isInteger(day)||day<1||day>31))return false;
      if(days.length>1 && (fields.BYSETPOS!=='-1' || days[0]!==28 || days.some((day,index)=>day!==28+index)))return false;
    }
    return !fields.BYSETPOS || !!fields.BYMONTHDAY;
  }
  function payloadMatches(event,payload) {
    return Object.entries(payload).filter(([key])=>key!=='id').every(([key,value])=>{
      if (key==='start' || key==='end') return event[key]?.date===value.date;
      if (key==='extendedProperties') return Object.entries(value.private || {}).every(([name,v])=>event.extendedProperties?.private?.[name]===v);
      return JSON.stringify(event[key])===JSON.stringify(value);
    });
  }
  function intentFingerprint(event) {
    const copy=structuredClone(event);
    for(const field of ['start','end'])if(copy[field]?.date)copy[field]={date:copy[field].date};
    return managed(copy);
  }
  function intentMatches(mapping,event) {
    const p=event.extendedProperties?.private || {};
    return mapping.intent?.eventId===event.id && mapping.eventId===event.id && p.source==='makesomeprogress' && p.syncKey===mapping.key && p.owner===mapping.owner && event.status!=='cancelled' && mapping.intent.expected===intentFingerprint(event);
  }
  function scheduleKey(bill) { return JSON.stringify([bill.firstDueDate,bill.dueDay,bill.recurrenceInterval]); }
  function equivalentSchedule(event, bill, target) {
    if (!event.start?.date || !event.end?.date || !Array.isArray(event.recurrence) || event.recurrence.length !== 1) return false;
    const a = date(event.start.date), b = date(target.start.date); if (!a || !b) return false;
    const rule = event.recurrence[0].toUpperCase();
    const cadence = bill.recurrenceInterval || 'monthly';
    if (cadence === 'weekly' || cadence === 'biweekly') return rule === target.recurrence[0] && (+b-a)/86400000 % (cadence === 'weekly' ? 7 : 14) === 0;
    const day = Number(bill.dueDay || date(bill.firstDueDate)?.getUTCDate());
    const step = monthSteps[cadence];
    const phase = ((b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth()) % step === 0;
    // A legacy plain monthly RRULE is safe only for days that exist in every month.
    const clamped = Math.min(day,new Date(Date.UTC(a.getUTCFullYear(),a.getUTCMonth()+1,0)).getUTCDate());
    return phase && a.getUTCDate() === clamped && (rule === target.recurrence[0] || (day <= 28 && rule === 'RRULE:FREQ=MONTHLY'+(step!==1?';INTERVAL='+step:'')));
  }
  function plan(bills, events, owner, calendarId, options = {}) {
    const rows = [], used = new Set();
    for (const [billIndex,bill] of bills.entries()) {
      const mapping = bill.calendarSync;
      const matches = events.filter(event => {
        const p = event.extendedProperties?.private || {};
        return !event.recurringEventId && mapping?.key && p.source === 'makesomeprogress' && p.syncKey === mapping.key && p.owner === owner;
      });
      const legacy = events.filter(event => !event.recurringEventId && (event.id === bill.gcalEventId ||
        (event.extendedProperties?.private?.source === 'makesomeprogress' && event.extendedProperties.private.billId === String(bill.id))));
      const summary = `${bill.name} - $${Number(bill.amount || 0).toFixed(2)}`;
      let kind = 'conflict', reason = 'Unresolved Calendar identity.', target, payload, scheduleChanged = false;
      let event;
      const today = options.today || new Date().toISOString().slice(0,10);
      try { target = schedule(bill,today); } catch (e) { reason = e.message; }
      const description = `Category: ${bill.category || 'Other'} | Recurring: ${bill.recurrenceInterval || 'monthly'} | Managed by MakeSomeProgress`;
      if (mapping?.key && bills.filter(b=>b.calendarSync?.key===mapping.key).length>1) reason='Duplicate durable identity in local bills. Manual review required.';
      else if (mapping?.owner === owner && mapping?.calendarId === calendarId && matches.length === 1 && matches[0].id === mapping.eventId) {
        event = matches[0]; used.add(event.id);
        if (event.status === 'cancelled') reason = 'Mapped event was cancelled; no automatic recreation.';
        else if (!event.etag) reason = 'Missing event version; cannot safely update.';
        else if (/^pending-/.test(mapping.status || '') && intentMatches(mapping,event)) {kind='recover';reason='The Calendar event matches the saved pre-write operation. Recover its receipt and finalize metadata only; no Calendar write.';payload=null;}
        else if(mapping.status==='pending-create' && mapping.intent)reason='The existing event differs from the saved creation intent. Manual review required; no duplicate creation.';
        else if (mapping.remote && mapping.remote !== managed(event)) reason = 'Calendar event was edited since the last sync. Manual review required.';
        else if (mapping.status==='pending-cloud' && mapping.receipt && mapping.remote===managed(event)) {kind='recover';reason='Calendar success is already confirmed. Finalize recovery metadata only; no Calendar write.';payload=null;}
        else if (!event.start?.date || !event.end?.date) reason = 'Timed or malformed event cannot be updated as an all-day bill series.';
        else if (!simpleRecurrence(event)) reason = 'Complex recurrence or EXDATE/RDATE overrides require manual review. Dates, overrides and series are preserved.';
        else if (!target) { /* invalid schedule stays a conflict */ }
        else {
          scheduleChanged = (mapping.schedule != null && mapping.schedule !== scheduleKey(bill)) || !equivalentSchedule(event,bill,target);
          payload = {summary,description};
          const preserveSchedule = scheduleChanged && (event.start.date < today || events.some(e=>e.recurringEventId === event.id));
          if (preserveSchedule) {
            reason = 'Historical schedule differs. Title/amount/category may update; due-date/recurrence changes require a future-only series split, unavailable here.';
          } else {
            reason = scheduleChanged ? 'Future series schedule, title, amount and category update; no past occurrence is moved.' : 'Title, amount and category update; dates, recurrence and history preserved.';
            if (scheduleChanged) Object.assign(payload,target);
          }
          kind = Object.entries(payload).every(([key,value]) => JSON.stringify(event[key]) === JSON.stringify(value)) ? 'unchanged' : 'update';
          if (preserveSchedule && kind === 'unchanged') {kind='conflict';payload=null;}
          if(kind==='unchanged' && mapping.status==='pending-cloud'){kind='recover';reason='Calendar success is already confirmed. Finalize recovery metadata only; no Calendar write.';payload=null;}
        }
      } else if (matches.length > 1) reason = 'Duplicate private identities; manual review required.';
      else if (legacy.length) {
        const candidate = legacy[0], p = candidate.extendedProperties?.private || {};
        const resumable = mapping?.status === 'pending-enrollment' && mapping.owner === owner && mapping.calendarId === calendarId && mapping.eventId === candidate.id;
        if (legacy.length === 1 && candidate.id === bill.gcalEventId && p.source === 'makesomeprogress' && p.billId === String(bill.id) && !p.syncKey && (!p.owner || p.owner === owner) && candidate.etag && candidate.status !== 'cancelled' && !candidate.attendees?.length && bills.filter(b=>b.gcalEventId===candidate.id).length===1 && (!mapping || resumable)) {
          kind='adopt';event=candidate;used.add(event.id);reason='Explicit enrollment required: verify this exact saved event belongs to this bill. Numeric IDs alone are not trusted. Enrollment preserves event dates and all history.';
        } else reason = 'Legacy mapping or reusable numeric ID cannot prove ownership. Manual review required.';
      } else if (mapping?.status === 'pending-create' && mapping.owner === owner && mapping.calendarId === calendarId && target) {
        kind='create';reason='Resume the same pending event ID; exact-ID recovery precedes insert.';
      } else if (bill.gcalEventId || mapping) reason='Saved mapping is missing, cancelled, or belongs to another account/calendar. No automatic replacement.';
      else if (target && Number(bill.amount) > 0) {kind='create';reason='Create a new future-only recurring event after confirmation. Verify no existing legacy event represents this bill.';}
      if (event?.attendees?.length) {kind='conflict';reason='Event has attendees; automatic enrollment/update is unavailable.';}
      rows.push({kind,billIndex,billId:String(bill.id),name:bill.name,reason,eventId:event?.id,etag:event?.etag,before:event?.summary,after:summary,event, payload,target,description,scheduleChanged,schedule:scheduleKey(bill),mapping});
    }
    for (const event of events) {
      const p = event.extendedProperties?.private || {};
      if (p.source === 'makesomeprogress' && !used.has(event.id) && !event.recurringEventId) rows.push({kind: 'review', name: event.summary || event.id, eventId: event.id, reason: p.owner === owner && p.syncKey ? 'Unmatched app-owned event; potentially obsolete or duplicate. Preserved.' : 'Legacy app marker; ownership and historical exceptions unresolved. Preserved.'});
    }
    return rows;
  }
  async function apply(rows, request, calendarId, owner, guard, persist, uuid = () => crypto.randomUUID()) {
    const selected = rows.filter(r=>['adopt','update','create','recover'].includes(r.kind) && r.selected);
    const endpoint = `${base}/calendars/${encodeURIComponent(calendarId)}/events`;
    const prepared = [],receipts=[]; let completed = 0, finalizing=false;
    if (selected.some(row=>row.kind==='create' || row.payload?.start)) {
      const latest = await list(request,endpoint+'?singleEvents=false&showDeleted=true&maxResults=250',guard);
      for (const row of selected) {
        if (row.kind==='create' && latest.some(event=>{
          const p=event.extendedProperties?.private || {};
          return p.source==='makesomeprogress' && p.billId===row.billId && event.id!==row.mapping?.eventId;
        })) throw Error('An app-marked bill event appeared since preview. No writes started; preview again.');
        if (row.payload?.start && latest.some(event=>event.recurringEventId===row.eventId)) throw Error('Recurring exceptions exist or appeared since preview. Future-only split required; no writes started.');
      }
    }
    // Read every selected existing event before writing any. If any changed, stop the whole batch.
    for (const row of selected) {
      guard();
      if (row.kind !== 'create') {
        const response = await request(endpoint+'/'+encodeURIComponent(row.eventId));guard();
        if (!response.ok) throw Error(`Preflight failed (${response.status}). No writes started.`);
        const current = await response.json();guard();
        if (current.etag !== row.etag || managed(current) !== managed(row.event)) throw Error('Calendar event changed after preview. No writes started.');
        if(row.kind==='recover' && row.mapping.intent && !intentMatches(row.mapping,current))throw Error('The event no longer matches its recorded operation. Recovery refused; no writes started.');
        if(row.payload?.start && !simpleRecurrence(current))throw Error('Complex recurrence overrides cannot be replaced. No writes started.');
      }
      prepared.push(row);
    }
    try { for (const row of prepared) {
      guard();
      if(row.kind==='recover'){
        const mapping={...structuredClone(row.mapping),status:'synced'};
        mapping.remote=managed(row.event);
        if(mapping.intent)mapping.schedule=mapping.intent.schedule;
        const receipt=mapping.receipt || {operation:mapping.intent?.operation || 'recover',eventId:row.eventId,etag:row.etag,confirmedAt:new Date().toISOString(),recovered:true};
        mapping.receipt=receipt;receipts.push(receipt);completed++;finalizing=true;
        await persist(row,mapping,{phase:'confirmed',receipt});guard();finalizing=false;continue;
      }
      const key = row.mapping?.key || uuid().replace(/-/g,'').toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(key)) throw Error('Invalid durable identity.');
      const id = row.kind === 'create' ? (row.mapping?.eventId || 'msp'+key) : row.eventId;
      const mapping = {key,owner,calendarId,eventId:id,schedule:row.schedule,status:row.kind==='create'?'pending-create':row.kind==='adopt'?'pending-enrollment':'pending-update',remote:row.mapping?.remote};
      const marker = {...(row.event?.extendedProperties?.private || {}),source:'makesomeprogress',billId:row.billId,syncKey:key,owner};
      const payload = row.kind === 'create' ? {id,summary:row.after,description:row.description,...row.target,extendedProperties:{private:marker}} : row.kind === 'adopt' ? {extendedProperties:{private:marker}} : row.payload;
      const intended={...(row.event || {}),...structuredClone(payload),id};
      mapping.intent={operation:row.kind,eventId:id,expected:intentFingerprint(intended),schedule:row.kind==='adopt' || (row.scheduleChanged && !row.payload?.start) ? null : row.schedule};
      // Journal durable event ID before external mutation. A failed storage write prevents API writes.
      await persist(row,mapping,{phase:'prepare'});guard();
      let result;
      async function recover() {
        const response = await request(endpoint+'/'+encodeURIComponent(id));guard();
        if (!response.ok) return null;
        const event = await response.json();guard();
        const p=event.extendedProperties?.private || {};
        if (p.source !== 'makesomeprogress' || p.syncKey !== key || p.owner !== owner || event.status === 'cancelled') throw Error('Event ID exists but ownership does not match. No overwrite.');
        return event;
      }
      try {
        if (row.kind === 'create') {
          const response = await request(endpoint+'/'+encodeURIComponent(id));guard();
          if (response.ok) {result=await response.json();guard();const p=result.extendedProperties?.private || {};if(p.syncKey!==key||p.owner!==owner||p.source!=='makesomeprogress'||result.status==='cancelled')throw Error('Event ID ownership conflict.');}
          else if (response.status !== 404) throw Error('Recovery read failed ('+response.status+'); insert not attempted.');
        }
        if (!result) {
          const response=await request(row.kind==='create'?endpoint:endpoint+'/'+encodeURIComponent(id),{method:row.kind==='create'?'POST':'PATCH',headers:row.kind==='create'?{}:{'If-Match':row.etag},body:JSON.stringify(payload)});guard();
          if (!response.ok) {
            if (row.kind==='create' && response.status===409) result=await recover();
            else throw Error('Calendar write failed ('+response.status+').');
          } else {result=await response.json();guard();}
        }
      } catch (error) {
        guard();
        try {
          const recovered=await recover();
          if (!recovered || !payloadMatches(recovered,payload)) throw error;
          result=recovered;
        } catch (_) {throw Error(`${completed} operations completed. ${error.message} Outcome unresolved; pending identity retained. Preview again; no automatic retry.`);}
      }
      if (!result?.id || !result.etag) throw Error('Incomplete Calendar response; pending identity retained. Preview again.');
      if (row.kind === 'create' && !payloadMatches(result,payload)) throw Error('Pending event exists with different fields. Identity preserved; preview and resolve the Calendar edit before retrying.');
      mapping.status='synced';mapping.remote=managed(result);
      if (row.kind==='adopt' || (row.scheduleChanged && !row.payload?.start)) mapping.schedule=null;
      const receipt={operation:row.kind,eventId:result.id,etag:result.etag,confirmedAt:new Date().toISOString()};
      mapping.receipt=receipt;receipts.push(receipt);completed++;finalizing=true;
      await persist(row,mapping,{phase:'confirmed',receipt});guard();finalizing=false;
    } } catch(error) {
      const failure=Error(`${completed} confirmed Calendar operations completed. ${finalizing?'Calendar success is confirmed; cloud/local recovery finalization is incomplete. ':''}${error.message}`);
      failure.receipts=receipts;failure.completed=completed;failure.recoveryPending=finalizing;throw failure;
    }
    return completed;
  }
  return {base,snapshot,list,plan,apply,schedule,managed,equivalentSchedule,financialSnapshot,cloudMappingsAgree};
});
