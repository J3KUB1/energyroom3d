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
  /** Tariff-aware price for a given minute-of-day (0..1439). tariff={mode:'flat'|'dual', pricePerKWh, priceDay, priceNight, nightStart, nightEnd} */
  priceAt(minuteOfDay, tariff){
    if (!tariff || tariff.mode !== 'dual') return (tariff&&tariff.pricePerKWh) || 1;
    const toMin = (hhmm)=>{ const [h,m]=hhmm.split(':').map(Number); return h*60+m; };
    const s = toMin(tariff.nightStart||'22:00'), e = toMin(tariff.nightEnd||'06:00');
    const inNight = s<e ? (minuteOfDay>=s && minuteOfDay<e) : (minuteOfDay>=s || minuteOfDay<e);
    return inNight ? tariff.priceNight : tariff.priceDay;
  },
  isNightRate(minuteOfDay, tariff){
    if (!tariff || tariff.mode!=='dual') return false;
    const toMin = (hhmm)=>{ const [h,m]=hhmm.split(':').map(Number); return h*60+m; };
    const s = toMin(tariff.nightStart||'22:00'), e = toMin(tariff.nightEnd||'06:00');
    return s<e ? (minuteOfDay>=s && minuteOfDay<e) : (minuteOfDay>=s || minuteOfDay<e);
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
