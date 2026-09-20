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

  /** Rebuild every room from scratch. `rooms` = [{id,name,type,settings,offsetX}] */
  build(rooms){
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    for (const id in this.gridGroups){ const gg = this.gridGroups[id]; gg.traverse(o=>{ if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    this.roomGroups = {}; this.roofGroups = {}; this.fadable = []; this.bounds = {}; this.occluders = []; this.gridGroups = {};
    for (const r of rooms) this._buildRoom(r);
    this.setWallVisibility(this.wallVisibility);
  }

  _buildRoom(room){
    const { id, type, settings, offsetX } = room;
    const g = new THREE.Group(); g.name = 'Room:'+id; g.position.set(offsetX, 0, 0);
    this.group.add(g);
    this.roomGroups[id] = g;
    this.bounds[id] = { width:settings.width, length:settings.length, height:settings.height, offsetX };

    const { width:W, length:L, height:H, floor, wall } = settings;
    const isGarage = type === 'garage';
    const wallMatDef = ROOM_MATERIALS.wall[wall]||ROOM_MATERIALS.wall.White;
    const floorMatDef = ROOM_MATERIALS.floor[floor]||ROOM_MATERIALS.floor.Wood;

    const wallTex = this._roomTexture('wall', wall, wallMatDef.color, W, H);
    const floorTex = this._roomTexture('floor', floor, floorMatDef.color, W, L);
    const wallMat = new THREE.MeshStandardMaterial({ color:0xffffff, map:wallTex, roughness:wallMatDef.rough, metalness:wallMatDef.metal, transparent:true, opacity:1 });
    const floorMat = new THREE.MeshStandardMaterial({ color:0xffffff, map:floorTex, roughness:floorMatDef.rough, metalness:floorMatDef.metal,
      polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:2 }); // pushed back a hair so the grid on top can never z-fight
    const ceilTex = TextureFactory.plaster(0xf3f2ee).clone(); ceilTex.needsUpdate = true; ceilTex.repeat.set(W/2.4, L/2.4);
    const ceilMat = new THREE.MeshStandardMaterial({ color:0xffffff, map:ceilTex, roughness:0.95, transparent:true, opacity:1 });
    const trimMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.6, transparent:true, opacity:1 });

    const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, L), floorMat);
    floorMesh.position.set(W/2, -0.025, L/2); floorMesh.receiveShadow = true; g.add(floorMesh);

    const ceilMesh = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, L), ceilMat);
    ceilMesh.position.set(W/2, H+0.025, L/2); ceilMesh.receiveShadow = true; g.add(ceilMesh);
    this.fadable.push(ceilMesh);

    const wallThickness = 0.1;
    if (isGarage){
      this._garageDoorWall(W, L, H, wallThickness, wallMat, trimMat, g);
    } else {
      this._wallWithOpening(W, H, wallThickness, wallMat, g);
      const leftWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, H, L), wallMat);
      leftWall.position.set(0, H/2, L/2); leftWall.receiveShadow=true; leftWall.castShadow=true;
      g.add(leftWall); this.fadable.push(leftWall);
    }
    this._wallWithDoor(L, H, wallThickness, wallMat, trimMat, W, g, isGarage);
    this._addBaseboard(W, L, wallThickness, trimMat, g);
    if (!isGarage) this._addWindow(W, H, trimMat, g);
    else this._addSkylightWindow(W, H, trimMat, g);
    // wall sockets are real installation objects now (ElectricalSystem.ensureRoom creates them) - no decoration here
    this._buildFloorGrid(id, W, L, g);

    // building as a shading occluder: the whole footprint up to the top of the ceiling slab
    this.occluders.push(ShadeModel.box([offsetX, 0, 0], [offsetX + W, H + 0.05, L], { ownerRoomId:id }));

    if (isGarage){
      this._addGarageRoof(id, W, L, H, g);
      this._addGarageDecor(W, L, g);
    }
  }

  _wallWithOpening(W,H,thickness,mat,g){
    const group = new THREE.Group();
    const winW=1.8, winH=1.3, winBottom=0.9;
    const sideW = (W-winW)/2;
    const left = new THREE.Mesh(new THREE.BoxGeometry(sideW, H, thickness), mat);
    left.position.set(-W/2+sideW/2, 0, 0); left.receiveShadow=true; left.castShadow=true; group.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(sideW, H, thickness), mat);
    right.position.set(W/2-sideW/2, 0, 0); right.receiveShadow=true; right.castShadow=true; group.add(right);
    const below = new THREE.Mesh(new THREE.BoxGeometry(winW, winBottom, thickness), mat);
    below.position.set(0, -H/2+winBottom/2, 0); below.receiveShadow=true; group.add(below);
    const aboveH = H-winBottom-winH;
    const above = new THREE.Mesh(new THREE.BoxGeometry(winW, Math.max(aboveH,0.05), thickness), mat);
    above.position.set(0, H/2-Math.max(aboveH,0.05)/2, 0); above.receiveShadow=true; group.add(above);
    this._winInfo = { winW, winH, winBottom, W, H };
    group.position.set(W/2, H/2, 0);
    g.add(group);
    group.children.forEach(c=>this.fadable.push(c));
    return group;
  }

  _garageDoorWall(W,L,H,thickness,mat,trimMat,g){
    // full-width sectional garage door on the left wall (x=0 plane), with horizontal panel ridges
    const doorH = Math.min(2.15, H-0.25);
    const margin = 0.35;
    const doorW = L - margin*2;
    const above = new THREE.Mesh(new THREE.BoxGeometry(thickness, H-doorH, L), mat);
    above.position.set(0, H/2-(H-doorH)/2, L/2); above.receiveShadow=true; above.castShadow=true; g.add(above); this.fadable.push(above);
    const sideA = new THREE.Mesh(new THREE.BoxGeometry(thickness, doorH, margin), mat);
    sideA.position.set(0, doorH/2, margin/2); sideA.receiveShadow=true; g.add(sideA); this.fadable.push(sideA);
    const sideB = new THREE.Mesh(new THREE.BoxGeometry(thickness, doorH, margin), mat);
    sideB.position.set(0, doorH/2, L-margin/2); sideB.receiveShadow=true; g.add(sideB); this.fadable.push(sideB);

    const doorMat = new THREE.MeshStandardMaterial({ color:0xd8dade, roughness:0.55, metalness:0.35, transparent:true, opacity:1 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.045, doorH-0.04, doorW-0.04), doorMat);
    door.position.set(-thickness/2-0.02, doorH/2, L/2);
    door.castShadow=true; g.add(door); this.fadable.push(door);
    const ridgeMat = new THREE.MeshStandardMaterial({ color:0xaeb2b8, roughness:0.5, metalness:0.3, transparent:true, opacity:1 });
    const ridgeCount = 5;
    for (let i=1;i<ridgeCount;i++){
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.01,0.012,doorW-0.06), ridgeMat);
      ridge.position.set(-thickness/2-0.045, (doorH/ridgeCount)*i, L/2);
      g.add(ridge); this.fadable.push(ridge);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02,0.25,0.02), new THREE.MeshStandardMaterial({color:0x2b2b2b, metalness:0.5, roughness:0.4}));
    handle.position.set(-thickness/2-0.06, doorH*0.55, L/2);
    g.add(handle);
  }

  _wallWithDoor(L,H,thickness,mat,trimMat,W,g,isGarage){
    const group = new THREE.Group();
    const doorW = isGarage ? 1.0 : 0.95, doorH = isGarage ? 2.1 : 2.05;
    const doorZ = 0.7;
    const sideBefore = doorZ;
    const sideAfter = L-doorZ-doorW;
    const before = new THREE.Mesh(new THREE.BoxGeometry(thickness, H, Math.max(sideBefore,0.05)), mat);
    before.position.set(0, 0, -L/2+sideBefore/2); before.receiveShadow=true; before.castShadow=true; group.add(before);
    const after = new THREE.Mesh(new THREE.BoxGeometry(thickness, H, Math.max(sideAfter,0.05)), mat);
    after.position.set(0, 0, -L/2+sideBefore+doorW+sideAfter/2); after.receiveShadow=true; after.castShadow=true; group.add(after);
    const aboveH = H-doorH;
    const above = new THREE.Mesh(new THREE.BoxGeometry(thickness, aboveH, doorW), mat);
    above.position.set(0, H/2-aboveH/2, -L/2+sideBefore+doorW/2); above.receiveShadow=true; group.add(above);
    const doorMat = new THREE.MeshStandardMaterial({ color:isGarage?0x3a3f45:0x5a3d28, roughness:0.6, transparent:true, opacity:1 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, doorH-0.04, doorW-0.06), doorMat);
    door.position.set(-thickness/2-0.02, -H/2+doorH/2, -L/2+sideBefore+doorW/2);
    door.castShadow=true; group.add(door);
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.02,8,8), new THREE.MeshStandardMaterial({color:0xd8c98a, metalness:0.8, roughness:0.3}));
    handle.position.set(-thickness/2-0.05, -H/2+doorH/2, -L/2+sideBefore+doorW-0.12);
    group.add(handle);
    group.position.set(W, H/2, L/2);
    g.add(group);
    group.children.forEach(c=>{ if(c!==handle) this.fadable.push(c); });
    return group;
  }

  _addBaseboard(W,L,thickness,trimMat,g){
    const h=0.09, d=0.02;
    const back = new THREE.Mesh(new THREE.BoxGeometry(W,h,d), trimMat);
    back.position.set(W/2, h/2, thickness/2+0.001); g.add(back); this.fadable.push(back);
    const left = new THREE.Mesh(new THREE.BoxGeometry(d,h,L), trimMat);
    left.position.set(thickness/2+0.001, h/2, L/2); g.add(left); this.fadable.push(left);
  }

  _addWindow(W,H,trimMat,g){
    if (!this._winInfo) return;
    const { winW, winH, winBottom } = this._winInfo;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(winW+0.08, winH+0.08, 0.08), trimMat);
    frame.position.set(W/2, winBottom+winH/2, 0.02); g.add(frame); this.fadable.push(frame);
    const glassMat = new THREE.MeshPhysicalMaterial({ color:0xbfe0ff, transparent:true, opacity:0.28, roughness:0.05, metalness:0, transmission:0.55, reflectivity:0.4 });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, 0.02), glassMat);
    glass.position.set(W/2, winBottom+winH/2, 0.05); g.add(glass); this.fadable.push(glass);
    const mullMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.5, transparent:true, opacity:1 });
    const vMull = new THREE.Mesh(new THREE.BoxGeometry(0.03, winH, 0.06), mullMat);
    vMull.position.set(W/2, winBottom+winH/2, 0.05); g.add(vMull); this.fadable.push(vMull);
    const hMull = new THREE.Mesh(new THREE.BoxGeometry(winW, 0.03, 0.06), mullMat);
    hMull.position.set(W/2, winBottom+winH/2, 0.05); g.add(hMull); this.fadable.push(hMull);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(winW+0.18, 0.05, 0.22), trimMat);
    sill.position.set(W/2, winBottom-0.03, 0.1); g.add(sill); this.fadable.push(sill);
  }

  _addSkylightWindow(W,H,trimMat,g){
    // small high strip window for the garage, on the back wall
    const winW = Math.min(1.2, W*0.4), winH=0.5, winBottom=H-0.65;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(winW+0.06, winH+0.06, 0.06), trimMat);
    frame.position.set(W/2, winBottom+winH/2, 0.02); g.add(frame); this.fadable.push(frame);
    const glassMat = new THREE.MeshPhysicalMaterial({ color:0xbfe0ff, transparent:true, opacity:0.3, roughness:0.05, transmission:0.5 });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, 0.02), glassMat);
    glass.position.set(W/2, winBottom+winH/2, 0.04); g.add(glass); this.fadable.push(glass);
  }

  /** Mono-pitch roof for a garage, tilted ~12°. Solar panels parent to the returned group
   *  and sit flush at local y = userData.surfaceY with local rotation (0,0,0). */
  _addGarageRoof(roomId, W, L, H, g){
    const pitchDeg = 12;
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    const overhang = 0.25;
    const roofGroup = new THREE.Group();
    roofGroup.position.set(W/2, H + 0.05, L/2);
    roofGroup.rotation.x = -pitch; // low edge toward +Z (front), high edge toward -Z (back)
    g.add(roofGroup);
    this.roofGroups[roomId] = roofGroup;

    const roofLen = L/Math.cos(pitch) + overhang*2;
    const roofTex = TextureFactory.asphalt(0x333a42).clone(); roofTex.needsUpdate = true; roofTex.repeat.set((W+overhang*2)/1.1, roofLen/1.4);
    const roofMat = new THREE.MeshStandardMaterial({ color:0xffffff, map:roofTex, roughness:0.85, metalness:0.1 });
    const roofMesh = new THREE.Mesh(new THREE.BoxGeometry(W+overhang*2, 0.06, roofLen), roofMat);
    roofMesh.position.set(0, 0, 0);
    roofMesh.castShadow = true; roofMesh.receiveShadow = true;
    roofGroup.add(roofMesh);
    // ridge cap + fascia trim for a finished look
    const fasciaMat = new THREE.MeshStandardMaterial({ color:0x22262b, roughness:0.6 });
    const fasciaFront = new THREE.Mesh(new THREE.BoxGeometry(W+overhang*2, 0.12, 0.03), fasciaMat);
    fasciaFront.position.set(0, -0.06, roofLen/2); roofGroup.add(fasciaFront);
    roofGroup.userData.surfaceY = 0.035;
    roofGroup.userData.span = { w: W+overhang*1.2, l: roofLen-overhang*1.2 };
    // the tilted slab (incl. overhang) shades whatever sits behind/below it, but never panels mounted on it
    const off = (this.bounds[roomId] && this.bounds[roomId].offsetX) || 0;
    const c = Math.cos(pitch), sn = Math.sin(pitch);
    this.occluders.push({ kind:'obb', center:[off + W/2, H + 0.05, L/2],
      axes:[[1,0,0],[0,c,-sn],[0,sn,c]], half:[(W+overhang*2)/2, 0.03, roofLen/2], transmit:0, ownerRoomId:roomId, isRoof:true });
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
      mesh.material.opacity = t;
      mesh.visible = t > 0.02;
      mesh.castShadow = t > 0.3;
    }
  }
}
