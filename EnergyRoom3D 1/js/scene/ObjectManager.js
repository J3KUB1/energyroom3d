/**
 * OBJECT MANAGER
 * Bridges DataRepository (devices/furniture defs) <-> THREE.js groups.
 * Holds the authoritative list of placed instances. Rendering state
 * (glow/animation) is a pure function of instance.runtime.state, kept
 * separate from the energy simulation itself (spec section 20/28).
 * Unity mapping: ObjectManager + per-instance GameObject holding a
 * "DeviceView" component that mirrors RuntimeState -> visuals.
 */
class ObjectManager {
  constructor(scene, opts){
    this.scene = scene;
    this.root = new THREE.Group(); this.root.name='Objects'; scene.add(this.root);
    this.instances = []; // devices + furniture
    this._nextId = 1;
    this.onChange = ()=>{}; // hook for UI refresh
    this.getRoomHeight = (opts && opts.getRoomHeight) || (()=>2.8);
  }

  getAll(){ return this.instances; }
  getDevices(){ return this.instances.filter(i=>i.kind==='device'); }
  getFurniture(){ return this.instances.filter(i=>i.kind==='furniture'); }
  find(id){ return this.instances.find(i=>i.id===id); }

  addDevice(defId, pos){
    const def = getDeviceDefinition(defId);
    if (!def) return null;
    return this._add('device', def, pos);
  }
  addFurniture(defId, pos){
    const def = getFurnitureDefinition(defId);
    if (!def) return null;
    return this._add('furniture', def, pos);
  }

  _add(kind, def, pos){
    const group = ModelFactory.build(def.modelType);
    const id = 'obj_' + (this._nextId++);
    let y = pos?.y;
    if (y == null || y === 0){
      if (group.userData.ceiling) y = this.getRoomHeight() - 0.05;
      else if (group.userData.wallMount) y = 1.3;
      else y = 0;
    }
    group.position.set(pos?.x ?? 3.5, y, pos?.z ?? 2.5);
    group.userData.instId = id;
    this.root.add(group);

    const inst = {
      id, kind, defId: def.id, def,
      customName: null,
      group,
      position: { x: group.position.x, y: group.position.y, z: group.position.z },
      rotation: { x:0, y:0, z:0 },
      scale: { x:1, y:1, z:1 },
      connected: true,
      schedule: kind==='device' ? { ...ScheduleManager.validateSchedule(def.defaultSchedule) } : null,
      stats: { energyYearKWh: 0 },
      runtime: { state: kind==='device' ? (def.idleState||'off') : null, powerW: 0, continuousOnMinutes:0, standbyMinutes:0, automationOverride:null, pendingAutomation:null },
    };
    this.instances.push(inst);
    this.onChange();
    return inst;
  }

  remove(id){
    const inst = this.find(id);
    if (!inst) return;
    this.root.remove(inst.group);
    this.instances = this.instances.filter(i=>i.id!==id);
    this.onChange();
  }

  duplicate(id){
    const inst = this.find(id);
    if (!inst) return null;
    const copy = inst.kind==='device' ? this.addDevice(inst.defId, { x: inst.position.x+0.3, y: inst.position.y, z: inst.position.z+0.3 })
                                       : this.addFurniture(inst.defId, { x: inst.position.x+0.3, y: inst.position.y, z: inst.position.z+0.3 });
    if (!copy) return null;
    copy.rotation = { ...inst.rotation };
    copy.scale = { ...inst.scale };
    copy.customName = inst.customName;
    if (inst.kind==='device'){ copy.schedule = { ...inst.schedule }; copy.connected = inst.connected; }
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
  rename(id, name){ const inst=this.find(id); if(inst) inst.customName = name && name.trim() ? name.trim() : null; }

  clear(){ [...this.instances].forEach(i=>this.remove(i.id)); }

  /** Called every render frame - purely visual, cheap */
  updateVisuals(dt, dayHour){
    for (const inst of this.instances){
      if (inst.kind!=='device') continue;
      const state = inst.runtime.state;
      const isOn = state && state!=='off' && state!=='standby';
      const isStandby = state==='standby';
      const target = isOn ? 1 : (isStandby ? 0.18 : 0);
      for (const g of (inst.group.userData.glow||[])){
        const cur = g.mesh.material.emissiveIntensity;
        const next = cur + (target*g.onIntensity - cur) * Math.min(1, dt*6);
        g.mesh.material.emissiveIntensity = next;
      }
      // subtle animations for select categories while active
      if (isOn && inst.def.modelType==='fan' && inst.group.userData.spinPart){
        inst.group.userData.spinPart.rotation.z += dt*10;
      }
      if (isOn && inst.def.modelType==='ac' && inst.group.userData.glow[0]){
        // gentle pulsing handled by emissive lerp above already
      }
    }
  }
}
