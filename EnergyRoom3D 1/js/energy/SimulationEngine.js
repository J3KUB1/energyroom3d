/**
 * SIMULATION ENGINE
 * Owns the simulated clock only. Advances in whole simulated minutes
 * (deterministic, schedule-driven - never random). Decoupled from the
 * THREE.js render loop: the render loop runs every frame regardless,
 * but energy/state recalculation happens only when the clock advances
 * by >= 1 simulated minute.
 * Unity mapping: SimulationManager MonoBehaviour, ticked from Update()
 * with its own accumulator, independent of rendering.
 */
class SimulationEngine {
  constructor({ getInstances, onMinuteTick, onLog, onDayRollover, automationManager }){
    this.getInstances = getInstances;
    this.onMinuteTick = onMinuteTick || (()=>{});
    this.onLog = onLog || (()=>{});
    this.onDayRollover = onDayRollover || (()=>{});
    this.automationManager = automationManager || null;

    this.absMin = 8*60; // start at 08:00 for a natural demo entry point
    this.playing = false;
    this.speed = 1; // simulated minutes per real second
    this._accum = 0;
    this._lastDay = Math.floor(this.absMin/1440);

    this.currentPowerW = 0;
    this.hourlyKWh = new Array(24).fill(0);
    this.todayKWh = 0;
    this.todayKWhByDevice = {}; // instId -> kWh
    this.powerHistory = []; // {absMin, watts} ring buffer, ~last 24h at 10-min resolution
    this._lastSampleMin = -999;

    this._raf = null;
    this._lastTs = null;
  }

  get simDay(){ return Math.floor(this.absMin/1440) % 7; }
  get minuteOfDay(){ return this.absMin % 1440; }
  get clockLabel(){ return ScheduleManager.fromMinutes(this.minuteOfDay); }

  play(){
    if (this.playing) return;
    this.playing = true;
    this._lastTs = null;
    this._raf = requestAnimationFrame(this._loop.bind(this)); // must go through rAF so `ts` is a real timestamp
    this.onLog('Symulacja wystartowała');
  }
  pause(){ this.playing = false; if (this._raf) cancelAnimationFrame(this._raf); this.onLog('Symulacja zatrzymana'); }
  toggle(){ this.playing ? this.pause() : this.play(); }
  setSpeed(mult){ this.speed = mult; this.onLog(`Prędkość symulacji: ${mult}x`); }

  skipTo(hhmm){
    const target = ScheduleManager.toMinutes(hhmm);
    const dayBase = Math.floor(this.absMin/1440)*1440;
    let newAbs = dayBase + target;
    if (newAbs < this.absMin) newAbs += 1440; // move forward only
    while (this.absMin < newAbs) this._stepOneMinute();
    this.onLog(`Przewinięto do ${hhmm}`);
  }

  reset(){
    this.absMin = 8*60; this._lastDay = Math.floor(this.absMin/1440);
    this.hourlyKWh.fill(0); this.todayKWh = 0; this.todayKWhByDevice = {};
    this.powerHistory = []; this._lastSampleMin = -999;
    this._recomputeInstant();
  }

  _loop(ts){
    if (!this.playing) return;
    if (this._lastTs == null) this._lastTs = ts;
    const dtSec = Math.min((ts - this._lastTs)/1000, 0.25); // clamp huge tab-switch gaps
    this._lastTs = ts;
    this._accum += dtSec * this.speed;
    let steps = 0;
    while (this._accum >= 1 && steps < 5000){ // safety cap per frame
      this._stepOneMinute();
      this._accum -= 1;
      steps++;
    }
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  _stepOneMinute(){
    this.absMin += 1;
    const day = Math.floor(this.absMin/1440);
    if (day !== this._lastDay){
      this._lastDay = day;
      this.onDayRollover({ todayKWh: this.todayKWh, todayKWhByDevice: {...this.todayKWhByDevice} });
      this.hourlyKWh.fill(0); this.todayKWh = 0; this.todayKWhByDevice = {};
    }
    if (this.automationManager) this.automationManager.evaluate(this.absMin);
    this._recomputeInstant(true);
  }

  /** Recompute instantaneous power for all instances at current absMin, accumulate energy for the elapsed minute if accumulate=true */
  _recomputeInstant(accumulate){
    const instances = this.getInstances();
    let total = 0;
    const hour = Math.floor(this.minuteOfDay/60);
    for (const inst of instances){
      const prevState = inst.runtime.state;
      let state, powerW;
      const override = inst.runtime.automationOverride;
      if (override && inst.def.states[override.state] != null){
        state = override.state; powerW = inst.def.states[state];
      } else {
        ({ state, powerW } = ScheduleManager.resolve(inst, this.absMin));
      }
      inst.runtime.state = state;
      inst.runtime.powerW = powerW;
      total += powerW;
      // track continuous-state duration (for alerts: "running for N hours")
      const isActive = state !== 'off' && state !== 'standby';
      inst.runtime.continuousOnMinutes = (isActive && prevState===state) ? (inst.runtime.continuousOnMinutes||0)+1 : (isActive?1:0);
      inst.runtime.standbyMinutes = (state==='standby') ? (inst.runtime.standbyMinutes||0)+1 : 0;
      if (accumulate){
        const kwh = EnergyCalculator.wattsMinutesToKWh(powerW, 1);
        this.todayKWh += kwh;
        this.todayKWhByDevice[inst.id] = (this.todayKWhByDevice[inst.id]||0) + kwh;
        this.hourlyKWh[hour] += kwh;
        inst.stats.energyYearKWh += kwh; // running lifetime-of-session accumulator
      }
      if (accumulate && prevState !== state){
        this.onLog(`${inst.customName||inst.def.name} → ${state}`);
      }
    }
    this.currentPowerW = total;
    if (this.absMin - this._lastSampleMin >= 10){
      this._lastSampleMin = this.absMin;
      this.powerHistory.push({ absMin: this.absMin, watts: total });
      if (this.powerHistory.length > 300) this.powerHistory.shift(); // ~50h @10min
    }
    this.onMinuteTick(this);
  }
}
