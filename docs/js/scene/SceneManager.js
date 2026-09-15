/**
 * SCENE MANAGER
 * Owns THREE.Scene / Camera / Renderer / Lights / render loop.
 * Knows nothing about devices, energy or schedules - purely visual.
 * Unity mapping: the Scene itself + a thin CameraRig script.
 */
class SceneManager {
  constructor(container){
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0f16);
    this.scene.fog = new THREE.Fog(0x0b0f16, 18, 34);

    const aspect = container.clientWidth/container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.05, 100);
    this.camera.position.set(5.4, 3.6, 6.6);

    this.renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false, powerPreference:'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding; // r128 API (pre outputColorSpace)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI*0.495;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 22;
    this.controls.target.set(3.2, 0.9, 2.2);
    this.controls.update();

    this._buildLights();
    this._buildGrid();

    this.clock = new THREE.Clock();
    this._animateCallbacks = [];
    this._renderLoop = this._renderLoop.bind(this);
    requestAnimationFrame(this._renderLoop);

    window.addEventListener('resize', ()=>this.onResize());
  }

  _buildLights(){
    this.hemi = new THREE.HemisphereLight(0x9fc4ff, 0x1a1410, 0.55);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff2d6, 1.1);
    this.sun.position.set(6, 9, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -8; this.sun.shadow.camera.right = 8;
    this.sun.shadow.camera.top = 8; this.sun.shadow.camera.bottom = -8;
    this.sun.shadow.camera.near = 0.5; this.sun.shadow.camera.far = 30;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // interior room lights (toggled by lighting devices / day-night)
    this.roomLight = new THREE.PointLight(0xfff0d0, 0.0, 9, 2);
    this.roomLight.position.set(3.5, 2.5, 2.5);
    this.roomLight.castShadow = false;
    this.scene.add(this.roomLight);
  }

  _buildGrid(){
    this.grid = new THREE.GridHelper(20, 80, 0x2a3a52, 0x18202e);
    this.grid.position.y = 0.001;
    this.scene.add(this.grid);
  }
  setGridVisible(v){ this.grid.visible = v; }

  /** hour: 0-24 float. Drives sun angle, color temperature, sky, room fill */
  setDayNight(hour){
    const t = hour/24;
    const angle = t*Math.PI*2 - Math.PI/2;
    const r = 10;
    this.sun.position.set(Math.cos(angle)*r, Math.max(Math.sin(angle)*r, 1.2), 3);
    this.sun.target.position.set(0,0,0);

    let skyTop, sunIntensity, ambientI, hemiI, fogColor;
    if (hour>=6 && hour<9){ // sunrise
      const k=(hour-6)/3; skyTop=lerpColor(0x1c2333,0x9fc4ff,k); sunIntensity=0.5+0.6*k; ambientI=0.12+0.1*k; hemiI=0.3+0.3*k;
    } else if (hour>=9 && hour<17){ // day
      skyTop=0xaed4ff; sunIntensity=1.15; ambientI=0.22; hemiI=0.6;
    } else if (hour>=17 && hour<20){ // sunset
      const k=(hour-17)/3; skyTop=lerpColor(0xaed4ff,0x2a2136,k); sunIntensity=1.15-0.9*k; ambientI=0.22-0.1*k; hemiI=0.6-0.35*k;
    } else { // night
      skyTop=0x0b0f16; sunIntensity=0.05; ambientI=0.08; hemiI=0.18;
    }
    this.scene.background = new THREE.Color(skyTop);
    this.scene.fog.color = new THREE.Color(skyTop);
    this.sun.intensity = sunIntensity;
    this.ambient.intensity = ambientI;
    this.hemi.intensity = hemiI;
    const night = hour<6.5 || hour>19.5;
    this.roomLight.intensity = night ? 0.55 : 0.0;
  }

  onResize(){
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w,h);
  }

  setView(name){
    const t = this.controls.target;
    const d = THREE.MathUtils.clamp(this.camera.position.distanceTo(t) || 8, 4, 11);
    const pos = {
      top:    [t.x, t.y+d, t.z+0.001],
      front:  [t.x, t.y+1.2, t.z+d],
      left:   [t.x-d, t.y+1.2, t.z],
      right:  [t.x+d, t.y+1.2, t.z],
      home:   [5.4,3.6,6.6],
      iso:    [t.x+d*0.6, t.y+d*0.55, t.z+d*0.6],
    }[name];
    if (!pos) return;
    this.camera.position.set(...pos);
    if (name==='home'){ this.controls.target.set(3.2,0.9,2.2); }
    this.controls.update();
  }

  focusOn(object3d){
    const box = new THREE.Box3().setFromObject(object3d);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(dir.multiplyScalar(Math.max(size*1.6, 1.5)));
    this.controls.update();
  }

  /** Frame a floor-plane rectangle (x1,z1)..(x2,z2), e.g. a room's footprint. Always uses a
   *  fixed, reliable 3/4 viewing angle rather than the previous camera direction, so switching
   *  between very differently-shaped rooms never produces a degenerate near-grazing view. */
  frameArea(x1, z1, x2, z2, height){
    const cx = (x1+x2)/2, cz = (z1+z2)/2;
    const w = Math.abs(x2-x1), d = Math.abs(z2-z1);
    const diag = Math.hypot(w, d, (height||2.6));
    const dir = new THREE.Vector3(0.62, 0.52, 0.62).normalize();
    this.controls.target.set(cx, (height||2.6)*0.32, cz);
    this.camera.position.copy(this.controls.target).add(dir.multiplyScalar(Math.max(diag*0.82, 3.2)));
    this.controls.update();
  }

  onFrame(cb){ this._animateCallbacks.push(cb); }

  _renderLoop(){
    const dt = this.clock.getDelta();
    for (const cb of this._animateCallbacks) cb(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._renderLoop);
  }
}

function lerpColor(a,b,t){
  const ca=new THREE.Color(a), cb=new THREE.Color(b);
  return ca.lerp(cb,t).getHex();
}
