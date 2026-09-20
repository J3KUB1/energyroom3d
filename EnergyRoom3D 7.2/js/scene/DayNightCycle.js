/**
 * DAY / NIGHT CYCLE
 * Visual time-of-day driven by the SAME solar geometry the PV model uses (SunPosition), so sun height,
 * sunrise/sunset and shadow direction follow the simulated DATE (long summer days, short low-sun winter days)
 * and never drift out of sync with the energy simulation.
 *
 * What it controls (all cheap, executed only when the simulated time/date/sky changes - never per frame,
 * except the sky dome following the camera, which is one matrix copy):
 *  - sun direction + elevation (DirectionalLight, shadows follow it; shadow frustum fitted to the house)
 *  - light colour temperature (deep orange at the horizon -> near white at noon) and intensity
 *  - sky gradient dome with sun glow, cloud desaturation (weather sky factor), fog colour
 *  - hemisphere / ambient fill, interior room fill light (as it gets dark)
 *  - stars (visible only when the sun is well below the horizon, hidden by cloud cover, rotating with the sky)
 *  - a moon opposite the sun (simplified: always a near-full disc)
 *  - a named phase: dawn, morning, day, noon, afternoon, sunset, dusk, night
 *
 * World axes: +X = East, -Z = North, +Y = up (same as ShadeModel / ObjectManager.computePVOrientation).
 */
class DayNightCycle {
  // ---------------- pure helpers (no THREE, unit-testable) ----------------
  static smoothstep(a, b, x){ const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); }

  /** Phase key for the sun's elevation on this date. Keys map to I18n 'phase.<key>'. */
  static phaseKey(elevationDeg, hour, noonElevationDeg){
    const el = elevationDeg;
    if (el < -12) return 'night';
    const morning = hour < 12;
    if (el < 3){
      if (morning) return 'dawn';
      return el >= -1 ? 'sunset' : 'dusk';
    }
    if (Math.abs(hour - 12) <= 1.25) return 'noon';
    const high = el >= 0.55 * noonElevationDeg;
    if (morning) return high ? 'day' : 'morning';
    return high ? 'afternoon' : 'sunset';
  }

  /** Everything the visuals and the UI need for a (dayOfYear, hour) pair. */
  static sunState(dayOfYear, hour){
    const pos = SunPosition.position(dayOfYear, hour);
    const times = SunPosition.sunTimes(dayOfYear);
    return {
      elevationDeg: pos.elevationDeg, azimuthDeg: pos.azimuthDeg,
      sunriseHour: times.sunriseHour, sunsetHour: times.sunsetHour, dayLengthHours: times.dayLengthHours,
      noonElevationDeg: times.noonElevationDeg,
      phase: DayNightCycle.phaseKey(pos.elevationDeg, hour, times.noonElevationDeg),
      daylight: DayNightCycle.smoothstep(-6, 6, pos.elevationDeg),
    };
  }

  /** Unit vector from the scene towards the sun. */
  static dirTo(elevationDeg, azimuthDeg){
    const el = elevationDeg*Math.PI/180, az = azimuthDeg*Math.PI/180;
    return [Math.sin(az)*Math.cos(el), Math.sin(el), -Math.cos(az)*Math.cos(el)];
  }

  // sky colour keyframes by sun elevation: [elevation, zenith hex, horizon hex]
  static SKY_KEYS = [
    [-18, 0x03060d, 0x0a1120],
    [-8,  0x0d1530, 0x2a2a52],
    [-2,  0x243a6b, 0xc0603f],
    [3,   0x3f6fb0, 0xffa25e],
    [10,  0x4f86cf, 0xe8c9a2],
    [25,  0x5a9be8, 0xbcd8f3],
    [90,  0x4a8ee6, 0xb0d2f5],
  ];
  static skyColors(el){
    const K = DayNightCycle.SKY_KEYS;
    if (el <= K[0][0]) return { top:K[0][1], horizon:K[0][2] };
    for (let i = 1; i < K.length; i++){
      if (el <= K[i][0]){
        const a = K[i-1], b = K[i], t = (el - a[0])/(b[0] - a[0]);
        return { top:DayNightCycle._mix(a[1], b[1], t), horizon:DayNightCycle._mix(a[2], b[2], t) };
      }
    }
    const l = K[K.length-1]; return { top:l[1], horizon:l[2] };
  }
  static _mix(a, b, t){
    const ar=(a>>16)&255, ag=(a>>8)&255, ab=a&255, br=(b>>16)&255, bg=(b>>8)&255, bb=b&255;
    return (Math.round(ar+(br-ar)*t)<<16) | (Math.round(ag+(bg-ag)*t)<<8) | Math.round(ab+(bb-ab)*t);
  }
  /** Sunlight colour: deep orange near the horizon, warm white by mid-morning, near white at noon. */
  static sunColor(el){
    if (el <= 0) return 0xff7a3a;
    if (el < 10) return DayNightCycle._mix(0xff7a3a, 0xffcf9c, el/10);
    if (el < 30) return DayNightCycle._mix(0xffcf9c, 0xfff4e0, (el-10)/20);
    return 0xfff4e0;
  }
  /** Direct sunlight strength: 0 below the horizon, rising with sin(elevation), dimmed by cloud. */
  static sunIntensity(el, skyFactor){
    const S = DayNightCycle.smoothstep;
    const sky = skyFactor == null ? 1 : Math.max(0, Math.min(1, skyFactor));
    return S(-3, 4, el) * (0.28 + 0.95*S(0, 38, el)) * (0.25 + 0.75*sky);
  }

  // ---------------- scene side ----------------
  constructor(sceneManager){
    this.sm = sceneManager;
    const scene = sceneManager.scene;
    this.last = null;
    this.focus = { x:3.2, z:2.2, radius:9 };

    this.skyGroup = new THREE.Group(); this.skyGroup.name = 'Sky';
    scene.add(this.skyGroup);

    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite:false, depthTest:false, fog:false,
      uniforms: {
        topColor:{ value:new THREE.Color(0x4a8ee6) }, horizonColor:{ value:new THREE.Color(0xb0d2f5) },
        groundColor:{ value:new THREE.Color(0x141a14) }, sunColor:{ value:new THREE.Color(0xfff4e0) },
        sunDir:{ value:new THREE.Vector3(0,1,0) }, sunGlow:{ value:1 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 groundColor; uniform vec3 sunColor;',
        'uniform vec3 sunDir; uniform float sunGlow; varying vec3 vDir;',
        'void main(){',
        '  vec3 d = normalize(vDir); float h = d.y;',
        '  vec3 col = mix(horizonColor, topColor, pow(clamp(h,0.0,1.0), 0.55));',
        '  col = mix(col, groundColor, smoothstep(0.0, -0.22, h));',
        '  float s = max(dot(d, normalize(sunDir)), 0.0);',
        '  col += sunColor * (pow(s,900.0)*1.6 + pow(s,14.0)*0.30*sunGlow + pow(s,3.0)*0.10*sunGlow);',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'].join('\n'),
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(70, 32, 16), this.domeMat);
    this.dome.renderOrder = -20; this.dome.frustumCulled = false;
    this.skyGroup.add(this.dome);

    // stars: deterministic upper-hemisphere field that rotates about the celestial pole
    let seed = 20260918;
    const rnd = ()=>{ seed = (seed*1664525 + 1013904223) >>> 0; return seed/4294967296; };
    const N = 750, pos = new Float32Array(N*3);
    for (let i = 0; i < N; i++){
      const u = rnd()*2 - 1, a = rnd()*Math.PI*2, r = Math.sqrt(1-u*u);
      pos[i*3] = Math.cos(a)*r*62; pos[i*3+1] = u*62; pos[i*3+2] = Math.sin(a)*r*62;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color:0xffffff, size:1.7, sizeAttenuation:false, transparent:true, opacity:0, depthTest:false, depthWrite:false, fog:false });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.renderOrder = -19; this.stars.frustumCulled = false;
    this.skyGroup.add(this.stars);

    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(1.7, 16, 12), new THREE.MeshBasicMaterial({ color:0xfff4e0, fog:false, depthTest:false, depthWrite:false }));
    this.sunDisc.renderOrder = -18; this.sunDisc.frustumCulled = false; this.skyGroup.add(this.sunDisc);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshBasicMaterial({ color:0xe6ecff, fog:false, depthTest:false, depthWrite:false }));
    this.moon.renderOrder = -18; this.moon.frustumCulled = false; this.skyGroup.add(this.moon);

    this.moonLight = new THREE.DirectionalLight(0x9fb4ff, 0);
    scene.add(this.moonLight); scene.add(this.moonLight.target);
    this._v = new THREE.Vector3();

    sceneManager.onFrame(()=>{ this.skyGroup.position.copy(sceneManager.camera.position); });
  }

  /** Fit the sun's shadow frustum to the house (called after every house rebuild). */
  setFocus(cx, cz, radius){
    this.focus = { x:cx, z:cz, radius:Math.max(6, radius) };
    const cam = this.sm.sun.shadow.camera, r = this.focus.radius;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 130;
    cam.updateProjectionMatrix();
    if (this.last) this.apply(this.last.hour, this.last.ctx);
  }

  /** hour 0..24; ctx = { dayOfYear, skyFactor } (skyFactor 1 = clear, 0 = fully overcast). Returns the sun state. */
  apply(hour, ctx){
    ctx = ctx || {}; const doy = ctx.dayOfYear || 172, sky = ctx.skyFactor == null ? 1 : ctx.skyFactor;
    const S = DayNightCycle.smoothstep;
    const st = DayNightCycle.sunState(doy, hour);
    const el = st.elevationDeg;
    this.last = { hour, ctx, state: st };
    const sm = this.sm, f = this.focus;

    // --- sun light: direction, colour, intensity; shadows keep a floor elevation so they never stretch to infinity
    const dir = DayNightCycle.dirTo(Math.max(el, 3), st.azimuthDeg), R = 60;
    sm.sun.position.set(f.x + dir[0]*R, Math.max(0.5, dir[1]*R), f.z + dir[2]*R);
    sm.sun.target.position.set(f.x, 0, f.z); sm.sun.target.updateMatrixWorld();
    sm.sun.color.setHex(DayNightCycle.sunColor(el));
    sm.sun.intensity = DayNightCycle.sunIntensity(el, sky) * 1.25;

    // --- sky dome
    const sc = DayNightCycle.skyColors(el);
    const overcast = (1 - sky) * 0.75 * st.daylight;
    const top = new THREE.Color(sc.top).lerp(new THREE.Color(0x8892a0), overcast);
    const hor = new THREE.Color(sc.horizon).lerp(new THREE.Color(0xb9c0c8), overcast);
    this.domeMat.uniforms.topColor.value.copy(top);
    this.domeMat.uniforms.horizonColor.value.copy(hor);
    this.domeMat.uniforms.sunColor.value.setHex(DayNightCycle.sunColor(el));
    const sdir = DayNightCycle.dirTo(el, st.azimuthDeg);
    this.domeMat.uniforms.sunDir.value.set(sdir[0], sdir[1], sdir[2]);
    this.domeMat.uniforms.sunGlow.value = (0.35 + 0.65*sky) * S(-6, 2, el);
    this.sunDisc.position.set(sdir[0]*64, sdir[1]*64, sdir[2]*64);
    this.sunDisc.visible = el > -2;
    this.sunDisc.material.color.setHex(DayNightCycle.sunColor(el));
    this.sunDisc.material.opacity = 1;
    sm.scene.background = hor.clone();
    sm.scene.fog.color.copy(hor);

    // --- moon (opposite the sun, simplified) + faint blue moonlight
    const mEl = -el * 0.9 + 4, mAz = (st.azimuthDeg + 180) % 360;
    const mdir = DayNightCycle.dirTo(mEl, mAz);
    this.moon.position.set(mdir[0]*63, mdir[1]*63, mdir[2]*63);
    const moonUp = S(-2, 8, mEl) * (1 - S(-8, -2, el) * 0 ) * (1 - st.daylight);
    this.moon.visible = mEl > -1 && st.daylight < 0.6;
    this.moonLight.position.set(f.x + mdir[0]*R, Math.max(1, mdir[1]*R), f.z + mdir[2]*R);
    this.moonLight.target.position.set(f.x, 0, f.z); this.moonLight.target.updateMatrixWorld();
    this.moonLight.intensity = 0.22 * moonUp * (0.4 + 0.6*sky);

    // --- stars: only when the sun is well below the horizon, dimmed by cloud, rotating with the sky
    const starVis = S(-4, -14, el) * (0.15 + 0.85*sky);
    this.starMat.opacity = starVis;
    this.stars.visible = starVis > 0.01;
    const lat = SunPosition.LATITUDE_DEG*Math.PI/180;
    const axis = this._v.set(0, Math.sin(lat), -Math.cos(lat)).normalize();
    this.stars.setRotationFromAxisAngle(axis, -((hour*15) + doy*0.9856)*Math.PI/180);

    // --- fill lights
    sm.hemi.color.copy(top).lerp(new THREE.Color(0xffffff), 0.35);
    sm.hemi.groundColor.setHex(0x1a1410);
    sm.hemi.intensity = 0.14 + st.daylight * (0.42 + (1 - sky) * 0.18);
    sm.ambient.intensity = 0.07 + 0.15*st.daylight + 0.05*(1 - sky)*st.daylight;
    this.darkness = 1 - st.daylight;
    sm.roomLight.intensity = 0.6 * this.darkness * (1 - S(-2, 0, el) * 0);
    return st;
  }
}
