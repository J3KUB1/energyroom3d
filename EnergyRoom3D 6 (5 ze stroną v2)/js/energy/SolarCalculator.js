/**
 * SOLAR CALCULATOR
 * Deterministic, schedule-free power model for PV panels: a smooth
 * bell curve between sunrise/sunset, scaled by peak panel power and a
 * configurable cloud factor. Not weather-accurate, but consistent and
 * clearly labelled as a simulation assumption (never presented as a
 * real irradiance forecast).
 * Unity mapping: SolarSystem static utility, mirrors EnergySystem.
 */
const SolarCalculator = {
  SUNRISE: 6, SUNSET: 20, // simplified fixed daylight window (matches SceneManager's day/night cycle)

  /** 0..1 shape of daylight intensity across the day, peaking at solar noon */
  sunFactor(hour){
    if (hour <= this.SUNRISE || hour >= this.SUNSET) return 0;
    const span = this.SUNSET - this.SUNRISE;
    const x = (hour - this.SUNRISE) / span; // 0..1
    return Math.pow(Math.sin(Math.PI * x), 1.3); // slightly peaked bell curve
  },

  /** Returns generated watts (positive number = production) for one panel instance at absMin. */
  resolve(panelInst, absMin, cloudFactor){
    if (!panelInst.connected) return 0;
    const hour = (absMin % 1440) / 60;
    const base = panelInst.def.peakPowerW * this.sunFactor(hour);
    const clouds = 1 - Math.min(0.9, Math.max(0, cloudFactor ?? 0.15));
    return Math.max(0, base * clouds);
  },
};
