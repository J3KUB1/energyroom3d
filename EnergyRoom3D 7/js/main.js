/**
 * MAIN — application bootstrap.
 * Builds the manager graph, sets up the two-room demo house (bedroom +
 * garage), and starts the app. As of this version the garage roof
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

  let houseState = defaultHouseState();
  let energySettings = { ...DEFAULT_ENERGY_SETTINGS, tariffPrices: JSON.parse(JSON.stringify(DEFAULT_ENERGY_SETTINGS.tariffPrices)), tariffSchedules: JSON.parse(JSON.stringify(DEFAULT_ENERGY_SETTINGS.tariffSchedules)) };

  const container = document.getElementById('threeContainer');
  const sceneManager = new SceneManager(container);
  const roomBuilder = new RoomBuilder(sceneManager.scene);
  const environmentBuilder = new EnvironmentBuilder(sceneManager.scene);

  function getRoom(id){ return houseState.rooms.find(r=>r.id===id); }
  function getActiveRoom(){ return getRoom(houseState.activeRoomId) || houseState.rooms[0]; }

  const objectManager = new ObjectManager(sceneManager.scene, {
    getRoomHeight: (roomId)=> (getRoom(roomId)||houseState.rooms[0]).settings.height,
    getRoofGroup: (roomId)=> roomBuilder.roofGroups[roomId] || null,
  });
  const transformManager = new TransformManager(sceneManager, objectManager);

  function rebuildHouse(){
    roomBuilder.build(houseState.rooms);
    for (const r of houseState.rooms) objectManager.setRoomOffset(r.id, r.offsetX, 0);
    roomBuilder.setWallVisibility(houseState.wallVisibility ?? 1);
    environmentBuilder.build(roomBuilder.bounds);
    // Solar panels live on the roof's own THREE.Group, which RoomBuilder recreates from scratch
    // on every rebuild (room resized, material changed, etc) - reattach them to the fresh roof
    // so they don't end up orphaned on a detached group that's no longer part of the scene.
    for (const p of objectManager.getSolar()){
      const roof = roomBuilder.roofGroups[p.roomId];
      if (roof && p.group.parent !== roof){
        roof.add(p.group);
        p.group.position.set(p.position.x, p.position.y, p.position.z);
        p.group.rotation.set(p.rotation.x, p.rotation.y, p.rotation.z);
      }
      objectManager.computePVOrientation(p); // roof pitch is part of the world transform - refresh after any reattach
    }
  }
  rebuildHouse();

  const automationManager = new AutomationManager({ getInstances: ()=>objectManager.getDevices() });
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
    onMinuteTick: (sim)=>{
      if (sim.playing){
        const hour = sim.minuteOfDay/60;
        sceneManager.setDayNight(hour);
        const range = document.getElementById('dayNightRange');
        if (range){ range.value = hour.toFixed(1); document.getElementById('dayNightLabel').textContent = sim.clockLabel; }
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

  const projectManager = new ProjectManager({
    objectManager,
    getHouseState: ()=>houseState,
    setHouseState: (v)=>{ houseState = v; },
    getEnergySettings: ()=>energySettings,
    setEnergySettings: (v)=>{ energySettings = v; },
    automationManager,
    simulationEngine,
    rebuildHouse,
  });

  const ui = new UIManager({
    sceneManager, roomBuilder, objectManager, transformManager, simulationEngine,
    analyticsManager, automationManager, projectManager, weatherManager, petManager,
    questManager, advisorEngine,
    getHouseState: ()=>houseState, setHouseState: (v)=>{ houseState=v; },
    getActiveRoom, getRoom,
    getEnergySettings: ()=>energySettings, setEnergySettings: (v)=>{ energySettings=v; },
    rebuildHouse,
  });

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
    const W = getRoom('main').settings.width, L = getRoom('main').settings.length;
    const DESK_TOP = 0.72;
    place('desk', W-1.9, 0.9, 0, true, null, 'main');
    place('gaming_chair', W-1.9, 1.75, Math.PI, true, null, 'main');
    place('gaming_pc', W-1.55, 0.62, 0, false, null, 'main');
    place('monitor_27', W-2.05, 0.9, 0, false, DESK_TOP, 'main');
    place('monitor_24', W-1.65, 0.9, -0.35, false, DESK_TOP, 'main');
    place('console', W-2.3, 0.62, 0.1, false, null, 'main');
    place('laptop_charger', W-1.85, 0.75, 0, false, DESK_TOP, 'main');
    place('router', 0.35, 0.35, 0, false, null, 'main');

    place('tv_stand', 3.4, L-0.35, 0, true, null, 'main');
    place('tv_55', 3.4, L-0.35, 0, false, 0.4, 'main');
    place('soundbar', 3.4, L-0.32, 0, false, 0.4, 'main');
    place('sofa', 3.4, L-2.1, Math.PI, true, null, 'main');
    place('rug', 3.4, L-2.0, 0, true, null, 'main');
    place('coffee_table', 3.4, L-1.4, 0, true, null, 'main');
    place('smart_speaker', 2.9, L-0.35, 0, false, 0.4, 'main');

    place('bed', 1.2, 1.2, 0, true, null, 'main');
    place('wardrobe', 0.65, L-0.45, Math.PI/2, true, null, 'main');
    place('floor_lamp', 2.2, 1.6, 0, true, null, 'main');

    place('fridge', W-0.5, L-0.5, -Math.PI/2, false, null, 'main');

    place('ceiling_lamp', W/2, L/2, 0, false, null, 'main');
    place('led_strip', W-0.06, 1.1, Math.PI/2, false, null, 'main');
    place('ac_unit', 2.2, 0.06, 0, false, null, 'main');
  }

  function buildDemoGarage(){
    const g = getRoom('garage');
    const W = g.settings.width, L = g.settings.length;
    place('car', W*0.62, L*0.5, Math.PI/2, true, null, 'garage');
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

  const hasSaved = projectManager.hasLocal();
  if (hasSaved){
    projectManager.loadLocal();
  } else {
    energySettings.startDateISO = new Date().toISOString();
    simulationEngine._syncCalendarEpoch(); // re-anchor now that the definitive start date is set (see section 3 day-of-week note in SimulationEngine)
    buildDemoMainRoom();
    buildDemoGarage();
  }
  projectManager.pushHistory();

  sceneManager.setView('home');

  window.EnergyRoom3D = { sceneManager, roomBuilder, environmentBuilder, objectManager, transformManager, simulationEngine, analyticsManager, automationManager, projectManager, weatherManager, petManager, questManager, advisorEngine, ui, buildDemoMainRoom, buildDemoGarage };
})();
