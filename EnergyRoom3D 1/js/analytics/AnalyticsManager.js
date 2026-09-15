/**
 * ANALYTICS MANAGER
 * Independent from the live simulation clock: statically integrates
 * each device's schedule-driven power profile over a full virtual week
 * (1-minute resolution) to produce deterministic projections. This is
 * cheap (≈10k evaluations for 100 devices) and recomputed only when
 * devices/schedules/settings change - not every frame.
 * Unity mapping: AnalyticsManager (pure C# service, no MonoBehaviour).
 */
class AnalyticsManager {
  constructor({ getInstances, getSettings }){
    this.getInstances = getInstances;
    this.getSettings = getSettings; // {pricePerKWh, currency, extraFeesPerMonth, co2Factor}
  }

  /** Integrate every instance across a virtual Mon..Sun week -> per-weekday & per-device kWh.
   *  Cached briefly (2.5s) since this is O(7*1440*devices) and gets polled by the UI. */
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
    const perWeekdayTotal = new Array(7).fill(0);
    const perDeviceWeekly = {}; // instId -> kWh/week
    const perDeviceDaily = {};  // instId -> [7] kWh
    for (const inst of instances){
      perDeviceDaily[inst.id] = new Array(7).fill(0);
      perDeviceWeekly[inst.id] = 0;
    }
    for (let day=0; day<7; day++){
      const dayBase = day*1440;
      for (const inst of instances){
        let dayKWh = 0;
        for (let m=0; m<1440; m+=1){
          const { powerW } = ScheduleManager.resolve(inst, dayBase+m);
          dayKWh += EnergyCalculator.wattsMinutesToKWh(powerW,1);
        }
        perDeviceDaily[inst.id][day] = dayKWh;
        perDeviceWeekly[inst.id] += dayKWh;
        perWeekdayTotal[day] += dayKWh;
      }
    }
    const weekTotal = perWeekdayTotal.reduce((a,b)=>a+b,0);
    const avgDaily = weekTotal/7;
    return { perWeekdayTotal, perDeviceWeekly, perDeviceDaily, weekTotal, avgDaily };
  }

  /** Coarser/faster: integrate at 15-min steps for hourly-shape chart of a given weekday */
  computeHourlyShape(weekday){
    const instances = this.getInstances();
    const hours = new Array(24).fill(0);
    for (let h=0; h<24; h++){
      for (let mm=0; mm<60; mm+=15){
        let sumW = 0;
        for (const inst of instances){
          sumW += ScheduleManager.resolve(inst, weekday*1440 + h*60 + mm).powerW;
        }
        hours[h] += EnergyCalculator.wattsMinutesToKWh(sumW,15);
      }
    }
    return hours;
  }

  projections(liveTodayKWh){
    const s = this.getSettings();
    const wk = this.computeWeekProjection();
    const today = liveTodayKWh != null ? liveTodayKWh : wk.avgDaily;
    const month = wk.avgDaily * 30;
    const year = wk.avgDaily * 365;
    return {
      today, week: wk.weekTotal, month, year,
      todayCost: EnergyCalculator.cost(today, s.pricePerKWh),
      weekCost: EnergyCalculator.cost(wk.weekTotal, s.pricePerKWh),
      monthCost: EnergyCalculator.cost(month, s.pricePerKWh, s.extraFeesPerMonth, 30, 30),
      yearCost: EnergyCalculator.cost(year, s.pricePerKWh, s.extraFeesPerMonth*12, 365, 365),
      co2Year: EnergyCalculator.co2(year, s.co2Factor),
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

  /** Energy Score 0-100 + letter class + explanation */
  energyScore(){
    const rows = this.ranking();
    const instances = this.getInstances();
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
    let score = 100 - standbyPenalty - inefficiencyPenalty - concentrationPenalty;
    score = Math.max(5, Math.min(100, Math.round(score)));
    const grade = score>=95?'A+':score>=85?'A':score>=75?'B':score>=65?'C':score>=50?'D':score>=35?'E':score>=20?'F':'G';
    const biggestProblem = topRow ? `${topRow.name} odpowiada za ${topRow.pct.toFixed(0)}% miesięcznego zużycia.`
                                   : 'Brak istotnych problemów.';
    const biggestOpportunity = worst ? `Automatyczne wyłączanie "${(worst.customName||worst.def.name)}" ze standby (${worstStandby}W) mogłoby ograniczyć zużycie jałowe.`
                                      : 'Rozważ automatyzacje wyłączające urządzenia w nocy.';
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
      savingCost: (before.month-after.month)*this.getSettings().pricePerKWh,
      savingYearCost: (before.month-after.month)*this.getSettings().pricePerKWh*12,
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
