/**
 * SIMULATION ENGINE
 * Owns the simulated clock (advances in whole simulated minutes,
 * deterministic and schedule-driven except for the weather layer,
 * which is scripted randomness with continuity - never a black box).
 * Decoupled from the THREE.js render loop.
 *
 * Beyond the original single global tariff/cloud model, this version:
 *  - tracks a real calendar date (`simDate`) so day-of-week AND
 *    day-of-year/season are both genuine, not just an arbitrary
 *    "day 0..6" counter - this is what lets schedules bind to real
 *    weekdays and PV generation genuinely vary by season;
 *  - prices every minute through TariffManager (G11/G12/G12w/G13,
 *    each with its own user-editable rate schedule) instead of a
 *    single flat/dual switch;
 *  - ticks WeatherSystem every simulated minute (continuous sky
 *    condition) in addition to its daily extreme-event roll;
 *  - supports a user-chosen PV usage priority (home-first vs
 *    battery-first) that changes how surplus PV is actually
 *    allocated, not just relabels the same numbers;
 *  - accumulates category/room/import/export breakdowns for the
 *    "drill into a number" UI, and keeps a capped day-by-day HISTORY
 *    so weekly/monthly/yearly views can show genuinely-played data
 *    instead of only a forward projection once enough days have run.
 *
 * Unity mapping: SimulationManager MonoBehaviour, ticked from
 * Update() with its own accumulator, independent of rendering.
 */
class SimulationEngine {
  constructor({ getInstances, getSolarInstances, getBatteryInstances, getSettings, getStartDate, onMinuteTick, onLog, onDayRollover, automationManager, weatherManager }){
    this.getInstances = getInstances;
    this.getSolarInstances = getSolarInstances || (()=>[]);
    this.getBatteryInstances = getBatteryInstances || (()=>[]);
    this.getSettings = getSettings || (()=>({ ...DEFAULT_ENERGY_SETTINGS }));
    this.getStartDate = getStartDate || (()=>new Date());
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
    this._cachedSimDate = null; this._cachedSimDateDay = null;
    this._refSunday = null; // the real Sunday on/before getStartDate() - see _syncCalendarEpoch()
    this._syncCalendarEpoch();

    this.currentPowerW = 0;      // total consumption, all rooms
    this.currentGenW = 0;        // total PV generation, all rooms
    this.currentBatteryW = 0;    // +charging (draws from surplus) / -discharging (supplies deficit)
    this.hourlyKWh = new Array(24).fill(0);
    this.hourlyGenKWh = new Array(24).fill(0);
    this.todayKWh = 0;           // consumption
    this.todaySolarKWh = 0;      // generation
    this.todayMorningKWh = 0;    // consumption between 06:00-09:00 - feeds the "frugal morning" quest
    this.todayImportKWh = 0;     // drawn from the grid
    this.todayExportKWh = 0;     // sent to the grid
    this.todayBatteryChargeKWh = 0;
    this.todayBatteryDischargeKWh = 0;
    this.todayCost = 0;          // net cost (tariff aware, generation/battery credited at same rate)
    this.todayKWhByDevice = {};  // instId -> kWh
    this.todayKWhByCategory = {};// device category -> kWh
    this.todayKWhByRoom = {};    // roomId -> kWh
    this.totalSavedPLN = 0;      // lifetime-of-session running total of "what PV+battery saved you" (never resets)
    this.totalImportKWh = 0; this.totalExportKWh = 0; this.totalConsumedKWh = 0; this.totalSolarKWh = 0; // lifetime-of-session
    this.lastCompletedDay = null; // {consumedKWh, solarKWh, importKWh, exportKWh, cost} snapshot for "vs yesterday"
    this.powerHistory = []; // {absMin, watts, genWatts} ring buffer, ~last 50h at 10-min resolution
    this._lastSampleMin = -999;
    this.history = [];      // capped day-by-day ledger of ACTUALLY SIMULATED days - {dayIndex,dateISO,consumedKWh,solarKWh,importKWh,exportKWh,cost,byCategory}
    this.HISTORY_CAP = 400;

    this._raf = null;
    this._lastTs = null;
  }

  /**
   * CRITICAL for section 3's "exact days" requirement: ScheduleManager resolves a device's
   * day-of-week purely as `floor(absMin/1440) % 7` (0=Sun..6=Sat) - it has no calendar
   * awareness at all. For a schedule authored as "Monday 09:00-17:00" to actually fire on
   * the real, calendar-correct Monday, `floor(absMin/1440) % 7` must equal `simDate.getDay()`
   * for every simulated day. That only happens automatically if the simulation's absMin
   * epoch (absMin=0) lines up with a real Sunday - which it won't for most chosen start
   * dates. This method re-anchors absMin's day-count to the actual start weekday and
   * records the real Sunday on/before the start date, so simDate can be derived from that
   * same anchor: both sequences then increment in lockstep and stay equal forever, for any
   * start date. Called once at construction and again whenever the effective start date
   * changes (loading a different project, starting a new simulation, resetting).
   */
  _syncCalendarEpoch(){
    const sd = this.getStartDate();
    const startWeekday = sd.getDay(); // 0=Sun..6=Sat
    const refSun = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate());
    refSun.setDate(refSun.getDate() - startWeekday);
    this._refSunday = refSun;
    // re-anchor absMin's day-count component to the real start weekday, preserving the
    // time-of-day and any elapsed minutes already accumulated within the current day
    const minuteOfDay = this.absMin % 1440;
    this.absMin = startWeekday*1440 + minuteOfDay;
    this._lastDay = Math.floor(this.absMin/1440);
    this._cachedSimDate = null; this._cachedSimDateDay = null;
  }

  /** Real calendar date this simulated day corresponds to (project start date + elapsed simulated days). Cached per sim-day. */
  get simDate(){
    const dayIdx = Math.floor(this.absMin/1440);
    if (this._cachedSimDate == null || this._cachedSimDateDay !== dayIdx){
      const d = new Date(this._refSunday.getTime());
      d.setDate(d.getDate() + dayIdx);
      this._cachedSimDate = d;
      this._cachedSimDateDay = dayIdx;
    }
    return this._cachedSimDate;
  }
  get simDayIndex(){ return Math.floor(this.absMin/1440); }
  /** 0=Sunday..6=Saturday, now the REAL weekday of the simulated calendar date (not an arbitrary offset). */
  get simDay(){ return this.simDate.getDay(); }
  get dayOfYear(){ return SunPosition.dayOfYear(this.simDate); }
  get season(){ return SunPosition.seasonForDate(this.simDate); }
  get minuteOfDay(){ return this.absMin % 1440; }
  get clockLabel(){ return ScheduleManager.fromMinutes(this.minuteOfDay); }
  /** Net power actually drawn from (positive) or exported to (negative) the grid, after battery. */
  get netPowerW(){ return this.currentPowerW - this.currentGenW + this.currentBatteryW; }
  get activeWeather(){ return this.weatherManager ? this.weatherManager.active : null; }
  get skyCondition(){ return this.weatherManager ? this.weatherManager.condition : null; }

  play(){
    if (this.playing) return;
    this.playing = true;
    this._lastTs = null;
    this._raf = requestAnimationFrame(this._loop.bind(this)); // must go through rAF so `ts` is a real timestamp
    this.onLog(I18n.t('log.simStarted'));
  }
  pause(){ this.playing = false; if (this._raf) cancelAnimationFrame(this._raf); this.onLog(I18n.t('log.simPaused')); }
  toggle(){ this.playing ? this.pause() : this.play(); }
  setSpeed(mult){ this.speed = mult; this.onLog(I18n.t('log.simSpeed', { mult })); }

  skipTo(hhmm){
    const target = ScheduleManager.toMinutes(hhmm);
    const dayBase = Math.floor(this.absMin/1440)*1440;
    let newAbs = dayBase + target;
    if (newAbs < this.absMin) newAbs += 1440; // move forward only
    while (this.absMin < newAbs) this._stepOneMinute();
    this._recomputeInstant(false);
    this.onLog(I18n.t('log.skippedTo', { time: hhmm }));
  }
  /** Skip forward a whole number of simulated days (e.g. jump a week ahead) - used by the "fast forward" stats helper. */
  skipDays(n){
    const target = this.absMin + n*1440;
    let guard = 0;
    while (this.absMin < target && guard < 60*1440*400){ this._stepOneMinute(); guard++; }
    this._recomputeInstant(false);
  }

  _loop(ts){
    if (!this.playing) return;
    if (this._lastTs == null) this._lastTs = ts;
    const dtSec = Math.min((ts - this._lastTs)/1000, 0.25); // clamp huge tab-switch gaps
    this._lastTs = ts;
    this._accum += dtSec * this.speed;
    let steps = 0;
    while (this._accum >= 1 && steps < 8000){ // safety cap per frame
      this._stepOneMinute();
      this._accum -= 1;
      steps++;
    }
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  _stepOneMinute(){
    this.absMin += 1;
    if (this.weatherManager) this.weatherManager.tick(this.absMin);
    const day = Math.floor(this.absMin/1440);
    if (day !== this._lastDay){
      this._lastDay = day;
      this._rolloverDay();
    }
    if (this.automationManager) this.automationManager.evaluate(this.absMin);
    this._recomputeInstant(true);
  }

  _rolloverDay(){
    // the date just completed is "yesterday" relative to the new simDate
    const finishedDate = new Date(this.simDate.getTime()); finishedDate.setDate(finishedDate.getDate()-1);
    const entry = {
      dayIndex: this._lastDay-1, dateISO: finishedDate.toISOString().slice(0,10),
      consumedKWh: this.todayKWh, solarKWh: this.todaySolarKWh,
      importKWh: this.todayImportKWh, exportKWh: this.todayExportKWh,
      cost: this.todayCost, byCategory: { ...this.todayKWhByCategory },
      morningKWh: this.todayMorningKWh,
    };
    this.history.push(entry);
    if (this.history.length > this.HISTORY_CAP) this.history.shift();
    this.lastCompletedDay = { consumedKWh: this.todayKWh, solarKWh: this.todaySolarKWh, importKWh: this.todayImportKWh, exportKWh: this.todayExportKWh, cost: this.todayCost, byDevice: {...this.todayKWhByDevice}, byCategory: {...this.todayKWhByCategory} };
    this.onDayRollover({ todayKWh: this.todayKWh, todayKWhByDevice: {...this.todayKWhByDevice}, entry });
    this.hourlyKWh.fill(0); this.hourlyGenKWh.fill(0);
    this.todayKWh = 0; this.todaySolarKWh = 0; this.todayCost = 0; this.todayKWhByDevice = {};
    this.todayKWhByCategory = {}; this.todayKWhByRoom = {};
    this.todayImportKWh = 0; this.todayExportKWh = 0;
    this.todayBatteryChargeKWh = 0; this.todayBatteryDischargeKWh = 0;
    this.todayMorningKWh = 0;
  }

  /** Recompute instantaneous power for all instances at current absMin, accumulate energy/cost for the elapsed minute if accumulate=true */
  _recomputeInstant(accumulate){
    const instances = this.getInstances();
    const s = this.getSettings();
    const tariffMeta = TariffManager.get(s.tariffCode);
    const wx = this.weatherManager ? this.weatherManager.getMultipliers() : { solarMult:1, climateMult:1, heatingMult:1 };
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
        if (hour>=6 && hour<9) this.todayMorningKWh += kwh;
        this.todayKWhByDevice[inst.id] = (this.todayKWhByDevice[inst.id]||0) + kwh;
        this.todayKWhByCategory[inst.def.category] = (this.todayKWhByCategory[inst.def.category]||0) + kwh;
        this.todayKWhByRoom[inst.roomId] = (this.todayKWhByRoom[inst.roomId]||0) + kwh;
        this.hourlyKWh[hour] += kwh;
        inst.stats.energyYearKWh += kwh; // running lifetime-of-session accumulator
      }
      if (accumulate && prevState !== state){
        this.onLog(I18n.t('log.deviceStateChange', { name: inst.customName||inst.def.name, state: I18n.deviceState(state) }));
      }
    }
    this.currentPowerW = total;

    // ---- Solar generation ----
    let gen = 0;
    const panels = this.getSolarInstances();
    const doy = this.dayOfYear;
    for (const p of panels){
      const w = SolarCalculator.resolve(p, this.absMin, doy, wx.solarMult);
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

    // ---- Battery: allocation depends on the user's chosen PV-usage priority (section 6) ----
    const battTotalW = this._resolvePVAllocation(total, gen, s.pvPriority, accumulate);
    this.currentBatteryW = battTotalW;

    if (accumulate){
      const tariffSchedule = (s.tariffSchedules && s.tariffSchedules[s.tariffCode]) || tariffMeta.buildDefaultSchedule();
      const prices = (s.tariffPrices && s.tariffPrices[s.tariffCode]) || tariffMeta.defaultPrices;
      const rate = TariffManager.priceAt(tariffMeta, prices, tariffSchedule, this.absMin);
      const netW = total - gen + battTotalW;
      const netKw = netW / 1000;
      let minuteCost;
      if (netW >= 0){
        minuteCost = netKw * (1/60) * rate; // importing - full tariff rate
      } else {
        const exportRate = s.exportPricePerKWh != null ? s.exportPricePerKWh : rate;
        minuteCost = netKw * (1/60) * exportRate; // exporting surplus - separate (usually lower) settlement price; negative x rate = credit
      }
      this.todayCost += minuteCost;
      if (netW > 0) this.todayImportKWh += EnergyCalculator.wattsMinutesToKWh(netW, 1);
      else this.todayExportKWh += EnergyCalculator.wattsMinutesToKWh(-netW, 1);
      // what it *would* have cost with no PV/battery at all, vs what it actually cost this minute
      const baselineCost = (total/1000) * (1/60) * rate;
      this.totalSavedPLN += Math.max(0, baselineCost - minuteCost);
      this.totalConsumedKWh += EnergyCalculator.wattsMinutesToKWh(total,1);
      this.totalSolarKWh += EnergyCalculator.wattsMinutesToKWh(gen,1);
      if (netW>0) this.totalImportKWh += EnergyCalculator.wattsMinutesToKWh(netW,1);
      else this.totalExportKWh += EnergyCalculator.wattsMinutesToKWh(-netW,1);
    }

    if (this.absMin - this._lastSampleMin >= 10){
      this._lastSampleMin = this.absMin;
      this.powerHistory.push({ absMin: this.absMin, watts: total, genWatts: gen });
      if (this.powerHistory.length > 300) this.powerHistory.shift(); // ~50h @10min
    }
    this.onMinuteTick(this);
  }

  /**
   * Allocates PV production between home/battery/grid according to the user's chosen
   * priority (section 6). 'home_first' (default) reproduces the original always-optimize
   * self-consumption behaviour unchanged. 'battery_first' lets the battery claim PV output
   * even while the home still has an unmet need, which is a genuinely different outcome:
   * the home's remaining deficit is then covered by the grid THIS MINUTE rather than by
   * battery discharge (a battery can't simultaneously charge and discharge).
   * Either branch returns net battery power (+charging/-discharging); the grid balance
   * (this.netPowerW = total - gen + battery) is a plain energy-conservation identity that
   * holds no matter which branch ran, so callers never need to know which mode is active.
   */
  _resolvePVAllocation(loadW, genW, priority, accumulate){
    if (priority === 'battery_first'){
      return this._chargeBatteriesFromPV(genW, accumulate);
    }
    return this._resolveBatteries(loadW - genW, accumulate);
  }

  /** 'battery_first' mode: batteries draw straight from gross PV output, in sequence, before home gets any of it. */
  _chargeBatteriesFromPV(pvAvailableW, accumulate){
    let pvLeft = Math.max(0, pvAvailableW);
    let battTotal = 0;
    for (const b of this.getBatteryInstances()){
      if (!b.connected){ b.runtime.powerW = 0; b.runtime.state = 'off'; continue; }
      const cap = b.def.capacityKWh;
      const eff = b.def.efficiency || 0.92;
      const soc = (b.runtime.socKWh != null) ? b.runtime.socKWh : cap*0.5;
      const headroomKWh = Math.max(0, cap - soc);
      const maxByHeadroom = headroomKWh * 1000 * 60 / eff;
      const chargeW = Math.min(pvLeft, b.def.maxChargeW, maxByHeadroom);
      if (accumulate && chargeW > 0.01){
        const energyIn = chargeW/1000/60;
        b.runtime.socKWh = Math.min(cap, soc + energyIn*eff);
        this.todayBatteryChargeKWh += energyIn;
      }
      pvLeft -= chargeW;
      battTotal += chargeW;
      b.runtime.powerW = chargeW;
      b.runtime.state = chargeW>0.01 ? 'charging' : 'idle';
      b.runtime.socPct = ((b.runtime.socKWh != null ? b.runtime.socKWh : soc) / cap) * 100;
    }
    return battTotal;
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

  // ---------------- persistence (session progress, not just the house layout) ----------------
  serializeProgress(){
    return {
      absMin: this.absMin, totalSavedPLN: this.totalSavedPLN,
      totalImportKWh: this.totalImportKWh, totalExportKWh: this.totalExportKWh,
      totalConsumedKWh: this.totalConsumedKWh, totalSolarKWh: this.totalSolarKWh,
      history: this.history,
    };
  }
  deserializeProgress(data){
    this._syncCalendarEpoch(); // recompute for the (possibly different) project's start date BEFORE restoring absMin
    if (!data) return;
    if (typeof data.absMin === 'number') { this.absMin = data.absMin; this._lastDay = Math.floor(this.absMin/1440); this._cachedSimDate=null; this._cachedSimDateDay=null; }
    this.totalSavedPLN = data.totalSavedPLN||0;
    this.totalImportKWh = data.totalImportKWh||0; this.totalExportKWh = data.totalExportKWh||0;
    this.totalConsumedKWh = data.totalConsumedKWh||0; this.totalSolarKWh = data.totalSolarKWh||0;
    this.history = Array.isArray(data.history) ? data.history.slice(-this.HISTORY_CAP) : [];
  }
  /** Full clock+lifetime-stats reset, used by "New project"/"Reset simulation" (section 28/29). */
  resetProgress(){
    this.absMin = 8*60;
    this._syncCalendarEpoch(); // re-anchors to the (possibly new) start date and re-derives _lastDay
    this.totalSavedPLN = 0; this.totalImportKWh = 0; this.totalExportKWh = 0;
    this.totalConsumedKWh = 0; this.totalSolarKWh = 0;
    this.history = []; this.lastCompletedDay = null; this.powerHistory = []; this._lastSampleMin = -999;
    this.todayKWh = 0; this.todaySolarKWh = 0; this.todayImportKWh = 0; this.todayExportKWh = 0;
    this.todayCost = 0; this.todayKWhByDevice = {}; this.todayKWhByCategory = {}; this.todayKWhByRoom = {};
    this.todayBatteryChargeKWh = 0; this.todayBatteryDischargeKWh = 0; this.todayMorningKWh = 0;
    this.hourlyKWh.fill(0); this.hourlyGenKWh.fill(0);
  }
}
