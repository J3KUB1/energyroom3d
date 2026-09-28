/**
 * BATTERY STORAGE ASSETS
 * A battery is a third "kind" alongside devices (consume) and solar
 * panels (produce): it shifts energy in time. It charges from PV
 * surplus and discharges to cover deficit, reducing grid import/export
 * (self-consumption). Unlike devices, its power draw isn't schedule
 * driven - SimulationEngine resolves it fresh every tick based on the
 * live surplus/deficit, carrying state-of-charge (kWh) between ticks.
 */
const BATTERY_DEFINITIONS = [
  { id:'battery_5', name:'Magazyn energii 5 kWh', modelType:'battery', manufacturer:'Generic', model:'Generic Home Battery 5kWh',
    capacityKWh:5, maxChargeW:2500, maxDischargeW:2500, efficiency:0.92, dataSource:'estimated',
    sourceNote:'Typowy domowy magazyn energii litowo-jonowy; sprawność ładowania/rozładowania ok. 90-95%.' },
  { id:'battery_10', name:'Magazyn energii 10 kWh', modelType:'battery', manufacturer:'Generic', model:'Generic Home Battery 10kWh',
    capacityKWh:10, maxChargeW:3600, maxDischargeW:3600, efficiency:0.93, dataSource:'estimated',
    sourceNote:'Większy magazyn, typowy dla domu z fotowoltaiką pokrywającą też wieczorne zużycie.' },
  { id:'battery_15', name:'Magazyn energii 15 kWh', modelType:'battery', manufacturer:'Generic', model:'Generic Home Battery 15kWh',
    capacityKWh:15, maxChargeW:5000, maxDischargeW:5000, efficiency:0.94, dataSource:'estimated',
    sourceNote:'Duży magazyn dla domu z fotowoltaiką i dodatkowym obciążeniem, np. ładowarką EV.' },
];
function getBatteryDefinition(id){ return BATTERY_DEFINITIONS.find(d=>d.id===id); }
