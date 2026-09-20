/**
 * SOLAR CALCULATOR
 * Deterministic PV power model for one panel instance at one instant:
 *   watts = peakPowerW × incidenceFactor(sun vs panel orientation) ×
 *           horizonSoftening × skyFactor(weather)
 * incidenceFactor comes from SunPosition (real, season+time-of-day sun
 * elevation/azimuth vs the panel's actual tilt/azimuth, cached on the
 * instance as `pvOrientation` by ObjectManager whenever its transform
 * changes) - this is what makes section 15 ("wpływ ustawienia paneli
 * na produkcję") a real, physically-grounded mechanic instead of a
 * cosmetic-only rotation. skyFactor comes from WeatherSystem's
 * continuous, persistent cloud condition (section 10).
 * Clearly labelled throughout the UI as a simulation model, never
 * presented as a real irradiance forecast.
 * Pure logic - no THREE.js, no DOM. Unity mapping: SolarSystem static
 * utility, mirrors EnergySystem.
 */
const SolarCalculator = {
  DEFAULT_ORIENTATION: { tiltDeg: 20, azimuthDeg: 180 }, // used only if a panel hasn't had its orientation cached yet

  /** Optional ShadeModel (set once by main.js). When present, every consumer of resolve() -
   *  the live engine AND the analytics projections - automatically sees shaded output. */
  shadeModel: null,

  /** Share of the sky's light that is DIFFUSE (unaffected by a shadow on the panel):
   *  ~12% under a clear sky, rising to >50% under heavy overcast. skyFactor 1 = clear. */
  diffuseShare(skyFactor){
    const s = skyFactor==null ? 1 : Math.max(0, Math.min(1, skyFactor));
    return Math.min(0.95, 0.12 + 0.6*(1 - s));
  },

  /** Full breakdown for one panel at one instant:
   *  { w, incidence, direct (0..1 direct-beam access, 1 = no shade), sunlight (0..1 effective share of
   *    unshaded output actually reached), elevationDeg, azimuthDeg }.
   *  power = peak x incidence x horizon x sky x sunlight,  sunlight = diffuse + (1-diffuse) x direct. */
  resolveDetailed(panelInst, absMin, dayOfYear, skyFactor){
    const out = { w:0, incidence:0, direct:1, sunlight:1, elevationDeg:0, azimuthDeg:0 };
    if (!panelInst.connected) return out;
    // one sun-position evaluation per (minute, day) shared by every panel of the array
    const ck = absMin * 400 + dayOfYear;
    let pos;
    if (this._posKey === ck) pos = this._pos;
    else { pos = SunPosition.position(dayOfYear, (absMin % 1440) / 60); this._posKey = ck; this._pos = pos; }
    out.elevationDeg = pos.elevationDeg; out.azimuthDeg = pos.azimuthDeg;
    if (pos.elevationDeg <= 0.05) return out;
    const orient = panelInst.pvOrientation || this.DEFAULT_ORIENTATION;
    const incidence = SunPosition.incidenceFactor(pos.elevationDeg, pos.azimuthDeg, orient.tiltDeg, orient.azimuthDeg);
    out.incidence = incidence;
    // smooth dawn/dusk ramp instead of a hard cutoff at the horizon (matches "wschod/zachod" softness)
    const horizonSoftening = Math.max(0, Math.min(1, pos.elevationDeg/6));
    const sky = skyFactor==null ? 1 : Math.max(0, Math.min(1, skyFactor));
    if (this.shadeModel && panelInst.id){
      out.direct = this.shadeModel.factor(panelInst.id, pos.elevationDeg, pos.azimuthDeg);
    }
    const diffuse = this.diffuseShare(sky);
    out.sunlight = diffuse + (1 - diffuse) * out.direct;
    out.w = Math.max(0, panelInst.def.peakPowerW * incidence * horizonSoftening * sky * out.sunlight);
    return out;
  },

  /** Returns generated watts (positive number = production) for one panel instance.
   *  dayOfYear: 1..366 (season/declination). skyFactor: 0..1 from WeatherSystem (1 = clear sky assumption if omitted). */
  resolve(panelInst, absMin, dayOfYear, skyFactor){
    return this.resolveDetailed(panelInst, absMin, dayOfYear, skyFactor).w;
  },

  /** Sunrise/sunset/day-length for a given day-of-year - used to sync the visual day/night cycle and for UI display. */
  sunTimesForDay(dayOfYear){ return SunPosition.sunTimes(dayOfYear); },

  /** 0..1 "how well is this panel aimed" quality score at a representative moment (solar noon on the given day) -
   *  used by the PV install UI to give the user instant feedback on orientation/tilt choices. */
  aimQuality(orientation, dayOfYear){
    const pos = SunPosition.position(dayOfYear, 12);
    const best = SunPosition.incidenceFactor(pos.elevationDeg, pos.azimuthDeg, 35, 180); // near-ideal reference for 52°N
    const mine = SunPosition.incidenceFactor(pos.elevationDeg, pos.azimuthDeg, orientation.tiltDeg, orientation.azimuthDeg);
    return best>0 ? Math.max(0, Math.min(1, mine/best)) : 0;
  },

  /** Human-readable compass label (8-point) for a panel azimuth in degrees, 0=N/90=E/180=S/270=W. lang: 'pl'|'en' */
  compassLabel(azimuthDeg, lang){
    const dirsPl = ['Północ','Płn-Wsch','Wschód','Płd-Wsch','Południe','Płd-Zach','Zachód','Płn-Zach'];
    const dirsEn = ['North','NE','East','SE','South','SW','West','NW'];
    const dirs = lang==='en' ? dirsEn : dirsPl;
    const idx = Math.round(((azimuthDeg%360+360)%360)/45) % 8;
    return dirs[idx];
  },
};
