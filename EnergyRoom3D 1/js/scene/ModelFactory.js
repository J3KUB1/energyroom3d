/**
 * MODEL FACTORY
 * Procedurally builds every device & furniture mesh from primitives.
 * Every builder returns a THREE.Group whose origin sits at the base
 * center of the object (easy floor placement) and which stores:
 *   group.userData.glow = [{ mesh, onColor, onIntensity }]  (LEDs/screens)
 *   group.userData.footprint = [width, depth]  (meters, for grid snap)
 * Geometries/materials are cached & reused across instances to keep
 * the scene light (spec section 28: reusable geometries).
 */
const ModelFactory = (() => {
  const geoCache = new Map();
  const matCache = new Map();

  function geo(key, factory){ if(!geoCache.has(key)) geoCache.set(key, factory()); return geoCache.get(key); }
  function mat(key, color, opts={}){
    const k = key+':'+color+':'+JSON.stringify(opts);
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness:opts.rough??0.6, metalness:opts.metal??0.15, ...opts.extra }));
    return matCache.get(k);
  }
  function box(w,h,d,color,opts={}){
    const m = new THREE.Mesh(geo(`box:${w}:${h}:${d}`, ()=>new THREE.BoxGeometry(w,h,d)), mat('box',color,opts));
    m.castShadow=true; m.receiveShadow=true; return m;
  }
  function cyl(rt,rb,h,color,segs=16,opts={}){
    const m = new THREE.Mesh(geo(`cyl:${rt}:${rb}:${h}:${segs}`, ()=>new THREE.CylinderGeometry(rt,rb,h,segs)), mat('cyl',color,opts));
    m.castShadow=true; m.receiveShadow=true; return m;
  }
  function sph(r,color,segs=12,opts={}){
    const m = new THREE.Mesh(geo(`sph:${r}:${segs}`, ()=>new THREE.SphereGeometry(r,segs,segs)), mat('sph',color,opts));
    m.castShadow=true; m.receiveShadow=true; return m;
  }
  function put(mesh,x,y,z,rx=0,ry=0,rz=0){ mesh.position.set(x,y,z); mesh.rotation.set(rx,ry,rz); return mesh; }
  function grp(){ const g=new THREE.Group(); g.userData.glow=[]; return g; }
  function addGlow(g, mesh, onColor=0x5eead4, onIntensity=1.4){
    mesh.material = mesh.material.clone();
    mesh.material.emissive = new THREE.Color(onColor);
    mesh.material.emissiveIntensity = 0;
    g.userData.glow.push({ mesh, onColor, onIntensity });
    return mesh;
  }

  const B = {}; // builders

  // ---------- COMPUTERS ----------
  B.pc = () => {
    const g = grp();
    const tower = box(0.2,0.42,0.42,0x1c1f24,{rough:0.4});
    put(tower,0,0.21,0); g.add(tower);
    const led = box(0.01,0.3,0.02,0x0a0a0a,{rough:0.2});
    put(led,0.101,0.21,0.15); addGlow(g, led, 0x5eead4, 2); g.add(led);
    const fanRing = cyl(0.07,0.07,0.015,0x2a2f36,20);
    put(fanRing,0.101,0.21,-0.1,0,0,Math.PI/2); g.add(fanRing);
    addGlow(g, fanRing, 0xff6b6b, 1.2);
    g.userData.footprint=[0.22,0.44]; return g;
  };
  B.monitor = () => {
    const g = grp();
    const stand = cyl(0.09,0.11,0.02,0x21252b); put(stand,0,0.02,0); g.add(stand);
    const neck = box(0.03,0.18,0.03,0x21252b); put(neck,0,0.12,0); g.add(neck);
    const screen = box(0.5,0.3,0.02,0x0c0d10,{rough:0.2}); put(screen,0,0.36,0); g.add(screen);
    const panel = box(0.46,0.26,0.005,0x0a1620,{rough:0.1});
    put(panel,0,0.36,0.013); addGlow(g,panel,0x67c8ff,1.6); g.add(panel);
    g.userData.footprint=[0.2,0.2]; return g;
  };
  B.laptop = () => {
    const g = grp();
    const base = box(0.34,0.02,0.24,0x2b2f36); put(base,0,0.01,0); g.add(base);
    const lid = box(0.34,0.22,0.015,0x2b2f36); put(lid,0,0.12,-0.115,-1.32,0,0); g.add(lid);
    const screen = box(0.3,0.18,0.005,0x0a1620,{rough:0.1});
    put(screen,0,0.13,-0.108,-1.32,0,0); addGlow(g,screen,0x67c8ff,1.5); g.add(screen);
    g.userData.footprint=[0.34,0.24]; return g;
  };
  B.router = () => {
    const g = grp();
    const body = box(0.24,0.035,0.14,0x2c2f33); put(body,0,0.018,0); g.add(body);
    for (let i=-1;i<=1;i++){ const a=cyl(0.004,0.004,0.14,0x111214,8); put(a,i*0.07,0.1,0,0,0,0.25*i); g.add(a); }
    const led = box(0.01,0.006,0.01,0x111); put(led,0.08,0.038,0); addGlow(g,led,0x34d399,3); g.add(led);
    g.userData.footprint=[0.24,0.14]; return g;
  };
  B.printer = () => {
    const g = grp();
    const body = box(0.42,0.22,0.36,0xe7e7e2,{rough:0.5}); put(body,0,0.11,0); g.add(body);
    const tray = box(0.34,0.02,0.14,0x2b2b2b); put(tray,0,0.2,0.22); g.add(tray);
    const led = box(0.02,0.01,0.01,0x111); put(led,0.15,0.19,0.18); addGlow(g,led,0x67c8ff,2.5); g.add(led);
    g.userData.footprint=[0.42,0.36]; return g;
  };
  B.console = () => {
    const g = grp();
    const body = box(0.08,0.28,0.24,0x181a1d,{rough:0.35}); put(body,0,0.14,0); g.add(body);
    const stripe = box(0.082,0.28,0.02,0x2a2f36); put(stripe,0,0.14,-0.08); g.add(stripe);
    const led = box(0.084,0.01,0.02,0x111); put(led,0,0.27,0); addGlow(g,led,0xffffff,1.4); g.add(led);
    g.userData.footprint=[0.1,0.26]; return g;
  };

  // ---------- AGD ----------
  B.fridge = () => {
    const g = grp();
    const body = box(0.7,1.8,0.68,0xdcdedd,{rough:0.35,metal:0.3}); put(body,0,0.9,0); g.add(body);
    const seamTop = box(0.71,0.02,0.685,0x9aa0a5); put(seamTop,0,1.28,0); g.add(seamTop);
    const handleTop = box(0.03,0.35,0.04,0x2b2b2b,{metal:0.6,rough:0.3}); put(handleTop,0.36,1.55,0.2); g.add(handleTop);
    const handleBot = box(0.03,0.5,0.04,0x2b2b2b,{metal:0.6,rough:0.3}); put(handleBot,0.36,0.75,0.2); g.add(handleBot);
    const led = box(0.02,0.02,0.01,0x111); put(led,0.36,1.55,0.34); addGlow(g,led,0x67c8ff,2.5); g.add(led);
    g.userData.footprint=[0.72,0.7]; return g;
  };
  B.washer = () => {
    const g = grp();
    const body = box(0.6,0.85,0.6,0xf2f3f2,{rough:0.4}); put(body,0,0.425,0); g.add(body);
    const doorRing = cyl(0.2,0.2,0.04,0x2b2b2b,24); put(doorRing,0,0.4,0.31,Math.PI/2,0,0); g.add(doorRing);
    const doorGlass = cyl(0.16,0.16,0.02,0x121821,24,{rough:0.1}); put(doorGlass,0,0.4,0.33,Math.PI/2,0,0);
    addGlow(g,doorGlass,0x4fd1c5,1.2); g.add(doorGlass);
    const panel = box(0.5,0.08,0.02,0xe7e7e4); put(panel,0,0.78,0.31); g.add(panel);
    const led = box(0.02,0.02,0.005,0x111); put(led,0.18,0.78,0.32); addGlow(g,led,0x34d399,2); g.add(led);
    g.userData.footprint=[0.62,0.62]; return g;
  };
  B.dryer = B.washer; // same silhouette family, distinct color via material override in ObjectManager
  B.dishwasher = () => {
    const g = grp();
    const body = box(0.6,0.82,0.58,0xcfd2d2,{rough:0.4}); put(body,0,0.41,0); g.add(body);
    const panel = box(0.6,0.08,0.02,0x3a3d40); put(panel,0,0.78,0.3); g.add(panel);
    const led = box(0.3,0.01,0.005,0x111); put(led,0,0.78,0.31); addGlow(g,led,0x67c8ff,2); g.add(led);
    const handle = box(0.55,0.03,0.03,0x8a8d90,{metal:0.6}); put(handle,0,0.73,0.3); g.add(handle);
    g.userData.footprint=[0.62,0.6]; return g;
  };
  B.oven = () => {
    const g = grp();
    const body = box(0.6,0.6,0.58,0x24262a,{rough:0.35,metal:0.4}); put(body,0,0.3,0); g.add(body);
    const doorGlass = box(0.5,0.4,0.02,0x0d0d0d,{rough:0.15}); put(doorGlass,0,0.3,0.3);
    addGlow(g,doorGlass,0xff8a4c,1.6); g.add(doorGlass);
    const knobRow=box(0.5,0.03,0.02,0x8a8d90,{metal:0.7}); put(knobRow,0,0.54,0.3); g.add(knobRow);
    g.userData.footprint=[0.62,0.6]; return g;
  };
  B.microwave = () => {
    const g = grp();
    const body = box(0.46,0.28,0.36,0x2a2c2f,{rough:0.35}); put(body,0,0.14,0); g.add(body);
    const doorGlass = box(0.3,0.2,0.02,0x0c0c0c,{rough:0.15}); put(doorGlass,-0.03,0.14,0.18);
    addGlow(g,doorGlass,0x67c8ff,1.4); g.add(doorGlass);
    g.userData.footprint=[0.46,0.36]; return g;
  };
  B.kettle = () => {
    const g = grp();
    const body = cyl(0.09,0.1,0.22,0x1c1f22,16,{metal:0.5,rough:0.3}); put(body,0,0.15,0); g.add(body);
    const lid = cyl(0.075,0.09,0.03,0x1c1f22,16); put(lid,0,0.265,0); g.add(lid);
    const handle = new THREE.Mesh(geo('torus-kettle',()=>new THREE.TorusGeometry(0.06,0.012,8,16,Math.PI*1.3)), mat('handle',0x111,{}));
    put(handle,0.1,0.16,0,0,0,Math.PI/2); g.add(handle);
    const led = box(0.02,0.01,0.01,0x111); put(led,0,0.05,0.095); addGlow(g,led,0xff8a4c,3); g.add(led);
    g.userData.footprint=[0.2,0.2]; return g;
  };
  B.coffeemaker = () => {
    const g = grp();
    const base = box(0.22,0.06,0.32,0x1c1f22); put(base,0,0.03,0); g.add(base);
    const tower = box(0.14,0.32,0.16,0x2a2d31); put(tower,-0.02,0.19,-0.05); g.add(tower);
    const spout = box(0.05,0.05,0.05,0x111); put(spout,-0.02,0.09,0.08); g.add(spout);
    const led = box(0.02,0.01,0.01,0x111); put(led,-0.02,0.34,-0.02); addGlow(g,led,0xff8a4c,3); g.add(led);
    g.userData.footprint=[0.24,0.32]; return g;
  };
  B.toaster = () => {
    const g = grp();
    const body = box(0.28,0.16,0.16,0xd6d8da,{metal:0.6,rough:0.3}); put(body,0,0.08,0); g.add(body);
    const slot1 = box(0.06,0.01,0.1,0x111); put(slot1,-0.06,0.161,0); g.add(slot1);
    const slot2 = box(0.06,0.01,0.1,0x111); put(slot2,0.06,0.161,0); g.add(slot2);
    const lever = box(0.02,0.05,0.02,0x2b2b2b); put(lever,0.13,0.11,0); g.add(lever);
    g.userData.footprint=[0.28,0.18]; return g;
  };
  B.vacuum = () => {
    const g = grp();
    const dock = box(0.16,0.32,0.16,0x2b2d30); put(dock,0,0.16,0); g.add(dock);
    const body = cyl(0.09,0.09,0.35,0x1c1f22,16); put(body,0,0.35,0.02,0,0,0.1); g.add(body);
    const led = box(0.02,0.02,0.01,0x111); put(led,0,0.3,0.09); addGlow(g,led,0x34d399,2.5); g.add(led);
    g.userData.footprint=[0.2,0.2]; return g;
  };

  // ---------- RTV ----------
  B.tv = () => {
    const g = grp();
    const screen = box(1.2,0.68,0.04,0x0a0a0c,{rough:0.15}); put(screen,0,0.34,0); g.add(screen);
    const panel = box(1.14,0.62,0.01,0x0a1420,{rough:0.05});
    put(panel,0,0.34,0.026); addGlow(g,panel,0x6db3ff,1.7); g.add(panel);
    const foot1 = box(0.05,0.14,0.16,0x2b2b2b); put(foot1,-0.4,0.02,0); g.add(foot1);
    const foot2 = box(0.05,0.14,0.16,0x2b2b2b); put(foot2,0.4,0.02,0); g.add(foot2);
    g.userData.footprint=[1.2,0.16]; return g;
  };
  B.soundbar = () => {
    const g = grp();
    const body = box(0.9,0.08,0.1,0x1a1c1f,{rough:0.5}); put(body,0,0.04,0); g.add(body);
    const led = box(0.02,0.01,0.01,0x111); put(led,0,0.06,0.048); addGlow(g,led,0x67c8ff,2); g.add(led);
    g.userData.footprint=[0.9,0.1]; return g;
  };
  B.speaker = () => {
    const g = grp();
    const body = cyl(0.09,0.1,0.24,0x24272b,20); put(body,0,0.12,0); g.add(body);
    const cone = cyl(0.06,0.06,0.02,0x111,20); put(cone,0,0.16,0.09,Math.PI/2,0,0); g.add(cone);
    addGlow(g,cone,0x67c8ff,1.2);
    g.userData.footprint=[0.2,0.2]; return g;
  };
  B.settopbox = () => {
    const g = grp();
    const body = box(0.3,0.05,0.2,0x1a1a1c,{rough:0.4}); put(body,0,0.025,0); g.add(body);
    const led = box(0.015,0.008,0.008,0x111); put(led,0.13,0.052,0.08); addGlow(g,led,0x34d399,3); g.add(led);
    g.userData.footprint=[0.3,0.2]; return g;
  };

  // ---------- LIGHTING ----------
  B.ceilinglamp = () => {
    const g = grp();
    const disc = cyl(0.28,0.3,0.05,0xf4f0e6,24,{rough:0.5}); put(disc,0,-0.025,0); g.add(disc);
    const inner = cyl(0.24,0.24,0.01,0xfff3d6,24,{rough:0.3}); put(inner,0,-0.052,0); addGlow(g,inner,0xffdd99,2.5); g.add(inner);
    g.userData.footprint=[0.6,0.6]; g.userData.ceiling=true; return g;
  };
  B.desklamp = () => {
    const g = grp();
    const base = cyl(0.07,0.08,0.02,0x2b2b2b); put(base,0,0.01,0); g.add(base);
    const arm1 = box(0.02,0.22,0.02,0x2b2b2b); put(arm1,0,0.13,0,0,0,0.3); g.add(arm1);
    const arm2 = box(0.02,0.18,0.02,0x2b2b2b); put(arm2,0.12,0.27,0,0,0,-0.6); g.add(arm2);
    const head = cyl(0.05,0.07,0.09,0x33383e,16); put(head,0.2,0.33,0,0,0,1.2); g.add(head);
    const bulb = sph(0.03,0xfff3d6,10); put(bulb,0.23,0.3,0); addGlow(g,bulb,0xffdd99,3); g.add(bulb);
    g.userData.footprint=[0.2,0.2]; return g;
  };
  B.floorlamp = () => {
    const g = grp();
    const base = cyl(0.14,0.16,0.03,0x2b2b2b,24); put(base,0,0.015,0); g.add(base);
    const pole = cyl(0.015,0.015,1.3,0x2b2b2b,10); put(pole,0,0.68,0); g.add(pole);
    const shade = cyl(0.16,0.22,0.32,0xe9dfc7,20,{rough:0.8}); put(shade,0,1.45,0); g.add(shade);
    const inner = cyl(0.13,0.13,0.02,0xfff3d6,20); put(inner,0,1.3,0); addGlow(g,inner,0xffdd99,2.2); g.add(inner);
    g.userData.footprint=[0.32,0.32]; return g;
  };
  B.ledstrip = () => {
    const g = grp();
    const strip = box(0.9,0.015,0.03,0x111214); put(strip,0,0,0); g.add(strip);
    const glow = box(0.88,0.006,0.02,0x222); put(glow,0,0.011,0); addGlow(g,glow,0x9b5cff,2.4); g.add(glow);
    g.userData.footprint=[0.9,0.03]; g.userData.wallMount=true; return g;
  };

  // ---------- CLIMATE / HEATING ----------
  B.ac = () => {
    const g = grp();
    const body = box(0.75,0.22,0.2,0xf1f2f0,{rough:0.4}); put(body,0,0,0); g.add(body);
    const vent = box(0.7,0.03,0.19,0xd7d9d6); put(vent,0,-0.1,0); g.add(vent);
    const led = box(0.02,0.01,0.01,0x111); put(led,0.3,0.02,0.1); addGlow(g,led,0x67c8ff,3); g.add(led);
    g.userData.footprint=[0.75,0.2]; g.userData.wallMount=true; return g;
  };
  B.fan = () => {
    const g = grp();
    const base = cyl(0.16,0.18,0.03,0x2b2d30,20); put(base,0,0.015,0); g.add(base);
    const pole = cyl(0.02,0.02,1.0,0x2b2d30,10); put(pole,0,0.52,0); g.add(pole);
    const hub = cyl(0.05,0.05,0.06,0x33383e,16); put(hub,0,1.04,0.03,Math.PI/2,0,0); g.add(hub);
    const cage = new THREE.Mesh(geo('torus-fan',()=>new THREE.TorusGeometry(0.22,0.01,8,24)), mat('cage',0xcfd2d4,{metal:0.6}));
    put(cage,0,1.04,0.05); g.userData.blade = null; g.add(cage);
    const blades = new THREE.Group();
    for (let i=0;i<3;i++){ const bl=box(0.16,0.03,0.005,0xdfe1e2,{rough:0.4}); put(bl,Math.cos(i*2.1)*0.09,1.04+Math.sin(i*2.1)*0.09,0.045,0,0,i*2.1); blades.add(bl); }
    g.add(blades); g.userData.spinPart = blades;
    g.userData.footprint=[0.36,0.36]; return g;
  };
  B.heater = () => {
    const g = grp();
    const body = box(0.6,0.55,0.12,0xe8e5df,{rough:0.5}); put(body,0,0.28,0); g.add(body);
    for (let i=0;i<5;i++){ const fin=box(0.55,0.5,0.01,0xd6d2c9); put(fin,0,0.28,-0.05+i*0.025); g.add(fin); }
    const led = box(0.02,0.01,0.01,0x111); put(led,0.25,0.05,0.065); addGlow(g,led,0xff6b4a,3); g.add(led);
    g.userData.footprint=[0.6,0.15]; return g;
  };
  B.fanheater = () => {
    const g = grp();
    const body = cyl(0.13,0.15,0.4,0xe8e5df,20,{rough:0.4}); put(body,0,0.2,0,Math.PI/2,0,0); g.add(body);
    const grill = cyl(0.11,0.11,0.02,0x2b2b2b,20); put(grill,0,0.2,0.2,Math.PI/2,0,0); addGlow(g,grill,0xff6b4a,2); g.add(grill);
    const base = box(0.16,0.05,0.2,0x2b2b2b); put(base,0,0.025,0); g.add(base);
    g.userData.footprint=[0.2,0.4]; return g;
  };

  // ---------- SMART HOME ----------
  B.smartbulb = () => {
    const g = grp();
    const base = cyl(0.02,0.025,0.03,0xcfa96a,12,{metal:0.7,rough:0.3}); put(base,0,0.015,0); g.add(base);
    const bulb = sph(0.045,0xfff3d6,14); put(bulb,0,0.06,0); addGlow(g,bulb,0x9b5cff,3); g.add(bulb);
    g.userData.footprint=[0.1,0.1]; return g;
  };
  B.smartplug = () => {
    const g = grp();
    const body = box(0.06,0.08,0.045,0xf0f0ec,{rough:0.5}); put(body,0,0.04,0); g.add(body);
    const led = box(0.01,0.01,0.005,0x111); put(led,0,0.06,0.024); addGlow(g,led,0x34d399,3); g.add(led);
    g.userData.footprint=[0.06,0.05]; g.userData.wallMount=true; return g;
  };
  B.hub = () => {
    const g = grp();
    const body = cyl(0.07,0.07,0.03,0xf0f0ec,24,{rough:0.4}); put(body,0,0.015,0); g.add(body);
    const ring = cyl(0.055,0.055,0.005,0x222,24); put(ring,0,0.033,0); addGlow(g,ring,0x67c8ff,2.4); g.add(ring);
    g.userData.footprint=[0.16,0.16]; return g;
  };
  B.motionsensor = () => {
    const g = grp();
    const body = box(0.06,0.06,0.035,0xf0f0ec,{rough:0.5}); put(body,0,0.03,0); g.add(body);
    const lens = sph(0.018,0x111,10); put(lens,0,0.03,0.02); addGlow(g,lens,0xff6b6b,2.5); g.add(lens);
    g.userData.footprint=[0.06,0.04]; g.userData.wallMount=true; return g;
  };
  B.camera = () => {
    const g = grp();
    const arm = box(0.02,0.06,0.02,0x2b2b2b); put(arm,0,0.03,0); g.add(arm);
    const body = cyl(0.03,0.035,0.09,0x24272b,16); put(body,0,0.09,0,0,0,Math.PI/2); g.add(body);
    const lens = cyl(0.02,0.02,0.01,0x0a0a0a,16); put(lens,0.05,0.09,0,0,0,Math.PI/2); addGlow(g,lens,0xff6b6b,2.5); g.add(lens);
    g.userData.footprint=[0.1,0.06]; g.userData.wallMount=true; return g;
  };
  B.smartspeaker = () => {
    const g = grp();
    const body = cyl(0.06,0.07,0.09,0xe6e6e2,20,{rough:0.7}); put(body,0,0.045,0); g.add(body);
    const ring = cyl(0.061,0.061,0.006,0x222,20); put(ring,0,0.085,0); addGlow(g,ring,0x67c8ff,2.6); g.add(ring);
    g.userData.footprint=[0.14,0.14]; return g;
  };

  // ---------- OTHER ----------
  B.phonecharger = () => {
    const g = grp();
    const brick = box(0.03,0.04,0.02,0xf0f0ec); put(brick,0,0.02,0); g.add(brick);
    const led = box(0.006,0.006,0.005,0x111); put(led,0,0.03,0.011); addGlow(g,led,0x34d399,3); g.add(led);
    g.userData.footprint=[0.03,0.02]; g.userData.wallMount=true; return g;
  };
  B.laptopcharger = () => {
    const g = grp();
    const brick = box(0.09,0.03,0.05,0xf0f0ec,{rough:0.5}); put(brick,0,0.015,0); g.add(brick);
    const led = box(0.01,0.006,0.005,0x111); put(led,0.03,0.031,0); addGlow(g,led,0x34d399,3); g.add(led);
    g.userData.footprint=[0.09,0.05]; return g;
  };
  B.aquarium = () => {
    const g = grp();
    const frame = box(0.6,0.4,0.32,0x1c1f22,{rough:0.4}); put(frame,0,0.2,0); g.add(frame);
    const water = box(0.56,0.34,0.28,0x1a5f6b,{rough:0.1,extra:{transparent:true,opacity:0.75}}); put(water,0,0.2,0); g.add(water);
    addGlow(g,water,0x2ee6d6,0.6);
    const stand = box(0.62,0.4,0.34,0x3a2c1f,{rough:0.7}); put(stand,0,-0.2,0); g.add(stand);
    g.userData.footprint=[0.62,0.34]; return g;
  };
  B.airpurifier = () => {
    const g = grp();
    const body = cyl(0.14,0.16,0.55,0xf0f0ec,20,{rough:0.5}); put(body,0,0.28,0); g.add(body);
    const ring = cyl(0.145,0.145,0.02,0x222,20); put(ring,0,0.5,0); addGlow(g,ring,0x67c8ff,2); g.add(ring);
    g.userData.footprint=[0.32,0.32]; return g;
  };
  B.humidifier = () => {
    const g = grp();
    const body = cyl(0.1,0.12,0.24,0xe9eef2,20,{rough:0.3}); put(body,0,0.12,0); g.add(body);
    const led = box(0.02,0.01,0.01,0x111); put(led,0,0.2,0.1); addGlow(g,led,0x67c8ff,2.5); g.add(led);
    g.userData.mist=true;
    g.userData.footprint=[0.24,0.24]; return g;
  };

  // ---------- FURNITURE (no energy, still procedural) ----------
  B.bed = () => {
    const g = grp();
    const frame = box(1.6,0.25,2.0,0x3a2c22,{rough:0.7}); put(frame,0,0.125,0); g.add(frame);
    const mattress = box(1.5,0.2,1.9,0xf2ede1,{rough:0.9}); put(mattress,0,0.35,0); g.add(mattress);
    const pillow = box(0.55,0.1,0.35,0xffffff,{rough:0.9}); put(pillow,-0.35,0.5,-0.78); g.add(pillow);
    const pillow2 = box(0.55,0.1,0.35,0xffffff,{rough:0.9}); put(pillow2,0.35,0.5,-0.78); g.add(pillow2);
    const blanket = box(1.5,0.06,1.0,0x6c7fd1,{rough:0.9}); put(blanket,0,0.48,0.45); g.add(blanket);
    const headboard = box(1.6,0.7,0.08,0x3a2c22,{rough:0.7}); put(headboard,0,0.6,-0.98); g.add(headboard);
    g.userData.footprint=[1.6,2.0]; return g;
  };
  B.desk = () => {
    const g = grp();
    const top = box(1.4,0.04,0.7,0x8a6a45,{rough:0.6}); put(top,0,0.72,0); g.add(top);
    for (const [x,z] of [[-0.65,-0.3],[0.65,-0.3],[-0.65,0.3],[0.65,0.3]]){
      const leg=box(0.05,0.72,0.05,0x2b2b2b,{metal:0.5}); put(leg,x,0.36,z); g.add(leg);
    }
    g.userData.footprint=[1.4,0.7]; return g;
  };
  B.chair = () => {
    const g = grp();
    const seat = box(0.42,0.04,0.42,0x5a4a3a,{rough:0.7}); put(seat,0,0.45,0); g.add(seat);
    const back = box(0.42,0.4,0.04,0x5a4a3a,{rough:0.7}); put(back,0,0.65,-0.19); g.add(back);
    for (const [x,z] of [[-0.18,-0.18],[0.18,-0.18],[-0.18,0.18],[0.18,0.18]]){
      const leg=cyl(0.015,0.015,0.44,0x2b2b2b,8); put(leg,x,0.22,z); g.add(leg);
    }
    g.userData.footprint=[0.42,0.42]; return g;
  };
  B.gamingchair = () => {
    const g = grp();
    const base = cyl(0.24,0.24,0.03,0x1c1c1e,10); put(base,0,0.02,0); g.add(base);
    for (let i=0;i<5;i++){ const leg=box(0.22,0.02,0.02,0x1c1c1e); put(leg,0,0.05,0,0,i*1.256,0); leg.position.x=Math.cos(i*1.256)*0.1; leg.position.z=Math.sin(i*1.256)*0.1; g.add(leg); }
    const pole = cyl(0.025,0.025,0.35,0x1c1c1e,10); put(pole,0,0.2,0); g.add(pole);
    const seat = box(0.46,0.1,0.46,0xd6293e,{rough:0.6}); put(seat,0,0.44,0); g.add(seat);
    const back = box(0.46,0.7,0.1,0xd6293e,{rough:0.6}); put(back,0,0.8,-0.2,0.12,0,0); g.add(back);
    const armL = box(0.05,0.05,0.3,0x1c1c1e); put(armL,-0.24,0.55,0); g.add(armL);
    const armR = box(0.05,0.05,0.3,0x1c1c1e); put(armR,0.24,0.55,0); g.add(armR);
    g.userData.footprint=[0.5,0.5]; return g;
  };
  B.sofa = () => {
    const g = grp();
    const base = box(2.0,0.3,0.9,0x445069,{rough:0.85}); put(base,0,0.15,0); g.add(base);
    const back = box(2.0,0.5,0.2,0x445069,{rough:0.85}); put(back,0,0.5,-0.35); g.add(back);
    const armL = box(0.2,0.5,0.9,0x3c4760,{rough:0.85}); put(armL,-0.9,0.4,0); g.add(armL);
    const armR = box(0.2,0.5,0.9,0x3c4760,{rough:0.85}); put(armR,0.9,0.4,0); g.add(armR);
    for (const x of [-0.55,0,0.55]){ const cushion=box(0.55,0.12,0.85,0x505c78,{rough:0.85}); put(cushion,x,0.32,0.02); g.add(cushion); }
    g.userData.footprint=[2.0,0.9]; return g;
  };
  B.coffeetable = () => {
    const g = grp();
    const top = box(1.0,0.04,0.5,0x2b2320,{rough:0.4}); put(top,0,0.42,0); g.add(top);
    for (const [x,z] of [[-0.45,-0.2],[0.45,-0.2],[-0.45,0.2],[0.45,0.2]]){
      const leg=cyl(0.02,0.02,0.42,0x1c1c1c,8,{metal:0.6}); put(leg,x,0.21,z); g.add(leg);
    }
    g.userData.footprint=[1.0,0.5]; return g;
  };
  B.wardrobe = () => {
    const g = grp();
    const body = box(1.2,2.0,0.6,0x5a4632,{rough:0.6}); put(body,0,1.0,0); g.add(body);
    const seam = box(0.01,2.0,0.605,0x3a2c1f); put(seam,0,1.0,0); g.add(seam);
    const h1 = box(0.02,0.15,0.03,0xd8c98a,{metal:0.6}); put(h1,-0.1,1.1,0.31); g.add(h1);
    const h2 = box(0.02,0.15,0.03,0xd8c98a,{metal:0.6}); put(h2,0.1,1.1,0.31); g.add(h2);
    g.userData.footprint=[1.2,0.6]; return g;
  };
  B.dresser = () => {
    const g = grp();
    const body = box(1.0,0.85,0.45,0x5a4632,{rough:0.6}); put(body,0,0.425,0); g.add(body);
    for (let i=0;i<3;i++){ const drawer=box(0.9,0.22,0.02,0x6b563d,{rough:0.6}); put(drawer,0,0.16+i*0.26,0.23); g.add(drawer);
      const handle=box(0.16,0.02,0.02,0xd8c98a,{metal:0.6}); put(handle,0,0.16+i*0.26,0.25); g.add(handle); }
    g.userData.footprint=[1.0,0.45]; return g;
  };
  B.bookshelf = () => {
    const g = grp();
    const body = box(0.9,1.8,0.3,0x5a4632,{rough:0.6}); put(body,0,0.9,0); g.add(body);
    for (let i=1;i<5;i++){ const shelf=box(0.86,0.02,0.28,0x3a2c1f); put(shelf,0,i*0.36,0); g.add(shelf); }
    const colors=[0xb85c4a,0x4a7fb8,0xd6b84a,0x5aa06a,0x8a5cb8];
    for (let i=0;i<5;i++){ const book=box(0.03,0.24,0.18,colors[i%colors.length],{rough:0.8}); put(book,-0.3+i*0.14,0.5,0.02); g.add(book); }
    g.userData.footprint=[0.9,0.3]; return g;
  };
  B.shelves = () => {
    const g = grp();
    for (let i=0;i<3;i++){ const shelf=box(0.8,0.02,0.25,0x5a4632,{rough:0.6}); put(shelf,0,0.3+i*0.35,0); g.add(shelf);
      const bracket=box(0.02,0.02,0.25,0x2b2b2b); put(bracket,-0.38,0.3+i*0.35-0.01,0); g.add(bracket); }
    g.userData.footprint=[0.8,0.25]; g.userData.wallMount=true; return g;
  };
  B.tvstand = () => {
    const g = grp();
    const body = box(1.4,0.4,0.4,0x2b2320,{rough:0.5}); put(body,0,0.2,0); g.add(body);
    const doorSeam = box(0.01,0.35,0.42,0x1c1610); put(doorSeam,0,0.2,0); g.add(doorSeam);
    for (const [x,z] of [[-0.65,-0.18],[0.65,-0.18],[-0.65,0.18],[0.65,0.18]]){
      const leg=cyl(0.02,0.02,0.08,0x1c1c1c,8); put(leg,x,0.04,z); g.add(leg);
    }
    g.userData.footprint=[1.4,0.4]; return g;
  };
  B.table = () => {
    const g = grp();
    const top = box(1.4,0.05,0.8,0x8a6a45,{rough:0.6}); put(top,0,0.75,0); g.add(top);
    for (const [x,z] of [[-0.6,-0.32],[0.6,-0.32],[-0.6,0.32],[0.6,0.32]]){
      const leg=box(0.06,0.75,0.06,0x5a4632,{rough:0.6}); put(leg,x,0.375,z); g.add(leg);
    }
    g.userData.footprint=[1.4,0.8]; return g;
  };
  B.diningchair = B.chair;
  B.rug = () => {
    const g = grp();
    const rug = new THREE.Mesh(geo('rug-cyl-alt',()=>new THREE.BoxGeometry(2.2,0.02,1.6)), mat('rug',0x7a3f4d,{rough:1}));
    rug.receiveShadow=true; put(rug,0,0.011,0); g.add(rug);
    const border = box(2.2,0.005,1.6,0x5c2e39,{rough:1}); put(border,0,0.021,0); g.add(border);
    g.userData.footprint=[2.2,1.6]; g.userData.flat=true; return g;
  };

  return {
    build(modelType){
      const fn = B[modelType] || B._fallback;
      const g = (fn||fallback)();
      g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
      return g;
    }
  };

  function fallback(){
    const g = grp();
    const b = box(0.3,0.3,0.3,0x66707f,{rough:0.6}); put(b,0,0.15,0); g.add(b);
    g.userData.footprint=[0.3,0.3]; return g;
  }
})();
