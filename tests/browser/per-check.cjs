const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.env.EVIDENCE_DIR||path.join(__dirname,'../../../evidence'));
const server=http.createServer((req,res)=>{
  const file=path.join(root,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise(r=>server.listen(4392,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:process.env.TEST_TZ||'America/Los_Angeles'});
    await context.route('**/*',route=>/^(http:\/\/127\.0\.0\.1:4392\/|https:\/\/cdn\.tailwindcss\.com|https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js)/.test(route.request().url())?route.continue():route.abort());
    const page=await context.newPage(),errors=[],checks=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:4392/',{waitUntil:'networkidle'});
    await page.evaluate(()=>{
      saveDataToCloud=async()=>{};
      state.checkTracker={bills:[
        {id:14,name:'M2',amount:996,category:'Transportation',firstDueDate:'2026-10-19',dueDay:19,recurrenceInterval:'weekly'},
        {id:2,name:'Mortgage Holding 1',amount:2050,category:'Housing',firstDueDate:'2026-09-30',dueDay:31,recurrenceInterval:'weekly'},
        {id:1,name:'Mortgage Holding 2',amount:2050,category:'Housing',firstDueDate:'2026-10-16',dueDay:16,recurrenceInterval:'weekly'},
        {id:40,name:'Weekly groceries',amount:50,category:'Food & Dining',firstDueDate:'2026-10-13',dueDay:13,recurrenceInterval:'weekly'}
      ],checkLogs:[{id:23,name:'Check 23',startDate:'2026-09-29',endDate:'2026-10-12',items:[{id:1,bill:'Historical',cost:123,paid:true}],checkAmount:5000}],oneTimeExpenses:[],paycheckCadence:'semimonthly',earlyAccessDays:2};
      const log={id:24,name:'Check 24',startDate:'2026-10-13',endDate:'2026-10-26',checkAmount:5000,items:[]};
      state.checkTracker.bills.forEach(b=>BillScheduler.reconcileScheduledItems(log,{sourceId:b.id,name:b.name,amount:b.amount,category:b.category,dates:BillScheduler.getOccurrencesInRange(b.firstDueDate,b.recurrenceInterval,log.startDate,log.endDate,b.dueDay)}));state.checkTracker.checkLogs.push(log);saveState();renderAll();document.querySelector('[data-tab="check-logs-tab"]').click();
    });
    const original=await page.evaluate(()=>JSON.stringify(state.checkTracker));
    const historical=await page.evaluate(()=>JSON.stringify(state.checkTracker.checkLogs[0]));
    const card=page.locator('.card[data-log-id="24"]');
    await card.locator('.preview-check24-repair-btn').click();
    const preview=await page.locator('#confirmModalText').innerText();
    assert.match(preview,/M2: weekly → monthly/);assert.match(preview,/Mortgage Holding 1: weekly → percheck \(month-end\)/);assert.match(preview,/Mortgage Holding 2: weekly → percheck \(mid-month\)/);
    assert.equal((preview.match(/REMOVE row/g)||[]).length,4);
    assert.equal(await page.evaluate(()=>JSON.stringify(state.checkTracker)),original);
    await page.locator('#confirmCancelBtn').click();assert.equal(await page.evaluate(()=>JSON.stringify(state.checkTracker)),original);
    checks.push('exact preview lists three setting changes and four removals; preview/cancel are read-only');
    fs.writeFileSync(path.join(out,'check24-repair-preview.txt'),preview);
    // A failed backup must leave the complete dashboard unchanged.
    await page.evaluate(()=>{window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.includes(':check24:'))throw Error('Synthetic backup quota failure');return window.originalStorageSet.call(this,k,v);};});
    await card.locator('.preview-check24-repair-btn').click();await page.locator('#confirmOkBtn').click();
    assert.equal(await page.evaluate(()=>JSON.stringify(state.checkTracker)),original);
    assert.match(await page.locator('#toastContainer').innerText(),/backup quota failure/);
    await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageSet;});
    checks.push('backup storage failure blocks all financial mutations');
    await card.locator('.preview-check24-repair-btn').click();
    const downloadPromise=page.waitForEvent('download');await page.locator('#confirmOkBtn').click();
    const download=await downloadPromise;assert.match(download.suggestedFilename(),/before-repair/);
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes(':check24:')).length),1);
    assert.equal(await page.evaluate(()=>JSON.stringify(state.checkTracker.checkLogs[0])),historical);
    assert.deepEqual(await page.evaluate(()=>state.checkTracker.bills.map(b=>[b.id,b.amount,b.recurrenceInterval])),[[14,996,'monthly'],[2,2050,'percheck'],[1,2050,'percheck'],[40,50,'weekly']]);
    const getRows=()=>page.evaluate(()=>state.checkTracker.checkLogs.find(l=>l.id===24).items.filter(i=>[1,2,14].includes(i.scheduleSourceId)).sort((a,b)=>a.scheduleSourceId-b.scheduleSourceId).map(i=>[i.bill,i.cost,i.dueDate]));
    assert.deepEqual(await getRows(),[['Mortgage Holding 2',2050,'2026-10-13'],['M2',996,'2026-10-19']]);
    for(let n=0;n<3;n++)await card.locator('.sync-log-btn').click();
    const repaired=await getRows();
    await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>typeof state!=='undefined'&&state.checkTracker?.checkLogs.some(l=>l.id===24));await page.evaluate(()=>{saveDataToCloud=async()=>{};document.querySelector('[data-tab="check-logs-tab"]').click();});
    await card.locator('.sync-log-btn').click();assert.deepEqual(await getRows(),repaired);
    checks.push('Apply backs up, preserves amounts/history/weekly expenses; repeated sync and reload retain exactly one holding');
    // Undo is narrow and survives normal rendering/sorting and reload.
    await card.locator('.undo-check24-repair-btn').click();const undoDownload=page.waitForEvent('download');await page.locator('#confirmOkBtn').click();await undoDownload;
    assert.deepEqual(await page.evaluate(()=>JSON.parse(JSON.stringify(state.checkTracker)).bills),JSON.parse(original).bills);
    assert.equal(await page.evaluate(()=>state.checkTracker.checkLogs.find(l=>l.id===24).items.length),8);
    checks.push('Undo restores only the reviewed settings and Check 24, with another backup');
    await card.locator('.preview-check24-repair-btn').click();const secondDownload=page.waitForEvent('download');await page.locator('#confirmOkBtn').click();await secondDownload;
    // Create early-access checks with the actual date-only form.
    for(const date of ['2026-10-28','2026-11-13','2026-11-28','2027-02-26','2027-03-13']){
      await page.locator('#newCheckDate').fill(date);await page.locator('#addCheckBtn').click();
      const log=await page.evaluate(()=>state.checkTracker.checkLogs.at(-1));
      assert.equal(log.startDate,date);const rows=log.items.filter(i=>[1,2].includes(i.scheduleSourceId));assert.equal(rows.length,1,date);assert.equal(rows[0].cost,2050);assert.equal(rows[0].dueDate,date);
      assert.equal(rows[0].scheduleSourceId,Number(date.slice(-2))<=20?1:2);
    }
    checks.push('actual Add Check gives one $2050 holding on 28th, mid-month, February early access and March boundary');
    const edited=await page.evaluate(()=>{
      const log=state.checkTracker.checkLogs.find(l=>l.id===24),row=log.items.find(i=>i.scheduleSourceId===1);
      row.cost=1900;row.userEdited=true;row.paid=true;const before=JSON.stringify(row);syncBillsIntoCheckLog(log);saveState();return before;
    });
    assert.equal(await page.evaluate(()=>JSON.stringify(state.checkTracker.checkLogs.find(l=>l.id===24).items.find(i=>i.scheduleSourceId===1))),edited);
    const legacyGuard=await page.evaluate(()=>{
      const log={id:99,startDate:'2026-10-28',endDate:'2026-11-12',items:[{id:1,bill:'Mortgage Holding 2',cost:2050,dueDate:'2026-10-29',scheduleDueDate:'2026-10-29',scheduleSourceType:'recurring',scheduleSourceId:1,paid:true}]};
      const before=JSON.stringify(log);let rejected=false;
      try{syncBillsIntoCheckLog(log);}catch{rejected=true;}
      reconcileRecurringBillInLog(state.checkTracker.bills.find(b=>b.id===2),log);
      return {rejected,unchanged:JSON.stringify(log)===before,message:checkAllocationReviewMessage(log)};
    });
    assert.equal(legacyGuard.rejected,true);assert.equal(legacyGuard.unchanged,true);assert.match(legacyGuard.message,/preserved/);
    checks.push('other existing legacy/paid holding rows block Sync and direct write-through before adding or deleting allocations');
    await page.evaluate(()=>document.getElementById('toastContainer').replaceChildren());
    await page.screenshot({path:path.join(out,'per-check-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'per-check-mobile.png'),fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);assert.deepEqual(errors,[]);
    const result={checks,pageErrors:errors,mobileOverflow:overflow,timezone:process.env.TEST_TZ||'America/Los_Angeles',financialRequests:'blocked; synthetic data and disposable profile only'};
    fs.writeFileSync(path.join(out,'per-check-browser-'+(process.env.TEST_TZ?'auckland':'los-angeles')+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
