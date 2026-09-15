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
