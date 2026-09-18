/**
 * ANALYTICS MANAGER
 * Two complementary data sources, never mixed up as if they were the
 * same thing (spec section 25's "one consistent model" - each number
 * is clearly either an actual simulated measurement or a projection):
 *
 *  1) STATIC PROJECTION (original mechanic, kept) - statically
 *     integrates every device's schedule-driven power profile (and
 *     every PV panel's sun-driven output) over a representative
 *     virtual week/day, tariff-aware. Used for "today so far" (before
 *     enough of today has actually run) and for anything about the
 *     future.
 *  2) PLAYED HISTORY (new) - SimulationEngine.history is a day-by-day
 *     ledger of what ACTUALLY happened while the sim was running.
 *     Once there's enough of it, week/month/year views blend in real
 *     numbers instead of pure projection, and are clearly labelled
 *     "measured" vs. "estimated" in the UI.
 *
 * Unity mapping: AnalyticsManager (pure C# service, no MonoBehaviour).
 */
class AnalyticsManager {
  constructor({ getInstances, getSolarInstances, getBatteryInstances, getSettings, getSim }){
    this.getInstances = getInstances;
    this.getSolarInstances = getSolarInstances || (()=>[]);
    this.getBatteryInstances = getBatteryInstances || (()=>[]);
    this.getSettings = getSettings; // energySettings: {tariffCode, tariffPrices, tariffSchedules, pvPriority, currency, extraFeesPerMonth, co2Factor, avgHouseholdKWhYear}
    this.getSim = getSim || (()=>null); // SimulationEngine instance - optional, enables real-history features
  }

  _refDate(){ const sim = this.getSim(); return sim ? sim.simDate : new Date(); }
  _refDayOfYear(){ const sim = this.getSim(); return sim ? sim.dayOfYear : SunPosition.dayOfYear(new Date()); }
  _refSeasonFactor(){ const sim = this.getSim(); const season = sim ? sim.season : SunPosition.seasonForDate(new Date()); return WeatherSystem.seasonalAverageFactor(season); }

  computeWeekProjection(){
    const now = Date.now();
    if (this._cache && (now - this._cache.ts) < 2500) return this._cache.result;
    const result = this._computeWeekProjectionUncached();
    this._cache = { ts: now, result };
    return result;
  }
  invalidateCache(){ this._cache = null; }

  _computeWeekProjectionUncached(){
    const instances = this.getInstances();
    const panels = this.getSolarInstances();
    const s = this.getSettings();
    const doy = this._refDayOfYear();
    const skyFactor = this._refSeasonFactor();
    const perWeekdayTotal = new Array(7).fill(0);
    const perWeekdayGen = new Array(7).fill(0);
    const perWeekdayCost = new Array(7).fill(0); // tariff-aware: self-consumption avoids the import rate, only true surplus is credited at the (separate, usually lower) export rate
    const perDeviceWeekly = {}; const perDeviceDaily = {};
    for (const inst of instances){ perDeviceDaily[inst.id] = new Array(7).fill(0); perDeviceWeekly[inst.id] = 0; }

    for (let day=0; day<7; day++){
      const dayBase = day*1440;
      const perDeviceThisDay = {};
      let dayTotal = 0, dayGen = 0, dayCost = 0;
      for (let m=0; m<1440; m++){
        let minuteTotal = 0;
        for (const inst of instances){
          const { powerW } = ScheduleManager.resolve(inst, dayBase+m);
          const kwh = EnergyCalculator.wattsMinutesToKWh(powerW,1);
          perDeviceThisDay[inst.id] = (perDeviceThisDay[inst.id]||0) + kwh;
          minuteTotal += powerW;
        }
        let minuteGen = 0;
        for (const p of panels) minuteGen += SolarCalculator.resolve(p, dayBase+m, doy, skyFactor);
        dayTotal += EnergyCalculator.wattsMinutesToKWh(minuteTotal,1);
        dayGen += EnergyCalculator.wattsMinutesToKWh(minuteGen,1);
        const netW = minuteTotal - minuteGen;
        const netKw = netW/1000;
        if (netW >= 0){
          dayCost += netKw*(1/60) * EnergyCalculator.priceAt(dayBase+m, s);
        } else {
          const exportRate = s.exportPricePerKWh != null ? s.exportPricePerKWh : EnergyCalculator.priceAt(dayBase+m, s);
          dayCost += netKw*(1/60) * exportRate; // negative net x rate = credit
        }
      }
      for (const inst of instances){ perDeviceDaily[inst.id][day] = perDeviceThisDay[inst.id]||0; perDeviceWeekly[inst.id] += perDeviceThisDay[inst.id]||0; }
      perWeekdayTotal[day] = dayTotal; perWeekdayGen[day] = dayGen; perWeekdayCost[day] = dayCost;
    }
    const weekTotal = perWeekdayTotal.reduce((a,b)=>a+b,0);
    const weekGen = perWeekdayGen.reduce((a,b)=>a+b,0);
    const weekCost = perWeekdayCost.reduce((a,b)=>a+b,0);
    return {
      perWeekdayTotal, perWeekdayGen, perWeekdayCost, perDeviceWeekly, perDeviceDaily,
      weekTotal, weekGen, weekCost,
      avgDaily: weekTotal/7, avgDailyGen: weekGen/7, avgDailyCost: weekCost/7,
    };
  }

  /** Coarser/faster: integrate at 15-min steps for hourly-shape chart of a given weekday (consumption + generation) */
  computeHourlyShape(weekday){
    const instances = this.getInstances();
    const panels = this.getSolarInstances();
    const doy = this._refDayOfYear();
    const skyFactor = this._refSeasonFactor();
    const hours = new Array(24).fill(0);
    const genHours = new Array(24).fill(0);
    for (let h=0; h<24; h++){
      for (let mm=0; mm<60; mm+=15){
        let sumW = 0, genW = 0;
        for (const inst of instances) sumW += ScheduleManager.resolve(inst, weekday*1440 + h*60 + mm).powerW;
        for (const p of panels) genW += SolarCalculator.resolve(p, weekday*1440 + h*60 + mm, doy, skyFactor);
        hours[h] += EnergyCalculator.wattsMinutesToKWh(sumW,15);
        genHours[h] += EnergyCalculator.wattsMinutesToKWh(genW,15);
      }
    }
    return { hours, genHours };
  }

  /** Average kWh/day a full set of currently-installed panels would generate on a representative day
   *  of `dayOfYear`, under `skyFactor` sky conditions - used by the year breakdown (one call per month,
   *  cheap) and by the PV install UI's per-panel preview. */
  estimateDailySolarKWh(dayOfYear, skyFactor, panelsOverride){
    const panels = panelsOverride || this.getSolarInstances();
    let kwh = 0;
    for (const p of panels){
      for (let m=0; m<1440; m+=15){
        kwh += EnergyCalculator.wattsMinutesToKWh(SolarCalculator.resolve(p, m, dayOfYear, skyFactor), 15);
      }
    }
    return kwh;
  }

  projections(liveTodayKWh, liveTodayGenKWh, liveTodayCost){
    const s = this.getSettings();
    const wk = this.computeWeekProjection();
    const today = liveTodayKWh != null ? liveTodayKWh : wk.avgDaily;
    const todayGen = liveTodayGenKWh != null ? liveTodayGenKWh : wk.avgDailyGen;
    const todayCost = liveTodayCost != null ? liveTodayCost : wk.avgDailyCost;
    const month = wk.avgDaily * 30, monthGen = wk.avgDailyGen * 30;
    const year = wk.avgDaily * 365, yearGen = wk.avgDailyGen * 365;
    const monthCost = wk.avgDailyCost * 30 + s.extraFeesPerMonth;
    const yearCost = wk.avgDailyCost * 365 + s.extraFeesPerMonth * 12;
    return {
      today, todayGen, todayCost,
      week: wk.weekTotal, weekGen: wk.weekGen, weekCost: wk.weekCost,
      month, monthGen, monthCost,
      year, yearGen, yearCost,
      co2Year: EnergyCalculator.co2(Math.max(0,year-yearGen), s.co2Factor),
      co2AvoidedYear: EnergyCalculator.co2(yearGen, s.co2Factor),
      weekProjection: wk,
    };
  }

  /** Ranking table: Device | Power(now) | Daily kWh | Monthly kWh | Monthly Cost | % total */
  ranking(){
    const instances = this.getInstances();
    const s = this.getSettings();
    const price = EnergyCalculator.effectivePrice(s);
    const wk = this.computeWeekProjection();
    const rows = instances.map(inst=>{
      const dailyKWh = wk.perDeviceWeekly[inst.id]/7;
      const monthlyKWh = dailyKWh*30;
      return {
        inst, name: inst.customName || I18n.deviceName(inst.def),
        currentPowerW: inst.runtime.powerW||0,
        dailyKWh, monthlyKWh,
        monthlyCost: EnergyCalculator.cost(monthlyKWh, price),
      };
    });
    const totalMonthly = rows.reduce((a,r)=>a+r.monthlyKWh,0) || 1;
    rows.forEach(r=> r.pct = (r.monthlyKWh/totalMonthly)*100);
    rows.sort((a,b)=>b.monthlyKWh-a.monthlyKWh);
    return rows;
  }

  /** Full drill-down for one device: today/yesterday/week/month/year/forecast, all derived from the
   *  same schedule-resolution engine (+ real "today so far"/"yesterday" from the live sim when available). */
  deviceAllRanges(instId){
    const sim = this.getSim();
    const instances = this.getInstances();
    const inst = instances.find(i=>i.id===instId);
    if (!inst) return null;
    const wk = this.computeWeekProjection();
    const dailyAvg = wk.perDeviceWeekly[inst.id]/7;
    const today = sim ? (sim.todayKWhByDevice[inst.id]||0) : dailyAvg;
    const yesterday = sim && sim.lastCompletedDay && sim.lastCompletedDay.byDevice ? (sim.lastCompletedDay.byDevice[inst.id]||0) : dailyAvg;
    const s = this.getSettings();
    const price = EnergyCalculator.effectivePrice(s);
    return {
      inst, name: inst.customName || I18n.deviceName(inst.def),
      today, yesterday,
      week: wk.perDeviceWeekly[inst.id],
      month: dailyAvg*30, year: dailyAvg*365, yearForecast: dailyAvg*365,
      costToday: today*price, costMonth: dailyAvg*30*price, costYear: dailyAvg*365*price,
      pctOfTotal: (()=>{ const rows=this.ranking(); const r=rows.find(x=>x.inst.id===instId); return r?r.pct:0; })(),
    };
  }

  /** Solar ranking / summary per panel */
  solarSummary(){
    const panels = this.getSolarInstances();
    const s = this.getSettings();
    const price = EnergyCalculator.effectivePrice(s);
    const wk = this.computeWeekProjection();
    const totalPeakW = panels.reduce((a,p)=>a+p.def.peakPowerW,0);
    const currentGenW = panels.reduce((a,p)=>a - Math.min(0,p.runtime.powerW||0),0);
    const avgAimQuality = panels.length ? panels.reduce((a,p)=>a+SolarCalculator.aimQuality(p.pvOrientation||SolarCalculator.DEFAULT_ORIENTATION, this._refDayOfYear()),0)/panels.length : 0;
    return {
      count: panels.length, totalPeakW, currentGenW,
      todayGenKWh: wk.avgDailyGen, monthGenKWh: wk.avgDailyGen*30, yearGenKWh: wk.avgDailyGen*365,
      yearCredit: EnergyCalculator.cost(wk.avgDailyGen*365, price),
      avgAimQuality,
    };
  }

  /** Battery status is live/stateful (state-of-charge carries across ticks), so unlike solar this
   *  can't be folded into the static weekly projection - it only reports current live numbers. */
  batterySummary(sim){
    const batteries = this.getBatteryInstances ? this.getBatteryInstances() : [];
    if (!batteries.length) return { count:0 };
    const totalCapKWh = batteries.reduce((a,b)=>a+b.def.capacityKWh,0);
    const totalSocKWh = batteries.reduce((a,b)=>a+(b.runtime.socKWh ?? b.def.capacityKWh*0.5),0);
    const chargingW = batteries.reduce((a,b)=>a+Math.max(0,b.runtime.powerW||0),0);
    const dischargingW = batteries.reduce((a,b)=>a+Math.max(0,-(b.runtime.powerW||0)),0);
    return {
      count: batteries.length, totalCapKWh, totalSocKWh,
      socPct: totalCapKWh ? (totalSocKWh/totalCapKWh*100) : 0,
      chargingW, dischargingW,
      todayChargeKWh: sim ? sim.todayBatteryChargeKWh : 0,
      todayDischargeKWh: sim ? sim.todayBatteryDischargeKWh : 0,
    };
  }

  /** Compares the house's projected annual consumption/cost to a reference "average household"
   *  figure (editable in Settings - a stated estimate, never presented as an official statistic). */
  householdComparison(liveTodayKWh){
    const s = this.getSettings();
    const proj = this.projections(liveTodayKWh);
    const refKWh = s.avgHouseholdKWhYear || 2900;
    const refCost = refKWh * EnergyCalculator.effectivePrice(s);
    const userYearKWh = Math.max(0, proj.year - proj.yearGen);
    const kWhDiff = userYearKWh - refKWh;
    const costDiff = proj.yearCost - refCost;
    return {
      refKWh, refCost, userYearKWh,
      kWhDiff, costDiff,
      pctDiff: refKWh ? (kWhDiff/refKWh*100) : 0,
      isBetter: kWhDiff <= 0,
    };
  }

  /** Section 13: money genuinely saved thanks to PV+battery - today/month/year (projected) plus the
   *  session's real lifetime total (SimulationEngine.totalSavedPLN, accumulated minute-by-minute from
   *  actual baseline-vs-actual cost, never a fabricated number). */
  savingsAnalysis(){
    const sim = this.getSim();
    const s = this.getSettings();
    const proj = this.projections(sim?sim.todayKWh:null, sim?sim.todaySolarKWh:null, sim?sim.todayCost:null);
    const price = EnergyCalculator.effectivePrice(s);
    const withoutPVMonth = proj.month * price + s.extraFeesPerMonth;
    const withoutPVYear = proj.year * price + s.extraFeesPerMonth*12;
    const withPVMonth = proj.monthCost, withPVYear = proj.yearCost;
    const reductionPct = withoutPVYear>0 ? Math.max(0, (1 - withPVYear/withoutPVYear)*100) : 0;
    return {
      withoutPVMonth, withoutPVYear, withPVMonth, withPVYear,
      savingMonth: Math.max(0, withoutPVMonth-withPVMonth), savingYear: Math.max(0, withoutPVYear-withPVYear),
      reductionPct,
      lifetimeSavingPLN: sim ? sim.totalSavedPLN : 0,
      lifetimeImportKWh: sim ? sim.totalImportKWh : 0, lifetimeExportKWh: sim ? sim.totalExportKWh : 0,
    };
  }

  /** Section 20/4: where today's consumption is going, by device category and by room -
   *  straight from SimulationEngine's live per-minute accumulators, not re-derived/guessed. */
  breakdownToday(sim){
    sim = sim || this.getSim();
    if (!sim) return { byCategory:[], byRoom:[] };
    const total = sim.todayKWh || 1;
    const byCategory = Object.entries(sim.todayKWhByCategory||{}).map(([cat,kwh])=>({ id:cat, label:I18n.category(cat), kWh:kwh, pct:kwh/total*100 })).sort((a,b)=>b.kWh-a.kWh);
    const byRoom = Object.entries(sim.todayKWhByRoom||{}).map(([roomId,kwh])=>({ id:roomId, kWh:kwh, pct:kwh/total*100 })).sort((a,b)=>b.kWh-a.kWh);
    return { byCategory, byRoom };
  }

  /** Section 8/9: 12-month table for the simulated calendar year, blending REAL played days
   *  (SimulationEngine.history + the current in-progress day) with a season-aware PROJECTION
   *  for any days of a month that haven't been simulated yet. Each month is flagged isReal/
   *  isPartial/isProjected so the UI can visibly distinguish "measured" from "estimated". */
  yearBreakdown(){
    const sim = this.getSim();
    const s = this.getSettings();
    const wk = this.computeWeekProjection();
    const price = EnergyCalculator.effectivePrice(s);
    const refDate = this._refDate();
    const year = refDate.getFullYear();
    const history = sim ? sim.history : [];
    const months = [];
    for (let m=0; m<12; m++){
      const daysInMonth = new Date(year, m+1, 0).getDate();
      const realEntries = history.filter(e=>{ const d=new Date(e.dateISO+'T00:00:00'); return d.getFullYear()===year && d.getMonth()===m; });
      let realConsumed=0, realSolar=0, realImport=0, realExport=0, realCost=0;
      for (const e of realEntries){ realConsumed+=e.consumedKWh; realSolar+=e.solarKWh; realImport+=e.importKWh||0; realExport+=e.exportKWh||0; realCost+=e.cost; }
      let realDays = realEntries.length;
      const isCurrentMonth = sim && refDate.getFullYear()===year && refDate.getMonth()===m;
      if (isCurrentMonth){
        realConsumed += sim.todayKWh; realSolar += sim.todaySolarKWh; realImport += sim.todayImportKWh; realExport += sim.todayExportKWh; realCost += sim.todayCost;
        realDays += sim.minuteOfDay/1440; // partial-day credit
      }
      const remainingDays = Math.max(0, daysInMonth - realDays);
      const season = SunPosition.seasonForDate(new Date(year, m, 15));
      const seasonFactor = WeatherSystem.seasonalAverageFactor(season);
      const repDoy = SunPosition.dayOfYear(new Date(year, m, 15));
      const projSolarPerDay = this.estimateDailySolarKWh(repDoy, seasonFactor);
      const projConsumedPerDay = wk.avgDaily;
      const netPerDay = projConsumedPerDay - projSolarPerDay;
      const exportPrice = s.exportPricePerKWh != null ? s.exportPricePerKWh : price;
      const projCostPerDay = netPerDay >= 0 ? netPerDay*price : netPerDay*exportPrice;
      const consumedKWh = realConsumed + projConsumedPerDay*remainingDays;
      const solarKWh = realSolar + projSolarPerDay*remainingDays;
      const importKWh = realImport + Math.max(0,projConsumedPerDay-projSolarPerDay)*remainingDays;
      const exportKWh = realExport + Math.max(0,projSolarPerDay-projConsumedPerDay)*remainingDays;
      const cost = realCost + projCostPerDay*remainingDays;
      months.push({
        monthIdx:m, label:I18n.monthName(m), season,
        consumedKWh, solarKWh, importKWh, exportKWh, cost, savings: Math.max(0, consumedKWh*price - cost),
        isReal: remainingDays < 0.02 && realDays>0, isPartial: remainingDays>=0.02 && realDays>0.02, isProjected: realDays<=0.02,
      });
    }
    const totals = months.reduce((acc,mo)=>({
      consumedKWh: acc.consumedKWh+mo.consumedKWh, solarKWh: acc.solarKWh+mo.solarKWh,
      importKWh: acc.importKWh+mo.importKWh, exportKWh: acc.exportKWh+mo.exportKWh,
      cost: acc.cost+mo.cost, savings: acc.savings+mo.savings,
    }), { consumedKWh:0, solarKWh:0, importKWh:0, exportKWh:0, cost:0, savings:0 });
    return { year, months, totals };
  }

  /** Section 23: real period-over-period comparison, built only from genuinely simulated days
   *  (SimulationEngine.history) - falls back gracefully (marks `insufficientData`) if the sim
   *  hasn't been played long enough yet for a full previous period to exist. */
  comparePeriods(rangeType){
    const sim = this.getSim();
    if (!sim) return { insufficientData:true };
    const s = this.getSettings();
    const price = EnergyCalculator.effectivePrice(s);
    const hist = sim.history;
    const spanDays = rangeType==='week' ? 7 : 30;
    const currentEntries = hist.slice(-spanDays);
    const previousEntries = hist.slice(-spanDays*2, -spanDays);
    if (currentEntries.length < 1) return { insufficientData:true, needDays: spanDays };
    const sum = (arr,key)=>arr.reduce((a,e)=>a+(e[key]||0),0);
    const cur = {
      consumedKWh: sum(currentEntries,'consumedKWh') + sim.todayKWh,
      solarKWh: sum(currentEntries,'solarKWh') + sim.todaySolarKWh,
      cost: sum(currentEntries,'cost') + sim.todayCost,
    };
    const prev = previousEntries.length ? {
      consumedKWh: sum(previousEntries,'consumedKWh'),
      solarKWh: sum(previousEntries,'solarKWh'),
      cost: sum(previousEntries,'cost'),
    } : null;
    const pctChange = (a,b)=> b ? ((a-b)/Math.abs(b)*100) : null;
    return {
      insufficientData:false, rangeType, hasPrevious: !!prev,
      current: cur, previous: prev,
      changeConsumedPct: prev ? pctChange(cur.consumedKWh, prev.consumedKWh) : null,
      changeCostPct: prev ? pctChange(cur.cost, prev.cost) : null,
      changeSolarPct: prev ? pctChange(cur.solarKWh, prev.solarKWh) : null,
      changeCostAbs: prev ? (cur.cost-prev.cost) : null,
    };
  }

  /** Energy Score 0-100 + letter class + explanation */
  energyScore(){
    const rows = this.ranking();
    const instances = this.getInstances();
    const panels = this.getSolarInstances();
    if (!instances.length) return { score:100, grade:'A+', biggestProblem:I18n.t('score.noDevices'), biggestOpportunity:I18n.t('score.addDevices') };
    let standbyPenalty = 0, inefficiencyPenalty = 0;
    let worst = null, worstStandby = 0;
    for (const inst of instances){
      const def = inst.def;
      const standbyW = def.standbyPowerW||0;
      if (standbyW > 3){ standbyPenalty += Math.min(standbyW/4, 8); }
      if (standbyW > worstStandby){ worstStandby = standbyW; worst = inst; }
      if (def.energyClass && /^(D|E|F|G)$/.test(def.energyClass)) inefficiencyPenalty += 6;
    }
    const topRow = rows[0];
    const concentrationPenalty = topRow && topRow.pct > 40 ? (topRow.pct-40)*0.4 : 0;
    const solarBonus = panels.length ? Math.min(10, panels.length*3) : 0;
    let score = 100 - standbyPenalty - inefficiencyPenalty - concentrationPenalty + solarBonus;
    score = Math.max(5, Math.min(100, Math.round(score)));
    const grade = score>=95?'A+':score>=85?'A':score>=75?'B':score>=65?'C':score>=50?'D':score>=35?'E':score>=20?'F':'G';
    const biggestProblem = topRow ? I18n.t('score.biggestProblem', { name: topRow.name, pct: topRow.pct.toFixed(0) })
                                   : I18n.t('score.noProblems');
    const biggestOpportunity = worst ? I18n.t('score.biggestOpportunity', { name: (worst.customName||I18n.deviceName(worst.def)), watts: worstStandby })
                                      : (panels.length ? I18n.t('score.addMorePV') : I18n.t('score.automateNight'));
    return { score, grade, biggestProblem, biggestOpportunity };
  }

  /** Dynamic alert generation (rule-based, deterministic - not random) */
  alerts(sim){
    const out = [];
    const instances = this.getInstances();
    const rows = this.ranking();
    for (const inst of instances){
      const runsForMin = inst.runtime.continuousOnMinutes||0;
      if (inst.runtime.state && inst.runtime.state!=='off' && inst.runtime.state!=='standby' && runsForMin >= 6*60){
        out.push({ level:'warning', text:I18n.t('alert.runningHours', { name: inst.customName||I18n.deviceName(inst.def), hours: Math.floor(runsForMin/60) }) });
      }
      if (inst.runtime.state === 'standby' && (inst.runtime.standbyMinutes||0) >= 16*60){
        out.push({ level:'info', text:I18n.t('alert.standbyHours', { name: inst.customName||I18n.deviceName(inst.def), hours: Math.floor((inst.runtime.standbyMinutes)/60) }) });
      }
    }
    if (rows.length && rows[0].pct > 25){
      out.push({ level:'info', text:I18n.t('alert.topShare', { name: rows[0].name, pct: rows[0].pct.toFixed(0) }) });
    }
    const washer = instances.find(i=>i.def.id==='washer');
    if (washer) out.push({ level:'tip', text:I18n.t('alert.washerTip') });
    if (sim && this.getSolarInstances().length && sim.currentGenW > sim.currentPowerW){
      out.push({ level:'tip', text:I18n.t('alert.pvSurplus', { watts: EnergyCalculator.fmtW(sim.currentGenW-sim.currentPowerW) }) });
    }
    return out.slice(0,6);
  }

  /** What-if: compares projection before/after a hypothetical schedule/power override on one instance */
  whatIf(instId, overrides){
    this.invalidateCache();
    const before = this.projections();
    const instances = this.getInstances();
    const inst = instances.find(i=>i.id===instId);
    if (!inst) return null;
    const backup = { schedule: inst.schedule, states: {...inst.def.states} };
    if (overrides.schedule) inst.schedule = ScheduleManager.validateSchedule({...inst.schedule, ...overrides.schedule});
    if (overrides.powerScale){
      const scaled = {}; for (const k in inst.def.states) scaled[k]=inst.def.states[k]*overrides.powerScale;
      inst.def = {...inst.def, states:scaled};
    }
    this.invalidateCache();
    const after = this.projections();
    inst.schedule = backup.schedule; inst.def = {...inst.def, states:backup.states};
    this.invalidateCache();
    return {
      beforeMonthKWh: before.month, afterMonthKWh: after.month,
      savingKWh: before.month-after.month,
      savingCost: before.monthCost-after.monthCost,
      savingYearCost: (before.monthCost-after.monthCost)*12,
    };
  }

  compare(instIdA, instIdB){
    const rows = this.ranking();
    const a = rows.find(r=>r.inst.id===instIdA), b = rows.find(r=>r.inst.id===instIdB);
    if (!a||!b) return null;
    const s = this.getSettings();
    const price = EnergyCalculator.effectivePrice(s);
    return { a, b,
      yearlyA: a.monthlyKWh*12, yearlyB: b.monthlyKWh*12,
      yearlyCostA: EnergyCalculator.cost(a.monthlyKWh*12, price),
      yearlyCostB: EnergyCalculator.cost(b.monthlyKWh*12, price),
    };
  }
}
