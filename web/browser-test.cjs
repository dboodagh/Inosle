const {chromium}=require('/Users/dboodagh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto('http://127.0.0.1:8765/Nova-Insole-Lab.html');
 assert.equal(await page.locator('svg').count(),2);
 assert.equal(await page.locator('.reading').count(),16);
 await page.locator('#demo').click();await page.waitForTimeout(500);
 assert.match(await page.locator('#connection-pill').textContent(),/DEMO/);
 assert(await page.locator('#capture').isDisabled());
 await page.locator('#record').click();await page.waitForTimeout(300);await page.locator('#record').click();
 assert(await page.evaluate(()=>session.rows.length>0&&session.rows.every(r=>r.forces.every(f=>f.n===null&&f.status==='demo'))));
 const pending=page.waitForEvent('download');await page.locator('#csv').click();const download=await pending;assert.match(download.suggestedFilename(),/nova-demo/);
 await page.screenshot({path:'/Users/dboodagh/InsoleCalibration/preview-desktop.png',fullPage:true});
 await page.locator('#disconnect').click();
 assert.equal(await page.locator('#connection-pill').textContent(),'Offline');
 const result=await page.evaluate(()=>{
  const c={schema:PROTOCOL,id:crypto.randomUUID(),channels:Array.from({length:16},()=>[{adc:30,n:0},{adc:1000,n:10},{adc:2000,n:30}])};
  validateCalibration(c);calibration=c;
  const interpolate=forceFor(0,1500);const below=forceFor(0,29);const above=forceFor(0,2001);const rail=forceFor(0,4095);
  let rejected=false;try{validateCalibration({...c,channels:[[{adc:100,n:0},{adc:90,n:1}],...c.channels.slice(1)]});}catch{rejected=true;}
  beginConnection('USB');onFrame({sequence:0,timestampUs:100000,timeMs:0,missedFrames:0,adc:Array(16).fill(1000)});renderReadings();
  return {interpolate,below,above,rail,rejected,total:$('total').textContent,cop:$('cop-marker').style.opacity};
 });
 assert.equal(result.interpolate.n,20);assert.equal(result.below.n,null);assert.equal(result.above.n,null);assert.equal(result.rail.status,'adc_rail');assert(result.rejected);assert.equal(result.total,'160.0 N');assert.equal(result.cop,'1');
 // Capture a real-shaped stable stream through UI; no actual sensor hardware involved.
 await page.evaluate(()=>{calibration.channels[0]=[];renderCalibration();window.testSeq=1;window.testTimer=setInterval(()=>onFrame({sequence:testSeq++,timestampUs:testSeq*20000,timeMs:testSeq*20,missedFrames:0,adc:Array(16).fill(40)}),20);});
 await page.locator('#load').fill('0');await page.locator('#capture').click();await page.waitForTimeout(1250);
 assert.equal(await page.evaluate(()=>calibration.channels[0].length),1);
 assert.equal(await page.evaluate(()=>calibration.channels[0][0].adc),40);
 await page.evaluate(()=>clearInterval(testTimer));await page.waitForTimeout(1700);
 assert(await page.locator('#capture').isDisabled());assert.equal(await page.locator('#cop-marker').evaluate(e=>e.style.opacity),'0');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/Users/dboodagh/InsoleCalibration/preview-mobile.png',fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
 console.log('PASS: desktop/mobile, original SVG presence, demo, recording/CSV, interpolation, range/rail validity, calibration validation, force-weighted CoP, one-second capture, stale stream, no JavaScript errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
