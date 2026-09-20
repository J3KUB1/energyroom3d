const { createContext, test, assert, near, summary } = require('./harness');
const ctx = createContext();
const $ = ctx.$;
console.log('Stage 2 - electrical system');

// ---- fake scene adapter -------------------------------------------------------------------
function world(opts){
  opts = opts || {};
  const w = { els:[], devs:[], events:[], nextId:1,
    rooms:[ { id:'main', name:'Salon', type:'room', offsetX:0, width:5, length:4, height:2.6 },
            { id:'garage', name:'Garaż', type:'garage', offsetX:6, width:4, length:5, height:2.6 } ] };
  w.sys = $('new ElectricalSystem({ getElements:()=>__w.els, getDevices:()=>__w.devs, getRooms:()=>__w.rooms, onEvent:e=>__w.events.push(e), createElement:(d,r,p,ry)=>__w.make(d,r,p,ry) })');
  w.make = (defId, roomId, pos, rotY)=>{ const e = { id:'el'+(w.nextId++), kind:'electrical', defId, def:$(`getElectricalDefinition('${defId}')`), roomId, position:{ x:pos.x, y:pos.y, z:pos.z },
      rotation:{x:0,y:rotY||0,z:0}, circuitId:null, plugTo:null, enabled:true, runtime:{} }; w.els.push(e); return e; };
  w.dev = (id, ratedW, roomId, x, z, extra)=>{ const d = Object.assign({ id, kind:'device', roomId:roomId||'main', position:{x:x||1,y:0,z:z||1}, connected:true, plugTo:null, def:{ name:id, ratedPowerW:ratedW } }, extra||{}); w.devs.push(d); return d; };
  ctx.__w = w; return w;
}
const step = (w, list, accumulate)=> w.sys.resolve(list, { accumulate:accumulate!==false });
const demand = (w, map)=> w.devs.map(d => ({ id:d.id, desiredW: map[d.id] || 0, connected:d.connected, plugTo:d.plugTo }));

function basic(opts){
  const w = world(opts); w.sys.autoInstall(); return w;
}

// ---- physics ------------------------------------------------------------------------------
test('breaker curve: no trip within 1.13 In, ~1 h at 1.45 In, seconds at 2.55 In, instant at 5 In (B)', ()=>{
  const T = (r,c)=>$(`ElectricalSystem.tripTimeMin(${r},'${c||'B'}')`);
  assert(T(1.1) === Infinity); near(T(1.45), 60, 0.5); near(T(2.55), 0.5, 0.01); assert(T(5)===0 && T(6)===0);
  assert(T(5,'C') > 0 && T(10,'C') === 0, 'C curve trips magnetically at 10 In');
  assert(T(1.2) > T(1.45) && T(1.45) > T(2.55), 'monotonic');
});
test('constant-power load: cable drop lowers voltage, current slightly higher than P/V, losses = I^2 R', ()=>{
  const S = (P,R)=>$(`ElectricalSystem.solveCurrent(${P},230,${R})`);
  const r = S(3680, 0.18); assert(r.ok && r.I > 16 && r.I < 16.5, 'I '+r.I); near(r.V, 230 - r.I*0.18, 1e-9);
  assert(S(3680,0).I === 3680/230);
  const bad = S(50000, 0.5); assert(!bad.ok, 'impossible load flagged as brown-out');
});

// ---- installation basics ------------------------------------------------------------------
test('autoInstall builds meter + board, 4 sockets per room on a circuit each, and wires them all', ()=>{
  const w = basic();
  assert(w.sys.board && w.sys.meter);
  assert(w.sys.sockets('main').length === 4 && w.sys.sockets('garage').length === 4);
  assert(w.sys.data.circuits.length === 2 && w.sys.data.breakers.length === 2);
  assert(w.sys.data.wires.length === 8, 'wires '+w.sys.data.wires.length);
  assert(w.sys.sockets().every(s => s.circuitId && w.sys.wireOf(s.id)));
  const c = w.sys.data.circuits[0]; assert(w.sys.breaker(c.breakerId).ratingA === 16 && c.cableId === 'ydy_3x2_5');
});
test('autoInstall is idempotent', ()=>{
  const w = basic(); const n = w.els.length, c = w.sys.data.circuits.length; w.sys.autoInstall();
  assert(w.els.length === n && w.sys.data.circuits.length === c);
});
test('heavy appliance (>=3 kW) gets its own circuit with a matching breaker and cable', ()=>{
  const w = world(); w.dev('oven', 3500); w.sys.autoInstall();
  const d = w.devs[0]; const s = w.els.find(e => e.id === d.plugTo); const c = w.sys.circuit(s.circuitId);
  assert(c.kind === 'dedicated'); const b = w.sys.breaker(c.breakerId);
  assert(b.ratingA >= 20, 'rating '+b.ratingA); assert($(`getCableType('${c.cableId}')`).ampacityA >= b.ratingA, 'cable carries breaker rating');
});
test('devices auto-plug to the nearest socket with a free outlet (2 outlets per socket)', ()=>{
  const w = world(); w.sys.autoInstall();
  const a = w.dev('a',100,'main',1.2,0.3), b = w.dev('b',100,'main',1.2,0.3), c = w.dev('c',100,'main',1.2,0.3);
  const s1 = w.sys.autoPlug(a), s2 = w.sys.autoPlug(b), s3 = w.sys.autoPlug(c);
  assert(s1 === s2, 'two outlets on the nearest socket'); assert(s3 !== s1, 'third goes to another socket');
});
test('plugging into a full socket is refused; a power strip adds outlets', ()=>{
  const w = basic(); const so = w.sys.sockets('main')[0];
  const d1 = w.dev('d1',100), d2 = w.dev('d2',100), d3 = w.dev('d3',100);
  assert(w.sys.plugDevice('d1', so.id) && w.sys.plugDevice('d2', so.id)); assert(!w.sys.plugDevice('d3', so.id), 'socket full');
  const strip = w.make('power_strip','main',{x:1,y:0,z:1}); w.sys.data;
  w.sys.unplugDevice('d2'); assert(w.sys.plugStrip(strip.id, so.id)); assert(w.sys.plugDevice('d3', strip.id));
});

// ---- cable length / cost ------------------------------------------------------------------
test('cable length follows the routing: ceiling > direct, floor differs, other room adds a wall passage', ()=>{
  const w = basic(); const so = w.sys.sockets('main')[1];
  const wire = w.sys.wireOf(so.id);
  const ceiling = w.sys.wireLengthM(wire); w.sys.setWireRoute(so.id, 'direct'); const direct = w.sys.wireLengthM(w.sys.wireOf(so.id));
  w.sys.setWireRoute(so.id, 'floor'); const floor = w.sys.wireLengthM(w.sys.wireOf(so.id));
  assert(ceiling > direct, `ceiling ${ceiling} direct ${direct}`); assert(floor < ceiling, 'floor route shorter for low sockets');
  const g = w.sys.sockets('garage')[0]; const lg = w.sys.wireLengthM(w.sys.wireOf(g.id));
  assert(lg > ceiling, 'garage socket is farther from the board');
});
test('moving a socket changes its cable length and therefore cost', ()=>{
  const w = basic(); const so = w.sys.sockets('main')[1]; const before = w.sys.costBreakdown().totalZl;
  so.position.x += 3; const after = w.sys.costBreakdown().totalZl; assert(after > before, `${before} -> ${after}`);
});
test('cost breakdown itemises cables, sockets, board, breakers, main breaker, labour; amortised per year', ()=>{
  const w = basic(); const c = w.sys.costBreakdown(); const keys = new Set(c.items.map(i=>i.key));
  for (const k of ['socket','board','meter','mainBreaker','breaker','cable']) assert(keys.has(k), 'missing '+k);
  assert(c.totalZl > 1500 && c.totalZl < 6000, 'plausible total '+c.totalZl);
  near(c.amortizedPerYearZl, c.totalZl/25, 1e-9); assert(c.items.every(i => i.laborZl >= 0 && i.materialZl >= 0));
  const sockets = c.items.find(i=>i.key==='socket'); assert(sockets.qty === 8 && sockets.laborZl === 8*55);
});
test('a bigger breaker costs more; thicker cable costs more', ()=>{
  const w = basic(); const c0 = w.sys.costBreakdown().totalZl;
  w.sys.setBreakerRating(w.sys.data.breakers[0].id, 32); w.sys.setCircuitCable(w.sys.data.circuits[0].id, 'ydy_3x6');
  assert(w.sys.costBreakdown().totalZl > c0);
});

// ---- power flow ---------------------------------------------------------------------------
test('a plugged device on a healthy circuit is powered; circuit reports V, A, W, max A/W', ()=>{
  const w = basic(); const d = w.dev('tv', 200, 'main', 1.2, 0.3); w.sys.autoPlug(d);
  const r = step(w, demand(w, { tv:200 }), false);
  assert(r.devices.get('tv').status === 'ok' && r.devices.get('tv').powerW === 200);
  const cid = w.els.find(e=>e.id===d.plugTo).circuitId, rc = w.sys.rt.circuits[cid];
  assert(rc.currentA > 0.85 && rc.currentA < 0.95); assert(rc.powerW === 200);
  near(rc.maxA, 16); near(rc.maxW, 16*230, 1e-6);
  assert(rc.voltageV < 230 && rc.voltageV > 225);
});
test('strict mode: an unassigned device gets no power; non-strict (legacy) keeps it powered', ()=>{
  const w = basic(); w.dev('lamp', 60);
  assert(step(w, demand(w,{lamp:60}), false).devices.get('lamp').powerW === 0);
  w.sys.data.strict = false; const r = step(w, demand(w,{lamp:60}), false).devices.get('lamp'); assert(r.powerW === 60 && r.status === 'legacy');
});
test('an unplugged (physically) device draws nothing', ()=>{
  const w = basic(); const d = w.dev('tv', 200, 'main', 1.2, 0.3); w.sys.autoPlug(d); d.connected = false;
  assert(step(w, demand(w,{tv:200}), false).devices.get('tv').powerW === 0);
});
test('socket without circuit / without wire is dead', ()=>{
  const w = basic(); const d = w.dev('tv', 200, 'main', 1.2, 0.3); w.sys.autoPlug(d); const so = w.els.find(e=>e.id===d.plugTo);
  w.sys.unwire(so.id); assert(step(w, demand(w,{tv:200}), false).devices.get('tv').status === 'noWire');
  w.sys.wire(so.id); w.sys.assignSocketCircuit(so.id, null); assert(step(w, demand(w,{tv:200}), false).devices.get('tv').status === 'noCircuit');
});
test('no switchboard/meter -> nothing is powered in strict mode', ()=>{
  const w = basic(); const d = w.dev('tv', 200, 'main', 1.2, 0.3); w.sys.autoPlug(d);
  w.els.splice(w.els.indexOf(w.sys.meter), 1);
  assert(step(w, demand(w,{tv:200}), false).devices.get('tv').status === 'noSupply');
});
test('wire losses are real: I^2*R is reported and grows with cable length and thinner cable', ()=>{
  const w = basic(); const d = w.dev('h', 3000, 'garage', 1, 1); const so = w.sys.sockets('garage')[0]; w.sys.plugDevice('h', so.id);
  const l1 = step(w, demand(w,{h:3000}), false).lossW;
  w.sys.setCircuitCable(so.circuitId, 'ydy_3x1_5'); const l2 = step(w, demand(w,{h:3000}), false).lossW;
  assert(l1 > 20 && l1 < 200, 'loss '+l1); assert(l2 > l1 * 1.5, `thin cable loses more: ${l1} -> ${l2}`);
});

// ---- overload / trip ----------------------------------------------------------------------
function loaded(P, curve){
  const w = basic(); const so = w.sys.sockets('main')[0];
  const d1 = w.dev('h1', P, 'main', 1, 1), d2 = w.dev('h2', P, 'main', 1, 1);
  w.sys.plugDevice('h1', so.id); w.sys.plugDevice('h2', so.id);
  return { w, so, cid:so.circuitId, bid:w.sys.circuit(so.circuitId).breakerId };
}
test('mild overload (4.4 kW on B16) does NOT trip immediately but does after a couple of hours', ()=>{
  const { w, bid } = loaded(2200); let tripAt = -1;
  for (let m = 1; m <= 400 && tripAt < 0; m++){ step(w, demand(w,{h1:2200,h2:2200})); if (w.sys.breaker(bid).state === 'tripped') tripAt = m; }
  assert(tripAt > 90 && tripAt < 300, 'tripped after '+tripAt+' min');
});
test('heavy overload (9 kW on B16) trips within a couple of minutes and cuts power to the devices', ()=>{
  const { w, bid } = loaded(4500); let tripAt = -1, res;
  for (let m = 1; m <= 10 && tripAt < 0; m++){ res = step(w, demand(w,{h1:4500,h2:4500})); if (w.sys.breaker(bid).state === 'tripped') tripAt = m; }
  assert(tripAt > 0 && tripAt <= 3, 'tripped after '+tripAt);
  assert(res.devices.get('h1').powerW === 0 && res.devices.get('h1').status === 'breakerTripped', 'devices lose power in the SAME minute');
  const ev = w.events.find(e => e.type === 'breakerTrip'); assert(ev && ev.reason === 'overload' && ev.ratio > 2);
  // stays dead until reset
  assert(step(w, demand(w,{h1:100,h2:100})).devices.get('h1').powerW === 0, 'remains off');
  w.sys.resetBreaker(bid); assert(step(w, demand(w,{h1:100,h2:100})).devices.get('h1').powerW === 100, 'back after reset');
});
test('a load within the rating never trips, even over many hours', ()=>{
  const { w, bid } = loaded(1700);   // 3.4 kW = 0.92 In
  for (let m = 0; m < 24*60; m++) step(w, demand(w,{h1:1700,h2:1700}));
  assert(w.sys.breaker(bid).state === 'closed'); assert(w.events.length === 0);
});
test('a short peak does not trip (thermal memory) and the heat decays afterwards', ()=>{
  const { w, bid } = loaded(2500);  // 5 kW = 1.36 In  -> t ~ 75 min
  for (let m = 0; m < 20; m++) step(w, demand(w,{h1:2500,h2:2500}));
  const hot = w.sys.heat.breaker[bid]; assert(hot > 0.1 && hot < 0.9, 'heat '+hot);
  for (let m = 0; m < 60; m++) step(w, demand(w,{h1:100,h2:100}));
  assert(w.sys.heat.breaker[bid] < hot * 0.1, 'cooled');
  assert(w.sys.breaker(bid).state === 'closed');
});
test('preview (accumulate=false) never changes thermal state or trips anything', ()=>{
  const { w, bid } = loaded(4500);
  for (let i = 0; i < 50; i++) step(w, demand(w,{h1:4500,h2:4500}), false);
  assert(w.sys.breaker(bid).state === 'closed' && !w.sys.heat.breaker[bid]);
});
test('main breaker protects the whole house: sum of circuits above 25 A trips main, everything goes dark', ()=>{
  const w = basic(); const a = w.sys.sockets('main')[0], b = w.sys.sockets('garage')[0];
  w.dev('x1',3000,'main',1,1); w.dev('x2',3000,'main',1,1); w.dev('y1',3000,'garage',1,1); w.dev('y2',3000,'garage',1,1);
  w.sys.plugDevice('x1',a.id); w.sys.plugDevice('x2',a.id); w.sys.plugDevice('y1',b.id); w.sys.plugDevice('y2',b.id);
  const dm = { x1:3000,x2:3000,y1:3000,y2:3000 };   // 12 kW = 52 A vs main 25 A
  let res, at = -1; for (let m = 1; m <= 30 && at < 0; m++){ res = step(w, demand(w, dm)); if (w.sys.data.mainBreaker.state === 'tripped') at = m; }
  assert(at > 0, 'main breaker must trip first (52 A vs 25 A main, while each circuit is only 1.6x)');
  assert(w.events.some(e=>e.type==='mainTrip' && e.reason==='overload'));
  assert([...res.devices.values()].every(v => v.powerW === 0 && v.status === 'mainTripped'), 'the whole house is dark in the same minute');
  assert(w.events.find(e=>e.type==='mainTrip').currentA >= 40, 'trip event carries the fault current');
  w.sys.resetMain(); assert(w.sys.data.mainBreaker.state === 'closed');
});
test('breaker too big for the cable: the CABLE overheats and is damaged (no breaker trip), circuit dies until repaired', ()=>{
  const w = basic(); const so = w.sys.sockets('main')[0]; const c = w.sys.circuit(so.circuitId);
  w.sys.setCircuitCable(c.id, 'ydy_3x1_5'); w.sys.setBreakerRating(c.breakerId, 32);   // 1.5 mm2 (15.5 A) behind a 32 A breaker
  w.sys.setMainBreaker(63);
  w.dev('h1', 2500, 'main'); w.dev('h2', 2500, 'main'); w.sys.plugDevice('h1', so.id); w.sys.plugDevice('h2', so.id);    // ~22 A = 1.4 x ampacity
  assert(w.sys.diagnostics().some(x => x.code === 'cableUndersized'), 'design warning raised');
  let damaged = -1; for (let m = 1; m <= 200 && damaged < 0; m++){ step(w, demand(w,{h1:2500,h2:2500})); if (w.events.some(e=>e.type==='cableOverheat')) damaged = m; }
  assert(damaged > 5 && damaged < 120, 'cable damaged after '+damaged);
  assert(w.sys.breaker(c.breakerId).state === 'closed', 'breaker did not trip - that is the danger');
  assert(step(w, demand(w,{h1:2500,h2:2500})).devices.get('h1').status === 'cableDamaged');
  const cost = w.sys.repairWire(w.sys.wireOf(so.id).id); assert(cost > 0 && w.sys.data.repairsCostZl === cost);
  assert(step(w, demand(w,{h1:100,h2:100})).devices.get('h1').powerW === 100);
  assert(w.sys.costBreakdown().items.some(i=>i.key==='repairs'), 'repair cost enters the project cost');
});
test('power strip cut-out: 10 A strip overloaded by a heater + kettle trips the strip, not the house', ()=>{
  const w = basic(); const so = w.sys.sockets('main')[0]; const strip = w.make('power_strip','main',{x:1,y:0,z:1}); w.sys.plugStrip(strip.id, so.id);
  w.dev('k',2200,'main'); w.dev('h',2000,'main'); w.sys.plugDevice('k', strip.id); w.sys.plugDevice('h', strip.id);   // 4.2 kW = 18 A on a 10 A strip
  let t = -1; for (let m = 1; m <= 30 && t < 0; m++){ step(w, demand(w,{k:2200,h:2000})); if (strip.runtime.status === 'tripped') t = m; }
  assert(t > 0 && t < 10, 'strip tripped after '+t);
  assert(step(w, demand(w,{k:2200,h:2000})).devices.get('k').status === 'stripTripped');
  assert(w.sys.data.mainBreaker.state === 'closed' && w.sys.data.breakers.every(b=>b.state==='closed'));
  w.sys.resetStrip(strip.id); assert(step(w, demand(w,{k:100,h:100})).devices.get('k').powerW === 100);
});
test('a switched-off strip cuts its devices', ()=>{
  const w = basic(); const so = w.sys.sockets('main')[0]; const strip = w.make('power_strip','main',{x:1,y:0,z:1}); w.sys.plugStrip(strip.id, so.id);
  w.dev('a',100,'main'); w.sys.plugDevice('a', strip.id); strip.enabled = false;
  assert(step(w, demand(w,{a:100}), false).devices.get('a').status === 'stripOff');
});
test('two circuits sharing one breaker add their currents on that breaker', ()=>{
  const w = basic(); const c0 = w.sys.data.circuits[0], c1 = w.sys.data.circuits[1]; w.sys.setCircuitBreaker(c1.id, c0.breakerId);
  const a = w.sys.sockets('main')[0], b = w.sys.sockets('garage')[0];
  w.dev('a',1800,'main'); w.dev('b',1800,'garage'); w.sys.plugDevice('a',a.id); w.sys.plugDevice('b',b.id);
  step(w, demand(w,{a:1800,b:1800}), false);
  assert(w.sys.rt.breakers[c0.breakerId].currentA > 15, 'shared breaker sees both: '+w.sys.rt.breakers[c0.breakerId].currentA);
});

// ---- diagnostics, trace, persistence ------------------------------------------------------
test('trace lists the whole supply chain with live values', ()=>{
  const w = basic(); const d = w.dev('pc', 420, 'main', 1.2, 0.3); w.sys.autoPlug(d); step(w, demand(w,{pc:420}), false);
  const chain = w.sys.trace('pc').map(n => n.type);
  assert(chain.join('>') === 'grid>meter>main>board>breaker>circuit>socket>device', chain.join('>'));
  const last = w.sys.trace('pc').pop(); assert(last.powerW === 420 && last.ok && last.currentA > 1.7);
  const strip = w.make('power_strip','main',{x:1,y:0,z:1}); w.sys.plugStrip(strip.id, d.plugTo); w.sys.unplugDevice('pc'); w.sys.plugDevice('pc', strip.id); step(w, demand(w,{pc:420}), false);
  assert(w.sys.trace('pc').map(n=>n.type).includes('strip'));
});
test('diagnostics: missing board, unwired socket, unplugged device (strict) are reported', ()=>{
  const w = world(); w.make('socket','main',{x:1,y:.3,z:0.055}); w.dev('lamp', 60);
  const codes = w.sys.diagnostics().map(x=>x.code);
  for (const c of ['noBoard','noMeter','socketNoCircuit','deviceUnplugged']) assert(codes.includes(c), 'missing '+c+' in '+codes);
});
test('serialize -> load round-trip keeps circuits, breakers (incl. tripped), wires, main rating, repairs', ()=>{
  const w = basic(); w.sys.setMainBreaker(32); w.sys.data.breakers[0].state = 'tripped'; w.sys.data.repairsCostZl = 55;
  const json = JSON.parse(JSON.stringify(w.sys.serialize())); const w2 = world(); w2.sys.load(json);
  assert(w2.sys.data.mainBreaker.ratingA === 32 && w2.sys.data.breakers[0].state === 'tripped' && w2.sys.data.repairsCostZl === 55);
  assert(w2.sys.data.circuits.length === 2 && w2.sys.data.wires.length === 8);
});
test('migrate: junk / missing / bad values fall back to safe defaults', ()=>{
  const m = $('ElectricalSystem.migrate({ mainBreaker:{ratingA:999}, breakers:[{id:"b",ratingA:7}], circuits:[{id:"c",cableId:"nope"}], wires:[{id:"w",route:"zzz"}] })');
  assert(m.mainBreaker.ratingA === 25 && m.breakers[0].ratingA === 16 && m.circuits[0].cableId === 'ydy_3x2_5' && m.wires[0].route === 'ceiling');
  assert($('ElectricalSystem.migrate(null)').strict === true);
});
test('remapIds rewrites wire endpoints after objects get new ids on load', ()=>{
  const d = $('ElectricalSystem.remapIds({ wires:[{fromId:"a",toId:"b"}] }, { a:"x1", b:"x2" })');
  assert(d.wires[0].fromId === 'x1' && d.wires[0].toId === 'x2');
});
test('prune removes wires of deleted sockets and dangling plugs', ()=>{
  const w = basic(); const so = w.sys.sockets('main')[0]; const d = w.dev('a',100); w.sys.plugDevice('a', so.id);
  w.els.splice(w.els.indexOf(so),1); w.sys.prune();
  assert(!w.sys.data.wires.some(x=>x.toId===so.id) && d.plugTo === null);
});
summary();
