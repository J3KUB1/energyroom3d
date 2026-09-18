/**
 * ENERGY CALCULATOR
 * Pure math module. Unity mapping: EnergySystem (static utility class).
 * Energy [kWh] = Power [kW] x Time [h]     (integrated per device state)
 */
const EnergyCalculator = {
  /** watts * minutes -> kWh */
  wattsMinutesToKWh(watts, minutes){
    return (watts / 1000) * (minutes / 60);
  },
  cost(kWh, pricePerKWh, extraFeesPerMonth=0, daysInPeriod=1, periodDays=30){
    const energyCost = kWh * pricePerKWh;
    const feeShare = periodDays>0 ? (extraFeesPerMonth * (daysInPeriod/periodDays)) : 0;
    return energyCost + feeShare;
  },
  /** Tariff+schedule-aware price (PLN/kWh) at an ABSOLUTE simulated minute (day-of-week aware,
   *  e.g. G12w charges the cheap rate all weekend). `settings` is the project's energySettings,
   *  which carries {tariffCode, tariffPrices:{code:{rate:price}}, tariffSchedules:{code:richSchedule}}. */
  priceAt(absMin, settings){
    const s = settings || {};
    const tariff = TariffManager.get(s.tariffCode || 'G11');
    const schedule = (s.tariffSchedules && s.tariffSchedules[tariff.code]) || tariff.buildDefaultSchedule();
    const prices = (s.tariffPrices && s.tariffPrices[tariff.code]) || tariff.defaultPrices;
    return TariffManager.priceAt(tariff, prices, schedule, absMin);
  },
  /** Effective blended PLN/kWh for the tariff as currently configured - averages all rates evenly.
   *  Used only by quick device-ranking estimates that don't need per-minute precision. */
  effectivePrice(settings){
    const s = settings || {};
    const tariff = TariffManager.get(s.tariffCode || 'G11');
    const prices = (s.tariffPrices && s.tariffPrices[tariff.code]) || tariff.defaultPrices;
    const vals = tariff.rates.map(r=> prices[r.id] != null ? prices[r.id] : tariff.defaultPrices[r.id]);
    return vals.reduce((a,b)=>a+b,0) / (vals.length||1);
  },
  /** True if `absMin` currently sits in the tariff's cheapest configured rate window. */
  isCheapRateAt(absMin, settings){
    const s = settings || {};
    const tariff = TariffManager.get(s.tariffCode || 'G11');
    const schedule = (s.tariffSchedules && s.tariffSchedules[tariff.code]) || tariff.buildDefaultSchedule();
    const prices = (s.tariffPrices && s.tariffPrices[tariff.code]) || tariff.defaultPrices;
    return !TariffManager.isFlat(tariff.code) && TariffManager.isCheapestRateAt(tariff, prices, schedule, absMin);
  },
  isExpensiveRateAt(absMin, settings){
    const s = settings || {};
    const tariff = TariffManager.get(s.tariffCode || 'G11');
    const schedule = (s.tariffSchedules && s.tariffSchedules[tariff.code]) || tariff.buildDefaultSchedule();
    const prices = (s.tariffPrices && s.tariffPrices[tariff.code]) || tariff.defaultPrices;
    return !TariffManager.isFlat(tariff.code) && TariffManager.isMostExpensiveRateAt(tariff, prices, schedule, absMin);
  },
  co2(kWh, factorKgPerKWh){
    return kWh * factorKgPerKWh;
  },
  fmtW(w){
    if (w >= 1000) return (w/1000).toFixed(2) + ' kW';
    return Math.round(w) + ' W';
  },
  fmtKWh(k){ return k.toFixed(2) + ' kWh'; },
  fmtCost(v, currency){ return v.toFixed(2) + ' ' + (currency||'PLN'); },
};
