/** Shared, simulation-backed tools for retrofits, audits, achievements and reports. */
class HomeEnergyManager {
  constructor({simulationEngine,analyticsManager,objectManager,electrical,getSettings,setSettings,getHouseState}){
    Object.assign(this,{sim:simulationEngine,analytics:analyticsManager,om:objectManager,electrical,getSettings,setSettings,getHouseState});
    const s=getSettings();
    if(!s.modernizations) s.modernizations={installed:{},investmentZl:0};
    if(!s.modernizations.installed) s.modernizations.installed={};
    this.audit=s.energyAudit||null;
    this.achievements=s.energyAchievements||{unlocked:[],points:0};
    if(!Array.isArray(this.achievements.history))this.achievements.history=[];
    this._upgradeCache=new Map();
    this._lastObservedDay=-1;
  }
  static get UPGRADE_DEFS(){return [
    {id:'insulation',nameKey:'upgrade.insulation',descKey:'upgrade.insulationDesc',cost:28000,icon:'🧱'},
    {id:'windows',nameKey:'upgrade.windows',descKey:'upgrade.windowsDesc',cost:18000,icon:'🪟'},
    {id:'led',nameKey:'upgrade.led',descKey:'upgrade.ledDesc',cost:1500,icon:'💡'},
    {id:'heatPump',nameKey:'upgrade.heatPump',descKey:'upgrade.heatPumpDesc',cost:26000,icon:'♨️'},
    {id:'airConditioning',nameKey:'upgrade.airConditioning',descKey:'upgrade.airConditioningDesc',cost:9500,icon:'❄️',requires:'climate'},
    {id:'efficientAppliances',nameKey:'upgrade.efficientAppliances',descKey:'upgrade.efficientAppliancesDesc',cost:6500,icon:'🔋',requires:'appliances'},
    {id:'pvModules',nameKey:'upgrade.pvModules',descKey:'upgrade.pvModulesDesc',cost:14000,icon:'☀️',requires:'solar'},
    {id:'batteryExpansion',nameKey:'upgrade.batteryExpansion',descKey:'upgrade.batteryExpansionDesc',cost:10500,icon:'🔌',requires:'battery'},
    {id:'smartControls',nameKey:'upgrade.smartControls',descKey:'upgrade.smartControlsDesc',cost:1200,icon:'🔌'},
    {id:'pvService',nameKey:'upgrade.pvService',descKey:'upgrade.pvServiceDesc',cost:800,icon:'☀️',requires:'solar'},
  ];}
  static devicePower(inst,powerW,state,settings){
    const u=(settings&&settings.modernizations&&settings.modernizations.installed)||{};
    let m=1;
    if(u.led&&inst.def.category==='lighting') m*=0.48;
    if(u.smartControls&&state==='standby') m*=0.25;
    if(u.insulation&&inst.def.category==='heating') m*=0.78;
    if(u.windows&&inst.def.category==='heating') m*=0.88;
    if(u.heatPump&&inst.def.category==='heating') m*=0.38;
    if(u.airConditioning&&inst.def.category==='climate')m*=0.78;
    if(u.efficientAppliances&&!inst.ev&&['agd','rtv','computers','other'].includes(inst.def.category))m*=0.82;
    return powerW*m;
  }
  static pvModuleFactor(settings){return settings?.modernizations?.installed?.pvModules?1.12:1;}
  static batteryCapacityFactor(settings){return settings?.modernizations?.installed?.batteryExpansion?1.25:1;}
  static pvFactor(settings){
    const u=(settings&&settings.modernizations&&settings.modernizations.installed)||{};
    return Math.max(0.1,1-Math.max(0,Math.min(100,+(settings&&settings.pvSoilingPct||0)))/100)*
      Math.max(0.1,1-Math.max(0,Math.min(100,+(settings&&settings.pvSnowPct||0)))/100);
  }
  _syncProjectState(){const s=this.getSettings();if(Object.prototype.hasOwnProperty.call(s,'energyAudit'))this.audit=s.energyAudit;if(s.energyAchievements)this.achievements=s.energyAchievements;if(!Array.isArray(this.achievements.history))this.achievements.history=[];}
  _persist(){const s=this.getSettings();s.energyAudit=this.audit;s.energyAchievements=this.achievements;this.setSettings(s);}
  upgrades(){this._syncProjectState();const installed=this.getSettings().modernizations.installed,devices=this.om.getDevices(),available={climate:devices.some(x=>x.def.category==='climate'),appliances:devices.some(x=>!x.ev&&['agd','rtv','computers','other'].includes(x.def.category)),solar:this.om.getSolar().length>0,battery:this.om.getBattery().length>0};return HomeEnergyManager.UPGRADE_DEFS.map(d=>({...d,installed:!!installed[d.id],available:!d.requires||available[d.requires],paybackYears:this.paybackYears(d.id)}));}
  install(id){
    const def=HomeEnergyManager.UPGRADE_DEFS.find(x=>x.id===id);if(!def)return false;
    if(def.requires&&!this.upgrades().find(x=>x.id===id)?.available)return false;
    const s=this.getSettings(),m=s.modernizations||(s.modernizations={installed:{},investmentZl:0});
    if(m.installed[id])return false;
    const before=this.analytics.projections(this.sim.todayKWh,this.sim.todaySolarKWh,this.sim.todayCost).yearCost;
    m.installed[id]={installedAtAbsMin:this.sim.absMin,costZl:def.cost};m.investmentZl=(m.investmentZl||0)+def.cost;
    if(id==='pvService'){s.pvSoilingPct=0;s.pvSnowPct=0;}
    this.setSettings(s);this.analytics.invalidateCache();this._upgradeCache.clear();this.sim._recomputeInstant(false);
    const after=this.analytics.projections(this.sim.todayKWh,this.sim.todaySolarKWh,this.sim.todayCost).yearCost;
    m.installed[id].annualSavingZl=Math.max(0,before-after);this._persist();return true;
  }
  paybackYears(id){const u=this.getSettings().modernizations.installed[id];if(!u)return null;const annual=Math.max(0.01,u.annualSavingZl||0);return u.costZl/annual;}
  annualSavingZl(){return Object.values(this.getSettings().modernizations.installed).reduce((a,x)=>a+(x.annualSavingZl||0),0);}
  auditFindings(){
    const sim=this.sim,rows=this.analytics.ranking(),loss=this.electrical?this.electrical.rt.lossW||0:0;
    const top=rows.slice(0,3).map(r=>({id:'load:'+r.inst.id,titleKey:'audit.load',detail:r.name,value:EnergyCalculator.fmtKWh(r.monthlyKWh),upgrade:r.inst.def.category==='lighting'?'led':r.inst.def.category==='heating'?'insulation':null}));
    const findings=top;
    if(loss>20)findings.push({id:'wiring',titleKey:'audit.losses',detail:EnergyCalculator.fmtW(loss),value:EnergyCalculator.fmtW(loss),upgrade:null});
    if(sim.currentUnservedW>1)findings.push({id:'overload',titleKey:'audit.overload',detail:EnergyCalculator.fmtW(sim.currentUnservedW),value:EnergyCalculator.fmtW(sim.currentUnservedW),upgrade:'smartControls'});
    if(sim.todaySolarKWh>0&&sim.todayExportKWh>sim.todaySolarKWh*.55)findings.push({id:'solarExport',titleKey:'audit.solarExport',detail:EnergyCalculator.fmtKWh(sim.todayExportKWh),value:EnergyCalculator.fmtKWh(sim.todayExportKWh),upgrade:'pvService'});
    return findings;
  }
  startAudit(target={}){
    this._syncProjectState();
    const p=this.analytics.projections(this.sim.todayKWh,this.sim.todaySolarKWh,this.sim.todayCost);
    const lifetimeCost=Number.isFinite(this.sim.totalCostZl)?this.sim.totalCostZl:(this.sim.history||[]).reduce((sum,e)=>sum+(e.cost||0),0)+(this.sim.todayCost||0);
    this.audit={startedAbsMin:this.sim.absMin,baselineCost:p.yearCost,baselineCO2:p.co2Year,baselineConsumed:this.sim.totalConsumedKWh||0,
      startSolarKWh:this.sim.totalSolarKWh||0,startExportKWh:this.sim.totalExportKWh||0,startImportKWh:this.sim.totalImportKWh||0,startCostZl:lifetimeCost,
      targetBillPct:Number(target.billPct)||10,targetBudgetZl:Number(target.budgetZl)||0,targetSelfUsePct:Number(target.selfUsePct)||40,status:'active'};
    this._persist();return this.audit;
  }
  auditProgress(){
    this._syncProjectState();
    if(!this.audit)return null;
    const p=this.analytics.projections(this.sim.todayKWh,this.sim.todaySolarKWh,this.sim.todayCost),s=this.sim,a=this.audit;
    const billPct=a.baselineCost>0?(a.baselineCost-p.yearCost)/a.baselineCost*100:0;
    const solar=Math.max(0,(s.totalSolarKWh||0)-(a.startSolarKWh||0)),exportKWh=Math.max(0,(s.totalExportKWh||0)-(a.startExportKWh||0));
    const lifetimeCost=Number.isFinite(s.totalCostZl)?s.totalCostZl:(s.history||[]).reduce((sum,e)=>sum+(e.cost||0),0)+(s.todayCost||0);
    const intervalCost=lifetimeCost-(a.startCostZl||0);
    const selfUse=solar>0?Math.max(0,Math.min(100,(solar-exportKWh)/solar*100)):0;
    const elapsed=s.absMin-a.startedAbsMin,dayReady=elapsed>=1440;
    return {elapsed,dayReady,billPct,currentYearCost:p.yearCost,co2Kg:p.co2Year,selfUsePct:selfUse,
      goals:[{id:'bill',target:a.targetBillPct,current:billPct,passed:billPct>=a.targetBillPct},
        {id:'selfUse',target:a.targetSelfUsePct,current:selfUse,passed:selfUse>=a.targetSelfUsePct},
        ...(a.targetBudgetZl>0?[{id:'budget',target:a.targetBudgetZl,current:intervalCost,passed:intervalCost<=a.targetBudgetZl}]:[])],findings:this.auditFindings(),passed:dayReady&&billPct>=a.targetBillPct&&selfUse>=a.targetSelfUsePct&&(!a.targetBudgetZl||intervalCost<=a.targetBudgetZl)};
  }
  finishAudit(){const p=this.auditProgress();if(!p)return null;const result={...p,finishedAbsMin:this.sim.absMin};this.audit={...this.audit,status:'complete',result};this._persist();return result;}
  evaluateAchievements(){
    this._syncProjectState();
    const sim=this.sim,last=sim.history.length?sim.history[sim.history.length-1]:null,defs=[
      {id:'under5',points:10,ok:!!last&&last.consumedKWh<5},
      {id:'pvSelfUse',points:15,ok:!!last&&last.solarKWh>0&&(last.solarKWh-last.exportKWh)/last.solarKWh>=.5},
      {id:'lowPeak',points:10,ok:sim.absMin-sim._startAbsMin>=30&&sim.maxObservedPowerW>0&&sim.maxObservedPowerW<=3600},
      {id:'outageHour',points:20,ok:sim.longestOutageMinutes>=60},
      {id:'retrofit',points:15,ok:Object.keys(this.getSettings().modernizations.installed).length>0},
      {id:'solarDay',points:20,ok:!!last&&last.solarKWh>0&&last.solarKWh>=last.consumedKWh},
      {id:'lowCarbon',points:15,ok:sim.totalImportKWh*(this.getSettings().co2Factor||.65)<10&&sim.absMin>=1440},
      {id:'positiveBalance',points:25,ok:sim.totalSolarKWh>=sim.totalConsumedKWh&&sim.totalConsumedKWh>0},
    ];
    this.achievements=this.getSettings().energyAchievements||this.achievements;
    if(!Array.isArray(this.achievements.history))this.achievements.history=[];
    const newly=[];for(const d of defs)if(d.ok&&!this.achievements.unlocked.includes(d.id)){this.achievements.unlocked.push(d.id);this.achievements.points+=d.points;this.achievements.history.unshift({id:d.id,absMin:sim.absMin,points:d.points});newly.push(d.id);}
    if(newly.length)this._persist();return newly;
  }
  achievementProgress(){
    this._syncProjectState();const s=this.sim,last=s.history.length?s.history[s.history.length-1]:null,elapsed=s.absMin-s._startAbsMin,solarUse=last&&last.solarKWh>0?(last.solarKWh-last.exportKWh)/last.solarKWh*100:0;
    const defs=[['under5',last?last.consumedKWh:s.todayKWh,5,'max',!!last],['pvSelfUse',solarUse,50,'min',!!last],['lowPeak',s.maxObservedPowerW,3600,'max',elapsed>=30],['outageHour',s.longestOutageMinutes,60,'min',true],['retrofit',Object.keys(this.getSettings().modernizations.installed).length,1,'min',true],['solarDay',last&&last.consumedKWh?Math.min(100,last.solarKWh/last.consumedKWh*100):0,100,'min',!!last],['lowCarbon',s.totalImportKWh*(this.getSettings().co2Factor||.65),10,'max',elapsed>=1440],['positiveBalance',s.totalConsumedKWh?Math.min(100,s.totalSolarKWh/s.totalConsumedKWh*100):0,100,'min',elapsed>=1440]];
    return defs.map(([id,value,target,direction,ready])=>{const unlocked=this.achievements.unlocked.includes(id);const ratio=direction==='max'?(value<=0?0:target/Math.max(target,value)):value/target;return {id,value,target,direction,ready,unlocked,pct:unlocked?100:Math.max(0,Math.min(100,ratio*100))};});
  }
  report(){
    this._syncProjectState();
    const s=this.sim,settings=this.getSettings(),elapsed=Math.max(1,s.absMin-(s._startAbsMin||0)),days=elapsed/1440;
    const hist=s.history||[],sum=(field)=>hist.reduce((a,e)=>a+(e[field]||0),0)+(s[field==='consumedKWh'?'todayKWh':field==='solarKWh'?'todaySolarKWh':field==='importKWh'?'todayImportKWh':field==='exportKWh'?'todayExportKWh':field==='cost'?'todayCost':'todayKWh']||0);
    const consumption=Math.max(s.totalConsumedKWh,sum('consumedKWh')),solar=Math.max(s.totalSolarKWh,sum('solarKWh'));
    const importKWh=Math.max(s.totalImportKWh,sum('importKWh')),exportKWh=Math.max(s.totalExportKWh,sum('exportKWh'));
    const co2=EnergyCalculator.co2(importKWh,settings.co2Factor||.65),battery=this.analytics.batterySummary(s);
    const temps=Object.values(s.roomTemperatures||{}),avgTemp=temps.length?temps.reduce((a,b)=>a+b,0)/temps.length:20;
    const energyScore=this.analytics.energyScore().score;
    return {elapsedMinutes:elapsed,days,consumptionKWh:consumption,averageDailyKWh:consumption/days,importKWh,solarKWh:solar,exportKWh,
      batteryChargeKWh:s.totalBatteryChargeKWh||0,batteryDischargeKWh:s.totalBatteryDischargeKWh||0,
      costZl:Number.isFinite(s.totalCostZl)?s.totalCostZl:hist.reduce((a,e)=>a+(e.cost||0),0)+s.todayCost,evCostZl:s.totalEvCostZl||0,totalCostZl:Number.isFinite(s.totalCostZl)?s.totalCostZl:hist.reduce((a,e)=>a+(e.cost||0),0)+s.todayCost,
      lifetimeSavingsZl:s.totalSavedPLN,investmentZl:settings.modernizations.investmentZl||0,annualSavingZl:this.annualSavingZl(),
      paybackYears:(this.annualSavingZl()>0?(settings.modernizations.investmentZl||0)/this.annualSavingZl():null),co2Kg:co2,renewablePct:consumption?Math.min(100,solar/consumption*100):0,
      maxLoadW:s.maxObservedPowerW||s.currentPowerW,overloadMinutes:s.overloadMinutes||0,electricalTripCount:s.electricalTripCount||0,battery,pvCount:this.om.getSolar().length,pvCapacityW:this.om.getSolar().reduce((a,p)=>a+p.def.peakPowerW,0),
      co2ReductionKg:EnergyCalculator.co2(Math.min(consumption,solar),settings.co2Factor||.65),renewablePct:consumption?Math.min(100,Math.max(0,solar-sum('exportKWh'))/consumption*100):0,
      averageIndoorC:avgTemp,comfortPct:s.comfortPct==null?100:s.comfortPct,energyScore,season:s.season,weather:s.skyCondition};
  }
}
