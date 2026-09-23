const { createContext, test, assert, near, summary } = require('./harness');
const ctx = createContext();
const $ = ctx.$;
console.log('Stage 1 - integration (engine + shading + save format + day/night)');

function build(opts){
  opts = opts || {};
  const D = (id)=>{ const def = $(`getDeviceDefinition('${id}')`);
    return { id:'d_'+id, kind:'device', defId:id, def, roomId:'main', connected:true, manualOverride:'on', stats:{ energyYearKWh:0 }, schedule:$('ScheduleManager').validateSchedule(def.defaultSchedule), runtime:{ state:'off', powerW:0 } }; };
  const devices = (opts.devices || ['fridge','tv_55','ceiling_lamp']).map(D);
  const panels = [];
  for (let i=0;i<(opts.panels==null?6:opts.panels);i++){
    panels.push({ id:'p'+i, kind:'solar', defId:'panel_400', def:$("getSolarDefinition('panel_400')"), roomId:'garage', connected:true,
      pvOrientation:{ tiltDeg:12, azimuthDeg:180 }, runtime:{ powerW:0, state:'idle' } });
  }
  const batt = opts.battery === false ? [] : [{ id:'b0', kind:'battery', connected:true, def:$("getBatteryDefinition('battery_10')"), runtime:{ socKWh:5 } }];
  const settings = Object.assign($('freshEnergySettings()'), { batteryReservePct:0 }, opts.settings||{});
  ctx.__d = devices; ctx.__p = panels; ctx.__b = batt; ctx.__s = settings;
  const eng = $('new SimulationEngine({ getInstances:()=>__d, getSolarInstances:()=>__p, getBatteryInstances:()=>__b, getSettings:()=>__s, getStartDate:()=>new Date(2026,0,1) })');
  return { eng, devices, panels, batt, settings };
}
function panelGeom(x,y,z){ const t=12*Math.PI/180; return { center:[x,y,z], u:[1,0,0], n:[0,Math.cos(t),Math.sin(t)], v:[0,-Math.sin(t),Math.cos(t)], halfW:0.5, halfL:0.825, halfT:0.03, roomId:'garage' }; }

test('engine energy balance holds every minute for a full day with battery + PV (all 6 orders)', ()=>{
  const orders = [['home','battery','grid'],['home','grid','battery'],['battery','home','grid'],['battery','grid','home'],['grid','home','battery'],['grid','battery','home']];
  for (const o of orders){
    const { eng, settings } = build({ settings:{ pvOrder:o } });
    eng.absMin = 172*1440 + 6*60; // a summer day
    for (let i=0;i<24*60;i++){
      eng._stepOneMinute();
      const f = eng.flows;
      const lhs = f.gridToHome - f.pvToGrid;
      const rhs = eng.currentPowerW - eng.currentUnservedW - eng.currentGenW + eng.currentBatteryW;
      if (Math.abs(lhs-rhs) > 1e-6) throw new Error(`balance broke for ${o.join('>')} at minute ${i}: ${lhs} vs ${rhs}`);
      if (eng.currentGenW > eng.currentGenPotentialW + 1e-6) throw new Error('delivered PV > potential');
    }
  }
});

test('the chosen order changes the outcome: grid-first exports more and stores less than battery-first', ()=>{
  const run = (o)=>{ const { eng, batt } = build({ settings:{ pvOrder:o }, panels:10 }); eng.absMin = 172*1440 + 5*60;
    let exp = 0; for (let i=0;i<20*60;i++){ eng._stepOneMinute(); exp += eng.flows.pvToGrid/60000; } return { exp, soc:batt[0].runtime.socKWh, imp: eng.totalImportKWh }; };
  const gridFirst = run(['grid','home','battery']), battFirst = run(['battery','home','grid']);
  assert(gridFirst.exp > battFirst.exp + 1, `export ${gridFirst.exp} vs ${battFirst.exp}`);
  assert(battFirst.soc > gridFirst.soc, `soc ${battFirst.soc} vs ${gridFirst.soc}`);
});

test('shading really lowers daily PV kWh (engine level) and is visible per panel', ()=>{
  const sm = $('new ShadeModel()'); $('SolarCalculator').shadeModel = sm;
  const { eng, panels } = build({ battery:false, devices:['fridge'] });
  for (let i=0;i<panels.length;i++) sm.setPanel(panels[i].id, panelGeom(i*1.2, 2.4, 0));
  const day = ()=>{ eng.absMin = 172*1440 + 1; const before = eng.totalSolarKWh; for (let i=0;i<1400;i++) eng._stepOneMinute(); return eng.totalSolarKWh - before; };
  const free = day();
  // a tall wall 0.6 m south of the row shades panels at low sun; panel 0..1 more than the rest via a shorter/closer wall segment
  sm.setStaticOccluders([ $('ShadeModel').box([-1,0,0.5],[2.4,4.5,0.8]) ]);
  const shaded = day();
  assert(shaded < free * 0.95, `shaded ${shaded} vs free ${free}`);
  const levels = panels.map(p => p.runtime.directAccess);
  assert(levels.every(v => v >= 0 && v <= 1), 'levels in range');
  $('SolarCalculator').shadeModel = null;
});

test('per-panel different shade (100% / partial / 0%) as in the spec example', ()=>{
  const sm = $('new ShadeModel()');
  sm.setStaticOccluders([ $('ShadeModel').box([1.6,0,-3],[2.4,4,3]) ]);   // a 4 m pillar; morning sun from the east throws its shadow west
  sm.setPanel('a', panelGeom(-9,2,0)); sm.setPanel('b', panelGeom(-2.2,2,0)); sm.setPanel('c', panelGeom(1.0,2,0));
  // morning sun from the east (az 100, el 25): pillar shadows the panels close to it
  const fa = sm.factor('a', 25, 100), fb = sm.factor('b', 25, 100), fc = sm.factor('c', 25, 100);
  assert(fa > 0.99, 'far panel unshaded '+fa);
  assert(fb < fa, 'nearer panel shaded '+fb);
  assert(fc <= fb, 'adjacent panel shaded most '+[fa,fb,fc]);
  console.log('       direct access a/b/c = '+[fa,fb,fc].map(v=>Math.round(v*100)+'%').join(' / '));
});

test('365-day simulation completes, stays finite and fast (shade cache)', ()=>{
  const sm = $('new ShadeModel()'); $('SolarCalculator').shadeModel = sm;
  sm.setStaticOccluders([ $('ShadeModel').box([-2,0,1.5],[10,3.2,2.0]), $('ShadeModel').sphere([5,3,4],1.2,{ transmitBySeason:$('ShadeModel.TREE_TRANSMIT') }) ]);
  const { eng, panels } = build({ panels:8, settings:{ pvOrder:['home','battery','grid'], exportLimitW:3000 } });
  for (let i=0;i<panels.length;i++) sm.setPanel(panels[i].id, panelGeom(i*1.1, 2.4, 0));
  const t0 = Date.now();
  eng.skipDays(365);
  const ms = Date.now() - t0;
  assert(Number.isFinite(eng.totalSolarKWh) && eng.totalSolarKWh > 500, 'solar '+eng.totalSolarKWh);
  assert(Number.isFinite(eng.totalImportKWh) && eng.totalImportKWh > 0);
  assert(eng.history.length > 300, 'history '+eng.history.length);
  assert(sm.stats.cacheHits > 100*sm.stats.cacheMisses / 100, 'cache used');
  assert(sm.stats.rayCasts < 4e6, 'ray budget '+sm.stats.rayCasts);
  console.log(`       365 days: ${ms} ms, PV ${eng.totalSolarKWh.toFixed(0)} kWh, import ${eng.totalImportKWh.toFixed(0)} kWh, rays ${sm.stats.rayCasts}, cacheHits ${sm.stats.cacheHits}`);
  assert(ms < 60000, 'too slow: '+ms);
  $('SolarCalculator').shadeModel = null;
});

// ---------------- save format ----------------
console.log('Stage 1 - project format migration');
const mig = (raw)=> { ctx.__raw = raw; return $('migrateEnergySettings(__raw)'); };
test('v3 save with battery_first -> pvOrder [battery, home, grid], reserve 0, no limits', ()=>{
  const m = mig({ pvPriority:'battery_first', tariffCode:'G11' });
  assert(JSON.stringify(m.pvOrder)==='["battery","home","grid"]', JSON.stringify(m.pvOrder));
  assert(m.batteryReservePct===0 && m.exportLimitW===null && m.importLimitW===null);
  assert(m.pvPriority==='battery_first');
});
test('v3 save with home_first / missing -> [home, battery, grid]', ()=>{
  assert(JSON.stringify(mig({pvPriority:'home_first'}).pvOrder)==='["home","battery","grid"]');
  assert(JSON.stringify(mig({}).pvOrder)==='["home","battery","grid"]');
  assert(JSON.stringify(mig(undefined).pvOrder)==='["home","battery","grid"]');
});
test('v4 save keeps its custom order, limits and reserve; pvPriority mirror follows slot 1', ()=>{
  const m = mig({ pvOrder:['grid','battery','home'], exportLimitW:1500, importLimitW:8000, batteryReservePct:15 });
  assert(JSON.stringify(m.pvOrder)==='["grid","battery","home"]' && m.exportLimitW===1500 && m.importLimitW===8000 && m.batteryReservePct===15);
  assert(m.pvPriority==='home_first');
});
test('corrupt pvOrder falls back safely', ()=>{
  assert(JSON.stringify(mig({ pvOrder:['home','home','x'], pvPriority:'battery_first' }).pvOrder)==='["battery","home","grid"]');
});
test('serialize -> JSON -> deserialize round-trips energy settings + current save version (6)', ()=>{
  ctx.__energy = $('freshEnergySettings()'); ctx.__energy.pvOrder = ['battery','grid','home']; ctx.__energy.exportLimitW = 2000;
  ctx.__house = $('defaultHouseState()');
  ctx.__om = { getAll:()=>[], clear(){} };
  ctx.__auto = { rules:[] };
  const pm = $(`new ProjectManager({ objectManager:__om, getHouseState:()=>__house, setHouseState:h=>{__house=h}, getEnergySettings:()=>__energy, setEnergySettings:e=>{__energy=e}, automationManager:__auto, simulationEngine:null, rebuildHouse:()=>{}, onLog:()=>{} })`);
  const json = JSON.parse(JSON.stringify(pm.serialize()));
  assert(json.version === 6, 'version '+json.version);
  ctx.__energy = $('freshEnergySettings()');            // wipe, then load
  pm.deserialize(json);
  assert(JSON.stringify(ctx.$('__energy.pvOrder'))==='["battery","grid","home"]');
  assert(ctx.$('__energy.exportLimitW')===2000);
});
test('a genuine v3 project JSON (no pvOrder, no version-4 fields) still loads', ()=>{
  ctx.__energy = $('freshEnergySettings()'); ctx.__house = $('defaultHouseState()'); ctx.__om = { getAll:()=>[], clear(){} }; ctx.__auto={rules:[]};
  const pm = $(`new ProjectManager({ objectManager:__om, getHouseState:()=>__house, setHouseState:h=>{__house=h}, getEnergySettings:()=>__energy, setEnergySettings:e=>{__energy=e}, automationManager:__auto, simulationEngine:null, rebuildHouse:()=>{}, onLog:()=>{} })`);
  pm.deserialize({ version:3, projectName:'Stary', house:$('defaultHouseState()'), energy:{ tariffCode:'G12', pvPriority:'battery_first', currency:'PLN' }, automationRules:[], objects:[] });
  assert(pm.projectName==='Stary');
  assert(JSON.stringify(ctx.$('__energy.pvOrder'))==='["battery","home","grid"]');
  assert(ctx.$('__energy.tariffCode')==='G12');
});

// ---------------- day / night ----------------
console.log('Stage 1 - day/night cycle');
const DN = 'DayNightCycle';
test('sunrise/sunset depend on the date: long summer day vs short winter day', ()=>{
  const summer = $(`${DN}.sunState(172, 12)`), winter = $(`${DN}.sunState(355, 12)`);
  assert(summer.dayLengthHours > 15.5 && summer.dayLengthHours < 17.5, 'summer '+summer.dayLengthHours);
  assert(winter.dayLengthHours > 7 && winter.dayLengthHours < 8.6, 'winter '+winter.dayLengthHours);
  assert(summer.noonElevationDeg > 55 && winter.noonElevationDeg < 18);
  assert(summer.sunriseHour < winter.sunriseHour && summer.sunsetHour > winter.sunsetHour);
});
test('all 8 phases occur over a summer day in the right order', ()=>{
  const seq = []; for (let h=0; h<24; h+=0.25){ const p = $(`${DN}.sunState(172, ${h})`).phase; if (seq[seq.length-1]!==p) seq.push(p); }
  const set = new Set(seq);
  for (const p of ['night','dawn','morning','day','noon','afternoon','sunset','dusk']) assert(set.has(p), 'missing '+p+' in '+seq.join('>'));
  assert(seq[0]==='night' && seq[seq.length-1]==='night', seq.join('>'));
  assert(seq.indexOf('dawn') < seq.indexOf('noon') && seq.indexOf('noon') < seq.indexOf('sunset') && seq.indexOf('sunset') < seq.lastIndexOf('dusk'));
});
test('winter day still has the phases it can reach (no crash, night at midnight)', ()=>{
  assert($(`${DN}.sunState(355, 0)`).phase==='night'); assert($(`${DN}.sunState(355, 12)`).phase==='noon');
});
test('sun direction: south at noon, east in the morning, west in the evening (-Z = north)', ()=>{
  const d = (h)=>{ const s=$(`${DN}.sunState(172, ${h})`); return $(`${DN}.dirTo(${s.elevationDeg}, ${s.azimuthDeg})`); };
  const noon = d(12), am = d(8), pm = d(17);
  assert(noon[2] > 0.1, 'noon sun should be on the +Z (south) side '+noon);
  assert(am[0] > 0.2, 'morning sun east (+X) '+am); assert(pm[0] < -0.2, 'evening sun west (-X) '+pm);
});
test('light: warmer & dimmer near horizon, none at night, cloud dims it', ()=>{
  const I = (el,sky)=>$(`${DN}.sunIntensity(${el},${sky})`);
  assert(I(-10,1) === 0); assert(I(5,1) < I(40,1)); assert(I(40,0.2) < I(40,1));
  assert($(`${DN}.sunColor(2)`) !== $(`${DN}.sunColor(60)`));
  const top = (el)=>$(`${DN}.skyColors(${el})`).top;
  assert(top(-20) < top(40), 'night sky darker than day sky');
});
summary();
