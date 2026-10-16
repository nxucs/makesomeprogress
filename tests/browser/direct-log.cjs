// Optional browser regression: npm run test:browser (requires Playwright).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port+'/';
  const executablePath=process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try{
    const context=await browser.newContext({timezoneId:'America/Los_Angeles'});
    await context.route('**/*',r=>{const url=r.request().url();return url.startsWith(base)||url.startsWith('https://cdn.tailwindcss.com')||url.startsWith('https://cdn.jsdelivr.net/npm/chart.js')?r.continue():r.abort();});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base,{waitUntil:'networkidle'});
    const fixture=await page.evaluate(()=>structuredClone(DEFAULT_STATE));
    fixture.checkTracker={bills:[
      {id:14,name:'M2',amount:996,dueDay:19,firstDueDate:'2026-10-19',recurrenceInterval:'weekly',category:'Transportation'},
      {id:2,name:'Mortgage Holding 1',amount:2050,dueDay:31,firstDueDate:'2026-09-30',recurrenceInterval:'weekly',category:'Housing'},
      {id:1,name:'Mortgage Holding 2',amount:2050,dueDay:16,firstDueDate:'2026-10-16',recurrenceInterval:'weekly',category:'Housing'},
      {id:77,name:'Genuine weekly expense',amount:42,firstDueDate:'2026-10-13',recurrenceInterval:'weekly',category:'Other'}
    ],oneTimeExpenses:[],checkLogs:[{id:23,name:'Check 23',startDate:'2026-09-29',endDate:'2026-10-12',items:[{id:1,bill:'Preserved history',cost:10,paid:true}],checkAmount:100}]};
    await page.locator('#importFile').setInputFiles({name:'unrepaired-legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
    await page.waitForFunction(()=>state.checkTracker.checkLogs.length===1);
    const before=await page.evaluate(()=>JSON.stringify(state.checkTracker.checkLogs));
    await page.locator('[data-tab="check-logs-tab"]').click();await page.locator('#newCheckDate').fill('2026-10-13');await page.locator('#addCheckBtn').click();
    const rows=()=>page.evaluate(()=>state.checkTracker.checkLogs.find(l=>l.id===24).items.filter(i=>[1,2,14].includes(Number(i.scheduleSourceId))).map(i=>[i.bill,i.cost,i.dueDate]).sort());
    assert.deepEqual(await rows(),[['M2',996,'2026-10-19'],['Mortgage Holding 2',2050,'2026-10-13']]);
    assert.equal(await page.evaluate(()=>state.checkTracker.checkLogs.find(l=>l.id===24).items.filter(i=>i.scheduleSourceId===77).length),2);
    assert.equal(await page.evaluate(()=>JSON.stringify(state.checkTracker.checkLogs.filter(l=>l.id!==24))),before);
    const expected=await rows();for(let n=0;n<3;n++)await page.locator('.card[data-log-id="24"] .sync-log-btn').click();assert.deepEqual(await rows(),expected);
    await page.reload({waitUntil:'networkidle'});await page.locator('[data-tab="check-logs-tab"]').click();await page.locator('.card[data-log-id="24"] .sync-log-btn').click();assert.deepEqual(await rows(),expected);
    assert.deepEqual(errors,[]);console.log('PASS: unrepaired Import -> Log Check -> Sync -> reload; one M2, one holding, genuine weekly occurrences and history preserved.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
