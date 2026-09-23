/**
 * BUILDING CATALOG
 * Physical properties of the parts the "House designer" lets you place. Values are engineering ballparks
 * (EN ISO 6946 style layer resistances, typical Polish construction) chosen so the derived quantities -
 * U-values, heat-loss coefficients, thermal mass, solar gain - are realistic, not exact to a product data sheet.
 * Behaviour lives in energy/BuildingModel.js; this file is data only.
 */

/** Wall / partition construction. lambda = W/(m K), density kg/m3, cp J/(kg K), thickness = typical m. */
const WALL_MATERIALS = {
  brick:     { id:'brick',     labelKey:'bld.mat.brick',     lambda:0.77, thickness:0.25, density:1800, cp:840, color:'#b4623f' },
  silicate:  { id:'silicate',  labelKey:'bld.mat.silicate',  lambda:0.90, thickness:0.24, density:1800, cp:840, color:'#d9d6cc' },
  aac:       { id:'aac',       labelKey:'bld.mat.aac',       lambda:0.16, thickness:0.30, density:600,  cp:1000, color:'#cfd2d4' },
  concrete:  { id:'concrete',  labelKey:'bld.mat.concrete',  lambda:1.70, thickness:0.20, density:2400, cp:880, color:'#9aa0a6' },
  timber:    { id:'timber',    labelKey:'bld.mat.timber',    lambda:0.13, thickness:0.20, density:500,  cp:1600, color:'#b08d63' },
  drywall:   { id:'drywall',   labelKey:'bld.mat.drywall',   lambda:0.25, thickness:0.10, density:900,  cp:1000, color:'#ececec' }, // partitions
};
const WALL_INSULATION_LAMBDA = 0.038;   // EPS / mineral wool, W/(m K)

/** Glazing of windows. u = centre-of-glass U (W/m2K), g = solar heat-gain coefficient (0..1). */
const GLAZING_TYPES = {
  single: { id:'single', labelKey:'bld.glz.single', u:5.0, g:0.85, tint:0xd8ecff, opacity:0.22 },
  double: { id:'double', labelKey:'bld.glz.double', u:1.1, g:0.60, tint:0xbfe0ff, opacity:0.28 },
  triple: { id:'triple', labelKey:'bld.glz.triple', u:0.7, g:0.50, tint:0xa8d4f7, opacity:0.34 },
};
const WINDOW_FRAME = { u:1.4, glassFraction:0.75 };   // overall window U = 0.75*Ug + 0.25*Uf

/** Door leaves. u = W/m2K of the closed door; leakage = extra air changes it adds while closed (m3/h per m2). */
const DOOR_TYPES = {
  interior:  { id:'interior',  labelKey:'bld.door.interior',  u:2.0, leakage:6,  color:0x8a6a48 },
  exterior:  { id:'exterior',  labelKey:'bld.door.exterior',  u:1.4, leakage:3,  color:0x5a3d28 },
  insulated: { id:'insulated', labelKey:'bld.door.insulated', u:0.9, leakage:1.5, color:0x4a4f57 },
  garage:    { id:'garage',    labelKey:'bld.door.garage',    u:1.6, leakage:10, color:0xd8dade },
};

/** Roof / slab build-ups: base resistance without insulation, then insulation cm are added on top. */
const ROOF_TYPES = {
  none: { id:'none', labelKey:'bld.roof.none', pv:false },
  flat: { id:'flat', labelKey:'bld.roof.flat', pv:false },
  mono: { id:'mono', labelKey:'bld.roof.mono', pv:true },
  gable:{ id:'gable',labelKey:'bld.roof.gable',pv:true },
};
const CONSTRUCTION = {
  wallThicknessVisualM: 0.10,      // drawn thickness (thermal calculation uses the real material thickness)
  slabThicknessM: 0.25,            // storey slab (structure + finishes) between levels
  rsiWall: 0.13, rseWall: 0.04,    // surface resistances (interior / exterior), m2K/W
  rsiFloor: 0.17, rsiCeiling: 0.10,
  roofBaseR: 0.30,                 // roof deck without insulation
  slabConcreteLambda: 1.7, slabConcreteThickness: 0.20,
  groundFactor: 0.6,               // ground stays warmer than the air: heat loss to ground uses 0.6 x (Tin - Tout)
  infiltrationACH: 0.5,            // closed-house air changes per hour
  airHeatCapacityWhM3K: 0.34,      // volumetric heat capacity of air, Wh/(m3 K)
  openAirflowM3hPerM2: 400,        // air exchanged through a fully open opening, m3/h per m2
  effectiveMassDepthM: 0.10,       // depth of a wall that takes part in daily heat storage
  defaultWallInsulationCm: 10, defaultFloorInsulationCm: 8, defaultRoofInsulationCm: 20,
  adjacencyTolM: 0.12, minOverlapM: 0.30,
  riserM: 0.18, treadM: 0.27, stairWidthM: 0.9,
  doorMinM: 0.7, doorMaxM: 3.6, windowMinM: 0.3, openingEdgeM: 0.15,
};

/** Extra room types introduced by the designer (the original six stay in ProjectManager.ROOM_TYPE_META). */
const OUTDOOR_ROOM_TYPES = ['balcony', 'terrace', 'garden'];
const EXTRA_ROOM_TYPE_META = {
  utility:  { icon:'🧺', defaults:{ width:3.0, length:2.6, height:2.6, floor:'Concrete', wall:'Gray',  ceiling:'White' } },
  basement: { icon:'⬇',  defaults:{ width:6.0, length:5.0, height:2.5, floor:'Concrete', wall:'Concrete', ceiling:'White' } },
  balcony:  { icon:'🌿', defaults:{ width:3.0, length:1.4, height:1.1, floor:'Tile',     wall:'Gray',  ceiling:'White' }, outdoor:true },
  terrace:  { icon:'⛱',  defaults:{ width:5.0, length:3.5, height:1.0, floor:'Wood',     wall:'Gray',  ceiling:'White' }, outdoor:true },
  garden:   { icon:'🌳', defaults:{ width:8.0, length:6.0, height:1.0, floor:'Concrete', wall:'Gray',  ceiling:'White' }, outdoor:true },
};
