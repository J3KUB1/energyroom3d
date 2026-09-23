/** Shared household layer: residents, maintenance, scenarios and energy-flow summaries. */
class HomeOperationsManager {
  constructor({simulationEngine, objectManager, getSettings, setSettings, getMode}){
    this.sim=simulationEngine; this.om=objectManager; this.getSettings=getSettings; this.setSettings=setSettings; this.getMode=getMode||(()=> 'casual');
    const s=this.getSettings()||{};
    this.state=s.homeOperations||{residents:[],maintenance:{},scenario:null,history:[]};
    if(!Array.isArray(this.state.residents))this.state.residents=[];
    if(!this.state.maintenance)this.state.maintenance={};
    this._syncMaintenance();
  }
  _persist(){const s=this.getSettings();s.homeOperations=this.state;this.setSettings(s);}
  _syncMaintenance(){for(const d of this.om.getDevices()){const id=d.id;if(!this.state.maintenance[id])this.state.maintenance[id]={condition:100,lastService:0,serviceCount:0};d.maintenance=this.state.maintenance[id];}}
  _realistic(){return this.getMode()==='realistic';}
  tick(sim=this.sim){
    this._syncMaintenance();
    if(!this._realistic())return;
    for(const d of this.om.getDevices()){
      const m=d.maintenance;if(!m)continue;
      const active=d.runtime.state&&d.runtime.state!=='off'&&d.runtime.state!=='standby';
      if(active)m.condition=Math.max(35,m.condition-(d.runtime.powerW>500?0.002:0.0005));
      if(m.condition<50&&d.runtime.state!=='off'&&Math.random()<.002)d.runtime.maintenanceAlert=true;
    }
    if(sim.absMin%60===0)this._persist();
  }
  addResident(name,kind='adult'){const n=String(name||'').trim();if(!n)return false;this.state.residents.push({id:'r_'+Date.now().toString(36),name:n,kind});this._persist();return true;}
  removeResident(id){const before=this.state.residents.length;this.state.residents=this.state.residents.filter(r=>r.id!==id);if(before!==this.state.residents.length)this._persist();return before!==this.state.residents.length;}
  service(id){const m=this.state.maintenance[id];if(!m)return false;m.condition=100;m.lastService=this.sim.absMin;m.serviceCount=(m.serviceCount||0)+1;const d=this.om.find(id);if(d)d.runtime.maintenanceAlert=false;this._persist();return true;}
  setScenario(id){this.state.scenario=id||null;const presets={heatwave:{weather:'heatwave'},winter:{weather:'coldsnap'},blackout:{weather:null}};const p=presets[id];if(id==='blackout')this.sim.gridOnline=false;else if(id==='clear')this.sim.gridOnline=true;if(p?.weather&&this.sim.weatherManager?.forceEvent)this.sim.weatherManager.forceEvent(p.weather,12,this.sim.absMin);this._persist();return !!p;}
  clearScenario(){this.state.scenario=null;this.sim.gridOnline=true;if(this.sim.weatherManager?.clearEvent)this.sim.weatherManager.clearEvent();this._persist();}
  energyFlow(){const f=this.sim.flows||{};return {pv:f.pvToHome||0,battery:f.batteryToHome||0,grid:f.gridToHome||0,ev:this.om.getDevices().filter(d=>d.ev).reduce((a,d)=>a+(d.runtime.powerW||0),0),exported:f.pvToGrid||0,curtailed:f.curtailed||0,unserved:f.unserved||0};}
  summary(){this._syncMaintenance();const devices=this.om.getDevices();const avg=devices.length?devices.reduce((a,d)=>a+(d.maintenance?.condition||100),0)/devices.length:100;return {residents:this.state.residents.length,averageCondition:avg,alerts:devices.filter(d=>(d.maintenance?.condition||100)<50).length,flow:this.energyFlow(),scenario:this.state.scenario};}
}
