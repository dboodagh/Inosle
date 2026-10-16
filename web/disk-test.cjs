const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
vm.runInThisContext(fs.readFileSync(__dirname+'/disk-recorder.js','utf8'));
function directory(failName=null){
 const files=new Map();
 return {files,async getFileHandle(name){return {async createWritable(){let text='';return {async write(s){if(name===failName)throw Error('Disk full');text=s;},async close(){files.set(name,text);},async abort(){}};}};}};
}
(async()=>{
 const dir=directory();const recorder=new DiskRecorder(dir,{calibration:{id:'test'}},'Time_ms,ADC0',e=>{throw e;});
 await recorder.initialize();
 // 23 minutes of 200 Hz samples, with I/O allowed to drain between segments.
 for(let i=0;i<276000;i++){recorder.append(`${i*5},${i%4096}`);if((i+1)%6000===0)await recorder.work;}
 await recorder.finish();assert.equal(recorder.saved,276000);assert.equal(recorder.pendingCount(),0);assert.equal(recorder.parts.length,46);
 const lines=recorder.parts.flatMap(p=>dir.files.get(p.file).trim().split('\n').slice(1));
 assert.equal(lines.length,276000);for(let i=0;i<lines.length;i++)assert.equal(lines[i],`${i*5},${i%4096}`);
 assert.equal(JSON.parse(dir.files.get('session.json')).state,'complete');
 // Failed writes preserve the unsaved data and do not claim it was saved.
 const bad=directory('part-00001.csv');let failure='';const failed=new DiskRecorder(bad,{},'h',e=>{failure=e.message;});
 await failed.initialize();failed.append('one');failed.flush();await failed.work;await failed.finish();
 assert.equal(failed.saved,0);assert.equal(failure,'Disk full');assert.equal(failed.recoveryCSV(),'h\none\n');
 // Backpressure stops recording with bounded, recoverable pending data.
 let release;const gate=new Promise(resolve=>release=resolve);
 const slow={async getFileHandle(){return {async createWritable(){return {async write(){await gate;},async close(){},async abort(){}};}};}};
 const queued=new DiskRecorder(slow,{},'h',()=>{});
 for(let i=0;i<18000;i++)queued.append(String(i));
 assert(queued.error);assert.equal(queued.pendingCount(),18000);queued.append('not accepted');assert.equal(queued.total,18000);
 release();await queued.work;await queued.finish();assert.equal(queued.saved+queued.pendingCount(),18000);
 console.log('PASS: 276,000 samples / 46 finalized CSV segments, exact order and timestamps, bounded memory, disk-full recovery, slow-disk backpressure.');
})().catch(e=>{console.error(e);process.exit(1);});
