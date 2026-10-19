const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=process.env.APP_ROOT || path.resolve(__dirname,'../..'), evidence=path.resolve(process.env.EVIDENCE_DIR||path.join(__dirname,'../../../evidence'));
fs.mkdirSync(evidence,{recursive:true});
const server=http.createServer((req,res)=>{
  const file=path.join(root,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise(r=>server.listen(4391,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:process.env.TEST_TZ || 'America/Los_Angeles'});
    // Fresh context; allow only public styling CDN and localhost. Financial APIs remain blocked.
    await context.route('**/*',route=>(route.request().url().startsWith('http://127.0.0.1:4391/') || route.request().url().startsWith('https://cdn.tailwindcss.com') || route.request().url().startsWith('https://cdn.jsdelivr.net/npm/chart.js'))?route.continue():route.abort());
    const page=await context.newPage(),errors=[],checks=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
    await page.goto('http://127.0.0.1:4391/',{waitUntil:'networkidle'});
    await page.evaluate(()=>{saveDataToCloud=async()=>{};renderAnalytics=()=>{};});
    // Test the actual editor/save handler with old due-day-only records.
    await page.evaluate(()=>{
      state.checkTracker={bills:[{id:10,name:'Legacy monthly',amount:100,dueDay:19,category:'Housing'}],oneTimeExpenses:[],checkLogs:[]};
      showBillEditModal(10);
    });
    if(process.env.CHARACTERIZE){
      const selected=await page.locator('#billEditInterval').inputValue();
      await page.locator('#billEditAmount').fill('105');await page.locator('#saveBillEditBtn').click();
      const saved=await page.evaluate(()=>state.checkTracker.bills[0].recurrenceInterval);
      assert.equal(selected,'weekly');assert.equal(saved,'weekly');
      const result={baseline:'c106d5821e03098b7cb93b14f0a74307b41b4cc7',legacyBillIntervalBefore:null,editorSelected:selected,intervalAfterAmountOnlySave:saved,productionRequests:'blocked'};
      fs.writeFileSync(path.join(evidence,'baseline-editor-bug.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));return;
    }
    assert.equal(await page.locator('#billEditInterval').inputValue(),'monthly');
    await page.locator('#billEditAmount').fill('105');await page.locator('#saveBillEditBtn').click();
    assert.equal(await page.evaluate(()=>state.checkTracker.bills[0].recurrenceInterval),'monthly');checks.push('legacy editor amount-only save retains Monthly');
    await page.evaluate(()=>{state.checkTracker.bills[0].recurrenceInterval='unsupported';showBillEditModal(10);});
    assert.equal(await page.locator('#billEditInterval').inputValue(),'');
    const unknownBefore=await page.evaluate(()=>JSON.stringify(state.checkTracker.bills[0]));
    await page.locator('#saveBillEditBtn').click();
    assert.equal(await page.evaluate(()=>JSON.stringify(state.checkTracker.bills[0])),unknownBefore);checks.push('unsupported saved interval blocks save');
    await page.evaluate(()=>{
      hideBillEditModal();
      state.checkTracker={bills:[
        {id:114,name:'M2',amount:996,category:'Transportation',firstDueDate:'2026-10-19',dueDay:19,recurrenceInterval:'weekly'},
        {id:2,name:'Mortgage Holding 1',amount:2050,category:'Housing',firstDueDate:'2026-09-30',dueDay:31,recurrenceInterval:'weekly'},
        {id:1,name:'Mortgage Holding 2',amount:2050,category:'Housing',firstDueDate:'2026-10-16',dueDay:16,recurrenceInterval:'weekly'}
      ],oneTimeExpenses:[],checkLogs:[{id:23,name:'Check 23',startDate:'2026-09-29',endDate:'2026-10-12',month:9,year:2026,items:[{id:1,bill:'Historical',cost:50,dueDate:'2026-10-01',paid:true}],checkAmount:100}]};
      renderAll();document.querySelector('[data-tab="check-logs-tab"]').click();
    });
    assert.equal(await page.locator('#paycheckAdvanced').evaluate(el=>el.open),false);
    const historical=await page.evaluate(()=>JSON.stringify(state.checkTracker.checkLogs[0]));
    await page.locator('#newCheckDate').fill('2026-10-13');await page.locator('#addCheckBtn').click();
    let card=page.locator('.card[data-log-id="24"]');
    assert.deepEqual(await page.evaluate(()=>state.checkTracker.checkLogs[1].items.map(i=>[i.bill,i.dueDate])),[
      ['M2','2026-10-19'],['M2','2026-10-26'],['Mortgage Holding 1','2026-10-14'],['Mortgage Holding 1','2026-10-21'],['Mortgage Holding 2','2026-10-16'],['Mortgage Holding 2','2026-10-23']]);
    checks.push('date-only Add Check reproduces screenshot from explicit Weekly settings');
    const weekly=await page.evaluate(()=>JSON.stringify(state.checkTracker.checkLogs[1]));
    for(let i=0;i<3;i++)await card.locator('.sync-log-btn').click();
    assert.equal(await page.evaluate(()=>JSON.stringify(state.checkTracker.checkLogs[1])),weekly);
    await page.locator('#newCheckDate').fill('2026-10-13');await page.locator('#addCheckBtn').click();
    assert.equal(await page.evaluate(()=>state.checkTracker.checkLogs.length),2);checks.push('repeated Sync and repeated Add Check are idempotent');
    const beforeReview=await page.evaluate(()=>JSON.stringify(state.checkTracker));
    await card.locator('.fix-repeated-bills-btn').click();
    assert.equal(await page.locator('#billEditInterval').inputValue(),'weekly');
    assert.equal(await page.evaluate(()=>JSON.stringify(state.checkTracker)),beforeReview);
    await page.evaluate(()=>{hideBillEditModal();document.querySelector('[data-tab="check-logs-tab"]').click();});checks.push('Review schedules makes no financial changes');
    // Exercise actual row UI edits; the original occurrence remains occupied.
    const row=card.locator('tr[data-item-id="1"]');
    await row.locator('[data-prop="bill"]').fill('M2 adjusted');await row.locator('[data-prop="bill"]').blur();
    await row.locator('[data-prop="cost"]').fill('900');await row.locator('[data-prop="cost"]').blur();
    await row.locator('[data-prop="dueDate"]').fill('2026-10-20');await row.locator('[data-prop="dueDate"]').blur();
    await card.locator('tr[data-item-id="3"] .item-paid').check();
    await page.evaluate(()=>hidePaymentInfoModal());
    const edited=await page.evaluate(()=>JSON.stringify([...state.checkTracker.checkLogs[1].items].sort((a,b)=>a.id-b.id)));
    for(let i=0;i<3;i++)await card.locator('.sync-log-btn').click();
    assert.equal(await page.evaluate(()=>JSON.stringify([...state.checkTracker.checkLogs[1].items].sort((a,b)=>a.id-b.id))),edited);
    await page.reload({waitUntil:'networkidle'});
    await page.evaluate(()=>{saveDataToCloud=async()=>{};renderAnalytics=()=>{};document.querySelector('[data-tab="check-logs-tab"]').click();});
    await card.locator('.sync-log-btn').click();
    assert.equal(await page.evaluate(()=>JSON.stringify([...state.checkTracker.checkLogs[1].items].sort((a,b)=>a.id-b.id))),edited);
    assert.equal(await page.evaluate(()=>JSON.stringify(state.checkTracker.checkLogs[0])),historical);
    checks.push('paid/user edits and original occurrence identity survive sync, save/reload; historical check unchanged');
    await page.evaluate(()=>document.getElementById('toastContainer')?.replaceChildren());
    await page.screenshot({path:path.join(evidence,'check-fix-desktop.png'),fullPage:true});
    // Monthly schedule variant uses the same dates and distinct holding sources.
    await page.evaluate(()=>{
      state.checkTracker.bills.forEach(b=>b.recurrenceInterval='monthly');
      state.checkTracker.checkLogs=state.checkTracker.checkLogs.slice(0,1);renderAll();
    });
    await page.locator('#newCheckDate').fill('2026-10-13');await page.locator('#addCheckBtn').click();
    assert.deepEqual(await page.evaluate(()=>state.checkTracker.checkLogs[1].items.map(i=>[i.bill,i.dueDate])),[['M2','2026-10-19'],['Mortgage Holding 2','2026-10-16']]);
    for(let i=0;i<3;i++)await card.locator('.sync-log-btn').click();
    assert.equal(await page.evaluate(()=>state.checkTracker.checkLogs[1].items.length),2);checks.push('monthly bills add once; Holding 1 due on 31st is outside Check 24');
    await page.setViewportSize({width:390,height:844});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    await page.evaluate(()=>document.getElementById('toastContainer')?.replaceChildren());
    await page.screenshot({path:path.join(evidence,'check-fix-mobile.png'),fullPage:true});
    const ambiguous=await page.evaluate(()=>{
      state.checkTracker.bills=[{id:1,name:'Shared',amount:10,dueDay:19},{id:2,name:'Shared',amount:20,dueDay:19}];
      state.checkTracker.checkLogs[1].items=[{id:1,bill:'Shared',cost:15,dueDate:'2026-10-19',paid:false}];
      const before=JSON.stringify(state.checkTracker.checkLogs[1].items);
      syncBillsIntoCheckLog(state.checkTracker.checkLogs[1]);renderCheckLogs();
      return before===JSON.stringify(state.checkTracker.checkLogs[1].items);
    });
    assert.equal(ambiguous,true);
    assert.match(await card.innerText(),/Sync preserves these rows and skips ambiguous schedules/);
    checks.push('ambiguous legacy names are preserved with a visible review notice');
    assert.equal(overflow,false);assert.deepEqual(errors,[]);
    const result={checks,pageErrors:errors,mobileOverflow:overflow,timezone:process.env.TEST_TZ||'America/Los_Angeles',productionRequests:'All financial APIs blocked; public styling and chart CDNs allowed; fresh disposable Chrome context; synthetic data only'};
    fs.writeFileSync(path.join(evidence,'check-fix-browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  } finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
