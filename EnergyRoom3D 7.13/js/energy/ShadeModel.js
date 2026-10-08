/**
 * SHADE MODEL
 * Simplified geometric model of direct-beam shading for PV panels.
 * Pure math (no THREE.js, no DOM) so it is fast, deterministic and unit-testable.
 *
 * World convention (identical to SunPosition / ObjectManager.computePVOrientation):
 *   +X = East, -Z = North, +Y = up.  Sun azimuth is a compass bearing (0=N, 90=E, 180=S).
 *   Direction TO the sun:  (sin(az)*cos(el),  sin(el),  -cos(az)*cos(el))
 *
 * Occluders (static: buildings, roofs, trees, ...; dynamic: other panels):
 *   { kind:'obb',    center:[x,y,z], axes:[[..],[..],[..]], half:[hx,hy,hz], transmit:0, ownerRoomId }
 *   { kind:'sphere', center:[x,y,z], r, transmit | transmitBySeason:{summer,autumn,winter,spring} }
 * `transmit` = fraction of the direct beam that still passes through (0 = opaque wall,
 * 0.2 = dense summer foliage, 0.7 = leafless winter tree).
 *
 * A panel is sampled on a grid of points across its surface; each sample casts one ray towards
 * the sun.  Sample transmittance = product of the transmit values of every occluder that ray
 * crosses.  Panel direct-beam factor = mean sample transmittance (0..1).  So a panel whose lower
 * third is in the shadow of a roof edge really reports ~0.66, and PV output scales with it
 * (SolarCalculator adds the diffuse component on top - shade never reduces diffuse light to 0).
 *
 * Performance: nothing here runs per frame.  Results are memoised per panel and per quantised
 * sun position (1° elevation x 2° azimuth) and the whole cache is dropped only when geometry
 * changes (rebuild, panel moved, season changed) - so a 365-day fast-forward costs a bounded
 * number of ray casts, not one per simulated minute.
 */
class ShadeModel {
  constructor(opts){
    opts = opts || {};
    this.cols = opts.cols || 4;    // samples across panel width
    this.rows = opts.rows || 3;    // samples across panel length (3 = typical bypass-diode substrings)
    this.staticOcc = [];
    this.panels = new Map();       // id -> geometry (see setPanel)
    this.season = 'summer';
    this.version = 0;
    this._cache = new Map();       // id -> Map(key -> factor)
    this._cacheVersion = 0;
    this.stats = { rayCasts: 0, cacheHits: 0, cacheMisses: 0 };
  }

  _bump(){ this.version++; }

  setStaticOccluders(list){ this.staticOcc = Array.isArray(list) ? list : []; this._bump(); }

  setSeason(season){
    if (season && season !== this.season){ this.season = season; this._bump(); }
  }

  /** geom: { center:[x,y,z], u:[..] (panel width axis), n:[..] (normal), v:[..] (panel length axis),
   *          halfW, halfL, halfT, roomId } - all in world space. */
  setPanel(id, geom){ this.panels.set(id, geom); this._bump(); }
  removePanel(id){ if (this.panels.delete(id)) this._bump(); }
  clearPanels(){ if (this.panels.size){ this.panels.clear(); this._bump(); } }

  /** Direct-beam factor 0..1 for one panel at the given sun position. */
  factor(panelId, elevationDeg, azimuthDeg){
    if (elevationDeg <= 0) return 0;
    const geom = this.panels.get(panelId);
    if (!geom) return 1; // unknown panel -> assume unobstructed (never invent shade)
    if (this._cacheVersion !== this.version){ this._cache.clear(); this._cacheVersion = this.version; }
    const key = Math.round(elevationDeg) * 1000 + Math.round(azimuthDeg / 2);
    let pc = this._cache.get(panelId);
    if (!pc){ pc = new Map(); this._cache.set(panelId, pc); }
    const hit = pc.get(key);
    if (hit !== undefined){ this.stats.cacheHits++; return hit; }
    this.stats.cacheMisses++;
    // evaluate at the quantised position so the cached value is exactly what the key represents
    const f = this._compute(panelId, geom, Math.round(elevationDeg), Math.round(azimuthDeg / 2) * 2);
    if (pc.size > 12000) pc.clear();
    pc.set(key, f);
    return f;
  }

  static sunDir(elevationDeg, azimuthDeg){
    const el = elevationDeg * Math.PI/180, az = azimuthDeg * Math.PI/180;
    return [Math.sin(az)*Math.cos(el), Math.sin(el), -Math.cos(az)*Math.cos(el)];
  }

  _compute(panelId, g, elDeg, azDeg){
    const d = ShadeModel.sunDir(elDeg, azDeg);
    // a panel facing away from the sun receives no direct beam at all
    const facing = d[0]*g.n[0] + d[1]*g.n[1] + d[2]*g.n[2];
    if (facing <= 0.001) return 0;
    const occ = this._occludersFor(panelId, g);
    if (!occ.length) return 1;
    let sum = 0, count = 0;
    const off = 0.04; // lift ray origin off the glass so the panel never shadows itself
    for (let r = 0; r < this.rows; r++){
      for (let c = 0; c < this.cols; c++){
        const a = ((c + 0.5)/this.cols - 0.5) * 2 * g.halfW;
        const b = ((r + 0.5)/this.rows - 0.5) * 2 * g.halfL;
        const o = [
          g.center[0] + g.u[0]*a + g.v[0]*b + g.n[0]*off,
          g.center[1] + g.u[1]*a + g.v[1]*b + g.n[1]*off,
          g.center[2] + g.u[2]*a + g.v[2]*b + g.n[2]*off,
        ];
        sum += this._transmittance(o, d, occ);
        count++;
        this.stats.rayCasts++;
      }
    }
    return count ? sum/count : 1;
  }

  _occludersFor(panelId, g){
    const out = [];
    for (const o of this.staticOcc){
      // a panel is mounted ON its own building's roof - that building (box + roof slab) never shades it
      if (o.ownerRoomId != null && o.ownerRoomId === g.roomId) continue;
      out.push(o);
    }
    for (const [id, p] of this.panels){
      if (id === panelId) continue;
      out.push({ kind:'obb', center:p.center, axes:[p.u, p.n, p.v], half:[p.halfW, p.halfT, p.halfL], transmit:0 });
    }
    return out;
  }

  _transmittance(o, d, occ){
    let t = 1;
    for (const s of occ){
      const tr = this._transmitOf(s);
      if (tr >= 1) continue;
      const hit = s.kind === 'sphere' ? this._raySphere(o, d, s) : this._rayObb(o, d, s);
      if (hit){ t *= tr; if (t <= 0.0001) return 0; }
    }
    return t;
  }

  _transmitOf(s){
    if (s.transmitBySeason && s.transmitBySeason[this.season] != null) return s.transmitBySeason[this.season];
    return s.transmit == null ? 0 : s.transmit;
  }

  _raySphere(o, d, s){
    const ox = o[0]-s.center[0], oy = o[1]-s.center[1], oz = o[2]-s.center[2];
    const b = ox*d[0] + oy*d[1] + oz*d[2];
    const c = ox*ox + oy*oy + oz*oz - s.r*s.r;
    if (c > 0 && b > 0) return false;            // origin outside and pointing away
    const disc = b*b - c;
    if (disc < 0) return false;
    const t1 = -b + Math.sqrt(disc);             // far intersection must be in front of the origin
    return t1 > 0.001;
  }

  _rayObb(o, d, s){
    const rx = o[0]-s.center[0], ry = o[1]-s.center[1], rz = o[2]-s.center[2];
    let tmin = 0.001, tmax = Infinity;
    for (let i = 0; i < 3; i++){
      const ax = s.axes[i];
      const oi = rx*ax[0] + ry*ax[1] + rz*ax[2];
      const di = d[0]*ax[0] + d[1]*ax[1] + d[2]*ax[2];
      const h = s.half[i];
      if (Math.abs(di) < 1e-9){
        if (oi < -h || oi > h) return false;
      } else {
        let t1 = (-h - oi)/di, t2 = (h - oi)/di;
        if (t1 > t2){ const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return false;
      }
    }
    return tmax > 0.001;
  }

  // ---- helpers to build occluders from plain numbers (used by RoomBuilder / EnvironmentBuilder / tests) ----
  static box(min, max, extra){
    const c = [(min[0]+max[0])/2, (min[1]+max[1])/2, (min[2]+max[2])/2];
    return Object.assign({ kind:'obb', center:c, axes:[[1,0,0],[0,1,0],[0,0,1]],
      half:[(max[0]-min[0])/2, (max[1]-min[1])/2, (max[2]-min[2])/2], transmit:0 }, extra||{});
  }
  static sphere(center, r, extra){
    return Object.assign({ kind:'sphere', center, r, transmit:0 }, extra||{});
  }
  /** Foliage transmittance by season for a deciduous tree crown (share of the direct beam that gets through). */
  static TREE_TRANSMIT = { summer:0.18, spring:0.5, autumn:0.42, winter:0.78 };
}
