// Bounded buffering: close each CSV segment so completed data survives tab loss.
class DiskRecorder {
  constructor(directory, metadata, header, onError) {
    this.directory=directory; this.metadata=metadata; this.header=header; this.onError=onError;
    this.buffer=[]; this.queue=[]; this.parts=[]; this.nextPart=1; this.work=null;
    this.error=null; this.closed=false; this.total=0; this.saved=0;
  }
  async writeFile(name, text) {
    const handle=await this.directory.getFileHandle(name,{create:true});
    const stream=await handle.createWritable();
    try { await stream.write(text); await stream.close(); }
    catch(error) { try { await stream.abort(); } catch {} throw error; }
  }
  async writeMetadata(state) {
    await this.writeFile('session.json',JSON.stringify({...this.metadata,state,
      samplesReceived:this.total,samplesSaved:this.saved,segments:this.parts,
      stoppedUTC:this.closed?new Date().toISOString():null},null,2));
  }
  async initialize() { await this.writeMetadata('recording'); }
  append(line) {
    if(this.error||this.closed)return;
    this.buffer.push(line);this.total++;
    if(this.buffer.length>=6000)this.flush();
  }
  fail(error) {
    if(this.error)return;
    this.error=error;
    queueMicrotask(()=>this.onError(error));
  }
  flush() {
    if(this.error||!this.buffer.length)return;
    if(this.queue.length>=2){this.fail(new Error('Disk cannot keep up. Recording stopped; download pending data.'));return;}
    this.queue.push({name:`part-${String(this.nextPart++).padStart(5,'0')}.csv`,lines:this.buffer});
    this.buffer=[];
    if(!this.work)this.work=this.drain().finally(()=>{this.work=null;});
  }
  async drain() {
    try {
      while(this.queue.length&&!this.error) {
        const part=this.queue[0];
        await this.writeFile(part.name,this.header+'\n'+part.lines.join('\n')+'\n');
        this.saved+=part.lines.length;
        this.parts.push({file:part.name,samples:part.lines.length});
        this.queue.shift();
        await this.writeMetadata('recording');
      }
    } catch(error) { this.fail(error); }
  }
  async finish() {
    this.closed=true;this.flush();
    if(this.work)await this.work;
    if(!this.error)try{await this.writeMetadata('complete');}catch(error){this.fail(error);}
  }
  pendingCount() { return this.queue.reduce((n,p)=>n+p.lines.length,0)+this.buffer.length; }
  recoveryCSV() {
    const lines=[...this.queue.flatMap(p=>p.lines),...this.buffer];
    return lines.length?this.header+'\n'+lines.join('\n')+'\n':null;
  }
}
