/**
 * PROJECT MANAGER
 * Serialize/deserialize the whole project (multi-room house + devices +
 * furniture + solar panels + schedules + tariff/energy settings +
 * automation rules) to/from a plain JSON object. No THREE.js objects
 * are ever stored - only plain data, which is exactly the shape a
 * Unity importer would need too.
 */
class ProjectManager {
  constructor({ objectManager, getHouseState, setHouseState, getEnergySettings, setEnergySettings, automationManager, rebuildHouse, onLog }){
    this.om = objectManager;
    this.getHouseState = getHouseState;
    this.setHouseState = setHouseState;
    this.getEnergySettings = getEnergySettings;
    this.setEnergySettings = setEnergySettings;
    this.automation = automationManager;
    this.rebuildHouse = rebuildHouse;
    this.onLog = onLog || (()=>{});
    this.projectName = 'Moj Dom';
    this.history = []; this.future = [];
    this._suspend = false;
  }

  serialize(){
    return {
      version: 2,
      projectName: this.projectName,
      house: this.getHouseState(),
      energy: this.getEnergySettings(),
      automationRules: this.automation.rules,
      objects: this.om.getAll().map(i => ({
        id:i.id, kind:i.kind, defId:i.defId, roomId:i.roomId, customName:i.customName,
        position:i.position, rotation:i.rotation, scale:i.scale,
        connected:i.connected, schedule:i.schedule, manualOverride:i.manualOverride,
      })),
    };
  }

  deserialize(json){
    if (!json || typeof json !== 'object') throw new Error('Nieprawidłowy plik projektu');
    this.projectName = json.projectName || 'Projekt';
    const house = json.house && Array.isArray(json.house.rooms) ? json.house : defaultHouseState();
    this.setHouseState(house);
    this.rebuildHouse();
    this.setEnergySettings({ ...DEFAULT_ENERGY_SETTINGS, ...(json.energy||{}) });
    this.om.clear();
    this.automation.rules = Array.isArray(json.automationRules) ? json.automationRules : [];
    if (Array.isArray(json.objects)){
      for (const o of json.objects){
        try {
          const roomId = o.roomId || 'main';
          const inst = o.kind==='furniture' ? this.om.addFurniture(o.defId, o.position, roomId)
                     : o.kind==='solar'      ? this.om.addSolar(o.defId, o.position, roomId)
                                              : this.om.addDevice(o.defId, o.position, roomId);
          if (!inst) continue;
          this.om.applyTransform(inst.id, o.position||{x:0,y:0,z:0}, o.rotation||{x:0,y:0,z:0}, o.scale||{x:1,y:1,z:1});
          if (o.customName) this.om.rename(inst.id, o.customName);
          if (typeof o.connected === 'boolean') this.om.setConnected(inst.id, o.connected);
          if (o.manualOverride) this.om.setManualOverride(inst.id, o.manualOverride);
          if (o.schedule) this.om.setSchedule(inst.id, o.schedule);
        } catch(e){ console.warn('Skipping corrupt object entry', e); }
      }
    }
  }

  saveLocal(){
    try {
      localStorage.setItem('energyroom3d_project', JSON.stringify(this.serialize()));
      this.onLog('Projekt zapisany lokalnie.');
      return true;
    } catch(e){ console.error(e); this.onLog('Błąd zapisu projektu.'); return false; }
  }
  loadLocal(){
    try {
      const raw = localStorage.getItem('energyroom3d_project');
      if (!raw) { this.onLog('Brak zapisanego projektu.'); return false; }
      this.deserialize(JSON.parse(raw));
      this.onLog('Projekt wczytany.');
      return true;
    } catch(e){ console.error(e); this.onLog('Błąd wczytywania projektu (uszkodzony JSON).'); return false; }
  }
  hasLocal(){ return !!localStorage.getItem('energyroom3d_project'); }

  exportFile(){
    const data = JSON.stringify(this.serialize(), null, 2);
    const blob = new Blob([data], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'energyroom_project.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.onLog('Projekt wyeksportowany do pliku.');
  }
  importFile(file, cb){
    const reader = new FileReader();
    reader.onload = () => {
      try { this.deserialize(JSON.parse(reader.result)); this.onLog('Projekt zaimportowany.'); cb && cb(true); }
      catch(e){ console.error(e); this.onLog('Błąd importu: nieprawidłowy plik JSON.'); cb && cb(false); }
    };
    reader.onerror = () => { this.onLog('Nie udało się odczytać pliku.'); cb && cb(false); };
    reader.readAsText(file);
  }

  newProject(){
    this.projectName = 'Nowy Dom';
    this.setHouseState(defaultHouseState());
    this.rebuildHouse();
    this.setEnergySettings({ ...DEFAULT_ENERGY_SETTINGS });
    this.om.clear();
    this.automation.rules = [];
    this.history=[]; this.future=[];
    this.onLog('Utworzono nowy projekt.');
  }

  // ---------------- UNDO / REDO (snapshot based) ----------------
  pushHistory(){
    if (this._suspend) return;
    this.history.push(JSON.stringify(this.serialize()));
    if (this.history.length > 40) this.history.shift();
    this.future = [];
  }
  undo(){
    if (!this.history.length) { this.onLog('Nic do cofnięcia.'); return; }
    const current = JSON.stringify(this.serialize());
    const prev = this.history.pop();
    this.future.push(current);
    this._suspend = true;
    this.deserialize(JSON.parse(prev));
    this._suspend = false;
    this.onLog('Cofnięto (Ctrl+Z).');
  }
  redo(){
    if (!this.future.length) { this.onLog('Nic do ponowienia.'); return; }
    const next = this.future.pop();
    this.history.push(JSON.stringify(this.serialize()));
    this._suspend = true;
    this.deserialize(JSON.parse(next));
    this._suspend = false;
    this.onLog('Ponowiono (Ctrl+Y).');
  }
}

const DEFAULT_ROOM_SETTINGS = { width:7.0, length:5.0, height:2.8, floor:'Wood', wall:'White', ceiling:'White' };
const DEFAULT_GARAGE_SETTINGS = { width:5.5, length:5.5, height:2.6, floor:'Concrete', wall:'Concrete', ceiling:'White' };
function defaultHouseState(){
  return {
    rooms: [
      { id:'main',   name:'Pokój',  type:'room',   settings:{...DEFAULT_ROOM_SETTINGS},   offsetX:0 },
      { id:'garage', name:'Garaż',  type:'garage', settings:{...DEFAULT_GARAGE_SETTINGS}, offsetX: DEFAULT_ROOM_SETTINGS.width + 1.4 },
    ],
    activeRoomId: 'main',
    wallVisibility: 1,
  };
}
const DEFAULT_ENERGY_SETTINGS = {
  pricePerKWh:1.00, currency:'PLN', extraFeesPerMonth:0, co2Factor:0.65,
  tariffMode:'flat', priceDay:1.10, priceNight:0.62, nightStart:'22:00', nightEnd:'06:00',
  cloudFactor:0.15,
};
