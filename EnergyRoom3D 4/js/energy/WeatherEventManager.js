/**
 * WEATHER EVENT MANAGER
 * Rolls a random chance once per simulated day to start a temporary
 * weather event (storm, gale, heatwave, cold snap). While active, it
 * scales PV generation and climate/heating device power via simple
 * multipliers - deterministic rule-based scaling, not a forecast and
 * not AI: just scripted randomness, exactly like the spec asks for.
 * Unity mapping: WeatherManager MonoBehaviour driven by the same
 * SimulationManager tick as everything else.
 */
const WEATHER_EVENTS = [
  { id:'storm',    name:'Burza',        icon:'⛈', probability:0.08, minH:3,  maxH:8,
    solarMult:0.15, climateMult:1.0, heatingMult:1.15,
    desc:'Gęste chmury burzowe mocno ograniczają produkcję paneli PV.' },
  { id:'gale',     name:'Wichura',      icon:'🌬', probability:0.06, minH:4,  maxH:12,
    solarMult:0.55, climateMult:1.0, heatingMult:1.35,
    desc:'Silny wiatr zwiększa straty ciepła przez ściany i okna.' },
  { id:'heatwave', name:'Fala upałów',  icon:'🥵', probability:0.05, minH:8,  maxH:24,
    solarMult:1.05, climateMult:1.6, heatingMult:0.2,
    desc:'Wysoka temperatura - klimatyzacja pracuje znacznie mocniej.' },
  { id:'coldsnap', name:'Mróz',         icon:'🥶', probability:0.05, minH:8,  maxH:24,
    solarMult:0.6,  climateMult:0.3, heatingMult:1.6,
    desc:'Silny mróz - ogrzewanie zużywa znacznie więcej energii.' },
];

class WeatherEventManager {
  constructor({ onLog, onEventChange } = {}){
    this.onLog = onLog || (()=>{});
    this.onEventChange = onEventChange || (()=>{});
    this.active = null; // {id,name,icon,desc,solarMult,climateMult,heatingMult,startAbsMin,endAbsMin}
    this.history = []; // last few events, for a little "storm log" if ever shown
  }

  /** Call once per simulated day (on day rollover). Rule-based RNG only - never learns, never adapts. */
  maybeTrigger(absMin){
    if (this.active) return;
    let roll = Math.random();
    for (const ev of WEATHER_EVENTS){
      if (roll < ev.probability){
        const hours = ev.minH + Math.random()*(ev.maxH-ev.minH);
        this.active = { ...ev, startAbsMin: absMin, endAbsMin: absMin + Math.round(hours*60) };
        this.history.unshift(this.active);
        if (this.history.length > 10) this.history.pop();
        this.onLog(`${ev.icon} ${ev.name} — ${ev.desc}`);
        this.onEventChange(this.active);
        return;
      }
      roll -= ev.probability;
    }
  }

  /** Expire the active event once its window passes; returns current multipliers either way. */
  getMultipliers(absMin){
    if (this.active && absMin >= this.active.endAbsMin){
      this.onLog(`Pogoda wraca do normy (koniec: ${this.active.name}).`);
      this.active = null;
      this.onEventChange(null);
    }
    if (!this.active) return { solarMult:1, climateMult:1, heatingMult:1 };
    return this.active;
  }

  /** For save/load - only the active event matters, history is cosmetic and not worth persisting. */
  serialize(){ return this.active; }
  deserialize(data){ this.active = data || null; }
}
