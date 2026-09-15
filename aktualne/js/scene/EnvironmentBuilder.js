/**
 * ENVIRONMENT BUILDER
 * The exterior world around the house: lawn, a driveway leading to the
 * garage door, a low hedge marking the plot boundary, and a handful of
 * procedural trees. Purely decorative (never touches energy data) but
 * gives the house somewhere to sit instead of floating on a bare grid.
 * Rebuilt whenever the house layout changes so the driveway keeps
 * lining up with the garage door.
 */
class EnvironmentBuilder {
  constructor(scene){
    this.scene = scene;
    this.group = new THREE.Group(); this.group.name = 'Environment';
    scene.add(this.group);
  }

  build(houseBounds){
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    if (!Object.keys(houseBounds).length) return;

    let minX=Infinity, maxX=-Infinity, minZ=0, maxZ=-Infinity, maxH=2.8;
    for (const id in houseBounds){
      const b = houseBounds[id];
      minX = Math.min(minX, b.offsetX); maxX = Math.max(maxX, b.offsetX+b.width);
      maxZ = Math.max(maxZ, b.length); maxH = Math.max(maxH, b.height);
    }
    const plotPad = 5.5;
    const plotMinX = minX - plotPad, plotMaxX = maxX + plotPad;
    const plotMinZ = minZ - plotPad, plotMaxZ = maxZ + plotPad*1.3;
    const cx = (plotMinX+plotMaxX)/2, cz = (plotMinZ+plotMaxZ)/2;

    this._lawn(plotMinX, plotMaxX, plotMinZ, plotMaxZ);
    this._hedge(plotMinX, plotMaxX, plotMinZ, plotMaxZ);
    this._trees(plotMinX, plotMaxX, plotMinZ, plotMaxZ, houseBounds);
    this._garageDriveway(houseBounds, plotMinZ);
    this._frontWalkway(houseBounds, plotMinZ);
  }

  _lawn(x1,x2,z1,z2){
    const w = x2-x1, d = z2-z1;
    const tex = TextureFactory.grass(0x3f6b3a).clone(); tex.needsUpdate = true;
    tex.repeat.set(w/1.3, d/1.3);
    const mat = new THREE.MeshStandardMaterial({ color:0xffffff, map:tex, roughness:1 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    mesh.rotation.x = -Math.PI/2;
    mesh.position.set((x1+x2)/2, -0.04, (z1+z2)/2);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  _hedge(x1,x2,z1,z2){
    const mat = new THREE.MeshStandardMaterial({ color:0x2f5233, roughness:0.95 });
    const h=0.55, th=0.28, inset=0.4;
    // front (south, z1) edge intentionally left open - that's where the driveway/walkway exit the plot
    const segs = [
      [x2-x1-inset*2, th, x1+inset+(x2-x1-inset*2)/2, z2-inset], // back
      [th, z2-z1-inset*2, x1+inset, z1+inset+(z2-z1-inset*2)/2], // left
      [th, z2-z1-inset*2, x2-inset, z1+inset+(z2-z1-inset*2)/2], // right
    ];
    for (const [w,d,px,pz] of segs){
      if (w<=0||d<=0) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
      m.position.set(px,h/2,pz); m.castShadow=true; m.receiveShadow=true;
      this.group.add(m);
    }
  }

  _trees(x1,x2,z1,z2,houseBounds){
    const spots = [
      [x1+1.3, z1+1.6], [x2-1.4, z1+1.3], [x1+1.6, z2-1.4], [x2-1.7, z2-2.2], [x1+0.9, (z1+z2)/2],
    ];
    for (const [x,z] of spots){
      if (this._overlapsHouse(x,z,houseBounds)) continue;
      this.group.add(this._tree(x, z, 0.75+Math.random()*0.35));
    }
  }
  _overlapsHouse(x,z,houseBounds){
    for (const id in houseBounds){
      const b = houseBounds[id];
      if (x > b.offsetX-1.2 && x < b.offsetX+b.width+1.2 && z > -1.2 && z < b.length+1.2) return true;
    }
    return false;
  }
  _tree(x,z,scale){
    const g = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color:0x4a3626, roughness:0.9 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09*scale,0.13*scale,1.1*scale,8), trunkMat);
    trunk.position.y = 0.55*scale; trunk.castShadow=true; g.add(trunk);
    const leafColors = [0x3d6b34, 0x487a3d, 0x35602c];
    for (let i=0;i<3;i++){
      const leafMat = new THREE.MeshStandardMaterial({ color:leafColors[i%3], roughness:0.95 });
      const r = (0.62 - i*0.09)*scale;
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafMat);
      leaf.position.set((Math.random()-0.5)*0.25*scale, (1.25+i*0.38)*scale, (Math.random()-0.5)*0.25*scale);
      leaf.rotation.set(Math.random(),Math.random(),Math.random());
      leaf.castShadow = true;
      g.add(leaf);
    }
    g.position.set(x,0,z);
    return g;
  }

  /** A concrete driveway strip filling the gap between the main house and the garage,
   *  running the depth of the plot so it reads as a side driveway/alley leading to the
   *  garage door (which faces into that gap). Safer than routing across the front lawn
   *  since it can never clip through either building regardless of room sizes. */
  _garageDriveway(houseBounds, plotMinZ){
    const ids = Object.keys(houseBounds);
    const garageId = ids.find(id => id==='garage');
    if (!garageId || ids.length<2) return;
    const others = ids.filter(id=>id!==garageId).map(id=>houseBounds[id]);
    const gStart = Math.min(...others.map(b=>b.offsetX+b.width));
    const gEnd = houseBounds[garageId].offsetX;
    const gapW = gEnd - gStart;
    if (gapW <= 0.2) return;
    const maxLen = Math.max(houseBounds[garageId].length, ...others.map(b=>b.length));
    const lenZ = maxLen + 3.0;
    const tex = TextureFactory.asphalt(0x2b2d31).clone(); tex.needsUpdate = true;
    tex.repeat.set(gapW/1.4, lenZ/1.6);
    const mat = new THREE.MeshStandardMaterial({ color:0xffffff, map:tex, roughness:0.95 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(gapW-0.1, lenZ), mat);
    mesh.rotation.x = -Math.PI/2;
    mesh.position.set((gStart+gEnd)/2, -0.035, maxLen/2 - 0.5);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** A short paved path from off-plot to the main room's entry door (right wall, x=W plane). */
  _frontWalkway(houseBounds, plotMinZ){
    const mainId = Object.keys(houseBounds).find(id => id==='main') || Object.keys(houseBounds)[0];
    if (!mainId) return;
    const b = houseBounds[mainId];
    const doorZ = 0.7 + 0.475; // matches RoomBuilder._wallWithDoor default door center offset
    const pathW = 1.1, endX = b.offsetX + b.width + 3.2;
    const startX = b.offsetX + b.width;
    const lenX = endX - startX;
    const tex = TextureFactory.concrete(0xb9bcc2).clone(); tex.needsUpdate = true;
    tex.repeat.set(lenX/1.1, pathW/0.9);
    const mat = new THREE.MeshStandardMaterial({ color:0xffffff, map:tex, roughness:0.9 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(lenX, pathW), mat);
    mesh.rotation.x = -Math.PI/2;
    mesh.position.set(startX + lenX/2, -0.035, doorZ);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }
}
