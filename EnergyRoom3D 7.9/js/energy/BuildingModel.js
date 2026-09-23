/**
 * BUILDING MODEL
 * The "house designer" data model and everything derived from it, as pure functions (no THREE.js, no DOM):
 *
 *   levels (Parter / Piętro 1 / Piwnica ...)  ->  rooms stacked on them  ->  walls, doors, windows, partitions,
 *   stairs, roof  ->  ENVELOPE: areas, U-values, UA (W/K), ventilation, thermal mass, solar-gain geometry
 *                 ->  SHADING geometry (ShadeModel occluders) so upper floors / roofs shade PV panels
 *
 * World axes (same as ShadeModel / SunPosition): +X = East, -Z = North, +Y = up.
 * Rooms are axis-aligned boxes; `offsetX` / `offsetZ` is the room's NW corner on its level, `levelId` picks the elevation.
 * Wall sides: N (z = 0), E (x = W), S (z = L), W (x = 0). Positions along a wall are measured walking CLOCKWISE seen from
 * above, starting at the wall's first corner:  N: west->east,  E: north->south,  S: east->west,  W: south->north.
 * An opening's `pos` is the distance from that first corner to the opening's start.
 *
 * The thermal quantities computed here (UA, ventilation, thermal mass, window solar gain, couplings between rooms) are
 * exactly what the room temperature model (Etap 4) integrates; nothing here is decorative.
 */
const BuildingModel = {
  SIDES: ['N','E','S','W'],
  OUTWARD_AZIMUTH: { N:0, E:90, S:180, W:270 },   // compass bearing of a wall's outward normal
  FACING_YAW: { S:0, E:Math.PI/2, N:Math.PI, W:-Math.PI/2 },  // yaw that turns a roof's "low edge" (+Z) toward that side
  OPPOSITE: { N:'S', S:'N', E:'W', W:'E' },

  // ------------------------------------------------------------------ small helpers
  isOutdoor(room){ return OUTDOOR_ROOM_TYPES.includes(room.type); },
  sideLength(room, side){ return (side === 'N' || side === 'S') ? room.settings.width : room.settings.length; },
  _id(house, prefix){ house.nextId = (house.nextId || 1); return prefix + (house.nextId++); },
  _clamp(v, a, b){ return Math.max(a, Math.min(b, v)); },

  // ------------------------------------------------------------------ defaults + migration
  defaultLevels(){ return [{ id:'l0', name:'Parter', elevation:0 }]; },

  /** The design every room had before the designer existed (so old projects look and behave the same). */
  defaultDesign(room){
    const { width:W, length:L, height:H } = room.settings, type = room.type, outdoor = this.isOutdoor(room);
    const material = (type === 'garage' || type === 'basement') ? 'concrete' : 'brick';
    const wallIns = (type === 'garage' || outdoor) ? 0 : CONSTRUCTION.defaultWallInsulationCm;
    const walls = {}; for (const s of this.SIDES) walls[s] = { material, insulationCm: wallIns };
    const d = {
      walls, frontWall:false, openings:[], partitions:[],
      floorInsulationCm: type === 'garage' ? 0 : CONSTRUCTION.defaultFloorInsulationCm,
      roof: { type: type === 'garage' ? 'mono' : 'flat', pitchDeg:12, overhang:0.25, facing:'S', pvSlope:'a',
              insulationCm: type === 'garage' ? 0 : CONSTRUCTION.defaultRoofInsulationCm },
    };
    let n = 1; const oid = () => 'o' + (room.id || 'r') + '_' + (n++);
    if (outdoor) return d;
    if (type === 'garage'){
      const doorH = Math.min(2.15, H - 0.25), margin = 0.35;
      d.openings.push({ id:oid(), type:'garage', wall:'W', pos:margin, width:L - margin*2, height:doorH, sill:0, doorType:'garage', open:0 });
      d.openings.push({ id:oid(), type:'door', wall:'E', pos:0.7, width:1.0, height:2.1, sill:0, doorType:'exterior', open:0 });
      const ww = Math.min(1.2, W*0.4);
      d.openings.push({ id:oid(), type:'window', wall:'N', pos:(W-ww)/2, width:ww, height:0.5, sill:H-0.65, glazing:'single', open:0 });
    } else if (type === 'basement'){
      d.openings.push({ id:oid(), type:'door', wall:'E', pos:0.7, width:0.95, height:2.05, sill:0, doorType:'interior', open:0 });
    } else {
      const ww = Math.min(1.8, Math.max(0.6, W - 0.8));
      d.openings.push({ id:oid(), type:'window', wall:'N', pos:(W-ww)/2, width:ww, height:1.3, sill:0.9, glazing:'double', open:0 });
      d.openings.push({ id:oid(), type:'door', wall:'E', pos:Math.min(0.7, Math.max(0.2, L-1.2)), width:0.95, height:2.05, sill:0, doorType:'exterior', open:0 });
    }
    return d;
  },

  /** Guarantees room.design is complete (adds anything missing, never overwrites what is there). */
  ensureRoom(room){
    const def = this.defaultDesign(room);
    if (!room.design || typeof room.design !== 'object') room.design = def;
    const d = room.design;
    d.walls = d.walls || {};
    for (const s of this.SIDES){
      const w = d.walls[s] = Object.assign({ material:def.walls[s].material, insulationCm:def.walls[s].insulationCm }, d.walls[s] || {});
      if (!WALL_MATERIALS[w.material]) w.material = 'brick';
      w.insulationCm = this._clamp(+w.insulationCm || 0, 0, 40);
    }
    d.openings = Array.isArray(d.openings) ? d.openings : [];
    d.partitions = Array.isArray(d.partitions) ? d.partitions : [];
    d.frontWall = !!d.frontWall;
    d.floorInsulationCm = this._clamp(d.floorInsulationCm == null ? def.floorInsulationCm : +d.floorInsulationCm, 0, 40);
    d.roof = Object.assign({}, def.roof, d.roof || {});
    if (!ROOF_TYPES[d.roof.type]) d.roof.type = def.roof.type;
    d.roof.pitchDeg = this._clamp(+d.roof.pitchDeg || 12, 3, 60);
    d.roof.overhang = this._clamp(d.roof.overhang == null ? 0.25 : +d.roof.overhang, 0, 1.2);
    if (!['N','E','S','W'].includes(d.roof.facing)) d.roof.facing = 'S';
    if (!['a','b'].includes(d.roof.pvSlope)) d.roof.pvSlope = 'a';
    d.roof.insulationCm = this._clamp(d.roof.insulationCm == null ? def.roof.insulationCm : +d.roof.insulationCm, 0, 60);
    for (const o of d.openings){
      o.sill = o.type === 'window' ? Math.max(0, +o.sill || 0) : 0; o.open = this._clamp(+o.open || 0, 0, 1);
      if (o.type === 'window' && !GLAZING_TYPES[o.glazing]) o.glazing = 'double';
      if (o.type !== 'window' && !DOOR_TYPES[o.doorType]) o.doorType = o.type === 'garage' ? 'garage' : 'exterior';
    }
    return d;
  },

  /** Brings any saved house (pre-designer or newer) to the current structure. Idempotent. */
  migrateHouse(house){
    if (!house || !Array.isArray(house.rooms)) return house;
    if (!Array.isArray(house.levels) || !house.levels.length) house.levels = this.defaultLevels();
    house.levels.forEach((l, i) => { l.id = l.id || ('l' + i); l.name = l.name || ('L' + i); l.elevation = +l.elevation || 0; });
    house.stairs = Array.isArray(house.stairs) ? house.stairs : [];
    house.nextId = Math.max(+house.nextId || 1, 1);
    if (!house.levelView) house.levelView = 'cutaway';
    if (house.layout !== 'free') house.layout = 'auto';   // 'auto': ground-level rooms are packed left-to-right (original behaviour); 'free': the designer owns the positions
    house.stairs = house.stairs.filter(s => house.rooms.some(r => r.id === s.roomId) && house.levels.some(l => l.id === s.toLevelId));
    for (const r of house.rooms){
      if (!house.levels.some(l => l.id === r.levelId)) r.levelId = house.levels[0].id;
      r.offsetZ = +r.offsetZ || 0; r.offsetX = +r.offsetX || 0;
      this.ensureRoom(r);
    }
    if (!house.levels.some(l => l.id === house.activeLevelId)) house.activeLevelId = house.levels[0].id;
    return house;
  },

  // ------------------------------------------------------------------ levels + geometry
  level(house, id){ return (house.levels || []).find(l => l.id === id) || (house.levels || [])[0] || { id:'l0', name:'', elevation:0 }; },
  roomLevel(house, room){ return this.level(house, room.levelId); },
  elevation(house, room){ return this.roomLevel(house, room).elevation; },
  roomsOnLevel(house, levelId){ return house.rooms.filter(r => (r.levelId || house.levels[0].id) === levelId); },
  sortedLevels(house){ return house.levels.slice().sort((a, b) => a.elevation - b.elevation); },

  /** Adds a level above the highest one (or a basement below the lowest with below=true). */
  addLevel(house, o){
    o = o || {};
    const sorted = this.sortedLevels(house), below = !!o.below;
    let elevation, name;
    if (below){
      const low = sorted[0], h = Math.max(2.5, ...this.roomsOnLevel(house, low.id).map(r => r.settings.height));
      elevation = low.elevation - h - CONSTRUCTION.slabThicknessM; name = o.name || 'Piwnica';
    } else {
      const top = sorted[sorted.length - 1], rooms = this.roomsOnLevel(house, top.id);
      const h = Math.max(2.6, ...rooms.filter(r => !this.isOutdoor(r)).map(r => r.settings.height));
      elevation = top.elevation + h + CONSTRUCTION.slabThicknessM; name = o.name || ('Piętro ' + (sorted.filter(l => l.elevation > 0.01).length + 1));
    }
    const lvl = { id:this._id(house, 'l'), name: o.name || name, elevation };
    house.levels.push(lvl); return lvl;
  },
  removeLevel(house, id){
    if (house.levels.length <= 1) return 'lastLevel';
    if (this.roomsOnLevel(house, id).length) return 'levelNotEmpty';
    house.levels = house.levels.filter(l => l.id !== id);
    house.stairs = house.stairs.filter(s => s.toLevelId !== id);
    if (house.activeLevelId === id) house.activeLevelId = this.sortedLevels(house)[0].id;
    return null;
  },
  /** Level directly above `levelId` (next higher elevation) or null. */
  levelAbove(house, levelId){
    const el = this.level(house, levelId).elevation;
    return this.sortedLevels(house).find(l => l.elevation > el + 0.01) || null;
  },

  rect(house, room){
    const e = this.elevation(house, room), s = room.settings;
    return { x0:room.offsetX || 0, x1:(room.offsetX || 0) + s.width, z0:room.offsetZ || 0, z1:(room.offsetZ || 0) + s.length, y0:e, y1:e + s.height };
  },
  _overlap1(a0, a1, b0, b1){ return Math.min(a1, b1) - Math.max(a0, b0); },
  footprintOverlapM2(house, A, B){
    const a = this.rect(house, A), b = this.rect(house, B);
    return Math.max(0, this._overlap1(a.x0, a.x1, b.x0, b.x1)) * Math.max(0, this._overlap1(a.z0, a.z1, b.z0, b.z1));
  },

  // ------------------------------------------------------------------ adjacency (shared walls, stacked rooms)
  /** For each side: the neighbouring rooms on the same level that touch that wall, with the shared span in
   *  WALK coordinates ([t0,t1] measured from the wall's first corner). */
  adjacency(house, room){
    const out = { N:[], E:[], S:[], W:[] };
    if (this.isOutdoor(room)) return out;
    const a = this.rect(house, room), tol = CONSTRUCTION.adjacencyTolM, minO = CONSTRUCTION.minOverlapM;
    for (const o of house.rooms){
      if (o === room || this.isOutdoor(o) || (o.levelId || house.levels[0].id) !== (room.levelId || house.levels[0].id)) continue;
      const b = this.rect(house, o);
      const zo = this._overlap1(a.z0, a.z1, b.z0, b.z1), xo = this._overlap1(a.x0, a.x1, b.x0, b.x1);
      if (Math.abs(a.x1 - b.x0) <= tol && zo >= minO) out.E.push({ roomId:o.id, overlapM:zo, t0:Math.max(a.z0,b.z0) - a.z0, t1:Math.min(a.z1,b.z1) - a.z0 });
      if (Math.abs(a.x0 - b.x1) <= tol && zo >= minO) out.W.push({ roomId:o.id, overlapM:zo, t0:a.z1 - Math.min(a.z1,b.z1), t1:a.z1 - Math.max(a.z0,b.z0) });
      if (Math.abs(a.z0 - b.z1) <= tol && xo >= minO) out.N.push({ roomId:o.id, overlapM:xo, t0:Math.max(a.x0,b.x0) - a.x0, t1:Math.min(a.x1,b.x1) - a.x0 });
      if (Math.abs(a.z1 - b.z0) <= tol && xo >= minO) out.S.push({ roomId:o.id, overlapM:xo, t0:a.x1 - Math.min(a.x1,b.x1), t1:a.x1 - Math.max(a.x0,b.x0) });
    }
    return out;
  },
  /** Sides of an outdoor room (balcony / terrace / garden) that touch an indoor room on the same level: no railing there. */
  outdoorAttachedSides(house, room){
    const out = [], a = this.rect(house, room), tol = CONSTRUCTION.adjacencyTolM, minO = CONSTRUCTION.minOverlapM;
    for (const o of house.rooms){
      if (o === room || this.isOutdoor(o) || (o.levelId || '') !== (room.levelId || '')) continue;
      const b = this.rect(house, o), zo = this._overlap1(a.z0, a.z1, b.z0, b.z1), xo = this._overlap1(a.x0, a.x1, b.x0, b.x1);
      if (Math.abs(a.x1 - b.x0) <= tol && zo >= minO) out.push('E'); if (Math.abs(a.x0 - b.x1) <= tol && zo >= minO) out.push('W');
      if (Math.abs(a.z0 - b.z1) <= tol && xo >= minO) out.push('N'); if (Math.abs(a.z1 - b.z0) <= tol && xo >= minO) out.push('S');
    }
    return out;
  },
  /** Which room draws a shared wall (the other draws nothing there): the one with the smaller id. */
  ownsSharedWall(room, other){ return String(room.id) < String(other.id); },

  /** Rooms directly above / below (indoor, on the adjacent level, overlapping the footprint). */
  roomsAbove(house, room){
    const up = this.levelAbove(house, room.levelId); if (!up) return [];
    return this.roomsOnLevel(house, up.id).filter(r => !this.isOutdoor(r) && this.footprintOverlapM2(house, room, r) > 0.3);
  },
  roomsBelow(house, room){
    return house.rooms.filter(r => !this.isOutdoor(r) && this.levelAbove(house, r.levelId) && this.levelAbove(house, r.levelId).id === (room.levelId) && this.footprintOverlapM2(house, room, r) > 0.3);
  },

  // ------------------------------------------------------------------ openings
  openingsOn(room, side){ return room.design.openings.filter(o => o.wall === side).sort((a, b) => a.pos - b.pos); },
  openingArea(o){ return o.width * o.height; },

  /** null if the opening is valid, else an error code (see i18n bld.err.*). */
  validateOpening(house, room, o, ignoreId){
    if (this.isOutdoor(room)) return 'outdoorRoom';
    if (!this.SIDES.includes(o.wall)) return 'badWall';
    const len = this.sideLength(room, o.wall), H = room.settings.height, edge = CONSTRUCTION.openingEdgeM;
    const minW = o.type === 'window' ? CONSTRUCTION.windowMinM : CONSTRUCTION.doorMinM;
    if (!(o.width >= minW)) return 'tooNarrow';
    if (o.type !== 'window' && o.width > CONSTRUCTION.doorMaxM && o.type !== 'garage') return 'tooWide';
    if (o.pos < edge - 1e-9 || o.pos + o.width > len - edge + 1e-9) return 'outOfWall';
    const sill = o.type === 'window' ? o.sill : 0;
    if (sill < 0 || !(o.height > 0.2) || sill + o.height > H - 0.05 + 1e-9) return 'tooTall';
    for (const p of room.design.openings){
      if (p.id === o.id || p.id === ignoreId || p.wall !== o.wall) continue;
      if (o.pos < p.pos + p.width + 0.1 && p.pos < o.pos + o.width + 0.1) return 'overlap';
    }
    const adj = this.adjacency(house, room)[o.wall], centre = o.pos + o.width / 2;
    for (const n of adj){
      const other = house.rooms.find(r => r.id === n.roomId);
      if (centre >= n.t0 && centre <= n.t1 && other && !this.ownsSharedWall(room, other)) return 'neighbourOwnsWall';
    }
    return null;
  },
  addOpening(house, roomId, o){
    const room = house.rooms.find(r => r.id === roomId); if (!room) return { error:'noRoom' };
    this.ensureRoom(room);
    const op = Object.assign({ id:this._id(house, 'o'), open:0 }, o);
    if (op.type !== 'window') op.sill = 0;
    if (op.type === 'window' && !GLAZING_TYPES[op.glazing]) op.glazing = 'double';
    if (op.type !== 'window' && !DOOR_TYPES[op.doorType]) op.doorType = op.type === 'garage' ? 'garage' : 'exterior';
    const err = this.validateOpening(house, room, op);
    if (err) return { error:err };
    room.design.openings.push(op); return { opening:op };
  },
  updateOpening(house, roomId, id, patch){
    const room = house.rooms.find(r => r.id === roomId); if (!room) return { error:'noRoom' };
    const o = room.design.openings.find(x => x.id === id); if (!o) return { error:'noOpening' };
    const next = Object.assign({}, o, patch); if (next.type !== 'window') next.sill = 0;
    const err = this.validateOpening(house, room, next, id);
    if (err) return { error:err };
    Object.assign(o, next); return { opening:o };
  },
  removeOpening(house, roomId, id){
    const room = house.rooms.find(r => r.id === roomId); if (!room) return false;
    const n = room.design.openings.length; room.design.openings = room.design.openings.filter(o => o.id !== id); return room.design.openings.length < n;
  },
  /** Largest gap-free position for a new opening of `width` on a wall, or null when the wall is full. */
  suggestPos(house, room, side, width){
    const len = this.sideLength(room, side), edge = CONSTRUCTION.openingEdgeM, ops = this.openingsOn(room, side);
    let cursor = edge;
    for (const p of ops){ if (p.pos - cursor >= width + 0.1) return cursor; cursor = p.pos + p.width + 0.1; }
    return len - edge - cursor >= width ? cursor : null;
  },

  // ------------------------------------------------------------------ partitions
  addPartition(house, roomId, p){
    const room = house.rooms.find(r => r.id === roomId); if (!room) return { error:'noRoom' };
    this.ensureRoom(room);
    const W = room.settings.width, L = room.settings.length;
    const x1 = this._clamp(+p.x1, 0.1, W - 0.1), z1 = this._clamp(+p.z1, 0.1, L - 0.1), x2 = this._clamp(+p.x2, 0.1, W - 0.1), z2 = this._clamp(+p.z2, 0.1, L - 0.1);
    if (Math.hypot(x2 - x1, z2 - z1) < 0.5) return { error:'tooShort' };
    if (Math.abs(x2 - x1) > 0.05 && Math.abs(z2 - z1) > 0.05) return { error:'notAxisAligned' };  // partitions run along X or Z
    const part = { id:this._id(house, 'p'), x1, z1, x2, z2, material:p.material && WALL_MATERIALS[p.material] ? p.material : 'drywall',
      doorWidth: p.doorWidth == null ? 0.9 : Math.max(0, +p.doorWidth), doorPos: p.doorPos == null ? null : +p.doorPos };
    room.design.partitions.push(part); return { partition:part };
  },
  removePartition(house, roomId, id){
    const room = house.rooms.find(r => r.id === roomId); if (!room) return false;
    const n = room.design.partitions.length; room.design.partitions = room.design.partitions.filter(p => p.id !== id); return room.design.partitions.length < n;
  },
  partitionLength(p){ return Math.hypot(p.x2 - p.x1, p.z2 - p.z1); },

  // ------------------------------------------------------------------ stairs
  stairRun(house, fromRoom, toLevelId){
    const rise = this.level(house, toLevelId).elevation - this.elevation(house, fromRoom);
    const risers = Math.max(2, Math.round(Math.abs(rise) / CONSTRUCTION.riserM));
    return { rise, risers, run:(risers - 1) * CONSTRUCTION.treadM };
  },
  /** Footprint of a stair in ROOM-LOCAL coordinates (start = foot of the first step, dir = direction of ascent). */
  stairFootprint(house, stair){
    const room = house.rooms.find(r => r.id === stair.roomId); if (!room) return null;
    const { run } = this.stairRun(house, room, stair.toLevelId), w = stair.width || CONSTRUCTION.stairWidthM;
    const x = stair.x, z = stair.z;
    switch (stair.dir){
      case 'N': return { x0:x - w/2, x1:x + w/2, z0:z - run, z1:z };
      case 'S': return { x0:x - w/2, x1:x + w/2, z0:z, z1:z + run };
      case 'E': return { x0:x, x1:x + run, z0:z - w/2, z1:z + w/2 };
      default:  return { x0:x - run, x1:x, z0:z - w/2, z1:z + w/2 };
    }
  },
  /** Room on the target level that the stair leads into (largest overlap with the stair's world footprint). */
  stairTarget(house, stair){
    const room = house.rooms.find(r => r.id === stair.roomId), fp = this.stairFootprint(house, stair); if (!room || !fp) return null;
    const wx0 = (room.offsetX || 0) + fp.x0, wx1 = (room.offsetX || 0) + fp.x1, wz0 = (room.offsetZ || 0) + fp.z0, wz1 = (room.offsetZ || 0) + fp.z1;
    let best = null, bo = 0.05;
    for (const r of this.roomsOnLevel(house, stair.toLevelId)){
      if (this.isOutdoor(r)) continue;
      const rr = this.rect(house, r), ov = Math.max(0, this._overlap1(wx0, wx1, rr.x0, rr.x1)) * Math.max(0, this._overlap1(wz0, wz1, rr.z0, rr.z1));
      if (ov > bo){ bo = ov; best = r; }
    }
    return best;
  },
  /** Openings cut into slabs by stairs: `ceiling` = holes in this room's ceiling, `floor` = holes in its floor. Local coords. */
  stairHoles(house, room){
    const out = { ceiling:[], floor:[] };
    for (const s of house.stairs || []){
      const fp = this.stairFootprint(house, s); if (!fp) continue;
      if (s.roomId === room.id) out.ceiling.push(fp);
      const t = this.stairTarget(house, s);
      if (t && t.id === room.id){
        const from = house.rooms.find(r => r.id === s.roomId);
        const dx = (from.offsetX || 0) - (room.offsetX || 0), dz = (from.offsetZ || 0) - (room.offsetZ || 0);
        out.floor.push({ x0:fp.x0 + dx, x1:fp.x1 + dx, z0:fp.z0 + dz, z1:fp.z1 + dz });
      }
    }
    return out;
  },
  addStair(house, o){
    const room = house.rooms.find(r => r.id === o.roomId); if (!room) return { error:'noRoom' };
    const up = this.levelAbove(house, room.levelId); const toLevelId = o.toLevelId || (up && up.id);
    if (!toLevelId || toLevelId === room.levelId) return { error:'noLevelAbove' };
    const s = { id:this._id(house, 's'), roomId:room.id, toLevelId, x:+o.x, z:+o.z, dir:['N','E','S','W'].includes(o.dir) ? o.dir : 'N', width:o.width || CONSTRUCTION.stairWidthM };
    const fp = this.stairFootprint(house, s), W = room.settings.width, L = room.settings.length;
    if (fp.x0 < -1e-9 || fp.z0 < -1e-9 || fp.x1 > W + 1e-9 || fp.z1 > L + 1e-9) return { error:'stairOutsideRoom' };
    if (!this.stairTarget(house, s)) return { error:'stairNoTarget' };
    house.stairs.push(s); return { stair:s };
  },
  removeStair(house, id){ const n = house.stairs.length; house.stairs = house.stairs.filter(s => s.id !== id); return house.stairs.length < n; },

  // ------------------------------------------------------------------ roof
  /** Effective roof of a room: none if outdoor or another indoor room sits on top of it. */
  roofSpec(house, room){
    this.ensureRoom(room);
    if (this.isOutdoor(room) || this.roomsAbove(house, room).length) return Object.assign({}, room.design.roof, { type:'none' });
    return Object.assign({}, room.design.roof);
  },
  /** Geometry of the roof slopes (in the room's local frame) - used for drawing, PV mounting and shading.
   *  yaw/dz/y place a slope group inside a yaw group at the room centre; tilt about local X is +pitch (the +Z edge is
   *  the LOW edge and the slope faces +Z before yaw). */
  roofSlopes(house, room){
    const r = this.roofSpec(house, room), W = room.settings.width, L = room.settings.length, H = room.settings.height;
    if (r.type !== 'mono' && r.type !== 'gable') return [];
    const p = r.pitchDeg * Math.PI / 180, ov = r.overhang, yaw = this.FACING_YAW[r.facing];
    const alongIsL = (r.facing === 'S' || r.facing === 'N');
    const across = alongIsL ? W : L, along = alongIsL ? L : W;
    const eaveY = H + 0.05;
    if (r.type === 'mono'){
      const len = along / Math.cos(p) + ov * 2;
      return [{ key:'a', yaw, dz:0, y:eaveY, pitch:p, across:across + ov * 2, len, azimuthDeg:this._az(r.facing), areaM2:(across + ov*2) * len, spanW:across + ov*1.2, spanL:len - ov*1.2 }];
    }
    const half = along / 2, len = half / Math.cos(p) + ov + 0.05;
    const dz = half / 2 + ov * Math.cos(p) / 2, y = eaveY + (half / 2) * Math.tan(p) - ov * Math.sin(p) / 2 * 0;
    const mk = (key, yw, facing) => ({ key, yaw:yw, dz, y, pitch:p, across:across + ov * 2, len, azimuthDeg:this._az(facing), areaM2:(across + ov*2) * len, spanW:across + ov*1.2, spanL:len - ov*1.2 });
    return [mk('a', yaw, r.facing), mk('b', yaw + Math.PI, this.OPPOSITE[r.facing])];
  },
  _az(facing){ return this.OUTWARD_AZIMUTH[facing]; },
  /** Rotate a horizontal-plane vector by yaw about Y (THREE convention). */
  _yawVec(v, yaw){ const c = Math.cos(yaw), s = Math.sin(yaw); return [v[0]*c + v[2]*s, v[1], -v[0]*s + v[2]*c]; },
  /** World-space orientation of a slope: compass azimuth of its normal + tilt, and its OBB axes. */
  slopeAxes(slope){
    const c = Math.cos(slope.pitch), s = Math.sin(slope.pitch);
    return [[1,0,0], [0,c,s], [0,-s,c]].map(v => this._yawVec(v, slope.yaw));
  },

  /** How good a roof slope is for PV, 0..100 (%): clear-sky irradiance on the slope summed over four representative days
   *  and the daylight hours, relative to a panel at the optimum fixed tilt (35 deg, due south). */
  pvSuitability(tiltDeg, azimuthDeg){
    const days = [80, 172, 266, 355], score = (tilt, az) => {
      let sum = 0;
      for (const d of days) for (let h = 5; h <= 19; h += 0.5){
        const p = SunPosition.position(d, h);
        if (p.elevationDeg <= 2) continue;
        sum += Math.max(0, SunPosition.incidenceFactor(p.elevationDeg, p.azimuthDeg, tilt, az)) * Math.sin(p.elevationDeg * Math.PI / 180) ** 0.3;
      }
      return sum;
    };
    return Math.round(Math.min(1, score(tiltDeg, azimuthDeg) / score(35, 180)) * 100);
  },

  // ------------------------------------------------------------------ shading geometry
  /** ShadeModel occluders for the whole building: room volumes, roofs, outdoor slabs. World coordinates. */
  occluders(house){
    const out = [];
    for (const room of house.rooms){
      this.ensureRoom(room);
      const rc = this.rect(house, room), W = room.settings.width, L = room.settings.length, H = room.settings.height;
      if (this.isOutdoor(room)){
        out.push(ShadeModel.box([rc.x0, rc.y0 - 0.15, rc.z0], [rc.x1, rc.y0, rc.z1], { ownerRoomId:room.id }));
        continue;
      }
      out.push(ShadeModel.box([rc.x0, rc.y0 - 0.15, rc.z0], [rc.x1, rc.y1 + 0.05, rc.z1], { ownerRoomId:room.id }));
      for (const sl of this.roofSlopes(house, room)){
        const c = this._yawVec([0, 0, sl.dz], sl.yaw);
        out.push({ kind:'obb', center:[rc.x0 + W/2 + c[0], rc.y0 + sl.y, rc.z0 + L/2 + c[2]], axes:this.slopeAxes(sl),
          half:[sl.across / 2, 0.03, sl.len / 2], transmit:0, ownerRoomId:room.id, isRoof:true });
      }
    }
    return out;
  },

  // ------------------------------------------------------------------ thermal envelope
  /** U-value (W/m2K) of a wall build-up: surface resistances + masonry + added insulation (interior walls: both surfaces interior). */
  wallU(w, exterior){
    const m = WALL_MATERIALS[w.material] || WALL_MATERIALS.brick;
    const R = (exterior ? CONSTRUCTION.rsiWall + CONSTRUCTION.rseWall : CONSTRUCTION.rsiWall * 2) + m.thickness / m.lambda + (w.insulationCm || 0) / 100 / WALL_INSULATION_LAMBDA;
    return 1 / R;
  },
  windowU(o){ const g = GLAZING_TYPES[o.glazing] || GLAZING_TYPES.double; return WINDOW_FRAME.glassFraction * g.u + (1 - WINDOW_FRAME.glassFraction) * WINDOW_FRAME.u; },
  floorU(insCm, ground){
    const R = CONSTRUCTION.rsiFloor + CONSTRUCTION.slabConcreteThickness / CONSTRUCTION.slabConcreteLambda + (insCm || 0) / 100 / WALL_INSULATION_LAMBDA + (ground ? 0.10 : 0.10);
    return 1 / R;
  },
  roofU(insCm, pitch){ return 1 / (CONSTRUCTION.rsiCeiling + CONSTRUCTION.rseWall + CONSTRUCTION.roofBaseR + (insCm || 0) / 100 / WALL_INSULATION_LAMBDA); },

  /** Everything the temperature model needs about one room. */
  envelope(house, room){
    this.ensureRoom(room);
    const d = room.design, s = room.settings, W = s.width, L = s.length, H = s.height;
    const rc = this.rect(house, room), elev = rc.y0;
    const env = { roomId:room.id, outdoor:this.isOutdoor(room), levelId:room.levelId, elevation:elev, height:H, floorArea:W * L, volume:W * L * H,
      walls:{}, windows:[], doors:[], couplings:[], ua:{ walls:0, windows:0, doors:0, floor:0, roof:0, total:0 }, thermalMassJK:0 };
    if (env.outdoor){ env.hv = 0; env.thermalMassJK = 0; env.roof = { type:'none', area:0, U:0 }; return env; }
    const adj = this.adjacency(house, room);
    // fraction of an exterior wall that is below ground level (basement) -> heat goes to the (warmer) ground
    const belowFrac = elev >= -0.01 ? 0 : Math.min(1, -elev / H);
    let massJK = env.volume * 1.2 * 1005;
    const addCoupling = (roomId, UA, kind) => { if (UA <= 0) return; const c = env.couplings.find(x => x.roomId === roomId && x.kind === kind); if (c) c.UA += UA; else env.couplings.push({ roomId, UA, kind }); };
    for (const side of this.SIDES){
      const len = this.sideLength(room, side), gross = len * H, w = d.walls[side], mat = WALL_MATERIALS[w.material];
      const intervals = adj[side].map(n => [n.t0, n.t1, n.roomId]);
      const interiorLen = adj[side].reduce((a, n) => a + n.overlapM, 0);
      const ext = { lengthM:len, grossArea:gross, materialId:w.material, insulationCm:w.insulationCm, U:this.wallU(w, true), Uint:this.wallU(w, false), interiorLenM:Math.min(len, interiorLen) };
      let extOpen = 0, intOpen = 0;
      for (const o of this.openingsOn(room, side)){
        const area = this.openingArea(o), centre = o.pos + o.width / 2, hit = intervals.find(iv => centre >= iv[0] && centre <= iv[1]);
        if (o.type === 'window'){
          const U = this.windowU(o), g = (GLAZING_TYPES[o.glazing] || GLAZING_TYPES.double).g;
          env.windows.push({ id:o.id, side, area, glassArea:area * WINDOW_FRAME.glassFraction, U, g, azimuthDeg:this.OUTWARD_AZIMUTH[side], sill:o.sill, height:o.height, width:o.width, exterior:!hit, UA:U * area, open:o.open });
          if (hit) intOpen += area; else extOpen += area;
        } else {
          const dt = DOOR_TYPES[o.doorType] || DOOR_TYPES.exterior;
          env.doors.push({ id:o.id, side, area, U:dt.u, leakage:dt.leakage, exterior:!hit, toRoomId:hit ? hit[2] : null, open:o.open, type:o.type, UA:dt.u * area });
          if (hit) intOpen += area; else extOpen += area;
        }
      }
      const extGross = Math.max(0, gross - interiorLen * H), intGross = Math.min(gross, interiorLen * H);
      const extNet = Math.max(0, extGross - extOpen), intNet = Math.max(0, intGross - intOpen);
      ext.exteriorArea = extNet; ext.interiorArea = intNet;
      env.walls[side] = ext;
      // exterior wall: above-ground part loses to outdoor air, below-ground part to the ground (factor applied by the temperature model)
      env.ua.walls += ext.U * extNet;
      if (belowFrac > 0) env.ua.groundWalls = (env.ua.groundWalls || 0) + ext.U * extNet * belowFrac;
      for (const n of adj[side]){
        const share = interiorLen > 0 ? n.overlapM / interiorLen : 0;
        addCoupling(n.roomId, ext.Uint * intNet * share, 'wall');
      }
      // heat storage of the wall skin that takes part in the daily swing
      const cm = mat.density * mat.cp * Math.min(mat.thickness, CONSTRUCTION.effectiveMassDepthM);
      massJK += (extNet + intNet) * cm;
    }
    for (const dr of env.doors) if (dr.exterior){ env.ua.doors += dr.UA; }
    for (const wn of env.windows) if (wn.exterior){ env.ua.windows += wn.UA; }
    for (const dr of env.doors) if (!dr.exterior && dr.toRoomId) addCoupling(dr.toRoomId, dr.UA, 'door');
    // floor: ground, or the room(s) below; whatever is not over a room is exposed
    const below = this.roomsBelow(house, room);
    let floorCovered = 0;
    for (const b of below){ const ov = this.footprintOverlapM2(house, room, b); floorCovered += ov; addCoupling(b.id, this.floorU(d.floorInsulationCm, false) * ov * 2, 'floor'); }
    floorCovered = Math.min(floorCovered, env.floorArea);
    const openFloor = env.floorArea - floorCovered, groundLevel = elev <= 0.01;
    env.ua.floor = this.floorU(d.floorInsulationCm, groundLevel) * openFloor;
    env.floorToGround = groundLevel;
    massJK += env.floorArea * 2400 * 880 * CONSTRUCTION.effectiveMassDepthM;
    // ceiling / roof
    const above = this.roomsAbove(house, room);
    let ceilCovered = 0;
    for (const a of above){ const ov = this.footprintOverlapM2(house, room, a); ceilCovered += ov; addCoupling(a.id, this.floorU(a.design ? a.design.floorInsulationCm : 0, false) * ov * 2, 'ceiling'); }
    ceilCovered = Math.min(ceilCovered, env.floorArea);
    const rs = this.roofSpec(house, room), slopes = this.roofSlopes(house, room);
    // sloped roofs: the heat-losing area is the plan area / cos(pitch); flat roofs / ceilings: the plan area not covered by a room above
    const roofArea = slopes.length ? env.floorArea / Math.cos(rs.pitchDeg * Math.PI / 180) : Math.max(0, env.floorArea - ceilCovered);
    env.roof = { type:rs.type, area:roofArea, U:this.roofU(rs.insulationCm), pitchDeg:rs.pitchDeg, pv:!!ROOF_TYPES[rs.type].pv };
    env.ua.roof = env.roof.U * env.roof.area;
    massJK += env.floorArea * 2400 * 880 * CONSTRUCTION.effectiveMassDepthM * 0.5;
    // partitions: two faces of thermal mass inside the room, no heat exchange with the outside
    for (const p of d.partitions){
      const m = WALL_MATERIALS[p.material] || WALL_MATERIALS.drywall, len = this.partitionLength(p);
      massJK += 2 * len * H * m.density * m.cp * Math.min(m.thickness, CONSTRUCTION.effectiveMassDepthM);
    }
    // ventilation: closed-house infiltration + door leakage; open doors/windows are added by the temperature model
    const ach = CONSTRUCTION.infiltrationACH;
    env.infiltrationACH = ach;
    env.hv = CONSTRUCTION.airHeatCapacityWhM3K * env.volume * ach;
    env.openingAirflowM3hPerM2 = CONSTRUCTION.openAirflowM3hPerM2;
    env.ua.total = env.ua.walls + env.ua.windows + env.ua.doors + env.ua.floor + env.ua.roof;
    env.thermalMassJK = massJK;
    env.windowAreaM2 = env.windows.reduce((a, w) => a + w.area, 0);
    env.windowToFloor = env.windowAreaM2 / env.floorArea;
    return env;
  },

  /** Steady-state heat demand (W) to hold `tin` when it is `tout` outside. Ground-contact parts use the warmer ground. */
  designHeatLossW(env, tin, tout, openFraction){
    if (env.outdoor) return 0;
    const dT = tin - tout, g = CONSTRUCTION.groundFactor;
    const groundWalls = env.ua.groundWalls || 0;
    const ext = (env.ua.walls - groundWalls) + env.ua.windows + env.ua.doors + env.ua.roof + (env.floorToGround ? 0 : env.ua.floor);
    const ground = (env.floorToGround ? env.ua.floor : 0) + groundWalls;
    const openArea = env.doors.filter(d => d.exterior).reduce((a, d) => a + d.area * d.open, 0) + env.windows.filter(w => w.exterior).reduce((a, w) => a + w.area * w.open, 0);
    const hv = env.hv + CONSTRUCTION.airHeatCapacityWhM3K * (env.openingAirflowM3hPerM2 * openArea * (openFraction == null ? 1 : openFraction));
    return (ext + hv) * dT + ground * g * dT;
  },

  /** Solar heat gain through the windows (W) for a sun position; sky 1 = clear, 0 = overcast. */
  solarGainW(env, elevationDeg, azimuthDeg, sky){
    if (env.outdoor || elevationDeg <= 0) return 0;
    sky = sky == null ? 1 : Math.max(0, Math.min(1, sky));
    const el = elevationDeg * Math.PI / 180, se = Math.sin(el);
    const dni = 950 * (1 - Math.exp(-3.5 * se)) * Math.max(0, (sky - 0.2) / 0.8);
    const dhi = (100 + 80 * se) * (0.6 + 0.4 * (1 - sky));
    const d = ShadeModel.sunDir(elevationDeg, azimuthDeg);
    let total = 0;
    for (const w of env.windows){
      if (!w.exterior) continue;
      const az = w.azimuthDeg * Math.PI / 180, n = [Math.sin(az), 0, -Math.cos(az)];
      const cosT = Math.max(0, d[0]*n[0] + d[1]*n[1] + d[2]*n[2]);
      const Iw = dni * cosT + 0.5 * dhi;
      total += w.glassArea * w.g * Iw;
    }
    return total;
  },

  // ------------------------------------------------------------------ validation + compile
  validate(house){
    const issues = [];
    for (const r of house.rooms){
      this.ensureRoom(r);
      for (const o of r.design.openings){ const e = this.validateOpening(house, r, o); if (e) issues.push({ level:'error', code:'openingInvalid', params:{ room:r.name || r.id, err:e } }); }
    }
    for (let i = 0; i < house.rooms.length; i++) for (let j = i + 1; j < house.rooms.length; j++){
      const a = house.rooms[i], b = house.rooms[j];
      if ((a.levelId || '') !== (b.levelId || '')) continue;
      const A = this.rect(house, a), B = this.rect(house, b);
      const ox = this._overlap1(A.x0, A.x1, B.x0, B.x1), oz = this._overlap1(A.z0, A.z1, B.z0, B.z1);
      if (ox > CONSTRUCTION.adjacencyTolM && oz > CONSTRUCTION.adjacencyTolM) issues.push({ level:'error', code:'roomsOverlap', params:{ a:a.name || a.id, b:b.name || b.id } });
    }
    for (const s of house.stairs){
      if (!this.stairTarget(house, s)) issues.push({ level:'warning', code:'stairNoTarget', params:{ room:(house.rooms.find(r => r.id === s.roomId) || {}).name } });
    }
    for (const r of house.rooms){
      const lv = this.level(house, r.levelId);
      if (this.roomsOnLevel(house, lv.id).length && this.levelAbove(house, lv.id) && !this.isOutdoor(r) && this.roomsAbove(house, r).length){
        const up = this.roomsAbove(house, r), stairs = house.stairs.some(s => s.roomId === r.id);
        if (!stairs) issues.push({ level:'info', code:'noStairs', params:{ room:r.name || r.id } });
      }
    }
    return issues;
  },

  /** Snapshot for the simulation: per-room envelopes, shading geometry, issues. Recompute after any house edit. */
  compile(house){
    this.migrateHouse(house);
    const rooms = {}; for (const r of house.rooms) rooms[r.id] = this.envelope(house, r);
    return { rooms, occluders:this.occluders(house), issues:this.validate(house),
      totals:{ floorArea:Object.values(rooms).filter(e => !e.outdoor).reduce((a, e) => a + e.floorArea, 0), ua:Object.values(rooms).reduce((a, e) => a + e.ua.total, 0) } };
  },

  /** Original auto-layout: ground-level rooms side by side with a 1.4 m gap. Does nothing once the designer took over ('free'). */
  autoLayout(house){
    if (house.layout === 'free' || !house.levels.length) return;
    const first = house.levels[0].id; let x = 0;
    for (const r of house.rooms) if ((r.levelId || first) === first){ r.offsetX = x; r.offsetZ = 0; x += r.settings.width + 1.4; }
  },
  /** Chooses offsetX/offsetZ for a NEW room whose level and size are already set. Upper / lower levels stack the room
   *  on top of (or under) a room that has nothing there yet, which switches the house to 'free' layout. */
  placeNewRoom(house, room){
    const first = house.levels[0].id, lvl = room.levelId || first;
    const same = house.rooms.filter(r => r !== room && (r.levelId || first) === lvl);
    if (lvl === first && house.layout !== 'free'){ room.offsetX = same.reduce((a, r) => a + r.settings.width + 1.4, 0); room.offsetZ = 0; return; }
    const el = this.level(house, lvl).elevation;
    const stackable = house.rooms.filter(r => r !== room && !this.isOutdoor(r) && this.level(house, r.levelId).elevation !== el
      && !same.some(o => this.footprintOverlapM2(house, r, o) > 0.3));
    if (stackable.length && !this.isOutdoor(room)){
      const t = stackable.sort((a, b) => Math.abs(this.elevation(house, a) - el) - Math.abs(this.elevation(house, b) - el))[0];
      room.offsetX = t.offsetX || 0; room.offsetZ = t.offsetZ || 0; house.layout = 'free'; return;
    }
    const right = same.reduce((a, r) => Math.max(a, (r.offsetX || 0) + r.settings.width), -1.4);
    room.offsetX = right + 1.4; room.offsetZ = 0;
  },
  /** After a room is resized / re-typed: clamp its openings, partitions and stairs back inside; drop what cannot fit. Returns the number of removals. */
  refit(house, room){
    this.ensureRoom(room);
    const W = room.settings.width, L = room.settings.length, H = room.settings.height, d = room.design;
    let removed = 0;
    const kept = [];
    for (const o of d.openings){
      const len = this.sideLength(room, o.wall), edge = CONSTRUCTION.openingEdgeM;
      const maxW = len - 2 * edge;
      if (maxW < (o.type === 'window' ? CONSTRUCTION.windowMinM : CONSTRUCTION.doorMinM)){ removed++; continue; }
      o.width = Math.min(o.width, maxW); o.pos = this._clamp(o.pos, edge, len - edge - o.width);
      const maxH = H - 0.05 - (o.type === 'window' ? o.sill : 0);
      if (o.type === 'window' && maxH < 0.3){ o.sill = Math.max(0, H - 0.05 - Math.min(o.height, 1.0)); }
      o.height = Math.min(o.height, H - 0.05 - (o.type === 'window' ? o.sill : 0));
      kept.push(o);
    }
    d.openings = [];
    for (const o of kept){ if (this.validateOpening(house, room, o) === null) d.openings.push(o); else removed++; }
    for (const p of d.partitions){ p.x1 = this._clamp(p.x1, 0.1, W - 0.1); p.x2 = this._clamp(p.x2, 0.1, W - 0.1); p.z1 = this._clamp(p.z1, 0.1, L - 0.1); p.z2 = this._clamp(p.z2, 0.1, L - 0.1); }
    const before = d.partitions.length; d.partitions = d.partitions.filter(p => this.partitionLength(p) >= 0.5); removed += before - d.partitions.length;
    const sb = house.stairs.length;
    house.stairs = house.stairs.filter(s => { if (s.roomId !== room.id) return true; const fp = this.stairFootprint(house, s); return fp && fp.x0 >= -1e-9 && fp.z0 >= -1e-9 && fp.x1 <= W + 1e-9 && fp.z1 <= L + 1e-9; });
    removed += sb - house.stairs.length;
    return removed;
  },
  /** Puts `room` flush against a side of `other` (shared wall), same level, aligned to its near edge. */
  snapToRoom(house, room, other, side){
    const o = this.rect(house, other), W = room.settings.width, L = room.settings.length;
    room.levelId = other.levelId;
    switch (side){
      case 'E': room.offsetX = o.x1; room.offsetZ = o.z0; break;
      case 'W': room.offsetX = o.x0 - W; room.offsetZ = o.z0; break;
      case 'S': room.offsetZ = o.z1; room.offsetX = o.x0; break;
      default:  room.offsetZ = o.z0 - L; room.offsetX = o.x0; break;
    }
  },
};
