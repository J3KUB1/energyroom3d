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
  constructor({ getInstances, getSolarInstances, getBatteryInstances, getSettings, getStartDate, getBuilding, onMinuteTick, onLog, onDayRollover, automationManager, weatherManager, electrical }){
    this.electrical = electrical || null;   // ElectricalSystem: circuits, breakers, cables, sockets (Stage 2)
    this.getBuilding = getBuilding || (()=>null);
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
    this._startAbsMin=this.absMin;

    this.currentPowerW = 0;      // total consumption, all rooms
    this.maxObservedPowerW=0; this.overloadMinutes=0; this.electricalTripCount=0;this.gridOfflineMinutes=0;this.currentOutageMinutes=0;this.longestOutageMinutes=0;
    this.roomTemperatures={}; this.comfortPct=100;
    this.currentGenW = 0;        // total PV generation, all rooms
    this.currentBatteryW = 0;    // +charging (draws from surplus) / -discharging (supplies deficit)
    this.gridOnline = true;      // false during a blackout: no import, no export (see section 16 / Etap 6)
    this.currentGenPotentialW = 0; // what the panels COULD deliver (after shading/weather), before curtailment
    this.currentCurtailedW = 0;  // PV that no sink could take this minute (export limit, full battery, grid down)
    this.currentUnservedW = 0;   // load nobody could supply (grid down + battery empty) - drives load shedding
    this.totalUnservedKWh = 0;
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
    this.totalBatteryChargeKWh=0;this.totalBatteryDischargeKWh=0;
    this.todayCost = 0;          // net cost (tariff aware, generation/battery credited at same rate)
    this.totalCostZl=0;          // cumulative net energy cost across the saved simulation
    this.todayKWhByDevice = {};  // instId -> kWh
    this.todayKWhByCategory = {};// device category -> kWh
    this.todayKWhByRoom = {};    // roomId -> kWh
    this.evGridCostZl = 0;
    this.totalEvCostZl=0;
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
    if(!this.gridOnline){this.gridOfflineMinutes++;this.currentOutageMinutes++;this.longestOutageMinutes=Math.max(this.longestOutageMinutes,this.currentOutageMinutes);}else this.currentOutageMinutes=0;
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
      cost: this.todayCost, batteryChargeKWh:this.todayBatteryChargeKWh,batteryDischargeKWh:this.todayBatteryDischargeKWh,byCategory: { ...this.todayKWhByCategory },
      evCostZl:this.evGridCostZl,
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
    this.evGridCostZl=0;
    for(const inst of this.getInstances()) if(inst.ev){ inst.ev.todayKWh=0; inst.ev.todayCostZl=0; }
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
        const realism=s.realismMode||'arcade',weatherWeight=realism==='realistic'?1:realism==='educational'?.5:0;
        if (inst.def.category==='climate') powerW *= 1+(wx.climateMult-1)*weatherWeight;
        else if (inst.def.category==='heating') powerW *= 1+(wx.heatingMult-1)*weatherWeight;
        const roomTemp=this.roomTemperatures[inst.roomId]??20;
        if(realism!=='arcade'&&inst.def.category==='heating') powerW*=1+weatherWeight*(Math.max(.55,Math.min(2.5,.7+Math.max(0,20-roomTemp)*.14))-1);
        if(realism!=='arcade'&&inst.def.category==='climate') powerW*=1+weatherWeight*(Math.max(.55,Math.min(2.2,.65+Math.max(0,roomTemp-24)*.12))-1);
        if(realism!=='arcade'&&inst.def.category==='lighting'&&this.minuteOfDay>=7*60&&this.minuteOfDay<18*60) powerW*=1+weatherWeight*Math.max(0,.75-(wx.skyFactor??1))*.22;
      }
      if(typeof HomeEnergyManager!=='undefined') powerW=HomeEnergyManager.devicePower(inst,powerW,state,s);
      wanted[i] = { state, powerW };
    }

    // EV wallboxes are still ordinary household loads. Their battery state and
    // charging limits only shape that load; the normal installation and the
    // single household PV/battery/grid allocator remain the source of truth.
    const baseLoadW = wanted.reduce((sum,w,i)=>sum+(instances[i].ev?0:w.powerW),0);
    let evPowerHeadroom=s.importLimitW==null?Infinity:Math.max(0,+s.importLimitW-baseLoadW);
    const batteryAvailableW = this.getBatteryInstances().reduce((sum,b)=>{
      if(!b.connected) return sum;
      const expansion=typeof HomeEnergyManager!=='undefined'?HomeEnergyManager.batteryCapacityFactor(s):1;
      const cap=b.def.capacityKWh*expansion*Math.max(.5,Math.min(1,(b.storage?.sohPct??100)/100)),reserve=Math.max(+s.batteryReservePct||0,b.storage?.reservePct||0,b.storage?.mode==='backup'?30:0)/100;
      const soc=Math.min(cap,Math.max(0,b.runtime.socKWh??cap*.5));
      return sum+Math.min(Math.min(b.storage?.maxDischargeW??b.def.maxDischargeW,b.def.maxDischargeW),Math.max(0,(soc-reserve*cap)*60000*(b.def.efficiency||.92)));
    },0);
    let evGridW=0, evBatteryW=0;
    for(let i=0;i<instances.length;i++){
      const inst=instances[i], ev=inst.ev; if(!ev) continue;
      const scheduled=ScheduleManager.activeIntervalAt(inst.schedule,this.absMin).active;
      const chargingAllowed=inst.connected && (inst.manualOverride==='on'||(inst.manualOverride!=='off'&&scheduled));
      const headroomW=Math.max(0,(ev.capacityKWh*(ev.targetPct/100)-ev.socKWh)*60000);
      let limit=Math.min(inst.def.ratedPowerW||7400,ev.maxPowerW??7400,headroomW);
      limit=Math.min(limit,evPowerHeadroom);
      if(ev.source==='solar') limit=Math.min(limit,Math.max(0,this.currentGenPotentialW-baseLoadW));
      if(ev.source==='battery') limit=Math.min(limit,batteryAvailableW);
      const powerW=chargingAllowed?Math.max(0,limit):0;
      wanted[i]={state:powerW>0?'charging':(inst.connected?'standby':'off'),powerW};
      evPowerHeadroom=Math.max(0,evPowerHeadroom-powerW);
    }

    // ---- pass 2: the installation decides what actually arrives (sockets, circuits, breakers, cables) ----
    let lossW = 0, elec = null;
    if (this.electrical){
      elec = this.electrical.resolve(instances.map((inst, i) => ({ id:inst.id, desiredW:wanted[i].powerW, connected:inst.connected, plugTo:inst.plugTo })), { accumulate, publish: !this._bulk });
      lossW = elec.lossW;
      if(accumulate&&elec.events)this.electricalTripCount+=elec.events.filter(x=>['breakerTrip','mainTrip','stripTrip','cableOverheat'].includes(x.type)).length;
    }
    evGridW=0; evBatteryW=0;
    for(let i=0;i<instances.length;i++) if(instances[i].ev){
      const er=elec&&elec.devices.get(instances[i].id), actualW=er?er.powerW:wanted[i].powerW;
      if(instances[i].ev.source==='grid') evGridW+=actualW;
      if(instances[i].ev.source==='battery') evBatteryW+=actualW;
    }
    this.currentLossW = lossW;

    // ---- pass 3: apply, count, accumulate ----
    const minuteKWhByDevice={};
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
        minuteKWhByDevice[inst.id]=kwh;
        this.todayKWh += kwh;
        if (hour>=6 && hour<9) this.todayMorningKWh += kwh;
        this.todayKWhByDevice[inst.id] = (this.todayKWhByDevice[inst.id]||0) + kwh;
        this.todayKWhByCategory[inst.def.category] = (this.todayKWhByCategory[inst.def.category]||0) + kwh;
        this.todayKWhByRoom[inst.roomId] = (this.todayKWhByRoom[inst.roomId]||0) + kwh;
        this.hourlyKWh[hour] += kwh;
        inst.stats.energyYearKWh += kwh; // running lifetime-of-session accumulator
        if(inst.ev && kwh>0){ inst.ev.todayKWh=(inst.ev.todayKWh||0)+kwh; inst.ev.totalKWh=(inst.ev.totalKWh||0)+kwh; }
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
    this.maxObservedPowerW=Math.max(this.maxObservedPowerW,total);
    if(s.importLimitW!=null&&total>s.importLimitW)this.overloadMinutes++;

    // ---- Solar generation: per-panel potential (incidence x weather x SHADING) ----
    const panels = this.getSolarInstances();
    const doy = this.dayOfYear;
    if (SolarCalculator.shadeModel) SolarCalculator.shadeModel.setSeason(this.season);
    const panelW = new Array(panels.length);
    let pvPotential = 0;
    for (let i = 0; i < panels.length; i++){
      const p = panels[i];
      const d = SolarCalculator.resolveDetailed(p, this.absMin, doy, wx.solarMult);
      const panelTemp=(this.weatherManager?this.weatherManager.outdoorTemperature(this.simDate,this.minuteOfDay/60):15)+Math.max(0,d.w/(p.def.peakPowerW||400))*25;
      p.runtime.panelTemperatureC=panelTemp;
      const tempWeight=this.getSettings().realismMode==='realistic'?1:this.getSettings().realismMode==='educational'?.5:0;
      const tempFactor=Math.max(.75,1-tempWeight*.004*Math.max(0,panelTemp-25));
      panelW[i]=d.w*tempFactor*(p.runtime.faulted?0:1);pvPotential+=panelW[i];
      p.runtime.directAccess = d.direct;   // 0..1 direct-beam access (1 = no shade)
      p.runtime.sunlight = d.sunlight;     // 0..1 effective light incl. diffuse
      p.runtime.potentialW = d.w;
    }
    const pvSettings=this.getSettings();
    if(typeof HomeEnergyManager!=='undefined')pvPotential*=HomeEnergyManager.pvModuleFactor(pvSettings);
    if(typeof HomeEnergyManager!=='undefined'&&pvSettings.realismMode!=='arcade')pvPotential*=pvSettings.realismMode==='educational'?Math.sqrt(HomeEnergyManager.pvFactor(pvSettings)):HomeEnergyManager.pvFactor(pvSettings);
    pvPotential*=Math.max(.5,Math.min(1,+(pvSettings.inverterEfficiency??.96)));
    if(pvSettings.inverterMaxW!=null)pvPotential=Math.min(pvPotential,Math.max(0,+pvSettings.inverterMaxW));
    this.currentGenPotentialW = pvPotential;

    // ---- Allocation of PV between home / battery / grid in the user's 3-slot order ----
    const alloc = this._allocate(total, pvPotential, s, accumulate, evGridW, evBatteryW);
    // An EV gains charge only from energy the shared household allocator could
    // actually serve. Treat unserved demand as EV charging cut first, and
    // correct the per-device daily/lifetime counters to match the vehicle SOC.
    let evUnservedW=alloc.unservedW;
    for(const inst of instances) if(inst.ev){
      const requestedKWh=minuteKWhByDevice[inst.id]||0;
      if(requestedKWh<=0) continue;
      const requestedW=requestedKWh*60000;
      const cutW=Math.min(requestedW,evUnservedW); evUnservedW-=cutW;
      const servedKWh=Math.max(0,requestedW-cutW)/60000;
      if(accumulate){
        const correction=servedKWh-requestedKWh;
        if(correction){
          minuteKWhByDevice[inst.id]=servedKWh;
          this.todayKWh+=correction;
          this.todayKWhByDevice[inst.id]=(this.todayKWhByDevice[inst.id]||0)+correction;
          this.todayKWhByCategory[inst.def.category]=(this.todayKWhByCategory[inst.def.category]||0)+correction;
          this.todayKWhByRoom[inst.roomId]=(this.todayKWhByRoom[inst.roomId]||0)+correction;
          this.hourlyKWh[hour]+=correction;
          inst.stats.energyYearKWh+=correction;
          inst.ev.todayKWh=(inst.ev.todayKWh||0)+correction;
          inst.ev.totalKWh=(inst.ev.totalKWh||0)+correction;
        }
        inst.ev.socKWh=Math.min(inst.ev.capacityKWh,inst.ev.socKWh+servedKWh);
      }
    }
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
    if(accumulate&&this.currentUnservedW>0)this.totalUnservedKWh+=EnergyCalculator.wattsMinutesToKWh(this.currentUnservedW,1);
    this.flows = alloc.flows;
    if(accumulate&&this.getSettings().realismMode!=='arcade')this._updateRoomTemperatures(instances,wx);
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
      const deliveredKWh=Object.values(minuteKWhByDevice).reduce((a,b)=>a+b,0);
      for(const inst of instances) if(inst.ev){
        const evKWh=minuteKWhByDevice[inst.id]||0;
        const importShare=total>0?Math.max(0,Math.min(1,alloc.flows.gridToHome/total)):0;
        const evRate=inst.ev.source==='grid'?rate:inst.ev.source==='solar'?0:inst.ev.source==='battery'?0:rate*importShare;
        const c=evKWh*evRate;
        inst.ev.todayCostZl=(inst.ev.todayCostZl||0)+c; this.evGridCostZl+=c;this.totalEvCostZl+=c;
      }
      this.todayCost += minuteCost;this.totalCostZl+=minuteCost;
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
      this.powerHistory.push({ absMin: this.absMin, watts: total, genWatts: gen,
        gridWatts:(this.flows.gridToHome||0)+(this.flows.gridToBattery||0),
        exportWatts:this.flows.pvToGrid||0,
        batteryWatts:(this.flows.pvToBattery||0)+(this.flows.gridToBattery||0)-(this.flows.batteryToHome||0) });
      if (this.powerHistory.length > 300) this.powerHistory.shift(); // ~50h @10min
    }
    if(accumulate)this.onMinuteTick(this);
  }

  _updateRoomTemperatures(instances,wx){
    const building=this.getBuilding();if(!building||!building.rooms)return;
    const outside=this.weatherManager?this.weatherManager.outdoorTemperature(this.simDate,this.minuteOfDay/60):10;
    const pos=SunPosition.position(this.dayOfYear,this.minuteOfDay/60),heat={};
    const upgrades=this.getSettings().modernizations?.installed||{};
    for(const inst of instances){if(inst.def.category==='heating')heat[inst.roomId]=(heat[inst.roomId]||0)+Math.max(0,inst.runtime.powerW||0)*(upgrades.heatPump?3:1);else if(inst.def.category==='climate')heat[inst.roomId]=(heat[inst.roomId]||0)-Math.max(0,inst.runtime.powerW||0)*(upgrades.airConditioning?3:2.2);}
    let comfort=0,count=0;
    for(const [id,env] of Object.entries(building.rooms)){
      if(env.outdoor)continue;
      let tin=this.roomTemperatures[id]??20;
      let loss=BuildingModel.designHeatLossW(env,tin,outside);
      if(this.getSettings().modernizations?.installed?.insulation)loss*=.78;
      if(this.getSettings().modernizations?.installed?.windows)loss*=.88;
      const solar=BuildingModel.solarGainW(env,pos.elevationDeg,pos.azimuthDeg,wx.skyFactor??1);
      const cap=Math.max(100,env.thermalMassJK/3600);
      tin+=(heat[id]||0-loss+solar)*((1/60)/cap);
      tin=Math.max(-10,Math.min(38,tin));this.roomTemperatures[id]=tin;
      comfort+=Math.max(0,100-Math.abs(tin-21)*12);count++;
    }
    this.comfortPct=count?comfort/count:100;
  }

  monthTotals(){
    const month=this.simDate.getMonth(),year=this.simDate.getFullYear();
    const entries=this.history.filter(e=>{const d=new Date(e.dateISO+'T00:00:00');return d.getMonth()===month&&d.getFullYear()===year;});
    const sum=(key,today)=>entries.reduce((a,e)=>a+(e[key]||0),0)+(today||0);
    return {consumptionKWh:sum('consumedKWh',this.todayKWh),solarKWh:sum('solarKWh',this.todaySolarKWh),importKWh:sum('importKWh',this.todayImportKWh),exportKWh:sum('exportKWh',this.todayExportKWh),costZl:sum('cost',this.todayCost)};
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
  _allocate(loadW, pvW, s, accumulate, gridOnlyLoadW=0, batteryOnlyLoadW=0){
    let order = SimulationEngine.normalizePvOrder(s.pvOrder, s.pvPriority);
    const batteryModes=this.getBatteryInstances().map(b=>b.storage&&b.storage.mode);
    if(batteryModes.includes('self'))order=['home','battery','grid'];
    if(batteryModes.includes('pv'))order=['battery','home','grid'];
    const gridUp = this.gridOnline !== false;
    const cap = v => (v == null || v === '' || !isFinite(+v)) ? Infinity : Math.max(0, +v);
    const exportCap = gridUp ? cap(s.exportLimitW) : 0;
    const importCap = gridUp ? cap(s.importLimitW) : 0;
    const reserve = Math.max(0, Math.min(90, +s.batteryReservePct || 0)) / 100;

    const infos = [];
    for (const b of this.getBatteryInstances()){
      if (!b.connected || (b.runtime && b.runtime.faulted)){ b.runtime.powerW = 0; b.runtime.state = b.connected ? 'fault' : 'off'; continue; }
      const storage=b.storage||(b.storage={mode:'auto',sohPct:100,temperatureC:20,throughputKWh:0,maxChargeW:b.def.maxChargeW,maxDischargeW:b.def.maxDischargeW,reservePct:0});
      const expansion=typeof HomeEnergyManager!=='undefined'?HomeEnergyManager.batteryCapacityFactor(s):1;
      const c = b.def.capacityKWh*expansion*Math.max(.5,Math.min(1,storage.sohPct/100));
      const battReserve=Math.max(reserve,(+storage.reservePct||0)/100,storage.mode==='backup'?.30:0);
      const outside=this.weatherManager?this.weatherManager.outdoorTemperature(this.simDate,this.minuteOfDay/60):15;
      const realism=s.realismMode||'arcade',thermalWeight=realism==='realistic'?1:realism==='educational'?.5:0;
      storage.temperatureC=Math.max(-10,Math.min(55,(storage.temperatureC??20)*.995+(outside+Math.abs(b.runtime.powerW||0)/20-storage.temperatureC)*.005*thermalWeight));
      const temperature=storage.temperatureC,temperatureFactor=Math.max(.8,1-thermalWeight*Math.abs(temperature-22)*.003);
      infos.push({ b, storage, cap:c, eff:(b.def.efficiency || 0.92)*temperatureFactor,reserve:battReserve,
        soc:Math.min(c,Math.max(0,(b.runtime.socKWh != null) ? b.runtime.socKWh : c*0.5)),
        maxC:Math.min(b.def.maxChargeW,storage.maxChargeW??b.def.maxChargeW), maxD:Math.min(b.def.maxDischargeW,storage.maxDischargeW??b.def.maxDischargeW), chargeW:0, dischargeW:0,gridChargeW:0 });
      b.runtime.socKWh=infos[infos.length-1].soc;
    }

    const gridLoad=Math.min(loadW,gridOnlyLoadW), batteryLoad=Math.min(Math.max(0,loadW-gridLoad),batteryOnlyLoadW);
    let pvLeft = Math.max(0, pvW), homeNeed = Math.max(0, loadW-gridLoad-batteryLoad);
    let pvHome = 0, pvBatt = 0, pvGrid = 0;
    for (const slot of order){
      if (slot === 'home'){
        const x = Math.min(pvLeft, homeNeed); pvHome += x; pvLeft -= x; homeNeed -= x;
      } else if (slot === 'battery'){
        if(batteryLoad>0) continue; // preserve the existing battery's discharge for the EV source choice
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

    let deficit = homeNeed, battToHome = 0, batteryEvUnserved=batteryLoad;
    if (pvBatt <= 0.01 && (deficit > 0.5 || batteryEvUnserved>0.5)){ // a battery cannot charge and discharge in the same minute
      for (const bi of infos){
        if (deficit <= 0.5 && batteryEvUnserved<=0.5) break;
        const maxByAvailable = Math.max(0, bi.soc - bi.reserve*bi.cap) * 1000 * 60 * bi.eff; // W that would exactly reach the reserve in 1 min
        const d=Math.min(deficit+batteryEvUnserved,bi.maxD,maxByAvailable);
        if(d>0){
          const fromEv=Math.min(batteryEvUnserved,d); batteryEvUnserved-=fromEv;
          const fromHome=d-fromEv; deficit-=fromHome; bi.dischargeW=d; battToHome+=d;
        }
      }
    }
    const gridToHome = Math.min(deficit+gridLoad, importCap);
    const unservedW = batteryEvUnserved+Math.max(0, deficit+gridLoad-gridToHome);

    // Cheap-tariff charging is a real grid import, bounded by the inverter,
    // battery headroom and the home's remaining import capacity.
    const tariff=TariffManager.get(s.tariffCode),prices=(s.tariffPrices&&s.tariffPrices[s.tariffCode])||tariff.defaultPrices;
    const rate=TariffManager.priceAt(tariff,prices,(s.tariffSchedules&&s.tariffSchedules[s.tariffCode])||tariff.buildDefaultSchedule(),this.absMin);
    const rateValues=tariff.rates.map(r=>prices[r.id]??tariff.defaultPrices[r.id]);
    const cheapest=Math.min(...rateValues),mostExpensive=Math.max(...rateValues);
    const bestRoundTrip=Math.max(.01,...infos.map(b=>b.eff*b.eff));
    const profitableTariff=tariff.rates.length>1&&mostExpensive>cheapest/bestRoundTrip;
    let gridRoom=Math.max(0,importCap-gridToHome),gridToBattery=0;
    if(gridUp&&profitableTariff&&rate<=cheapest+1e-9&&unservedW<=.5){
      for(const bi of infos){
        if(bi.storage.mode!=='cheap'||bi.chargeW>0||bi.dischargeW>0||gridRoom<=.5)continue;
        const headroom=Math.max(0,bi.cap-bi.soc)*1000*60/bi.eff;
        const c=Math.min(gridRoom,bi.maxC,headroom);
        if(c>.5){bi.chargeW=c;bi.gridChargeW=c;gridRoom-=c;gridToBattery+=c;}
      }
    }

    let battNet = 0;
    for (const bi of infos){
      const net = bi.chargeW - bi.dischargeW;
      if (accumulate){
        if (bi.chargeW > 0.01){
          const energyIn = bi.chargeW/1000/60;
          bi.b.runtime.socKWh = Math.min(bi.cap, bi.soc + energyIn*bi.eff);
          this.todayBatteryChargeKWh += energyIn;
          this.totalBatteryChargeKWh+=energyIn;
          bi.storage.throughputKWh=(bi.storage.throughputKWh||0)+energyIn;
          if(s.realismMode==='realistic')bi.storage.sohPct=Math.max(70,(bi.storage.sohPct||100)-energyIn/(2*bi.cap)*.005);
        } else if (bi.dischargeW > 0.01){
          const energyOut = bi.dischargeW/1000/60;
          bi.b.runtime.socKWh = Math.max(0, bi.soc - energyOut/bi.eff);
          this.todayBatteryDischargeKWh += energyOut;
          this.totalBatteryDischargeKWh+=energyOut;
          bi.storage.throughputKWh=(bi.storage.throughputKWh||0)+energyOut;
          if(s.realismMode==='realistic')bi.storage.sohPct=Math.max(70,(bi.storage.sohPct||100)-energyOut/(2*bi.cap)*.005);
        }
      }
      const socNow = (bi.b.runtime.socKWh != null) ? bi.b.runtime.socKWh : bi.soc;
      bi.b.runtime.powerW = net;
      bi.b.runtime.state = bi.chargeW > 0.01 ? 'charging' : (bi.dischargeW > 0.01 ? 'discharging' : 'idle');
      bi.b.runtime.socPct = (socNow / bi.cap) * 100;
      battNet += net;
    }
    return { batteryNetW: battNet, curtailedW, unservedW,
      flows: { pvToHome:pvHome, pvToBattery:pvBatt, gridToBattery, pvToGrid:pvGrid, batteryToHome:battToHome, gridToHome, curtailed:curtailedW, unserved:unservedW } };
  }

  // ---------------- persistence (session progress, not just the house layout) ----------------
  serializeProgress(){
    return {
      absMin: this.absMin, totalSavedPLN: this.totalSavedPLN,
      totalImportKWh: this.totalImportKWh, totalExportKWh: this.totalExportKWh,
      totalConsumedKWh: this.totalConsumedKWh, totalSolarKWh: this.totalSolarKWh,
      history: this.history,totalBatteryChargeKWh:this.totalBatteryChargeKWh,totalBatteryDischargeKWh:this.totalBatteryDischargeKWh,totalEvCostZl:this.totalEvCostZl,totalCostZl:this.totalCostZl,electricalTripCount:this.electricalTripCount,_startAbsMin:this._startAbsMin,
      maxObservedPowerW:this.maxObservedPowerW,overloadMinutes:this.overloadMinutes,gridOfflineMinutes:this.gridOfflineMinutes,currentOutageMinutes:this.currentOutageMinutes,longestOutageMinutes:this.longestOutageMinutes,totalUnservedKWh:this.totalUnservedKWh,roomTemperatures:this.roomTemperatures,comfortPct:this.comfortPct,
      powerHistory:this.powerHistory,
    };
  }
  deserializeProgress(data){
    this._syncCalendarEpoch(); // recompute for the (possibly different) project's start date BEFORE restoring absMin
    if (!data) return;
    if (typeof data.absMin === 'number') { this.absMin = data.absMin; this._lastDay = Math.floor(this.absMin/1440); this._cachedSimDate=null; this._cachedSimDateDay=null; }
    this.totalSavedPLN = data.totalSavedPLN||0;
    this.totalImportKWh = data.totalImportKWh||0; this.totalExportKWh = data.totalExportKWh||0;
    this.totalConsumedKWh = data.totalConsumedKWh||0; this.totalSolarKWh = data.totalSolarKWh||0;
    this.totalBatteryChargeKWh=data.totalBatteryChargeKWh||0;this.totalBatteryDischargeKWh=data.totalBatteryDischargeKWh||0;
    this.totalEvCostZl=data.totalEvCostZl||0;this._startAbsMin=data._startAbsMin??this.absMin;
    this.totalCostZl=Number.isFinite(data.totalCostZl)?data.totalCostZl:(this.history.reduce((a,e)=>a+(e.cost||0),0)+(this.todayCost||0));
    this.electricalTripCount=data.electricalTripCount||0;
    this.maxObservedPowerW=data.maxObservedPowerW||0;this.overloadMinutes=data.overloadMinutes||0;this.gridOfflineMinutes=data.gridOfflineMinutes||0;this.currentOutageMinutes=data.currentOutageMinutes||0;this.longestOutageMinutes=data.longestOutageMinutes||0;this.totalUnservedKWh=data.totalUnservedKWh||0;this.roomTemperatures=data.roomTemperatures||{};this.comfortPct=data.comfortPct??100;
    this.history = Array.isArray(data.history) ? data.history.slice(-this.HISTORY_CAP) : [];
    this.powerHistory=Array.isArray(data.powerHistory)?data.powerHistory.slice(-300):[];
  }
  /** Full clock+lifetime-stats reset, used by "New project"/"Reset simulation" (section 28/29). */
  resetProgress(){
    this.absMin = 8*60;
    this._syncCalendarEpoch(); // re-anchors to the (possibly new) start date and re-derives _lastDay
    this.totalSavedPLN = 0; this.totalImportKWh = 0; this.totalExportKWh = 0;
    this.totalConsumedKWh = 0; this.totalSolarKWh = 0;
    this.totalBatteryChargeKWh=0;this.totalBatteryDischargeKWh=0;
    this.totalEvCostZl=0;this.electricalTripCount=0;this._startAbsMin=this.absMin;this.maxObservedPowerW=0;this.overloadMinutes=0;this.gridOfflineMinutes=0;this.currentOutageMinutes=0;this.longestOutageMinutes=0;this.totalUnservedKWh=0;this.roomTemperatures={};this.comfortPct=100;
    this.history = []; this.lastCompletedDay = null; this.powerHistory = []; this._lastSampleMin = -999;
    this.todayKWh = 0; this.todaySolarKWh = 0; this.todayImportKWh = 0; this.todayExportKWh = 0;
    this.todayCost = 0;this.totalCostZl=0; this.todayKWhByDevice = {}; this.todayKWhByCategory = {}; this.todayKWhByRoom = {};
    this.todayBatteryChargeKWh = 0; this.todayBatteryDischargeKWh = 0; this.todayMorningKWh = 0; this.todayCurtailedKWh = 0; this.todayLossKWh = 0;
    this.hourlyKWh.fill(0); this.hourlyGenKWh.fill(0);
  }
}
