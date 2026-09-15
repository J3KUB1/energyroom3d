/**
 * UI MANAGER
 * Wires every DOM element to the underlying managers. This file is the
 * only one allowed to touch the DOM - all other modules stay portable.
 * Unity mapping: this whole file has NO equivalent in Unity (UGUI/UI
 * Toolkit would replace it) - everything it calls into is portable.
 */
class UIManager {
  constructor(ctx){
    Object.assign(this, ctx);
    // ctx = { sceneManager, roomBuilder, objectManager, transformManager,
    //         simulationEngine, analyticsManager, automationManager,
    //         projectManager, getRoomSettings, setRoomSettings,
    //         getEnergySettings, setEnergySettings, rebuildRoom }
    this.currentCategory = 'lighting';
    this.currentMode = 'edit';
    this.compareSelection = [];
    this.charts = {};
    this.achievements = new Set();
    this._alertThrottle = 0;

    this._bindTopbar();
    this._bindViewportToolbar();
    this._bindRightPanelEvents();
    this._bindDashboard();
    this._bindRoomSettings();
    this._bindSmartHome();
    this._bindSettingsModal();
    this._bindEduModal();
    this._bindLogPanel();
    this._bindKeyboard();
    this._bindTutorial();
    this._bindModalGeneric();

    this.transformManager.onSelect = (inst)=>this.renderProperties(inst);
    this.transformManager.onHover = (inst,e)=>this.renderTooltip(inst,e);
    this.transformManager.onTransformCommit = (inst)=>{ this.renderProperties(inst, true); this.projectManager.pushHistory(); };
    this.objectManager.onChange = ()=>{ this.refreshAssetGridPowerHints(); this.analyticsManager.invalidateCache(); };

    this.simulationEngine.onLog = (msg)=> this.log(msg);
    this.simulationEngine.onDayRollover = ()=>{ this._checkAchievements(); };
    this.automationManager.onLog = (msg)=> this.log(msg);
    this.projectManager.onLog = (msg)=> this.log(msg);

    this.renderCategoryTabs();
    this.renderAssetGrid();
    this.updateModeUI();
    this.sceneManager.onFrame(()=>this._frameTick());
    setInterval(()=>this._slowTick(), 2000);
  }

  // ============================================================
  // TOP BAR
  // ============================================================
  _bindTopbar(){
    document.querySelectorAll('.mode-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        this.currentMode = btn.dataset.mode;
        document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active', b===btn));
        this.updateModeUI();
      });
    });
    document.getElementById('playPauseBtn').addEventListener('click', ()=>{
      this.simulationEngine.toggle();
      document.getElementById('playPauseBtn').textContent = this.simulationEngine.playing ? '⏸' : '▶';
    });
    document.getElementById('speedSelect').addEventListener('change', (e)=>{
      this.simulationEngine.setSpeed(Number(e.target.value));
    });
    document.querySelectorAll('.skip-btn').forEach(b=>{
      b.addEventListener('click', ()=> this.simulationEngine.skipTo(b.dataset.skip));
    });
    document.getElementById('btnUndo').addEventListener('click', ()=>this.projectManager.undo());
    document.getElementById('btnRedo').addEventListener('click', ()=>this.projectManager.redo());
    document.getElementById('btnSave').addEventListener('click', ()=>this.projectManager.saveLocal());
    document.getElementById('btnLoad').addEventListener('click', ()=>{ this.projectManager.loadLocal(); this.transformManager.deselect(); });
    document.getElementById('btnRoomSettings').addEventListener('click', ()=>this.openRoomSettings());
    document.getElementById('btnSmartHome').addEventListener('click', ()=>this.openSmartHome());
    document.getElementById('btnDashboard').addEventListener('click', ()=>this.openDashboard());
    document.getElementById('btnSettings').addEventListener('click', ()=>this.openSettings());

    const nameLabel = document.getElementById('projectNameLabel');
    nameLabel.addEventListener('click', ()=>{
      const v = prompt('Nazwa projektu / pokoju:', this.projectManager.projectName);
      if (v && v.trim()){ this.projectManager.projectName = v.trim(); nameLabel.textContent = v.trim(); }
    });
  }

  updateModeUI(){
    document.getElementById('simControls').classList.toggle('hidden', this.currentMode!=='sim');
    if (this.currentMode!=='sim' && this.simulationEngine.playing){ this.simulationEngine.pause(); document.getElementById('playPauseBtn').textContent='▶'; }
  }

  // ============================================================
  // LEFT PANEL — asset library
  // ============================================================
  renderCategoryTabs(){
    const wrap = document.getElementById('categoryTabs');
    wrap.innerHTML = '';
    const cats = [...DEVICE_CATEGORIES, { id:'furniture', label:'Meble' }];
    for (const c of cats){
      const b = document.createElement('button');
      b.className = 'cat-btn' + (c.id===this.currentCategory ? ' active':'');
      b.textContent = c.label;
      b.addEventListener('click', ()=>{ this.currentCategory=c.id; this.renderCategoryTabs(); this.renderAssetGrid(); });
      wrap.appendChild(b);
    }
  }

  renderAssetGrid(){
    const grid = document.getElementById('assetGrid');
    grid.innerHTML = '';
    const ICONS = {
      pc:'🖥',monitor:'🖵',laptop:'💻',router:'📶',printer:'🖨',console:'🎮',
      fridge:'🧊',washer:'🧺',dryer:'🌀',dishwasher:'🍽',oven:'🔥',microwave:'📦',kettle:'♨',coffeemaker:'☕',toaster:'🍞',vacuum:'🧹',
      tv:'📺',soundbar:'🔊',speaker:'🔈',settopbox:'📡',
      ceilinglamp:'💡',desklamp:'🛋',floorlamp:'🕯',ledstrip:'✨',
      ac:'❄',fan:'🌬',heater:'🔥',fanheater:'♨',
      smartbulb:'💡',smartplug:'🔌',hub:'🧠',motionsensor:'📡',camera:'📷',smartspeaker:'🗣',
      phonecharger:'🔋',laptopcharger:'🔋',aquarium:'🐠',airpurifier:'🌀',humidifier:'💧',
      bed:'🛏',desk:'🗄',chair:'🪑',gamingchair:'🎯',sofa:'🛋',coffeetable:'⬜',wardrobe:'🚪',dresser:'🗃',
      bookshelf:'📚',shelves:'📚',tvstand:'📺',table:'🍽',diningchair:'🪑',rug:'▦',
    };
    if (this.currentCategory==='furniture'){
      for (const def of FURNITURE_DEFINITIONS){
        grid.appendChild(this._assetCard(def.id, def.name, ICONS[def.modelType]||'▫', null, true));
      }
      return;
    }
    const defs = DEVICE_DEFINITIONS.filter(d=>d.category===this.currentCategory);
    for (const def of defs){
      grid.appendChild(this._assetCard(def.id, def.name, ICONS[def.modelType]||'▫', def.ratedPowerW, false));
    }
  }

  _assetCard(defId, name, icon, powerW, isFurniture){
    const card = document.createElement('div');
    card.className='asset-card';
    card.innerHTML = `<div class="asset-icon">${icon}</div><div class="asset-name">${name}</div>` +
      (powerW!=null ? `<div class="asset-power">${EnergyCalculator.fmtW(powerW)}</div>` : `<div class="asset-power">meble</div>`);
    card.addEventListener('click', ()=>{
      const pos = { x: (this.getRoomSettings().width/2), y:0, z:(this.getRoomSettings().length/2) };
      const inst = isFurniture ? this.objectManager.addFurniture(defId,pos) : this.objectManager.addDevice(defId,pos);
      if (inst){ this.transformManager.select(inst.id); this.projectManager.pushHistory(); this.log(`Dodano: ${inst.def.name}`); }
    });
    return card;
  }
  refreshAssetGridPowerHints(){ /* reserved for future live-power badges */ }

  // ============================================================
  // VIEWPORT TOOLBAR
  // ============================================================
  _bindViewportToolbar(){
    document.querySelectorAll('#gizmoModeGroup .tool-btn').forEach(b=>{
      b.addEventListener('click', ()=>{
        document.querySelectorAll('#gizmoModeGroup .tool-btn').forEach(x=>x.classList.toggle('active', x===b));
        this.transformManager.setMode(b.dataset.mode);
      });
    });
    document.getElementById('btnFocus').addEventListener('click', ()=>this._focusSelected());
    document.getElementById('btnDuplicate').addEventListener('click', ()=>this._duplicateSelected());
    document.getElementById('btnDelete').addEventListener('click', ()=>this._deleteSelected());
    document.getElementById('chkGrid').addEventListener('change', (e)=>this.sceneManager.setGridVisible(e.target.checked));
    document.getElementById('chkSnap').addEventListener('change', (e)=>this.transformManager.setSnap(e.target.checked));
    document.getElementById('gridSnapSelect').addEventListener('change', (e)=>this.transformManager.setGridSnap(Number(e.target.value)));
    document.getElementById('rotSnapSelect').addEventListener('change', (e)=>this.transformManager.setRotSnap(Number(e.target.value)));
    document.querySelectorAll('[data-view]').forEach(b=>{
      b.addEventListener('click', ()=>this.sceneManager.setView(b.dataset.view));
    });
    const dn = document.getElementById('dayNightRange');
    dn.addEventListener('input', ()=>{
      this.sceneManager.setDayNight(Number(dn.value));
      document.getElementById('dayNightLabel').textContent = ScheduleManager.fromMinutes(Number(dn.value)*60);
    });
    this.sceneManager.setDayNight(Number(dn.value));
  }

  _focusSelected(){ const inst=this.objectManager.find(this.transformManager.selectedId); if (inst) this.sceneManager.focusOn(inst.group); }
  _duplicateSelected(){
    if (!this.transformManager.selectedId) return;
    const copy = this.objectManager.duplicate(this.transformManager.selectedId);
    if (copy){ this.transformManager.select(copy.id); this.projectManager.pushHistory(); this.log(`Zduplikowano: ${copy.def.name}`); }
  }
  _deleteSelected(){
    const id = this.transformManager.selectedId; if (!id) return;
    const inst = this.objectManager.find(id);
    this.objectManager.remove(id);
    this.transformManager.deselect();
    this.projectManager.pushHistory();
    if (inst) this.log(`Usunięto: ${inst.def.name}`);
  }

  // ============================================================
  // KEYBOARD SHORTCUTS
  // ============================================================
  _bindKeyboard(){
    document.addEventListener('keydown', (e)=>{
      const tag = (e.target.tagName||'').toLowerCase();
      if (tag==='input' || tag==='select' || tag==='textarea') return;
      if (e.key==='Delete' || e.key==='Backspace'){ e.preventDefault(); this._deleteSelected(); }
      else if (e.ctrlKey && e.key.toLowerCase()==='d'){ e.preventDefault(); this._duplicateSelected(); }
      else if (e.ctrlKey && e.key.toLowerCase()==='z'){ e.preventDefault(); this.projectManager.undo(); }
      else if (e.ctrlKey && e.key.toLowerCase()==='y'){ e.preventDefault(); this.projectManager.redo(); }
      else if (e.key.toLowerCase()==='w'){ this._setGizmoMode('translate'); }
      else if (e.key.toLowerCase()==='e'){ this._setGizmoMode('rotate'); }
      else if (e.key.toLowerCase()==='r'){ this._setGizmoMode('scale'); }
      else if (e.key.toLowerCase()==='f'){ this._focusSelected(); }
      else if (e.key.toLowerCase()==='g'){ const c=document.getElementById('chkGrid'); c.checked=!c.checked; this.sceneManager.setGridVisible(c.checked); }
      else if (e.key==='Escape'){ this.transformManager.deselect(); this._closeAllModals(); }
      else if (e.key===' '){ e.preventDefault(); if (this.currentMode==='sim'){ document.getElementById('playPauseBtn').click(); } }
    });
  }
  _setGizmoMode(mode){
    this.transformManager.setMode(mode);
    document.querySelectorAll('#gizmoModeGroup .tool-btn').forEach(x=>x.classList.toggle('active', x.dataset.mode===mode));
  }

  // ============================================================
  // TOOLTIP (hover)
  // ============================================================
  renderTooltip(inst, e){
    const tip = document.getElementById('tooltip');
    if (!inst){ tip.classList.add('hidden'); return; }
    tip.classList.remove('hidden');
    tip.style.left = (e.clientX+16)+'px';
    tip.style.top = (e.clientY+12)+'px';
    if (inst.kind==='furniture'){
      tip.innerHTML = `<b>${inst.customName||inst.def.name}</b><div class="t-row"><span>Typ</span><b>Meble</b></div>`;
      return;
    }
    const today = this.simulationEngine.todayKWhByDevice[inst.id]||0;
    tip.innerHTML = `<b>${inst.customName||inst.def.name}</b>
      <div class="t-row"><span>Moc</span><b>${EnergyCalculator.fmtW(inst.runtime.powerW||0)}</b></div>
      <div class="t-row"><span>Stan</span><b>${inst.runtime.state}</b></div>
      <div class="t-row"><span>Dzisiaj</span><b>${EnergyCalculator.fmtKWh(today)}</b></div>`;
  }

  // ============================================================
  // RIGHT PANEL — properties
  // ============================================================
  _bindRightPanelEvents(){ /* delegated listeners are (re)attached each render in renderProperties */ }

  renderProperties(inst, transformOnly){
    const empty = document.getElementById('propEmpty');
    const content = document.getElementById('propContent');
    if (!inst){ empty.classList.remove('hidden'); content.classList.add('hidden'); return; }
    empty.classList.add('hidden'); content.classList.remove('hidden');

    if (transformOnly && this._lastRenderedId===inst.id){
      this._writeTransformFields(inst);
      return;
    }
    this._lastRenderedId = inst.id;

    const isDevice = inst.kind==='device';
    let html = `<input class="prop-name-input" id="propNameInput" value="${(inst.customName||inst.def.name)}">`;

    if (isDevice){
      const def = inst.def;
      const dsBadge = def.dataSource==='manufacturer' ? '<span class="badge manufacturer">MANUFACTURER</span>' : '<span class="badge estimated">ESTIMATED</span>';
      const dailyKWh = (this.simulationEngine.todayKWhByDevice[inst.id]||0);
      const s = this.getEnergySettings();
      html += `
      <div class="prop-section">
        <h4>Device</h4>
        <div class="prop-row"><span class="lbl">Producent</span><span class="val">${def.manufacturer}</span></div>
        <div class="prop-row"><span class="lbl">Model</span><span class="val">${def.model}</span></div>
        <div class="prop-row"><span class="lbl">Moc</span><span class="val">${EnergyCalculator.fmtW(inst.runtime.powerW||0)}</span></div>
        <div class="prop-row"><span class="lbl">Standby</span><span class="val">${EnergyCalculator.fmtW(def.standbyPowerW)}</span></div>
        <div class="prop-row"><span class="lbl">Stan</span><span class="val">
          <span class="state-pill"><span class="state-dot" style="background:${this._stateColor(inst.runtime.state)}"></span>${inst.runtime.state}</span>
        </span></div>
        <div class="prop-row"><span class="lbl">Dzisiejsza energia</span><span class="val">${EnergyCalculator.fmtKWh(dailyKWh)}</span></div>
        <div class="prop-row"><span class="lbl">Koszt dziś</span><span class="val">${EnergyCalculator.fmtCost(dailyKWh*s.pricePerKWh, s.currency)}</span></div>
        <div class="toggle-row"><span class="lbl">Podłączone do gniazdka</span>
          <label class="switch"><input type="checkbox" id="propConnected" ${inst.connected?'checked':''}><span class="slider-tog"></span></label>
        </div>
        <div style="margin-top:6px">${dsBadge}</div>
        <button class="small-btn edu-btn" id="propEduBtn">💡 Jak działa zużycie energii?</button>
      </div>`;
    } else {
      html += `<div class="prop-section"><h4>Furniture</h4>
        <div class="prop-row"><span class="lbl">Typ</span><span class="val">Meble</span></div>
        <div class="prop-row"><span class="lbl">Wpływ na energię</span><span class="val">brak</span></div>
      </div>`;
    }

    html += `
    <div class="prop-section">
      <h4>Transform</h4>
      <div class="xyz-head"><span></span><span>X</span><span>Y</span><span>Z</span></div>
      <div class="xyz-grid"><span class="axis-lbl">Pos</span>
        <input type="number" step="0.05" id="posX"><input type="number" step="0.05" id="posY"><input type="number" step="0.05" id="posZ"></div>
      <div class="xyz-grid"><span class="axis-lbl">Rot°</span>
        <input type="number" step="1" id="rotX"><input type="number" step="1" id="rotY"><input type="number" step="1" id="rotZ"></div>
      <div class="xyz-grid"><span class="axis-lbl">Scale</span>
        <input type="number" step="0.05" id="scaX"><input type="number" step="0.05" id="scaY"><input type="number" step="0.05" id="scaZ"></div>
      <button class="small-btn" id="propReset">Resetuj transformację</button>
    </div>`;

    if (isDevice){
      const def = inst.def;
      html += `
      <div class="prop-section">
        <h4>Energy</h4>
        <div class="prop-row"><span class="lbl">Rated Power</span><span class="val">${EnergyCalculator.fmtW(def.ratedPowerW)}</span></div>
        <div class="prop-row"><span class="lbl">Typical Power</span><span class="val">${EnergyCalculator.fmtW(Object.values(def.states).find(v=>v>0)||0)}</span></div>
        <div class="prop-row"><span class="lbl">Standby Power</span><span class="val">${EnergyCalculator.fmtW(def.standbyPowerW)}</span></div>
        ${def.cycleEnergyKWh!=null ? `<div class="prop-row"><span class="lbl">Cycle Energy</span><span class="val">${def.cycleEnergyKWh} kWh</span></div>`:''}
        <div class="prop-row"><span class="lbl">Klasa energ.</span><span class="val">${def.energyClass}</span></div>
        <div class="prop-row"><span class="lbl">Źródło danych</span><span class="val">${def.dataSource}</span></div>
        <div style="font-size:11px;color:var(--text-3);margin-top:4px">${def.sourceNote}</div>
      </div>
      <div class="prop-section">
        <h4>Schedule</h4>
        <div class="sched-field"><span>Start</span><input type="time" id="schedStart" value="${inst.schedule.start}"></div>
        <div class="sched-field"><span>Koniec</span><input type="time" id="schedEnd" value="${inst.schedule.end}"></div>
        <div class="days-row" id="daysRow"></div>
        <div class="timeline24" id="timeline24"></div>
      </div>`;
      if (this.compareSelection.length){
        html += `<div class="prop-section"><button class="small-btn" id="propAddCompare">➕ Dodaj do porównania (${this.compareSelection.length}/2)</button></div>`;
      } else {
        html += `<div class="prop-section"><button class="small-btn" id="propAddCompare">➕ Dodaj do porównania</button></div>`;
      }
    }

    content.innerHTML = html;
    this._writeTransformFields(inst);
    if (isDevice) this._renderDaysAndTimeline(inst);

    // ---- wire events ----
    document.getElementById('propNameInput').addEventListener('change', (e)=>{ this.objectManager.rename(inst.id, e.target.value); this.projectManager.pushHistory(); });
    document.getElementById('propReset').addEventListener('click', ()=>{ this.objectManager.resetTransform(inst.id); this._writeTransformFields(inst); this.projectManager.pushHistory(); });
    ['posX','posY','posZ','rotX','rotY','rotZ','scaX','scaY','scaZ'].forEach(id=>{
      document.getElementById(id).addEventListener('change', (e)=>{
        const axis = id.slice(3).toLowerCase();
        const field = id.startsWith('pos')?'position':id.startsWith('rot')?'rotation':'scale';
        this.transformManager.setTransformManual(inst.id, field, axis, Number(e.target.value)||0);
        this.projectManager.pushHistory();
      });
    });
    if (isDevice){
      document.getElementById('propConnected').addEventListener('change', (e)=>{ this.objectManager.setConnected(inst.id, e.target.checked); this.projectManager.pushHistory(); });
      document.getElementById('propEduBtn').addEventListener('click', ()=>this.openEdu(inst));
      document.getElementById('schedStart').addEventListener('change', (e)=>{ inst.schedule.start=e.target.value; this._renderDaysAndTimeline(inst); this.projectManager.pushHistory(); });
      document.getElementById('schedEnd').addEventListener('change', (e)=>{ inst.schedule.end=e.target.value; this._renderDaysAndTimeline(inst); this.projectManager.pushHistory(); });
      const cmp = document.getElementById('propAddCompare');
      if (cmp) cmp.addEventListener('click', ()=>{
        if (!this.compareSelection.includes(inst.id)) this.compareSelection.push(inst.id);
        if (this.compareSelection.length>2) this.compareSelection.shift();
        this.renderProperties(inst);
      });
    }
  }

  _stateColor(state){
    if (!state || state==='off') return '#5a6472';
    if (state==='standby') return 'var(--accent-power)';
    return 'var(--accent-good)';
  }

  _writeTransformFields(inst){
    document.getElementById('posX').value = inst.position.x.toFixed(2);
    document.getElementById('posY').value = inst.position.y.toFixed(2);
    document.getElementById('posZ').value = inst.position.z.toFixed(2);
    document.getElementById('rotX').value = THREE.MathUtils.radToDeg(inst.rotation.x).toFixed(0);
    document.getElementById('rotY').value = THREE.MathUtils.radToDeg(inst.rotation.y).toFixed(0);
    document.getElementById('rotZ').value = THREE.MathUtils.radToDeg(inst.rotation.z).toFixed(0);
    document.getElementById('scaX').value = inst.scale.x.toFixed(2);
    document.getElementById('scaY').value = inst.scale.y.toFixed(2);
    document.getElementById('scaZ').value = inst.scale.z.toFixed(2);
    // live energy/state readouts refresh without full re-render
    const stateEl = document.querySelector('.state-pill');
    if (stateEl) stateEl.innerHTML = `<span class="state-dot" style="background:${this._stateColor(inst.runtime.state)}"></span>${inst.runtime.state}`;
  }

  _renderDaysAndTimeline(inst){
    const daysRow = document.getElementById('daysRow');
    const labels = ['Nd','Pn','Wt','Śr','Cz','Pt','So'];
    daysRow.innerHTML='';
    for (let d=0; d<7; d++){
      const chip = document.createElement('div');
      chip.className='day-chip'+(inst.schedule.days.includes(d)?' active':'');
      chip.textContent = labels[d];
      chip.addEventListener('click', ()=>{
        if (inst.schedule.days.includes(d)) inst.schedule.days = inst.schedule.days.filter(x=>x!==d);
        else inst.schedule.days.push(d);
        this._renderDaysAndTimeline(inst); this.projectManager.pushHistory();
      });
      daysRow.appendChild(chip);
    }
    const tl = document.getElementById('timeline24');
    tl.innerHTML='';
    const dayIdx = this.simulationEngine.simDay;
    for (let h=0; h<24; h++){
      const { state } = ScheduleManager.resolve(inst, dayIdx*1440 + h*60 + 30);
      const seg = document.createElement('div');
      seg.className='tl-seg';
      seg.style.flex='1';
      const isOn = state && state!=='off' && state!=='standby';
      seg.style.background = isOn ? 'var(--accent-good)' : (state==='standby' ? 'var(--accent-power)' : 'rgba(255,255,255,0.06)');
      seg.title = `${h}:00 — ${state}`;
      tl.appendChild(seg);
    }
  }

  // ============================================================
  // FOOTER — live energy monitor
  // ============================================================
  _frameTick(dt){
    this.objectManager.updateVisuals(dt);
    const sim = this.simulationEngine;
    document.getElementById('simClock').textContent = sim.clockLabel;
    document.getElementById('emPower').textContent = EnergyCalculator.fmtW(sim.currentPowerW);
    document.getElementById('emPowerKW').textContent = (sim.currentPowerW/1000).toFixed(2)+' kW';
    document.getElementById('emToday').textContent = EnergyCalculator.fmtKWh(sim.todayKWh);
    const s = this.getEnergySettings();
    document.getElementById('emCostToday').textContent = EnergyCalculator.fmtCost(sim.todayKWh*s.pricePerKWh, s.currency);
    const active = this.objectManager.getDevices().filter(d=>d.runtime.state && d.runtime.state!=='off').length;
    document.getElementById('emActive').textContent = active;
  }

  _slowTick(){
    if (!this._proj) this._proj = this.analyticsManager.projections(this.simulationEngine.todayKWh);
    const proj = this.analyticsManager.projections(this.simulationEngine.todayKWh);
    const s = this.getEnergySettings();
    document.getElementById('emCostMonth').textContent = EnergyCalculator.fmtCost(proj.monthCost, s.currency);
    document.getElementById('emCostYear').textContent = EnergyCalculator.fmtCost(proj.yearCost, s.currency);
    document.getElementById('emCO2').textContent = Math.round(proj.co2Year)+' kg';
    // alerts
    const alerts = this.analyticsManager.alerts(this.simulationEngine);
    const wrap = document.getElementById('emAlerts');
    wrap.innerHTML = alerts.map(a=>`<div class="alert-chip ${a.level}">${a.level==='warning'?'⚠':a.level==='tip'?'💡':'ℹ'} ${a.text}</div>`).join('');
    if (!document.getElementById('dashboardModal').classList.contains('hidden')) this.refreshDashboard();
    this._checkAchievements();
  }

  // ============================================================
  // GENERIC MODAL HELPERS
  // ============================================================
  _bindModalGeneric(){
    document.querySelectorAll('.modal-close').forEach(b=>{
      b.addEventListener('click', ()=> document.getElementById(b.dataset.close).classList.add('hidden'));
    });
    document.querySelectorAll('.modal-backdrop').forEach(m=>{
      m.addEventListener('click', (e)=>{ if (e.target===m) m.classList.add('hidden'); });
    });
  }
  _closeAllModals(){ document.querySelectorAll('.modal-backdrop').forEach(m=>m.classList.add('hidden')); }

  // ============================================================
  // ENERGY DASHBOARD
  // ============================================================
  _bindDashboard(){
    document.querySelectorAll('.dtab').forEach(t=>{
      t.addEventListener('click', ()=>{
        document.querySelectorAll('.dtab').forEach(x=>x.classList.toggle('active', x===t));
        document.querySelectorAll('.dash-pane').forEach(p=>p.classList.add('hidden'));
        document.getElementById('pane'+t.dataset.tab[0].toUpperCase()+t.dataset.tab.slice(1)).classList.remove('hidden');
        if (t.dataset.tab==='whatif') this._renderWhatIf();
        if (t.dataset.tab==='compare') this._renderCompare();
        if (t.dataset.tab==='eco') this._renderEco();
      });
    });
  }

  openDashboard(){
    document.getElementById('dashboardModal').classList.remove('hidden');
    this.refreshDashboard();
  }

  refreshDashboard(){
    const sim = this.simulationEngine;
    const proj = this.analyticsManager.projections(sim.todayKWh);
    const s = this.getEnergySettings();
    document.getElementById('dashCards').innerHTML = [
      ['CURRENT POWER', EnergyCalculator.fmtW(sim.currentPowerW)],
      ['TODAY', EnergyCalculator.fmtKWh(proj.today)],
      ['TODAY COST', EnergyCalculator.fmtCost(proj.todayCost,s.currency)],
      ['MONTH', proj.month.toFixed(1)+' kWh'],
      ['MONTH COST', EnergyCalculator.fmtCost(proj.monthCost,s.currency)],
      ['YEAR ESTIMATE', Math.round(proj.year)+' kWh'],
      ['YEAR COST', EnergyCalculator.fmtCost(proj.yearCost,s.currency)],
      ['CO₂ / rok (szac.)', Math.round(proj.co2Year)+' kg'],
    ].map(([l,v])=>`<div class="dash-card"><div class="dc-label">${l}</div><div class="dc-value">${v}</div></div>`).join('');

    this._renderCharts(proj);
    this._renderRanking();
    this._renderScore();
    if (!document.getElementById('paneEco').classList.contains('hidden')) this._renderEco();
  }

  _chart(id, config){
    if (this.charts[id]) this.charts[id].destroy();
    const ctx = document.getElementById(id).getContext('2d');
    this.charts[id] = new Chart(ctx, config);
  }

  _renderCharts(proj){
    const gridColor='rgba(255,255,255,0.06)', textColor='#9aa7b8';
    Chart.defaults.color = textColor; Chart.defaults.borderColor = gridColor;
    const sim = this.simulationEngine;

    // 1. Power over time (live ring buffer)
    this._chart('chartPowerOverTime', { type:'line', data:{
      labels: sim.powerHistory.map(p=>ScheduleManager.fromMinutes(p.absMin%1440)),
      datasets:[{ label:'Moc [W]', data: sim.powerHistory.map(p=>p.watts), borderColor:'#ffb648', backgroundColor:'rgba(255,182,72,0.12)', fill:true, tension:0.3, pointRadius:0 }]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:'Power over time',color:'#e8edf4'}} }});

    // 2. Energy by hour (today, live)
    this._chart('chartEnergyByHour', { type:'bar', data:{
      labels:[...Array(24).keys()].map(h=>h+':00'),
      datasets:[{ label:'kWh', data: sim.hourlyKWh, backgroundColor:'#4fd1c5' }]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:'Energy consumption by hour',color:'#e8edf4'}} }});

    // 3. Energy by device (today live, fallback to projection)
    const rows = this.analyticsManager.ranking();
    this._chart('chartEnergyByDevice', { type:'doughnut', data:{
      labels: rows.slice(0,8).map(r=>r.name),
      datasets:[{ data: rows.slice(0,8).map(r=>r.dailyKWh), backgroundColor:['#ffb648','#4fd1c5','#9b7bff','#34d399','#ff6b6b','#67c8ff','#f2c14e','#d693ff'] }]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:'Energy consumption by device',color:'#e8edf4'}} }});

    // 4. Cost over time (projected week)
    const wk = proj.weekProjection;
    const s = this.getEnergySettings();
    this._chart('chartCostOverTime', { type:'line', data:{
      labels:['Pn','Wt','Śr','Cz','Pt','So','Nd'],
      datasets:[{ label:'Koszt dzienny', data:[1,2,3,4,5,6,0].map(d=>wk.perWeekdayTotal[d]*s.pricePerKWh), borderColor:'#4fd1c5', backgroundColor:'rgba(79,209,197,0.12)', fill:true, tension:0.3 }]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:'Cost over time',color:'#e8edf4'}} }});

    // 5. Daily comparison (weekday shape today vs typical weekday)
    const todayShape = this.analyticsManager.computeHourlyShape(sim.simDay);
    const otherDay = (sim.simDay+1)%7;
    const otherShape = this.analyticsManager.computeHourlyShape(otherDay);
    const dayNames=['Nd','Pn','Wt','Śr','Cz','Pt','So'];
    this._chart('chartDailyComparison', { type:'bar', data:{
      labels:[...Array(24).keys()],
      datasets:[
        { label:dayNames[sim.simDay]+' (dziś)', data:todayShape, backgroundColor:'#ffb648' },
        { label:dayNames[otherDay], data:otherShape, backgroundColor:'#4fd1c5' },
      ]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:'Daily comparison',color:'#e8edf4'}} }});

    // 6. Weekly consumption
    this._chart('chartWeekly', { type:'bar', data:{
      labels:['Nd','Pn','Wt','Śr','Cz','Pt','So'],
      datasets:[{ label:'kWh', data:wk.perWeekdayTotal, backgroundColor:'#9b7bff' }]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:'Weekly consumption',color:'#e8edf4'}} }});

    // 7. Monthly consumption projection (12 months, constant pattern -> flat but shown for completeness)
    const months=['Sty','Lut','Mar','Kwi','Maj','Cze','Lip','Sie','Wrz','Paź','Lis','Gru'];
    this._chart('chartMonthly', { type:'bar', data:{
      labels:months,
      datasets:[{ label:'kWh (projekcja wg harmonogramu)', data:months.map(()=>proj.month), backgroundColor:'#34d399' }]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:'Monthly consumption (projection)',color:'#e8edf4'}} }});
  }

  _renderRanking(){
    const rows = this.analyticsManager.ranking();
    const top5 = rows.slice(0,5);
    document.getElementById('top5Ranking').innerHTML = top5.map((r,i)=>`
      <div class="top5-item"><div class="top5-rank">#${i+1}</div><div class="top5-name">${r.name}</div>
      <div class="top5-pct">${r.pct.toFixed(0)}% całkowitego zużycia</div></div>`).join('') || '<div style="color:var(--text-3)">Brak urządzeń w scenie.</div>';
    const s = this.getEnergySettings();
    const tbody = document.querySelector('#rankingTable tbody');
    tbody.innerHTML = rows.map(r=>`<tr>
      <td>${r.name}</td><td>${EnergyCalculator.fmtW(r.currentPowerW)}</td>
      <td>${r.dailyKWh.toFixed(2)}</td><td>${r.monthlyKWh.toFixed(1)}</td>
      <td>${EnergyCalculator.fmtCost(r.monthlyCost,s.currency)}</td><td>${r.pct.toFixed(1)}%</td></tr>`).join('');
  }

  _renderScore(){
    const sc = this.analyticsManager.energyScore();
    document.getElementById('scorePanel').innerHTML = `
      <div class="score-circle" style="--pct:${sc.score}">
        <div class="inner"><div class="score-num">${sc.score}</div><div class="score-grade">Klasa ${sc.grade}</div></div>
      </div>
      <div class="score-info">
        <div class="si-row"><div class="si-label">NAJWIĘKSZY PROBLEM</div><div class="si-text">${sc.biggestProblem}</div></div>
        <div class="si-row"><div class="si-label">NAJWIĘKSZA MOŻLIWOŚĆ OSZCZĘDNOŚCI</div><div class="si-text">${sc.biggestOpportunity}</div></div>
      </div>`;
  }

  _renderWhatIf(){
    const devices = this.objectManager.getDevices();
    const pane = document.getElementById('whatifPanel');
    if (!devices.length){ pane.innerHTML='<div style="color:var(--text-3)">Dodaj urządzenia, aby przeprowadzić analizę.</div>'; return; }
    pane.innerHTML = `
      <div class="wi-row">
        <select class="std-select" id="wiDevice">${devices.map(d=>`<option value="${d.id}">${d.customName||d.def.name}</option>`).join('')}</select>
        <span style="color:var(--text-2);font-size:12px">Skala mocy/czasu pracy:</span>
        <input type="range" id="wiScale" min="0.2" max="1.5" step="0.05" value="1" style="width:160px">
        <span id="wiScaleLabel" style="font-family:var(--font-mono)">100%</span>
        <button class="primary-btn" id="wiRun">Oblicz</button>
      </div>
      <div class="wi-result" id="wiResult"></div>`;
    document.getElementById('wiScale').addEventListener('input', (e)=>{
      document.getElementById('wiScaleLabel').textContent = Math.round(e.target.value*100)+'%';
    });
    document.getElementById('wiRun').addEventListener('click', ()=>{
      const id = document.getElementById('wiDevice').value;
      const scale = Number(document.getElementById('wiScale').value);
      const res = this.analyticsManager.whatIf(id, { powerScale: scale });
      const s = this.getEnergySettings();
      document.getElementById('wiResult').innerHTML = `
        <div class="wi-box"><div class="lbl">Before</div><div class="wv">${res.beforeMonthKWh.toFixed(1)} kWh</div></div>
        <div class="wi-box"><div class="lbl">After</div><div class="wv">${res.afterMonthKWh.toFixed(1)} kWh</div></div>
        <div class="wi-box"><div class="lbl">Saving / miesiąc</div><div class="wv" style="color:var(--accent-good)">${res.savingKWh.toFixed(1)} kWh · ${EnergyCalculator.fmtCost(res.savingCost,s.currency)}</div></div>
        <div class="wi-box"><div class="lbl">Saving / rok</div><div class="wv" style="color:var(--accent-good)">${EnergyCalculator.fmtCost(res.savingYearCost,s.currency)}</div></div>`;
      if (res.savingKWh>0) this._checkAchievements();
    });
  }

  _renderCompare(){
    const pane = document.getElementById('comparePanel');
    const devices = this.objectManager.getDevices();
    if (devices.length<2){ pane.innerHTML='<div style="color:var(--text-3)">Dodaj co najmniej dwa urządzenia, aby je porównać.</div>'; return; }
    const a = this.compareSelection[0] || devices[0].id;
    const b = this.compareSelection[1] || devices[1].id;
    pane.innerHTML = `
      <div class="wi-row">
        <select class="std-select" id="cmpA">${devices.map(d=>`<option value="${d.id}" ${d.id===a?'selected':''}>${d.customName||d.def.name}</option>`).join('')}</select>
        vs
        <select class="std-select" id="cmpB">${devices.map(d=>`<option value="${d.id}" ${d.id===b?'selected':''}>${d.customName||d.def.name}</option>`).join('')}</select>
      </div>
      <table class="data-table" id="cmpTable"></table>`;
    const run = ()=>{
      const idA = document.getElementById('cmpA').value, idB = document.getElementById('cmpB').value;
      const c = this.analyticsManager.compare(idA, idB);
      const s = this.getEnergySettings();
      if (!c) return;
      const rowsHtml = [
        ['Moc', EnergyCalculator.fmtW(c.a.currentPowerW), EnergyCalculator.fmtW(c.b.currentPowerW)],
        ['Daily energy', c.a.dailyKWh.toFixed(2)+' kWh', c.b.dailyKWh.toFixed(2)+' kWh'],
        ['Monthly energy', c.a.monthlyKWh.toFixed(1)+' kWh', c.b.monthlyKWh.toFixed(1)+' kWh'],
        ['Monthly cost', EnergyCalculator.fmtCost(c.a.monthlyCost,s.currency), EnergyCalculator.fmtCost(c.b.monthlyCost,s.currency)],
        ['Yearly cost', EnergyCalculator.fmtCost(c.yearlyCostA,s.currency), EnergyCalculator.fmtCost(c.yearlyCostB,s.currency)],
        ['Standby', EnergyCalculator.fmtW(c.a.inst.def.standbyPowerW), EnergyCalculator.fmtW(c.b.inst.def.standbyPowerW)],
        ['Efficiency class', c.a.inst.def.energyClass, c.b.inst.def.energyClass],
      ];
      document.getElementById('cmpTable').innerHTML = `<thead><tr><th></th><th>${c.a.name}</th><th>${c.b.name}</th></tr></thead>
        <tbody>${rowsHtml.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody>`;
    };
    document.getElementById('cmpA').addEventListener('change', run);
    document.getElementById('cmpB').addEventListener('change', run);
    run();
  }

  // ============================================================
  // ECO CENTER — PV, dynamic tariff, carbon footprint and learning
  // ============================================================
  _renderEco(){
    const pane = document.getElementById('ecoPanel');
    const proj = this.analyticsManager.projections(this.simulationEngine.todayKWh);
    const s = this.getEnergySettings();
    const saved = Number(localStorage.getItem('energyroom3d_saved_baseline') || 0);
    const baseline = saved || proj.year;
    const tariff = this.ecoSettings || { mode:'fixed', pv:0, battery:0 };
    this.ecoSettings = tariff;
    const annualGrid = proj.year;
    const pvProduction = tariff.pv * 1000 * 0.95;
    const selfUse = Math.min(pvProduction, annualGrid * (tariff.battery > 0 ? 0.72 : 0.52));
    const exported = Math.max(0, pvProduction - selfUse);
    const gridAfterPv = Math.max(0, annualGrid - selfUse);
    const tariffMultiplier = tariff.mode === 'dynamic' ? 0.86 : 1;
    const annualCost = gridAfterPv * s.pricePerKWh * tariffMultiplier;
    const annualSaving = Math.max(0, proj.yearCost - annualCost);
    const co2After = gridAfterPv * s.co2Factor;
    const avoidedCo2 = Math.max(0, proj.co2Year - co2After);
    const grade = proj.year > 0 ? Math.max(0, Math.round((selfUse / proj.year) * 100)) : 0;

    pane.innerHTML = `
      <div class="eco-hero">
        <div><div class="eco-kicker">ECO CENTER</div><h3>Projektuj taniej i czyściej</h3>
        <p>Sprawdź wpływ fotowoltaiki, magazynu energii i taryfy dynamicznej na cały budynek.</p></div>
        <div class="eco-score-badge"><b>${grade}%</b><span>pokrycia z PV</span></div>
      </div>
      <div class="eco-controls">
        <label>Taryfa
          <select class="std-select" id="ecoTariff">
            <option value="fixed" ${tariff.mode==='fixed'?'selected':''}>Stała cena</option>
            <option value="dynamic" ${tariff.mode==='dynamic'?'selected':''}>Dynamiczna (tańsza poza szczytem)</option>
          </select>
        </label>
        <label>PV (kWp)
          <input class="std-input" id="ecoPv" type="number" min="0" max="30" step="0.1" value="${tariff.pv}">
        </label>
        <label>Magazyn (kWh)
          <input class="std-input" id="ecoBattery" type="number" min="0" max="100" step="1" value="${tariff.battery}">
        </label>
        <button class="primary-btn" id="ecoApply">Przelicz</button>
      </div>
      <div class="eco-metrics">
        <div class="eco-metric"><span>Zużycie bez zmian</span><b>${Math.round(annualGrid)} kWh/rok</b></div>
        <div class="eco-metric"><span>Produkcja PV</span><b>${Math.round(pvProduction)} kWh/rok</b></div>
        <div class="eco-metric"><span>Rachunek po optymalizacji</span><b>${EnergyCalculator.fmtCost(annualCost,s.currency)}</b></div>
        <div class="eco-metric good"><span>Szacowana oszczędność</span><b>${EnergyCalculator.fmtCost(annualSaving,s.currency)}/rok</b></div>
        <div class="eco-metric good"><span>Uniknięte CO₂</span><b>${Math.round(avoidedCo2)} kg/rok</b></div>
        <div class="eco-metric"><span>Nadwyżka do sieci</span><b>${Math.round(exported)} kWh/rok</b></div>
      </div>
      <div class="eco-columns">
        <div class="eco-card"><h4>Wyzwanie tygodnia</h4>
          <p><b>Peak Shifter</b> — przenieś pracę dwóch urządzeń AGD poza godziny 16:00–20:00.</p>
          <button class="small-btn" id="ecoBaseline">${saved ? 'Zaktualizuj punkt odniesienia' : 'Ustaw bieżący projekt jako punkt odniesienia'}</button>
          <div class="eco-progress"><span style="width:${Math.min(100, Math.max(0, ((baseline-proj.year)/Math.max(1,baseline))*100))}%"></span></div>
          <small>${saved ? 'Twój licznik oszczędności porównuje projekt z zapisanym punktem odniesienia.' : 'Ustaw punkt odniesienia, aby śledzić realną poprawę projektu.'}</small>
        </div>
        <div class="eco-card"><h4>Lekcja: ślad węglowy</h4>
          <p>1 kWh pomnożone przez współczynnik CO₂ daje szacunkową emisję. Zmień współczynnik w Ustawieniach, aby dopasować go do miksu energetycznego.</p>
          <div class="eco-formula">${Math.round(annualGrid)} kWh × ${s.co2Factor} kg/kWh = <b>${Math.round(proj.co2Year)} kg CO₂</b></div>
        </div>
      </div>`;
    document.getElementById('ecoApply').addEventListener('click', ()=>{
      this.ecoSettings = {
        mode: document.getElementById('ecoTariff').value,
        pv: Math.max(0, Number(document.getElementById('ecoPv').value)||0),
        battery: Math.max(0, Number(document.getElementById('ecoBattery').value)||0),
      };
      this._renderEco();
    });
    document.getElementById('ecoBaseline').addEventListener('click', ()=>{
      localStorage.setItem('energyroom3d_saved_baseline', String(proj.year));
      this.toast('Punkt odniesienia zapisany. Od teraz licznik śledzi oszczędności.');
      this._renderEco();
    });
  }

  // ============================================================
  // ROOM SETTINGS
  // ============================================================
  _bindRoomSettings(){}
  openRoomSettings(){
    const rs = this.getRoomSettings();
    const body = document.getElementById('roomSettingsBody');
    body.innerHTML = `
      <div class="field-row"><label>Typ pomieszczenia</label><select id="rsType">
        <option value="custom">Własne wymiary</option>
        <option value="living">Salon</option>
        <option value="kitchen">Kuchnia</option>
        <option value="office">Biuro</option>
        <option value="garage">Garaż</option>
        <option value="bedroom">Sypialnia</option>
      </select></div>
      <div class="field-row"><label>Width (m)</label><input type="number" id="rsWidth" step="0.1" value="${rs.width}"></div>
      <div class="field-row"><label>Length (m)</label><input type="number" id="rsLength" step="0.1" value="${rs.length}"></div>
      <div class="field-row"><label>Height (m)</label><input type="number" id="rsHeight" step="0.1" value="${rs.height}"></div>
      <div class="field-row"><label>Floor</label><select id="rsFloor">${['Wood','Tile','Concrete','Carpet'].map(o=>`<option ${o===rs.floor?'selected':''}>${o}</option>`).join('')}</select></div>
      <div class="field-row"><label>Wall</label><select id="rsWall">${['White','Gray','Brick','Concrete'].map(o=>`<option ${o===rs.wall?'selected':''}>${o}</option>`).join('')}</select></div>
      <div class="field-row"><label>Ceiling</label><select id="rsCeiling" disabled><option>White</option></select></div>
      <button class="primary-btn" id="rsApply" style="margin-top:14px;width:100%">Zastosuj zmiany</button>`;
    const roomPresets = {
      living: [6, 5, 2.8], kitchen: [4.5, 4, 2.8], office: [4, 3.5, 2.8],
      garage: [6, 6, 2.6], bedroom: [4.5, 4, 2.8],
    };
    document.getElementById('rsType').addEventListener('change', (e)=>{
      const preset = roomPresets[e.target.value];
      if (!preset) return;
      document.getElementById('rsWidth').value = preset[0];
      document.getElementById('rsLength').value = preset[1];
      document.getElementById('rsHeight').value = preset[2];
    });
    document.getElementById('rsApply').addEventListener('click', ()=>{
      const next = {
        width: Math.max(3, Number(document.getElementById('rsWidth').value)||7),
        length: Math.max(3, Number(document.getElementById('rsLength').value)||5),
        height: Math.max(2.2, Number(document.getElementById('rsHeight').value)||2.8),
        floor: document.getElementById('rsFloor').value,
        wall: document.getElementById('rsWall').value,
        ceiling: 'White',
      };
      this.setRoomSettings(next);
      this.rebuildRoom();
      this.projectManager.pushHistory();
      document.getElementById('roomSettingsModal').classList.add('hidden');
      this.log('Zaktualizowano ustawienia pokoju.');
    });
    document.getElementById('roomSettingsModal').classList.remove('hidden');
  }

  // ============================================================
  // SMART HOME
  // ============================================================
  _bindSmartHome(){}
  openSmartHome(){
    this._renderSmartHomeBody();
    document.getElementById('smartHomeModal').classList.remove('hidden');
  }
  _renderSmartHomeBody(){
    const devices = this.objectManager.getDevices();
    const body = document.getElementById('smartHomeBody');
    const ctx = this.automationManager.context;
    body.innerHTML = `
      <div class="presence-row">
        <label class="chk"><input type="checkbox" id="shPresence" ${ctx.presence?'checked':''}> Obecność w pokoju (symulowany czujnik ruchu)</label>
        <label class="chk">Temperatura: <input type="range" id="shTemp" min="15" max="32" value="${ctx.tempC}" style="width:120px"> <span id="shTempLabel">${ctx.tempC}°C</span></label>
      </div>
      <div class="rule-builder">
        <div><label>JEŚLI</label><select class="std-select" id="ruleIf">
          <option value="time">o godzinie</option>
          <option value="noPresence">nikogo nie ma</option>
          <option value="presence">ktoś jest obecny</option>
          <option value="tempAbove">temperatura powyżej</option>
        </select></div>
        <div id="ruleIfValueWrap"><label>WARTOŚĆ</label><input class="std-input" id="ruleIfValue" type="time" value="23:00"></div>
        <div><label>TO</label><select class="std-select" id="ruleTarget">${devices.map(d=>`<option value="${d.id}">${d.customName||d.def.name}</option>`).join('')}</select></div>
        <div><label>USTAW STAN</label><select class="std-select" id="ruleThen"></select></div>
        <button class="primary-btn" id="ruleAdd">Dodaj regułę</button>
      </div>
      <div class="wi-row" style="margin-bottom:10px">
        <button class="small-btn" id="presetMotion">+ Brak obecności → wyłącz światło</button>
        <button class="small-btn" id="presetNight">+ 23:00 → standby wszystkich RTV</button>
        <button class="small-btn" id="presetTemp">+ Temperatura &gt;26°C → włącz klimatyzację</button>
      </div>
      <div id="ruleList"></div>`;

    const ifSelect = document.getElementById('ruleIf');
    const valueWrap = document.getElementById('ruleIfValueWrap');
    const updateValueField = ()=>{
      if (ifSelect.value==='time') valueWrap.innerHTML = '<label>WARTOŚĆ</label><input class="std-input" id="ruleIfValue" type="time" value="23:00">';
      else if (ifSelect.value==='tempAbove') valueWrap.innerHTML = '<label>WARTOŚĆ (°C)</label><input class="std-input" id="ruleIfValue" type="number" value="26">';
      else valueWrap.innerHTML = '<label>WARTOŚĆ</label><input class="std-input" id="ruleIfValue" disabled value="—">';
    };
    ifSelect.addEventListener('change', updateValueField);

    const targetSelect = document.getElementById('ruleTarget');
    const thenSelect = document.getElementById('ruleThen');
    const updateThenOptions = ()=>{
      const inst = this.objectManager.find(targetSelect.value);
      thenSelect.innerHTML = inst ? Object.keys(inst.def.states).map(s=>`<option value="${s}">${s}</option>`).join('') : '';
    };
    targetSelect.addEventListener('change', updateThenOptions);
    updateThenOptions();

    document.getElementById('shPresence').addEventListener('change', (e)=>this.automationManager.setPresence(e.target.checked));
    document.getElementById('shTemp').addEventListener('input', (e)=>{ this.automationManager.setTemp(Number(e.target.value)); document.getElementById('shTempLabel').textContent=e.target.value+'°C'; });

    document.getElementById('ruleAdd').addEventListener('click', ()=>{
      const valEl = document.getElementById('ruleIfValue');
      this.automationManager.addRule({
        name: `${ifSelect.options[ifSelect.selectedIndex].text} → ${thenSelect.value}`,
        ifType: ifSelect.value, ifValue: ifSelect.value==='tempAbove'? Number(valEl.value): valEl.value,
        targetInstId: targetSelect.value, thenState: thenSelect.value,
      });
      this._renderRuleList(); this.projectManager.pushHistory();
    });
    document.getElementById('presetMotion').addEventListener('click', ()=>{
      const light = devices.find(d=>d.def.category==='lighting');
      if (light){ this.automationManager.addRule({ name:'Jeśli nikogo nie ma w pokoju → wyłącz światło', ifType:'noPresence', targetInstId:light.id, thenState:'off' }); this._renderRuleList(); }
      else alert('Dodaj najpierw urządzenie oświetleniowe.');
    });
    document.getElementById('presetNight').addEventListener('click', ()=>{
      const tv = devices.find(d=>d.def.category==='rtv');
      if (tv){ this.automationManager.addRule({ name:'23:00 → przełącz w standby', ifType:'time', ifValue:'23:00', targetInstId:tv.id, thenState:'standby' }); this._renderRuleList(); }
      else alert('Dodaj najpierw urządzenie RTV.');
    });
    document.getElementById('presetTemp').addEventListener('click', ()=>{
      const ac = devices.find(d=>d.def.category==='climate');
      if (ac){ this.automationManager.addRule({ name:'Temperatura > 26°C → włącz klimatyzację', ifType:'tempAbove', ifValue:26, targetInstId:ac.id, thenState:Object.keys(ac.def.states)[0] }); this._renderRuleList(); }
      else alert('Dodaj najpierw klimatyzator.');
    });

    this._renderRuleList();
  }
  _renderRuleList(){
    const list = document.getElementById('ruleList');
    const rules = this.automationManager.rules;
    list.innerHTML = rules.length ? rules.map(r=>{
      const target = this.objectManager.find(r.targetInstId);
      return `<div class="rule-card"><div class="rc-title">${r.name}</div>
        <div class="rc-desc">Cel: ${target?(target.customName||target.def.name):'—'} · Akcja: ${r.thenState}</div>
        <button class="small-btn" data-rule="${r.id}" style="margin-top:8px;width:auto">Usuń regułę</button></div>`;
    }).join('') : '<div style="color:var(--text-3);font-size:12.5px">Brak automatyzacji. Dodaj pierwszą regułę powyżej, aby odblokować osiągnięcie "Smart Home".</div>';
    list.querySelectorAll('[data-rule]').forEach(b=>{
      b.addEventListener('click', ()=>{ this.automationManager.removeRule(b.dataset.rule); this._renderRuleList(); });
    });
  }

  // ============================================================
  // SETTINGS (price/currency/CO2)
  // ============================================================
  _bindSettingsModal(){}
  openSettings(){
    const s = this.getEnergySettings();
    const body = document.getElementById('settingsBody');
    body.innerHTML = `
      <div class="field-row"><label>Cena energii</label><input type="number" step="0.01" id="setPrice" value="${s.pricePerKWh}"></div>
      <div class="field-row"><label>Waluta</label><input type="text" id="setCurrency" value="${s.currency}" maxlength="4"></div>
      <div class="field-row"><label>Opłaty dodatkowe / mies.</label><input type="number" step="0.5" id="setFees" value="${s.extraFeesPerMonth}"></div>
      <div class="field-row"><label>Współczynnik CO₂ (kg/kWh)</label><input type="number" step="0.01" id="setCo2" value="${s.co2Factor}"></div>
      <div style="font-size:11px;color:var(--text-3);margin:8px 0 14px">Cena energii i współczynnik CO₂ to założenia symulacji, a nie aktualna taryfa operatora — wartość zależy od miksu energetycznego.</div>
      <button class="primary-btn" id="setApply" style="width:100%">Zapisz ustawienia</button>
      <hr style="border-color:var(--border);margin:18px 0">
      <h4 style="font-family:var(--font-display);font-size:12px;color:var(--text-3);text-transform:uppercase;margin-bottom:10px">Projekt</h4>
      <div class="wi-row">
        <button class="small-btn" id="projNew">🆕 New Project</button>
        <button class="small-btn" id="projSave">💾 Save</button>
        <button class="small-btn" id="projLoad">📂 Load</button>
        <button class="small-btn" id="projExport">⬇ Export JSON</button>
        <button class="small-btn" id="projImport">⬆ Import JSON</button>
        <input type="file" id="projImportFile" accept="application/json" class="hidden">
      </div>`;
    document.getElementById('setApply').addEventListener('click', ()=>{
      this.setEnergySettings({
        pricePerKWh: Number(document.getElementById('setPrice').value)||1,
        currency: document.getElementById('setCurrency').value||'PLN',
        extraFeesPerMonth: Number(document.getElementById('setFees').value)||0,
        co2Factor: Number(document.getElementById('setCo2').value)||0.65,
      });
      this.projectManager.pushHistory();
      this.log('Zaktualizowano ustawienia energii.');
      document.getElementById('settingsModal').classList.add('hidden');
    });
    document.getElementById('projNew').addEventListener('click', ()=>{ if (confirm('Utworzyć nowy projekt? Niezapisane zmiany zostaną utracone.')){ this.projectManager.newProject(); this.transformManager.deselect(); } });
    document.getElementById('projSave').addEventListener('click', ()=>this.projectManager.saveLocal());
    document.getElementById('projLoad').addEventListener('click', ()=>{ this.projectManager.loadLocal(); this.transformManager.deselect(); });
    document.getElementById('projExport').addEventListener('click', ()=>this.projectManager.exportFile());
    document.getElementById('projImport').addEventListener('click', ()=>document.getElementById('projImportFile').click());
    document.getElementById('projImportFile').addEventListener('change', (e)=>{
      if (e.target.files[0]) this.projectManager.importFile(e.target.files[0], ()=>{ this.transformManager.deselect(); });
    });
    document.getElementById('settingsModal').classList.remove('hidden');
  }

  // ============================================================
  // EDUCATIONAL MODAL
  // ============================================================
  _bindEduModal(){}
  openEdu(inst){
    document.getElementById('eduTitle').textContent = `${inst.customName||inst.def.name} — jak działa zużycie energii?`;
    const def = inst.def;
    const dailyKWh = this.simulationEngine.todayKWhByDevice[inst.id]||0;
    const s = this.getEnergySettings();
    document.getElementById('eduBody').innerHTML = `
      <div class="edu-term"><b>Moc znamionowa:</b> ${EnergyCalculator.fmtW(def.ratedPowerW)}</div>
      <div class="edu-term">${def.edu}</div>
      <div class="edu-term"><b>Zużycie dzisiaj:</b> ${EnergyCalculator.fmtKWh(dailyKWh)} · <b>Koszt:</b> ${EnergyCalculator.fmtCost(dailyKWh*s.pricePerKWh,s.currency)}</div>
      <div class="edu-term"><b>W (Wat)</b> — jednostka mocy, czyli chwilowego tempa zużywania energii.</div>
      <div class="edu-term"><b>kW</b> — 1000 W.</div>
      <div class="edu-term"><b>Wh / kWh</b> — jednostka energii = moc × czas. 1 kWh = 1000 W przez 1 godzinę.</div>
      <div class="edu-term"><b>Moc vs energia</b> — moc mówi "jak szybko", energia mówi "ile łącznie".</div>
      <div class="edu-term"><b>Standby</b> — pobór mocy, gdy urządzenie jest "wyłączone", ale nadal podłączone.</div>
      <div class="edu-term"><b>Cykl pracy</b> — powtarzalna sekwencja stanów (np. grzanie → pranie → wirowanie).</div>
      <div class="edu-term"><b>Koszt energii</b> — energia [kWh] × cena [${s.currency}/kWh].</div>`;
    document.getElementById('eduModal').classList.remove('hidden');
  }

  // ============================================================
  // DEBUG LOG PANEL
  // ============================================================
  _bindLogPanel(){
    document.getElementById('btnToggleLog').addEventListener('click', ()=> document.getElementById('logPanel').classList.toggle('hidden'));
    document.getElementById('closeLog').addEventListener('click', ()=> document.getElementById('logPanel').classList.add('hidden'));
  }
  log(msg){
    const body = document.getElementById('logBody');
    if (!body) return;
    const line = document.createElement('div');
    line.className='log-line';
    const t = this.simulationEngine ? this.simulationEngine.clockLabel : '';
    line.innerHTML = `<span class="log-time">[${t}]</span>${msg}`;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
    while (body.children.length>200) body.removeChild(body.firstChild);
  }

  // ============================================================
  // TUTORIAL
  // ============================================================
  _bindTutorial(){
    const overlay = document.getElementById('tutorialOverlay');
    if (localStorage.getItem('energyroom3d_tutorial_dismissed')==='1'){ overlay.classList.add('hidden'); }
    document.getElementById('closeTutorial').addEventListener('click', ()=>{
      if (document.getElementById('dontShowAgain').checked) localStorage.setItem('energyroom3d_tutorial_dismissed','1');
      overlay.classList.add('hidden');
    });
  }

  // ============================================================
  // ACHIEVEMENTS (gamification basics — spec #40)
  // ============================================================
  toast(text, isAchievement){
    const area = document.getElementById('toastArea');
    const t = document.createElement('div');
    t.className = 'toast'+(isAchievement?' achievement':'');
    t.innerHTML = isAchievement ? `🏆 <b>${text}</b>` : text;
    area.appendChild(t);
    setTimeout(()=>t.remove(), 6000);
  }
  _award(id, text){
    if (this.achievements.has(id)) return;
    this.achievements.add(id);
    this.toast(text, true);
    this.log(`Osiągnięcie odblokowane: ${text}`);
  }
  _checkAchievements(){
    const sc = this.analyticsManager.energyScore();
    if (sc.score>90) this._award('efficient_room', 'Efficient Room — Energy Score > 90');
    if (this.automationManager.rules.length>=1) this._award('smart_home', 'Smart Home — utworzono pierwszą automatyzację');
    const disconnectedStandby = this.objectManager.getDevices().filter(d=>!d.connected && d.def.standbyPowerW>0).length;
    if (disconnectedStandby>=3) this._award('standby_killer', 'Standby Killer — odłączono urządzenia ze standby');
  }
}
