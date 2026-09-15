/**
 * SOLAR ASSETS
 * Panels are a distinct "kind" from consumption devices: they PRODUCE
 * power instead of consuming it. Generation is computed by
 * SolarCalculator from sun position, not from a schedule.
 */
const SOLAR_DEFINITIONS = [
  { id:'panel_400', name:'Panel PV 400W', modelType:'solarpanel', manufacturer:'Generic', model:'Generic Mono PERC 400W',
    peakPowerW:400, areaM2:1.65, dataSource:'estimated',
    sourceNote:'Typowy panel monokrystaliczny 400W (STC: 1000 W/m², 25°C) — realna produkcja zależy od nasłonecznienia, kąta dachu i zachmurzenia.' },
  { id:'panel_330', name:'Panel PV 330W', modelType:'solarpanel', manufacturer:'Generic', model:'Generic Poly 330W',
    peakPowerW:330, areaM2:1.65, dataSource:'estimated',
    sourceNote:'Starszy / tańszy panel polikrystaliczny 330W.' },
  { id:'panel_450', name:'Panel PV 450W (Half-Cut)', modelType:'solarpanel', manufacturer:'Generic', model:'Generic Mono Half-Cut 450W',
    peakPowerW:450, areaM2:1.75, dataSource:'estimated',
    sourceNote:'Nowocześniejszy panel monokrystaliczny half-cut o wyższej sprawności na tej samej powierzchni.' },
];
function getSolarDefinition(id){ return SOLAR_DEFINITIONS.find(d=>d.id===id); }

// extra furniture usable in a garage room (appended to the main furniture catalog)
FURNITURE_DEFINITIONS.push(
  { id:'car',         name:'Samochód',        modelType:'car',         footprint:[1.9,4.3], onlyIn:['garage'] },
  { id:'workbench',   name:'Stół warsztatowy',modelType:'workbench',   footprint:[1.6,0.6], onlyIn:['garage'] },
  { id:'garageshelf', name:'Regał warsztatowy',modelType:'garageshelf',footprint:[1.1,0.4], onlyIn:['garage'] },
  { id:'tool_cabinet', name:'Szafka warsztatowa', modelType:'toolcabinet', footprint:[0.9,0.5], onlyIn:['garage'] },
);
