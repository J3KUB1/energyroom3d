/** Shared fake application (ObjectManager stand-in + ElectricalSystem + engine + ProjectManager) for integration tests. */
module.exports = function makeAppFactory(ctx){
  const $ = ctx.$;
  // ---- a fake ObjectManager with the same surface the app uses ------------------------------
  class FakeOM {
    constructor(){ this.instances = []; this.n = 1; this.onChange = ()=>{}; this.onDeviceAdded = ()=>{}; }
    getAll(room){ return room ? this.instances.filter(i=>i.roomId===room) : this.instances; }
    getDevices(){ return this.instances.filter(i=>i.kind==='device'); }
    getElectrical(){ return this.instances.filter(i=>i.kind==='electrical'); }
    find(id){ return this.instances.find(i=>i.id===id); }
    _mk(kind, def, pos, roomId){
      const inst = { id:'obj_'+(this.n++), kind, defId:def.id, def, roomId:roomId||'main', customName:null, position:{ x:pos?.x??1, y:pos?.y??0, z:pos?.z??1 },
        rotation:{x:0,y:0,z:0}, scale:{x:1,y:1,z:1}, connected:true, manualOverride:null, stats:{ energyYearKWh:0 },
        schedule: kind==='device' ? Object.assign({}, $('ScheduleManager').validateSchedule(def.defaultSchedule)) : null,
        runtime:{ state: kind==='device' ? (def.idleState||'off') : 'off', powerW:0, continuousOnMinutes:0, standbyMinutes:0 } };
      if (kind==='device') inst.plugTo = null;
      if (kind==='electrical'){ inst.circuitId = null; inst.plugTo = null; inst.enabled = true; }
      this.instances.push(inst); if (kind==='device') this.onDeviceAdded(inst); return inst;
    }
    addDevice(id,pos,room){ const d = $(`getDeviceDefinition('${id}')`); return d ? this._mk('device', d, pos, room) : null; }
    addFurniture(id,pos,room){ const d = $(`getFurnitureDefinition('${id}')`); return d ? this._mk('furniture', d, pos, room) : null; }
    addSolar(id,pos,room){ const d = $(`getSolarDefinition('${id}')`); return d ? this._mk('solar', d, pos, room) : null; }
    addBattery(id,pos,room){ const d = $(`getBatteryDefinition('${id}')`); return d ? this._mk('battery', d, pos, room) : null; }
    addElectrical(id,pos,room,rotY){ const d = $(`getElectricalDefinition('${id}')`); if (!d) return null;
      const p = { x:pos?.x??1, y:(pos?.y!=null&&pos.y!==0)?pos.y:d.defaultY, z:pos?.z??1 }; const i = this._mk('electrical', d, p, room); if (rotY) i.rotation.y = rotY; return i; }
    applyTransform(id,p,r,s){ const i = this.find(id); if (!i) return; if (p) i.position = {...p}; if (r) i.rotation = {...r}; if (s) i.scale = {...s}; }
    rename(id,n){ const i=this.find(id); if(i) i.customName=n; } setConnected(id,v){ this.find(id).connected=v; } setManualOverride(id,v){ this.find(id).manualOverride=v; }
    setSchedule(id,s){ this.find(id).schedule=$('ScheduleManager').validateSchedule(s); } remove(id){ this.instances = this.instances.filter(i=>i.id!==id); } clear(){ this.instances = []; }
  }

  let __appCounter = 0;
  function app(){
    const id = ++__appCounter, G = '__a' + id;               // one global per app instance: two apps must never share closures
    const a = { om:new FakeOM(), house:$('defaultHouseState()'), energy:$('freshEnergySettings()'), events:[] };
    a.energy.batteryReservePct = 0;
    ctx[G] = a;
    a.el = $(`new ElectricalSystem({ getElements:()=>${G}.om.getElectrical(), getDevices:()=>${G}.om.getDevices(),
      getRooms:()=>${G}.house.rooms.map(r=>({ id:r.id, name:r.name, type:r.type, offsetX:r.offsetX||0, offsetZ:r.offsetZ||0, elevation:(typeof BuildingModel!=='undefined' && ${G}.house.levels) ? BuildingModel.elevation(${G}.house, r) : 0, width:r.settings.width, length:r.settings.length, height:r.settings.height })),
      createElement:(d,r,p,ry)=>${G}.om.addElectrical(d,p,r,ry), removeElement:id=>${G}.om.remove(id), onEvent:e=>${G}.events.push(e) })`);
    a.om.onDeviceAdded = (inst)=>a.el.autoPlug(inst);
    a.sim = $(`new SimulationEngine({ getInstances:()=>${G}.om.getDevices(), getSolarInstances:()=>[], getBatteryInstances:()=>[], getSettings:()=>${G}.energy, getStartDate:()=>new Date(2026,0,15), electrical:${G}.el })`);
    a.pm = $(`new ProjectManager({ objectManager:${G}.om, getHouseState:()=>${G}.house, setHouseState:h=>{${G}.house=h}, getEnergySettings:()=>${G}.energy, setEnergySettings:e=>{${G}.energy=e},
      automationManager:{ rules:[] }, simulationEngine:null, rebuildHouse:()=>{}, electrical:${G}.el })`);
    return a;
  }
  function furnish(a){
    const W = a.house.rooms[0].settings.width;
    a.om.addDevice('router',{x:0.5,y:0,z:0.4},'main'); a.om.addDevice('tv_55',{x:3,y:0.4,z:0.4},'main'); a.om.addDevice('fridge',{x:W-0.5,y:0,z:1},'main');
    a.om.addDevice('ceiling_lamp',{x:2,y:0,z:2},'main'); a.om.addDevice('ceiling_lamp',{x:2,y:0,z:2},'garage');
  }


  return { FakeOM, app, furnish };
};
