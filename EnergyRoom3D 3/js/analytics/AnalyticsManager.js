/**
 * ANALYTICS MANAGER
 * Independent from the live simulation clock: statically integrates
 * each device's schedule-driven power profile (and every PV panel's
 * sun-driven output) over a full virtual week (1-minute resolution) to
 * produce deterministic, tariff-aware projections. Cheap enough
 * (~10k evaluations for 100 devices) to recompute on demand; cached
 * briefly since the UI polls it.
 * Unity mapping: AnalyticsManager (pure C# service, no MonoBehaviour).
 */
class AnalyticsManager {
  constructor({ getInstances, getSolarInstances, getBatteryInstances, getSettings }){
    this.getInstances = getInstances;
    this.getSolarInstances = getSolarInstances || (()=>[]);
    this.getBatteryInstances = getBatteryInstances || (()=>[]);
    this.getSettings = getSettings; // {pricePerKWh, currency, extraFeesPerMonth, co2Factor, tariffMode, priceDay, priceNight, nightStart, nightEnd, cloudFactor}
  }

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
    const perWeekdayTotal = new Array(7).fill(0);
    const perWeekdayGen = new Array(7).fill(0);
    const perWeekdayCost = new Array(7).fill(0); // tariff-aware, net of generation
    const perDeviceWeekly = {}; const perDeviceDaily = {};
    for (const inst of instances){ perDeviceDaily[inst.id] = new Array(7).fill(0); perDeviceWeekly[inst.id] = 0; }

    for (let day=0; day<7; day++){
      const dayBase = day*1440;
      for (const inst of instances){
        let dayKWh = 0;
        for (let m=0; m<1440; m+=1){
          const { powerW } = ScheduleManager.resolve(inst, dayBase+m);
          dayKWh += EnergyCalculator.wattsMinutesToKWh(powerW,1);
          const rate = EnergyCalculator.priceAt(m, s);
          perWeekdayCost[day] += EnergyCalculator.wattsMinutesToKWh(powerW,1) * rate;
        }
        perDeviceDaily[inst.id][day] = dayKWh;
        perDeviceWeekly[inst.id] += dayKWh;
        perWeekdayTotal[day] += dayKWh;
      }
      for (const p of panels){
        let genKWh = 0;
        for (let m=0; m<1440; m+=5){
          const w = SolarCalculator.resolve(p, dayBase+m, s.cloudFactor);
          const kwh = EnergyCalculator.wattsMinutesToKWh(w,5);
          genKWh += kwh;
          const rate = EnergyCalculator.priceAt(m, s);
          perWeekdayCost[day] -= kwh * rate; // net metering credit at the same tariff rate
        }
        perWeekdayGen[day] += genKWh;
      }
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
    const s = this.getSettings();
    const hours = new Array(24).fill(0);
    const genHours = new Array(24).fill(0);
    for (let h=0; h<24; h++){
      for (let mm=0; mm<60; mm+=15){
        let sumW = 0, genW = 0;
        for (const inst of instances) sumW += ScheduleManager.resolve(inst, weekday*1440 + h*60 + mm).powerW;
        for (const p of panels) genW += SolarCalculator.resolve(p, weekday*1440 + h*60 + mm, s.cloudFactor);
        hours[h] += EnergyCalculator.wattsMinutesToKWh(sumW,15);
        genHours[h] += EnergyCalculator.wattsMinutesToKWh(genW,15);
      }
    }
    return { hours, genHours };
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
    const wk = this.computeWeekProjection();
    const rows = instances.map(inst=>{
      const dailyKWh = wk.perDeviceWeekly[inst.id]/7;
      const monthlyKWh = dailyKWh*30;
      return {
        inst, name: inst.customName || inst.def.name,
        currentPowerW: inst.runtime.powerW||0,
        dailyKWh, monthlyKWh,
        monthlyCost: EnergyCalculator.cost(monthlyKWh, s.pricePerKWh),
      };
    });
    const totalMonthly = rows.reduce((a,r)=>a+r.monthlyKWh,0) || 1;
    rows.forEach(r=> r.pct = (r.monthlyKWh/totalMonthly)*100);
    rows.sort((a,b)=>b.monthlyKWh-a.monthlyKWh);
    return rows;
  }

  /** Solar ranking / summary per panel */
  solarSummary(){
    const panels = this.getSolarInstances();
    const s = this.getSettings();
    const wk = this.computeWeekProjection();
    const totalPeakW = panels.reduce((a,p)=>a+p.def.peakPowerW,0);
    const currentGenW = panels.reduce((a,p)=>a - Math.min(0,p.runtime.powerW||0),0);
    return {
      count: panels.length, totalPeakW, currentGenW,
      todayGenKWh: wk.avgDailyGen, monthGenKWh: wk.avgDailyGen*30, yearGenKWh: wk.avgDailyGen*365,
      yearCredit: EnergyCalculator.cost(wk.avgDailyGen*365, s.pricePerKWh),
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

  /** Energy Score 0-100 + letter class + explanation */
  energyScore(){
    const rows = this.ranking();
    const instances = this.getInstances();
    const panels = this.getSolarInstances();
    if (!instances.length) return { score:100, grade:'A+', biggestProblem:'Brak urządzeń.', biggestOpportunity:'Dodaj urządzenia, aby zobaczyć analizę.' };
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
    const biggestProblem = topRow ? `${topRow.name} odpowiada za ${topRow.pct.toFixed(0)}% miesięcznego zużycia.`
                                   : 'Brak istotnych problemów.';
    const biggestOpportunity = worst ? `Automatyczne wyłączanie "${(worst.customName||worst.def.name)}" ze standby (${worstStandby}W) mogłoby ograniczyć zużycie jałowe.`
                                      : (panels.length ? 'Rozważ dodanie kolejnych paneli PV, aby zwiększyć autokonsumpcję.' : 'Rozważ automatyzacje wyłączające urządzenia w nocy.');
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
        out.push({ level:'warning', text:`${inst.customName||inst.def.name} działa od ${Math.floor(runsForMin/60)} godzin.` });
      }
      if (inst.runtime.state === 'standby' && (inst.runtime.standbyMinutes||0) >= 16*60){
        out.push({ level:'info', text:`${inst.customName||inst.def.name} pozostaje w standby przez ${Math.floor((inst.runtime.standbyMinutes)/60)} godzin.` });
      }
    }
    if (rows.length && rows[0].pct > 25){
      out.push({ level:'info', text:`${rows[0].name} odpowiada za ${rows[0].pct.toFixed(0)}% dzisiejszego zużycia.` });
    }
    const washer = instances.find(i=>i.def.id==='washer');
    if (washer) out.push({ level:'tip', text:'Pralka zużywa najwięcej energii podczas podgrzewania wody.' });
    if (sim && this.getSolarInstances().length && sim.currentGenW > sim.currentPowerW){
      out.push({ level:'tip', text:`Panele PV pokrywają teraz 100% zużycia i eksportują ${EnergyCalculator.fmtW(sim.currentGenW-sim.currentPowerW)} nadwyżki.` });
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
    return { a, b,
      yearlyA: a.monthlyKWh*12, yearlyB: b.monthlyKWh*12,
      yearlyCostA: EnergyCalculator.cost(a.monthlyKWh*12, s.pricePerKWh),
      yearlyCostB: EnergyCalculator.cost(b.monthlyKWh*12, s.pricePerKWh),
    };
  }
}
