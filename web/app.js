'use strict';
const $=id=>document.getElementById(id);
const SERVICE='19b10000-e8f2-537e-4f6c-d104768a1214', CHARACTERISTIC='19b10001-e8f2-537e-4f6c-d104768a1214';
const STORAGE='nova-calibration-raw12-v1';
const PROTOCOL='nova-raw12-v1-vdd4-10kohm';
let calibration={schema:PROTOCOL,id:crypto.randomUUID(),channels:Array.from({length:16},()=>[])};
let mode=null,busy=false,port=null,reader=null,readTask=null,device=null,characteristic=null,demoTimer=null;
let latest=null,lastArrival=0,history=[],rateWindow=[],missing=0,recording=false,session=null,capture=null;
const decoder=new InsoleDecoder(onFrame);
const coords=Array.from({length:16},(_,i)=>({x:Number($(`heat-${i}`).getAttribute('cx')),y:Number($(`heat-${i}`).getAttribute('cy'))}));
function validateCalibration(c){
  if(!c || c.schema!==PROTOCOL || typeof c.id!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(c.id) || !Array.isArray(c.channels) || c.channels.length!==16)throw Error('Not a compatible Raw12 / VDD reference / 10 kΩ calibration file.');
  for(const points of c.channels){
    if(!Array.isArray(points)||points.length>100)throw Error('Invalid channel points.');
    let previous=null;
    for(const p of points){
      if(!Number.isFinite(p.adc)||p.adc<0||p.adc>4095||!Number.isFinite(p.n)||p.n<0)throw Error('Invalid ADC or force value.');
      if(previous&&(p.adc<=previous.adc||p.n<=previous.n))throw Error('ADC and force must both increase strictly.');
      previous=p;
    }
    if(points.length&&points[0].n!==0)throw Error('Each channel must start with an unloaded 0 N point.');
  }
  return c;
}
try{const saved=localStorage.getItem(STORAGE);if(saved)calibration=validateCalibration(JSON.parse(saved));}catch(e){$('cal-message').textContent='Saved calibration could not be loaded: '+e.message;}
function persist(){calibration.id=crypto.randomUUID();try{localStorage.setItem(STORAGE,JSON.stringify(calibration));}catch(e){$('cal-message').textContent='Calibration remains in memory. Export it: browser storage is unavailable.';}renderCalibration();}
function forceFor(channel,adc,cal=calibration){
  if(adc>=4095)return {n:null,status:'adc_rail'};
  const p=cal.channels[channel];
  if(p.length<3)return {n:null,status:'uncalibrated'};
  if(adc<p[0].adc||adc>p.at(-1).adc)return {n:null,status:'outside_range'};
  for(let j=1;j<p.length;j++)if(adc<=p[j].adc){const a=p[j-1],b=p[j];return {n:a.n+(adc-a.adc)*(b.n-a.n)/(b.adc-a.adc),status:'valid'};}
  return {n:null,status:'outside_range'};
}
function fresh(){return latest&&performance.now()-lastArrival<1500;}
function status(message){$('status').textContent=message;}
function controls(){
  $('usb').disabled=busy||!!mode||!navigator.serial;
  $('ble').disabled=busy||!!mode||!navigator.bluetooth;
  $('disconnect').disabled=busy||!mode;
  $('demo').disabled=busy||!!mode;
  $('record').disabled=!recording&&(!mode||!fresh());
  $('capture').disabled=recording||!!capture||!fresh()||mode==='demo';
  for(const id of ['sensor','load','unit','import-cal','session-name'])$(id).disabled=recording||!!capture;
  $('csv').disabled=recording||!session?.rows.length;
  $('session-json').disabled=recording||!session?.rows.length;
  $('connection-pill').textContent=mode==='demo'?'DEMO · synthetic':mode?`${mode} · ${fresh()?'Streaming':'Waiting for data'}`:'Offline';
}
function clearLive(){latest=null;history=[];rateWindow=[];lastArrival=0;decoder.reset();$('rate').innerHTML='— <em>Hz</em>';$('cal-live').textContent='—';$('total').innerHTML='— <em>N</em>';for(let i=0;i<16;i++){$(`zone-${i}`).style.fill='#d1d5db';$(`heat-${i}`).style.opacity=0;}$('cop-marker').style.opacity=0;$('cop-status').textContent='CoP unavailable: no fresh acquisition data.';renderReadings();}
function beginConnection(kind){clearLive();missing=0;$('gaps').textContent='0';mode=kind;status(kind==='demo'?'Demo uses synthetic ADC signals. It cannot calibrate your sensors.':`Connected via ${kind}. Waiting for Raw12 packets…`);controls();}
function finishConnection(message){if(recording)stopRecording();if(capture){capture=null;$('cal-message').textContent='Capture cancelled because the connection ended.';}mode=null;clearLive();controls();status(message);}
async function disconnect(){
  if(busy)return;busy=true;controls();
  try{if(demoTimer){clearInterval(demoTimer);demoTimer=null;}if(reader){await reader.cancel();await readTask;}if(device?.gatt.connected)device.gatt.disconnect();}
  catch(e){status('Disconnect: '+e.message);}finally{finishConnection('Disconnected. Recorded samples remain available for export.');busy=false;controls();}
}
$('disconnect').onclick=disconnect;
$('usb').onclick=async()=>{
  busy=true;controls();let opened=false;
  try{port=await navigator.serial.requestPort();await port.open({baudRate:115200});opened=true;reader=port.readable.getReader();beginConnection('USB');readTask=readSerial();}
  catch(e){if(opened&&port){try{await port.close();}catch{}}port=null;finishConnection('USB: '+e.message);}
  finally{busy=false;controls();}
};
async function readSerial(){
  let reason='USB disconnected. Samples remain available for export.';
  try{while(true){const {value,done}=await reader.read();if(done)break;if(value)decoder.push(value);}}
  catch(e){reason='USB stream ended: '+e.message;}
  finally{reader.releaseLock();reader=null;try{await port.close();}catch{}port=null;finishConnection(reason);}
}
function onBleData(event){decoder.push(event.target.value);}
function onBleDisconnected(){if(characteristic)characteristic.removeEventListener('characteristicvaluechanged',onBleData);characteristic=null;finishConnection('Bluetooth disconnected. Samples remain available for export.');}
$('ble').onclick=async()=>{
  busy=true;controls();
  try{device=await navigator.bluetooth.requestDevice({filters:[{services:[SERVICE]}]});device.addEventListener('gattserverdisconnected',onBleDisconnected,{once:true});const server=await device.gatt.connect();const service=await server.getPrimaryService(SERVICE);characteristic=await service.getCharacteristic(CHARACTERISTIC);beginConnection('BLE');characteristic.addEventListener('characteristicvaluechanged',onBleData);await characteristic.startNotifications();if(!device.gatt.connected)throw Error('Connection ended during setup.');}
  catch(e){if(device?.gatt.connected)device.gatt.disconnect();if(characteristic)characteristic.removeEventListener('characteristicvaluechanged',onBleData);characteristic=null;finishConnection('Bluetooth: '+e.message);}
  finally{busy=false;controls();}
};
$('demo').onclick=()=>{beginConnection('demo');let seq=0;const start=performance.now();demoTimer=setInterval(()=>{const t=(performance.now()-start)/1000;const adc=Array.from({length:16},(_,i)=>Math.round(32+3100*Math.max(0,Math.sin(t*3-i*.27))**4));onFrame({sequence:(seq++)%65536,timestampUs:Math.round(t*1e6)>>>0,timeMs:t*1000,missedFrames:0,adc});},20);};
function onFrame(frame){
  if(!mode)return;
  const now=performance.now();lastArrival=now;latest=frame;history.push({frame,received:now});history=history.filter(x=>now-x.received<=1500);rateWindow.push({t:frame.timeMs,seq:frame.sequence});while(rateWindow.length>2&&frame.timeMs-rateWindow[0].t>2000)rateWindow.shift();
  const span=frame.timeMs-rateWindow[0].t;$('rate').innerHTML=(span>0?((rateWindow.length-1)*1000/span).toFixed(1):'—')+' <em>Hz</em>';
  missing+=frame.missedFrames;$('gaps').textContent=missing;
  if(mode!=='demo')status(`Receiving ${mode} · Raw12 · scan ${frame.sequence}`);
  if(recording){if(session.firstTime===null)session.firstTime=frame.timeMs;const forces=frame.adc.map((raw,i)=>session.source==='demo'?{n:null,status:'demo'}:forceFor(i,raw,session.calibration));session.rows.push({timeMs:frame.timeMs-session.firstTime,sequence:frame.sequence,timestampUs:frame.timestampUs,missedFrames:frame.missedFrames,adc:[...frame.adc],forces});if(session.rows.length>=100000){stopRecording();$('record-status').textContent='100,000-sample limit reached. Export this session before recording more.';}}
  if(capture)capture.frames.push(frame);
}
function renderReadings(){
  const live=fresh();const forces=live?latest.adc.map((v,i)=>mode==='demo'?{n:null,status:'demo'}:forceFor(i,v)):null;
  $('readings').innerHTML=Array.from({length:16},(_,i)=>{const f=forces?.[i];const label=!f?'No live data':f.status==='valid'?f.n.toFixed(2)+' N':({uncalibrated:'Uncalibrated',outside_range:'Outside range',adc_rail:'ADC at rail',demo:'Demo signal'})[f.status];return `<div class="reading"><small>S${i}<span>ADC</span></small><b>${live?latest.adc[i]:'—'}</b><span>${label}</span></div>`;}).join('');
  const forceMode=$('display-mode').value==='force',limit=Number($('force-scale').value);
  $('force-scale-label').hidden=!forceMode;$('legend-min').textContent=forceMode?'0 N':'0 ADC';$('legend-max').textContent=forceMode?`${limit>0?limit:'—'} N`:'4095 ADC';
  if(!live)return;
  $('cal-live').textContent=latest.adc[Number($('sensor').value)];
  for(let i=0;i<16;i++){const value=forceMode?forces[i].n:latest.adc[i];const fraction=value===null||!(limit>0)&&forceMode?null:Math.min(1,Math.max(0,value/(forceMode?limit:4095)));const color=fraction===null||fraction<.015?'#d1d5db':`hsl(${120-120*fraction},100%,50%)`;$(`zone-${i}`).style.fill=color;$(`heat-${i}`).style.fill=color;$(`heat-${i}`).style.opacity=fraction===null?0:Math.min(fraction*1.7,1);}
  const allValid=forces.every(f=>f.status==='valid');const sum=allValid?forces.reduce((s,f)=>s+f.n,0):null;
  $('total').innerHTML=(sum===null?'—':sum.toFixed(1))+' <em>N</em>';
  if(allValid&&sum>0){const x=forces.reduce((s,f,i)=>s+f.n*coords[i].x,0)/sum,y=forces.reduce((s,f,i)=>s+f.n*coords[i].y,0)/sum;const marker=$('cop-marker');marker.setAttribute('transform',`translate(${x},${y})`);marker.style.opacity=1;$('cop-status').textContent=`Estimated CoP · X ${x.toFixed(1)}, Y ${y.toFixed(1)} SVG units · weighted by calibrated sensor forces.`;}
  else{$('cop-marker').style.opacity=0;$('cop-status').textContent=mode==='demo'?'Demo: synthetic signal colours; force and CoP are unavailable.':'CoP unavailable: all 16 channels must be calibrated and in range, with a positive total force.';}
}
function startRecording(){
  if(!fresh()||!mode)return;
  if(session?.rows.length&&!confirm('Start a new session? This replaces the session currently held in this tab. Export it first if needed.'))return;
  session={schema:'nova-session-v1',name:$('session-name').value.trim(),source:mode==='demo'?'demo':mode,startedUTC:new Date().toISOString(),protocol:PROTOCOL,calibration:JSON.parse(JSON.stringify(calibration)),firstTime:null,rows:[]};recording=true;$('record').textContent='Stop recording';$('record').classList.add('recording');renderCalibration();controls();
}
function stopRecording(){recording=false;if(session)session.stoppedUTC=new Date().toISOString();$('record').textContent='Start recording';$('record').classList.remove('recording');renderCalibration();controls();}
$('record').onclick=()=>recording?stopRecording():startRecording();
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function filename(ext){return `nova-${session.source.toLowerCase()}-${session.startedUTC.replace(/[:.]/g,'-')}.${ext}`;}
$('csv').onclick=()=>{if(!session?.rows.length)return;const header=['Time_ms','Sequence','BoardMicros','MissedFrames','Source','CalibrationID',...Array.from({length:16},(_,i)=>`ADC${i}`),...Array.from({length:16},(_,i)=>`F${i}_N`),...Array.from({length:16},(_,i)=>`Status${i}`)];const quote=x=>'"'+String(x??'').replaceAll('"','""')+'"';const rows=session.rows.map(r=>[r.timeMs.toFixed(3),r.sequence,r.timestampUs,r.missedFrames,session.source,session.calibration.id,...r.adc,...r.forces.map(f=>f.n===null?'':f.n.toFixed(4)),...r.forces.map(f=>f.status)].map(quote).join(','));download(filename('csv'),header.join(',')+'\n'+rows.join('\n'),'text/csv');};
$('session-json').onclick=()=>download(filename('json'),JSON.stringify(session),'application/json');
function renderCalibration(){const ch=Number($('sensor').value)||0;const points=calibration.channels[ch];$('cal-count').innerHTML=calibration.channels.filter(p=>p.length>=3).length+' <em>/ 16</em>';$('points').replaceChildren();for(let index=0;index<points.length;index++){const p=points[index],row=document.createElement('div');row.className='point';const text=document.createElement('span');text.textContent=`${p.adc.toFixed(1)} ADC → ${p.n.toFixed(2)} N`;row.append(text);const remove=document.createElement('button');remove.textContent='Remove';remove.disabled=recording||!!capture;remove.onclick=()=>{if(index===0&&points.length>1){$('cal-message').textContent='Remove the loaded points before removing the zero reference.';return;}points.splice(index,1);persist();};row.append(remove);$('points').append(row);}controls();}
for(let i=0;i<16;i++){const o=document.createElement('option');o.value=i;o.textContent=`S${i}${i===0?' · Big toe':i<4?' · Small toe':''}`;$('sensor').append(o);}
$('sensor').onchange=()=>{renderCalibration();renderReadings();};
$('capture').onclick=()=>{
  if(!fresh()||mode==='demo'||recording)return;
  const input=$('load').value,load=Number(input),n=load*({g:.00981,kg:9.81,N:1}[$('unit').value]);
  if(input===''||!Number.isFinite(n)||n<0){$('cal-message').textContent='Enter a non-negative measured reference load.';return;}
  capture={channel:Number($('sensor').value),n,frames:[],started:performance.now()};$('cal-message').textContent='Hold the reference load steady for one second…';renderCalibration();
  const current=capture;
  setTimeout(()=>{if(capture!==current)return;capture=null;const frames=current.frames;
    if(!fresh()||frames.length<10||frames.at(-1).timeMs-frames[0].timeMs<700||frames.slice(1).some(f=>f.missedFrames>0)){$('cal-message').textContent='Capture rejected: too few fresh samples or missing scans. Hold steady and retry.';renderCalibration();return;}
    const values=frames.map(f=>f.adc[current.channel]),mean=values.reduce((a,b)=>a+b)/values.length,sd=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length);
    if(values.some(v=>v>=4095)){$('cal-message').textContent='Capture rejected: ADC reached its upper rail.';renderCalibration();return;}
    const next=JSON.parse(JSON.stringify(calibration));next.channels[current.channel].push({adc:mean,n:current.n,sd,samples:values.length,capturedUTC:new Date().toISOString()});next.channels[current.channel].sort((a,b)=>a.adc-b.adc);
    try{validateCalibration(next);calibration=next;persist();$('cal-message').textContent=`Saved S${current.channel}: ${mean.toFixed(1)} ADC, SD ${sd.toFixed(1)} counts → ${current.n.toFixed(2)} N. Check repeatability before trusting this curve.`;}catch(e){$('cal-message').textContent='Point not saved: '+e.message;}renderCalibration();
  },1100);
};
$('export-cal').onclick=()=>download('nova-calibration.json',JSON.stringify(calibration,null,2),'application/json');
$('import-cal').onclick=()=>$('cal-file').click();
$('cal-file').onchange=async()=>{const file=$('cal-file').files[0];if(!file)return;try{if(recording||capture)throw Error('Stop recording/capture first.');if(file.size>1000000)throw Error('File is too large.');const next=validateCalibration(JSON.parse(await file.text()));if(!confirm('Replace all 16 channel calibrations with this file?'))return;calibration=next;try{localStorage.setItem(STORAGE,JSON.stringify(calibration));}catch{}renderCalibration();$('cal-message').textContent='Calibration imported. Confirm it belongs to this layer, board and loading setup.';}catch(e){$('cal-message').textContent='Import failed: '+e.message;}finally{$('cal-file').value='';}};
$('display-mode').onchange=renderReadings;$('force-scale').oninput=renderReadings;
$('support').textContent=[!navigator.serial?'Web Serial unavailable.':'',!navigator.bluetooth?'Web Bluetooth unavailable.':'','For hardware, use a supported desktop browser on localhost or HTTPS.'].filter(Boolean).join(' ');
window.addEventListener('beforeunload',e=>{if(recording||session?.rows.length){e.preventDefault();e.returnValue='';}});
setInterval(()=>{controls();if(fresh())renderReadings();else if(latest){$('rate').innerHTML='— <em>Hz</em>';$('cal-live').textContent='—';$('total').innerHTML='— <em>N</em>';$('cop-marker').style.opacity=0;for(let i=0;i<16;i++){$(`zone-${i}`).style.fill='#d1d5db';$(`heat-${i}`).style.opacity=0;}renderReadings();$('cop-status').textContent='CoP unavailable: the stream is stale.';status('No fresh Raw12 data. Check the firmware and connection.');}if(session)$('record-status').textContent=`${recording?'● Recording · ':''}${session.rows.length.toLocaleString()} samples · ${((session.rows.at(-1)?.timeMs??0)/1000).toFixed(1)} s${session.source==='demo'?' · DEMO':''}`;},150);
renderCalibration();renderReadings();controls();
