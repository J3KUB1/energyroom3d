/**
 * SIMULATION ENGINE
 * Owns the simulated clock only. Advances in whole simulated minutes
 * (deterministic, schedule-driven - never random). Decoupled from the
 * THREE.js render loop: the render loop runs every frame regardless,
 * but energy/state recalculation happens only when the clock advances
 * by >= 1 simulated minute. Also integrates PV generation (via
 * SolarCalculator), a home battery's charge/discharge (self-consumption
 * optimization), and tariff-aware cost (via EnergyCalculator),
 * producing a running net-metering balance and a lifetime savings tally.
 * Unity mapping: SimulationManager MonoBehaviour, ticked from Update()
 * with its own accumulator, independent of rendering.
 */
class SimulationEngine {
  constructor({ getInstances, getSolarInstances, getBatteryInstances, getTariff, onMinuteTick, onLog, onDayRollover, automationManager, weatherManager }){
    this.getInstances = getInstances;
    this.getSolarInstances = getSolarInstances || (()=>[]);
    this.getBatteryInstances = getBatteryInstances || (()=>[]);
    this.getTariff = getTariff || (()=>({ mode:'flat', pricePerKWh:1, priceDay:1, priceNight:0.6, nightStart:'22:00', nightEnd:'06:00', cloudFactor:0.15 }));
    this.onMinuteTick = onMinuteTick || (()=>{});
    this.onLog = onLog || (()=>{});
    this.onDayRollover = onDayRollover || (()=>{});
    this.automationManager = automationManager || null;
    this.weatherManager = weatherManager || null;

    this.absMin = 8*60; // start at 08:00 for a natural demo entry point
    this.playing = false;
    this.speed = 1; // simulated minutes per real second
    this._accum = 0;
    this._lastDay = Math.floor(this.absMin/1440);

    this.currentPowerW = 0;      // total consumption, all rooms
    this.currentGenW = 0;        // total PV generation, all rooms
    this.currentBatteryW = 0;    // +charging (draws from surplus) / -discharging (supplies deficit)
    this.hourlyKWh = new Array(24).fill(0);
    this.hourlyGenKWh = new Array(24).fill(0);
    this.todayKWh = 0;           // consumption
    this.todaySolarKWh = 0;      // generation
    this.todayBatteryChargeKWh = 0;
    this.todayBatteryDischargeKWh = 0;
    this.todayCost = 0;          // net cost (tariff aware, generation/battery credited at same rate)
    this.todayKWhByDevice = {};  // instId -> kWh
    this.totalSavedPLN = 0;      // lifetime-of-session running total of "what PV+battery saved you" (never resets)
    this.lastCompletedDay = null; // {consumedKWh, solarKWh, cost} snapshot for "vs yesterday"
    this.powerHistory = []; // {absMin, watts, genWatts} ring buffer, ~last 50h at 10-min resolution
    this._lastSampleMin = -999;

    this._raf = null;
    this._lastTs = null;
  }

  get simDay(){ return Math.floor(this.absMin/1440) % 7; }
  get minuteOfDay(){ return this.absMin % 1440; }
  get clockLabel(){ return ScheduleManager.fromMinutes(this.minuteOfDay); }
  /** Net power actually drawn from (positive) or exported to (negative) the grid, after battery. */
  get netPowerW(){ return this.currentPowerW - this.currentGenW + this.currentBatteryW; }
  get activeWeather(){ return this.weatherManager ? this.weatherManager.active : null; }

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
      this.lastCompletedDay = { consumedKWh: this.todayKWh, solarKWh: this.todaySolarKWh, cost: this.todayCost };
      this.onDayRollover({ todayKWh: this.todayKWh, todayKWhByDevice: {...this.todayKWhByDevice} });
      this.hourlyKWh.fill(0); this.hourlyGenKWh.fill(0);
      this.todayKWh = 0; this.todaySolarKWh = 0; this.todayCost = 0; this.todayKWhByDevice = {};
      this.todayBatteryChargeKWh = 0; this.todayBatteryDischargeKWh = 0;
      if (this.weatherManager) this.weatherManager.maybeTrigger(this.absMin);
    }
    if (this.automationManager) this.automationManager.evaluate(this.absMin);
    this._recomputeInstant(true);
  }

  /** Recompute instantaneous power for all instances at current absMin, accumulate energy/cost for the elapsed minute if accumulate=true */
  _recomputeInstant(accumulate){
    const instances = this.getInstances();
    const tariff = this.getTariff();
    const wx = this.weatherManager ? this.weatherManager.getMultipliers(this.absMin) : { solarMult:1, climateMult:1, heatingMult:1 };
    let total = 0;
    const hour = Math.floor(this.minuteOfDay/60);
    for (const inst of instances){
      const prevState = inst.runtime.state;
      let state, powerW;
      if (inst.manualOverride === 'off'){
        // user's direct power switch always wins - a forced-off device draws nothing, full stop
        state = 'off'; powerW = 0;
      } else if (inst.manualOverride === 'on' && inst.connected){
        state = ScheduleManager.dominantState(inst.def);
        powerW = inst.def.states[state] ?? inst.def.ratedPowerW;
      } else if (inst.manualOverride === 'on' && !inst.connected){
        state = 'off'; powerW = 0; // can't force-on an unplugged device
      } else {
        const override = inst.runtime.automationOverride;
        if (override && inst.def.states[override.state] != null){
          state = override.state; powerW = inst.def.states[state];
        } else {
          ({ state, powerW } = ScheduleManager.resolve(inst, this.absMin));
        }
      }
      // active weather event scales climate/heating demand (storms/gales/heatwaves/cold snaps)
      if (state !== 'off' && state !== 'standby'){
        if (inst.def.category==='climate') powerW *= wx.climateMult;
        else if (inst.def.category==='heating') powerW *= wx.heatingMult;
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

    // ---- Solar generation (negative "power" from the grid's point of view) ----
    let gen = 0;
    const panels = this.getSolarInstances();
    for (const p of panels){
      const w = SolarCalculator.resolve(p, this.absMin, tariff.cloudFactor) * wx.solarMult;
      p.runtime.powerW = -w; // negative = producing
      p.runtime.state = w > 1 ? 'generating' : 'idle';
      gen += w;
      if (accumulate){
        const kwh = EnergyCalculator.wattsMinutesToKWh(w, 1);
        this.todaySolarKWh += kwh;
        this.hourlyGenKWh[hour] += kwh;
      }
    }
    this.currentGenW = gen;

    // ---- Battery: charges from PV surplus, discharges to cover deficit (self-consumption) ----
    const battTotalW = this._resolveBatteries(total - gen, accumulate);
    this.currentBatteryW = battTotalW;

    if (accumulate){
      const rate = EnergyCalculator.priceAt(this.minuteOfDay, tariff);
      const netKw = (total - gen + battTotalW) / 1000;
      const minuteCost = netKw * (1/60) * rate;
      this.todayCost += minuteCost;
      // what it *would* have cost with no PV/battery at all, vs what it actually cost this minute
      const baselineCost = (total/1000) * (1/60) * rate;
      this.totalSavedPLN += Math.max(0, baselineCost - minuteCost);
    }

    if (this.absMin - this._lastSampleMin >= 10){
      this._lastSampleMin = this.absMin;
      this.powerHistory.push({ absMin: this.absMin, watts: total, genWatts: gen });
      if (this.powerHistory.length > 300) this.powerHistory.shift(); // ~50h @10min
    }
    this.onMinuteTick(this);
  }

  /** Distributes `netBeforeBattery` (>0 deficit, <0 surplus, in W) across connected batteries in
   *  sequence. Returns total battery power (+charging / -discharging). Mutates each battery's
   *  state-of-charge (kWh) when accumulate=true - this is genuinely stateful across ticks, unlike
   *  the schedule-driven devices, which is why it can't be folded into the static weekly projection. */
  _resolveBatteries(netBeforeBattery, accumulate){
    let remaining = netBeforeBattery;
    let battTotal = 0;
    for (const b of this.getBatteryInstances()){
      if (!b.connected){ b.runtime.powerW = 0; b.runtime.state = 'off'; continue; }
      const cap = b.def.capacityKWh;
      const eff = b.def.efficiency || 0.92;
      const soc = (b.runtime.socKWh != null) ? b.runtime.socKWh : cap*0.5;
      let chargeW = 0, dischargeW = 0;
      if (remaining < -0.5){ // surplus available -> charge
        const headroomKWh = Math.max(0, cap - soc);
        const maxByHeadroom = headroomKWh * 1000 * 60 / eff; // W - rate that would exactly fill headroom in 1 minute
        chargeW = Math.min(-remaining, b.def.maxChargeW, maxByHeadroom);
        if (accumulate && chargeW > 0.01){
          const energyIn = chargeW/1000/60;
          b.runtime.socKWh = Math.min(cap, soc + energyIn*eff);
          this.todayBatteryChargeKWh += energyIn;
        }
      } else if (remaining > 0.5){ // deficit -> discharge
        const maxByAvailable = soc * 1000 * 60 * eff; // W - rate that would exactly empty soc in 1 minute
        dischargeW = Math.min(remaining, b.def.maxDischargeW, maxByAvailable);
        if (accumulate && dischargeW > 0.01){
          const energyOut = dischargeW/1000/60;
          b.runtime.socKWh = Math.max(0, soc - energyOut/eff);
          this.todayBatteryDischargeKWh += energyOut;
        }
      }
      const netAction = chargeW - dischargeW;
      battTotal += netAction;
      remaining += netAction;
      b.runtime.powerW = netAction;
      b.runtime.state = chargeW>0.01 ? 'charging' : (dischargeW>0.01 ? 'discharging' : 'idle');
      b.runtime.socPct = ((b.runtime.socKWh != null ? b.runtime.socKWh : soc) / cap) * 100;
    }
    return battTotal;
  }
}
