// Read-only CDC ACM transport for the Seeed XIAO's existing TinyUSB Serial port.
// Used only when native Web Serial is unavailable (for example Android Chrome).
// CDC requests: SET_LINE_CODING (0x20), SET_CONTROL_LINE_STATE (0x22).
class InsoleUsbCdcPort {
  constructor(device) { this.device=device;this.readable=null;this.running=false;this.closing=null; }
  static async requestPort() {
    const device=await navigator.usb.requestDevice({filters:[{vendorId:0x2886}]});
    return new InsoleUsbCdcPort(device);
  }
  findInterfaces() {
    for(const configuration of this.device.configurations){
      for(const control of configuration.interfaces){
        const controlAlt=control.alternates.find(a=>a.interfaceClass===2&&a.interfaceSubclass===2);
        if(!controlAlt)continue;
        // The XIAO TinyUSB CDC function pairs adjacent control/data interfaces.
        const data=configuration.interfaces.find(i=>i.interfaceNumber===control.interfaceNumber+1);
        const dataAlt=data?.alternates.find(a=>a.interfaceClass===10&&a.endpoints.some(e=>e.type==='bulk'&&e.direction==='in'));
        if(dataAlt){return {configuration,control,controlAlt,data,dataAlt,
          endpoint:dataAlt.endpoints.find(e=>e.type==='bulk'&&e.direction==='in')};}
      }
    }
    throw new Error('No compatible XIAO serial interface. Start the normal InsoleRaw12 sketch, not the bootloader.');
  }
  async open({baudRate=115200}={}) {
    try{
      const selected=this.findInterfaces();
      await this.device.open();
      if(this.device.configuration?.configurationValue!==selected.configuration.configurationValue)
        await this.device.selectConfiguration(selected.configuration.configurationValue);
      await this.device.claimInterface(selected.control.interfaceNumber);
      await this.device.claimInterface(selected.data.interfaceNumber);
      await this.device.selectAlternateInterface(selected.control.interfaceNumber,selected.controlAlt.alternateSetting);
      await this.device.selectAlternateInterface(selected.data.interfaceNumber,selected.dataAlt.alternateSetting);
      const line=new Uint8Array(7);new DataView(line.buffer).setUint32(0,baudRate,true);line[6]=8;
      const setup={requestType:'class',recipient:'interface',index:selected.control.interfaceNumber};
      for(const [request,value,payload] of [[0x20,0,line],[0x22,1,new Uint8Array()]]){
        const result=await this.device.controlTransferOut({...setup,request,value},payload);
        if(result.status!=='ok')throw new Error(`USB serial setup failed (${result.status}).`);
      }
      // DTR above is essential: firmware's `if (Serial)` gates USB output.
      this.running=true;
      this.readable=new ReadableStream({
        pull:async controller=>{
          try{
            const result=await this.device.transferIn(selected.endpoint.endpointNumber,selected.endpoint.packetSize);
            if(!this.running)return;
            if(result.status!=='ok')throw new Error(`USB read failed (${result.status}).`);
            if(result.data?.byteLength)controller.enqueue(new Uint8Array(result.data.buffer,result.data.byteOffset,result.data.byteLength).slice());
          }catch(error){if(this.running){this.running=false;controller.error(error);}}
        },
        // Closing the USB device cancels an outstanding transferIn, including at idle.
        cancel:()=>this.close(),
      },{highWaterMark:0});
    }catch(error){await this.close().catch(()=>{});throw error;}
  }
  async close() {
    this.running=false;
    if(!this.closing)this.closing=(async()=>{if(this.device.opened)await this.device.close();})();
    await this.closing;
  }
}
