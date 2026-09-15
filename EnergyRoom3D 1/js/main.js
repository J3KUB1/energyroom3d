/**
 * MAIN — application bootstrap.
 * Builds the manager graph, sets up the demo room, and starts the app.
 * Unity mapping: a single "GameBootstrap" MonoBehaviour that wires up
 * all the manager singletons on Awake().
 */
(function(){
  let roomSettings = { ...DEFAULT_ROOM_SETTINGS };
  let energySettings = { ...DEFAULT_ENERGY_SETTINGS };

  const container = document.getElementById('threeContainer');
  const sceneManager = new SceneManager(container);
  const roomBuilder = new RoomBuilder(sceneManager.scene);
  const objectManager = new ObjectManager(sceneManager.scene, { getRoomHeight: ()=>roomSettings.height });
  const transformManager = new TransformManager(sceneManager, objectManager);

  function rebuildRoom(){ roomBuilder.build(roomSettings); }
  rebuildRoom();

  const automationManager = new AutomationManager({ getInstances: ()=>objectManager.getDevices() });

  const simulationEngine = new SimulationEngine({
    getInstances: ()=>objectManager.getAll().filter(i=>i.kind==='device'),
    automationManager,
    onMinuteTick: (sim)=>{
      if (sim.playing){
        const hour = sim.minuteOfDay/60;
        sceneManager.setDayNight(hour);
        const range = document.getElementById('dayNightRange');
        if (range){ range.value = hour.toFixed(1); document.getElementById('dayNightLabel').textContent = sim.clockLabel; }
      }
    },
  });

  const analyticsManager = new AnalyticsManager({
    getInstances: ()=>objectManager.getDevices(),
    getSettings: ()=>energySettings,
  });

  const projectManager = new ProjectManager({
    objectManager,
    getRoomSettings: ()=>roomSettings,
    setRoomSettings: (v)=>{ roomSettings = v; },
    getEnergySettings: ()=>energySettings,
    setEnergySettings: (v)=>{ energySettings = v; },
    automationManager,
    rebuildRoom,
  });

  const ui = new UIManager({
    sceneManager, roomBuilder, objectManager, transformManager, simulationEngine,
    analyticsManager, automationManager, projectManager,
    getRoomSettings: ()=>roomSettings, setRoomSettings: (v)=>{ roomSettings=v; },
    getEnergySettings: ()=>energySettings, setEnergySettings: (v)=>{ energySettings=v; },
    rebuildRoom,
  });

  // instantaneous state resolution even while paused (so the footer/props aren't frozen at 0)
  simulationEngine._recomputeInstant(false);

  // any committing change (add/remove/transform/schedule/settings) should invalidate the
  // cached weekly projection so the dashboard reflects it within one refresh, not up to 2.5s late
  const _origPushHistory = projectManager.pushHistory.bind(projectManager);
  projectManager.pushHistory = function(){ analyticsManager.invalidateCache(); return _origPushHistory(); };

  // ---------------- DEMO ROOM (spec section 42) ----------------
  // y=null lets ObjectManager auto-place ceiling/wall-mounted devices;
  // pass an explicit y (e.g. desk height 0.72) for tabletop items.
  function place(defId, x, z, ry, isFurniture, y){
    ry = ry||0;
    const yy = (y==null) ? 0 : y;
    const inst = isFurniture ? objectManager.addFurniture(defId, {x:x,y:yy,z:z}) : objectManager.addDevice(defId, {x:x,y:yy,z:z});
    if (inst){ objectManager.applyTransform(inst.id, {x:x,y:inst.position.y,z:z}, {x:0,y:ry,z:0}, {x:1,y:1,z:1}); }
    return inst;
  }

  function buildDemoRoom(){
    const W = roomSettings.width, L = roomSettings.length;
    const DESK_TOP = 0.72;
    place('desk', W-1.9, 0.9, 0, true);
    place('gaming_chair', W-1.9, 1.75, Math.PI, true);
    place('gaming_pc', W-1.55, 0.62, 0, false);
    place('monitor_27', W-2.05, 0.9, 0, false, DESK_TOP);
    place('monitor_24', W-1.65, 0.9, -0.35, false, DESK_TOP);
    place('console', W-2.3, 0.62, 0.1, false);
    place('laptop_charger', W-1.85, 0.75, 0, false, DESK_TOP);
    place('router', 0.35, 0.35, 0, false);

    place('tv_stand', 3.4, L-0.35, 0, true);
    place('tv_55', 3.4, L-0.35, 0, false, 0.4);
    place('soundbar', 3.4, L-0.32, 0, false, 0.4);
    place('sofa', 3.4, L-2.1, Math.PI, true);
    place('rug', 3.4, L-2.0, 0, true);
    place('coffee_table', 3.4, L-1.4, 0, true);
    place('smart_speaker', 2.9, L-0.35, 0, false, 0.4);

    place('bed', 1.2, 1.2, 0, true);
    place('wardrobe', 0.65, L-0.45, Math.PI/2, true);
    place('floor_lamp', 2.2, 1.6, 0, true);

    place('fridge', W-0.5, L-0.5, -Math.PI/2, false);

    place('ceiling_lamp', W/2, L/2, 0, false);
    place('led_strip', W-0.06, 1.1, Math.PI/2, false);
    place('ac_unit', 2.2, 0.06, 0, false);
  }

  const hasSaved = projectManager.hasLocal();
  if (hasSaved){
    projectManager.loadLocal();
  } else {
    buildDemoRoom();
  }
  projectManager.pushHistory();

  sceneManager.setView('home');

  window.EnergyRoom3D = { sceneManager, roomBuilder, objectManager, transformManager, simulationEngine, analyticsManager, automationManager, projectManager, ui };
})();
