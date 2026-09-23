const { createContext, test, assert, near, summary } = require('./harness');
const ctx = createContext();
const $ = ctx.$;
const { app } = require('./fakeapp')(ctx);
console.log('Stage 3 - integration (designer data + save/load + installation across storeys)');
const snapshot = a => JSON.parse(JSON.stringify(a.pm.serialize()));

function designedHouse(a){
  const h = a.house; ctx.__h = h; $('BuildingModel.migrateHouse(__h)');
  const lv = $('BuildingModel.addLevel(__h)'); h.rooms.push({ id:'up', name:'Sypialnia', type:'room', settings:$('({...getRoomTypeMeta("room").defaults})'), offsetX:0, offsetZ:0, levelId:lv.id });
  h.rooms[2].settings.width = 7; $('BuildingModel.migrateHouse(__h)'); h.layout = 'free';
  $('BuildingModel.addStair(__h,{roomId:"main",x:1.2,z:4.6,dir:"N"})');
  const r = h.rooms[0].design; r.walls.N.insulationCm = 18; r.walls.N.material = 'aac';
  h.rooms[1].design.roof.pitchDeg = 25; h.rooms[1].design.roof.type = 'gable';
  $('BuildingModel.addPartition(__h,"main",{x1:3,z1:0.1,x2:3,z2:4.9})');
  return { h, lv };
}

test('save format is version 6 and carries levels, designs, stairs, layout mode', ()=>{
  const a = app(); designedHouse(a); a.el.load(null); a.el.autoInstall(); const j = snapshot(a);
  assert(j.version === 6, 'version '+j.version); assert(j.house.levels.length === 2 && j.house.stairs.length === 1 && j.house.layout === 'free');
  assert(j.house.rooms.every(r => r.design && r.levelId)); assert(j.house.rooms[0].design.partitions.length === 1);
});
test('round-trip keeps every design decision (walls, openings, roof, partitions, stairs, levels)', ()=>{
  const a = app(); designedHouse(a); a.el.load(null); a.el.autoInstall();
  const before = JSON.parse(JSON.stringify(a.house)); const b = app(); b.pm.deserialize(snapshot(a));
  assert(JSON.stringify(b.house.levels) === JSON.stringify(before.levels));
  assert(JSON.stringify(b.house.stairs) === JSON.stringify(before.stairs));
  for (let i = 0; i < before.rooms.length; i++) assert(JSON.stringify(b.house.rooms[i].design) === JSON.stringify(before.rooms[i].design), 'design of room '+i);
  assert(b.house.rooms[0].design.walls.N.material === 'aac' && b.house.rooms[1].design.roof.type === 'gable');
});
test('the derived building (envelopes, occluders) is identical after a reload', ()=>{
  const a = app(); designedHouse(a); a.el.load(null); a.el.autoInstall(); const b = app(); b.pm.deserialize(snapshot(a));
  ctx.__a = a.house; ctx.__b = b.house;
  const ea = $('BuildingModel.envelope(__a, __a.rooms[0])'), eb = $('BuildingModel.envelope(__b, __b.rooms[0])');
  near(ea.ua.total, eb.ua.total, 1e-9); near(ea.thermalMassJK, eb.thermalMassJK, 1e-6);
  assert($('BuildingModel.occluders(__a)').length === $('BuildingModel.occluders(__b)').length);
});
test('a pre-designer (v5) project loads: one level, legacy designs generated, rooms unchanged, layout auto', ()=>{
  const a0 = app(); const legacy = snapshot(a0); legacy.version = 5;
  delete legacy.house.levels; delete legacy.house.stairs; delete legacy.house.layout; delete legacy.house.nextId; delete legacy.house.levelView; delete legacy.house.activeLevelId;
  legacy.house.rooms.forEach(r => { delete r.design; delete r.levelId; delete r.offsetZ; });
  const b = app(); b.pm.deserialize(legacy);
  assert(b.house.levels.length === 1 && b.house.layout === 'auto' && b.house.rooms.every(r => r.levelId === 'l0' && r.design));
  assert(b.house.rooms[1].design.roof.type === 'mono' && b.house.rooms[1].design.openings.some(o => o.type === 'garage'), 'garage keeps its roof and door');
  near(b.house.rooms[0].offsetX, 0); near(b.house.rooms[1].offsetX, 8.4);
});
test('a much older project without a house object falls back to a valid default house', ()=>{
  const a0 = app(); const j = snapshot(a0); delete j.house; j.version = 2; const b = app(); b.pm.deserialize(j);
  assert(b.house.rooms.length === 2 && b.house.levels.length === 1);
});
test('installation on an upper storey: sockets get wired, cable is longer than on the ground floor, devices are powered', ()=>{
  const a = app(); designedHouse(a); a.om.addDevice('router',{x:0.5,y:0,z:0.4},'main'); a.om.addDevice('tv_55',{x:3,y:0.4,z:0.4},'up'); a.om.addDevice('ceiling_lamp',{x:2,y:0,z:2},'up');
  a.el.load(null); a.el.autoInstall();
  const up = a.el.sockets('up'), ground = a.el.sockets('main'); assert(up.length === 4 && ground.length === 4);
  assert(up.every(s => a.el.wireOf(s.id)), 'upper sockets wired to the switchboard');
  const lenUp = a.el.wireLengthM(a.el.wireOf(up[0].id)), pa = a.el.wirePath(a.el.wireOf(up[0].id)); const direct = Math.hypot(pa[0].x - pa[pa.length-1].x, pa[0].y - pa[pa.length-1].y, pa[0].z - pa[pa.length-1].z);
  assert(lenUp >= direct && direct > 1.8, `cable ${lenUp} must be at least the straight distance ${direct} (socket is a storey higher)`);
  a.sim.absMin = 9*60; a.sim._recomputeInstant(false); assert(a.om.getDevices().every(d => d.runtime.powerStatus === 'ok'), a.om.getDevices().map(d => d.runtime.powerStatus).join());
  const path = a.el.wirePath(a.el.wireOf(up[0].id)); assert(path.some(p => p.y > 3.0) && path.some(p => p.y < 3.0), 'the route climbs between storeys');
});
test('electrical positions use offsetZ and elevation: moving a room north/up changes wire length', ()=>{
  const a = app(); designedHouse(a); a.el.load(null); a.el.autoInstall();
  const s = a.el.sockets('garage')[0], w = a.el.wireOf(s.id), l0 = a.el.wireLengthM(w);
  a.house.rooms[1].offsetZ = 6; const l1 = a.el.wireLengthM(w); assert(l1 > l0 + 4, `${l0} -> ${l1}`);
});
test('deleting the upper room: its circuit goes away and the orphaned stairs are flagged', ()=>{
  const a = app(); designedHouse(a); a.el.load(null); a.el.autoInstall(); const nBefore = a.el.data.circuits.length;
  a.el.dropRoomCircuits('up'); a.om.instances = a.om.instances.filter(i => i.roomId !== 'up'); a.house.rooms = a.house.rooms.filter(r => r.id !== 'up'); ctx.__h = a.house; $('BuildingModel.migrateHouse(__h)'); a.el.prune();
  assert(a.el.data.circuits.length === nBefore - 1, 'circuit of the deleted room removed');
  ctx.__h = a.house; assert($('BuildingModel.validate(__h)').some(i => i.code === 'stairNoTarget'), 'the stair now leads nowhere and the designer says so');
});
test('365 days on a two-storey house with installation stays finite and trip-free for a normal load', ()=>{
  const a = app(); designedHouse(a); a.om.addDevice('router',{x:0.5,y:0,z:0.4},'main'); a.om.addDevice('fridge',{x:6,y:0,z:1},'main'); a.om.addDevice('ceiling_lamp',{x:2,y:0,z:2},'up');
  a.el.load(null); a.el.autoInstall(); const t0 = Date.now(); a.sim.skipDays(365); const ms = Date.now() - t0;
  assert(Number.isFinite(a.sim.totalConsumedKWh) && a.sim.totalConsumedKWh > 50 && !a.events.some(e => e.type === 'mainTrip'));
  console.log(`       365 days, 2 storeys: ${ms} ms, ${a.sim.totalConsumedKWh.toFixed(0)} kWh`); assert(ms < 60000);
});
summary();
