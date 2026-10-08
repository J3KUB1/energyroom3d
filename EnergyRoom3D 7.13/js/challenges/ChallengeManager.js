/**
 * Challenge mode: objectives use the live household simulation, PV, tariff,
 * building and appliance state. The manager only tracks goals and results;
 * it does not create a parallel energy calculation.
 */
class ChallengeManager {
  constructor({ simulationEngine, objectManager, analyticsManager, getHouseState }){
    this.sim=simulationEngine; this.om=objectManager; this.analytics=analyticsManager; this.getHouseState=getHouseState;
    this.active=null; this.results=[];
    try { const s=JSON.parse(localStorage.getItem('energyroom3d_challenges')||'{}'); this.active=s.active||null; this.results=Array.isArray(s.results)?s.results:[]; } catch(e){}
    if(this.active?.id==='outage'){this.sim.gridOnline=false;if(this.sim._recomputeInstant)this.sim._recomputeInstant(false);}
  }
  static get DEFINITIONS(){ return [
    {id:'bill',icon:'💸',titleKey:'challenge.bill.title',descKey:'challenge.bill.desc',goalKey:'challenge.bill.goal',conditionKey:'challenge.bill.condition',kind:'bill',target:15,requiresDay:true},
    {id:'budget',icon:'🪙',titleKey:'challenge.budget.title',descKey:'challenge.budget.desc',goalKey:'challenge.budget.goal',conditionKey:'challenge.budget.condition',kind:'budget',target:8,requiresDay:true},
    {id:'consumption',icon:'⚡',titleKey:'challenge.consumption.title',descKey:'challenge.consumption.desc',goalKey:'challenge.consumption.goal',conditionKey:'challenge.consumption.condition',kind:'consumption',target:12,requiresDay:true},
    {id:'solar',icon:'☀️',titleKey:'challenge.solar.title',descKey:'challenge.solar.desc',goalKey:'challenge.solar.goal',conditionKey:'challenge.solar.condition',kind:'solar',target:35,requiresDay:true},
    {id:'family',icon:'👨‍👩‍👧‍👦',titleKey:'challenge.family.title',descKey:'challenge.family.desc',goalKey:'challenge.family.goal',conditionKey:'challenge.family.condition',kind:'family',target:4,requiresDay:false},
    {id:'independence',icon:'🏡',titleKey:'challenge.independence.title',descKey:'challenge.independence.desc',goalKey:'challenge.independence.goal',conditionKey:'challenge.independence.condition',kind:'independence',target:60,requiresDay:true},
    {id:'outage',icon:'🔌',titleKey:'challenge.outage.title',descKey:'challenge.outage.desc',goalKey:'challenge.outage.goal',conditionKey:'challenge.outage.condition',kind:'outage',target:60,requiresDay:false,requiresRealistic:true},
  ]; }
  get definitions(){ return ChallengeManager.DEFINITIONS; }
  _save(){ try { localStorage.setItem('energyroom3d_challenges',JSON.stringify({active:this.active,results:this.results.slice(-30)})); } catch(e){} }
  _yearCost(){ const s=this.sim; return this.analytics.projections(s.todayKWh,s.todaySolarKWh,s.todayCost).yearCost; }
  start(id, options={}){
    const def=this.definitions.find(x=>x.id===id); if(!def) return false;
    if(def.requiresRealistic&&!options.realistic)return false;
    this.active={id,startedAbsMin:this.sim.absMin,baselineYearCost:this._yearCost(),status:'active'};
    if(def.kind==='outage'){
      this.active.previousGridOnline=this.sim.gridOnline!==false;
      this.active.startUnservedKWh=this.sim.totalUnservedKWh||0;
      this.active.startConsumedKWh=this.sim.totalConsumedKWh||0;
      this.active.startGridOfflineMinutes=this.sim.gridOfflineMinutes||0;
      this.sim.gridOnline=false;
      if(this.sim._recomputeInstant)this.sim._recomputeInstant(false);
    }
    this._save(); return true;
  }
  progress(){
    const def=this.active&&this.definitions.find(x=>x.id===this.active.id); if(!def) return null;
    const sim=this.sim, elapsed=Math.max(0,sim.absMin-this.active.startedAbsMin), dayReady=elapsed>=1440;
    const s={current:0,target:def.target,pct:0,passedMetric:false,elapsed,dayReady,def};
    const homeKWh=Math.max(0,sim.todayKWh), importShare=homeKWh>1e-8?Math.max(0,Math.min(100,(1-sim.todayImportKWh/homeKWh)*100)):0;
    const pvUse=sim.todaySolarKWh>1e-8?Math.max(0,Math.min(100,(1-sim.todayExportKWh/sim.todaySolarKWh)*100)):0;
    if(def.kind==='bill'){
      const now=this._yearCost(), base=this.active.baselineYearCost||now||1;
      s.current=base>0?Math.max(-100,(base-now)/base*100):0; s.pct=Math.max(0,Math.min(100,s.current/def.target*100)); s.passedMetric=s.current>=def.target;
    } else if(def.kind==='budget'){
      s.current=sim.todayCost; s.pct=Math.max(0,Math.min(100,(def.target-s.current)/def.target*100)); s.passedMetric=s.current<=def.target;
    } else if(def.kind==='consumption'){
      s.current=sim.todayKWh; s.pct=Math.max(0,Math.min(100,(def.target-s.current)/def.target*100)); s.passedMetric=s.current<=def.target;
    } else if(def.kind==='solar' || def.kind==='independence'){
      s.current=def.kind==='solar'?pvUse:importShare; s.pct=Math.max(0,Math.min(100,s.current/def.target*100)); s.passedMetric=s.current>=def.target;
    } else if(def.kind==='family'){
      const beds=this.om.getFurniture().filter(x=>x.defId==='bed').length;
      s.current=beds; s.pct=Math.max(0,Math.min(100,beds/def.target*100)); s.passedMetric=beds>=def.target;
    } else if(def.kind==='outage'){
      const offlineMinutes=Math.max(0,(sim.gridOfflineMinutes||0)-(this.active.startGridOfflineMinutes||0));
      s.current=Math.min(def.target,offlineMinutes);
      s.unservedKWh=Math.max(0,(sim.totalUnservedKWh||0)-(this.active.startUnservedKWh||0));
      s.servedKWh=Math.max(0,(sim.totalConsumedKWh||0)-(this.active.startConsumedKWh||0));
      s.pct=Math.max(0,Math.min(100,s.current/def.target*100));
      s.passedMetric=elapsed>=def.target&&offlineMinutes>=def.target&&s.unservedKWh<=.02&&s.servedKWh>=.05;
    }
    s.ready=(!def.requiresDay||dayReady)&&s.passedMetric;
    return s;
  }
  finish(){
    const p=this.progress(); if(!p) return null;
    const elapsed=p.elapsed, def=p.def, passed=p.passedMetric&&(!def.requiresDay||p.dayReady);
    const result={id:def.id,passed,endedAbsMin:this.sim.absMin,elapsed,current:p.current,target:p.target,unservedKWh:p.unservedKWh,servedKWh:p.servedKWh};
    const active=this.active;
    this.active=null;
    if(def.kind==='outage'){this.sim.gridOnline=active.previousGridOnline!==false;if(this.sim._recomputeInstant)this.sim._recomputeInstant(false);}
    this.results.unshift(result); this.results=this.results.slice(0,30); this._save(); return result;
  }
}
