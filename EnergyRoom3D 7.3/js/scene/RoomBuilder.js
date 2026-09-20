/**
 * ROOM BUILDER (multi-room "house" builder)
 * Builds/rebuilds every room's geometry (walls/floor/ceiling/door/
 * window/sockets) from an array of RoomState entries, each placed at
 * its own world-space X offset so multiple rooms can sit side by side
 * and share one scene/camera. A 'garage' room additionally gets a
 * garage-style sectional door and a tilted mono-pitch roof that solar
 * panels can be parented to. All wall/ceiling/door/window materials
 * are tracked so a single slider can fade them for a "dollhouse" view.
 * Unity mapping: HouseManager building modular rooms from prefab
 * pieces, each room a child GameObject at its own local offset.
 */
const ROOM_MATERIALS = {
  floor: {
    Wood:     { color:0x8a5a37, rough:0.72, metal:0.0 },
    Tile:     { color:0xcfd6dd, rough:0.32, metal:0.05 },
    Concrete: { color:0x8b8f96, rough:0.9,  metal:0.0 },
    Carpet:   { color:0x5b4a63, rough:1.0,  metal:0.0 },
  },
  wall: {
    White:    { color:0xefeee9, rough:0.92, metal:0.0 },
    Gray:     { color:0x9aa0a8, rough:0.92, metal:0.0 },
    Brick:    { color:0x9c5b47, rough:0.88, metal:0.0 },
    Concrete: { color:0x8a8e95, rough:0.92, metal:0.0 },
  },
};

class RoomBuilder {
  constructor(scene){
    this.scene = scene;
    this.group = new THREE.Group(); this.group.name='House'; scene.add(this.group);
    this.roomGroups = {};      // roomId -> THREE.Group (translated by offsetX)
    this.roofGroups = {};      // roomId -> THREE.Group (garage roof, tilted; panels parent here)
    this.fadable = [];         // all wall/ceiling/door/window meshes across all rooms
    this.wallVisibility = 1;
    this.bounds = {};          // roomId -> {width,length,height,offsetX}
    this.occluders = [];       // ShadeModel occluders describing the buildings (rebuilt with the rooms)
    // floor grid: one per room, in ROOM-LOCAL coordinates so it lines up exactly with walls and with the
    // object snapping (TransformManager snaps in the same local frame). See _buildFloorGrid().
    this.gridStep = 0.25;      // metres - kept in sync with the snap selector
    this.gridVisible = true;
    this.gridGroups = {};      // roomId -> THREE.Group
  }

  // ---------------- floor grid ----------------
  setGridStep(step){
    if (!(step > 0) || Math.abs(step - this.gridStep) < 1e-9) return;
    this.gridStep = step;
    for (const id in this.gridGroups) this._fillGrid(this.gridGroups[id], this.bounds[id]);
  }
  setGridVisible(v){
    this.gridVisible = !!v;
    for (const id in this.gridGroups) this.gridGroups[id].visible = this.gridVisible;
  }
  /** Grid = thin LineSegments lying at y=0.006 over the floor top (y=0). Two draw calls per room:
   *  minor lines every `gridStep`, major lines every metre, plus the room outline. Never a texture, so it is
   *  crisp at every zoom level; depthWrite is off and the floor is pushed back with polygonOffset, which
   *  removes the flicker (z-fighting) the old world-sized GridHelper showed at 0.001 m. */
  _buildFloorGrid(roomId, W, L, parent){
    const grp = new THREE.Group(); grp.name = 'FloorGrid:'+roomId; grp.visible = this.gridVisible;
    grp.renderOrder = 2;
    parent.add(grp);
    this.gridGroups[roomId] = grp;
    this._fillGrid(grp, { width:W, length:L });
  }
  _fillGrid(grp, b){
    while (grp.children.length){
      const c = grp.children[0]; grp.remove(c);
      if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose();
    }
    if (!b) return;
    const W = b.width, L = b.length, step = this.gridStep;
    const Y = 0.006, eps = 1e-6;
    const minor = [], major = [];
    const nX = Math.floor(W/step + eps), nZ = Math.floor(L/step + eps);
    for (let i = 0; i <= nX; i++){
      const x = +(i*step).toFixed(6);
      const isMajor = Math.abs(x - Math.round(x)) < eps;
      (isMajor ? major : minor).push(x,Y,0, x,Y,L);
    }
    for (let j = 0; j <= nZ; j++){
      const z = +(j*step).toFixed(6);
      const isMajor = Math.abs(z - Math.round(z)) < eps;
      (isMajor ? major : minor).push(0,Y,z, W,Y,z);
    }
    const mk = (arr, color, opacity)=>{
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent:true, opacity, depthWrite:false });
      const ls = new THREE.LineSegments(geo, mat); ls.renderOrder = 2; ls.frustumCulled = false;
      grp.add(ls);
    };
    if (minor.length) mk(minor, 0x8fa3bf, 0.16);
    if (major.length) mk(major, 0xa8bad3, 0.34);
    // room outline (exact wall footprint) - the anchor everything snaps against
    mk([0,Y,0, W,Y,0,  W,Y,0, W,Y,L,  W,Y,L, 0,Y,L,  0,Y,L, 0,Y,0], 0x5eead4, 0.6);
  }

  /** Look up (and correctly tile) the procedural texture for a floor/wall material choice. */
  _roomTexture(kind, choice, colorHex, dimA, dimB){
    let base;
    if (kind==='floor'){
      base = choice==='Tile' ? TextureFactory.tile(colorHex)
           : choice==='Concrete' ? TextureFactory.concrete(colorHex)
           : choice==='Carpet' ? TextureFactory.carpet(colorHex)
           : TextureFactory.wood(colorHex);
    } else {
      base = choice==='Brick' ? TextureFactory.brick(colorHex)
           : choice==='Concrete' ? TextureFactory.concrete(colorHex)
           : TextureFactory.plaster(colorHex);
    }
    const tex = base.clone();
    tex.needsUpdate = true;
    const density = kind==='floor' ? 1.15 : (choice==='Brick' ? 1.6 : 1.0);
    tex.repeat.set(Math.max(1, dimA*density/2.2), Math.max(1, dimB*density/2.2));
    return tex;
  }

  /** Rebuild every room. Accepts the house state {rooms, levels, stairs, ...}; an old-style plain rooms array still works. */
  build(houseOrRooms){
    const house = BuildingModel.migrateHouse(Array.isArray(houseOrRooms) ? { rooms:houseOrRooms } : houseOrRooms);
    this.house = house;
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    for (const id in this.gridGroups){ const gg = this.gridGroups[id]; gg.traverse(o=>{ if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    this.roomGroups = {}; this.roofGroups = {}; this.fadable = []; this.bounds = {}; this.gridGroups = {}; this.openingParts = {};
    // shading geometry comes from the pure model (levels, roofs, outdoor slabs) - identical to what is drawn below
    this.occluders = BuildingModel.occluders(house);
    for (const r of house.rooms) this._buildRoom(r, house);
    this.setWallVisibility(this.wallVisibility);
  }

  _fade(mesh, baseOpacity){ if (baseOpacity != null) mesh.userData.baseOpacity = baseOpacity; this.fadable.push(mesh); return mesh; }

  /** A rectangular slab W x L, thickness t, centred at height yc, optionally with rectangular holes (stairwells).
   *  Without holes it is a single box; with holes it is split into the cells of the grid the hole edges define. */
  _slab(g, W, L, yc, t, mat, holes, fade){
    const add = (x0, x1, z0, z1) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, t, z1 - z0), mat);
      m.position.set((x0 + x1) / 2, yc, (z0 + z1) / 2); m.receiveShadow = true; m.castShadow = t >= 0.1; g.add(m);
      if (fade) this.fadable.push(m);
    };
    if (!holes || !holes.length){ add(0, W, 0, L); return; }
    const cl = (v, hi) => Math.max(0, Math.min(hi, v));
    const xs = [0, W], zs = [0, L];
    for (const h of holes){ xs.push(cl(h.x0, W), cl(h.x1, W)); zs.push(cl(h.z0, L), cl(h.z1, L)); }
    xs.sort((a, b) => a - b); zs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++){
      if (xs[i + 1] - xs[i] < 1e-4 || zs[j + 1] - zs[j] < 1e-4) continue;
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      if (holes.some(h => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1)) continue;
      add(xs[i], xs[i + 1], zs[j], zs[j + 1]);
    }
  }

  _buildRoom(room, house){
    const { id, type, settings } = room;
    const W = settings.width, L = settings.length, H = settings.height, floor = settings.floor, wall = settings.wall;
    const outdoor = BuildingModel.isOutdoor(room), d = room.design, rc = BuildingModel.rect(house, room);
    const g = new THREE.Group(); g.name = 'Room:' + id; g.position.set(rc.x0, rc.y0, rc.z0);
    this.group.add(g);
    this.roomGroups[id] = g;
    this.bounds[id] = { width:W, length:L, height:H, offsetX:rc.x0, offsetZ:rc.z0, elevation:rc.y0, levelId:room.levelId, outdoor };

    const wallMatDef = ROOM_MATERIALS.wall[wall] || ROOM_MATERIALS.wall.White;
    const floorMatDef = ROOM_MATERIALS.floor[floor] || ROOM_MATERIALS.floor.Wood;
    const floorTex = this._roomTexture('floor', floor, floorMatDef.color, W, L);
    const floorMat = new THREE.MeshStandardMaterial({ color:0xffffff, map:floorTex, roughness:floorMatDef.rough, metalness:floorMatDef.metal,
      polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:2 }); // pushed back a hair so the grid on top can never z-fight
    const holes = BuildingModel.stairHoles(house, room);
    const slabMat = new THREE.MeshStandardMaterial({ color:0x8d9095, roughness:0.95 });

    // floor + the structural slab under it (the storey slab that separates levels; a thin ground slab at ground level)
    this._slab(g, W, L, -0.025, 0.05, floorMat, holes.floor, false);
    if (rc.y0 > 0.01 || outdoor) this._slab(g, W, L, -0.15, 0.20, slabMat, holes.floor, false);

    if (outdoor){ this._buildOutdoor(g, room, house, floorMat); this._buildFloorGrid(id, W, L, g); return; }

    const wallTex = this._roomTexture('wall', wall, wallMatDef.color, W, H);
    const wallMat = new THREE.MeshStandardMaterial({ color:0xffffff, map:wallTex, roughness:wallMatDef.rough, metalness:wallMatDef.metal, transparent:true, opacity:1 });
    const ceilTex = TextureFactory.plaster(0xf3f2ee).clone(); ceilTex.needsUpdate = true; ceilTex.repeat.set(W/2.4, L/2.4);
    const ceilMat = new THREE.MeshStandardMaterial({ color:0xffffff, map:ceilTex, roughness:0.95, transparent:true, opacity:1 });
    const trimMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.6, transparent:true, opacity:1 });

    this._slab(g, W, L, H + 0.025, 0.05, ceilMat, holes.ceiling, true);

    const adj = BuildingModel.adjacency(house, room);
    for (const side of BuildingModel.SIDES) this._buildWall(g, room, house, side, wallMat, trimMat, adj);
    this._buildPartitions(g, room, wallMat, trimMat);
    for (const st of house.stairs) if (st.roomId === id) this._buildStair(g, house, room, st);
    // wall sockets are real installation objects now (ElectricalSystem.ensureRoom creates them) - no decoration here
    this._buildFloorGrid(id, W, L, g);

    const slopes = BuildingModel.roofSlopes(house, room);
    if (slopes.length) this._buildRoof(g, room, house, slopes, wallMat);
    if (type === 'garage') this._addGarageDecor(W, L, g);
  }

  /** One wall of a room, built from solid pieces around its openings (windows / doors / garage door).
   *  Local frame: the wall runs along +X from its first corner (clockwise seen from above), interior towards +Z. */
  _buildWall(g, room, house, side, wallMat, trimMat, adj){
    const W = room.settings.width, L = room.settings.length, H = room.settings.height;
    const len = BuildingModel.sideLength(room, side), T = CONSTRUCTION.wallThicknessVisualM;
    const ops = BuildingModel.openingsOn(room, side);
    // a wall shared with a neighbouring room is drawn once, by the room with the smaller id
    const shared = adj[side].reduce((a, n) => a + n.overlapM, 0);
    if (shared >= len * 0.6 && !adj[side].every(n => BuildingModel.ownsSharedWall(room, house.rooms.find(r => r.id === n.roomId)))) return;
    // the front (S) wall stays open for the dollhouse view unless the designer built it or put an opening in it
    if (side === 'S' && !room.design.frontWall && !ops.length) return;
    const wg = new THREE.Group(); wg.name = 'Wall:' + side;
    const place = { N:[0, 0, 0, 0], E:[W, 0, 0, -Math.PI/2], S:[W, 0, L, Math.PI], W:[0, 0, L, Math.PI/2] }[side];
    wg.position.set(place[0], place[1], place[2]); wg.rotation.y = place[3]; g.add(wg);
    const box = (x0, x1, y0, y1) => {
      if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, T), wallMat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0); m.receiveShadow = true; m.castShadow = true; wg.add(m); this.fadable.push(m);
      if (y0 < 0.01){   // baseboard on the interior face of every solid piece that reaches the floor
        const bb = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.09, 0.02), trimMat);
        bb.position.set((x0 + x1) / 2, 0.045, T/2 + 0.01); wg.add(bb); this.fadable.push(bb);
      }
    };
    let cursor = 0;
    for (const o of ops){
      box(cursor, o.pos, 0, H);                         // solid up to the opening
      const sill = o.type === 'window' ? o.sill : 0, top = sill + o.height;
      if (sill > 0.001) box(o.pos, o.pos + o.width, 0, sill);   // below a window
      box(o.pos, o.pos + o.width, top, H);              // lintel above
      this._decorateOpening(wg, room, o, T, trimMat);
      cursor = o.pos + o.width;
    }
    box(cursor, len, 0, H);
  }

  _decorateOpening(wg, room, o, T, trimMat){
    const key = room.id + ':' + o.id, sill = o.type === 'window' ? o.sill : 0, w = o.width, h = o.height, cx = o.pos + w / 2, cy = sill + h / 2;
    const add = (mesh, fade, base) => { wg.add(mesh); if (fade) this._fade(mesh, base); return mesh; };
    const bar = (bw, bh, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, T + 0.02), trimMat); m.position.set(x, y, 0); return add(m, true); };
    const fr = 0.05;
    if (o.type === 'window'){
      const gl = GLAZING_TYPES[o.glazing] || GLAZING_TYPES.double;
      bar(w, fr, cx, sill + fr/2); bar(w, fr, cx, sill + h - fr/2); bar(fr, h, o.pos + fr/2, cy); bar(fr, h, o.pos + w - fr/2, cy);
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.03, 0.16), trimMat); ledge.position.set(cx, sill - 0.015, T/2 + 0.07); add(ledge, true);
      // the sash swings about its left edge when the window is open
      const pivot = new THREE.Group(); pivot.position.set(o.pos + fr, 0, 0); wg.add(pivot);
      const glassMat = new THREE.MeshStandardMaterial({ color:gl.tint, roughness:0.05, metalness:0.2, transparent:true, opacity:gl.opacity });
      const glass = new THREE.Mesh(new THREE.BoxGeometry(w - fr*2, h - fr*2, 0.02), glassMat); glass.position.set((w - fr*2) / 2, cy, 0); pivot.add(glass); this._fade(glass, gl.opacity);
      if (w > 1.3){ const mull = new THREE.Mesh(new THREE.BoxGeometry(0.03, h - fr*2, 0.04), trimMat); mull.position.set((w - fr*2) / 2, cy, 0); pivot.add(mull); this._fade(mull); }
      pivot.rotation.y = -o.open * 1.1;
      this.openingParts[key] = { kind:'window', pivot };
    } else if (o.type === 'garage'){
      const dt = DOOR_TYPES.garage, mat = new THREE.MeshStandardMaterial({ color:dt.color, roughness:0.55, metalness:0.15, transparent:true, opacity:1 });
      bar(w + fr, fr, cx, h + fr/2); bar(fr, h, o.pos - fr/2, cy); bar(fr, h, o.pos + w + fr/2, cy);
      const leaf = new THREE.Group(); leaf.position.set(0, h, 0); wg.add(leaf);       // scaled about the top edge: rolls up into the header
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), mat); panel.position.set(cx, -h/2, 0.0); leaf.add(panel); this._fade(panel);
      for (let i = 1; i < 4; i++){ const gr = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, 0.06), trimMat); gr.position.set(cx, -h * i / 4, 0.005); leaf.add(gr); this._fade(gr); }
      leaf.scale.y = 1 - 0.94 * o.open;
      this.openingParts[key] = { kind:'garage', leaf };
    } else {
      const dt = DOOR_TYPES[o.doorType] || DOOR_TYPES.exterior;
      bar(w + fr*2, fr, cx, h + fr/2); bar(fr, h, o.pos - fr/2, cy); bar(fr, h, o.pos + w + fr/2, cy);
      const pivot = new THREE.Group(); pivot.position.set(o.pos, 0, 0); wg.add(pivot);   // hinge at the wall-walk start
      const mat = new THREE.MeshStandardMaterial({ color:dt.color, roughness:0.6, transparent:true, opacity:1 });
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, h - 0.02, 0.04), mat); leaf.position.set(w / 2, h / 2, 0); pivot.add(leaf); this._fade(leaf);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8), new THREE.MeshStandardMaterial({ color:0xc9cdd2, metalness:0.8, roughness:0.3 }));
      handle.rotation.z = Math.PI/2; handle.position.set(w - 0.12, 1.0, 0.04); pivot.add(handle);
      pivot.rotation.y = -o.open * Math.PI/2;
      this.openingParts[key] = { kind:'door', pivot };
    }
  }

  /** Animates an opening without rebuilding the house (door swing / window sash / garage door). */
  setOpening(roomId, openingId, open){
    const p = this.openingParts[roomId + ':' + openingId]; if (!p) return;
    if (p.kind === 'door') p.pivot.rotation.y = -open * Math.PI/2;
    else if (p.kind === 'window') p.pivot.rotation.y = -open * 1.1;
    else if (p.kind === 'garage') p.leaf.scale.y = 1 - 0.94 * open;
  }

  _buildPartitions(g, room, wallMat, trimMat){
    const H = room.settings.height, T = 0.1;
    for (const p of room.design.partitions){
      const m = WALL_MATERIALS[p.material] || WALL_MATERIALS.drywall;
      const mat = new THREE.MeshStandardMaterial({ color:new THREE.Color(m.color), roughness:0.9, transparent:true, opacity:1 });
      const alongX = Math.abs(p.z2 - p.z1) < 0.05, len = BuildingModel.partitionLength(p);
      const x0 = Math.min(p.x1, p.x2), z0 = Math.min(p.z1, p.z2);
      const dw = p.doorWidth > 0 ? Math.min(p.doorWidth, len - 0.3) : 0, dp = dw > 0 ? (p.doorPos != null ? Math.max(0.1, Math.min(p.doorPos, len - dw - 0.1)) : (len - dw) / 2) : 0;
      const seg = (a, b, y0, y1) => {
        if (b - a < 1e-3) return;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(alongX ? b - a : T, y1 - y0, alongX ? T : b - a), mat);
        mesh.position.set(alongX ? x0 + (a + b) / 2 : p.x1, (y0 + y1) / 2, alongX ? p.z1 : z0 + (a + b) / 2);
        mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); this.fadable.push(mesh);
      };
      if (dw > 0){ seg(0, dp, 0, H); seg(dp + dw, len, 0, H); seg(dp, dp + dw, 2.05, H); } else seg(0, len, 0, H);
    }
  }

  _buildStair(g, house, room, st){
    const { risers } = BuildingModel.stairRun(house, room, st.toLevelId), w = st.width || CONSTRUCTION.stairWidthM;
    const mat = new THREE.MeshStandardMaterial({ color:0x8a6a48, roughness:0.7 }), sg = new THREE.Group();
    sg.position.set(st.x, 0, st.z); sg.rotation.y = { N:0, S:Math.PI, E:-Math.PI/2, W:Math.PI/2 }[st.dir] || 0; g.add(sg);
    for (let i = 0; i < risers - 1; i++){
      const hh = (i + 1) * CONSTRUCTION.riserM;
      const step = new THREE.Mesh(new THREE.BoxGeometry(w, hh, CONSTRUCTION.treadM), mat);
      step.position.set(0, hh / 2, -(i * CONSTRUCTION.treadM + CONSTRUCTION.treadM / 2)); step.castShadow = true; step.receiveShadow = true; sg.add(step);
    }
    const railMat = new THREE.MeshStandardMaterial({ color:0x2b2f33, roughness:0.5, metalness:0.4 });
    const run = (risers - 1) * CONSTRUCTION.treadM, rise = st.rise || (risers * CONSTRUCTION.riserM);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, Math.hypot(run, rise)), railMat);
    rail.position.set(w / 2 - 0.03, rise / 2 + 0.95, -run / 2); rail.rotation.x = Math.atan2(rise, run); sg.add(rail);
  }

  /** Balcony / terrace / garden: a slab or lawn with railings or a hedge on every side not touching a room. */
  _buildOutdoor(g, room, house, floorMat){
    const W = room.settings.width, L = room.settings.length, type = room.type;
    const attached = BuildingModel.outdoorAttachedSides(house, room);
    const railMat = new THREE.MeshStandardMaterial({ color: type === 'garden' ? 0x3f7a3a : 0x2b2f33, roughness:0.7, metalness: type === 'garden' ? 0 : 0.4 });
    const H = type === 'garden' ? 0.6 : Math.min(1.1, room.settings.height);
    if (type === 'garden'){
      const lawn = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, L), new THREE.MeshStandardMaterial({ color:0x4c8a45, roughness:1 }));
      lawn.position.set(W/2, 0.005, L/2); lawn.receiveShadow = true; g.add(lawn);
    }
    const bar = (x, z, w, d, h) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), railMat); m.position.set(x, h / 2, z); m.castShadow = true; g.add(m); };
    if (type === 'garden'){
      for (const side of BuildingModel.SIDES) if (!attached.includes(side)){
        if (side === 'N') bar(W/2, 0.15, W, 0.3, H); if (side === 'S') bar(W/2, L - 0.15, W, 0.3, H);
        if (side === 'W') bar(0.15, L/2, 0.3, L, H); if (side === 'E') bar(W - 0.15, L/2, 0.3, L, H);
      }
      return;
    }
    // balcony / terrace railing: top rail + posts + a glass or slat infill
    const glass = new THREE.MeshStandardMaterial({ color:0xbfe0ff, transparent:true, opacity:0.25, roughness:0.05 });
    const rail = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, alongX = Math.abs(z1 - z0) < 1e-6;
      const top = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.05, 0.05, alongX ? 0.05 : len), railMat); top.position.set(mx, H, mz); g.add(top);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.02, H - 0.1, alongX ? 0.02 : len), glass); pane.position.set(mx, H / 2, mz); g.add(pane);
      for (let i = 0; i <= Math.max(1, Math.round(len / 1.2)); i++){
        const f = i / Math.max(1, Math.round(len / 1.2)), px = x0 + (x1 - x0) * f, pz = z0 + (z1 - z0) * f;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, H, 0.05), railMat); post.position.set(px, H / 2, pz); g.add(post);
      }
    };
    if (!attached.includes('N')) rail(0, 0.03, W, 0.03); if (!attached.includes('S')) rail(0, L - 0.03, W, L - 0.03);
    if (!attached.includes('W')) rail(0.03, 0, 0.03, L); if (!attached.includes('E')) rail(W - 0.03, 0, W - 0.03, L);
  }

  /** Mono-pitch / gable roof: slab(s) that panels mount on (roofGroups[room] = main slope 'a', roofGroups[room#b] = slope 'b'),
   *  plus the gable end walls that close the volume under a gable roof. Orientation comes from BuildingModel.roofSlopes,
   *  the same numbers the shading model and the PV orientation use. */
  _buildRoof(g, room, house, slopes, wallMat){
    const W = room.settings.width, L = room.settings.length, H = room.settings.height, d = room.design.roof;
    const roofTex = TextureFactory.asphalt(0x333a42).clone(); roofTex.needsUpdate = true;
    const fasciaMat = new THREE.MeshStandardMaterial({ color:0x22262b, roughness:0.6 });
    for (const sl of slopes){
      const yaw = new THREE.Group(); yaw.position.set(W / 2, 0, L / 2); yaw.rotation.y = sl.yaw; g.add(yaw);
      const slope = new THREE.Group(); slope.position.set(0, sl.y, sl.dz); slope.rotation.x = sl.pitch;   // +pitch: the +Z (low) edge drops, the slope faces +Z
      yaw.add(slope);
      const tex = roofTex.clone(); tex.needsUpdate = true; tex.repeat.set(sl.across / 1.1, sl.len / 1.4);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sl.across, 0.06, sl.len), new THREE.MeshStandardMaterial({ color:0xffffff, map:tex, roughness:0.85, metalness:0.1 }));
      mesh.castShadow = true; mesh.receiveShadow = true; slope.add(mesh);
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(sl.across, 0.12, 0.03), fasciaMat); fascia.position.set(0, -0.06, sl.len / 2); slope.add(fascia);
      slope.userData.surfaceY = 0.035; slope.userData.span = { w:sl.spanW, l:sl.spanL }; slope.userData.slopeKey = sl.key; slope.userData.azimuthDeg = sl.azimuthDeg;
      this.roofGroups[sl.key === 'a' ? room.id : room.id + '#b'] = slope;
    }
    if (d.type === 'gable'){
      const p = d.pitchDeg * Math.PI / 180, alongIsL = (d.facing === 'S' || d.facing === 'N'), span = alongIsL ? L : W, rise = (span / 2) * Math.tan(p);
      const shape = new THREE.Shape(); shape.moveTo(-span / 2, 0); shape.lineTo(span / 2, 0); shape.lineTo(0, rise); shape.closePath();
      for (const end of [0, 1]){
        const tri = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth:CONSTRUCTION.wallThicknessVisualM, bevelEnabled:false }), wallMat);
        // triangle in local (u,v); ridge along X when facing S/N (end walls at x=0 and x=W), along Z otherwise
        if (alongIsL){ tri.rotation.y = -Math.PI/2; tri.position.set(end ? W : 0, H + 0.05, L / 2); if (!end) tri.rotation.y = Math.PI/2; }
        else { tri.rotation.y = 0; tri.position.set(W / 2, H + 0.05, end ? L : 0); if (end) tri.rotation.y = Math.PI; }
        tri.castShadow = true; g.add(tri); this.fadable.push(tri);
      }
    }
  }

  _addGarageDecor(W,L,g){
    // a couple of overhead storage racks / wall hooks so the garage doesn't look empty even before furnishing
    const rackMat = new THREE.MeshStandardMaterial({ color:0x2b2f33, roughness:0.6, metalness:0.3 });
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.0,0.04,0.4), rackMat);
    rack.position.set(W-0.6, 2.15, 0.6);
    g.add(rack);
  }

  /** t: 0 (fully open, no walls/ceiling) .. 1 (fully closed). One global slider for the whole house. */
  setWallVisibility(t){
    this.wallVisibility = t;
    for (const mesh of this.fadable){
      const base = mesh.userData.baseOpacity == null ? 1 : mesh.userData.baseOpacity;   // glass stays see-through even when fully visible
      mesh.material.opacity = t * base;
      mesh.visible = t > 0.02;
      mesh.castShadow = t > 0.3 && base >= 1;
    }
  }
}
