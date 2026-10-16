const {chromium}=require('/Users/dboodagh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
 const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   Object.defineProperty(navigator,'serial',{value:undefined,configurable:true});
   Object.defineProperty(window,'showDirectoryPicker',{value:undefined,configurable:true});
   window.usbCalls=[];window.claimError=false;
   let pending=null,queue=[];
   const configuration={configurationValue:1,interfaces:[
    {interfaceNumber:0,alternates:[{interfaceClass:2,interfaceSubclass:2,alternateSetting:0,endpoints:[]}]},
    {interfaceNumber:1,alternates:[{interfaceClass:10,alternateSetting:0,endpoints:[{type:'bulk',direction:'in',endpointNumber:2,packetSize:64}]}]}
   ]};
   const device={opened:false,configuration:null,configurations:[configuration],
    async open(){this.opened=true;usbCalls.push('open');},
    async selectConfiguration(){this.configuration=configuration;},
    async claimInterface(i){if(claimError)throw new DOMException('Interface unavailable','SecurityError');usbCalls.push(['claim',i]);},
    async selectAlternateInterface(){},
    async controlTransferOut(setup,payload){usbCalls.push({setup,payload:[...payload]});return {status:'ok'};},
    transferIn(){return new Promise((resolve,reject)=>{if(queue.length)resolve(queue.shift());else pending={resolve,reject};});},
    async close(){this.opened=false;usbCalls.push('close');queue=[];if(pending){pending.reject(new Error('Device closed'));pending=null;}}
   };
   window.pushUSB=bytes=>{const padded=new Uint8Array(bytes.length+4);padded.set(bytes,2);const result={status:'ok',data:new DataView(padded.buffer,2,bytes.length)};if(pending){pending.resolve(result);pending=null;}else queue.push(result);};
   Object.defineProperty(navigator,'usb',{value:{async requestDevice(options){usbCalls.push(options);return device;}},configurable:true});
 });
 await page.goto('http://127.0.0.1:8765/Nova-Insole-Lab.html');
 assert(await page.locator('#usb').isEnabled());assert.match(await page.locator('#usb').textContent(),/WebUSB/);
 assert(await page.locator('#record-disk').isHidden());
 await page.locator('#usb').click();await page.waitForFunction(()=>mode==='USB'&&!busy);
 const setup=await page.evaluate(()=>usbCalls);
 assert(setup.some(c=>c.setup?.request===0x22&&c.setup.value===1));
 const coding=setup.find(c=>c.setup?.request===0x20);assert.deepEqual(coding.payload,[0,194,1,0,0,0,8]);
 await page.evaluate(()=>{
  const bytes=new Uint8Array(80);
  for(let part=0;part<4;part++){
   const p=bytes.subarray(part*20,part*20+20),d=new DataView(p.buffer,p.byteOffset,20);
   p[0]=0xa5;p[1]=0x10|part;d.setUint16(2,123,true);d.setUint32(4,500000,true);
   for(let j=0;j<5;j++)d.setUint16(8+j*2,part*5+j<16?100+part*5+j:0,true);
   d.setUint16(18,InsoleDecoder.crc16(p.subarray(0,18)),true);
  }
  pushUSB([...bytes.slice(0,13)]);pushUSB([...bytes.slice(13,64)]);pushUSB([...bytes.slice(64)]);
 });
 await page.waitForFunction(()=>latest?.sequence===123);
 assert.deepEqual(await page.evaluate(()=>latest.adc),Array.from({length:16},(_,i)=>100+i));
 await page.waitForTimeout(200);
 assert.equal(await page.locator('.reading').nth(8).locator('b').textContent(),'109');
 await page.screenshot({path:'/Users/dboodagh/InsoleCalibration/preview-android.png',fullPage:true});
 // Disconnect while transferIn is pending; it must not wait for another packet.
 await page.locator('#disconnect').click();await page.waitForFunction(()=>!mode&&!busy);
 await page.locator('#usb').click();await page.waitForFunction(()=>mode==='USB'&&!busy);
 await page.locator('#disconnect').click();await page.waitForFunction(()=>!mode&&!busy);
 await page.evaluate(()=>{claimError=true;});await page.locator('#usb').click();await page.waitForFunction(()=>!busy);
 assert.match(await page.locator('#status').textContent(),/Android USB access failed/);
 assert(await page.locator('#usb').isEnabled());assert.equal(await page.evaluate(()=>mode),null);
 assert.deepEqual(errors,[]);
 console.log('PASS: Android-like API detection, CDC setup/DTR, fragmented binary frames/DataView offsets, sensor mapping, idle cancellation, reconnect, permission failure and mobile layout. Physical Android validation remains required.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
