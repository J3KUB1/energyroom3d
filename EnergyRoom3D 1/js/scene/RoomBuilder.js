/**
 * ROOM BUILDER
 * Builds/rebuilds the room mesh group from RoomSettings. Pure THREE.js
 * geometry construction - no app logic. Unity mapping: RoomManager
 * building a modular room from prefab pieces (walls/floor/ceiling).
 */
const ROOM_MATERIALS = {
  floor: {
    Wood:     { color:0x8a5a37, rough:0.75, metal:0.0 },
    Tile:     { color:0xcfd6dd, rough:0.35, metal:0.05 },
    Concrete: { color:0x8b8f96, rough:0.9,  metal:0.0 },
    Carpet:   { color:0x5b4a63, rough:1.0,  metal:0.0 },
  },
  wall: {
    White:    { color:0xe9e7e1, rough:0.95, metal:0.0 },
    Gray:     { color:0x9aa0a8, rough:0.95, metal:0.0 },
    Brick:    { color:0x9c5b47, rough:0.9,  metal:0.0 },
    Concrete: { color:0x7d818a, rough:0.95, metal:0.0 },
  },
  ceiling: { White:{ color:0xf3f2ee, rough:0.95, metal:0.0 } },
};

class RoomBuilder {
  constructor(scene){ this.scene = scene; this.group = new THREE.Group(); this.group.name='Room'; scene.add(this.group); this.sockets=[]; }

  build(settings){
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.sockets = [];
    const { width:W, length:L, height:H, floor, wall, ceiling } = settings;
    const wallMatDef = ROOM_MATERIALS.wall[wall]||ROOM_MATERIALS.wall.White;
    const floorMatDef = ROOM_MATERIALS.floor[floor]||ROOM_MATERIALS.floor.Wood;
    const wallMat = new THREE.MeshStandardMaterial({ color:wallMatDef.color, roughness:wallMatDef.rough, metalness:wallMatDef.metal });
    const floorMat = new THREE.MeshStandardMaterial({ color:floorMatDef.color, roughness:floorMatDef.rough, metalness:floorMatDef.metal });
    const ceilMat = new THREE.MeshStandardMaterial({ color:0xf3f2ee, roughness:0.95 });
    const trimMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.6 });

    // FLOOR
    const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, L), floorMat);
    floorMesh.position.set(W/2, -0.025, L/2);
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);

    // CEILING
    const ceilMesh = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, L), ceilMat);
    ceilMesh.position.set(W/2, H+0.025, L/2);
    ceilMesh.receiveShadow = true;
    this.group.add(ceilMesh);

    const wallThickness = 0.1;
    // BACK WALL (z=0) with window
    this._wallWithOpening(W, H, wallThickness, wallMat, 'back').position.set(W/2, H/2, 0);
    // LEFT WALL (x=0)
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, H, L), wallMat);
    leftWall.position.set(0, H/2, L/2); leftWall.receiveShadow=true; leftWall.castShadow=true;
    this.group.add(leftWall);
    // RIGHT WALL (x=W) with door
    this._wallWithDoor(L, H, wallThickness, wallMat, trimMat).position.set(W, H/2, L/2);
    // FRONT WALL (z=L) - left mostly open for camera, build low back-half only for realism (skip to keep viewport open)

    // BASEBOARDS
    this._addBaseboard(W, L, wallThickness, trimMat);

    // WINDOW (on back wall)
    this._addWindow(W, H, trimMat);

    // WALL SOCKETS (spec #43/#44) - along back and left walls
    this._addSockets(W, L, H);

    this.settings = settings;
  }

  _wallWithOpening(W,H,thickness,mat){
    // back wall with a window cut-out (approximate using two boxes above/below/side of window)
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
    this.group.add(group);
    return group;
  }

  _wallWithDoor(L,H,thickness,mat,trimMat){
    const group = new THREE.Group();
    const doorW=0.95, doorH=2.05;
    const doorZ = 0.7; // offset from back wall
    const sideBefore = doorZ;
    const sideAfter = L-doorZ-doorW;
    const before = new THREE.Mesh(new THREE.BoxGeometry(thickness, H, Math.max(sideBefore,0.05)), mat);
    before.position.set(0, 0, -L/2+sideBefore/2); before.receiveShadow=true; before.castShadow=true; group.add(before);
    const after = new THREE.Mesh(new THREE.BoxGeometry(thickness, H, Math.max(sideAfter,0.05)), mat);
    after.position.set(0, 0, -L/2+sideBefore+doorW+sideAfter/2); after.receiveShadow=true; after.castShadow=true; group.add(after);
    const aboveH = H-doorH;
    const above = new THREE.Mesh(new THREE.BoxGeometry(thickness, aboveH, doorW), mat);
    above.position.set(0, H/2-aboveH/2, -L/2+sideBefore+doorW/2); above.receiveShadow=true; group.add(above);
    // door leaf
    const doorMat = new THREE.MeshStandardMaterial({ color:0x5a3d28, roughness:0.6 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, doorH-0.04, doorW-0.06), doorMat);
    door.position.set(-thickness/2-0.02, -H/2+doorH/2, -L/2+sideBefore+doorW/2);
    door.castShadow=true; group.add(door);
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.02,8,8), new THREE.MeshStandardMaterial({color:0xd8c98a, metalness:0.8, roughness:0.3}));
    handle.position.set(-thickness/2-0.05, -H/2+doorH/2, -L/2+sideBefore+doorW-0.12);
    group.add(handle);
    this.group.add(group);
    return group;
  }

  _addBaseboard(W,L,thickness,trimMat){
    const h=0.09, d=0.02;
    const back = new THREE.Mesh(new THREE.BoxGeometry(W,h,d), trimMat);
    back.position.set(W/2, h/2, thickness/2+0.001); this.group.add(back);
    const left = new THREE.Mesh(new THREE.BoxGeometry(d,h,L), trimMat);
    left.position.set(thickness/2+0.001, h/2, L/2); this.group.add(left);
  }

  _addWindow(W,H,trimMat){
    if (!this._winInfo) return;
    const { winW, winH, winBottom } = this._winInfo;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(winW+0.08, winH+0.08, 0.08), trimMat);
    frame.position.set(W/2, winBottom+winH/2, 0.02);
    this.group.add(frame);
    const glassMat = new THREE.MeshPhysicalMaterial({ color:0xbfe0ff, transparent:true, opacity:0.28, roughness:0.05, metalness:0, transmission:0.55, reflectivity:0.4 });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, 0.02), glassMat);
    glass.position.set(W/2, winBottom+winH/2, 0.05);
    this.group.add(glass);
    // mullion cross
    const mullMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.5 });
    const vMull = new THREE.Mesh(new THREE.BoxGeometry(0.03, winH, 0.06), mullMat);
    vMull.position.set(W/2, winBottom+winH/2, 0.05); this.group.add(vMull);
    const hMull = new THREE.Mesh(new THREE.BoxGeometry(winW, 0.03, 0.06), mullMat);
    hMull.position.set(W/2, winBottom+winH/2, 0.05); this.group.add(hMull);
    // parapet (sill)
    const sill = new THREE.Mesh(new THREE.BoxGeometry(winW+0.18, 0.05, 0.22), trimMat);
    sill.position.set(W/2, winBottom-0.03, 0.1); this.group.add(sill);
  }

  _addSockets(W,L,H){
    const socketMat = new THREE.MeshStandardMaterial({ color:0xf5f5f0, roughness:0.5 });
    const plateGeo = new THREE.BoxGeometry(0.09,0.09,0.01);
    const positions = [
      [1.2, 0.3, 0.055], [W-1.2, 0.3, 0.055],
      [0.055, 0.3, 1.2], [0.055, 0.3, L-1.2],
    ];
    for (const [x,y,z] of positions){
      const s = new THREE.Mesh(plateGeo, socketMat);
      s.position.set(x,y,z);
      this.group.add(s);
      this.sockets.push(s);
    }
  }
}
