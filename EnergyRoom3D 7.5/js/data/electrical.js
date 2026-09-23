/**
 * ELECTRICAL CATALOG
 * Physical building blocks of the house installation + a realistic (PLN, PL market ballpark) price list.
 * Values are simulation assumptions, not a quote: cable ampacities follow the usual installation-method-C
 * figures for PVC-insulated copper, prices are typical retail + labour. Everything here is data only - the
 * behaviour lives in energy/ElectricalSystem.js.
 */

/** Placeable elements. They are ObjectManager instances of kind 'electrical' (so they use the same selection,
 *  gizmo, grid snapping, undo and save/load as every other object). */
const ELECTRICAL_DEFINITIONS = [
  { id:'socket',      nameKey:'elec.def.socket',      name:'Gniazdko podwójne', type:'socket',      modelType:'elsocket',
    outlets:2, ratedA:16, priceZl:18,  laborZl:55,  wallMount:true, defaultY:0.30 },
  { id:'power_strip', nameKey:'elec.def.power_strip', name:'Listwa zasilająca', type:'strip',       modelType:'elstrip',
    outlets:5, ratedA:10, priceZl:45,  laborZl:0,   wallMount:false, defaultY:0.0 },
  { id:'switchboard', nameKey:'elec.def.switchboard', name:'Rozdzielnica',      type:'board',       modelType:'elboard',
    modules:12, priceZl:260, laborZl:600, wallMount:true, defaultY:1.5 },
  { id:'meter',       nameKey:'elec.def.meter',       name:'Licznik / punkt przyłączeniowy', type:'meter', modelType:'elmeter',
    priceZl:0, laborZl:400, wallMount:true, defaultY:1.5 },
];
function getElectricalDefinition(id){ return ELECTRICAL_DEFINITIONS.find(d=>d.id===id); }

/** Installation cables (3-core, copper, PVC). ampacityA = continuous current before the cable itself overheats. */
const CABLE_TYPES = [
  { id:'ydy_3x1_5', label:'YDY 3×1,5 mm²', sectionMm2:1.5, ampacityA:15.5, priceZlPerM:3.2,  laborZlPerM:6 },
  { id:'ydy_3x2_5', label:'YDY 3×2,5 mm²', sectionMm2:2.5, ampacityA:21,   priceZlPerM:5.2,  laborZlPerM:6 },
  { id:'ydy_3x4',   label:'YDY 3×4 mm²',   sectionMm2:4,   ampacityA:28,   priceZlPerM:8.5,  laborZlPerM:7 },
  { id:'ydy_3x6',   label:'YDY 3×6 mm²',   sectionMm2:6,   ampacityA:36,   priceZlPerM:12.5, laborZlPerM:8 },
  { id:'ydy_3x10',  label:'YDY 3×10 mm²',  sectionMm2:10,  ampacityA:50,   priceZlPerM:21,   laborZlPerM:9 },
];
function getCableType(id){ return CABLE_TYPES.find(c=>c.id===id) || CABLE_TYPES[1]; }

/** Over-current protective devices (MCB). B = trips at 3-5 x In (resistive/lighting), C = 5-10 x In (motors). */
const BREAKER_RATINGS = [6, 10, 13, 16, 20, 25, 32, 40];
const BREAKER_PRICES_ZL = { 6:14, 10:16, 13:17, 16:18, 20:22, 25:26, 32:32, 40:42 };
const BREAKER_LABOR_ZL = 25;
const MAIN_BREAKER_RATINGS = [16, 20, 25, 32, 40, 50, 63];
const MAIN_BREAKER_PRICES_ZL = { 16:40, 20:44, 25:48, 32:60, 40:75, 50:95, 63:120 };

/** Fixed installation costs and constants. */
const ELECTRICAL_CONSTANTS = {
  supplyVoltageV: 230,
  copperResistivity: 0.0225,   // Ohm*mm2/m at operating temperature (~70 C)
  cableSlackFactor: 1.10,      // 10 % extra length for bends / termination
  terminationExtraM: 0.30,     // per cable end
  interRoomExtraM: 0.60,       // wall/door passage between rooms
  designLifeYears: 25,         // amortisation period of the installation for the yearly economics
  defaultSocketCircuitBreakerA: 16,
  defaultSocketCable: 'ydy_3x2_5',
  dedicatedCircuitThresholdW: 3000,  // devices rated above this get their own circuit in auto-install
};
