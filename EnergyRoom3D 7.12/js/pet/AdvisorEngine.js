/**
 * ADVISOR ENGINE
 * Generates the pet's contextual tips (section 16). Every rule reads
 * real data from SimulationEngine/AnalyticsManager - there is no
 * random tip generator and nothing here is templated filler unrelated
 * to the current house state. Each rule has an id + cooldown so the
 * same observation doesn't repeat every evaluation cycle; call
 * evaluate() periodically (e.g. once every simulated 15 minutes, and
 * whenever the pet panel is opened), not every tick.
 * Pure logic - returns plain tip objects; UIManager renders them.
 */
class AdvisorEngine {
  constructor(){ this._lastShown = {}; } // ruleId -> absMin last shown
  _cooldownOk(ruleId, absMin, minGapMin){ return (this._lastShown[ruleId]==null) || (absMin - this._lastShown[ruleId] >= minGapMin); }
  _mark(ruleId, absMin){ this._lastShown[ruleId] = absMin; }

  /** ctx: { sim, instances, analytics, settings, pet } */
  evaluate(ctx){
    const { sim, instances, analytics, settings, pet } = ctx;
    const tips = [];
    const absMin = sim.absMin;
    const s = settings;

    // 1) a currently-running device is sitting in the tariff's most expensive band (spec example #1)
    if (!TariffManager.isFlat(s.tariffCode) && this._cooldownOk('expensive_device', absMin, 180)){
      const running = instances.filter(i=> i.connected && i.runtime.state && i.runtime.state!=='off' && i.runtime.state!=='standby' && i.runtime.powerW>200);
      if (running.length && EnergyCalculator.isExpensiveRateAt(absMin, s)){
        const worst = running.sort((a,b)=>b.runtime.powerW-a.runtime.powerW)[0];
        const tariff = TariffManager.get(s.tariffCode);
        const schedule = s.tariffSchedules[s.tariffCode];
        const prices = s.tariffPrices[s.tariffCode];
        const nextCheap = TariffManager.nextCheapWindow(tariff, prices, schedule, absMin);
        const name = worst.customName || I18n.deviceName(worst.def);
        if (nextCheap != null){
          tips.push({ id:'expensive_device', level:'tip', text: I18n.t('advisor.expensiveDevice', { name, tariff: tariff.code, time: ScheduleManager.fromMinutes(nextCheap%1440) }) });
        } else {
          tips.push({ id:'expensive_device', level:'tip', text: I18n.t('advisor.expensiveDeviceGeneric', { name, tariff: tariff.code }) });
        }
        this._mark('expensive_device', absMin);
      }
    }

    // 2) big PV surplus right now - suggest running high-power devices (spec example #2)
    if (this._cooldownOk('pv_surplus', absMin, 120)){
      const surplus = sim.currentGenW - sim.currentPowerW;
      if (surplus > 800){
        tips.push({ id:'pv_surplus', level:'tip', text: I18n.t('advisor.pvSurplus', { watts: EnergyCalculator.fmtW(surplus) }) });
        this._mark('pv_surplus', absMin);
      }
    }

    // 3) a device has been continuously on for a long time (spec example #3, phrased as a question)
    if (this._cooldownOk('long_running', absMin, 240)){
      const longRunner = instances.find(i=> (i.runtime.continuousOnMinutes||0) >= 6*60 && i.def.category!=='agd' /* fridges etc are supposed to run continuously */);
      if (longRunner){
        const name = longRunner.customName || I18n.deviceName(longRunner.def);
        tips.push({ id:'long_running', level:'warning', text: I18n.t('advisor.longRunning', { name, hours: Math.floor(longRunner.runtime.continuousOnMinutes/60) }) });
        this._mark('long_running', absMin);
      }
    }

    // 4) consumption trending up vs last week (spec example #4) - real history-based, needs enough played days
    if (this._cooldownOk('trend_up', absMin, 1440) && pet.hasFeature('tip_trends')){
      const cmp = analytics.comparePeriods('week');
      if (!cmp.insufficientData && cmp.hasPrevious && cmp.changeConsumedPct != null && cmp.changeConsumedPct >= 15){
        tips.push({ id:'trend_up', level:'info', text: I18n.t('advisor.trendUp', { pct: cmp.changeConsumedPct.toFixed(0) }) });
        this._mark('trend_up', absMin);
      }
    }

    // 5) PV panels poorly aimed (spec example #5)
    if (this._cooldownOk('poor_aim', absMin, 720)){
      const solar = analytics.solarSummary();
      if (solar.count>0 && solar.avgAimQuality < 0.62){
        tips.push({ id:'poor_aim', level:'warning', text: I18n.t('advisor.poorAim', { pct:(solar.avgAimQuality*100).toFixed(0) }) });
        this._mark('poor_aim', absMin);
      }
    }

    // 6) seasonal PV heads-up (unlocked feature, section 18 - additive, not blocking)
    if (this._cooldownOk('season_note', absMin, 4*1440) && pet.hasFeature('tip_seasonal')){
      const season = sim.season;
      if (season==='winter'){
        tips.push({ id:'season_note', level:'info', text: I18n.t('advisor.seasonWinter') });
        this._mark('season_note', absMin);
      } else if (season==='summer'){
        tips.push({ id:'season_note', level:'info', text: I18n.t('advisor.seasonSummer') });
        this._mark('season_note', absMin);
      }
    }

    // 7) efficiency score genuinely improved since last check (unlocked feature)
    if (pet.hasFeature('tip_efficiency') && this._cooldownOk('score_improved', absMin, 1440)){
      const cur = analytics.energyScore().score;
      if (this._lastScore != null && cur > this._lastScore + 3){
        tips.push({ id:'score_improved', level:'info', text: I18n.t('advisor.scoreImproved', { delta: cur-this._lastScore }) });
        this._mark('score_improved', absMin);
      }
      this._lastScore = cur;
    }

    // 8) no PV installed yet at all - gentle nudge, not nagging (very long cooldown)
    if (this._cooldownOk('no_pv', absMin, 720)){
      if (analytics.solarSummary().count===0){
        tips.push({ id:'no_pv', level:'info', text: I18n.t('advisor.noPv') });
        this._mark('no_pv', absMin);
      }
    }

    return tips;
  }
}
