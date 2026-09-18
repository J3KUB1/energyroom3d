/**
 * WEATHER SYSTEM
 * Two independent layers, both rule-based/scripted randomness only -
 * never a forecast, never AI, never "learns":
 *
 *  1) CONTINUOUS SKY CONDITION - a persistent random walk over a single
 *     "cloud index" (0..1), re-targeted once per simulated hour and
 *     smoothly interpolated every simulated minute so it never jumps
 *     (spec section 10: "jeżeli o 12:00 jest pochmurno, o 12:01 nie
 *     powinno nagle być 100% słońca"). The cloud index maps to one of
 *     the seven named conditions the spec lists (bezchmurnie / lekko
 *     zachmurzone / pochmurno / bardzo pochmurno / deszcz / burza /
 *     śnieg - śnieg only possible in the cold half of the year) and
 *     drives PV generation via SolarCalculator.
 *
 *  2) RARE EXTREME EVENTS (unchanged mechanic from the original
 *     WeatherEventManager, kept and extended, not removed) - a daily
 *     dice roll that can start a multi-hour storm/gale/heatwave/cold
 *     snap, seasonally weighted, which scales climate/heating DEVICE
 *     power on top of whatever the sky condition is doing to PV.
 *
 * Unity mapping: WeatherManager MonoBehaviour driven by the same
 * SimulationManager tick as everything else.
 */
const WEATHER_CONDITIONS = [
  { id:'clear',        nameKey:'weather.clear',        icon:'☀️', minIdx:0.00, maxIdx:0.12, minFactor:0.97, maxFactor:1.00 },
  { id:'lightClouds',  nameKey:'weather.lightClouds',   icon:'🌤️', minIdx:0.12, maxIdx:0.34, minFactor:0.80, maxFactor:0.95 },
  { id:'cloudy',       nameKey:'weather.cloudy',        icon:'☁️', minIdx:0.34, maxIdx:0.58, minFactor:0.50, maxFactor:0.80 },
  { id:'overcast',     nameKey:'weather.overcast',      icon:'🌥️', minIdx:0.58, maxIdx:0.80, minFactor:0.20, maxFactor:0.50 },
  { id:'rain',         nameKey:'weather.rain',          icon:'🌧️', minIdx:0.58, maxIdx:0.85, minFactor:0.25, maxFactor:0.50, precip:true },
  { id:'storm',        nameKey:'weather.stormCond',     icon:'⛈️', minIdx:0.80, maxIdx:1.00, minFactor:0.10, maxFactor:0.30, precip:true },
  { id:'snow',         nameKey:'weather.snow',          icon:'🌨️', minIdx:0.58, maxIdx:0.90, minFactor:0.15, maxFactor:0.40, precip:true, coldOnly:true },
];
/** Rough Polish-climate expected sky-condition factor per season, used ONLY by static
 *  week/month/year analytics projections (never by the live random walk) - deterministic,
 *  clearly an assumption, never presented as a real forecast. */
const SEASONAL_AVERAGE_FACTOR = { spring:0.76, summer:0.84, autumn:0.60, winter:0.52 };

const WEATHER_EXTREME_EVENTS = [
  { id:'storm',    nameKey:'weather.event.storm',    descKey:'weather.event.storm.desc',    icon:'⛈', probability:0.07, minH:3,  maxH:8,  solarMult:0.4, climateMult:1.0, heatingMult:1.15, seasons:null },
  { id:'gale',     nameKey:'weather.event.gale',      descKey:'weather.event.gale.desc',      icon:'🌬', probability:0.05, minH:4,  maxH:12, solarMult:0.7, climateMult:1.0, heatingMult:1.35, seasons:null },
  { id:'heatwave', nameKey:'weather.event.heatwave',  descKey:'weather.event.heatwave.desc',  icon:'🥵', probability:0.06, minH:8,  maxH:24, solarMult:1.05,climateMult:1.6, heatingMult:0.2,  seasons:['summer','spring'] },
  { id:'coldsnap', nameKey:'weather.event.coldsnap',  descKey:'weather.event.coldsnap.desc',  icon:'🥶', probability:0.06, minH:8,  maxH:24, solarMult:0.85,climateMult:0.3, heatingMult:1.6,  seasons:['winter','autumn'] },
];

class WeatherSystem {
  constructor({ onLog, onConditionChange, onEventChange, getSimDate } = {}){
    this.onLog = onLog || (()=>{});
    this.onConditionChange = onConditionChange || (()=>{});
    this.onEventChange = onEventChange || (()=>{});
    this.getSimDate = getSimDate || (()=>new Date());

    this.cloudIndex = 0.15;        // current, smoothly interpolated
    this._targetIndex = 0.15;
    this._hourAnchorIndex = 0.15;  // value at the start of the current hour (interpolation source)
    this._lastHourKey = null;
    this.condition = WEATHER_CONDITIONS[0];
    this.factor = 1;               // current PV multiplier actually in effect (0..1)

    this.active = null;            // active extreme event, same shape as before: {id,name,icon,desc,solarMult,climateMult,heatingMult,startAbsMin,endAbsMin}
    this.history = [];
    this._lastEventCheckDay = -1;
  }

  /** Called every simulated minute by SimulationEngine. Cheap: only re-rolls once per simulated hour. */
  tick(absMin){
    const minuteOfDay = absMin % 1440;
    const hourKey = Math.floor(absMin/60);
    if (hourKey !== this._lastHourKey){
      this._lastHourKey = hourKey;
      this._hourAnchorIndex = this.cloudIndex;
      // random-walk step: small most of the time, occasionally a bigger jump (a front moving in)
      const step = (Math.random()-0.5) * (Math.random()<0.12 ? 0.55 : 0.16);
      this._targetIndex = Math.max(0, Math.min(1, this._hourAnchorIndex + step));
    }
    // smooth interpolation across the hour (minute resolution) - never an instant jump
    const minuteInHour = absMin % 60;
    const t = minuteInHour/60;
    this.cloudIndex = this._hourAnchorIndex + (this._targetIndex - this._hourAnchorIndex) * t;
    const prevCondId = this.condition.id;
    this._resolveCondition();
    if (this.condition.id !== prevCondId){
      this.onLog(`${this.condition.icon} ${this._condName(this.condition)}`);
      this.onConditionChange(this.condition, this.factor);
    }

    // ---- rare extreme events: unchanged daily-roll mechanic, seasonally gated ----
    const day = Math.floor(absMin/1440);
    if (day !== this._lastEventCheckDay && minuteOfDay===0){
      this._lastEventCheckDay = day;
      this._maybeTriggerEvent(absMin);
    }
    if (this.active && absMin >= this.active.endAbsMin){
      this.onLog(`Pogoda wraca do normy (koniec: ${this._eventName(this.active)}).`);
      this.active = null;
      this.onEventChange(null);
    }
  }

  _resolveCondition(){
    const season = SunPosition.seasonForDate(this.getSimDate());
    const coldSeason = season==='winter' || season==='autumn';
    // pick the named condition whose [minIdx,maxIdx) band contains cloudIndex; among overlapping
    // bands (rain/snow/storm share the upper range with plain overcast) use a stable per-hour dice
    // roll so it doesn't flicker between "overcast" and "rain" minute to minute.
    const candidates = WEATHER_CONDITIONS.filter(c=>{
      if (c.coldOnly && !coldSeason) return false;
      return this.cloudIndex >= c.minIdx && this.cloudIndex < c.maxIdx + 1e-6;
    });
    let chosen = candidates[0] || WEATHER_CONDITIONS[0];
    if (candidates.length > 1){
      // deterministic-for-this-hour pseudo-pick so the label is stable across the smooth interpolation
      const seed = Math.sin(this._lastHourKey*99991)*10000;
      const frac = seed - Math.floor(seed);
      chosen = candidates[Math.floor(frac*candidates.length)];
    }
    this.condition = chosen;
    // factor is a CONTINUOUS function of cloudIndex within the chosen band (not re-randomized per
    // hour) - this is what actually delivers the "no instant jumps" requirement: since cloudIndex
    // itself is interpolated smoothly minute-to-minute, factor inherits that smoothness directly.
    const span = Math.max(1e-6, chosen.maxIdx - chosen.minIdx);
    const posInBand = Math.max(0, Math.min(1, (this.cloudIndex - chosen.minIdx) / span));
    this.factor = chosen.maxFactor - posInBand * (chosen.maxFactor - chosen.minFactor);
  }

  _maybeTriggerEvent(absMin){
    if (this.active) return;
    const season = SunPosition.seasonForDate(this.getSimDate());
    const eligible = WEATHER_EXTREME_EVENTS.filter(e=>!e.seasons || e.seasons.includes(season));
    let roll = Math.random();
    for (const ev of eligible){
      if (roll < ev.probability){
        const hours = ev.minH + Math.random()*(ev.maxH-ev.minH);
        this.active = { ...ev, startAbsMin: absMin, endAbsMin: absMin + Math.round(hours*60) };
        this.history.unshift(this.active);
        if (this.history.length > 10) this.history.pop();
        this.onLog(`${ev.icon} ${this._eventName(ev)}`);
        this.onEventChange(this.active);
        return;
      }
      roll -= ev.probability;
    }
  }

  _condName(c){ return (typeof I18n!=='undefined') ? I18n.t(c.nameKey) : c.id; }
  _eventName(e){ return (typeof I18n!=='undefined') ? I18n.t(e.nameKey) : e.id; }

  /** Combined multipliers for SimulationEngine: {solarMult, climateMult, heatingMult}.
   *  solarMult combines the continuous sky condition AND any active extreme event;
   *  climate/heating multipliers come only from an active extreme event (1 otherwise). */
  getMultipliers(){
    const eventSolar = this.active ? this.active.solarMult : 1;
    return {
      solarMult: this.factor * eventSolar,
      climateMult: this.active ? this.active.climateMult : 1,
      heatingMult: this.active ? this.active.heatingMult : 1,
      skyFactor: this.factor,
      condition: this.condition,
    };
  }

  /** Deterministic seasonal-average factor for static analytics projections (week/month/year) - never random. */
  static seasonalAverageFactor(season){ return SEASONAL_AVERAGE_FACTOR[season] ?? 0.7; }

  serialize(){ return { cloudIndex:this.cloudIndex, targetIndex:this._targetIndex, active:this.active }; }
  deserialize(data){
    if (!data) return;
    if (typeof data.cloudIndex==='number'){ this.cloudIndex=data.cloudIndex; this._hourAnchorIndex=data.cloudIndex; }
    if (typeof data.targetIndex==='number') this._targetIndex = data.targetIndex;
    this.active = data.active || null;
    this._resolveCondition();
  }
}
