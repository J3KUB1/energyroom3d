/**
 * OBJECT MANAGER
 * Bridges DataRepository (devices/furniture/solar defs) <-> THREE.js
 * groups. Supports multiple rooms: every instance lives inside a
 * per-room THREE.Group ("room group") whose position = that room's
 * world offset, so instance.position/rotation/scale stay simple
 * ROOM-LOCAL coordinates and moving a room (e.g. resizing an earlier
 * room shifts a later one) is just one group.position change.
 * Unity mapping: ObjectManager + per-room parent GameObject, each
 * instance a child GameObject holding a "DeviceView" component that
 * mirrors RuntimeState -> visuals.
 */
class ObjectManager {
  constructor(scene, opts){
    this.scene = scene;
    this.root = new THREE.Group(); this.root.name='Objects'; scene.add(this.root);
    this.instances = []; // devices + furniture + solar panels
    this._nextId = 1;
    this.onChange = ()=>{}; // hook for UI refresh
    this.getRoomHeight = (opts && opts.getRoomHeight) || (()=>2.8);
    this.getRoofGroup = (opts && opts.getRoofGroup) || (()=>null);
    this.roomGroups = new Map();
  }

  getRoomGroup(roomId){
    let g = this.roomGroups.get(roomId);
    if (!g){ g = new THREE.Group(); g.name='Room:'+roomId; this.root.add(g); this.roomGroups.set(roomId, g); }
    return g;
  }
  setRoomOffset(roomId, x, z){
    const g = this.getRoomGroup(roomId);
    g.position.set(x, 0, z||0);
  }
  removeRoomGroup(roomId){
    const g = this.roomGroups.get(roomId);
    if (g){ this.root.remove(g); this.roomGroups.delete(roomId); }
    this.instances = this.instances.filter(i=>i.roomId!==roomId);
  }

  getAll(roomId){ return roomId ? this.instances.filter(i=>i.roomId===roomId) : this.instances; }
  getDevices(roomId){ return this.getAll(roomId).filter(i=>i.kind==='device'); }
  getFurniture(roomId){ return this.getAll(roomId).filter(i=>i.kind==='furniture'); }
  getSolar(roomId){ return this.getAll(roomId).filter(i=>i.kind==='solar'); }
  getBattery(roomId){ return this.getAll(roomId).filter(i=>i.kind==='battery'); }
  find(id){ return this.instances.find(i=>i.id===id); }

  addDevice(defId, pos, roomId){
    const def = getDeviceDefinition(defId);
    if (!def) return null;
    return this._add('device', def, pos, roomId);
  }
  addFurniture(defId, pos, roomId){
    const def = getFurnitureDefinition(defId);
    if (!def) return null;
    return this._add('furniture', def, pos, roomId);
  }
  addSolar(defId, pos, roomId){
    const def = getSolarDefinition(defId);
    if (!def) return null;
    return this._add('solar', def, pos, roomId);
  }
  addBattery(defId, pos, roomId){
    const def = getBatteryDefinition(defId);
    if (!def) return null;
    const inst = this._add('battery', def, pos, roomId);
    if (inst) inst.runtime.socKWh = def.capacityKWh * 0.5; // start half-charged, like a real install
    return inst;
  }

  _add(kind, def, pos, roomId){
    roomId = roomId || 'main';
    const group = ModelFactory.build(def.modelType, kind!=='furniture');
    const id = 'obj_' + (this._nextId++);
    const roof = (kind==='solar') ? this.getRoofGroup(roomId) : null;
    const parent = roof || this.getRoomGroup(roomId);
    let y = pos?.y;
    if (y == null || y === 0){
      if (roof) y = roof.userData.surfaceY || 0;
      else if (group.userData.ceiling) y = this.getRoomHeight(roomId) - 0.05;
      else if (group.userData.wallMount) y = 1.3;
      else y = 0;
    }
    group.position.set(pos?.x ?? 1, y, pos?.z ?? 1);
    group.userData.instId = id;
    parent.add(group);

    const inst = {
      id, kind, defId: def.id, def, roomId,
      customName: null,
      group,
      position: { x: group.position.x, y: group.position.y, z: group.position.z },
      rotation: { x:0, y:0, z:0 },
      scale: { x:1, y:1, z:1 },
      connected: true,
      manualOverride: null, // null='Auto' (follow schedule) | 'on' | 'off' - user's direct power switch, wins over automation & schedule
      schedule: kind==='device' ? { ...ScheduleManager.validateSchedule(def.defaultSchedule) } : null,
      stats: { energyYearKWh: 0 },
      runtime: { state: kind==='device' ? (def.idleState||'off') : (kind==='solar' ? 'generating' : (kind==='battery' ? 'idle' : null)), powerW: 0, continuousOnMinutes:0, standbyMinutes:0, automationOverride:null, pendingAutomation:null },
    };
    this.instances.push(inst);
    this.onChange();
    return inst;
  }

  remove(id){
    const inst = this.find(id);
    if (!inst) return;
    inst.group.parent && inst.group.parent.remove(inst.group);
    this.instances = this.instances.filter(i=>i.id!==id);
    this.onChange();
  }

  duplicate(id){
    const inst = this.find(id);
    if (!inst) return null;
    const newPos = { x: inst.position.x+0.3, y: inst.position.y, z: inst.position.z+0.3 };
    const copy = inst.kind==='device' ? this.addDevice(inst.defId, newPos, inst.roomId)
               : inst.kind==='solar'  ? this.addSolar(inst.defId, newPos, inst.roomId)
               : inst.kind==='battery'? this.addBattery(inst.defId, newPos, inst.roomId)
                                       : this.addFurniture(inst.defId, newPos, inst.roomId);
    if (!copy) return null;
    copy.rotation = { ...inst.rotation };
    copy.scale = { ...inst.scale };
    copy.customName = inst.customName;
    if (inst.kind==='device'){ copy.schedule = { ...inst.schedule }; copy.connected = inst.connected; copy.manualOverride = inst.manualOverride; }
    // note: solar panels auto-parent to the room's roof group inside addSolar (see getRoofGroup),
    // so the duplicate already lands on the correct roof without any extra reparenting here.
    this.applyTransform(copy.id, copy.position, copy.rotation, copy.scale);
    return copy;
  }

  applyTransform(id, position, rotation, scale){
    const inst = this.find(id); if (!inst) return;
    if (position){ inst.position = {...position}; inst.group.position.set(position.x,position.y,position.z); }
    if (rotation){ inst.rotation = {...rotation}; inst.group.rotation.set(rotation.x,rotation.y,rotation.z); }
    if (scale){ inst.scale = {...scale}; inst.group.scale.set(scale.x,scale.y,scale.z); }
  }

  resetTransform(id){
    const inst = this.find(id); if (!inst) return;
    this.applyTransform(id, inst.position, {x:0,y:0,z:0}, {x:1,y:1,z:1});
  }

  setSchedule(id, schedule){
    const inst = this.find(id); if (!inst || inst.kind!=='device') return;
    inst.schedule = ScheduleManager.validateSchedule(schedule);
  }
  setConnected(id, v){
    const inst = this.find(id); if (!inst) return;
    inst.connected = v;
  }
  /** value: null (Auto/follow schedule), 'on' (force dominant "on" state), 'off' (force 0W) */
  setManualOverride(id, value){
    const inst = this.find(id); if (!inst || inst.kind!=='device') return;
    inst.manualOverride = value;
  }
  rename(id, name){ const inst=this.find(id); if(inst) inst.customName = name && name.trim() ? name.trim() : null; }

  clear(){ [...this.instances].forEach(i=>this.remove(i.id)); }

  /** Called every render frame - purely visual, cheap */
  updateVisuals(dt){
    for (const inst of this.instances){
      if (inst.group.userData.rgbMat){
        // easter egg: the croissant cycles through the rainbow forever, no device state involved
        const t = (performance.now()*0.0004) % 1;
        inst.group.userData.rgbMat.emissive.setHSL(t, 1, 0.5);
        inst.group.userData.rgbMat.emissiveIntensity = 0.75 + Math.sin(performance.now()*0.003)*0.2;
        continue;
      }
      const state = inst.runtime.state;
      const isOn = inst.kind==='solar' ? (inst.runtime.powerW < -0.5)
                 : inst.kind==='battery' ? (state==='charging' || state==='discharging')
                 : (state && state!=='off' && state!=='standby');
      const isStandby = state==='standby';
      const target = isOn ? 1 : (isStandby ? 0.18 : 0);
      for (const g of (inst.group.userData.glow||[])){
        const cur = g.mesh.material.emissiveIntensity;
        const next = cur + (target*g.onIntensity - cur) * Math.min(1, dt*6);
        g.mesh.material.emissiveIntensity = next;
      }
      // floor "on-air" glow ring - the single biggest legibility win: you can tell
      // a device is active from across the room, not just up close on its LED.
      const ring = inst.group.userData.ring;
      if (ring){
        const ringTarget = isOn ? 0.55 : (isStandby ? 0.14 : 0);
        ring.material.opacity += (ringTarget - ring.material.opacity) * Math.min(1, dt*5);
        ring.visible = ring.material.opacity > 0.01;
        if (isOn) ring.scale.setScalar(1 + Math.sin(performance.now()*0.002)*0.04);
      }
      // note: lamps deliberately do NOT cast real dynamic lights - the emissive glow above
      // is enough to read on/off state and keeps this renderable on low-end mobile GPUs.
      // subtle per-category idle animation while active
      if (isOn && inst.def.modelType==='fan' && inst.group.userData.spinPart){
        inst.group.userData.spinPart.rotation.z += dt*10;
      }
      if (isOn && inst.def.modelType==='kettle' && inst.group.userData.steam){
        inst.group.userData.steam.visible = true;
        inst.group.userData.steam.material.opacity = 0.35 + Math.sin(performance.now()*0.006)*0.15;
        inst.group.userData.steam.position.y += dt*0.05;
        if (inst.group.userData.steam.position.y > 0.42) inst.group.userData.steam.position.y = 0.28;
      } else if (inst.group.userData.steam){
        inst.group.userData.steam.visible = false;
      }
      if (inst.kind==='solar' && inst.group.userData.cellsMat){
        const gen = Math.min(1, Math.max(0, -inst.runtime.powerW / (inst.def.peakPowerW||400)));
        inst.group.userData.cellsMat.emissiveIntensity += ((gen*0.9) - inst.group.userData.cellsMat.emissiveIntensity)*Math.min(1,dt*4);
      }
    }
  }
}
