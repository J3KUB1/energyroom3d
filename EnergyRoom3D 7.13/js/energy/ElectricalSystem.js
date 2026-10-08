/**
 * ELECTRICAL SYSTEM
 * The physical model of the house wiring, sitting between the appliances and the energy simulation:
 *
 *   GRID -> meter -> main breaker -> switchboard -> circuit breakers -> circuits -> cables -> sockets
 *        -> (power strips) -> devices
 *
 * What is modelled (per simulated minute, called by SimulationEngine):
 *  - every device is plugged into a socket or a power strip; strips are plugged into sockets;
 *  - every socket belongs to a circuit and is wired to the switchboard with a cable of a given cross-section
 *    and a length derived from the real 3D positions and the chosen routing (ceiling / floor / direct);
 *  - constant-power loads draw I = P / U; the cable's resistance makes U drop and burns I^2 R as heat
 *    (real energy that is billed, and shown as "installation losses");
 *  - miniature circuit breakers follow a thermal (inverse-time) curve plus a magnetic instant trip
 *    (B: 5 x In, C: 10 x In); an overload therefore does NOT trip instantly - a small overload takes hours, a big one seconds;
 *  - cables have their own thermal limit (ampacity): a breaker that is too big for its cable lets the cable overheat
 *    and be damaged; power strips have a cut-out; the main breaker protects the whole house;
 *  - a tripped protection de-energises everything downstream (devices lose power) until the user resets it;
 *  - installation cost (cables, sockets, board, breakers, labour) is computed from the real cable lengths.
 *
 * Pure logic: no THREE.js, no DOM.  Everything it needs from the scene comes through the `ctx` adapter
 * (elements, devices, rooms), so it is fully unit-testable.
 */
class ElectricalSystem {
  // ------------------------------------------------------------------ static physics
  /** Minutes an MCB tolerates a constant overload ratio r = I/In before its thermal element trips.
   *  0 = magnetic (instant) trip, Infinity = never (inside the conventional non-tripping current). */
  static tripTimeMin(r, curve){
    const mag = ({ B:5, C:10, D:20 })[curve] || 5;
    if (r >= mag) return 0;
    if (r <= 1.13) return Infinity;
    return ElectricalSystem._interp([[1.13,240],[1.45,60],[2.55,0.5],[mag,0.02]], r);
  }
  /** Minutes a cable survives a constant current of r x its ampacity. */
  static cableTimeMin(r){
    if (r <= 1.0) return Infinity;
    return ElectricalSystem._interp([[1.0,1500],[1.3,90],[2,10],[3,1.5],[6,0.1]], r);
  }
  /** Power-strip cut-out (a small thermal breaker, C-like). */
  static stripTimeMin(r){
    if (r <= 1.1) return Infinity;
    return ElectricalSystem._interp([[1.1,180],[1.5,30],[2.5,1],[5,0.05]], r);
  }
  static _interp(pts, r){
    if (r <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++){
      if (r <= pts[i][0]){
        const [r0,t0] = pts[i-1], [r1,t1] = pts[i];
        const f = (Math.log(r) - Math.log(r0)) / (Math.log(r1) - Math.log(r0));
        return Math.exp(Math.log(t0) + f * (Math.log(t1) - Math.log(t0)));
      }
    }
    return pts[pts.length-1][1];
  }
  /** Constant-power load through a cable of resistance R (loop, ohms): solves R I^2 - V0 I + P = 0.
   *  Returns { I, V, ok }. If the cable is so long/thin that the load cannot be delivered, ok=false (brown-out). */
  static solveCurrent(P, V0, R){
    if (P <= 0) return { I:0, V:V0, ok:true };
    if (R < 1e-9) return { I:P/V0, V:V0, ok:true };
    const disc = V0*V0 - 4*R*P;
    if (disc < 0) return { I:V0/(2*R), V:V0/2, ok:false };
    const I = (V0 - Math.sqrt(disc)) / (2*R);
    return { I, V:V0 - I*R, ok:true };
  }

  // ------------------------------------------------------------------ construction / persistence
  static fresh(){
    return {
      version: 1,
      strict: true,                                   // devices must be plugged into an energised socket/strip
      supplyVoltageV: ELECTRICAL_CONSTANTS.supplyVoltageV,
      mainBreaker: { ratingA: 25, curve:'B', state:'closed', tripReason:null },
      breakers: [],   // { id, name, ratingA, curve:'B'|'C', state:'closed'|'tripped', tripReason }
      circuits: [],   // { id, name, breakerId, cableId, kind:'sockets'|'lighting'|'dedicated', cableDamaged? }
      wires: [],      // { id, fromId (switchboard), toId (socket), route:'ceiling'|'floor'|'direct', cableId|null, damaged }
      repairsCostZl: 0,
      nextId: 1,
    };
  }
  /** Fills in anything missing so older / hand-edited saves always load. */
  static migrate(raw){
    const d = ElectricalSystem.fresh();
    if (!raw || typeof raw !== 'object') return d;
    if (typeof raw.strict === 'boolean') d.strict = raw.strict;
    if (raw.supplyVoltageV > 0) d.supplyVoltageV = raw.supplyVoltageV;
    if (raw.mainBreaker) d.mainBreaker = Object.assign(d.mainBreaker, raw.mainBreaker);
    if (!MAIN_BREAKER_RATINGS.includes(d.mainBreaker.ratingA)) d.mainBreaker.ratingA = 25;
    d.breakers = Array.isArray(raw.breakers) ? raw.breakers.map(b => ({ id:b.id, name:b.name||'', ratingA:BREAKER_RATINGS.includes(b.ratingA)?b.ratingA:16,
      curve: b.curve==='C' ? 'C' : 'B', state: b.state==='tripped' ? 'tripped' : 'closed', tripReason: b.tripReason||null })) : [];
    d.circuits = Array.isArray(raw.circuits) ? raw.circuits.map(c => ({ id:c.id, name:c.name||'', breakerId:c.breakerId||null,
      cableId: CABLE_TYPES.some(t=>t.id===c.cableId) ? c.cableId : 'ydy_3x2_5', kind:c.kind||'sockets', cableDamaged:false })) : [];
    d.wires = Array.isArray(raw.wires) ? raw.wires.map(w => ({ id:w.id, fromId:w.fromId, toId:w.toId,
      route: ['ceiling','floor','direct'].includes(w.route) ? w.route : 'ceiling', cableId: w.cableId || null, damaged: !!w.damaged })) : [];
    d.repairsCostZl = +raw.repairsCostZl || 0;
    d.nextId = Math.max(+raw.nextId || 1, 1);
    return d;
  }
  /** Rewrites element ids after a project load (ObjectManager assigns fresh ids to every object). */
  static remapIds(data, idMap){
    for (const w of data.wires){ w.fromId = idMap[w.fromId] || w.fromId; w.toId = idMap[w.toId] || w.toId; }
    return data;
  }

  /** ctx: { getElements(), getDevices(), getRooms(), createElement(defId, roomId, pos, rotY), removeElement(id), onEvent(ev) } */
  constructor(ctx){
    this.ctx = ctx;
    this.data = ElectricalSystem.fresh();
    this.rt = { circuits:{}, breakers:{}, main:{ currentA:0, ratio:0 }, lossW:0, devices:{} };
    this.heat = { breaker:{}, wire:{}, strip:{}, main:0 };
    this._resCache = new Map();
    this._mapNow = null; this._elsNow = null; this._stripsNow = null;
  }
  load(raw){ this._resCache = new Map(); this.data = ElectricalSystem.migrate(raw); this.heat = { breaker:{}, wire:{}, strip:{}, main:0 }; this.rt = { circuits:{}, breakers:{}, main:{ currentA:0, ratio:0 }, lossW:0, devices:{} }; }
  serialize(){ return JSON.parse(JSON.stringify(this.data)); }
  get hasInstallation(){ return this.data.breakers.length > 0 || this.data.circuits.length > 0 || !!this.board; }
  _id(prefix){ return prefix + '_' + (this.data.nextId++); }

  // ------------------------------------------------------------------ lookups
  // During resolve() (once per simulated minute) the element list/map are computed ONCE and reused; outside of it they are fresh.
  _els(){ return this._elsNow || this.ctx.getElements(); }
  _elMap(){ if (this._mapNow) return this._mapNow; const m = new Map(); for (const e of this._els()) m.set(e.id, e); return m; }
  get board(){ return this._els().find(e => e.defId === 'switchboard') || null; }
  get meter(){ return this._els().find(e => e.defId === 'meter') || null; }
  sockets(roomId){ return this._els().filter(e => e.def.type === 'socket' && (!roomId || e.roomId === roomId)); }
  strips(){ return this._stripsNow || this._els().filter(e => e.def.type === 'strip'); }
  breaker(id){ return this.data.breakers.find(b => b.id === id) || null; }
  circuit(id){ return this.data.circuits.find(c => c.id === id) || null; }
  wireOf(socketId){ return this.data.wires.find(w => w.toId === socketId) || null; }
  cableFor(socket){
    const w = this.wireOf(socket.id), c = this.circuit(socket.circuitId);
    return getCableType((w && w.cableId) || (c && c.cableId));
  }
  _room(id){ return (this.ctx.getRooms() || []).find(r => r.id === id) || { id, name:id, type:'room', offsetX:0, width:5, length:5, height:2.6 }; }
  /** World position of an element (rooms can sit at any X/Z on any storey): y and H are absolute, H = the room's ceiling. */
  _endpoint(e){
    const r = this._room(e.roomId), el = r.elevation || 0;
    return { x:r.offsetX + e.position.x, y:el + e.position.y, z:(r.offsetZ || 0) + e.position.z, H:el + (r.height || 2.6), elev:el, room:e.roomId };
  }

  // ------------------------------------------------------------------ geometry -> cable length
  /** Cable length (m) of a wire: routing-dependent Manhattan path plus slack, terminations and wall passages. */
  wireLengthM(wire){
    const map = this._elMap(), a = map.get(wire.fromId), b = map.get(wire.toId);
    if (!a || !b) return 0;
    const A = this._endpoint(a), B = this._endpoint(b);
    const dx = Math.abs(A.x - B.x), dz = Math.abs(A.z - B.z), dy = Math.abs(A.y - B.y);
    let len;
    if (wire.route === 'direct') len = Math.hypot(dx, dy, dz);
    else if (wire.route === 'floor'){ const Hf = Math.min(A.elev, B.elev) + 0.03; len = Math.abs(A.y - Hf) + dx + dz + Math.abs(B.y - Hf); }
    else { const Hr = Math.min(A.H, B.H); len = Math.abs(Hr - A.y) + dx + dz + Math.abs(Hr - B.y); }   // between storeys the cable runs in the slab of the lower one
    len = len * ELECTRICAL_CONSTANTS.cableSlackFactor + 2 * ELECTRICAL_CONSTANTS.terminationExtraM;
    if (A.room !== B.room) len += ELECTRICAL_CONSTANTS.interRoomExtraM;
    return len;
  }
  /** The wire's route as a polyline of world-space points [{x,y,z}] (what WireRenderer draws; same geometry
   *  as wireLengthM, so the picture and the priced/measured length always agree). */
  wirePath(wire){
    const map = this._elMap(), a = map.get(wire.fromId), b = map.get(wire.toId);
    if (!a || !b) return [];
    const A = this._endpoint(a), B = this._endpoint(b);
    const P = (x, y, z) => ({ x, y, z });
    if (wire.route === 'direct') return [P(A.x,A.y,A.z), P(B.x,B.y,B.z)];
    const level = wire.route === 'floor' ? Math.min(A.elev, B.elev) + 0.03 : null, Hr = Math.min(A.H, B.H);
    const ya = level == null ? Hr - 0.08 : level, yb = ya;
    return [P(A.x,A.y,A.z), P(A.x,ya,A.z), P(B.x,ya,A.z), P(B.x,ya,B.z), P(B.x,yb,B.z), P(B.x,B.y,B.z)];
  }
  /** Loop resistance (ohms) of the phase + neutral conductors of one wire. */
  wireResistance(wire, cable){
    // cached per wire and validated by the two endpoints' positions + route + cross-section, so it is recomputed only
    // when something actually moved (a 365-day run would otherwise redo the geometry 500 000 times)
    const map = this._elMap(), a = map.get(wire.fromId), b = map.get(wire.toId);
    if (!a || !b) return 0;
    const c = this._resCache.get(wire.id), ap = a.position, bp = b.position;
    if (c && c.ax === ap.x && c.ay === ap.y && c.az === ap.z && c.bx === bp.x && c.by === bp.y && c.bz === bp.z &&
        c.ra === a.roomId && c.rb === b.roomId && c.route === wire.route && c.sec === cable.sectionMm2) return c.R;
    const R = ELECTRICAL_CONSTANTS.copperResistivity * 2 * this.wireLengthM(wire) / cable.sectionMm2;
    this._resCache.set(wire.id, { ax:ap.x, ay:ap.y, az:ap.z, bx:bp.x, by:bp.y, bz:bp.z, ra:a.roomId, rb:b.roomId, route:wire.route, sec:cable.sectionMm2, R }); return R;
  }

  // ------------------------------------------------------------------ editing API
  addBreaker(o){
    const b = { id:this._id('br'), name:(o&&o.name)||'', ratingA:BREAKER_RATINGS.includes(o&&o.ratingA)?o.ratingA:16, curve:(o&&o.curve)==='C'?'C':'B', state:'closed', tripReason:null };
    this.data.breakers.push(b); return b;
  }
  addCircuit(o){
    o = o || {};
    let breakerId = o.breakerId;
    if (breakerId === undefined) breakerId = this.addBreaker({ name:o.name, ratingA:o.ratingA, curve:o.curve }).id;
    const c = { id:this._id('ci'), name:o.name||'', breakerId, cableId:CABLE_TYPES.some(t=>t.id===o.cableId)?o.cableId:ELECTRICAL_CONSTANTS.defaultSocketCable, kind:o.kind||'sockets', cableDamaged:false };
    this.data.circuits.push(c); return c;
  }
  /** Removes a circuit; its sockets become unassigned and the breaker is dropped if nothing else uses it. */
  removeCircuit(id){
    const c = this.circuit(id); if (!c) return;
    this.data.circuits = this.data.circuits.filter(x => x.id !== id);
    for (const s of this.sockets()) if (s.circuitId === id) s.circuitId = null;
    if (c.breakerId && !this.data.circuits.some(x => x.breakerId === c.breakerId)) this.data.breakers = this.data.breakers.filter(b => b.id !== c.breakerId);
  }
  setBreakerRating(breakerId, ratingA, curve){
    const b = this.breaker(breakerId); if (!b) return;
    if (BREAKER_RATINGS.includes(ratingA)) b.ratingA = ratingA;
    if (curve === 'B' || curve === 'C') b.curve = curve;
    delete this.heat.breaker[breakerId];
  }
  setCircuitBreaker(circuitId, breakerId){ const c = this.circuit(circuitId); if (c && (breakerId === null || this.breaker(breakerId))) c.breakerId = breakerId; }
  setCircuitCable(circuitId, cableId){ const c = this.circuit(circuitId); if (c && CABLE_TYPES.some(t => t.id === cableId)) c.cableId = cableId; }
  setMainBreaker(ratingA){ if (MAIN_BREAKER_RATINGS.includes(ratingA)){ this.data.mainBreaker.ratingA = ratingA; this.heat.main = 0; } }
  assignSocketCircuit(socketId, circuitId){
    const s = this._elMap().get(socketId);
    if (!s || s.def.type !== 'socket') return false;
    if (circuitId !== null && !this.circuit(circuitId)) return false;
    s.circuitId = circuitId; return true;
  }
  /** Connects a socket to the switchboard with a cable (replaces an existing wire of that socket). */
  wire(socketId, o){
    o = o || {};
    const board = this.board, s = this._elMap().get(socketId);
    if (!board || !s || s.def.type !== 'socket') return null;
    this.unwire(socketId);
    const w = { id:this._id('w'), fromId:board.id, toId:socketId, route:['ceiling','floor','direct'].includes(o.route)?o.route:'ceiling', cableId:o.cableId||null, damaged:false };
    this.data.wires.push(w); return w;
  }
  unwire(socketId){ this.data.wires = this.data.wires.filter(w => w.toId !== socketId); }
  setWireRoute(socketId, route){ const w = this.wireOf(socketId); if (w && ['ceiling','floor','direct'].includes(route)) w.route = route; }
  /** Wires every un-wired socket that belongs to a circuit. Returns the number of new wires. */
  autoWire(route){
    let n = 0;
    for (const s of this.sockets()) if (!this.wireOf(s.id) && s.circuitId){ if (this.wire(s.id, { route })) n++; }
    return n;
  }
  /** Outlets currently used on a socket (its plugs + strips) or a strip. */
  usedOutlets(targetId){
    let n = 0;
    for (const d of this.ctx.getDevices()) if (d.plugTo === targetId) n++;
    for (const st of this.strips()) if (st.plugTo === targetId) n++;
    return n;
  }
  freeOutlets(targetId){ const e = this._elMap().get(targetId); return e ? e.def.outlets - this.usedOutlets(targetId) : 0; }
  plugDevice(deviceId, targetId){
    const dev = this.ctx.getDevices().find(d => d.id === deviceId), t = this._elMap().get(targetId);
    if (!dev || !t || !['socket','strip'].includes(t.def.type)) return false;
    if (dev.plugTo !== targetId && this.freeOutlets(targetId) <= 0) return false;
    dev.plugTo = targetId; return true;
  }
  unplugDevice(deviceId){ const dev = this.ctx.getDevices().find(d => d.id === deviceId); if (dev) dev.plugTo = null; }
  plugStrip(stripId, socketId){
    const st = this._elMap().get(stripId), so = this._elMap().get(socketId);
    if (!st || st.def.type !== 'strip' || !so || so.def.type !== 'socket') return false;
    if (st.plugTo !== socketId && this.freeOutlets(socketId) <= 0) return false;
    st.plugTo = socketId; return true;
  }
  /** Plugs a device into the nearest socket of its room that still has a free outlet. */
  autoPlug(dev){
    let best = null, bd = Infinity;
    for (const s of this.sockets(dev.roomId)){
      if (this.freeOutlets(s.id) <= 0) continue;
      const d = Math.hypot(s.position.x - dev.position.x, s.position.z - dev.position.z);
      if (d < bd){ bd = d; best = s; }
    }
    if (best){ dev.plugTo = best.id; return best.id; }
    return null;
  }
  resetBreaker(id){ const b = this.breaker(id); if (b){ b.state = 'closed'; b.tripReason = null; this.heat.breaker[id] = 0; } }
  resetMain(){ this.data.mainBreaker.state = 'closed'; this.data.mainBreaker.tripReason = null; this.heat.main = 0; }
  resetStrip(id){ const e = this._elMap().get(id); if (e){ e.runtime.status = null; this.heat.strip[id] = 0; e.enabled = true; } }
  /** Replaces an overheated cable. Returns the cost (PLN), also added to the project's repair costs. */
  repairWire(wireId){
    const w = this.data.wires.find(x => x.id === wireId); if (!w) return 0;
    const s = this._elMap().get(w.toId); const cab = s ? this.cableFor(s) : getCableType(w.cableId);
    const cost = this.wireLengthM(w) * (cab.priceZlPerM + cab.laborZlPerM);
    w.damaged = false; this.heat.wire[wireId] = 0; this.data.repairsCostZl += cost; return cost;
  }
  /** Drops references to elements that no longer exist (deleted objects, removed rooms). */
  prune(){
    const map = this._elMap();
    this.data.wires = this.data.wires.filter(w => map.has(w.fromId) && map.has(w.toId));
    for (const e of map.values()){
      if (e.def.type === 'socket' && e.circuitId && !this.circuit(e.circuitId)) e.circuitId = null;
      if (e.def.type === 'strip' && e.plugTo && !map.has(e.plugTo)) e.plugTo = null;
    }
    for (const d of this.ctx.getDevices()) if (d.plugTo && !map.has(d.plugTo)) d.plugTo = null;
    const live = new Set(this.data.breakers.map(b => b.id));
    for (const c of this.data.circuits) if (c.breakerId && !live.has(c.breakerId)) c.breakerId = null;
  }

  // ------------------------------------------------------------------ automatic installation
  static socketLayout(W, L){ // the four wall sockets every room used to show as decoration, now real objects
    return [ { x:1.2, z:0.055, rotY:0 }, { x:W-1.2, z:0.055, rotY:0 }, { x:0.055, z:1.2, rotY:Math.PI/2 }, { x:0.055, z:L-1.2, rotY:Math.PI/2 } ];
  }
  static breakerFor(ratedW, V){ // smallest standard breaker that carries the load continuously (I <= 0.9 In)
    const need = ratedW / (V || 230) / 0.9;
    return BREAKER_RATINGS.find(r => r >= need) || 40;
  }
  static cableFor(ratingA){ const c = CABLE_TYPES.find(t => t.ampacityA >= ratingA); return (c || CABLE_TYPES[CABLE_TYPES.length-1]).id; }

  /** Makes sure the house has a meter + switchboard, and every room has sockets on a circuit. Idempotent. */
  autoInstall(){
    const rooms = this.ctx.getRooms() || []; if (!rooms.length) return;
    const first = rooms[0];
    if (!this.meter) this.ctx.createElement('meter', first.id, { x:1.3, y:1.5, z:0.06 }, 0);
    if (!this.board) this.ctx.createElement('switchboard', first.id, { x:0.55, y:1.5, z:0.06 }, 0);
    for (const r of rooms) this.ensureRoom(r);
    // heavy appliances get their own circuit + socket (they would trip a 16 A socket circuit)
    for (const d of this.ctx.getDevices()){
      if (d.plugTo) continue;
      if ((d.def.ratedPowerW || 0) >= ELECTRICAL_CONSTANTS.dedicatedCircuitThresholdW) this.addDedicatedCircuit(d);
    }
    for (const d of this.ctx.getDevices()) if (!d.plugTo) this.autoPlug(d);
    this.autoWire();
  }
  /** Sockets + a socket circuit for one room (used at project migration and when a room is added). */
  ensureRoom(room){
    let sockets = this.sockets(room.id);
    if (!sockets.length){
      for (const p of ElectricalSystem.socketLayout(room.width, room.length)){
        const s = this.ctx.createElement('socket', room.id, { x:p.x, y:0.30, z:p.z }, p.rotY);
        if (s) sockets.push(s);
      }
    }
    const unassigned = sockets.filter(s => !s.circuitId || !this.circuit(s.circuitId));
    if (unassigned.length){
      const c = this.addCircuit({ name:(room.name || room.id), ratingA:ELECTRICAL_CONSTANTS.defaultSocketCircuitBreakerA, cableId:ELECTRICAL_CONSTANTS.defaultSocketCable, kind:'sockets' });
      for (const s of unassigned) s.circuitId = c.id;
    }
  }
  /** Call BEFORE a room's objects are removed: drops the circuits that only served that room's sockets. */
  dropRoomCircuits(roomId){
    const ids = new Set(this.sockets(roomId).map(s => s.circuitId).filter(Boolean));
    for (const cid of ids){
      const stillUsed = this.sockets().some(s => s.roomId !== roomId && s.circuitId === cid);
      if (!stillUsed) this.removeCircuit(cid);
    }
  }
  addDedicatedCircuit(dev){
    const V = this.data.supplyVoltageV, rating = ElectricalSystem.breakerFor(dev.def.ratedPowerW, V);
    const s = this.ctx.createElement('socket', dev.roomId, { x:dev.position.x, y:0.30, z:Math.max(0.055, Math.min(dev.position.z, 0.055)) }, 0);
    if (!s) return null;
    const c = this.addCircuit({ name:'', ratingA:rating, cableId:ElectricalSystem.cableFor(rating), kind:'dedicated' });
    c.deviceId = dev.id;
    s.circuitId = c.id; dev.plugTo = s.id; return c;
  }

  // ------------------------------------------------------------------ simulation step
  /**
   * devs: [{ id, desiredW, connected }] - the appliances' demand this minute (already resolved by schedules/automation).
   * opts.accumulate: true = advance thermal state and allow trips (a real simulated minute); false = read-only preview.
   * Returns { devices: Map(id -> { powerW, status, voltageV }), lossW, events[] } and fills this.rt.
   */
  resolve(devs, opts){
    this._elsNow = this.ctx.getElements();
    this._mapNow = new Map(); for (const e of this._elsNow) this._mapNow.set(e.id, e);
    this._stripsNow = this._elsNow.filter(e => e.def.type === 'strip');
    try { return this._resolve(devs, opts); }
    finally { this._elsNow = null; this._mapNow = null; this._stripsNow = null; }
  }
  _resolve(devs, opts){
    const accumulate = !!(opts && opts.accumulate);
    const d = this.data, events = [];
    const dead = { breakers:new Set(), wires:new Set(), strips:new Set(), main:false };
    for (const b of d.breakers) if (b.state === 'tripped') dead.breakers.add(b.id);
    for (const w of d.wires) if (w.damaged) dead.wires.add(w.id);
    if (d.mainBreaker.state === 'tripped') dead.main = true;
    for (const st of this.strips()) if (st.runtime && st.runtime.status === 'tripped') dead.strips.add(st.id);

    let pass = this._evaluate(devs, dead);
    if (accumulate){
      const newly = this._thermal(pass, dead, events);
      if (newly) pass = this._evaluate(devs, dead);     // re-solve with the freshly tripped protections open
    }
    if (!(opts && opts.publish === false)) this._publish(pass, dead);
    for (const ev of events) if (this.ctx.onEvent) this.ctx.onEvent(ev);
    return { devices:pass.devices, lossW:pass.lossW, events };
  }

  /** One consistent electrical solution for the given set of open (dead) protections. */
  _evaluate(devs, dead){
    const d = this.data, V0 = d.supplyVoltageV, map = this._elMap();
    const devices = new Map();
    const stripP = new Map(), socketP = new Map(), socketDevs = new Map();
    const supplyOk = !!(this.board && this.meter);
    const addTo = (m, k, p) => m.set(k, (m.get(k) || 0) + p);

    for (const dv of devs){
      const P = Math.max(0, dv.desiredW || 0);
      const t = dv.plugTo ? map.get(dv.plugTo) : null;
      if (!t){ devices.set(dv.id, { powerW: d.strict ? 0 : P, status: d.strict ? 'unassigned' : 'legacy', voltageV:V0, desiredW:P }); continue; }
      if (dv.connected === false){ devices.set(dv.id, { powerW:0, status:'unplugged', voltageV:0, desiredW:P }); continue; }
      let socket = t, strip = null;
      if (t.def.type === 'strip'){
        strip = t;
        if (t.enabled === false){ devices.set(dv.id, { powerW:0, status:'stripOff', voltageV:0, desiredW:P }); continue; }
        if (dead.strips.has(t.id)){ devices.set(dv.id, { powerW:0, status:'stripTripped', voltageV:0, desiredW:P }); continue; }
        socket = t.plugTo ? map.get(t.plugTo) : null;
        if (!socket){ devices.set(dv.id, { powerW:0, status:'stripNotPlugged', voltageV:0, desiredW:P }); continue; }
      }
      devices.set(dv.id, { powerW:P, status:'pending', voltageV:V0, desiredW:P, socketId:socket.id, stripId:strip ? strip.id : null });
      if (strip) addTo(stripP, strip.id, P);
      addTo(socketP, socket.id, P);
      if (!socketDevs.has(socket.id)) socketDevs.set(socket.id, []);
      socketDevs.get(socket.id).push(dv.id);
    }

    // per-socket energisation + current through its own cable
    const sockets = new Map(); let lossW = 0; const circuitAgg = new Map(); const breakerAgg = new Map(); let mainI = 0;
    for (const [sid, P] of socketP){
      const s = map.get(sid); const w = this.wireOf(sid), c = s.circuitId ? this.circuit(s.circuitId) : null, b = c && c.breakerId ? this.breaker(c.breakerId) : null;
      let status = 'ok';
      if (!supplyOk) status = 'noSupply';
      else if (dead.main) status = 'mainTripped';
      else if (!c) status = 'noCircuit';
      else if (!b) status = 'noBreaker';
      else if (dead.breakers.has(b.id)) status = 'breakerTripped';
      else if (!w) status = 'noWire';
      else if (dead.wires.has(w.id)) status = 'cableDamaged';
      const rec = { P:0, I:0, V:0, lossW:0, status, socket:s, wire:w, circuit:c, breaker:b };
      if (status === 'ok'){
        const cab = this.cableFor(s), R = this.wireResistance(w, cab);
        const sol = ElectricalSystem.solveCurrent(P, V0, R);
        rec.P = P; rec.I = sol.I; rec.V = sol.V; rec.lossW = sol.I * sol.I * R; rec.cable = cab; rec.brownout = !sol.ok;
        lossW += rec.lossW; mainI += sol.I;
        const ca = circuitAgg.get(c.id) || { I:0, P:0, lossW:0, vMin:V0 }; ca.I += sol.I; ca.P += P; ca.lossW += rec.lossW; ca.vMin = Math.min(ca.vMin, sol.V); circuitAgg.set(c.id, ca);
        const ba = breakerAgg.get(b.id) || { I:0 }; ba.I += sol.I; breakerAgg.set(b.id, ba);
      }
      sockets.set(sid, rec);
      for (const did of socketDevs.get(sid)){
        const dv = devices.get(did);
        if (status === 'ok') dv.voltageV = rec.V; else { dv.powerW = 0; dv.status = status; dv.voltageV = 0; }
      }
    }
    for (const dv of devices.values()) if (dv.status === 'pending') dv.status = 'ok';
    return { devices, sockets, circuitAgg, breakerAgg, stripP, mainI, lossW, V0 };
  }

  /** Advances thermal models with this minute's currents; returns true if any protection opened. */
  _thermal(pass, dead, events){
    const d = this.data; let opened = false;
    const step = (store, key, ratio, tripMin, decayTau) => {
      let h = store[key] || 0;
      if (tripMin === 0) h = 1;
      else if (isFinite(tripMin)) h += 1 / tripMin;
      else if (ratio < 1) h *= Math.exp(-1 / decayTau); else h *= Math.exp(-1 / (decayTau * 4));
      store[key] = Math.min(h, 1); return h >= 1;
    };
    // circuit breakers
    for (const b of d.breakers){
      if (dead.breakers.has(b.id)) { this.heat.breaker[b.id] = 0; continue; }
      const agg = pass.breakerAgg.get(b.id), I = agg ? agg.I : 0, ratio = I / b.ratingA;
      const t = ElectricalSystem.tripTimeMin(ratio, b.curve);
      if (step(this.heat.breaker, b.id, ratio, t, 15)){
        b.state = 'tripped'; b.tripReason = t === 0 ? 'shortCircuit' : 'overload'; dead.breakers.add(b.id); opened = true;
        events.push({ type:'breakerTrip', breakerId:b.id, circuitIds:d.circuits.filter(c => c.breakerId === b.id).map(c => c.id), reason:b.tripReason, currentA:I, ratio });
      }
    }
    // cables (per wire)
    for (const rec of pass.sockets.values()){
      if (rec.status !== 'ok' || !rec.wire || dead.wires.has(rec.wire.id)) continue;
      const ratio = rec.I / rec.cable.ampacityA;
      if (step(this.heat.wire, rec.wire.id, ratio, ElectricalSystem.cableTimeMin(ratio), 30)){
        rec.wire.damaged = true; dead.wires.add(rec.wire.id); opened = true;
        events.push({ type:'cableOverheat', wireId:rec.wire.id, socketId:rec.socket.id, circuitId:rec.circuit.id, currentA:rec.I, ratio });
      }
    }
    // power strips
    for (const [sid, P] of pass.stripP){
      const st = this._elMap().get(sid); if (!st || dead.strips.has(sid)) continue;
      const ratio = (P / pass.V0) / st.def.ratedA;
      if (step(this.heat.strip, sid, ratio, ElectricalSystem.stripTimeMin(ratio), 12)){
        st.runtime.status = 'tripped'; dead.strips.add(sid); opened = true;
        events.push({ type:'stripTrip', elementId:sid, currentA:P/pass.V0, ratio });
      }
    }
    // main breaker
    if (!dead.main){
      const ratio = pass.mainI / d.mainBreaker.ratingA, t = ElectricalSystem.tripTimeMin(ratio, d.mainBreaker.curve);
      if (step(this.heat, 'main', ratio, t, 15)){
        d.mainBreaker.state = 'tripped'; d.mainBreaker.tripReason = t === 0 ? 'shortCircuit' : 'overload'; dead.main = true; opened = true;
        events.push({ type:'mainTrip', reason:d.mainBreaker.tripReason, currentA:pass.mainI, ratio });
      }
    }
    return opened;
  }

  /** Stores the solution for the UI / flow tracing (per circuit, breaker, socket, element runtime). */
  _publish(pass, dead){
    const d = this.data;
    this.rt.circuits = {}; this.rt.breakers = {};
    for (const c of d.circuits){
      const a = pass.circuitAgg.get(c.id) || { I:0, P:0, lossW:0, vMin:d.supplyVoltageV };
      const b = c.breakerId ? this.breaker(c.breakerId) : null;
      const cab = getCableType(c.cableId);
      this.rt.circuits[c.id] = { currentA:a.I, powerW:a.P, lossW:a.lossW, voltageV:a.vMin, maxA: b ? Math.min(b.ratingA, cab.ampacityA) : 0,
        maxW: b ? Math.min(b.ratingA, cab.ampacityA) * d.supplyVoltageV : 0, breakerState: b ? b.state : 'none' };
    }
    for (const b of d.breakers){
      const agg = pass.breakerAgg.get(b.id) || { I:0 };
      this.rt.breakers[b.id] = { currentA:agg.I, ratio:agg.I / b.ratingA, heat:this.heat.breaker[b.id] || 0 };
    }
    this.rt.main = { currentA:pass.mainI, ratio:pass.mainI / d.mainBreaker.ratingA, heat:this.heat.main || 0 };
    this.rt.lossW = pass.lossW;
    this.rt.devices = {};
    for (const [id, v] of pass.devices) this.rt.devices[id] = v;
    for (const e of this._els()){
      if (e.def.type === 'socket'){
        const r = pass.sockets.get(e.id);
        const live = r ? r.status === 'ok' : this._socketEnergised(e, dead);
        e.runtime.state = live ? 'live' : 'off'; e.runtime.currentA = r ? r.I : 0; e.runtime.voltageV = live ? (r ? r.V : d.supplyVoltageV) : 0;
        e.runtime.status = r && r.status !== 'ok' ? r.status : (live ? 'ok' : this._socketFault(e, dead));
      } else if (e.def.type === 'strip'){
        const P = pass.stripP.get(e.id) || 0;
        e.runtime.currentA = P / d.supplyVoltageV;
        e.runtime.state = (e.enabled !== false && !dead.strips.has(e.id) && e.runtime.status !== 'tripped') ? 'live' : 'off';
      } else if (e.def.type === 'board'){
        e.runtime.state = dead.main ? 'off' : 'live';
      } else if (e.def.type === 'meter'){
        e.runtime.state = 'live';
      }
    }
  }
  _socketFault(s, dead){
    const c = s.circuitId ? this.circuit(s.circuitId) : null, b = c && c.breakerId ? this.breaker(c.breakerId) : null, w = this.wireOf(s.id);
    if (!(this.board && this.meter)) return 'noSupply';
    if (dead.main) return 'mainTripped';
    if (!c) return 'noCircuit'; if (!b) return 'noBreaker'; if (dead.breakers.has(b.id)) return 'breakerTripped';
    if (!w) return 'noWire'; if (dead.wires.has(w.id)) return 'cableDamaged';
    return 'ok';
  }
  _socketEnergised(s, dead){ return this._socketFault(s, dead) === 'ok'; }

  // ------------------------------------------------------------------ diagnostics, trace, cost
  /** Design problems the user should know about (each item: {level, code, params}). */
  diagnostics(){
    const out = [], d = this.data, map = this._elMap();
    if (!this.board) out.push({ level:'error', code:'noBoard' });
    if (!this.meter) out.push({ level:'error', code:'noMeter' });
    for (const s of this.sockets()){
      const c = s.circuitId ? this.circuit(s.circuitId) : null;
      if (!c) out.push({ level:'warning', code:'socketNoCircuit', params:{ id:s.id } });
      else if (!this.wireOf(s.id)) out.push({ level:'warning', code:'socketNoWire', params:{ id:s.id } });
    }
    for (const c of d.circuits){
      const b = c.breakerId ? this.breaker(c.breakerId) : null, cab = getCableType(c.cableId);
      if (!b) out.push({ level:'warning', code:'circuitNoBreaker', params:{ circuit:c.name || c.id } });
      else if (b.ratingA > cab.ampacityA) out.push({ level:'error', code:'cableUndersized', params:{ circuit:c.name || c.id, breaker:b.ratingA, cable:cab.label, ampacity:cab.ampacityA } });
    }
    const totalBreakers = d.breakers.reduce((n, b) => n + b.ratingA, 0);
    if (totalBreakers > d.mainBreaker.ratingA * 3) out.push({ level:'info', code:'mainSmall', params:{ main:d.mainBreaker.ratingA } });
    for (const dv of this.ctx.getDevices()){
      if (!dv.plugTo || !map.has(dv.plugTo)) out.push({ level: d.strict ? 'warning' : 'info', code:'deviceUnplugged', params:{ id:dv.id, name:dv.customName || (dv.def && dv.def.name) } });
    }
    for (const w of d.wires) if (w.damaged) out.push({ level:'error', code:'cableDamaged', params:{ id:w.id } });
    for (const b of d.breakers) if (b.state === 'tripped') out.push({ level:'error', code:'breakerTripped', params:{ breaker:b.name || b.id } });
    if (d.mainBreaker.state === 'tripped') out.push({ level:'error', code:'mainTripped' });
    return out;
  }

  /** Supply chain of one device (for the "energy flow" view): [{ type, id?, label?, ok, powerW?, currentA?, voltageV? }]. */
  trace(deviceId){
    const dv = this.ctx.getDevices().find(x => x.id === deviceId); if (!dv) return [];
    const map = this._elMap(), r = this.rt.devices[deviceId] || { powerW:0, status:'unassigned', voltageV:0 };
    const chain = [{ type:'grid', ok:true }];
    const meter = this.meter, board = this.board, d = this.data;
    chain.push({ type:'meter', id:meter && meter.id, ok:!!meter });
    chain.push({ type:'main', ratingA:d.mainBreaker.ratingA, ok:d.mainBreaker.state === 'closed', currentA:this.rt.main.currentA });
    chain.push({ type:'board', id:board && board.id, ok:!!board });
    const t = dv.plugTo ? map.get(dv.plugTo) : null;
    const socket = t ? (t.def.type === 'strip' ? (t.plugTo ? map.get(t.plugTo) : null) : t) : null;
    const c = socket && socket.circuitId ? this.circuit(socket.circuitId) : null, b = c && c.breakerId ? this.breaker(c.breakerId) : null;
    if (b) chain.push({ type:'breaker', id:b.id, ratingA:b.ratingA, ok:b.state === 'closed', currentA:(this.rt.breakers[b.id] || {}).currentA });
    if (c) chain.push({ type:'circuit', id:c.id, label:c.name, ok:true, currentA:(this.rt.circuits[c.id] || {}).currentA });
    if (socket) chain.push({ type:'socket', id:socket.id, ok:socket.runtime.state === 'live', voltageV:socket.runtime.voltageV, currentA:socket.runtime.currentA });
    if (t && t.def.type === 'strip') chain.push({ type:'strip', id:t.id, ok:t.runtime.state === 'live', currentA:t.runtime.currentA });
    chain.push({ type:'device', id:dv.id, ok:r.status === 'ok' || r.status === 'legacy', powerW:r.powerW, voltageV:r.voltageV, currentA: r.voltageV > 0 ? r.powerW / r.voltageV : 0, status:r.status });
    return chain;
  }

  /** Installation cost: itemised, from the real cable lengths and the placed elements. */
  costBreakdown(){
    const d = this.data, items = [];
    const push = (key, qty, unit, material, labor, extra) => { if (qty > 0) items.push(Object.assign({ key, qty, unitZl:material + labor, materialZl:material * qty, laborZl:labor * qty, totalZl:(material + labor) * qty }, extra || {})); };
    const count = t => this._els().filter(e => e.def.type === t).length;
    const one = id => getElectricalDefinition(id);
    push('socket', count('socket'), 'pcs', one('socket').priceZl, one('socket').laborZl);
    push('strip', count('strip'), 'pcs', one('power_strip').priceZl, one('power_strip').laborZl);
    push('board', count('board'), 'pcs', one('switchboard').priceZl, one('switchboard').laborZl);
    push('meter', count('meter'), 'pcs', one('meter').priceZl, one('meter').laborZl);
    push('mainBreaker', this.board ? 1 : 0, 'pcs', MAIN_BREAKER_PRICES_ZL[d.mainBreaker.ratingA] || 48, BREAKER_LABOR_ZL, { ratingA:d.mainBreaker.ratingA });
    for (const b of d.breakers) push('breaker', 1, 'pcs', BREAKER_PRICES_ZL[b.ratingA] || 18, BREAKER_LABOR_ZL, { ratingA:b.ratingA, curve:b.curve, name:b.name });
    const byCable = {};
    for (const w of d.wires){
      const s = this._elMap().get(w.toId); if (!s) continue;
      const cab = this.cableFor(s), len = this.wireLengthM(w);
      const e = byCable[cab.id] || (byCable[cab.id] = { cab, len:0 }); e.len += len;
    }
    for (const id in byCable){ const { cab, len } = byCable[id]; push('cable', len, 'm', cab.priceZlPerM, cab.laborZlPerM, { cableId:id, label:cab.label }); }
    if (d.repairsCostZl > 0) items.push({ key:'repairs', qty:1, unitZl:d.repairsCostZl, materialZl:d.repairsCostZl, laborZl:0, totalZl:d.repairsCostZl });
    const totalZl = items.reduce((n, i) => n + i.totalZl, 0);
    const cableM = Object.values(byCable).reduce((n, e) => n + e.len, 0);
    return { items, totalZl, cableM, amortizedPerYearZl: totalZl / ELECTRICAL_CONSTANTS.designLifeYears };
  }
}
