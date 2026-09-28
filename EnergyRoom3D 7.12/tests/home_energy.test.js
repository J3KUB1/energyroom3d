const { createContext, test, assert, near, summary } = require('./harness');
const ctx=createContext(['js/energy/HomeEnergyManager.js']);
const $=ctx.$;
const state={modernizations:{installed:{},investmentZl:0},co2Factor:.5,currency:'PLN'};
const sim={absMin:480,_startAbsMin:480,todayKWh:0,todaySolarKWh:0,todayExportKWh:0,todayCost:0,totalImportKWh:0,totalConsumedKWh:0,totalSolarKWh:0,totalSavedPLN:0,totalBatteryChargeKWh:0,totalBatteryDischargeKWh:0,totalEvCostZl:0,maxObservedPowerW:0,overloadMinutes:0,electricalTripCount:0,longestOutageMinutes:0,roomTemperatures:{},comfortPct:100,season:'spring',skyCondition:{nameKey:'weather.clear'},history:[],currentPowerW:0,_recomputeInstant(){}};
const analytics={invalidateCache(){},projections(){return {yearCost:state.modernizations.installed.led?480:1000,co2Year:20};},ranking(){return [{inst:{id:'lamp',def:{category:'lighting'}},name:'Lamp',monthlyKWh:12}];},batterySummary(){return {socPct:50};},energyScore(){return {score:88};}};
const om={getSolar(){return [];},getBattery(){return [];},getDevices(){return [];}};
const electrical={rt:{lossW:0},data:{breakers:[]},costBreakdown(){return {totalZl:0};}};
ctx.__sim=sim;ctx.__analytics=analytics;ctx.__om=om;ctx.__electrical=electrical;ctx.__state=state;
const manager=$(`new HomeEnergyManager({simulationEngine:globalThis.__sim,analyticsManager:globalThis.__analytics,objectManager:globalThis.__om,electrical:globalThis.__electrical,getSettings:()=>globalThis.__state,setSettings:s=>{globalThis.__state=s},getHouseState:()=>({rooms:[]})})`);

console.log('Home energy systems - upgrades, audit and achievements');
test('retrofits change real device draw and PV conditions have bounded losses',()=>{
  const power=$(`HomeEnergyManager.devicePower({def:{category:'lighting'}},100,'on',globalThis.__state)`); near(power,100);
  assert(!manager.install('pvModules')&&!manager.install('batteryExpansion'),'hardware upgrades require the matching installed equipment');
  assert(manager.install('led')); near($(`HomeEnergyManager.devicePower({def:{category:'lighting'}},100,'on',globalThis.__state)`),48);
  assert(state.modernizations.investmentZl===1500); assert(state.modernizations.installed.led.annualSavingZl>0);
  state.modernizations.installed.efficientAppliances={};state.modernizations.installed.airConditioning={};state.modernizations.installed.pvModules={};state.modernizations.installed.batteryExpansion={};
  near($(`HomeEnergyManager.devicePower({def:{category:'agd'}},100,'on',globalThis.__state)`),82);
  near($(`HomeEnergyManager.devicePower({def:{category:'climate'}},100,'on',globalThis.__state)`),78);
  near($(`HomeEnergyManager.pvModuleFactor(globalThis.__state)`),1.12);near($(`HomeEnergyManager.batteryCapacityFactor(globalThis.__state)`),1.25);
  state.pvSoilingPct=25;state.pvSnowPct=20;near($(`HomeEnergyManager.pvFactor(globalThis.__state)`),.6);
});
test('audit requires a full simulated day and evaluates real bill, self-use and budget goals',()=>{
  state.modernizations.installed={};sim.absMin=480;sim.todaySolarKWh=10;sim.todayExportKWh=2;sim.todayCost=30;sim.totalSolarKWh=0;sim.totalExportKWh=0;
  manager.startAudit({billPct:10,selfUsePct:40,budgetZl:40});assert(manager.install('led'));sim.totalSolarKWh=10;sim.totalExportKWh=2;
  let p=manager.auditProgress();assert(!p.dayReady);
  sim.absMin+=1440;p=manager.auditProgress();assert(p.dayReady&&p.passed);
  const result=manager.finishAudit();assert(result.passed&&manager.audit.status==='complete');
});
test('achievements unlock from simulation values and persist points/history',()=>{
  sim.history=[{consumedKWh:4,solarKWh:8,exportKWh:2}];sim.maxObservedPowerW=3000;sim.longestOutageMinutes=60;sim.totalSolarKWh=20;sim.totalConsumedKWh=10;sim.totalImportKWh=2;sim.absMin=480+2880;sim._startAbsMin=480;
  const unlocked=manager.evaluateAchievements();
  for(const id of ['under5','pvSelfUse','lowPeak','outageHour','solarDay','positiveBalance'])assert(unlocked.includes(id),id);
  assert(state.energyAchievements.points>=100);assert(state.energyAchievements.history.length>=6);
});
test('EV charging shares the household power cap and follows the selected grid tariff',()=>{
  const settings=$('freshEnergySettings()');settings.importLimitW=3600;settings.tariffCode='G11';
  const def=$(`getDeviceDefinition('ev_charger')`),makeEv=()=>({id:'ev',def,roomId:'garage',connected:true,manualOverride:'on',schedule:$(`ScheduleManager.validateSchedule(DEVICE_DEFINITIONS.find(d=>d.id==='ev_charger').defaultSchedule)`),runtime:{state:'off',powerW:0},stats:{energyYearKWh:0},ev:{capacityKWh:60,socKWh:20,maxPowerW:7200,targetPct:100,source:'grid',todayKWh:0,todayCostZl:0,totalKWh:0}});
  const ev=makeEv(),engine=$(`new SimulationEngine({getInstances:()=>globalThis.__evs,getSolarInstances:()=>[],getBatteryInstances:()=>[],getSettings:()=>globalThis.__energy,getStartDate:()=>new Date(2026,0,15)})`);
  ctx.__evs=[ev];ctx.__energy=settings;engine.absMin=12*60;engine._recomputeInstant(true);
  assert(ev.runtime.powerW<=3600,'EV respects the household import cap');assert(ev.ev.socKWh>20&&ev.ev.todayCostZl>0,'grid charging changes SOC and cost');
  const progress=engine.serializeProgress(),reloaded=$(`new SimulationEngine({getInstances:()=>[],getSolarInstances:()=>[],getBatteryInstances:()=>[],getSettings:()=>globalThis.__energy,getStartDate:()=>new Date(2026,0,15)})`);reloaded.deserializeProgress(progress);
  assert(reloaded.totalCostZl===engine.totalCostZl&&reloaded.powerHistory.length===engine.powerHistory.length,'meter flow history and lifetime cost survive save/load');
  const cheapSettings=$('freshEnergySettings()');cheapSettings.tariffCode='G12';const cheapEv=makeEv();cheapEv.ev.source='grid';ctx.__evs=[cheapEv];ctx.__energy=cheapSettings;
  const cheapEngine=$(`new SimulationEngine({getInstances:()=>globalThis.__evs,getSolarInstances:()=>[],getBatteryInstances:()=>[],getSettings:()=>globalThis.__energy,getStartDate:()=>new Date(2026,0,15)})`);cheapEngine.absMin=23*60;cheapEngine._recomputeInstant(true);const cheapCost=cheapEv.ev.todayCostZl;
  const dearEv=makeEv();ctx.__evs=[dearEv];const dearEngine=$(`new SimulationEngine({getInstances:()=>globalThis.__evs,getSolarInstances:()=>[],getBatteryInstances:()=>[],getSettings:()=>globalThis.__energy,getStartDate:()=>new Date(2026,0,15)})`);dearEngine.absMin=12*60;dearEngine._recomputeInstant(true);
  assert(cheapCost<dearEv.ev.todayCostZl,'G12 night charging costs less than daytime charging');
});
test('battery cheap-tariff mode avoids grid charging on flat tariffs and uses profitable low-rate windows',()=>{
  const def=$(`getBatteryDefinition('battery_5')`),battery={connected:true,def,runtime:{socKWh:1},storage:{mode:'cheap',sohPct:100,temperatureC:20,maxChargeW:2500,maxDischargeW:2500,reservePct:10}};
  const settings=$('freshEnergySettings()');settings.tariffCode='G11';ctx.__batteries=[battery];ctx.__energy=settings;
  const engine=$(`new SimulationEngine({getInstances:()=>[],getSolarInstances:()=>[],getBatteryInstances:()=>globalThis.__batteries,getSettings:()=>globalThis.__energy,getStartDate:()=>new Date(2026,0,15)})`);
  engine.absMin=23*60;let a=engine._allocate(0,0,settings,true);assert(a.flows.gridToBattery===0,'flat tariff has no arbitrage window');
  settings.tariffCode='G12';settings.modernizations={installed:{batteryExpansion:{}}};battery.runtime.socKWh=5.5;a=engine._allocate(0,0,settings,true);assert(a.flows.gridToBattery>0&&a.flows.gridToBattery<=2500,'expanded battery accepts profitable grid energy within its power cap');
});
test('final report reads saved simulation totals and exposes the live efficiency score',()=>{
  sim.totalCostZl=42;sim.totalConsumedKWh=30;sim.totalSolarKWh=12;sim.totalImportKWh=20;sim.totalExportKWh=2;sim.totalEvCostZl=5;sim.history=[{cost:100,consumedKWh:100}];sim.todayCost=7;
  const report=manager.report();assert(report.costZl===42,'uses persisted cumulative cost instead of truncated history');assert(report.evCostZl===5&&report.energyScore===88);
  assert(report.consumptionKWh===100,'report uses actual lifetime simulation totals');
});
test('weather and realism levels alter temperature and heating load through the shared engine',()=>{
  const winter=new Date(2026,0,15),summer=new Date(2026,6,15);ctx.__weatherDate=winter;const weather=$(`new WeatherSystem({getSimDate:()=>globalThis.__weatherDate})`);
  assert(weather.outdoorTemperature(winter,12)<weather.outdoorTemperature(summer,12),'season changes outdoor temperature');
  assert($(`WeatherSystem.seasonalAverageFactor('winter')`)<$(`WeatherSystem.seasonalAverageFactor('summer')`),'season changes PV projection');
  const dev=$(`getDeviceDefinition('heater')`),inst={id:'heater',def:dev,roomId:'main',connected:true,manualOverride:null,runtime:{state:'off',powerW:0,automationOverride:{state:'heating'}},stats:{energyYearKWh:0},schedule:$(`ScheduleManager.validateSchedule(DEVICE_DEFINITIONS.find(d=>d.id==='heater').defaultSchedule)`)};
  const wx={getMultipliers:()=>({solarMult:1,climateMult:1,heatingMult:1.8,skyFactor:.35}),outdoorTemperature:()=>-5};ctx.__evs=[inst];ctx.__weather=wx;
  const loadAt=mode=>{state.realismMode=mode;const engine=$(`new SimulationEngine({getInstances:()=>globalThis.__evs,getSolarInstances:()=>[],getBatteryInstances:()=>[],getSettings:()=>globalThis.__state,getStartDate:()=>new Date(2026,0,15),weatherManager:globalThis.__weather})`);engine._recomputeInstant(false);return engine.currentPowerW;};
  const arcade=loadAt('arcade'),education=loadAt('educational'),realistic=loadAt('realistic');assert(arcade<education&&education<realistic,`${arcade} < ${education} < ${realistic}`);
});
summary();
