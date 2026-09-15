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
    const steamGeo = geo('sph:0.05:8', ()=>new THREE.SphereGeometry(0.05,8,8));
    const steam = new THREE.Mesh(steamGeo, new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0, depthWrite:false }));
    steam.position.set(0,0.28,0); steam.visible=false; g.add(steam); g.userData.steam = steam;
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
  B.freezer = () => {
    const g = grp();
    const body = box(1.0,0.85,0.65,0xe4e6e5,{rough:0.4,metal:0.2}); put(body,0,0.425,0); g.add(body);
    const lidSeam = box(1.01,0.02,0.66,0x9aa0a5); put(lidSeam,0,0.85,0); g.add(lidSeam);
    const led = box(0.02,0.02,0.01,0x111); put(led,0.4,0.7,0.33); addGlow(g,led,0x67c8ff,2.5); g.add(led);
    g.userData.footprint=[1.0,0.65]; return g;
  };
  B.rangehood = () => {
    const g = grp();
    const body = box(0.7,0.35,0.45,0xcfd2d2,{rough:0.35,metal:0.4}); put(body,0,0,0.05); g.add(body);
    const chimney = box(0.3,0.35,0.25,0xb9bcbc,{rough:0.35,metal:0.4}); put(chimney,0,0.32,-0.05); g.add(chimney);
    const led = box(0.15,0.008,0.01,0x111); put(led,0,-0.15,0.28); addGlow(g,led,0xffdd99,2); g.add(led);
    g.userData.footprint=[0.7,0.45]; g.userData.wallMount=true; return g;
  };
  B.inductioncooktop = () => {
    const g = grp();
    const top = box(0.7,0.03,0.5,0x111417,{rough:0.15,metal:0.3}); put(top,0,0,0); g.add(top);
    for (const [x,z] of [[-0.16,-0.1],[0.16,-0.1],[-0.16,0.1],[0.16,0.1]]){
      const ring = cyl(0.09,0.09,0.005,0x2b2f33,20); put(ring,x,0.017,z); addGlow(g,ring,0xff5a3c,2); g.add(ring);
    }
    g.userData.footprint=[0.7,0.5]; return g;
  };
  B.robotvacuum = () => {
    const g = grp();
    const body = cyl(0.09,0.09,0.045,0x2b2d30,24,{rough:0.4}); put(body,0,0.0225,0); g.add(body);
    const ring = cyl(0.06,0.06,0.005,0x1c1c1c,24); put(ring,0,0.046,0); addGlow(g,ring,0x67c8ff,2.5); g.add(ring);
    const bumper = cyl(0.091,0.091,0.02,0x111,24); put(bumper,0,0.01,0); g.add(bumper);
    g.userData.footprint=[0.18,0.18]; return g;
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
  B.waterheater = () => {
    const g = grp();
    const tank = cyl(0.2,0.2,0.7,0xe3e5e6,24,{rough:0.3,metal:0.25}); put(tank,0,0,0); g.add(tank);
    const capTop = cyl(0.2,0.15,0.08,0xc7cacb,24,{rough:0.3,metal:0.3}); put(capTop,0,0.39,0); g.add(capTop);
    const led = box(0.02,0.02,0.01,0x111); put(led,0,0.05,0.2); addGlow(g,led,0xff8a4c,2.5); g.add(led);
    g.userData.footprint=[0.4,0.4]; g.userData.wallMount=true; return g;
  };
  B.fireplace = () => {
    const g = grp();
    const body = box(1.0,0.65,0.3,0x2b2320,{rough:0.5}); put(body,0,0.325,0); g.add(body);
    const opening = box(0.7,0.42,0.05,0x0c0c0c,{rough:0.2}); put(opening,0,0.32,0.13); g.add(opening);
    const flame = box(0.55,0.3,0.03,0xff7a3c,{rough:0.3}); put(flame,0,0.28,0.16); addGlow(g,flame,0xff5500,2.2); g.add(flame);
    const mantel = box(1.1,0.05,0.35,0x1c1610,{rough:0.4}); put(mantel,0,0.675,0); g.add(mantel);
    g.userData.footprint=[1.0,0.3]; return g;
  };
  B.dehumidifier = () => {
    const g = grp();
    const body = box(0.32,0.55,0.28,0xe9eef2,{rough:0.3}); put(body,0,0.275,0); g.add(body);
    const tankWindow = box(0.1,0.15,0.02,0x2a5f8a,{rough:0.1,extra:{transparent:true,opacity:0.7}}); put(tankWindow,0.11,0.15,0.145); g.add(tankWindow);
    const led = box(0.02,0.01,0.01,0x111); put(led,0,0.45,0.145); addGlow(g,led,0x67c8ff,2.5); g.add(led);
    g.userData.footprint=[0.32,0.28]; return g;
  };
  B.ceilingfan = () => {
    const g = grp();
    const mount = cyl(0.03,0.03,0.06,0x2b2b2b,12); put(mount,0,-0.03,0); g.add(mount);
    const hub = cyl(0.05,0.05,0.04,0x33383e,16); put(hub,0,-0.09,0); g.add(hub);
    const blades = new THREE.Group();
    for (let i=0;i<4;i++){ const bl=box(0.5,0.02,0.09,0xdfe1e2,{rough:0.5}); put(bl,0,-0.1,0,0,i*Math.PI/2,0); blades.add(bl); }
    g.add(blades); g.userData.spinPart = blades;
    const led = box(0.015,0.01,0.015,0x111); put(led,0,-0.13,0); addGlow(g,led,0x67c8ff,2); g.add(led);
    g.userData.footprint=[1.0,1.0]; g.userData.ceiling=true; return g;
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
  B.thermostat = () => {
    const g = grp();
    const body = cyl(0.045,0.045,0.02,0x2b2b2b,24); put(body,0,0,0,Math.PI/2,0,0); g.add(body);
    const screen = cyl(0.036,0.036,0.005,0x0a0a0a,24); put(screen,0,0,0.013,Math.PI/2,0,0); addGlow(g,screen,0x67c8ff,2); g.add(screen);
    g.userData.footprint=[0.1,0.1]; g.userData.wallMount=true; return g;
  };
  B.smartlock = () => {
    const g = grp();
    const body = box(0.06,0.16,0.03,0x2b2f33,{metal:0.5,rough:0.35}); put(body,0,0,0); g.add(body);
    const keypad = box(0.045,0.07,0.005,0x1c1c1c,{rough:0.3}); put(keypad,0,-0.02,0.017); g.add(keypad);
    const led = box(0.015,0.008,0.005,0x111); put(led,0,0.05,0.017); addGlow(g,led,0x34d399,2.5); g.add(led);
    g.userData.footprint=[0.06,0.03]; g.userData.wallMount=true; return g;
  };
  B.smokedetector = () => {
    const g = grp();
    const body = cyl(0.09,0.1,0.035,0xf3f2ee,20,{rough:0.5}); put(body,0,-0.0175,0); g.add(body);
    const led = box(0.008,0.008,0.008,0x111); put(led,0,-0.033,0.04); addGlow(g,led,0xff6b6b,2.5); g.add(led);
    g.userData.footprint=[0.2,0.2]; g.userData.ceiling=true; return g;
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
  B.hairdryer = () => {
    const g = grp();
    const barrel = cyl(0.035,0.04,0.18,0x2b2b2b,16,{rough:0.4}); put(barrel,0,0.1,0,0,0,Math.PI/2); g.add(barrel);
    const handle = box(0.03,0.14,0.03,0x2b2b2b,{rough:0.4}); put(handle,0,0.03,0.04,0,0,0.3); g.add(handle);
    const led = box(0.008,0.008,0.008,0x111); put(led,0,0.1,0.09); addGlow(g,led,0x67c8ff,3); g.add(led);
    g.userData.footprint=[0.2,0.08]; return g;
  };
  B.iron = () => {
    const g = grp();
    const body = box(0.24,0.14,0.11,0x2b2f33,{rough:0.35,metal:0.3}); put(body,0,0.12,0); g.add(body);
    const sole = box(0.22,0.03,0.1,0x9aa0a5,{metal:0.7,rough:0.2}); put(sole,0,0.03,0); g.add(sole);
    const handle = box(0.14,0.04,0.03,0x1c1c1c,{rough:0.5}); put(handle,-0.02,0.22,0); g.add(handle);
    const led = box(0.01,0.01,0.005,0x111); put(led,0.08,0.18,0.05); addGlow(g,led,0xff6b4a,2.5); g.add(led);
    g.userData.footprint=[0.24,0.11]; return g;
  };
  B.evcharger = () => {
    const g = grp();
    const body = box(0.32,0.45,0.16,0x1c2126,{rough:0.35,metal:0.4}); put(body,0,0,0); g.add(body);
    const screen = box(0.18,0.1,0.01,0x0a0a0a,{rough:0.2}); put(screen,0,0.12,0.085); addGlow(g,screen,0x67c8ff,2); g.add(screen);
    const led = box(0.02,0.02,0.01,0x111); put(led,0,-0.05,0.085); addGlow(g,led,0x34d399,3); g.add(led);
    const cableHook = cyl(0.06,0.06,0.02,0x2b2b2b,16); put(cableHook,0,-0.18,0.09,Math.PI/2,0,0); g.add(cableHook);
    g.userData.footprint=[0.32,0.16]; g.userData.wallMount=true; return g;
  };
  B.treadmill = () => {
    const g = grp();
    const base = box(0.75,0.12,1.7,0x2b2d30,{rough:0.4}); put(base,0,0.06,0); g.add(base);
    const belt = box(0.5,0.01,1.5,0x1c1c1c,{rough:0.6}); put(belt,0,0.125,0); g.add(belt);
    const railL = box(0.04,0.85,0.03,0x2b2d30,{metal:0.4}); put(railL,-0.32,0.45,-0.7); g.add(railL);
    const railR = box(0.04,0.85,0.03,0x2b2d30,{metal:0.4}); put(railR,0.32,0.45,-0.7); g.add(railR);
    const consolePanel = box(0.6,0.25,0.06,0x1c1f22,{rough:0.35}); put(consolePanel,0,0.85,-0.75,0.5,0,0); g.add(consolePanel);
    const screen = box(0.2,0.14,0.01,0x0a0a0a,{rough:0.2}); put(screen,0,0.88,-0.72,0.5,0,0); addGlow(g,screen,0x67c8ff,1.8); g.add(screen);
    g.userData.footprint=[0.75,1.7]; return g;
  };

  // ---------- ROZSZERZENIE: NOWE URZĄDZENIA ----------
  B.heatpump = () => {
    const g = grp();
    const body = box(0.9,0.7,0.35,0xe7e9ea,{rough:0.4,metal:0.2}); put(body,0,0.35,0); g.add(body);
    const grille = cyl(0.28,0.28,0.03,0x9aa0a5,24,{metal:0.4}); put(grille,0,0.4,0.18,Math.PI/2,0,0); g.add(grille);
    const led = box(0.02,0.01,0.01,0x111); put(led,0.35,0.6,0.18); addGlow(g,led,0x67c8ff,2.5); g.add(led);
    g.userData.footprint=[0.9,0.35]; return g;
  };
  B.floorheating = () => {
    const g = grp();
    const mat1 = box(1.0,0.01,1.0,0xb5471f,{rough:0.6}); put(mat1,0,0.005,0); g.add(mat1);
    for (let i=-2;i<=2;i++){ const line=box(0.02,0.012,0.9,0xff8a4c); put(line,i*0.18,0.011,0); addGlow(g,line,0xff5a1f,1.8); g.add(line); }
    g.userData.footprint=[1.0,1.0]; g.userData.flat=true; return g;
  };
  B.portableac = () => {
    const g = grp();
    const body = box(0.38,0.75,0.34,0xeef0f0,{rough:0.35}); put(body,0,0.375,0); g.add(body);
    const vent = cyl(0.09,0.09,0.02,0x2b2b2b,20); put(vent,0,0.68,0.17,Math.PI/2,0,0); addGlow(g,vent,0x67c8ff,1.6); g.add(vent);
    const hose = cyl(0.045,0.045,0.35,0x2b2b2b,12); put(hose,0.12,0.78,0,0,0,Math.PI/2.4); g.add(hose);
    for (const x of [-0.13,0.13]){ const wheel=cyl(0.04,0.04,0.03,0x111,16); put(wheel,x,0.04,0.15,Math.PI/2,0,0); g.add(wheel); }
    g.userData.footprint=[0.38,0.34]; return g;
  };
  B.projector = () => {
    const g = grp();
    const body = box(0.34,0.1,0.24,0x2b2d30,{rough:0.4}); put(body,0,0,0); g.add(body);
    const lens = cyl(0.035,0.04,0.05,0x111,20); put(lens,0.1,-0.02,0.13,Math.PI/2,0,0); addGlow(g,lens,0xffffff,2.2); g.add(lens);
    const led = box(0.015,0.008,0.008,0x111); put(led,-0.12,0.03,0.1); addGlow(g,led,0x34d399,2.5); g.add(led);
    g.userData.footprint=[0.34,0.24]; g.userData.ceiling=true; return g;
  };
  B.recordplayer = () => {
    const g = grp();
    const base = box(0.42,0.08,0.34,0x2b2320,{rough:0.5}); put(base,0,0.04,0); g.add(base);
    const platter = cyl(0.14,0.14,0.015,0x111,32); put(platter,-0.06,0.09,0); g.add(platter);
    const record = cyl(0.13,0.13,0.005,0x1c1c1c,32); put(record,-0.06,0.098,0); g.add(record);
    const arm = box(0.02,0.012,0.16,0x8a8d90,{metal:0.6}); put(arm,0.14,0.1,-0.02,0,0.6,0); g.add(arm);
    g.userData.footprint=[0.42,0.34]; return g;
  };
  B.pendantlight = () => {
    const g = grp();
    const cord = cyl(0.006,0.006,0.4,0x1c1c1c,8); put(cord,0,-0.2,0); g.add(cord);
    const shade = cyl(0.05,0.16,0.16,0x2b2320,20,{rough:0.5}); put(shade,0,-0.42,0); g.add(shade);
    const bulb = sph(0.05,0xfff3d6,14); put(bulb,0,-0.46,0); addGlow(g,bulb,0xffdd99,2.8); g.add(bulb);
    g.userData.footprint=[0.32,0.32]; g.userData.ceiling=true; return g;
  };
  B.nightlight = () => {
    const g = grp();
    const body = box(0.05,0.06,0.035,0xf0f0ec,{rough:0.5}); put(body,0,0.03,0); g.add(body);
    const glow = box(0.03,0.03,0.005,0xfff3d6); put(glow,0,0.03,0.02); addGlow(g,glow,0xffb648,3); g.add(glow);
    g.userData.footprint=[0.05,0.04]; g.userData.wallMount=true; return g;
  };
  B.winefridge = () => {
    const g = grp();
    const body = box(0.45,0.85,0.55,0x1c2126,{rough:0.35,metal:0.3}); put(body,0,0.425,0); g.add(body);
    const glass = box(0.4,0.75,0.02,0x0c1620,{rough:0.1,extra:{transparent:true,opacity:0.55}}); put(glass,0,0.45,0.28); g.add(glass);
    const led = box(0.02,0.01,0.01,0x111); put(led,0.18,0.8,0.28); addGlow(g,led,0x67c8ff,2.2); g.add(led);
    g.userData.footprint=[0.45,0.55]; return g;
  };
  B.blender = () => {
    const g = grp();
    const base = box(0.16,0.16,0.16,0x2b2d30,{rough:0.4}); put(base,0,0.08,0); g.add(base);
    const jug = cyl(0.07,0.09,0.26,0x9fd8e8,16,{rough:0.15,extra:{transparent:true,opacity:0.55}}); put(jug,0,0.29,0); g.add(jug);
    const lid = cyl(0.075,0.075,0.02,0x2b2d30,16); put(lid,0,0.43,0); g.add(lid);
    g.userData.footprint=[0.2,0.2]; return g;
  };
  B.saunaheater = () => {
    const g = grp();
    const body = box(0.5,0.55,0.4,0x2b2b2b,{rough:0.5,metal:0.3}); put(body,0,0.275,0); g.add(body);
    const grillMat = mat('saunagrill',0x1c1c1c,{rough:0.7});
    for (let i=0;i<4;i++){ const bar = new THREE.Mesh(geo('box:0.4:0.02:0.02',()=>new THREE.BoxGeometry(0.4,0.02,0.02)), grillMat); put(bar,0,0.12+i*0.09,0.21); g.add(bar); }
    const rocksMat = mat('saunarocks',0x3a3a3a,{rough:0.95});
    for (let i=0;i<8;i++){ const rock=new THREE.Mesh(geo('sph:0.045:8',()=>new THREE.SphereGeometry(0.045,8,8)), rocksMat); rock.position.set((Math.random()-0.5)*0.35,0.56+Math.random()*0.04,(Math.random()-0.5)*0.25); g.add(rock); }
    const led = box(0.02,0.02,0.01,0x111); put(led,0.2,0.1,0.21); addGlow(g,led,0xff5500,3); g.add(led);
    g.userData.footprint=[0.5,0.4]; return g;
  };
  B.nas = () => {
    const g = grp();
    const body = box(0.14,0.18,0.22,0x2b2d30,{rough:0.4}); put(body,0,0.09,0); g.add(body);
    for (let i=0;i<2;i++){ const bay=box(0.1,0.06,0.01,0x111); put(bay,0,0.06+i*0.08,0.11); addGlow(g,bay,i===0?0x34d399:0x67c8ff,2.2); g.add(bay); }
    g.userData.footprint=[0.14,0.22]; return g;
  };
  B.doorbell = () => {
    const g = grp();
    const body = box(0.05,0.11,0.025,0x2b2d30,{rough:0.35,metal:0.3}); put(body,0,0,0); g.add(body);
    const lens = cyl(0.012,0.012,0.008,0x111,12); put(lens,0,0.03,0.014,Math.PI/2,0,0); addGlow(g,lens,0x67c8ff,2.4); g.add(lens);
    const btn = cyl(0.015,0.015,0.006,0xffb648,16); put(btn,0,-0.03,0.014,Math.PI/2,0,0); addGlow(g,btn,0xffb648,1.6); g.add(btn);
    g.userData.footprint=[0.05,0.03]; g.userData.wallMount=true; return g;
  };
  B.gardenpump = () => {
    const g = grp();
    const body = box(0.3,0.32,0.22,0x3a6b8a,{rough:0.4,metal:0.2}); put(body,0,0.16,0); g.add(body);
    const pipe = cyl(0.025,0.025,0.3,0x2b2b2b,12,{metal:0.5}); put(pipe,0.12,0.16,0,0,0,Math.PI/2); g.add(pipe);
    const led = box(0.015,0.015,0.01,0x111); put(led,0,0.28,0.12); addGlow(g,led,0x34d399,2.5); g.add(led);
    g.userData.footprint=[0.3,0.22]; return g;
  };
  B.ebikecharger = () => {
    const g = grp();
    const body = box(0.2,0.28,0.1,0x1c2126,{rough:0.35,metal:0.3}); put(body,0,0,0); g.add(body);
    const screen = box(0.1,0.06,0.01,0x0a0a0a,{rough:0.2}); put(screen,0,0.06,0.055); addGlow(g,screen,0x67c8ff,2); g.add(screen);
    const cableHook = cyl(0.035,0.035,0.015,0x2b2b2b,16); put(cableHook,0,-0.1,0.06,Math.PI/2,0,0); g.add(cableHook);
    g.userData.footprint=[0.2,0.1]; g.userData.wallMount=true; return g;
  };
  B.poolpump = () => {
    const g = grp();
    const motor = box(0.28,0.24,0.24,0x3a3d42,{rough:0.4,metal:0.3}); put(motor,-0.2,0.12,0); g.add(motor);
    const tank = cyl(0.16,0.16,0.4,0x4a90c0,20,{rough:0.35}); put(tank,0.15,0.2,0); g.add(tank);
    const led = box(0.015,0.015,0.01,0x111); put(led,-0.2,0.22,0.13); addGlow(g,led,0x34d399,2.5); g.add(led);
    g.userData.footprint=[0.5,0.24]; return g;
  };
  B.outdoorlighting = () => {
    const g = grp();
    const stake = cyl(0.012,0.012,0.2,0x2b2b2b,10); put(stake,0,-0.1,0); g.add(stake);
    const head = cyl(0.035,0.045,0.06,0x2b2b2b,16); put(head,0,0.03,0,0.4,0,0); g.add(head);
    const lens = cyl(0.028,0.028,0.01,0x111,16); put(lens,0,0.05,0.02,0.4,0,0); addGlow(g,lens,0xfff3d6,2.6); g.add(lens);
    g.userData.footprint=[0.12,0.12]; return g;
  };
  B.mowerdock = () => {
    const g = grp();
    const base = box(0.28,0.03,0.22,0x2b2d30,{rough:0.5}); put(base,0,0.015,0); g.add(base);
    const post = box(0.06,0.18,0.04,0xd6293e,{rough:0.4}); put(post,-0.09,0.12,-0.06); g.add(post);
    const led = box(0.02,0.015,0.01,0x111); put(led,-0.09,0.19,-0.03); addGlow(g,led,0x34d399,2.5); g.add(led);
    g.userData.footprint=[0.28,0.22]; return g;
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

  // ---------- DECOR / VARIETY PACK ----------
  B.poster = () => {
    const g = grp();
    const frame = box(0.62,0.82,0.03,0x2b2320,{rough:0.5}); put(frame,0,0,0); g.add(frame);
    const artColors = [0xd6a24a,0x4a7fb8,0xb85c4a,0x5aa06a,0x8a5cb8];
    const c = artColors[Math.floor(Math.random()*artColors.length)];
    const art = box(0.54,0.74,0.01,c,{rough:0.85}); put(art,0,0,0.02); g.add(art);
    for (let i=0;i<3;i++){ const stripe=box(0.54,0.06,0.012,0xffffff,{rough:0.8,extra:{transparent:true,opacity:0.18}}); put(stripe,0,-0.2+i*0.2,0.025); g.add(stripe); }
    g.userData.footprint=[0.62,0.05]; g.userData.wallMount=true; g.userData.flat=false; return g;
  };
  B.walltext = () => {
    const g = grp();
    const plaque = box(0.9,0.22,0.02,0x2b2320,{rough:0.6}); put(plaque,0,0,0); g.add(plaque);
    // abstract "lettering" - a row of small raised bars standing in for text (no font loading needed)
    const letterMat = mat('wallletter',0xe9dfc7,{rough:0.7});
    const widths=[0.06,0.1,0.04,0.08,0.07,0.05,0.09,0.06,0.05];
    let x=-0.38;
    for (const w of widths){
      const bar = new THREE.Mesh(geo('box:'+w+':0.05:0.01',()=>new THREE.BoxGeometry(w,0.05,0.01)), letterMat);
      bar.position.set(x+w/2,0,0.016); g.add(bar); x += w+0.02;
    }
    g.userData.footprint=[0.9,0.03]; g.userData.wallMount=true; return g;
  };
  B.books = () => {
    const g = grp();
    const colors=[0xb85c4a,0x4a7fb8,0xd6b84a,0x5aa06a,0x8a5cb8];
    let x=-0.1;
    for (let i=0;i<5;i++){
      const h=0.16+Math.random()*0.08, w=0.028+Math.random()*0.01;
      const book=box(w,h,0.19,colors[i%colors.length],{rough:0.8}); put(book,x,h/2,0); g.add(book);
      x += w+0.004;
    }
    // one leaning at an angle for a lived-in look
    const lean=box(0.03,0.19,0.185,colors[2],{rough:0.8}); put(lean,x+0.08,0.095,0,0,0,0.35); g.add(lean);
    g.userData.footprint=[0.3,0.2]; return g;
  };
  B.chairdrobe = () => {
    // a witty hybrid: wardrobe body with a fold-down bench seat built into the base
    const g = grp();
    const body = box(1.0,1.7,0.6,0x5a4632,{rough:0.6}); put(body,0,0.85+0.28,0); g.add(body);
    const seam = box(0.01,1.7,0.605,0x3a2c1f); put(seam,0,0.85+0.28,0); g.add(seam);
    for (const dx of [-0.1,0.1]){ const h=box(0.02,0.15,0.03,0xd8c98a,{metal:0.6}); put(h,dx,0.85+0.28,0.31); g.add(h); }
    const bench = box(1.05,0.06,0.4,0x6b4a2f,{rough:0.6}); put(bench,0,0.5,0.15); g.add(bench);
    const cushion = box(0.98,0.08,0.36,0xb85c4a,{rough:0.85}); put(cushion,0,0.55,0.15); g.add(cushion);
    for (const [x,z] of [[-0.45,0.32],[0.45,0.32]]){ const leg=box(0.05,0.5,0.05,0x2b2b2b,{metal:0.4}); put(leg,x,0.25,z); g.add(leg); }
    g.userData.footprint=[1.1,0.6]; return g;
  };
  B.plant = () => {
    const g = grp();
    const pot = cyl(0.14,0.11,0.22,0xb85c3f,{rough:0.8}); put(pot,0,0.11,0); g.add(pot);
    const soil = cyl(0.12,0.12,0.02,0x2a1c12,{rough:1}); put(soil,0,0.21,0); g.add(soil);
    for (let i=0;i<6;i++){
      const leafMat = mat('planleaf',0x3d7a3a,{rough:0.9});
      const leaf = new THREE.Mesh(geo('leaf',()=>new THREE.ConeGeometry(0.05,0.32,5)), leafMat);
      const ang = (i/6)*Math.PI*2;
      leaf.position.set(Math.cos(ang)*0.06,0.4,Math.sin(ang)*0.06);
      leaf.rotation.set((Math.random()-0.5)*0.5, ang, 0.35+Math.random()*0.15);
      leaf.castShadow=true; g.add(leaf);
    }
    g.userData.footprint=[0.35,0.35]; return g;
  };
  B.wallclock = () => {
    const g = grp();
    const face = cyl(0.15,0.15,0.02,0xf3f2ee,20,{rough:0.5}); put(face,0,0,0,Math.PI/2,0,0); g.add(face);
    const rim = new THREE.Mesh(geo('torus-clock',()=>new THREE.TorusGeometry(0.15,0.008,8,24)), mat('clockrim',0x2b2b2b,{metal:0.6}));
    rim.rotation.x=Math.PI/2; g.add(rim);
    const hourHand=box(0.012,0.08,0.005,0x1c1c1c); put(hourHand,0,0.03,0.012,0,0,0.5); g.add(hourHand);
    const minHand=box(0.01,0.11,0.005,0x1c1c1c); put(minHand,0,0.045,0.014,0,0,-1.1); g.add(minHand);
    g.userData.footprint=[0.32,0.05]; g.userData.wallMount=true; return g;
  };
  B.mirror = () => {
    const g = grp();
    const frame = box(0.5,0.85,0.03,0x8a8d90,{metal:0.5,rough:0.4}); put(frame,0,0,0); g.add(frame);
    const glass = new THREE.Mesh(geo('box:0.44:0.79:0.01',()=>new THREE.BoxGeometry(0.44,0.79,0.01)), new THREE.MeshStandardMaterial({color:0xbfd6e8,roughness:0.05,metalness:0.9}));
    glass.position.set(0,0,0.018); g.add(glass);
    g.userData.footprint=[0.5,0.05]; g.userData.wallMount=true; return g;
  };

  // ---------- KUCHNIA ----------
  B.kitchencounter = () => {
    const g = grp();
    const cabinet = box(1.2,0.85,0.6,0xe4e1d8,{rough:0.5}); put(cabinet,0,0.425,0); g.add(cabinet);
    const top = box(1.24,0.04,0.64,0x2b2320,{rough:0.3}); put(top,0,0.87,0); g.add(top);
    for (let i=0;i<2;i++){
      const door=box(0.56,0.5,0.02,0xd8d4c9,{rough:0.5}); put(door,-0.3+i*0.6,0.35,0.31); g.add(door);
      const handle=box(0.02,0.12,0.02,0x8a8d90,{metal:0.6}); put(handle,-0.06+i*0.6,0.35,0.33); g.add(handle);
    }
    g.userData.footprint=[1.2,0.6]; return g;
  };
  B.kitchenisland = () => {
    const g = grp();
    const cabinet = box(1.4,0.85,0.8,0x3a3d42,{rough:0.45}); put(cabinet,0,0.425,0); g.add(cabinet);
    const top = box(1.5,0.05,0.9,0xe9e6dd,{rough:0.3}); put(top,0,0.875,0); g.add(top);
    for (let i=0;i<3;i++){ const door=box(0.35,0.5,0.02,0x2b2e33,{rough:0.5}); put(door,-0.45+i*0.45,0.35,0.41); g.add(door); }
    g.userData.footprint=[1.4,0.8]; return g;
  };
  B.kitchensink = () => {
    const g = grp();
    const basin = box(0.7,0.18,0.45,0xc7cacb,{metal:0.6,rough:0.3}); put(basin,0,0.09,0); g.add(basin);
    const basinInner = box(0.6,0.14,0.37,0x8a8d90,{metal:0.5,rough:0.35}); put(basinInner,0,0.11,0); g.add(basinInner);
    const faucet = cyl(0.012,0.012,0.28,0x9aa0a5,10,{metal:0.7}); put(faucet,0,0.32,-0.16); g.add(faucet);
    const spout = cyl(0.012,0.012,0.14,0x9aa0a5,10,{metal:0.7}); put(spout,0,0.44,-0.1,0,0,Math.PI/2.2); g.add(spout);
    g.userData.footprint=[0.8,0.55]; return g;
  };
  B.pantry = () => {
    const g = grp();
    const body = box(0.6,1.9,0.5,0xe4e1d8,{rough:0.5}); put(body,0,0.95,0); g.add(body);
    const seam = box(0.01,1.9,0.505,0xbdb9ae); put(seam,0,0.95,0); g.add(seam);
    const h1 = box(0.02,0.15,0.02,0x8a8d90,{metal:0.6}); put(h1,-0.05,1.05,0.26); g.add(h1);
    const h2 = box(0.02,0.15,0.02,0x8a8d90,{metal:0.6}); put(h2,0.05,1.05,0.26); g.add(h2);
    g.userData.footprint=[0.6,0.5]; return g;
  };

  // ---------- ŁAZIENKA ----------
  B.bathtub = () => {
    const g = grp();
    const outer = box(1.7,0.55,0.75,0xf5f5f2,{rough:0.3}); put(outer,0,0.275,0); g.add(outer);
    const inner = box(1.5,0.35,0.55,0xe4eef5,{rough:0.15}); put(inner,0,0.38,0); g.add(inner);
    const faucet = cyl(0.015,0.015,0.15,0x9aa0a5,10,{metal:0.7}); put(faucet,-0.7,0.62,0.3); g.add(faucet);
    g.userData.footprint=[1.7,0.75]; return g;
  };
  B.toilet = () => {
    const g = grp();
    const tank = box(0.38,0.35,0.16,0xf5f5f2,{rough:0.25}); put(tank,0,0.65,-0.22); g.add(tank);
    const bowl = cyl(0.19,0.15,0.38,0xf5f5f2,20,{rough:0.25}); put(bowl,0,0.19,0); g.add(bowl);
    const seat = cyl(0.2,0.2,0.03,0xffffff,20,{rough:0.3}); put(seat,0,0.4,0); g.add(seat);
    g.userData.footprint=[0.4,0.65]; return g;
  };
  B.bathroomsink = () => {
    const g = grp();
    const basin = cyl(0.24,0.2,0.15,0xf5f5f2,24,{rough:0.25}); put(basin,0,0.72,0); g.add(basin);
    const pedestal = cyl(0.08,0.1,0.65,0xf5f5f2,16,{rough:0.25}); put(pedestal,0,0.35,0); g.add(pedestal);
    const faucet = cyl(0.01,0.01,0.15,0x9aa0a5,10,{metal:0.7}); put(faucet,0,0.85,-0.12); g.add(faucet);
    g.userData.footprint=[0.6,0.45]; return g;
  };
  B.shower = () => {
    const g = grp();
    const trayGlassMat = new THREE.MeshPhysicalMaterial({ color:0xbfe0ff, transparent:true, opacity:0.22, roughness:0.05, metalness:0, transmission:0.6 });
    const tray = box(0.9,0.06,0.9,0xe4e6e5,{rough:0.4}); put(tray,0,0.03,0); g.add(tray);
    const glassL = new THREE.Mesh(geo('box:0.02:2.0:0.9',()=>new THREE.BoxGeometry(0.02,2.0,0.9)), trayGlassMat); put(glassL,-0.44,1.0,0); g.add(glassL);
    const glassB = new THREE.Mesh(geo('box:0.9:2.0:0.02',()=>new THREE.BoxGeometry(0.9,2.0,0.02)), trayGlassMat); put(glassB,0,1.0,-0.44); g.add(glassB);
    const head = cyl(0.03,0.03,0.02,0x9aa0a5,16,{metal:0.6}); put(head,0,1.9,-0.3); g.add(head);
    const arm = cyl(0.01,0.01,0.3,0x9aa0a5,10,{metal:0.6}); put(arm,0,1.9,-0.15,0,0,Math.PI/2); g.add(arm);
    g.userData.footprint=[0.9,0.9]; return g;
  };
  B.towelrack = () => {
    const g = grp();
    const bar = cyl(0.012,0.012,0.5,0x9aa0a5,12,{metal:0.6}); put(bar,0,0,0,0,0,Math.PI/2); g.add(bar);
    const bracketL = box(0.03,0.05,0.04,0x8a8d90,{metal:0.6}); put(bracketL,-0.24,0,0); g.add(bracketL);
    const bracketR = box(0.03,0.05,0.04,0x8a8d90,{metal:0.6}); put(bracketR,0.24,0,0); g.add(bracketR);
    const towelMat = mat('towel',0xdbe8e6,{rough:0.9});
    const towel = new THREE.Mesh(geo('box:0.4:0.35:0.02',()=>new THREE.BoxGeometry(0.4,0.35,0.02)), towelMat); put(towel,0,-0.2,0.02); g.add(towel);
    g.userData.footprint=[0.5,0.06]; g.userData.wallMount=true; return g;
  };

  // ---------- SALON / SYPIALNIA / BIURO ----------
  B.barstool = () => {
    const g = grp();
    const seat = cyl(0.16,0.16,0.05,0x2b2320,20,{rough:0.6}); put(seat,0,0.72,0); g.add(seat);
    const pole = cyl(0.03,0.03,0.65,0x8a8d90,12,{metal:0.6}); put(pole,0,0.39,0); g.add(pole);
    const base = cyl(0.16,0.16,0.02,0x2b2b2b,20,{metal:0.5}); put(base,0,0.01,0); g.add(base);
    const footring = new THREE.Mesh(geo('torus-stool',()=>new THREE.TorusGeometry(0.14,0.008,8,20)), mat('stoolring',0x8a8d90,{metal:0.6}));
    put(footring,0,0.35,0); g.add(footring);
    g.userData.footprint=[0.35,0.35]; return g;
  };
  B.armchair = () => {
    const g = grp();
    const base = box(0.75,0.35,0.75,0x5a6b8a,{rough:0.85}); put(base,0,0.175,0); g.add(base);
    const back = box(0.75,0.5,0.15,0x5a6b8a,{rough:0.85}); put(back,0,0.55,-0.3); g.add(back);
    const armL = box(0.15,0.4,0.75,0x4a5a75,{rough:0.85}); put(armL,-0.3,0.35,0); g.add(armL);
    const armR = box(0.15,0.4,0.75,0x4a5a75,{rough:0.85}); put(armR,0.3,0.35,0); g.add(armR);
    const cushion = box(0.45,0.12,0.65,0x66789a,{rough:0.85}); put(cushion,0,0.32,0.02); g.add(cushion);
    for (const [x,z] of [[-0.3,-0.3],[0.3,-0.3],[-0.3,0.3],[0.3,0.3]]){ const leg=cyl(0.02,0.02,0.1,0x2b2320,8); put(leg,x,0.05,z); g.add(leg); }
    g.userData.footprint=[0.8,0.8]; return g;
  };
  B.vase = () => {
    const g = grp();
    const body = cyl(0.1,0.14,0.4,0x8a5c6b,20,{rough:0.4}); put(body,0,0.2,0); g.add(body);
    const neck = cyl(0.05,0.09,0.1,0x8a5c6b,20,{rough:0.4}); put(neck,0,0.45,0); g.add(neck);
    const stemMat = mat('stem',0x3d7a3a,{rough:0.9});
    for (let i=0;i<3;i++){
      const stem = new THREE.Mesh(geo('cyl:0.005:0.005:0.35:6',()=>new THREE.CylinderGeometry(0.005,0.005,0.35,6)), stemMat);
      stem.position.set((i-1)*0.03,0.65,0); stem.rotation.z=(i-1)*0.25; g.add(stem);
    }
    g.userData.footprint=[0.28,0.28]; return g;
  };
  B.curtains = () => {
    const g = grp();
    const rod = cyl(0.01,0.01,1.7,0x2b2b2b,10); put(rod,0,0,0,0,0,Math.PI/2); g.add(rod);
    const panelMat = mat('curtain',0x8a3f4d,{rough:0.95});
    for (let i=0;i<8;i++){
      const fold = new THREE.Mesh(geo('box:0.2:1.5:0.04',()=>new THREE.BoxGeometry(0.2,1.5,0.04)), panelMat);
      fold.position.set(-0.7+i*0.2, -0.78, (i%2===0)?0.015:-0.015);
      fold.castShadow=true; g.add(fold);
    }
    g.userData.footprint=[1.6,0.08]; g.userData.wallMount=true; return g;
  };
  B.nightstand = () => {
    const g = grp();
    const body = box(0.4,0.5,0.35,0x5a4632,{rough:0.6}); put(body,0,0.25,0); g.add(body);
    const drawer = box(0.36,0.18,0.02,0x6b563d,{rough:0.6}); put(drawer,0,0.35,0.18); g.add(drawer);
    const handle = box(0.1,0.02,0.02,0xd8c98a,{metal:0.6}); put(handle,0,0.35,0.2); g.add(handle);
    g.userData.footprint=[0.4,0.35]; return g;
  };
  B.crib = () => {
    const g = grp();
    const base = box(0.7,0.15,1.3,0x8a6a45,{rough:0.6}); put(base,0,0.08,0); g.add(base);
    const railMat = mat('cribrail',0xe9dfc7,{rough:0.6});
    for (let i=0;i<6;i++){
      const railA = new THREE.Mesh(geo('cyl:0.012:0.012:0.55:8',()=>new THREE.CylinderGeometry(0.012,0.012,0.55,8)), railMat);
      railA.position.set(-0.32+i*0.13,0.4,0.63); g.add(railA);
      const railB = new THREE.Mesh(geo('cyl:0.012:0.012:0.55:8',()=>new THREE.CylinderGeometry(0.012,0.012,0.55,8)), railMat);
      railB.position.set(-0.32+i*0.13,0.4,-0.63); g.add(railB);
    }
    for (const [x,z] of [[-0.33,-0.63],[0.33,-0.63],[-0.33,0.63],[0.33,0.63]]){ const post=box(0.04,0.7,0.04,0x8a6a45,{rough:0.6}); put(post,x,0.35,z); g.add(post); }
    const mattress = box(0.6,0.08,1.15,0xffffff,{rough:0.9}); put(mattress,0,0.19,0); g.add(mattress);
    g.userData.footprint=[0.7,1.3]; return g;
  };
  B.whiteboard = () => {
    const g = grp();
    const frame = box(1.2,0.8,0.03,0xd8dade,{rough:0.4,metal:0.2}); put(frame,0,0,0); g.add(frame);
    const board = box(1.12,0.72,0.005,0xfafaf8,{rough:0.15}); put(board,0,0,0.018); g.add(board);
    const markerMat = mat('marker',0x3a6fd8,{rough:0.5});
    const line1 = new THREE.Mesh(geo('box:0.4:0.02:0.002',()=>new THREE.BoxGeometry(0.4,0.02,0.002)), markerMat); put(line1,-0.25,0.15,0.022); g.add(line1);
    const line2 = new THREE.Mesh(geo('box:0.3:0.02:0.002',()=>new THREE.BoxGeometry(0.3,0.02,0.002)), markerMat); put(line2,-0.3,0.0,0.022); g.add(line2);
    const tray = box(1.1,0.03,0.06,0xc7cacb,{metal:0.4}); put(tray,0,-0.38,0.03); g.add(tray);
    g.userData.footprint=[1.2,0.08]; g.userData.wallMount=true; return g;
  };
  B.toolcabinet = () => {
    const g = grp();
    const body = box(0.9,1.0,0.5,0xd6293e,{rough:0.4,metal:0.2}); put(body,0,0.5,0); g.add(body);
    for (let i=0;i<3;i++){
      const drawer=box(0.82,0.28,0.02,0xb51f30,{rough:0.4}); put(drawer,0,0.2+i*0.32,0.26); g.add(drawer);
      const handle=box(0.3,0.03,0.02,0x2b2b2b,{metal:0.5}); put(handle,0,0.2+i*0.32,0.28); g.add(handle);
    }
    g.userData.footprint=[0.9,0.5]; return g;
  };

  // ---------- ROZSZERZENIE: NOWE MEBLE ----------
  B.piano = () => {
    const g = grp();
    const body = box(1.4,1.1,0.55,0x1c1410,{rough:0.4}); put(body,0,0.55,0); g.add(body);
    const keybed = box(1.3,0.1,0.35,0x1c1410,{rough:0.4}); put(keybed,0,0.75,0.35); g.add(keybed);
    const keysMat = mat('pianokeys',0xf5f2e9,{rough:0.5});
    for (let i=0;i<14;i++){ const key=new THREE.Mesh(geo('box:0.085:0.02:0.32',()=>new THREE.BoxGeometry(0.085,0.02,0.32)), keysMat); put(key,-0.58+i*0.09,0.8,0.36); g.add(key); }
    g.userData.footprint=[1.4,0.55]; return g;
  };
  B.standingdesk = () => {
    const g = grp();
    const top = box(1.3,0.04,0.65,0x2b2320,{rough:0.5}); put(top,0,0.74,0); g.add(top);
    for (const x of [-0.55,0.55]){
      const col = box(0.08,0.72,0.08,0xe8e8e4,{rough:0.4,metal:0.2}); put(col,x,0.36,0.25); g.add(col);
      const foot = box(0.4,0.03,0.4,0x2b2b2b,{metal:0.4}); put(foot,x,0.015,0.25); g.add(foot);
    }
    g.userData.footprint=[1.3,0.65]; return g;
  };
  B.officecabinet = () => {
    const g = grp();
    const body = box(0.5,1.1,0.55,0x4a5560,{rough:0.45,metal:0.15}); put(body,0,0.55,0); g.add(body);
    for (let i=0;i<3;i++){ const drawer=box(0.44,0.3,0.02,0x3c4650,{rough:0.4}); put(drawer,0,0.2+i*0.35,0.28); g.add(drawer);
      const handle=box(0.14,0.02,0.02,0x8a8d90,{metal:0.6}); put(handle,0,0.2+i*0.35,0.3); g.add(handle); }
    g.userData.footprint=[0.5,0.55]; return g;
  };
  B.kitchencabinet = () => {
    const g = grp();
    const body = box(0.7,0.6,0.32,0xe4e1d8,{rough:0.5}); put(body,0,0,0); g.add(body);
    for (let i=0;i<2;i++){ const door=box(0.33,0.54,0.02,0xd8d4c9,{rough:0.5}); put(door,-0.18+i*0.36,0,0.17); g.add(door);
      const handle=box(0.02,0.08,0.02,0x8a8d90,{metal:0.6}); put(handle,-0.03+i*0.36,0,0.19); g.add(handle); }
    g.userData.footprint=[0.7,0.32]; g.userData.wallMount=true; return g;
  };
  B.bathroomcabinet = () => {
    const g = grp();
    const body = box(0.5,0.65,0.16,0xf5f5f2,{rough:0.35}); put(body,0,0,0); g.add(body);
    const mirror = box(0.44,0.58,0.01,0xbfd6e8,{rough:0.05,metal:0.9}); put(mirror,0,0,0.085); g.add(mirror);
    g.userData.footprint=[0.5,0.16]; g.userData.wallMount=true; return g;
  };
  B.bikerack = () => {
    const g = grp();
    const railMat = mat('bikerail',0x2b2b2b,{metal:0.6,rough:0.35});
    const base = box(1.1,0.04,0.35,0x2b2b2b,{metal:0.5}); put(base,0,0.02,0); g.add(base);
    for (let i=0;i<3;i++){ const slot=new THREE.Mesh(geo('box:0.06:0.15:0.3',()=>new THREE.BoxGeometry(0.06,0.15,0.3)), railMat); put(slot,-0.35+i*0.35,0.11,0); g.add(slot); }
    g.userData.footprint=[1.1,0.4]; return g;
  };
  B.barcart = () => {
    const g = grp();
    const top = box(0.5,0.03,0.35,0x6b4a2f,{rough:0.5,metal:0.2}); put(top,0,0.85,0); g.add(top);
    const shelf = box(0.5,0.03,0.35,0x6b4a2f,{rough:0.5}); put(shelf,0,0.4,0); g.add(shelf);
    for (const [x,z] of [[-0.2,-0.15],[0.2,-0.15],[-0.2,0.15],[0.2,0.15]]){ const leg=cyl(0.015,0.015,0.85,0x2b2b2b,8,{metal:0.6}); put(leg,x,0.425,z); g.add(leg); }
    const bottleColors=[0x2a5f3a,0x7a2a3a,0x8a8d90];
    for (let i=0;i<3;i++){ const bottle=cyl(0.025,0.03,0.22,bottleColors[i],16,{rough:0.2}); put(bottle,-0.12+i*0.12,0.97,0); g.add(bottle); }
    for (const [x,z] of [[-0.2,-0.15],[0.2,0.15]]){ const wheel=cyl(0.03,0.03,0.02,0x111,16); put(wheel,x,0.03,z,Math.PI/2,0,0); g.add(wheel); }
    g.userData.footprint=[0.5,0.35]; return g;
  };
  B.shoerack = () => {
    const g = grp();
    for (let i=0;i<3;i++){ const shelf=box(0.7,0.02,0.32,0x5a4632,{rough:0.6}); put(shelf,0,0.18+i*0.28,0); g.add(shelf); }
    for (const x of [-0.32,0.32]){ const post=box(0.03,0.86,0.03,0x2b2320); put(post,x,0.43,0); g.add(post); }
    const shoeColors=[0xb85c4a,0x4a7fb8,0x2b2b2b];
    for (let i=0;i<3;i++){ const shoe=box(0.16,0.08,0.28,shoeColors[i],{rough:0.6}); put(shoe,-0.2+i*0.2,0.22,0); g.add(shoe); }
    g.userData.footprint=[0.7,0.32]; return g;
  };
  B.laundrybasket = () => {
    const g = grp();
    const basket = cyl(0.22,0.18,0.42,0xc9a875,20,{rough:0.85}); put(basket,0,0.21,0); g.add(basket);
    const laundry = box(0.28,0.12,0.28,0xdfe6ef,{rough:0.9}); put(laundry,0,0.46,0); g.add(laundry);
    g.userData.footprint=[0.42,0.42]; return g;
  };
  B.trashbin = () => {
    const g = grp();
    const body = cyl(0.15,0.13,0.45,0x3a3d42,20,{rough:0.5,metal:0.2}); put(body,0,0.225,0); g.add(body);
    const lid = cyl(0.155,0.155,0.03,0x2b2d30,20,{metal:0.3}); put(lid,0,0.465,0); g.add(lid);
    g.userData.footprint=[0.3,0.3]; return g;
  };

  // ---------- EASTER EGG: RGB CROISSANT ----------
  B.croissant = () => {
    const g = grp();
    const doughMat = new THREE.MeshStandardMaterial({ color:0xd8a355, roughness:0.6, emissive:new THREE.Color(0xff0000), emissiveIntensity:0.6 });
    // crescent shape built from overlapping tapered segments along an arc
    const segCount = 7;
    for (let i=0;i<segCount;i++){
      const t = i/(segCount-1);
      const ang = -Math.PI*0.65 + t*Math.PI*1.3;
      const r = 0.11;
      const scale = 1 - Math.abs(t-0.5)*0.7;
      const seg = new THREE.Mesh(geo('sph:0.055:10', ()=>new THREE.SphereGeometry(0.055,10,8)), doughMat);
      seg.position.set(Math.cos(ang)*r, 0.055*scale, Math.sin(ang)*r*0.6);
      seg.scale.setScalar(0.55+scale*0.6);
      seg.castShadow = true;
      g.add(seg);
    }
    g.userData.rgbMat = doughMat;
    g.userData.footprint=[0.3,0.2]; g.userData.easterEgg = true; return g;
  };

  // ---------- HOME BATTERY ----------
  B.battery = () => {
    const g = grp();
    const body = box(0.55,0.85,0.22,0xe9ebee,{rough:0.4,metal:0.15}); put(body,0,0.425,0); g.add(body);
    const stripe = box(0.555,0.1,0.225,0x1c1f22); put(stripe,0,0.7,0); g.add(stripe);
    const led = box(0.02,0.02,0.01,0x111); put(led,0.2,0.7,0.115); addGlow(g,led,0x34d399,3); g.add(led);
    const vent = box(0.4,0.3,0.01,0xd6d8da,{rough:0.6}); put(vent,0,0.25,0.115); g.add(vent);
    g.userData.footprint=[0.55,0.22]; g.userData.wallMount=false; return g;
  };

  // ---------- GARAGE FURNITURE / DECOR ----------
  B.car = () => {
    const g = grp();
    const body = box(1.75,0.5,4.2,0x2a4a6b,{rough:0.35,metal:0.5}); put(body,0,0.5,0); g.add(body);
    const cabin = box(1.55,0.42,2.1,0x1c3552,{rough:0.3,metal:0.4}); put(cabin,0,0.92,-0.15); g.add(cabin);
    const glass = box(1.5,0.3,1.9,0x0c1620,{rough:0.1}); put(glass,0,0.95,-0.15); g.add(glass);
    for (const [x,z] of [[-0.8,1.35],[0.8,1.35],[-0.8,-1.35],[0.8,-1.35]]){
      const wheel = cyl(0.32,0.32,0.22,0x0d0d0d,20,{rough:0.7}); put(wheel,x,0.32,z,0,0,Math.PI/2); g.add(wheel);
      const hub = cyl(0.12,0.12,0.23,0x888,20,{metal:0.7,rough:0.3}); put(hub,x,0.32,z,0,0,Math.PI/2); g.add(hub);
    }
    const lightF = box(0.15,0.1,0.05,0xfff3d0,{rough:0.2}); put(lightF,0.7,0.5,2.08); addGlow(g,lightF,0xfff3d0,1.6); g.add(lightF);
    const lightF2 = lightF.clone(); lightF2.position.x=-0.7; g.add(lightF2);
    g.userData.footprint=[1.9,4.3]; g.userData.flat=false; return g;
  };
  B.workbench = () => {
    const g = grp();
    const top = box(1.6,0.05,0.6,0x6b4a2f,{rough:0.7}); put(top,0,0.85,0); g.add(top);
    for (const [x,z] of [[-0.72,-0.25],[0.72,-0.25],[-0.72,0.25],[0.72,0.25]]){
      const leg=box(0.06,0.82,0.06,0x2b2b2b,{metal:0.4}); put(leg,x,0.41,z); g.add(leg);
    }
    const shelf = box(1.5,0.03,0.5,0x4a3620,{rough:0.7}); put(shelf,0,0.28,0); g.add(shelf);
    const vice = box(0.16,0.12,0.12,0x33383e,{metal:0.6,rough:0.4}); put(vice,0.55,0.9,0.2); g.add(vice);
    g.userData.footprint=[1.6,0.6]; return g;
  };
  B.garageshelf = () => {
    const g = grp();
    for (let i=0;i<4;i++){ const shelf=box(1.1,0.03,0.4,0x33383e,{metal:0.5,rough:0.5}); put(shelf,0,0.3+i*0.45,0); g.add(shelf); }
    for (const x of [-0.52,0.52]){ const post=box(0.04,1.8,0.04,0x1c1c1c,{metal:0.5}); put(post,x,0.9,0); g.add(post); }
    const box1=box(0.4,0.25,0.32,0xc9812f,{rough:0.8}); put(box1,-0.3,0.9,0); g.add(box1);
    const box2=box(0.35,0.22,0.3,0x5a8a5c,{rough:0.8}); put(box2,0.3,1.35,0); g.add(box2);
    g.userData.footprint=[1.1,0.4]; return g;
  };

  // ---------- SOLAR PANEL (mounted on a tilted roof group; local Y stays flush) ----------
  B.solarpanel = () => {
    const g = grp();
    const frame = box(1.0,0.035,1.65,0x1c2126,{metal:0.6,rough:0.4}); put(frame,0,0.018,0); g.add(frame);
    const cellsMat = new THREE.MeshStandardMaterial({ color:0x0e2a4a, roughness:0.25, metalness:0.6, emissive:new THREE.Color(0x3a8bff), emissiveIntensity:0 });
    const cellsGeo = geo('box:0.92:0.01:1.55', ()=>new THREE.BoxGeometry(0.92,0.01,1.55));
    const cells = new THREE.Mesh(cellsGeo, cellsMat);
    cells.position.set(0,0.041,0); cells.castShadow=true; cells.receiveShadow=true; g.add(cells);
    // grid lines (cheap: thin dark bars)
    for (let i=-3;i<=3;i++){ const line=box(0.005,0.001,1.55,0x0a1420); put(line,i*0.13,0.047,0); g.add(line); }
    const frameEdge = box(1.0,0.02,1.65,0x2b3138,{metal:0.5,rough:0.4,extra:{transparent:true,opacity:0}}); frameEdge.visible=false; g.add(frameEdge);
    g.userData.cellsMat = cellsMat;
    g.userData.footprint=[1.0,1.65]; g.userData.flat=true; return g;
  };

  function fallback(){
    const g = grp();
    const b = box(0.3,0.3,0.3,0x66707f,{rough:0.6}); put(b,0,0.15,0); g.add(b);
    g.userData.footprint=[0.3,0.3]; return g;
  }

  return {
    build(modelType, addRing){
      const fn = B[modelType] || B._fallback;
      const g = (fn||fallback)();
      g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
      if (addRing && !g.userData.flat){
        const fp = g.userData.footprint || [0.4,0.4];
        const r = Math.max(0.16, Math.min(0.55, Math.hypot(fp[0],fp[1])*0.62));
        const ringGeo = geo('ring:'+r.toFixed(2), ()=>new THREE.RingGeometry(r*0.62, r, 28));
        const ringMat = new THREE.MeshBasicMaterial({ color:0x5eead4, transparent:true, opacity:0, side:THREE.DoubleSide, depthWrite:false });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI/2;
        ring.position.y = g.userData.wallMount ? -1.28 : 0.006; // project down to floor even for wall-mounted devices
        ring.renderOrder = 1;
        g.add(ring);
        g.userData.ring = ring;
      }
      return g;
    }
  };
})();
