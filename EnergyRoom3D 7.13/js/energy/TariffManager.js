/**
 * TARIFF MANAGER
 * Polish-style household electricity tariffs (short codes, not long
 * descriptions - spec explicitly asks for G11/G12/G12w/G13 rather than
 * "Single-zone tariff"/"Two-zone tariff"). Each tariff defines:
 *   - a set of named RATES (e.g. day/night, or peak/day/night)
 *   - a default PRICE per rate (PLN/kWh, user-editable per project)
 *   - a default SCHEDULE: which rate applies at which day+hour, using
 *     exactly the same rich per-day-multi-interval shape ScheduleManager
 *     uses for devices (so the same visual timeline editor component
 *     can edit a tariff's hours too) - fully re-configurable by the
 *     user, never hard-coded into the simulation once loaded (spec:
 *     "Nie zakładaj jednak na sztywno jednego harmonogramu").
 * A tariff's schedule only needs to mark its "special" (non-default)
 * rate windows; every minute not covered by an explicit interval falls
 * back to `defaultRate` - this mirrors how these tariffs are actually
 * marketed in Poland (G12 is sold as "two cheap windows", not as a
 * fully-enumerated 24h table) and keeps the editor focused on what
 * actually varies.
 * Pure logic - no THREE.js, no DOM.
 */
const TARIFF_CATALOG = {
  G11: {
    code: 'G11',
    nameKey: 'tariff.G11.name', shortDescKey: 'tariff.G11.desc',
    rates: [ { id:'flat', labelKey:'tariff.rate.flat', color:'#4fd1c5' } ],
    defaultRate: 'flat',
    defaultPrices: { flat: 0.89 },
    buildDefaultSchedule(){ return { enabled:true, days: emptyDays(), cycles: emptyDays() }; }, // no special windows - always `defaultRate`
  },
  G12: {
    code: 'G12',
    nameKey: 'tariff.G12.name', shortDescKey: 'tariff.G12.desc',
    rates: [ { id:'day', labelKey:'tariff.rate.day', color:'#ffb648' }, { id:'night', labelKey:'tariff.rate.night', color:'#4fd1c5' } ],
    defaultRate: 'day',
    defaultPrices: { day: 0.99, night: 0.65 },
    buildDefaultSchedule(){
      const days = emptyDays();
      for (const d of ScheduleManager.DAY_KEYS){
        days[d] = [ { start:'13:00', end:'15:00', rate:'night' }, { start:'22:00', end:'06:00', rate:'night' } ];
      }
      return { enabled:true, days, cycles: emptyDays() };
    },
  },
  G12w: {
    code: 'G12w',
    nameKey: 'tariff.G12w.name', shortDescKey: 'tariff.G12w.desc',
    rates: [ { id:'day', labelKey:'tariff.rate.day', color:'#ffb648' }, { id:'night', labelKey:'tariff.rate.night', color:'#4fd1c5' } ],
    defaultRate: 'day',
    defaultPrices: { day: 0.99, night: 0.65 },
    buildDefaultSchedule(){
      const days = emptyDays();
      for (const d of ScheduleManager.WEEKDAY_KEYS){
        days[d] = [ { start:'13:00', end:'15:00', rate:'night' }, { start:'22:00', end:'06:00', rate:'night' } ];
      }
      for (const d of ScheduleManager.WEEKEND_KEYS){
        days[d] = [ { start:'00:00', end:'23:59', rate:'night' } ]; // whole weekend at the cheap rate
      }
      return { enabled:true, days, cycles: emptyDays() };
    },
  },
  G13: {
    code: 'G13',
    nameKey: 'tariff.G13.name', shortDescKey: 'tariff.G13.desc',
    rates: [ { id:'peak', labelKey:'tariff.rate.peak', color:'#ff6b6b' }, { id:'day', labelKey:'tariff.rate.day', color:'#ffb648' }, { id:'night', labelKey:'tariff.rate.night', color:'#4fd1c5' } ],
    defaultRate: 'day',
    defaultPrices: { peak: 1.15, day: 0.95, night: 0.60 },
    buildDefaultSchedule(){
      const days = emptyDays();
      for (const d of ScheduleManager.WEEKDAY_KEYS){
        days[d] = [
          { start:'07:00', end:'10:00', rate:'peak' },
          { start:'19:00', end:'21:00', rate:'peak' },
          { start:'22:00', end:'06:00', rate:'night' },
        ];
      }
      for (const d of ScheduleManager.WEEKEND_KEYS){
        days[d] = [ { start:'22:00', end:'06:00', rate:'night' } ];
      }
      return { enabled:true, days, cycles: emptyDays() };
    },
  },
};
function emptyDays(){ const o={}; for (const d of ScheduleManager.DAY_KEYS) o[d]=[]; return o; }

const TariffManager = {
  CODES: ['G11','G12','G12w','G13'],
  list(){ return this.CODES.map(c=>TARIFF_CATALOG[c]); },
  get(code){ return TARIFF_CATALOG[code] || TARIFF_CATALOG.G11; },
  rateMeta(tariff, rateId){ return tariff.rates.find(r=>r.id===rateId) || tariff.rates[0]; },
  isFlat(code){ return this.get(code).rates.length===1; },

  /** Which rate id applies at absolute simulated minute `absMin`, given a (possibly user-customized) tariff schedule. */
  rateAt(tariff, schedule, absMin){
    const found = ScheduleManager.activeIntervalAt(schedule, absMin);
    if (found.active && found.interval.rate) return found.interval.rate;
    return tariff.defaultRate;
  },
  /** PLN/kWh price at `absMin`, given the project's per-rate price map for this tariff. */
  priceAt(tariff, prices, schedule, absMin){
    const rateId = this.rateAt(tariff, schedule, absMin);
    return (prices && prices[rateId] != null) ? prices[rateId] : tariff.defaultPrices[rateId];
  },
  /** Cheapest / most expensive configured price, for quick "this device is running in the expensive band" checks. */
  isCheapestRateAt(tariff, prices, schedule, absMin){
    const rateId = this.rateAt(tariff, schedule, absMin);
    const all = tariff.rates.map(r=> (prices&&prices[r.id]!=null) ? prices[r.id] : tariff.defaultPrices[r.id]);
    const cur = (prices&&prices[rateId]!=null) ? prices[rateId] : tariff.defaultPrices[rateId];
    return cur <= Math.min(...all) + 1e-9;
  },
  isMostExpensiveRateAt(tariff, prices, schedule, absMin){
    const rateId = this.rateAt(tariff, schedule, absMin);
    const all = tariff.rates.map(r=> (prices&&prices[r.id]!=null) ? prices[r.id] : tariff.defaultPrices[r.id]);
    const cur = (prices&&prices[rateId]!=null) ? prices[rateId] : tariff.defaultPrices[rateId];
    return cur >= Math.max(...all) - 1e-9 && all.length>1;
  },
  /** Builds a brand-new {prices, schedule} pair for a tariff code (used when switching tariffs or starting a new project). */
  freshConfig(code){
    const t = this.get(code);
    return { prices: { ...t.defaultPrices }, schedule: t.buildDefaultSchedule() };
  },
  /** Finds the next moment (absMin) at/after `fromAbsMin` when the tariff enters its cheapest configured rate -
   *  used by the pet advisor to suggest "move this device to Xh:00". Searches up to 48h ahead, 5-min resolution. */
  nextCheapWindow(tariff, prices, schedule, fromAbsMin){
    if (this.isFlat(tariff.code)) return null;
    const cheapest = Object.keys(tariff.defaultPrices).reduce((best,r)=>{
      const p = (prices&&prices[r]!=null)?prices[r]:tariff.defaultPrices[r];
      return (best==null || p<best.p) ? {r,p} : best;
    }, null);
    if (!cheapest) return null;
    for (let m=0; m<48*60; m+=5){
      const abs = fromAbsMin+m;
      if (this.rateAt(tariff, schedule, abs) === cheapest.r) return abs;
    }
    return null;
  },
};
