/**
 * MAIN — application bootstrap.
 * Builds the manager graph, sets up the two-room demo house (bedroom +
 * garage with solar panels), and starts the app.
 * Unity mapping: a single "GameBootstrap" MonoBehaviour that wires up
 * all the manager singletons on Awake().
 */
(function(){
  let houseState = defaultHouseState();
  let energySettings = { ...DEFAULT_ENERGY_SETTINGS };

  const container = document.getElementById('threeContainer');
  const sceneManager = new SceneManager(container);
  const roomBuilder = new RoomBuilder(sceneManager.scene);

  function getRoom(id){ return houseState.rooms.find(r=>r.id===id); }
  function getActiveRoom(){ return getRoom(houseState.activeRoomId) || houseState.rooms[0]; }

  const objectManager = new ObjectManager(sceneManager.scene, {
    getRoomHeight: (roomId)=> (getRoom(roomId)||houseState.rooms[0]).settings.height,
  });
  const transformManager = new TransformManager(sceneManager, objectManager);

  function rebuildHouse(){
    roomBuilder.build(houseState.rooms);
    for (const r of houseState.rooms) objectManager.setRoomOffset(r.id, r.offsetX, 0);
    roomBuilder.setWallVisibility(houseState.wallVisibility ?? 1);
  }
  rebuildHouse();

  const automationManager = new AutomationManager({ getInstances: ()=>objectManager.getDevices() });

  const simulationEngine = new SimulationEngine({
    getInstances: ()=>objectManager.getAll().filter(i=>i.kind==='device'),
    getSolarInstances: ()=>objectManager.getAll().filter(i=>i.kind==='solar'),
    getTariff: ()=>energySettings,
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
    getSolarInstances: ()=>objectManager.getSolar(),
    getSettings: ()=>energySettings,
  });

  const projectManager = new ProjectManager({
    objectManager,
    getHouseState: ()=>houseState,
    setHouseState: (v)=>{ houseState = v; },
    getEnergySettings: ()=>energySettings,
    setEnergySettings: (v)=>{ energySettings = v; },
    automationManager,
    rebuildHouse,
  });

  const ui = new UIManager({
    sceneManager, roomBuilder, objectManager, transformManager, simulationEngine,
    analyticsManager, automationManager, projectManager,
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

    // solar panels on the roof - laid out in a simple grid, flush with the tilted roof plane
    const roof = roomBuilder.roofGroups['garage'];
    if (roof){
      const cols = 3, rows = 2;
      const panelW = 1.0, panelL = 1.65, gap = 0.06;
      const spanW = cols*panelW + (cols-1)*gap;
      const spanL = rows*panelL + (rows-1)*gap;
      const startX = -spanW/2 + panelW/2;
      const startZ = -spanL/2 + panelL/2 + 0.05;
      for (let r=0;r<rows;r++){
        for (let c=0;c<cols;c++){
          const inst = objectManager.addSolar('panel_400', { x:0, y:0, z:0 }, 'garage');
          if (!inst) continue;
          // reparent from the room group into the tilted roof group so it sits flush on the slope
          objectManager.getRoomGroup('garage').remove(inst.group);
          roof.add(inst.group);
          const lx = startX + c*(panelW+gap), lz = startZ + r*(panelL+gap);
          inst.group.position.set(lx, roof.userData.surfaceY, lz);
          inst.group.rotation.set(0,0,0);
          inst.roomId = 'garage';
          inst.position = { x:lx, y:roof.userData.surfaceY, z:lz };
        }
      }
    }
  }

  const hasSaved = projectManager.hasLocal();
  if (hasSaved){
    projectManager.loadLocal();
  } else {
    buildDemoMainRoom();
    buildDemoGarage();
  }
  projectManager.pushHistory();

  sceneManager.setView('home');

  window.EnergyRoom3D = { sceneManager, roomBuilder, objectManager, transformManager, simulationEngine, analyticsManager, automationManager, projectManager, ui };
})();
