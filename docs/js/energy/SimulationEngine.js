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
 *  - supports a user-chosen, fully ordered 3-slot PV usage priority
 *    (any permutation of Home / Battery / Grid) that changes how PV
 *    output is actually allocated minute by minute, honouring battery
 *    limits, export/import limits, grid outages and PV curtailment;
 *  - reduces every panel's output by its own geometric shading
 *    (ShadeModel: buildings, roofs, trees, other panels);
 *  - accumulates category/room/import/export breakdowns for the
 *    "drill into a number" UI, and keeps a capped day-by-day HISTORY
 *    so weekly/monthly/yearly views can show genuinely-played data
 *    instead of only a forward projection once enough days have run.
 *
 * Unity mapping: SimulationManager MonoBehaviour, ticked from
 * Update() with its own accumulator, independent of rendering.
 */
class SimulationEngine {
  constructor({ getInstances, getSolarInstances, getBatteryInstances, getSettings, getStartDate, onMinuteTick, onLog, onDayRollover, automationManager, weatherManager, electrical }){
    this.electrical = electrical || null;   // ElectricalSystem: circuits, breakers, cables, sockets (Stage 2)
    this.onElectricalEvent = ()=>{};        // trips / cable damage -> main.js (log, toast, pet)
    this.currentLossW = 0;                  // I^2 R heat in the installation's cables (billed energy)
    this.todayLossKWh = 0;
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
    this.gridOnline = true;      // false during a blackout: no import, no export (see section 16 / Etap 6)
    this.currentGenPotentialW = 0; // what the panels COULD deliver (after shading/weather), before curtailment
    this.currentCurtailedW = 0;  // PV that no sink could take this minute (export limit, full battery, grid down)
    this.currentUnservedW = 0;   // load nobody could supply (grid down + battery empty) - drives load shedding
    this.flows = { pvToHome:0, pvToBattery:0, pvToGrid:0, batteryToHome:0, gridToHome:0, curtailed:0, unserved:0 };
    this.todayCurtailedKWh = 0;
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
  get netPowerW(){ return this.currentPowerW - this.currentUnservedW - this.currentGenW + this.currentBatteryW; }
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
    this._bulk = true;   // fast-forward: the installation skips publishing UI-only values every minute
    try { while (this.absMin < target && guard < 60*1440*400){ this._stepOneMinute(); guard++; } }
    finally { this._bulk = false; }
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
    this.todayCurtailedKWh = 0; this.todayLossKWh = 0;
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

    // ---- pass 1: what every device WANTS to draw (schedule / automation / manual switch / weather) ----
    const wanted = new Array(instances.length);
    for (let i = 0; i < instances.length; i++){
      const inst = instances[i];
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
      wanted[i] = { state, powerW };
    }

    // ---- pass 2: the installation decides what actually arrives (sockets, circuits, breakers, cables) ----
    let lossW = 0, elec = null;
    if (this.electrical){
      elec = this.electrical.resolve(instances.map((inst, i) => ({ id:inst.id, desiredW:wanted[i].powerW, connected:inst.connected, plugTo:inst.plugTo })), { accumulate, publish: !this._bulk });
      lossW = elec.lossW;
    }
    this.currentLossW = lossW;

    // ---- pass 3: apply, count, accumulate ----
    for (let i = 0; i < instances.length; i++){
      const inst = instances[i];
      const prevState = inst.runtime.state;
      let { state, powerW } = wanted[i];
      const er = elec ? elec.devices.get(inst.id) : null;
      inst.runtime.powerStatus = er ? er.status : 'ok';
      inst.runtime.voltageV = er ? er.voltageV : 230;
      if (er && er.powerW < powerW - 1e-9){ powerW = er.powerW; if (powerW <= 0) state = 'off'; } // cut by the installation
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
    // cable losses are real energy drawn from the grid: they are part of the household total and the bill
    if (lossW > 0){
      total += lossW;
      if (accumulate){
        const kwh = EnergyCalculator.wattsMinutesToKWh(lossW, 1);
        this.todayKWh += kwh; this.todayLossKWh += kwh;
        this.todayKWhByCategory['installation'] = (this.todayKWhByCategory['installation']||0) + kwh;
        this.hourlyKWh[hour] += kwh;
      }
    }
    this.currentPowerW = total;

    // ---- Solar generation: per-panel potential (incidence x weather x SHADING) ----
    const panels = this.getSolarInstances();
    const doy = this.dayOfYear;
    if (SolarCalculator.shadeModel) SolarCalculator.shadeModel.setSeason(this.season);
    const panelW = new Array(panels.length);
    let pvPotential = 0;
    for (let i = 0; i < panels.length; i++){
      const p = panels[i];
      const d = SolarCalculator.resolveDetailed(p, this.absMin, doy, wx.solarMult);
      panelW[i] = d.w; pvPotential += d.w;
      p.runtime.directAccess = d.direct;   // 0..1 direct-beam access (1 = no shade)
      p.runtime.sunlight = d.sunlight;     // 0..1 effective light incl. diffuse
      p.runtime.potentialW = d.w;
    }
    this.currentGenPotentialW = pvPotential;

    // ---- Allocation of PV between home / battery / grid in the user's 3-slot order ----
    const alloc = this._allocate(total, pvPotential, s, accumulate);
    const gen = Math.max(0, pvPotential - alloc.curtailedW);   // PV actually delivered
    const scale = pvPotential > 0 ? gen / pvPotential : 0;
    for (let i = 0; i < panels.length; i++){
      const p = panels[i];
      const w = panelW[i] * scale;
      p.runtime.powerW = -w; // negative = producing
      p.runtime.state = !p.connected ? 'off' : (w > 1 ? 'generating' : 'idle');
      if (accumulate){
        const kwh = EnergyCalculator.wattsMinutesToKWh(w, 1);
        this.todaySolarKWh += kwh;
        this.hourlyGenKWh[hour] += kwh;
      }
    }
    this.currentGenW = gen;
    this.currentBatteryW = alloc.batteryNetW;
    this.currentCurtailedW = alloc.curtailedW;
    this.currentUnservedW = alloc.unservedW;
    this.flows = alloc.flows;
    if (accumulate) this.todayCurtailedKWh += EnergyCalculator.wattsMinutesToKWh(alloc.curtailedW, 1);
    const battTotalW = alloc.batteryNetW;

    if (accumulate){
      const tariffSchedule = (s.tariffSchedules && s.tariffSchedules[s.tariffCode]) || tariffMeta.buildDefaultSchedule();
      const prices = (s.tariffPrices && s.tariffPrices[s.tariffCode]) || tariffMeta.defaultPrices;
      const rate = TariffManager.priceAt(tariffMeta, prices, tariffSchedule, this.absMin);
      const netW = total - this.currentUnservedW - gen + battTotalW;
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
      this.totalConsumedKWh += EnergyCalculator.wattsMinutesToKWh(total - this.currentUnservedW,1);
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

  /** All 6 orderings of the three PV sinks. */
  static get PV_SINKS(){ return ['home','battery','grid']; }

  /** Normalises a saved/legacy PV priority into a valid 3-slot order.
   *  `order` (array) wins if it is a permutation of home/battery/grid; otherwise the legacy
   *  two-value `pvPriority` maps to: home_first -> home,battery,grid ; battery_first -> battery,home,grid. */
  static normalizePvOrder(order, legacyPriority){
    const sinks = SimulationEngine.PV_SINKS;
    if (Array.isArray(order) && order.length === 3 && sinks.every(x => order.includes(x))) return order.slice();
    if (legacyPriority === 'battery_first') return ['battery','home','grid'];
    return ['home','battery','grid'];
  }

  /**
   * ONE allocator for everything PV/battery/grid related (replaces the previous two-branch
   * home_first / battery_first code; home_first/battery_first are now just two of six orders).
   *
   * PV output is offered to the three sinks in the user's order:
   *   home    - covers the current load
   *   battery - charges connected batteries (power-, headroom- and efficiency-limited)
   *   grid    - exports (capped by the export limit, impossible during a blackout)
   * PV no sink can take is CURTAILED (inverter derates) - never invented, never silently exported.
   * Whatever load PV did not cover is then served by battery discharge (only in a minute in which no
   * battery is charging, down to the reserve SOC) and finally by grid import (capped by the import
   * limit, impossible during a blackout).  Load nobody can serve is reported as `unservedW`.
   * Returns { batteryNetW (+charging/-discharging), curtailedW, unservedW, flows }.
   * Energy balance identity:  grid import - grid export = load - unserved - pvDelivered + batteryNet.
   */
  _allocate(loadW, pvW, s, accumulate){
    const order = SimulationEngine.normalizePvOrder(s.pvOrder, s.pvPriority);
    const gridUp = this.gridOnline !== false;
    const cap = v => (v == null || v === '' || !isFinite(+v)) ? Infinity : Math.max(0, +v);
    const exportCap = gridUp ? cap(s.exportLimitW) : 0;
    const importCap = gridUp ? cap(s.importLimitW) : 0;
    const reserve = Math.max(0, Math.min(90, +s.batteryReservePct || 0)) / 100;

    const infos = [];
    for (const b of this.getBatteryInstances()){
      if (!b.connected || (b.runtime && b.runtime.faulted)){ b.runtime.powerW = 0; b.runtime.state = b.connected ? 'fault' : 'off'; continue; }
      const c = b.def.capacityKWh;
      infos.push({ b, cap:c, eff:b.def.efficiency || 0.92,
        soc:(b.runtime.socKWh != null) ? b.runtime.socKWh : c*0.5,
        maxC:b.def.maxChargeW, maxD:b.def.maxDischargeW, chargeW:0, dischargeW:0 });
    }

    let pvLeft = Math.max(0, pvW), homeNeed = Math.max(0, loadW);
    let pvHome = 0, pvBatt = 0, pvGrid = 0;
    for (const slot of order){
      if (slot === 'home'){
        const x = Math.min(pvLeft, homeNeed); pvHome += x; pvLeft -= x; homeNeed -= x;
      } else if (slot === 'battery'){
        for (const bi of infos){
          if (pvLeft <= 0.5) break;
          const maxByHeadroom = Math.max(0, bi.cap - bi.soc) * 1000 * 60 / bi.eff; // W that would exactly fill the headroom in 1 min
          const c = Math.min(pvLeft, bi.maxC, maxByHeadroom);
          if (c > 0){ bi.chargeW = c; pvLeft -= c; pvBatt += c; }
        }
      } else { // grid
        const x = Math.min(pvLeft, exportCap); pvGrid += x; pvLeft -= x;
      }
    }
    const curtailedW = pvLeft > 0.5 ? pvLeft : 0;

    let deficit = homeNeed, battToHome = 0;
    if (pvBatt <= 0.01 && deficit > 0.5){ // a battery cannot charge and discharge in the same minute
      for (const bi of infos){
        if (deficit <= 0.5) break;
        const maxByAvailable = Math.max(0, bi.soc - reserve*bi.cap) * 1000 * 60 * bi.eff; // W that would exactly reach the reserve in 1 min
        const d = Math.min(deficit, bi.maxD, maxByAvailable);
        if (d > 0){ bi.dischargeW = d; deficit -= d; battToHome += d; }
      }
    }
    const gridToHome = Math.min(deficit, importCap);
    const unservedW = Math.max(0, deficit - gridToHome);

    let battNet = 0;
    for (const bi of infos){
      const net = bi.chargeW - bi.dischargeW;
      if (accumulate){
        if (bi.chargeW > 0.01){
          const energyIn = bi.chargeW/1000/60;
          bi.b.runtime.socKWh = Math.min(bi.cap, bi.soc + energyIn*bi.eff);
          this.todayBatteryChargeKWh += energyIn;
        } else if (bi.dischargeW > 0.01){
          const energyOut = bi.dischargeW/1000/60;
          bi.b.runtime.socKWh = Math.max(0, bi.soc - energyOut/bi.eff);
          this.todayBatteryDischargeKWh += energyOut;
        }
      }
      const socNow = (bi.b.runtime.socKWh != null) ? bi.b.runtime.socKWh : bi.soc;
      bi.b.runtime.powerW = net;
      bi.b.runtime.state = bi.chargeW > 0.01 ? 'charging' : (bi.dischargeW > 0.01 ? 'discharging' : 'idle');
      bi.b.runtime.socPct = (socNow / bi.cap) * 100;
      battNet += net;
    }
    return { batteryNetW: battNet, curtailedW, unservedW,
      flows: { pvToHome:pvHome, pvToBattery:pvBatt, pvToGrid:pvGrid, batteryToHome:battToHome, gridToHome, curtailed:curtailedW, unserved:unservedW } };
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
    this.todayBatteryChargeKWh = 0; this.todayBatteryDischargeKWh = 0; this.todayMorningKWh = 0; this.todayCurtailedKWh = 0; this.todayLossKWh = 0;
    this.hourlyKWh.fill(0); this.hourlyGenKWh.fill(0);
  }
}
