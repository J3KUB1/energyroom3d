/**
 * SUN POSITION
 * Simplified (but real) solar geometry for a mid-latitude Central
 * European site (default latitude 52°N, roughly Poland) - this is what
 * gives the whole simulation its seasons: shorter/longer days, a lower/
 * higher sun at noon, and a real reason for PV panel orientation and
 * tilt to matter (section 15's "kierunek/kąt" only makes sense if the
 * sun's direction is actually modeled).
 * Standard approximations (NOAA-style, simplified - no atmospheric
 * refraction correction, no equation-of-time): accurate enough to
 * produce a correct, continuously varying seasonal shape without
 * pulling in a full ephemeris library.
 * Pure math - no THREE.js, no DOM.
 */
const SunPosition = {
  LATITUDE_DEG: 52.0, // Warsaw-ish

  /** Day-of-year (1..366) from an absolute simulated day count (0-based from sim epoch) + a project start date. */
  dayOfYear(date){
    const start = new Date(date.getFullYear(),0,1);
    return Math.floor((date - start) / 86400000) + 1;
  },

  /** Solar declination in degrees for a given day-of-year (standard Cooper's approximation). */
  declinationDeg(dayOfYear){
    return 23.44 * Math.sin(THREE_MathUtils_degToRad(360/365 * (dayOfYear - 81)));
  },

  /** {sunriseHour, sunsetHour, dayLengthHours, noonElevationDeg} as decimal hours (solar time ≈ clock time here, no timezone/longitude correction). */
  sunTimes(dayOfYear, latDeg){
    latDeg = latDeg==null ? this.LATITUDE_DEG : latDeg;
    const decl = this.declinationDeg(dayOfYear);
    const lat = THREE_MathUtils_degToRad(latDeg), d = THREE_MathUtils_degToRad(decl);
    let cosH0 = -Math.tan(lat)*Math.tan(d);
    cosH0 = Math.max(-1, Math.min(1, cosH0)); // clamp for polar edge cases (not reached at lat 52, kept for safety)
    const H0deg = THREE_MathUtils_radToDeg(Math.acos(cosH0));
    const sunrise = 12 - H0deg/15, sunset = 12 + H0deg/15;
    const noonElevation = 90 - Math.abs(latDeg - decl);
    return { sunriseHour: sunrise, sunsetHour: sunset, dayLengthHours: sunset-sunrise, noonElevationDeg: noonElevation, declinationDeg: decl };
  },

  /** Sun elevation + azimuth (compass bearing, 0=N/90=E/180=S/270=W) at decimal hour `hour` (0..24) on a given day-of-year. */
  position(dayOfYear, hour, latDeg){
    latDeg = latDeg==null ? this.LATITUDE_DEG : latDeg;
    const decl = THREE_MathUtils_degToRad(this.declinationDeg(dayOfYear));
    const lat = THREE_MathUtils_degToRad(latDeg);
    const H = THREE_MathUtils_degToRad(15*(hour-12)); // hour angle
    const sinEl = Math.sin(lat)*Math.sin(decl) + Math.cos(lat)*Math.cos(decl)*Math.cos(H);
    const elevation = Math.asin(Math.max(-1,Math.min(1,sinEl)));
    let cosAz = (Math.sin(decl) - Math.sin(elevation)*Math.sin(lat)) / (Math.cos(elevation)*Math.cos(lat) || 1e-9);
    cosAz = Math.max(-1, Math.min(1, cosAz));
    let azimuth = THREE_MathUtils_radToDeg(Math.acos(cosAz)); // 0..180, symmetric around solar noon
    if (hour > 12) azimuth = 360 - azimuth; // afternoon: sun in the western half
    // convention: 0=N, 90=E, 180=S, 270=W (azimuth above is measured from North already via the formula's sign convention)
    return { elevationDeg: THREE_MathUtils_radToDeg(elevation), azimuthDeg: azimuth };
  },

  /** Which of the four seasons a day-of-year falls in, meteorological (month-based) definition for Northern hemisphere. */
  seasonForDate(date){
    const m = date.getMonth(); // 0=Jan
    if (m===11||m===0||m===1) return 'winter';
    if (m>=2&&m<=4) return 'spring';
    if (m>=5&&m<=7) return 'summer';
    return 'autumn';
  },

  /**
   * Angle-of-incidence factor (0..1): how directly the sun's rays hit a
   * tilted, oriented surface, relative to hitting it dead-on. This is
   * THE mechanism that makes panel placement (section 15) matter:
   * south-facing + ~35-40° tilt (near-optimal for 52°N) scores near 1.0
   * at solar noon; a flat roof loses some peak but gains shoulder hours;
   * a north-facing or near-vertical panel scores very low.
   * tiltDeg: 0=flat/facing straight up, 90=vertical wall.
   * panelAzimuthDeg: compass direction the panel FACES (180=South is ideal in the N hemisphere).
   */
  incidenceFactor(elevationDeg, sunAzimuthDeg, tiltDeg, panelAzimuthDeg){
    if (elevationDeg <= 0) return 0;
    const el = THREE_MathUtils_degToRad(elevationDeg);
    const tilt = THREE_MathUtils_degToRad(tiltDeg);
    const dAz = THREE_MathUtils_degToRad(sunAzimuthDeg - panelAzimuthDeg);
    const cosTheta = Math.sin(el)*Math.cos(tilt) + Math.cos(el)*Math.sin(tilt)*Math.cos(dAz);
    return Math.max(0, cosTheta);
  },
};
/** Tiny local helpers so this file has zero hard dependency on THREE.js being loaded first
 *  (AnalyticsManager/SimulationEngine run this in tight loops long before any scene exists). */
function THREE_MathUtils_degToRad(d){ return d * Math.PI/180; }
function THREE_MathUtils_radToDeg(r){ return r * 180/Math.PI; }
