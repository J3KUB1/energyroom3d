const { createContext, test, assert, near, summary } = require('./harness');
const ctx = createContext();
const $ = ctx.$;
console.log('Stage 1 - PV order / shading / battery limits');

function mkEngine(opts){
  opts = opts || {};
  const settings = Object.assign($('freshEnergySettings()'), { batteryReservePct:0 }, opts.settings||{});
  const batteries = (opts.batteries||[]).map((soc,i)=>({ id:'b'+i, kind:'battery', connected:true,
    def:{capacityKWh:10,maxChargeW:3000,maxDischargeW:3000,efficiency:1.0}, runtime:{ socKWh:soc } }));
  const eng = $('new SimulationEngine({ getInstances:()=>__inst, getSolarInstances:()=>__solar, getBatteryInstances:()=>__batt, getSettings:()=>__set, getStartDate:()=>new Date(2026,5,21) })');
  ctx.__batt = batteries; ctx.__set = settings; ctx.__inst = []; ctx.__solar = [];
  return { eng, settings, batteries };
}
// helper: a fresh engine bound to given globals
function engine(opts){
  const e = mkEngine(opts);
  return e;
}
const ORDERS = [['home','battery','grid'],['home','grid','battery'],['battery','home','grid'],['battery','grid','home'],['grid','home','battery'],['grid','battery','home']];

function run(order, loadW, pvW, opts){
  const { eng, settings, batteries } = engine(Object.assign({batteries:[5]}, opts||{}));
  settings.pvOrder = order; Object.assign(settings, (opts&&opts.settings)||{});
  const r = eng._allocate(loadW, pvW, settings, false);
  return { r, batteries, eng };
}
function balance(r, loadW, pvW){
  // grid import - grid export == load - unserved - delivered PV + battery net
  const delivered = pvW - r.curtailedW;
  const lhs = r.flows.gridToHome - r.flows.pvToGrid;
  const rhs = loadW - r.unservedW - delivered + r.batteryNetW;
  near(lhs, rhs, 1e-6, 'energy balance');
}

test('normalizePvOrder: valid array kept, legacy strings mapped, garbage falls back', ()=>{
  const N = (o,l)=>$('SimulationEngine').normalizePvOrder(o,l);
  assert(JSON.stringify(N(['grid','home','battery']))==='["grid","home","battery"]');
  assert(JSON.stringify(N(undefined,'battery_first'))==='["battery","home","grid"]');
  assert(JSON.stringify(N(undefined,'home_first'))==='["home","battery","grid"]');
  assert(JSON.stringify(N(['home','home','grid'],'battery_first'))==='["battery","home","grid"]');
  assert(JSON.stringify(N(['x'],undefined))==='["home","battery","grid"]');
});

test('all 6 orders conserve energy (surplus case)', ()=>{
  for (const o of ORDERS){ const {r} = run(o, 800, 3000); balance(r, 800, 3000); }
});
test('all 6 orders conserve energy (deficit case)', ()=>{
  for (const o of ORDERS){ const {r} = run(o, 2500, 600); balance(r, 2500, 600); }
});

test('home first: PV covers home, then battery, then export', ()=>{
  const {r} = run(['home','battery','grid'], 1000, 4000);
  near(r.flows.pvToHome, 1000); near(r.flows.pvToBattery, 3000); near(r.flows.pvToGrid, 0);
  // battery limited to 3000W charge -> remaining 0 to grid
  const r2 = run(['home','battery','grid'], 1000, 6000).r;
  near(r2.flows.pvToBattery, 3000); near(r2.flows.pvToGrid, 2000);
});
test('home -> grid -> battery: surplus exported before the battery sees it', ()=>{
  const {r} = run(['home','grid','battery'], 1000, 4000);
  near(r.flows.pvToHome, 1000); near(r.flows.pvToGrid, 3000); near(r.flows.pvToBattery, 0);
});
test('battery first: battery charges before home, home deficit then from grid (battery is charging)', ()=>{
  const {r} = run(['battery','home','grid'], 2000, 3500);
  near(r.flows.pvToBattery, 3000); near(r.flows.pvToHome, 500); near(r.flows.gridToHome, 1500);
  near(r.flows.batteryToHome, 0, 1e-9, 'no simultaneous charge+discharge');
});
test('grid first: everything exported (no limit), home served by import, battery idle-> discharges to help home', ()=>{
  const {r} = run(['grid','home','battery'], 1500, 2000);
  near(r.flows.pvToGrid, 2000); near(r.flows.pvToHome, 0);
  // battery (5 kWh, 3 kW max) covers home deficit, no import needed
  near(r.flows.batteryToHome, 1500); near(r.flows.gridToHome, 0);
});
test('battery -> grid -> home: home last gets only leftovers', ()=>{
  const {r} = run(['battery','grid','home'], 1000, 5000);
  near(r.flows.pvToBattery, 3000); near(r.flows.pvToGrid, 2000); near(r.flows.pvToHome, 0);
  near(r.flows.gridToHome, 1000);
});

test('export limit 0 W: surplus that cannot go anywhere is curtailed, not exported', ()=>{
  const {r} = run(['home','battery','grid'], 500, 6000, { batteries:[10], settings:{ exportLimitW:0 } });
  // battery full (soc==cap) -> no headroom; home 500; grid capped at 0 -> curtail 5500
  near(r.flows.pvToGrid, 0); near(r.curtailedW, 5500); balance(r, 500, 6000);
});
test('export limit 1500 W caps export and curtails the rest', ()=>{
  const {r} = run(['home','grid','battery'], 500, 6000, { batteries:[10], settings:{ exportLimitW:1500 } });
  near(r.flows.pvToGrid, 1500); near(r.curtailedW, 4000);
});
test('grid outage: no export, no import, unserved load reported', ()=>{
  const { eng, settings } = engine({ batteries:[0] });
  eng.gridOnline = false; settings.pvOrder = ['grid','home','battery'];
  const r = eng._allocate(1200, 800, settings, false);
  near(r.flows.pvToGrid, 0); near(r.flows.gridToHome, 0);
  near(r.flows.pvToHome, 800); near(r.unservedW, 400);
});
test('battery reserve SOC is respected on discharge', ()=>{
  const { eng, settings, batteries } = engine({ batteries:[1.0] });   // 10 % of 10 kWh
  settings.batteryReservePct = 10; settings.pvOrder = ['home','battery','grid'];
  const r = eng._allocate(1000, 0, settings, false);
  near(r.flows.batteryToHome, 0); near(r.flows.gridToHome, 1000);
});
test('battery discharge limited by SOC in one minute; SOC actually mutated when accumulating', ()=>{
  const { eng, settings, batteries } = engine({ batteries:[0.01] });  // 10 Wh
  settings.pvOrder = ['home','battery','grid'];
  const r = eng._allocate(3000, 0, settings, true);
  near(r.flows.batteryToHome, 600, 1e-6, '10Wh in one minute = 600W');
  near(batteries[0].runtime.socKWh, 0, 1e-9);
});
test('battery efficiency loses energy: charging 1 kWh-in stores less', ()=>{
  const { eng, settings, batteries } = engine({ batteries:[0] });
  batteries[0].def.efficiency = 0.9; settings.pvOrder = ['home','battery','grid'];
  for (let i=0;i<60;i++) eng._allocate(0, 1000, settings, true);   // 1 kW for one hour
  near(batteries[0].runtime.socKWh, 0.9, 1e-6);
});
test('legacy home_first/battery_first (no pvOrder) still work via migration mapping', ()=>{
  const { eng, settings } = engine({ batteries:[5] });
  delete settings.pvOrder; settings.pvPriority = 'battery_first';
  const r = eng._allocate(1000, 2000, settings, false);
  near(r.flows.pvToBattery, 2000);
});
test('legacy behaviour preserved: default order, no limits == old surplus/deficit maths', ()=>{
  const { eng, settings, batteries } = engine({ batteries:[5] });
  settings.pvOrder = ['home','battery','grid'];
  const surplus = eng._allocate(400, 2900, settings, false);   // old: net=-2500 -> charge 2500
  near(surplus.batteryNetW, 2500); near(surplus.flows.pvToGrid, 0);
  const deficit = eng._allocate(3500, 500, settings, false);   // old: net=+3000 -> discharge 3000
  near(deficit.batteryNetW, -3000); near(deficit.flows.gridToHome, 0);
});

// ---------------- shading ----------------
console.log('Stage 1 - shading');
function panelGeom(x, y, z, roomId){
  return { center:[x,y,z], u:[1,0,0], n:[0,1,0], v:[0,0,1], halfW:0.5, halfL:0.825, halfT:0.03, roomId };
}
test('unobstructed flat panel: factor 1 at noon sun', ()=>{
  const sm = $('new ShadeModel()'); sm.setPanel('p', panelGeom(0,3,0));
  near(sm.factor('p', 60, 180), 1);
});
test('wall to the south casts a shadow at low sun, none at high sun', ()=>{
  const sm = $('new ShadeModel()');
  // 6 m wide, 6 m tall wall, 2 m south of the panel (+Z is south)
  sm.setStaticOccluders([ $('ShadeModel').box([-3,0,1.5],[3,6,2.0]) ]);
  sm.setPanel('p', panelGeom(0,0.5,0));
  near(sm.factor('p', 15, 180), 0, 1e-9, 'low sun fully blocked');
  near(sm.factor('p', 88, 180), 1, 1e-9, 'near-zenith sun clears the wall');
});
test('partial shading: shadow edge crosses the panel -> fractional factor', ()=>{
  const sm = $('new ShadeModel()');
  // low wall 1.0 m tall, at z = 1.0..1.1; panel spans z=-0.825..0.825 at y=0
  sm.setStaticOccluders([ $('ShadeModel').box([-3,0,1.0],[3,1.0,1.1]) ]);
  sm.setPanel('p', panelGeom(0,0.0,0));
  // sun 30 deg high from the south: shadow of the wall top (h=1.0) reaches back 1.0/tan(30)=1.73 m => covers whole panel
  const full = sm.factor('p', 30, 180);
  // sun 45: reaches back 1.0 m from wall base z=1.0 -> covers z>0.0 (the south half)
  const half = sm.factor('p', 45, 180);
  assert(full < 0.01, 'expected ~0, got '+full);
  assert(half > 0.3 && half < 0.8, 'expected partial, got '+half);
});
test('another panel in front shades the one behind it', ()=>{
  const sm = $('new ShadeModel()');
  const front = panelGeom(0, 1.5, 1.0); front.n=[0,1,0];
  // steeply tilted front panel (tilted 60deg) blocks a low sun
  const t=60*Math.PI/180; front.n=[0,Math.cos(t),Math.sin(t)]; front.v=[0,-Math.sin(t),Math.cos(t)];
  sm.setPanel('front', front);
  sm.setPanel('back', panelGeom(0,0.4,-0.2));
  const f = sm.factor('back', 20, 180);
  assert(f < 1, 'back panel should be at least partly shaded, got '+f);
});
test('deciduous tree: winter lets more beam through than summer', ()=>{
  const sm = $('new ShadeModel()');
  const T = $('ShadeModel.TREE_TRANSMIT');
  sm.setStaticOccluders([ $('ShadeModel').sphere([0,2.0,3.0],1.0,{ transmitBySeason:T }) ]);
  sm.setPanel('p', panelGeom(0,0.5,0));
  // direction from panel to sun passes through crown at elevation ~ atan((2-0.5)/3)=26.6 deg
  sm.setSeason('summer'); const s = sm.factor('p', 27, 180);
  sm.setSeason('winter'); const w = sm.factor('p', 27, 180);
  assert(s < 0.35, 'summer '+s); assert(w > 0.6, 'winter '+w); assert(w > s);
});
test('a panel is never shaded by its own roof', ()=>{
  const sm = $('new ShadeModel()');
  sm.setStaticOccluders([ $('ShadeModel').box([-5,2,-5],[5,2.2,5],{ ownerRoomId:'garage', isRoof:true }) ]);
  sm.setPanel('p', panelGeom(0,2.25,0,'garage'));
  near(sm.factor('p', 5, 180), 1);
});
test('panel facing away from the sun gets 0 direct beam', ()=>{
  const sm = $('new ShadeModel()'); const g = panelGeom(0,3,0);
  const t=80*Math.PI/180; g.n=[0,Math.cos(t),-Math.sin(t)]; g.v=[0,Math.sin(t),Math.cos(t)];
  sm.setPanel('p', g);
  near(sm.factor('p', 10, 180), 0);
});
test('cache: repeated queries do not re-cast rays; geometry change invalidates', ()=>{
  const sm = $('new ShadeModel()');
  sm.setStaticOccluders([ $('ShadeModel').box([-3,0,1.5],[3,6,2.0]) ]);
  sm.setPanel('p', panelGeom(0,0.5,0));
  sm.factor('p', 20, 180); const r1 = sm.stats.rayCasts;
  for (let i=0;i<1000;i++) sm.factor('p', 20, 180);
  assert(sm.stats.rayCasts === r1, 'no new rays expected');
  sm.setPanel('p', panelGeom(0,0.6,0));
  sm.factor('p', 20, 180); assert(sm.stats.rayCasts > r1, 'invalidated after move');
});

test('SolarCalculator: shaded panel produces less; diffuse light keeps a floor; no shade model = legacy', ()=>{
  const SC = $('SolarCalculator');
  const panel = { id:'p', connected:true, def:{peakPowerW:400}, pvOrientation:{tiltDeg:35,azimuthDeg:180} };
  const noon = 12*60, doy = 172;
  SC.shadeModel = null;
  const free = SC.resolve(panel, noon, doy, 1);
  const sm = $('new ShadeModel()');
  sm.setStaticOccluders([ $('ShadeModel').box([-20,0,0.2],[20,30,0.4]) ]);   // giant wall right in front, blocks everything
  sm.setPanel('p', panelGeom(0,1,-3));
  // orient panel geometry like the real panel: tilt 35 facing south (normal has +Z component)
  const t=35*Math.PI/180; const g = sm.panels.get('p'); g.n=[0,Math.cos(t),Math.sin(t)]; g.v=[0,-Math.sin(t),Math.cos(t)];
  sm.setPanel('p', g);
  SC.shadeModel = sm;
  const shaded = SC.resolve(panel, noon, doy, 1);
  assert(free > 250, 'sanity free '+free);
  assert(shaded < free*0.2 && shaded > free*0.05, `shaded ${shaded} vs free ${free} (diffuse floor ~12%)`);
  // overcast: shade matters much less
  const freeOc = (SC.shadeModel=null, SC.resolve(panel, noon, doy, 0.25));
  SC.shadeModel = sm; const shadedOc = SC.resolve(panel, noon, doy, 0.25);
  assert(shadedOc/freeOc > shaded/free, 'shade hurts less under overcast');
  SC.shadeModel = null;
});

summary();
