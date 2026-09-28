/** RoomBuilder against a recording THREE stub: verifies the generated scene structure (walls cut around openings,
 *  slabs with stairwell holes, roofs, gable ends, outdoor rooms, storey elevations) without a GPU. */
const { createContext, test, assert, near, summary, ROOT } = require('./harness');
const fs = require('fs'), vm = require('vm');
const ctx = createContext();
class V { constructor(x,y,z){ this.x=x||0; this.y=y||0; this.z=z||0; } set(x,y,z){ this.x=x; this.y=y; this.z=z; return this; } }
class O3 { constructor(){ this.children=[]; this.parent=null; this.visible=true; this.position=new V(); this.rotation=new V(); this.scale=new V(1,1,1); this.userData={}; this.name=''; }
  add(c){ this.children.push(c); c.parent=this; return this; } remove(c){ this.children=this.children.filter(x=>x!==c); }
  traverse(f){ f(this); this.children.forEach(c=>c.traverse&&c.traverse(f)); } }
const geo = name => class { constructor(...a){ this.type=name; this.args=a; } dispose(){} };
const mat = name => class { constructor(o){ this.type=name; Object.assign(this, o||{}); this.opacity = this.opacity == null ? 1 : this.opacity; } dispose(){} };
const tex = { clone(){ return { repeat:{ set(){} }, needsUpdate:false, clone(){ return tex.clone(); } }; }, repeat:{ set(){} } };
ctx.THREE = {
  Group: class extends O3 {}, Mesh: class extends O3 { constructor(g,m){ super(); this.geometry=g; this.material=m; } },
  BoxGeometry:geo('Box'), CylinderGeometry:geo('Cylinder'), ExtrudeGeometry:geo('Extrude'), BufferGeometry: class { setAttribute(){ } dispose(){} }, Float32BufferAttribute: class { constructor(a){ this.array=a; } },
  Shape: class { moveTo(){} lineTo(){} closePath(){} },
  MeshStandardMaterial:mat('Std'), LineBasicMaterial:mat('Line'), LineSegments: class extends O3 { constructor(g,m){ super(); this.geometry=g; this.material=m; } },
  Color: class { constructor(c){ this.c=c; } }, Vector3: V, MathUtils:{ degToRad:d=>d*Math.PI/180 },
};
ctx.TextureFactory = new Proxy({}, { get:()=>()=>tex });
console.log('RoomBuilder scene structure');
const $ = ctx.$;
function build(house){ ctx.__house = house; const scene = new O3(); scene.add = O3.prototype.add; ctx.__scene = scene; const rb = $('new RoomBuilder(__scene)'); rb.build(house); return rb; }
function room(id, type, x, z, level, w, l, h){ const m = $('({...getRoomTypeMeta("'+type+'").defaults})'); return { id, name:id, type, settings:Object.assign(m, w?{width:w}:{}, l?{length:l}:{}, h?{height:h}:{}), offsetX:x||0, offsetZ:z||0, levelId:level||'l0' }; }
function houseOf(rooms){ const h = { rooms, activeRoomId:rooms[0].id }; ctx.__h = h; $('BuildingModel.migrateHouse(__h)'); return h; }
const find = (o, pred, out=[]) => { o.traverse(x => { if (pred(x)) out.push(x); }); return out; };
const wall = (rb, room, side) => find(rb.roomGroups[room], x => x.name === 'Wall:' + side)[0];
const boxes = g => find(g, x => x.geometry && x.geometry.type === 'Box');

test('legacy two-room house: same walls/openings as before (N window, E door, garage door on W, front open)', ()=>{
  const h = houseOf([ room('main','room',0), room('garage','garage',8.4) ]); const rb = build(h);
  assert(wall(rb,'main','N') && wall(rb,'main','E') && wall(rb,'main','W'), 'N/E/W walls exist');
  assert(!wall(rb,'main','S'), 'front wall stays open for the dollhouse view');
  assert(Object.keys(rb.openingParts).length >= 5, 'window, door, garage door, skylight, garage side door: '+Object.keys(rb.openingParts));
  const kinds = Object.values(rb.openingParts).map(p => p.kind); assert(kinds.includes('garage') && kinds.includes('window') && kinds.includes('door'));
});
test('a wall with one window is built from 4 solid pieces (before, below sill, above lintel, after)', ()=>{
  const h = houseOf([ room('a','room',0) ]); h.rooms[0].design.openings = h.rooms[0].design.openings.filter(o => o.type === 'window');
  const rb = build(h), n = wall(rb,'a','N');
  const solid = boxes(n).filter(m => m.material && m.material.roughness !== undefined && m.geometry.args[2] === 0.1);   // wall pieces have depth = wall thickness
  assert(solid.length === 4, 'solid pieces '+solid.length);
  const heights = solid.map(m => +m.geometry.args[1].toFixed(2)).sort((a,b)=>a-b);
  near(heights[0], 2.8-0.9-1.3, 1e-9); near(heights[1], 0.9, 1e-9);
});
test('opening a door does not rebuild: setOpening rotates the leaf pivot, garage door scales, window sash swings', ()=>{
  const h = houseOf([ room('g','garage',0) ]); const rb = build(h);
  const d = h.rooms[0].design.openings.find(o => o.type === 'door'), gd = h.rooms[0].design.openings.find(o => o.type === 'garage'), w = h.rooms[0].design.openings.find(o => o.type === 'window');
  rb.setOpening('g', d.id, 1); near(rb.openingParts['g:'+d.id].pivot.rotation.y, -Math.PI/2);
  rb.setOpening('g', gd.id, 1); near(rb.openingParts['g:'+gd.id].leaf.scale.y, 0.06, 1e-9); rb.setOpening('g', gd.id, 0); near(rb.openingParts['g:'+gd.id].leaf.scale.y, 1);
  rb.setOpening('g', w.id, 0.5); assert(rb.openingParts['g:'+w.id].pivot.rotation.y < 0);
});
test('shared wall between flush rooms is drawn once (owner = smaller id)', ()=>{
  const h = houseOf([ room('a','room',0), room('b','room',7.0) ]); const rb = build(h);
  assert(wall(rb,'a','E') && !wall(rb,'b','W'), 'owner a draws the shared wall, b does not');
  h.rooms[0].design.openings = h.rooms[0].design.openings.filter(o => o.wall !== 'E');
  const r = $('BuildingModel.addOpening(__h,"a",{type:"door",wall:"E",pos:1.5,width:0.9,height:2.05,doorType:"interior"})'); assert(r.opening);
  assert(Object.keys(build(h).openingParts).some(k => k.startsWith('a:'+r.opening.id)), 'interior door exists on the shared wall');
});
test('front wall appears when built or when it gets an opening', ()=>{
  const h = houseOf([ room('a','room',0) ]); assert(!wall(build(h),'a','S'));
  h.rooms[0].design.frontWall = true; assert(wall(build(h),'a','S'));
  h.rooms[0].design.frontWall = false; ctx.__h = h; $('BuildingModel.addOpening(__h,"a",{type:"window",wall:"S",pos:1,width:1.2,height:1.2,sill:0.9})'); assert(wall(build(h),'a','S'), 'window on S forces the wall');
});
test('storeys: upper room group sits at the level elevation, has a structural slab, and its floor/ceiling have stairwell holes', ()=>{
  const h = houseOf([ room('a','room',0,0,'l0',6,5,2.8) ]); ctx.__h = h;
  const lv = $('BuildingModel.addLevel(__h)'); h.rooms.push(room('up','room',0,0,lv.id,6,5,2.6)); $('BuildingModel.migrateHouse(__h)');
  const st = $('BuildingModel.addStair(__h,{roomId:"a",x:1.2,z:4.6,dir:"N"})'); assert(st.stair, JSON.stringify(st));
  const rb = build(h);
  near(rb.roomGroups.up.position.y, 3.05, 1e-9); near(rb.bounds.up.elevation, 3.05, 1e-9); assert(rb.bounds.a.elevation === 0);
  const floorSlabs = g => boxes(g).filter(m => m.position.y < 0 && m.geometry.args[1] <= 0.06);
  assert(floorSlabs(rb.roomGroups.up).length > 1, 'upper floor is split around the hole: '+floorSlabs(rb.roomGroups.up).length);
  const ceil = boxes(rb.roomGroups.a).filter(m => Math.abs(m.position.y - 2.825) < 1e-6); assert(ceil.length > 1, 'lower ceiling split around the hole: '+ceil.length);
  assert(boxes(rb.roomGroups.up).some(m => m.position.y < -0.1 && m.geometry.args[1] === 0.2), 'structural slab under the upper floor');
  assert(!rb.roofGroups.a && !!rb.roofGroups.up === false, 'no PV roofs on flat / covered rooms');
  assert(find(rb.roomGroups.a, x => x.geometry && x.geometry.type === 'Box' && x.geometry.args[0] === 0.9).length >= 16, 'steps exist');
});
test('mono roof: slope group tilted by +pitch inside a yaw group; span/surface data for panel mounting', ()=>{
  const h = houseOf([ room('g','garage',0) ]); const rb = build(h), slope = rb.roofGroups.g;
  assert(slope); near(slope.rotation.x, 12*Math.PI/180); near(slope.parent.rotation.y, 0); assert(slope.userData.surfaceY === 0.035 && slope.userData.span.w > 5 && slope.userData.azimuthDeg === 180);
  h.rooms[0].design.roof.facing = 'E'; const rb2 = build(h); near(rb2.roofGroups.g.parent.rotation.y, Math.PI/2); assert(rb2.roofGroups.g.userData.azimuthDeg === 90);
});
test('REGRESSION: a mono roof facing south really produces panels with compass azimuth 180 (old code tilted the roof the wrong way)', ()=>{
  // world normal of a panel lying on a slope group = Ry(yaw) * Rx(tilt) * (0,1,0); azimuth exactly as ObjectManager.computePVOrientation: atan2(nx, -nz)
  const azOf = slope => { const a = slope.rotation.x, yaw = slope.parent.rotation.y; let n = [0, Math.cos(a), Math.sin(a)];
    n = [n[0]*Math.cos(yaw) + n[2]*Math.sin(yaw), n[1], -n[0]*Math.sin(yaw) + n[2]*Math.cos(yaw)]; return { az:(Math.atan2(n[0], -n[2])*180/Math.PI + 360) % 360, tilt:Math.acos(n[1])*180/Math.PI }; };
  const h = houseOf([ room('g','garage',0) ]);
  for (const [f, az] of [['S',180],['E',90],['N',0],['W',270]]){ h.rooms[0].design.roof.facing = f; const r = azOf(build(h).roofGroups.g); near(r.az, az, 1e-6, 'facing '+f); near(r.tilt, 12, 1e-6); }
  h.rooms[0].design.roof.type = 'gable'; h.rooms[0].design.roof.facing = 'S'; const rb = build(h);
  near(azOf(rb.roofGroups.g).az, 180, 1e-6); near(azOf(rb.roofGroups['g#b']).az, 0, 1e-6);
});
test('gable roof: two mountable slopes (a, b), gable end walls, opposite azimuths; PV on flat roof is not offered', ()=>{
  const h = houseOf([ room('a','room',0) ]); h.rooms[0].design.roof.type = 'gable'; const rb = build(h);
  assert(rb.roofGroups.a && rb.roofGroups['a#b']); assert(rb.roofGroups.a.userData.azimuthDeg === 180 && rb.roofGroups['a#b'].userData.azimuthDeg === 0);
  assert(find(rb.roomGroups.a, x => x.geometry && x.geometry.type === 'Extrude').length === 2, 'two gable ends');
  h.rooms[0].design.roof.type = 'flat'; assert(Object.keys(build(h).roofGroups).length === 0);
});
test('outdoor rooms build a slab/lawn + railing or hedge and no walls / ceiling / roof', ()=>{
  const h = houseOf([ room('a','room',0), room('bal','balcony',0,5.0,'l0'), room('gar','garden',9,0), room('ter','terrace',9,7) ]); const rb = build(h);
  for (const id of ['bal','gar','ter']) assert(find(rb.roomGroups[id], x => x.name && x.name.startsWith('Wall:')).length === 0 && !rb.roofGroups[id], id+' has no walls/roof');
  assert(rb.bounds.bal.outdoor === true && find(rb.roomGroups.bal, x => x.geometry).length > 5, 'railing pieces');
  assert(BuildingModel_attached(h, 'bal').includes('N'), 'balcony touches the room on its north side');
});
function BuildingModel_attached(h, id){ ctx.__h = h; return $(`BuildingModel.outdoorAttachedSides(__h, __h.rooms.find(r=>r.id==="${id}"))`); }
test('partition walls with a doorway are split into pieces with a lintel; without a door they are one box', ()=>{
  const h = houseOf([ room('a','room',0,0,'l0',6,5,2.8) ]); ctx.__h = h;
  $('BuildingModel.addPartition(__h,"a",{x1:3,z1:0.1,x2:3,z2:4.9,doorWidth:0.9})'); const rb = build(h);
  const parts = boxes(rb.roomGroups.a).filter(m => m.geometry.args[0] === 0.1 && m.geometry.args[2] > 0.5 && m.geometry.args[2] < 4.9);
  assert(parts.length === 3, 'two side pieces + lintel: '+parts.length);
});
test('wall visibility fades walls but keeps glass see-through (baseOpacity) and hides at 0', ()=>{
  const h = houseOf([ room('a','room',0) ]); const rb = build(h);
  rb.setWallVisibility(1); const glass = rb.fadable.find(m => m.userData.baseOpacity != null); assert(glass && Math.abs(glass.material.opacity - glass.userData.baseOpacity) < 1e-9);
  rb.setWallVisibility(0); assert(rb.fadable.every(m => m.visible === false));
});
test('occluders come from the pure model and include every storey', ()=>{
  const h = houseOf([ room('a','room',0,0,'l0',6,5,2.8) ]); ctx.__h = h; const lv = $('BuildingModel.addLevel(__h)'); h.rooms.push(room('up','room',0,0,lv.id,6,5,2.6)); $('BuildingModel.migrateHouse(__h)');
  const rb = build(h); assert(rb.occluders.length === $('BuildingModel.occluders(__h)').length && rb.occluders.some(o => o.ownerRoomId === 'up' && o.center[1] > 3));
});
summary();
