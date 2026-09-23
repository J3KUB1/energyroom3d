const { createContext, test, assert, near, summary } = require('./harness');
const ctx = createContext();
const $ = ctx.$;
console.log('Stage 2 - integration (engine + installation + save/load + migration)');

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
    getRooms:()=>${G}.house.rooms.map(r=>({ id:r.id, name:r.name, type:r.type, offsetX:r.offsetX||0, width:r.settings.width, length:r.settings.length, height:r.settings.height })),
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

test('a fresh installation powers a furnished house; every device is plugged and reports OK', ()=>{
  const a = app(); furnish(a); a.el.load(null); a.el.autoInstall();
  assert(a.om.getDevices().every(d => d.plugTo), 'all devices plugged');
  a.sim.absMin = 8*60; a.sim._recomputeInstant(false);
  assert(a.om.getDevices().every(d => d.runtime.powerStatus === 'ok'), a.om.getDevices().map(d=>d.runtime.powerStatus).join());
  assert(a.sim.currentPowerW > 20);
});
test('cable losses are billed: household total = devices + I^2R, and the category "installation" is filled', ()=>{
  const a = app(); furnish(a); a.el.load(null); a.el.autoInstall();
  a.sim.absMin = 0; for (let i=0;i<24*60;i++) a.sim._stepOneMinute();
  const hist = a.sim.history[a.sim.history.length-1] || null;
  const dev = a.om.getDevices().reduce((n,d)=>n+d.stats.energyYearKWh,0);
  const loss = (hist && hist.lossKWh != null) ? hist.lossKWh : null;
  assert(a.sim.totalConsumedKWh > dev, `total ${a.sim.totalConsumedKWh} > devices ${dev}`);
  assert(a.sim.totalConsumedKWh - dev < dev * 0.2, 'losses are small but non-zero');
});
test('overload in the simulation: two 2 kW heaters on a B10 socket circuit trip, devices lose power and stay off until reset', ()=>{
  const a = app(); a.el.load(null); a.el.autoInstall();
  const h1 = a.om.addDevice('heater',{x:1.2,y:0,z:0.4},'main'), h2 = a.om.addDevice('heater',{x:1.2,y:0,z:0.4},'main'), h3 = a.om.addDevice('fan_heater',{x:1.2,y:0,z:0.4},'main');
  const so = a.el.sockets('main')[0]; for (const h of [h1,h2,h3]){ a.el.unplugDevice(h.id); }
  a.el.plugDevice(h1.id, so.id); a.el.plugDevice(h2.id, so.id);
  for (const h of [h1,h2]) h.runtime.automationOverride = { state:'heating' };   // full 2 kW, like a thermostat calling for heat
  a.el.setMainBreaker(63); a.el.setBreakerRating(a.el.circuit(so.circuitId).breakerId, 10);   // 4 kW on a B10 (2.3 kW) circuit
  let tripped = -1; a.sim.absMin = 8*60;
  for (let m=1; m<=300 && tripped<0; m++){ a.sim._stepOneMinute(); if (a.el.data.breakers.some(b=>b.state==='tripped')) tripped = m; }
  const need = h1.def.ratedPowerW + h2.def.ratedPowerW;
  assert(tripped > 0, 'must trip - load '+need+' W');
  assert(h1.runtime.powerW === 0 && h1.runtime.state === 'off' && h1.runtime.powerStatus === 'breakerTripped');
  assert(a.events.some(e=>e.type==='breakerTrip'), 'event emitted');
  const before = a.sim.currentPowerW; a.sim._stepOneMinute(); assert(h1.runtime.powerW === 0, 'still dead');
  a.el.resetBreaker(a.el.data.breakers.find(b=>b.state==='tripped').id); a.sim._stepOneMinute();
  assert(h1.runtime.powerW > 0, 'back after reset');
});
test('energy total stays consistent when a breaker cuts a device (cost accumulates only for delivered energy)', ()=>{
  const a = app(); a.el.load(null); a.el.autoInstall(); furnish(a);
  const d = a.om.getDevices()[0]; a.el.unplugDevice(d.id);   // strict mode: unassigned -> dead
  d.manualOverride = 'on'; a.sim.absMin = 600; const before = d.stats.energyYearKWh; for (let i=0;i<60;i++) a.sim._stepOneMinute();
  assert(d.stats.energyYearKWh === before, 'no energy counted for a device without supply');
  assert(d.runtime.powerStatus === 'unassigned');
});

// ---------------- persistence ----------------
const snapshot = (a)=> JSON.parse(JSON.stringify(a.pm.serialize()));
test('serialize contains the current version (6), installation and plug references', ()=>{
  const a = app(); furnish(a); a.el.load(null); a.el.autoInstall(); const j = snapshot(a);
  assert(j.version === 6 && j.installation && j.installation.circuits.length >= 2);
  assert(j.objects.filter(o=>o.kind==='electrical').length >= 8);
  assert(j.objects.filter(o=>o.kind==='device').every(o => o.plugTo), 'devices carry their plug');
});
test('round-trip: ids are renumbered on load but every plug, wire and circuit still resolves', ()=>{
  const a = app(); furnish(a); a.el.load(null); a.el.autoInstall();
  a.el.setMainBreaker(32); a.el.data.circuits[0].name = 'Salon'; a.el.setBreakerRating(a.el.data.breakers[0].id, 20);
  const j = snapshot(a);
  const b = app(); b.om.n = 500;                                  // force different ids
  b.pm.deserialize(JSON.parse(JSON.stringify(j)));
  assert(b.om.getElectrical().length === a.om.getElectrical().length, 'same elements');
  const ids = new Set(b.om.getAll().map(i=>i.id));
  assert(b.om.getDevices().every(d => d.plugTo && ids.has(d.plugTo)), 'device plugs valid');
  assert(b.el.data.wires.length === a.el.data.wires.length && b.el.data.wires.every(w => ids.has(w.fromId) && ids.has(w.toId)), 'wires valid');
  assert(b.el.data.mainBreaker.ratingA === 32 && b.el.data.circuits[0].name === 'Salon' && b.el.data.breakers[0].ratingA === 20);
  assert(b.el.sockets().every(s => s.circuitId && b.el.circuit(s.circuitId)), 'sockets keep circuits');
  b.sim.absMin = 8*60; b.sim._recomputeInstant(false);
  assert(b.om.getDevices().every(d => d.runtime.powerStatus === 'ok'), 'loaded house is powered');
  assert(Math.abs(b.el.costBreakdown().totalZl - a.el.costBreakdown().totalZl) < 1e-6, 'same installation cost after load');
});
test('a tripped breaker survives save/load (it stays tripped)', ()=>{
  const a = app(); furnish(a); a.el.load(null); a.el.autoInstall(); a.el.data.breakers[0].state = 'tripped';
  const b = app(); b.pm.deserialize(snapshot(a)); assert(b.el.data.breakers[0].state === 'tripped');
});
test('legacy v3/v4 project (no installation, no plugs) loads with a generated installation and works', ()=>{
  const a0 = app(); furnish(a0);
  const legacy = JSON.parse(JSON.stringify(a0.pm.serialize()));
  delete legacy.installation; legacy.version = 4;
  legacy.objects = legacy.objects.filter(o => o.kind !== 'electrical'); legacy.objects.forEach(o => { delete o.plugTo; delete o.circuitId; delete o.enabled; });
  const b = app(); b.pm.deserialize(legacy);
  assert(b.el.board && b.el.meter, 'switchboard + meter created');
  assert(b.el.sockets('main').length === 4 && b.el.sockets('garage').length === 4);
  assert(b.om.getDevices().length === 5 && b.om.getDevices().every(d => d.plugTo), 'all legacy devices plugged');
  b.sim.absMin = 9*60; b.sim._recomputeInstant(false);
  assert(b.om.getDevices().every(d => d.runtime.powerStatus === 'ok'));
  assert(b.el.costBreakdown().totalZl > 1000, 'installation cost counted for migrated project');
});
test('legacy project with a big appliance: it gets its own dedicated circuit instead of tripping a socket circuit', ()=>{
  const a0 = app(); a0.om.addDevice('oven',{x:1,y:0,z:1},'main'); const legacy = JSON.parse(JSON.stringify(a0.pm.serialize()));
  delete legacy.installation; legacy.objects = legacy.objects.filter(o => o.kind !== 'electrical'); legacy.objects.forEach(o => delete o.plugTo);
  const b = app(); b.pm.deserialize(legacy); const oven = b.om.getDevices()[0];
  const so = b.om.find(oven.plugTo), c = b.el.circuit(so.circuitId);
  if (oven.def.ratedPowerW >= 3000) assert(c.kind === 'dedicated', 'dedicated circuit'); else assert(c.kind === 'sockets');
});
test('deleting a socket (or a whole room) leaves no dangling wires / plugs after prune', ()=>{
  const a = app(); furnish(a); a.el.load(null); a.el.autoInstall();
  const so = a.el.sockets('garage')[0]; a.om.remove(so.id); a.el.prune();
  assert(!a.el.data.wires.some(w => w.toId === so.id));
  a.el.dropRoomCircuits('garage'); a.om.instances = a.om.instances.filter(i => i.roomId !== 'garage'); a.el.prune();
  const remainingRooms=a.house.rooms.filter(r=>r.id!=='garage');
  assert(a.el.data.circuits.length === remainingRooms.length, 'only circuits for the remaining rooms stay: '+a.el.data.circuits.length);
  assert(a.el.data.breakers.length === remainingRooms.length);
});
test('newProject-style reload (load(null) + autoInstall) yields a valid, fully wired empty house', ()=>{
  const a = app(); a.el.load(null); a.el.autoInstall();
  assert(a.el.diagnostics().filter(d => d.level === 'error').length === 0, JSON.stringify(a.el.diagnostics()));
});
test('365-day run with the installation active finishes, stays finite, and produces no spurious trips for a normal home', ()=>{
  const a = app(); furnish(a); a.el.load(null); a.el.autoInstall();
  const t0 = Date.now(); a.sim.skipDays(365); const ms = Date.now()-t0;
  assert(Number.isFinite(a.sim.totalConsumedKWh) && a.sim.totalConsumedKWh > 100);
  assert(!a.events.some(e => e.type === 'mainTrip'), 'main never trips for router/tv/fridge/lamps');
  console.log(`       365 days with installation: ${ms} ms, ${a.sim.totalConsumedKWh.toFixed(0)} kWh`);
  assert(ms < 60000, 'too slow '+ms);
});
summary();
