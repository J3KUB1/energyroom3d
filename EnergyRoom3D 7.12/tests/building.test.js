const { createContext, test, assert, near, summary } = require('./harness');
const ctx = createContext();
const $ = ctx.$;
console.log('Stage 3 - building model');
const BM = 'BuildingModel';
function room(id, type, x, z, level, w, l, h){
  const meta = $('({...getRoomTypeMeta("'+type+'").defaults})');
  return { id, name:id, type, settings:Object.assign(meta, w?{width:w}:{}, l?{length:l}:{}, h?{height:h}:{}), offsetX:x||0, offsetZ:z||0, levelId:level||'l0' };
}
function house(rooms){ const h = { rooms, activeRoomId:rooms[0].id, wallVisibility:1 }; ctx.__h = h; $(`${BM}.migrateHouse(__h)`); return h; }
const call = (h, expr) => { ctx.__h = h; return $(expr); };

test('legacy houses (no levels/design) migrate to the current structure and keep the old look', ()=>{
  const h = house([ room('main','room',0), room('garage','garage',8.4) ]);
  assert(h.levels.length === 1 && h.levels[0].id === 'l0' && h.rooms.every(r => r.levelId === 'l0' && r.design));
  const m = h.rooms[0].design; const win = m.openings.find(o=>o.type==='window'), door = m.openings.find(o=>o.type==='door');
  near(win.width, 1.8); near(win.height, 1.3); near(win.sill, 0.9); assert(win.wall === 'N'); near(win.pos, (7-1.8)/2);
  near(door.width, 0.95); near(door.height, 2.05); assert(door.wall === 'E'); near(door.pos, 0.7);
  const g = h.rooms[1].design; assert(g.openings.some(o=>o.type==='garage' && o.wall==='W') && g.roof.type === 'mono' && g.roof.facing === 'S');
});
test('migrateHouse is idempotent and never clobbers user edits', ()=>{
  const h = house([ room('a','room') ]); h.rooms[0].design.walls.N.insulationCm = 22; h.rooms[0].design.openings.length = 0;
  ctx.__h = h; $(`${BM}.migrateHouse(__h)`); $(`${BM}.migrateHouse(__h)`);
  assert(h.rooms[0].design.walls.N.insulationCm === 22 && h.rooms[0].design.openings.length === 0);
});
test('junk design values are repaired (bad material, out-of-range insulation/pitch)', ()=>{
  const r = room('a','room'); r.design = { walls:{ N:{ material:'unobtainium', insulationCm:999 } }, roof:{ type:'gable', pitchDeg:1 }, openings:[{ id:'x', type:'window', wall:'N', pos:1, width:1, height:1, sill:1, glazing:'zzz' }] };
  const h = house([r]); assert(r.design.walls.N.material === 'brick' && r.design.walls.N.insulationCm === 40 && r.design.roof.pitchDeg === 3 && r.design.openings[0].glazing === 'double');
});

// ---- physics of the build-ups
test('U-values: insulated brick wall ~0.3, bare brick ~2, glazing single > double > triple, more insulation lowers U', ()=>{
  const U = (m,i,ext)=>$(`${BM}.wallU({material:"${m}",insulationCm:${i}},${ext!==false})`);
  assert(U('brick',10) > 0.28 && U('brick',10) < 0.36, 'brick+10cm '+U('brick',10)); assert(U('brick',0) > 1.8 && U('brick',0) < 2.2, 'bare brick '+U('brick',0));
  assert(U('brick',20) < U('brick',10) && U('aac',0) < U('brick',0), 'ordering'); assert(U('brick',10,false) > 0 );
  const wu = g => $(`${BM}.windowU({glazing:"${g}"})`); assert(wu('single') > wu('double') && wu('double') > wu('triple'));
  near(wu('double'), 0.75*1.1 + 0.25*1.4, 1e-9);
});

// ---- openings
test('opening validation: bounds, overlap, height, minimum width, outdoor rooms', ()=>{
  const h = house([ room('a','room') ]); const V = o => call(h, `${BM}.validateOpening(__h, __h.rooms[0], ${JSON.stringify(Object.assign({ id:'new', type:'window', wall:'S', pos:1, width:1, height:1, sill:1, glazing:'double' }, o))})`);
  assert(V({}) === null); assert(V({ pos:-1 }) === 'outOfWall'); assert(V({ pos:6.5, width:1 }) === 'outOfWall'); assert(V({ width:0.1 }) === 'tooNarrow');
  assert(V({ sill:2, height:1.5 }) === 'tooTall'); assert(V({ wall:'N', pos:2, width:1 }) === 'overlap', 'overlaps the default window on N');
  const g = house([ room('g','garden',0) ]); assert(call(g, `${BM}.validateOpening(__h, __h.rooms[0], {id:"n",type:"window",wall:"N",pos:1,width:1,height:1,sill:1})`) === 'outdoorRoom');
});
test('add / update / remove opening; suggestPos finds free space', ()=>{
  const h = house([ room('a','room') ]);
  const r1 = call(h, `${BM}.addOpening(__h,"a",{type:"window",wall:"S",pos:1,width:1.2,height:1.2,sill:0.9,glazing:"triple"})`); assert(r1.opening && r1.opening.id);
  assert(call(h, `${BM}.addOpening(__h,"a",{type:"window",wall:"S",pos:1.5,width:1.2,height:1.2,sill:0.9})`).error === 'overlap');
  assert(call(h, `${BM}.updateOpening(__h,"a","${r1.opening.id}",{width:2})`).opening.width === 2);
  assert(call(h, `${BM}.updateOpening(__h,"a","${r1.opening.id}",{width:20})`).error, 'invalid update is refused and leaves the opening intact');
  assert(h.rooms[0].design.openings.find(o=>o.id===r1.opening.id).width === 2);
  const p = call(h, `${BM}.suggestPos(__h, __h.rooms[0], "S", 1.5)`); assert(p !== null && p >= 3.0, 'after the 2 m window: '+p);
  assert(call(h, `${BM}.removeOpening(__h,"a","${r1.opening.id}")`) === true);
});

// ---- adjacency and shared walls
test('flush rooms share a wall: exterior UA drops, coupling to the neighbour appears, owner is the smaller id', ()=>{
  const apart = house([ room('a','room',0), room('b','room',8.4) ]);            // 1.4 m gap: fully exterior
  const flush = house([ room('a','room',0), room('b','room',7.0) ]);            // 7.0 wide room a -> b starts at x=7
  const eA = call(apart, `${BM}.envelope(__h, __h.rooms[0])`), eF = call(flush, `${BM}.envelope(__h, __h.rooms[0])`);
  assert(eF.ua.walls < eA.ua.walls, `shared wall must lower the exterior wall UA: ${eF.ua.walls} vs ${eA.ua.walls}`);
  assert(eF.couplings.some(c => c.roomId === 'b' && c.kind === 'wall' && c.UA > 0), 'wall coupling');
  assert(call(flush, `${BM}.adjacency(__h, __h.rooms[0])`).E.length === 1 && call(flush, `${BM}.adjacency(__h, __h.rooms[1])`).W.length === 1);
  assert(call(flush, `${BM}.ownsSharedWall(__h.rooms[0], __h.rooms[1])`) && !call(flush, `${BM}.ownsSharedWall(__h.rooms[1], __h.rooms[0])`));
});
test('a door on the shared wall is an interior door: no exterior door UA, but a door coupling and airflow link', ()=>{
  const h = house([ room('a','room',0), room('b','room',7.0) ]);
  h.rooms[0].design.openings = h.rooms[0].design.openings.filter(o => o.wall !== 'E');
  const r = call(h, `${BM}.addOpening(__h,"a",{type:"door",wall:"E",pos:1.5,width:0.9,height:2.05,doorType:"interior"})`); assert(r.opening, JSON.stringify(r));
  const e = call(h, `${BM}.envelope(__h, __h.rooms[0])`), d = e.doors.find(x => x.id === r.opening.id);
  assert(d && !d.exterior && d.toRoomId === 'b'); assert(e.couplings.some(c => c.kind === 'door' && c.roomId === 'b'));
});
test('the neighbour that does not own the shared wall cannot put an opening in it', ()=>{
  const h = house([ room('a','room',0), room('b','room',7.0) ]);
  const bWestT = 1.0;  // W wall of b walks south->north; any centre inside the shared span
  const res = call(h, `${BM}.addOpening(__h,"b",{type:"door",wall:"W",pos:1.0,width:0.9,height:2.05,doorType:"interior"})`);
  assert(res.error === 'neighbourOwnsWall', JSON.stringify(res));
});

// ---- levels, stacking, stairs
function twoStorey(){
  const h = house([ room('a','room',0,0,'l0',6,5,2.8) ]);
  const lv = call(h, `${BM}.addLevel(__h)`); assert(lv.elevation > 2.9 && lv.elevation < 3.5, 'elevation '+lv.elevation);
  h.rooms.push(room('up','room',0,0,lv.id,6,5,2.6)); call(h, `${BM}.migrateHouse(__h)`);
  return { h, lv };
}
test('levels: new level sits one storey (room height + slab) above; basement below; cannot remove non-empty/last level', ()=>{
  const { h, lv } = twoStorey();
  near(lv.elevation, 2.8 + 0.25); const b = call(h, `${BM}.addLevel(__h,{below:true})`); assert(b.elevation < 0 && b.elevation < -2.5);
  assert(call(h, `${BM}.removeLevel(__h,"${lv.id}")`) === 'levelNotEmpty'); assert(call(h, `${BM}.removeLevel(__h,"${b.id}")`) === null);
  const one = house([ room('x','room') ]); assert(call(one, `${BM}.removeLevel(__h,"l0")`) === 'lastLevel');
});
test('stacked rooms: lower room loses its roof, both get a floor/ceiling coupling; only the top room keeps a roof', ()=>{
  const { h } = twoStorey();
  const lower = h.rooms[0], upper = h.rooms[1];
  assert(call(h, `${BM}.roomsAbove(__h, __h.rooms[0])`).length === 1 && call(h, `${BM}.roomsBelow(__h, __h.rooms[1])`).length === 1);
  assert(call(h, `${BM}.roofSpec(__h, __h.rooms[0])`).type === 'none');
  const eL = call(h, `${BM}.envelope(__h, __h.rooms[0])`), eU = call(h, `${BM}.envelope(__h, __h.rooms[1])`);
  assert(eL.couplings.some(c => c.roomId === 'up' && c.kind === 'ceiling') && eU.couplings.some(c => c.roomId === 'a' && c.kind === 'floor'));
  assert(eL.ua.roof === 0, 'no heat loss through a roof that is covered'); assert(eU.ua.roof > 0, 'top room loses through its roof');
  assert(eU.ua.floor === 0, 'upper floor is over a heated room, not exposed'); assert(eL.floorToGround === true && eL.ua.floor > 0);
});
test('stairs: footprint, slab holes in BOTH rooms, target room, run length from the rise', ()=>{
  const { h, lv } = twoStorey();
  const r = call(h, `${BM}.addStair(__h,{roomId:"a",x:1.2,z:4.6,dir:"N",width:0.9})`); assert(r.stair, JSON.stringify(r));
  const run = call(h, `${BM}.stairRun(__h, __h.rooms[0], "${lv.id}")`); assert(run.risers >= 16 && run.risers <= 18, 'risers '+run.risers); near(run.run, (run.risers-1)*0.27, 1e-9);
  const holesLow = call(h, `${BM}.stairHoles(__h, __h.rooms[0])`), holesUp = call(h, `${BM}.stairHoles(__h, __h.rooms[1])`);
  assert(holesLow.ceiling.length === 1 && holesUp.floor.length === 1, 'hole in lower ceiling and upper floor');
  near(holesLow.ceiling[0].x0, holesUp.floor[0].x0, 1e-9, 'same footprint (rooms aligned)');
  assert(call(h, `${BM}.stairTarget(__h, __h.stairs[0])`).id === 'up');
  assert(call(h, `${BM}.addStair(__h,{roomId:"a",x:0.2,z:1,dir:"W"})`).error === 'stairOutsideRoom', 'stair must fit in the room');
  const lone = house([ room('z','room') ]); call(lone, `${BM}.addLevel(__h)`);
  assert(call(lone, `${BM}.addStair(__h,{roomId:"z",x:1,z:4.8,dir:"N"})`).error === 'stairNoTarget', 'no room above -> refused');
  assert(call(h, `${BM}.removeStair(__h, "${r.stair.id}")`));
});
test('validation: overlapping rooms on one level are an error; stacked rooms without stairs get a hint', ()=>{
  const bad = house([ room('a','room',0), room('b','room',3) ]);
  assert(call(bad, `${BM}.validate(__h)`).some(i => i.code === 'roomsOverlap'));
  const { h } = twoStorey(); assert(call(h, `${BM}.validate(__h)`).some(i => i.code === 'noStairs'));
  const ok = house([ room('a','room',0), room('b','room',8.4) ]); assert(call(ok, `${BM}.validate(__h)`).length === 0);
});

// ---- roof geometry / PV mounting / shading
const normalAz = axes => { let a = Math.atan2(axes[1][0], -axes[1][2]) * 180 / Math.PI; return (a + 360) % 360; };
test('roof slope orientation is physically right: a roof facing S has its normal pointing south (azimuth 180) and tilts by the pitch', ()=>{
  const h = house([ room('g','garage',0) ]);
  for (const [f, az] of [['S',180],['E',90],['N',0],['W',270]]){
    h.rooms[0].design.roof.facing = f;
    const sl = call(h, `${BM}.roofSlopes(__h, __h.rooms[0])`)[0], axes = call(h, `${BM}.slopeAxes(${JSON.stringify(sl)})`);
    near(normalAz(axes), az, 1e-6, 'facing '+f); near(Math.acos(axes[1][1]) * 180 / Math.PI, 12, 1e-6); assert(sl.azimuthDeg === az);
  }
});
test('PV suitability: south ~optimal, east/west ~80%, north much worse; steeper south beats flat; a wrong-way roof is clearly penalised', ()=>{
  const S = (t, az) => $(`${BM}.pvSuitability(${t}, ${az})`);
  assert(S(35,180) === 100); assert(S(12,180) >= 85 && S(12,180) < 100, 'low south roof '+S(12,180)); assert(S(35,90) < 85 && S(35,90) > 60, 'east '+S(35,90));
  assert(S(35,0) < 60, 'north '+S(35,0)); assert(S(12,0) > S(35,0), 'a flat north roof loses less than a steep one'); assert(S(0,180) < S(35,180));
});
test('gable roof: two slopes facing opposite ways, both mountable; flat/none roofs have no PV slope', ()=>{
  const h = house([ room('a','room',0) ]); h.rooms[0].design.roof.type = 'gable';
  const sl = call(h, `${BM}.roofSlopes(__h, __h.rooms[0])`); assert(sl.length === 2 && sl[0].azimuthDeg === 180 && sl[1].azimuthDeg === 0);
  const axes = sl.map(s => call(h, `${BM}.slopeAxes(${JSON.stringify(s)})`)); assert(Math.abs(normalAz(axes[0]) - 180) < 1e-6 && Math.abs(normalAz(axes[1]) - 0) < 1e-6);
  h.rooms[0].design.roof.type = 'flat'; assert(call(h, `${BM}.roofSlopes(__h, __h.rooms[0])`).length === 0);
});
test('the ridge of a gable is higher than the eaves and the two slopes meet', ()=>{
  const h = house([ room('a','room',0,0,'l0',6,6,2.8) ]); h.rooms[0].design.roof.type = 'gable'; h.rooms[0].design.roof.overhang = 0;
  const [A, B] = call(h, `${BM}.roofSlopes(__h, __h.rooms[0])`);
  const ridgeA = A.y + Math.sin(A.pitch) * 0 + (A.len/2) * Math.sin(A.pitch), eaveA = A.y - (A.len/2) * Math.sin(A.pitch);
  near(A.y, B.y, 1e-9); near(ridgeA - eaveA, 3 * Math.tan(12*Math.PI/180), 0.06, 'ridge rise = half-span x tan(pitch)'); assert(ridgeA > eaveA + 0.5, 'ridge above eave'); near(eaveA, 2.85, 0.1, 'eave at the wall top');
});
test('occluders: roof slabs carry the room id (never shade their own panels); an upper storey shades a lower neighbour roof', ()=>{
  const h = house([ room('garage','garage',0,0,'l0',4,4,2.6), room('main','room',4.2,0,'l0',6,4,2.8) ]);
  const lv = call(h, `${BM}.addLevel(__h)`); h.rooms.push(room('up','room',4.2,0,lv.id,6,4,2.6)); call(h, `${BM}.migrateHouse(__h)`);
  const occ = call(h, `${BM}.occluders(__h)`);
  assert(occ.some(o => o.ownerRoomId === 'garage' && o.isRoof) && !occ.some(o => o.ownerRoomId === 'main' && o.isRoof), 'covered roof removed');
  const sm = $('new ShadeModel()'); sm.setStaticOccluders(occ);
  // a panel on the garage roof (east side of the garage), low morning sun from the east is blocked by the 2-storey block
  const sl = call(h, `${BM}.roofSlopes(__h, __h.rooms[0])`)[0], axes = call(h, `${BM}.slopeAxes(${JSON.stringify(sl)})`);
  sm.setPanel('p', { center:[3.2, 2.9, 2.0], u:axes[0], n:axes[1], v:axes[2], halfW:0.5, halfL:0.825, halfT:0.03, roomId:'garage' });
  const east = sm.factor('p', 15, 95), south = sm.factor('p', 45, 180);
  assert(east < 0.2, 'blocked by the upper storey in the morning: '+east); assert(south > 0.9, 'free at noon: '+south);
});

// ---- envelope / heat loss / solar gain
test('envelope: a typical room has plausible UA and a design heat loss of roughly 1-2.5 kW at -20 C', ()=>{
  const h = house([ room('a','room',0,0,'l0',5,4,2.8) ]); const e = call(h, `${BM}.envelope(__h, __h.rooms[0])`);
  assert(e.ua.total > 20 && e.ua.total < 60, 'UA '+e.ua.total); const q = call(h, `${BM}.designHeatLossW(${JSON.stringify(e)}, 20, -20)`);
  assert(q > 1000 && q < 3500, 'design loss '+q); assert(e.hv > 8 && e.hv < 20, 'ventilation '+e.hv); assert(e.thermalMassJK > 1e6, 'mass '+e.thermalMassJK);
});
test('better windows / more insulation / a closed door all reduce heat loss (each design decision matters)', ()=>{
  const base = house([ room('a','room',0,0,'l0',5,4,2.8) ]); const Q = h => { ctx.__h = h; return $(`${BM}.designHeatLossW(${BM}.envelope(__h, __h.rooms[0]), 20, -20)`); };
  const q0 = Q(base);
  const tri = house([ room('a','room',0,0,'l0',5,4,2.8) ]); tri.rooms[0].design.openings.find(o=>o.type==='window').glazing = 'triple'; assert(Q(tri) < q0, 'triple glazing');
  const sgl = house([ room('a','room',0,0,'l0',5,4,2.8) ]); sgl.rooms[0].design.openings.find(o=>o.type==='window').glazing = 'single'; assert(Q(sgl) > q0 + 100, 'single glazing');
  const ins = house([ room('a','room',0,0,'l0',5,4,2.8) ]); for (const s of ['N','E','S','W']) ins.rooms[0].design.walls[s].insulationCm = 25; assert(Q(ins) < q0, 'more insulation');
  const bare = house([ room('a','room',0,0,'l0',5,4,2.8) ]); for (const s of ['N','E','S','W']) bare.rooms[0].design.walls[s].insulationCm = 0; assert(Q(bare) > q0 * 1.3, 'no insulation');
  const open = house([ room('a','room',0,0,'l0',5,4,2.8) ]); open.rooms[0].design.openings.forEach(o=>o.open=1); assert(Q(open) > q0 * 1.5, 'open door + window: '+Q(open)+' vs '+q0);
  const big = house([ room('a','room',0,0,'l0',5,4,2.8) ]); big.rooms[0].design.openings.find(o=>o.type==='window').width = 3.5; assert(Q(big) > q0, 'bigger window');
});
test('solar gain: south windows gain most at noon, north least, zero at night, less under cloud; more glass = more gain', ()=>{
  const mk = facing => { const h = house([ room('a','room',0,0,'l0',5,4,2.8) ]); const o = h.rooms[0].design.openings.find(x=>x.type==='window'); o.wall = facing; o.pos = 1.0; return h; };
  const G = (h, el, az, sky) => { ctx.__h = h; return $(`${BM}.solarGainW(${BM}.envelope(__h, __h.rooms[0]), ${el}, ${az}, ${sky})`); };
  const s = G(mk('S'), 50, 180, 1), n = G(mk('N'), 50, 180, 1), e = G(mk('E'), 25, 100, 1), w = G(mk('W'), 25, 100, 1);
  assert(s > 300 && s > n * 3, `south ${s} north ${n}`); assert(e > w, 'morning: east window gains more than west');
  assert(G(mk('S'), -5, 180, 1) === 0); assert(G(mk('S'), 50, 180, 0.2) < s * 0.5, 'clouds cut direct gain');
  const wide = mk('S'); wide.rooms[0].design.openings.find(x=>x.type==='window').width = 3.0; assert(G(wide, 50, 180, 1) > s * 1.4);
});
test('basement walls are partly below ground: their loss goes to the warmer ground, and a level below ground is negative', ()=>{
  const h = house([ room('a','room',0,0,'l0',5,4,2.8) ]); const b = call(h, `${BM}.addLevel(__h,{below:true})`);
  h.rooms.push(room('bas','basement',0,0,b.id,5,4,2.5)); call(h, `${BM}.migrateHouse(__h)`);
  const e = call(h, `${BM}.envelope(__h, __h.rooms[1])`); assert(e.ua.groundWalls > 0 && e.elevation < 0);
  const above = call(h, `${BM}.envelope(__h, __h.rooms[0])`); assert(above.couplings.some(c => c.roomId === 'bas' && c.kind === 'floor'), 'ground room over basement couples to it');
  const q = call(h, `${BM}.designHeatLossW(${JSON.stringify(e)}, 20, -20)`); const flatEnv = JSON.parse(JSON.stringify(e)); flatEnv.ua.groundWalls = 0;
  assert(q < call(h, `${BM}.designHeatLossW(${JSON.stringify(flatEnv)}, 20, -20)`), 'ground-contact walls lose less than air-exposed ones');
});
test('partitions add thermal mass; door gap default; validation of axis alignment and length', ()=>{
  const h = house([ room('a','room',0,0,'l0',6,5,2.8) ]); const m0 = call(h, `${BM}.envelope(__h, __h.rooms[0])`).thermalMassJK;
  const r = call(h, `${BM}.addPartition(__h,"a",{x1:3,z1:0.1,x2:3,z2:5,material:"brick"})`); assert(r.partition && r.partition.doorWidth === 0.9);
  assert(call(h, `${BM}.envelope(__h, __h.rooms[0])`).thermalMassJK > m0, 'more mass');
  assert(call(h, `${BM}.addPartition(__h,"a",{x1:1,z1:1,x2:3,z2:3})`).error === 'notAxisAligned'); assert(call(h, `${BM}.addPartition(__h,"a",{x1:1,z1:1,x2:1.2,z2:1})`).error === 'tooShort');
  assert(call(h, `${BM}.removePartition(__h,"a","${r.partition.id}")`));
});
test('outdoor rooms (balcony/terrace/garden): no walls, no envelope losses, no openings', ()=>{
  const h = house([ room('t','terrace',0) ]); const e = call(h, `${BM}.envelope(__h, __h.rooms[0])`);
  assert(e.outdoor && e.ua.total === 0 && e.hv === 0 && call(h, `${BM}.designHeatLossW(${JSON.stringify(e)}, 20, -20)`) === 0);
  assert(h.rooms[0].design.openings.length === 0 && call(h, `${BM}.roofSpec(__h, __h.rooms[0])`).type === 'none');
});
test('compile() returns envelopes, shading geometry and issues; snapToRoom makes rooms adjacent', ()=>{
  const h = house([ room('a','room',0), room('b','room',20) ]); call(h, `${BM}.snapToRoom(__h, __h.rooms[1], __h.rooms[0], "E")`);
  near(h.rooms[1].offsetX, 7.0); assert(call(h, `${BM}.adjacency(__h, __h.rooms[0])`).E.length === 1);
  const c = call(h, `${BM}.compile(__h)`); assert(c.rooms.a && c.rooms.b && c.occluders.length >= 2 && c.totals.floorArea === 70 && Array.isArray(c.issues));
});
// ---- layout, refit
test('autoLayout packs ground rooms left-to-right (legacy behaviour) and stops once the designer took over', ()=>{
  const h = house([ room('a','room',0), room('b','room',50), room('c','room',99) ]); call(h, `${BM}.autoLayout(__h)`);
  near(h.rooms[0].offsetX, 0); near(h.rooms[1].offsetX, 7 + 1.4); near(h.rooms[2].offsetX, 2*(7 + 1.4));
  h.layout = 'free'; h.rooms[1].offsetX = 33; call(h, `${BM}.autoLayout(__h)`); near(h.rooms[1].offsetX, 33);
});
test('placeNewRoom: next to the others on the first level; stacked on a free spot for another storey (switches to free layout)', ()=>{
  const h = house([ room('a','room',0), room('b','garage',8.4) ]);
  const r1 = room('n','kitchen',0,0,'l0'); ctx.__r = r1; call(h, `${BM}.placeNewRoom(__h, __r)`); near(r1.offsetX, 7 + 1.4 + 5.5 + 1.4);
  const lv = call(h, `${BM}.addLevel(__h)`); const r2 = room('u','room',0,0,lv.id); ctx.__r = r2; call(h, `${BM}.placeNewRoom(__h, __r)`);
  assert(h.layout === 'free' && (r2.offsetX === 0 || r2.offsetX === 8.4), 'stacked on a ground room: '+r2.offsetX);
});
test('refit: shrinking a room clamps or removes openings/partitions/stairs that no longer fit', ()=>{
  const h = house([ room('a','room',0,0,'l0',7,5,2.8) ]); ctx.__h = h;
  call(h, `${BM}.addPartition(__h,"a",{x1:6.5,z1:0.1,x2:6.5,z2:4.5})`);
  h.rooms[0].settings.width = 2.5; h.rooms[0].settings.height = 2.2;
  const n = call(h, `${BM}.refit(__h, __h.rooms[0])`); const d = h.rooms[0].design;
  assert(d.openings.every(o => call(h, `${BM}.validateOpening(__h, __h.rooms[0], ${JSON.stringify(o)})`) === null), 'all remaining openings valid');
  assert(d.partitions.every(p => p.x1 <= 2.4)); assert(d.openings.length >= 1, 'window survives, narrowed: '+JSON.stringify(d.openings.map(o=>o.width)));
});
test('migrateHouse drops stairs whose room or target level no longer exists', ()=>{
  const { h } = twoStorey(); call(h, `${BM}.addStair(__h,{roomId:"a",x:1.2,z:4.6,dir:"N"})`); h.rooms = h.rooms.filter(r => r.id !== 'a'); call(h, `${BM}.migrateHouse(__h)`);
  assert(h.stairs.length === 0);
});
summary();