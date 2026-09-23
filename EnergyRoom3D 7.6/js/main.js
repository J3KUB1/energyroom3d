/**
 * MAIN — application bootstrap.
 * Builds the manager graph, sets up the starter house (kitchen, lounge,
 * bedroom, office and garage), and starts the app. The garage roof
 * starts with NO solar panels pre-installed (spec section 14) - the
 * player installs their own via the "PV install mode" toggle in the
 * top bar, which is what makes panel count/orientation/tilt a genuine
 * choice with genuine consequences (section 15) rather than a fixed
 * starting fixture.
 * Unity mapping: a single "GameBootstrap" MonoBehaviour that wires up
 * all the manager singletons on Awake().
 */
(function(){
  I18n.init();

  let building = null;                   // BuildingModel.compile(houseState): rebuilt with the house
  let houseState = freshHouseState();   // levels + per-room designs included (see BuildingModel)
  let energySettings = { ...DEFAULT_ENERGY_SETTINGS, tariffPrices: JSON.parse(JSON.stringify(DEFAULT_ENERGY_SETTINGS.tariffPrices)), tariffSchedules: JSON.parse(JSON.stringify(DEFAULT_ENERGY_SETTINGS.tariffSchedules)), pvOrder: DEFAULT_ENERGY_SETTINGS.pvOrder.slice() };

  const container = document.getElementById('threeContainer');
  const sceneManager = new SceneManager(container);
  const roomBuilder = new RoomBuilder(sceneManager.scene);
  const environmentBuilder = new EnvironmentBuilder(sceneManager.scene);
  sceneManager.roomBuilder = roomBuilder; // floor grid lives in RoomBuilder (per room, room-local coordinates)

  // Geometric PV shading (buildings, roofs, trees, other panels). SolarCalculator consults it for EVERY
  // caller - the live simulation and the analytics projections - so shade genuinely changes production.
  const shadeModel = new ShadeModel();
  SolarCalculator.shadeModel = shadeModel;

  function getRoom(id){ return houseState.rooms.find(r=>r.id===id); }
  function getActiveRoom(){ return getRoom(houseState.activeRoomId) || houseState.rooms[0]; }

  const objectManager = new ObjectManager(sceneManager.scene, {
    getRoomHeight: (roomId)=> (getRoom(roomId)||houseState.rooms[0]).settings.height,
    getRoofGroup: (roomId, slope)=> roomBuilder.roofGroups[slope==='b' ? roomId+'#b' : roomId] || roomBuilder.roofGroups[roomId] || null,
  });
  objectManager.onPVGeometry = (inst)=>{ if (inst.pvGeom) shadeModel.setPanel(inst.id, inst.pvGeom); };
  objectManager.onPVRemoved = (id)=>{ shadeModel.removePanel(id); };
  const transformManager = new TransformManager(sceneManager, objectManager);

  function rebuildHouse(){
    roomBuilder.build(houseState);
    for (const r of houseState.rooms){ const b = roomBuilder.bounds[r.id]; objectManager.setRoomOffset(r.id, b.offsetX, b.offsetZ, b.elevation); }
    roomBuilder.setWallVisibility(houseState.wallVisibility ?? 1);
    environmentBuilder.build(roomBuilder.bounds, houseState);
    // static shading geometry = buildings + trees; then fit the sun's shadow frustum to the whole plot
    shadeModel.setStaticOccluders(roomBuilder.occluders.concat(environmentBuilder.occluders));
    {
      let x1=Infinity, x2=-Infinity, z1=Infinity, z2=-Infinity;
      for (const id in roomBuilder.bounds){ const b = roomBuilder.bounds[id]; x1=Math.min(x1,b.offsetX); x2=Math.max(x2,b.offsetX+b.width); z1=Math.min(z1,b.offsetZ); z2=Math.max(z2,b.offsetZ+b.length); }
      if (isFinite(x1)) sceneManager.dayNight.setFocus((x1+x2)/2, (z1+z2)/2, Math.hypot(x2-x1, z2-z1)/2 + 6);
    }
    // Solar panels live on the roof's own THREE.Group, which RoomBuilder recreates from scratch
    // on every rebuild (room resized, material changed, etc) - reattach them to the fresh roof
    // so they don't end up orphaned on a detached group that's no longer part of the scene.
    for (const p of objectManager.getSolar()){
      const roof = roomBuilder.roofGroups[p.slope==='b' ? p.roomId+'#b' : p.roomId] || roomBuilder.roofGroups[p.roomId];
      if (roof && p.group.parent !== roof){
        roof.add(p.group);
        p.group.position.set(p.position.x, p.position.y, p.position.z);
        p.group.rotation.set(p.rotation.x, p.rotation.y, p.rotation.z);
      }
      objectManager.computePVOrientation(p); // roof pitch is part of the world transform - refresh after any reattach
    }
    building = BuildingModel.compile(houseState);   // envelopes (UA, thermal mass, windows...), shading geometry, design issues
    applyLevelView();
  }

  /** Which storeys are drawn: the active level and everything below it ("cutaway"), or the whole house. */
  function applyLevelView(){
    const act = BuildingModel.level(houseState, houseState.activeLevelId);
    const all = houseState.levelView === 'all' || houseState.activeRoomId === '__all__';
    for (const r of houseState.rooms){
      const vis = all || BuildingModel.elevation(houseState, r) <= act.elevation + 0.01;
      const rg = roomBuilder.roomGroups[r.id]; if (rg) rg.visible = vis;
      objectManager.getRoomGroup(r.id).visible = vis;
    }
    environmentBuilder.group.visible = all || act.elevation >= -0.01;   // the lawn hides a basement, so drop it when you look at one
  }
  rebuildHouse();

  // ---- Electrical installation (Stage 2): sockets/strips/board/meter are objects; circuits, breakers and wires live in ElectricalSystem ----
  const electrical = new ElectricalSystem({
    getElements: ()=>objectManager.getElectrical(),
    getDevices: ()=>objectManager.getDevices(),
    getRooms: ()=>houseState.rooms.map(r=>({ id:r.id, name:r.name, type:r.type, offsetX:r.offsetX||0, offsetZ:r.offsetZ||0, elevation:BuildingModel.elevation(houseState, r), width:r.settings.width, length:r.settings.length, height:r.settings.height })),
    createElement: (defId, roomId, pos, rotY)=>objectManager.addElectrical(defId, pos, roomId, rotY),
    removeElement: (id)=>objectManager.remove(id),
    onEvent: (ev)=>handleElectricalEvent(ev),
  });
  const wireRenderer = new WireRenderer(sceneManager.scene, electrical);
  objectManager.onDeviceAdded = (inst)=>{ if (!electrical.suspendAutoPlug) electrical.autoPlug(inst); };
  function handleElectricalEvent(ev){
    const ui = window.EnergyRoom3D && window.EnergyRoom3D.ui; if (!ui) return;
    const b = ev.breakerId ? electrical.breaker(ev.breakerId) : null;
    const circ = ev.circuitIds && ev.circuitIds.length ? electrical.circuit(ev.circuitIds[0]) : (ev.circuitId ? electrical.circuit(ev.circuitId) : null);
    const name = (circ && circ.name) || (b && b.name) || '';
    const amps = ev.currentA != null ? ev.currentA.toFixed(1) : '';
    let msg = null;
    if (ev.type === 'breakerTrip') msg = I18n.t(ev.reason === 'shortCircuit' ? 'elec.event.breakerShort' : 'elec.event.breakerOverload', { name, amps, rating: b ? b.ratingA : '' });
    else if (ev.type === 'mainTrip') msg = I18n.t('elec.event.mainTrip', { amps });
    else if (ev.type === 'stripTrip') msg = I18n.t('elec.event.stripTrip', { amps });
    else if (ev.type === 'cableOverheat') msg = I18n.t('elec.event.cableOverheat', { name, amps });
    if (msg){ ui.log(msg); ui.toast('⚡ ' + msg); ui.onElectricalEvent && ui.onElectricalEvent(ev); }
  }

  const automationManager = new AutomationManager({ getInstances: ()=>objectManager.getDevices() });
  let pendingHour = null;
  let simulationEngine; // forward-declared so WeatherSystem's getSimDate closure can reference it once assigned below
  const weatherManager = new WeatherSystem({ getSimDate: ()=> simulationEngine ? simulationEngine.simDate : new Date() });
  const petManager = new PetManager({});
  const questManager = new QuestManager({});
  const advisorEngine = new AdvisorEngine();

  simulationEngine = new SimulationEngine({
    getInstances: ()=>objectManager.getAll().filter(i=>i.kind==='device'),
    getSolarInstances: ()=>objectManager.getAll().filter(i=>i.kind==='solar'),
    getBatteryInstances: ()=>objectManager.getAll().filter(i=>i.kind==='battery'),
    getSettings: ()=>energySettings,
    getStartDate: ()=> new Date(energySettings.startDateISO || Date.now()),
    automationManager,
    weatherManager,
    electrical,
    onMinuteTick: (sim)=>{
      if (sim.playing){
        // NOT applied here: at high speed this fires thousands of times per frame. The render-loop hook below
        // applies the latest hour once per frame (sky, sun, shadows, label).
        pendingHour = sim.minuteOfDay/60;
        // the companion is "fed" by data-bit trickle from active network/computer devices
        const activeNet = objectManager.getDevices().filter(d =>
          (d.def.category==='smarthome' || d.def.category==='computers') &&
          d.runtime.state && d.runtime.state!=='off' && d.runtime.state!=='standby').length;
        petManager.tickPassive(activeNet);
      }
    },
  });

  const analyticsManager = new AnalyticsManager({
    getInstances: ()=>objectManager.getDevices(),
    getSolarInstances: ()=>objectManager.getSolar(),
    getBatteryInstances: ()=>objectManager.getBattery(),
    getSettings: ()=>energySettings,
    getSim: ()=>simulationEngine,
  });

  const challengeManager = new ChallengeManager({
    simulationEngine, objectManager, analyticsManager, getHouseState:()=>houseState,
  });

  const projectManager = new ProjectManager({
    objectManager,
    getHouseState: ()=>houseState,
    setHouseState: (v)=>{ houseState = v; },
    getEnergySettings: ()=>energySettings,
    setEnergySettings: (v)=>{ energySettings = v; },
    automationManager,
    simulationEngine,
    rebuildHouse,
    electrical,
    onInstallationChanged: ()=>{ wireRenderer.markDirty(); },
  });

  const ui = new UIManager({
    sceneManager, roomBuilder, objectManager, transformManager, simulationEngine,
    analyticsManager, automationManager, projectManager, weatherManager, petManager,
    questManager, advisorEngine, electrical, wireRenderer, challengeManager,
    applyLevelView, getBuilding: ()=>building,
    getHouseState: ()=>houseState, setHouseState: (v)=>{ houseState=v; },
    getActiveRoom, getRoom,
    getEnergySettings: ()=>energySettings, setEnergySettings: (v)=>{ energySettings=v; },
    rebuildHouse,
  });

  // ---- sky / season / label: once per frame at most, and only when something visible changed ----
  sceneManager.getSkyContext = ()=>({
    dayOfYear: simulationEngine.dayOfYear,
    skyFactor: weatherManager.getMultipliers().skyFactor,
  });
  let lastSkyKey = '', lastAbsMin = -1;
  sceneManager.onFrame(()=>{
    let dirty = false;
    // clock moved (playing, skipTo, project load...) -> follow it; a manual slider preview while paused is left alone
    if (simulationEngine.absMin !== lastAbsMin){ lastAbsMin = simulationEngine.absMin; pendingHour = simulationEngine.minuteOfDay/60; }
    if (pendingHour != null){ sceneManager._hour = pendingHour; pendingHour = null; dirty = true; }
    const key = simulationEngine.dayOfYear + '|' + weatherManager.getMultipliers().skyFactor.toFixed(2);
    if (key !== lastSkyKey){ lastSkyKey = key; dirty = true; environmentBuilder.setSeason(simulationEngine.season); }
    if (dirty && sceneManager._hour != null){
      sceneManager.setDayNight(sceneManager._hour);
      if (window.EnergyRoom3D && window.EnergyRoom3D.ui) window.EnergyRoom3D.ui.updateDayNightLabel(true);
    }
  });
  // installation wires: rebuilt only when an element/wire changed (cheap signature, checked ~5x per second)
  let lastElecSig = '', lastElecCheck = 0;
  sceneManager.onFrame(()=>{
    const now = performance.now();
    if (now - lastElecCheck > 200){
      lastElecCheck = now;
      const sig = objectManager.getElectrical().map(e=>e.id+':'+e.position.x.toFixed(2)+','+e.position.y.toFixed(2)+','+e.position.z.toFixed(2)).join('|') + '#' + electrical.data.wires.map(w=>w.id+w.route+(w.damaged?'x':'')).join(',');
      if (sig !== lastElecSig){ lastElecSig = sig; wireRenderer.markDirty(); }
    }
    wireRenderer.update(now);
  });
  environmentBuilder.setSeason(simulationEngine.season);
  sceneManager.setDayNight(simulationEngine.minuteOfDay/60);
  ui.updateDayNightLabel(true);

  // instantaneous state resolution even while paused (so the footer/props aren't frozen at 0)
  simulationEngine._recomputeInstant(false);

  // any committing change (add/remove/transform/schedule/settings) should invalidate the
  // cached weekly projection so the dashboard reflects it within one refresh, not up to 2.5s late
  const _origPushHistory = projectManager.pushHistory.bind(projectManager);
  projectManager.pushHistory = function(){ analyticsManager.invalidateCache(); return _origPushHistory(); };

  // ---------------- DEMO HOUSE ----------------
  function place(defId, x, z, ry, isFurniture, y, roomId, kind){
    ry = ry||0;
    const yy = (y==null) ? 0 : y;
    const pos = {x:x,y:yy,z:z};
    const inst = kind==='solar' ? objectManager.addSolar(defId, pos, roomId)
               : kind==='battery' ? objectManager.addBattery(defId, pos, roomId)
               : isFurniture     ? objectManager.addFurniture(defId, pos, roomId)
                                  : objectManager.addDevice(defId, pos, roomId);
    if (inst){ objectManager.applyTransform(inst.id, {x:x,y:inst.position.y,z:z}, {x:0,y:ry,z:0}, {x:1,y:1,z:1}); }
    return inst;
  }

  function buildDemoMainRoom(){
    // Give each example room a clear purpose instead of mixing bedroom,
    // lounge, kitchen and office furniture in one space.
    const bedroom = getRoom('main'), W = bedroom.settings.width, L = bedroom.settings.length;
    place('bed', 1.25, 1.15, 0, true, null, 'main');
    place('nightstand', 2.25, 1.2, 0, true, null, 'main');
    place('wardrobe', W-0.45, L-1.0, Math.PI/2, true, null, 'main');
    place('floor_lamp', 3.15, 1.35, 0, true, null, 'main');
    place('desk_lamp', 2.25, 1.2, 0, false, 0.5, 'main');
    place('ceiling_lamp', W/2, L/2, 0, false, null, 'main');

    const living = getRoom('living'), LW = living.settings.width, LL = living.settings.length;
    place('tv_stand', LW/2, LL-0.35, 0, true, null, 'living');
    place('tv_55', LW/2, LL-0.35, 0, false, 0.4, 'living');
    place('soundbar', LW/2, LL-0.32, 0, false, 0.4, 'living');
    place('sofa', LW/2, LL-2.15, Math.PI, true, null, 'living');
    place('rug', LW/2, LL-2.0, 0, true, null, 'living');
    place('coffee_table', LW/2, LL-1.3, 0, true, null, 'living');
    place('smart_speaker', LW/2-0.6, LL-0.35, 0, false, 0.4, 'living');
    place('router', 0.35, 0.35, 0, false, null, 'living');
    place('floor_lamp', 1.15, LL-2.25, 0, true, null, 'living');
    place('ceiling_lamp', LW/2, LL/2, 0, false, null, 'living');

    const kitchen = getRoom('kitchen'), KW = kitchen.settings.width, KL = kitchen.settings.length;
    place('kitchen_counter', 0.75, 0.45, 0, true, null, 'kitchen');
    place('kitchen_counter', 2.05, 0.45, 0, true, null, 'kitchen');
    place('kitchen_sink', 2.05, 0.45, 0, true, 0.87, 'kitchen');
    place('table', KW/2, KL-1.2, 0, true, null, 'kitchen');
    place('dining_chair', KW/2, KL-0.35, 0, true, null, 'kitchen');
    place('dining_chair', KW/2+0.9, KL-1.2, Math.PI/2, true, null, 'kitchen');
    place('fridge', KW-0.45, KL-1.6, Math.PI/2, false, null, 'kitchen');
    place('kettle', 0.9, 0.45, 0, false, 0.9, 'kitchen');
    place('ceiling_lamp', KW/2, KL/2, 0, false, null, 'kitchen');

    const office = getRoom('office'), OW = office.settings.width, OL = office.settings.length;
    const DESK_TOP = 0.72;
    place('desk', 1.35, 0.85, 0, true, null, 'office');
    place('gaming_chair', 1.35, 1.7, Math.PI, true, null, 'office');
    place('gaming_pc', 1.7, 0.57, 0, false, null, 'office');
    place('monitor_27', 1.25, 0.85, 0, false, DESK_TOP, 'office');
    place('laptop_charger', 1.6, 0.7, 0, false, DESK_TOP, 'office');
    place('office_cabinet', OW-0.4, OL-0.5, 0, true, null, 'office');
    place('ceiling_lamp', OW/2, OL/2, 0, false, null, 'office');
  }

  function buildDemoGarage(){
    const g = getRoom('garage');
    const W = g.settings.width, L = g.settings.length;
    place('electric_car', W*0.62, L*0.5, Math.PI/2, true, null, 'garage');
    place('ev_charger', W-0.25, L*0.5, Math.PI/2, false, 1.3, 'garage');
    place('workbench', 0.55, L-0.9, 0, true, null, 'garage');
    place('garageshelf', 0.5, 0.7, Math.PI/2, true, null, 'garage');
    place('ceiling_lamp', W*0.3, L*0.5, 0, false, null, 'garage');
    place('smart_plug', 0.15, L-0.3, 0, false, 1.0, 'garage');
    // Section 14: the roof starts EMPTY. No solar panels are pre-installed - the player places
    // their own via "PV install mode" (UIManager), which is also what gives panel count/
    // orientation/tilt (section 15) real, felt consequences instead of a fixed starting fixture.
    // One battery in the corner, on the floor next to the workbench - PV panels aren't the only
    // thing here, and a battery with nothing to charge from yet is a fine, honest starting state.
    place('battery_10', W-0.35, L-1.9, Math.PI/2, false, null, 'garage', 'battery');
  }

  function buildDemoGarden(){
    const garden=getRoom('garden'); if(!garden) return;
    const W=garden.settings.width,L=garden.settings.length;
    place('gazebo',W*.34,L*.52,0,true,null,'garden');
    place('garden_garage',W*.78,L*.5,0,true,null,'garden');
    place('rainwater_tank',.65,.65,0,true,null,'garden');
    place('outdoor_lighting',.45,L-.45,0,false,null,'garden');
    place('irrigation_system',W-.7,L-1.0,0,false,null,'garden');
    place('electric_lawn_mower',W*.48,L*.9,Math.PI/2,false,null,'garden');
  }

  const hasSaved = projectManager.hasLocal();
  if (hasSaved){
    projectManager.loadLocal();
  } else {
    energySettings.startDateISO = new Date().toISOString();
    simulationEngine._syncCalendarEpoch(); // re-anchor now that the definitive start date is set (see section 3 day-of-week note in SimulationEngine)
    buildDemoMainRoom();
    buildDemoGarage();
    buildDemoGarden();
    electrical.load(null); electrical.autoInstall(); wireRenderer.markDirty();
  }
  projectManager.pushHistory();
  simulationEngine._recomputeInstant(false);

  ui._focusActiveRoom();

  window.EnergyRoom3D = { getBuilding: ()=>building, applyLevelView, electrical, wireRenderer, shadeModel, sceneManager, roomBuilder, environmentBuilder, objectManager, transformManager, simulationEngine, analyticsManager, automationManager, projectManager, weatherManager, petManager, questManager, advisorEngine, ui, buildDemoMainRoom, buildDemoGarage, buildDemoGarden };
  try { if (!localStorage.getItem('energyroom_welcome_done')) ui.openWelcome(); } catch(e) { ui.openWelcome(); }
})();
