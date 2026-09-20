/**
 * PROJECT MANAGER
 * Serialize/deserialize the whole project (multi-room house + devices +
 * furniture + solar panels + schedules + tariff/energy settings +
 * automation rules) to/from a plain JSON object. No THREE.js objects
 * are ever stored - only plain data, which is exactly the shape a
 * Unity importer would need too.
 *
 * Two related but separate payloads (section 28):
 *  - serialize() - the editable PROJECT (house/devices/schedules/
 *    settings). Used for undo/redo snapshots too, so it deliberately
 *    stays small/fast and does NOT include simulation clock/history -
 *    undo should rewind an edit, never rewind the simulated calendar.
 *  - serializeFull() = serialize() + SimulationEngine.serializeProgress()
 *    (elapsed simulated time, lifetime totals, day-by-day history).
 *    Used only by saveLocal()/exportFile(), so closing and reopening
 *    the browser resumes the simulation's timeline instead of
 *    resetting the clock to 08:00 Day 0 every time.
 */
/** Save-format version. 3 = tariffs + weather + PV priority (2 values). 4 = 3-slot PV order, export/import limits,
 *  battery reserve. 5 = electrical installation (sockets/strips/board/meter objects, circuits, breakers, wires, plugs);
 *  older files get a complete installation generated on load (ElectricalSystem.autoInstall).
 *  6 = house designer: levels, per-room walls / openings / partitions / roof, stairs, room offsets in Z (pre-6 files get
 *  the legacy design generated on load: same windows/doors/roof as before, one level). Older files load through migrateEnergySettings() (see below) with no data loss. */
const PROJECT_VERSION = 6;

class ProjectManager {
  constructor({ objectManager, getHouseState, setHouseState, getEnergySettings, setEnergySettings, automationManager, simulationEngine, rebuildHouse, onLog, electrical, onInstallationChanged }){
    this.om = objectManager;
    this.electrical = electrical || null;                 // ElectricalSystem
    this.onInstallationChanged = onInstallationChanged || (()=>{});
    this.getHouseState = getHouseState;
    this.setHouseState = setHouseState;
    this.getEnergySettings = getEnergySettings;
    this.setEnergySettings = setEnergySettings;
    this.automation = automationManager;
    this.sim = simulationEngine || null;
    this.rebuildHouse = rebuildHouse;
    this.onLog = onLog || (()=>{});
    this.projectName = 'Moj Dom';
    this.history = []; this.future = [];
    this._suspend = false;
  }

  serialize(){
    return {
      version: PROJECT_VERSION,
      projectName: this.projectName,
      house: this.getHouseState(),
      energy: this.getEnergySettings(),
      automationRules: this.automation.rules,
      installation: this.electrical ? this.electrical.serialize() : undefined,
      objects: this.om.getAll().map(i => ({
        id:i.id, kind:i.kind, defId:i.defId, roomId:i.roomId, customName:i.customName,
        position:i.position, rotation:i.rotation, scale:i.scale,
        connected:i.connected, schedule:i.schedule, manualOverride:i.manualOverride,
        socKWh: i.kind==='battery' ? i.runtime.socKWh : undefined,
        slope: i.kind==='solar' ? (i.slope || 'a') : undefined,
        plugTo: (i.kind==='device' || i.kind==='electrical') ? (i.plugTo || null) : undefined,
        circuitId: i.kind==='electrical' ? (i.circuitId || null) : undefined,
        enabled: i.kind==='electrical' ? i.enabled !== false : undefined,
      })),
    };
  }
  /** Full save payload - project + simulation progress (section 28). */
  serializeFull(){
    const out = this.serialize();
    if (this.sim) out.simProgress = this.sim.serializeProgress();
    return out;
  }

  deserialize(json){
    if (!json || typeof json !== 'object') throw new Error(I18n.t('msg.invalidProjectFile'));
    this.projectName = json.projectName || 'Projekt';
    const house = BuildingModel.migrateHouse(json.house && Array.isArray(json.house.rooms) ? json.house : defaultHouseState());   // pre-designer projects get levels + a design per room
    this.setHouseState(house);
    this.rebuildHouse();
    this.setEnergySettings(migrateEnergySettings(json.energy));
    this.om.clear();
    this.automation.rules = Array.isArray(json.automationRules) ? json.automationRules : [];
    const idMap = {};   // saved object id -> new object id (ObjectManager numbers objects afresh on every load)
    if (Array.isArray(json.objects)){
      for (const o of json.objects){
        try {
          const roomId = o.roomId || 'main';
          const inst = o.kind==='furniture' ? this.om.addFurniture(o.defId, o.position, roomId)
                     : o.kind==='solar'      ? this.om.addSolar(o.defId, o.position, roomId, o.slope)
                     : o.kind==='battery'     ? this.om.addBattery(o.defId, o.position, roomId)
                     : o.kind==='electrical'  ? this.om.addElectrical(o.defId, o.position, roomId)
                                              : this.om.addDevice(o.defId, o.position, roomId);
          if (!inst) continue;
          if (o.id) idMap[o.id] = inst.id;
          if (o.kind==='electrical'){ inst.circuitId = o.circuitId || null; inst.enabled = o.enabled !== false; inst.plugTo = o.plugTo || null; }
          else if (o.kind==='device') inst.plugTo = o.plugTo || null;
          this.om.applyTransform(inst.id, o.position||{x:0,y:0,z:0}, o.rotation||{x:0,y:0,z:0}, o.scale||{x:1,y:1,z:1});
          if (o.customName) this.om.rename(inst.id, o.customName);
          if (typeof o.connected === 'boolean') this.om.setConnected(inst.id, o.connected);
          if (o.manualOverride) this.om.setManualOverride(inst.id, o.manualOverride);
          if (o.schedule) this.om.setSchedule(inst.id, o.schedule);
          if (o.kind==='battery' && typeof o.socKWh === 'number') inst.runtime.socKWh = o.socKWh;
        } catch(e){ console.warn('Skipping corrupt object entry', e); }
      }
    }
    if (this.electrical){
      // plug references point at OLD object ids - translate them, then load the installation itself
      for (const inst of this.om.getAll()) if (inst.plugTo) inst.plugTo = idMap[inst.plugTo] || null;
      if (json.installation){
        this.electrical.load(json.installation);
        ElectricalSystem.remapIds(this.electrical.data, idMap);
        this.electrical.prune();
      } else {
        // version < 5 project: build a complete, sensible installation around what is already there
        this.electrical.load(null);
        this.electrical.autoInstall();
      }
      this.onInstallationChanged();
    }
    if (this.sim){
      if (json.simProgress) this.sim.deserializeProgress(json.simProgress);
      else this.sim.resetProgress(); // a plain undo/redo snapshot (no simProgress) never touches the clock; only an explicit "no progress at all" load resets it
    }
  }

  saveLocal(){
    try {
      localStorage.setItem('energyroom3d_project', JSON.stringify(this.serializeFull()));
      this.onLog(I18n.t('log.projectSaved'));
      return true;
    } catch(e){ console.error(e); this.onLog(I18n.t('log.projectSaveError')); return false; }
  }
  loadLocal(){
    try {
      const raw = localStorage.getItem('energyroom3d_project');
      if (!raw) { this.onLog(I18n.t('log.noSavedProject')); return false; }
      this.deserialize(JSON.parse(raw));
      this.onLog(I18n.t('log.projectLoaded'));
      return true;
    } catch(e){ console.error(e); this.onLog(I18n.t('log.projectLoadError')); return false; }
  }
  hasLocal(){ return !!localStorage.getItem('energyroom3d_project'); }

  exportFile(){
    const data = JSON.stringify(this.serializeFull(), null, 2);
    const blob = new Blob([data], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (this.projectName||'energyroom_project').replace(/[^a-z0-9_\-]+/gi,'_') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.onLog(I18n.t('log.projectExported'));
  }
  importFile(file, cb){
    const reader = new FileReader();
    reader.onload = () => {
      try { this.deserialize(JSON.parse(reader.result)); this.onLog(I18n.t('log.projectImported')); cb && cb(true); }
      catch(e){ console.error(e); this.onLog(I18n.t('log.projectImportError')); cb && cb(false); }
    };
    reader.onerror = () => { this.onLog(I18n.t('log.fileReadError')); cb && cb(false); };
    reader.readAsText(file);
  }

  newProject(){
    this.projectName = 'Nowy Dom';
    this.setHouseState(freshHouseState());
    this.rebuildHouse();
    this.setEnergySettings(freshEnergySettings());
    this.om.clear();
    if (this.electrical){ this.electrical.load(null); this.electrical.autoInstall(); this.onInstallationChanged(); }
    this.automation.rules = [];
    this.history=[]; this.future=[];
    if (this.sim) this.sim.resetProgress();
    this.onLog(I18n.t('log.newProjectCreated'));
  }

  /** Section 29: the "New Simulation" wizard - a fully blank project (no PV, section 14) with the
   *  chosen name/tariff/start date. Populating starter furniture (if any) is left to the caller
   *  (UIManager), which knows about the demo-house builder functions - this stays focused on state. */
  startNewSimulation({ projectName, tariffCode, startDateISO } = {}){
    this.newProject();
    if (projectName && projectName.trim()) this.projectName = projectName.trim().slice(0,40);
    const s = this.getEnergySettings();
    if (tariffCode && TariffManager.CODES.includes(tariffCode)) s.tariffCode = tariffCode;
    s.startDateISO = startDateISO || new Date().toISOString();
    this.setEnergySettings(s);
    if (this.sim) this.sim._syncCalendarEpoch(); // re-anchor to the just-chosen start date (newProject()'s resetProgress ran before this was known)
  }

  /** Section 28's "Resetuj symulację" with confirmation - the confirmation dialog itself lives in
   *  UIManager; by the time this is called the user has already confirmed. */
  resetSimulation(){
    this.newProject();
    try{ localStorage.removeItem('energyroom3d_project'); }catch(e){}
    this.pushHistory();
    this.onLog(I18n.t('log.simulationReset'));
  }

  // ---------------- UNDO / REDO (snapshot based - project state only, never simulation progress) ----------------
  pushHistory(){
    if (this._suspend) return;
    this.history.push(JSON.stringify(this.serialize()));
    if (this.history.length > 40) this.history.shift();
    this.future = [];
  }
  undo(){
    if (!this.history.length) { this.onLog(I18n.t('log.nothingToUndo')); return; }
    const current = JSON.stringify(this.serialize());
    const prev = this.history.pop();
    this.future.push(current);
    this._suspend = true;
    this.deserialize(JSON.parse(prev));
    this._suspend = false;
    this.onLog(I18n.t('log.undone'));
  }
  redo(){
    if (!this.future.length) { this.onLog(I18n.t('log.nothingToRedo')); return; }
    const next = this.future.pop();
    this.history.push(JSON.stringify(this.serialize()));
    this._suspend = true;
    this.deserialize(JSON.parse(next));
    this._suspend = false;
    this.onLog(I18n.t('log.redone'));
  }
}

/**
 * ROOM TYPE METADATA
 * Every room "type" the user can add from Room Settings -> "+ Dodaj pokój".
 * icon: shown on room tabs and the room picker chips.
 * label: default display name given to a freshly added room of this type.
 * defaults: starting RoomSettings (width/length/height/floor/wall/ceiling) -
 * just a sensible starting point, fully editable afterwards like any room.
 * Only 'garage' gets special geometry (sectional door + tilted roof, see
 * RoomBuilder) - every other type, including new ones added here, renders
 * as a standard rectangular room and is told apart only by its icon/
 * defaults and by which furniture's `onlyIn` allows it (see furniture.js).
 */
const ROOM_TYPE_META = {
  room:     { icon:'🛏', label:'Pokój',    defaults:{ width:7.0, length:5.0, height:2.8, floor:'Wood',     wall:'White',    ceiling:'White' } },
  garage:   { icon:'🚗', label:'Garaż',    defaults:{ width:5.5, length:5.5, height:2.6, floor:'Concrete', wall:'Concrete', ceiling:'White' } },
  kitchen:  { icon:'🍳', label:'Kuchnia',  defaults:{ width:5.0, length:4.0, height:2.8, floor:'Tile',     wall:'White',    ceiling:'White' } },
  bathroom: { icon:'🛁', label:'Łazienka', defaults:{ width:3.0, length:2.6, height:2.6, floor:'Tile',     wall:'White',    ceiling:'White' } },
  living:   { icon:'🛋', label:'Salon',    defaults:{ width:6.5, length:5.5, height:2.8, floor:'Wood',     wall:'White',    ceiling:'White' } },
  office:   { icon:'🖥', label:'Biuro',    defaults:{ width:4.0, length:3.5, height:2.8, floor:'Carpet',   wall:'Gray',     ceiling:'White' } },
};
// room types introduced by the house designer (utility room, basement, balcony, terrace, garden - see data/building.js)
for (const [t, m] of Object.entries(EXTRA_ROOM_TYPE_META)){
  ROOM_TYPE_META[t] = Object.assign({ label:({ utility:'Pomieszczenie gospodarcze', basement:'Piwnica', balcony:'Balkon', terrace:'Taras', garden:'Ogród' })[t] }, m);
}
function getRoomTypeMeta(type){ return ROOM_TYPE_META[type] || ROOM_TYPE_META.room; }

const DEFAULT_ROOM_SETTINGS = ROOM_TYPE_META.room.defaults;
const DEFAULT_GARAGE_SETTINGS = ROOM_TYPE_META.garage.defaults;
function defaultHouseState(){
  return {
    rooms: [
      { id:'main',   name:I18n.roomType('room'),  type:'room',   settings:{...DEFAULT_ROOM_SETTINGS},   offsetX:0 },
      { id:'garage', name:I18n.roomType('garage'),  type:'garage', settings:{...DEFAULT_GARAGE_SETTINGS}, offsetX: DEFAULT_ROOM_SETTINGS.width + 1.4 },
    ],
    activeRoomId: 'main',
    wallVisibility: 1,
  };
}
/** A ready-to-use house: same two rooms as before, now with levels / designs filled in. */
function freshHouseState(){ return BuildingModel.migrateHouse(defaultHouseState()); }

/** Builds a brand-new {code: {rate:price}} / {code: richSchedule} pair for every tariff, so
 *  switching tariffs back and forth in Settings never loses a tariff's own customized hours/prices
 *  within one project (section 2: "taryfa powinna posiadać własny system konfiguracji godzin"). */
function freshAllTariffMaps(){
  const prices = {}, schedules = {};
  for (const code of TariffManager.CODES){
    const cfg = TariffManager.freshConfig(code);
    prices[code] = cfg.prices;
    schedules[code] = cfg.schedule;
  }
  return { prices, schedules };
}
function freshEnergySettings(){
  const { prices, schedules } = freshAllTariffMaps();
  return {
    currency:'PLN', extraFeesPerMonth:0, co2Factor:0.65,
    tariffCode:'G11', tariffPrices:prices, tariffSchedules:schedules,
    exportPricePerKWh: 0.35, pvPriority:'home_first', pvOrder:['home','battery','grid'],
    exportLimitW:null, importLimitW:null, batteryReservePct:10,
    avgHouseholdKWhYear:2900,
    startDateISO: new Date().toISOString(),
  };
}
const DEFAULT_ENERGY_SETTINGS = freshEnergySettings();

/** Upgrades a saved/legacy energySettings object into the current tariff-based shape.
 *  Old projects only ever had {pricePerKWh, tariffMode, priceDay, priceNight, nightStart,
 *  nightEnd, cloudFactor} - none of that is thrown away conceptually, it's mapped onto the
 *  closest new tariff (flat -> G11, dual -> G12) so an old save keeps behaving the same way
 *  on first load, fully editable from there via the new tariff/schedule UI. */
function migrateEnergySettings(raw){
  const base = freshEnergySettings();
  if (!raw || typeof raw !== 'object') return base;
  const merged = { ...base, ...raw };
  merged.tariffPrices = { ...base.tariffPrices, ...(raw.tariffPrices||{}) };
  merged.tariffSchedules = { ...base.tariffSchedules, ...(raw.tariffSchedules||{}) };
  if (!raw.tariffCode){
    if (raw.tariffMode === 'dual'){
      merged.tariffCode = 'G12';
      merged.tariffPrices.G12 = { day: raw.priceDay ?? base.tariffPrices.G12.day, night: raw.priceNight ?? base.tariffPrices.G12.night };
    } else {
      merged.tariffCode = 'G11';
      merged.tariffPrices.G11 = { flat: raw.pricePerKWh ?? base.tariffPrices.G11.flat };
    }
  }
  if (!raw.startDateISO) merged.startDateISO = base.startDateISO;
  if (!raw.pvPriority) merged.pvPriority = 'home_first';
  if (raw.exportPricePerKWh == null) merged.exportPricePerKWh = base.exportPricePerKWh;
  // v3 -> v4: two-value pvPriority becomes a full 3-slot order (built from the LEGACY value, not the fresh default)
  merged.pvOrder = SimulationEngine.normalizePvOrder(raw.pvOrder, raw.pvPriority);
  merged.pvPriority = merged.pvOrder[0]==='battery' ? 'battery_first' : 'home_first';
  merged.exportLimitW = raw.exportLimitW == null ? null : raw.exportLimitW;
  merged.importLimitW = raw.importLimitW == null ? null : raw.importLimitW;
  if (raw.batteryReservePct == null) merged.batteryReservePct = 0; // legacy saves discharged batteries down to 0 % - keep their behaviour
  return merged;
}
