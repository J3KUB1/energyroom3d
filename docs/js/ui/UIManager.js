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
    //         projectManager, getHouseState, setHouseState, getActiveRoom,
    //         getRoom, getEnergySettings, setEnergySettings, rebuildHouse }
    this.currentCategory = 'lighting';
    this.currentMode = 'edit';
    const savedExperience = (()=>{ try { return localStorage.getItem('energyroom_experience'); } catch(e){ return null; } })();
    this.experienceMode = ['casual','realistic','kids'].includes(savedExperience) ? savedExperience : 'casual';
    this.chartLibraryPromise = null;
    this.compareSelection = [];
    this.charts = {};
    this.achievements = new Set();
    this._petBubbleQueue = [];
    this._petBubbleTimer = null;
    this.scenarios = { A: null, B: null };
    this.pvInstallMode = false;
    this.statsRange = 'today'; // 'today' | 'week' | 'month' | 'year' - dashboard range selector (section 8)
    this._kidsFactIndex=0; this._kidsFactChangedAt=0;

    this._bindTopbar();
    this._bindRoomTabs();
    this._bindViewportToolbar();
    this._bindMobileNav();
    this._bindDashboard();
    this._bindRoomSettings();
    this._bindSmartHome();
    this._bindSettingsModal();
    this._bindEduModal();
    this._bindLogPanel();
    this._bindKeyboard();
    this._bindTutorial();
    this._bindModalGeneric();
    this._bindPetWidget();
    this._bindPvInstallMode();
    this._bindScheduleModal();
    this._bindNewSimModal();
    this._bindInstallation();
    this._bindDesigner();
    this._bindWelcomeModal();
    this._bindChallenges();
    this._bindHomeEnergy();
    this._bindHomeOperations();
    this._bindEnergyMonitor();
    this._applyRealismMode();

    this.transformManager.onSelect = (inst)=>this.renderProperties(inst);
    this.transformManager.onHover = (inst,e)=>this.renderTooltip(inst,e);
    this.transformManager.onTransformCommit = (inst)=>{ this.renderProperties(inst, true); this.projectManager.pushHistory(); };
    this.transformManager.onToggle = (id)=>this._quickTogglePower(id);
    this.objectManager.onChange = ()=>{ this.analyticsManager.invalidateCache(); };

    this.simulationEngine.onLog = (msg)=> this.log(msg);
    this.simulationEngine.onDayRollover = ({ entry })=>{
      this._checkAchievements();
      const audit=this.homeEnergyManager&&this.homeEnergyManager.audit;
      if(audit&&audit.status==='active'&&this.simulationEngine.absMin-audit.startedAbsMin>=1440){
        const result=this.homeEnergyManager.finishAudit();
        if(result)this.toast(I18n.t(result.passed?'audit.pass':'audit.fail'),!!result.passed);
      }
      if (entry){
        this.petManager.awardDailyOutcome(entry, this.simulationEngine, entry.dayIndex);
        this.questManager.checkDaily(entry, entry.dayIndex, this._questCtx());
      }
      const active=this.challengeManager&&this.challengeManager.active;
      if(active){
        const def=this.challengeManager.definitions.find(d=>d.id===active.id);
        if(def&&def.requiresDay&&this.simulationEngine.absMin-active.startedAbsMin>=1440){
          const result=this.challengeManager.finish();
          if(result) this.toast(I18n.t(result.passed?'challenge.resultPass':'challenge.resultFail'));
          this._syncChallengeMode();
        }
      }
    };
    this.automationManager.onLog = (msg)=> this.log(msg);
    this.projectManager.onLog = (msg)=> this.log(msg);
    this.weatherManager.onLog = (msg)=> this.log(msg);
    this.weatherManager.onEventChange = (ev)=>{
      this._renderWeatherBadge();
      if (ev) this.toast(`${ev.icon} ${I18n.t(ev.nameKey)} — ${I18n.t('weather.effectNote')}`);
    };
    this.weatherManager.onConditionChange = ()=> this._renderWeatherBadge();
    this.petManager.onLog = (msg)=> this.log(msg);
    this.petManager.onChange = ()=> this._renderPet();
    this.petManager.onLevelUp = (stage)=>{
      this.toast(`🐾 ${this.petManager.name} ${I18n.t('pet.leveledUp', { level: this.petManager.level, stage: I18n.petStage(stage) })}`, true);
      this._playPetAnim('burst');
      this._renderPet();
    };
    this.questManager.onLog = (msg)=> this.log(msg);
    this.questManager.onComplete = (q)=>{
      this.petManager.awardQuestComplete(q.xp);
      this.toast(`🎯 ${I18n.t(q.titleKey)} (+${q.xp} XP)`, true);
      this._renderPet();
    };
    I18n.onChange(()=> this._onLanguageChange());

    this.renderRoomTabs();
    this.renderCategoryTabs();
    this.renderAssetGrid();
    this._renderWeatherBadge();
    this.updateModeUI();
    this.sceneManager.onFrame(()=>this._frameTick());
    setInterval(()=>this._slowTick(), 2000);
  }

  // ============================================================
  // TOP BAR
  // ============================================================
  _bindTopbar(){
    const experienceSelect = document.getElementById('experienceMode');
    experienceSelect.value = this.experienceMode;
    experienceSelect.addEventListener('change', ()=>{
      if(this.challengeManager.active?.id==='outage'&&experienceSelect.value!=='realistic'){
        this.challengeManager.finish();this._syncChallengeMode();this.toast(I18n.t('challenge.outageCancelled'));
      }
      this.experienceMode = experienceSelect.value;
      try { localStorage.setItem('energyroom_experience', this.experienceMode); } catch(e){}
      this.updateModeUI();
      this._applyRealismMode();
      try { if(this.experienceMode==='kids' && !localStorage.getItem('energyroom3d_kids_guide_seen')) this.openKidsTutorial(); } catch(e){ if(this.experienceMode==='kids') this.openKidsTutorial(); }
    });
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
    document.getElementById('btnLoad').addEventListener('click', ()=>{ this.projectManager.loadLocal(); this.transformManager.deselect(); this.renderRoomTabs(); });
    document.getElementById('btnRoomSettings').addEventListener('click', ()=>this.openRoomSettings());
    document.getElementById('btnSmartHome').addEventListener('click', ()=>this.openSmartHome());
    document.getElementById('btnInstallation').addEventListener('click', ()=>this.openInstallation());
    document.getElementById('btnDesigner').addEventListener('click', ()=>this.toggleDesigner());
    document.getElementById('btnDashboard').addEventListener('click', ()=>this.openDashboard());
    document.getElementById('btnDayPlanner').addEventListener('click', ()=>this._openDayPlanner());
    document.getElementById('btnSettings').addEventListener('click', ()=>this.openSettings());
    document.getElementById('btnAudit').addEventListener('click', ()=>this.openAudit());
    document.getElementById('btnUpgrades').addEventListener('click', ()=>this.openUpgrades());
    document.getElementById('btnReport').addEventListener('click', ()=>this.openFinalReport());
    document.getElementById('btnHomeOps').addEventListener('click', ()=>this.openHomeOperations());

    const nameLabel = document.getElementById('projectNameLabel');
    nameLabel.addEventListener('click', ()=>{
      const v = prompt(I18n.t('msg.projectNamePrompt'), this.projectManager.projectName);
      if (v && v.trim()){ this.projectManager.projectName = v.trim(); nameLabel.textContent = v.trim(); }
    });
  }

  _openDayPlanner(){
    const selected=this.objectManager.find(this.transformManager.selectedId);
    const schedulable=inst=>inst&&inst.def&&['window','cycle'].includes(inst.def.profileType);
    const device=schedulable(selected)?selected:this.objectManager.getDevices().find(schedulable);
    if(!device){this.toast(I18n.t('sched.noPlanDevice'));return;}
    this._openDeviceScheduleEditor(device);
  }

  updateModeUI(){
    document.body.dataset.experience = this.experienceMode;
    document.getElementById('experienceMode').value = this.experienceMode;
    document.body.classList.toggle('kids-mode', this.experienceMode==='kids');
    const hint = document.getElementById('experienceHint');
    hint.textContent = I18n.t('experience.hint.'+this.experienceMode);
    hint.classList.toggle('hidden', this.experienceMode !== 'kids');
    document.getElementById('simControls').classList.toggle('hidden', this.currentMode!=='sim');
    if (this.currentMode!=='sim' && this.simulationEngine.playing){ this.simulationEngine.pause(); document.getElementById('playPauseBtn').textContent='▶'; }
  }
  _applyRealismMode(){
    const s=this.getEnergySettings();s.realismMode=this.experienceMode==='realistic'?'realistic':this.experienceMode==='kids'?'educational':'arcade';
    this.setEnergySettings(s);this.simulationEngine._recomputeInstant(false);this.analyticsManager.invalidateCache();
  }

  _bindWelcomeModal(){
    document.getElementById('welcomeModal').addEventListener('click', e=>{ if(e.target.id==='welcomeModal') this._finishWelcome(false); });
    document.getElementById('btnWelcome').addEventListener('click', ()=>this.openWelcome());
    document.getElementById('welcomeStart').addEventListener('click', ()=>this._finishWelcome(true));
    document.getElementById('welcomeSkip').addEventListener('click', ()=>this._finishWelcome(false));
    document.getElementById('welcomeClose').addEventListener('click', ()=>this._finishWelcome(false));
  }

  openWelcome(){
    const mode=document.getElementById('welcomeMode');
    mode.value=this.experienceMode;
    const settings=this.getEnergySettings(), tariff=TariffManager.get(settings.tariffCode||'G11');
    const rate=tariff.defaultRate, price=(settings.tariffPrices&&settings.tariffPrices[tariff.code]&&settings.tariffPrices[tariff.code][rate]) ?? tariff.defaultPrices[rate];
    document.getElementById('welcomePrice').value=Number(price).toFixed(2);
    document.getElementById('welcomePetName').value=this.petManager.name||'';
    this._closeAllModals();
    document.getElementById('welcomeModal').classList.remove('hidden');
  }

  _bindChallenges(){
    document.getElementById('btnChallenges').addEventListener('click',()=>this.openChallenges());
    if(this.challengeManager.active?.id==='outage'&&this.experienceMode!=='realistic'){
      this.challengeManager.finish();this.toast(I18n.t('challenge.outageCancelled'));
    }
    const previousMinuteHook=this.simulationEngine.onMinuteTick;
    this.simulationEngine.onMinuteTick=sim=>{
      previousMinuteHook&&previousMinuteHook(sim);
      const active=this.challengeManager.active;
      if(active?.id==='outage'&&sim.absMin-active.startedAbsMin>=60){
        const result=this.challengeManager.finish();this._syncChallengeMode();
        if(result)this.toast(I18n.t(result.passed?'challenge.outagePass':'challenge.outageFail'),!!result.passed);
      }
    };
    document.getElementById('challengesBody').addEventListener('click',e=>{
      const start=e.target.closest('[data-ch-start]'), finish=e.target.closest('[data-ch-finish]');
      if(start){
        const ok=this.challengeManager.start(start.dataset.chStart,{realistic:this.experienceMode==='realistic'});
        if(ok&&start.dataset.chStart==='outage')this.toast(I18n.t('challenge.outageStarted'));
        this._syncChallengeMode(); this._renderChallenges();
      }
      if(finish){ const result=this.challengeManager.finish(); this._syncChallengeMode(); this._renderChallenges(); if(result) this.toast(I18n.t(result.passed?'challenge.resultPass':'challenge.resultFail')); }
    });
    this._syncChallengeMode();
  }
  _bindHomeEnergy(){
    document.getElementById('upgradesBody').addEventListener('click',e=>{const b=e.target.closest('[data-upgrade]');if(!b)return;if(this.homeEnergyManager.install(b.dataset.upgrade)){this.projectManager.pushHistory();this.toast(I18n.t('upgrade.installed'));this.openUpgrades();}});
    const audit=document.getElementById('auditBody');
    audit.addEventListener('click',e=>{
      if(e.target.closest('[data-audit-start]')){this.homeEnergyManager.startAudit({billPct:+document.getElementById('auditBill').value,selfUsePct:+document.getElementById('auditSelf').value,budgetZl:+document.getElementById('auditBudget').value});this._renderAudit();}
      if(e.target.closest('[data-audit-finish]')){const r=this.homeEnergyManager.finishAudit();this._renderAudit();if(r)this.toast(I18n.t(r.passed?'audit.pass':'audit.fail'),!!r.passed);}
      if(e.target.closest('[data-audit-upgrade]'))this.openUpgrades();
    });
  }

  _bindHomeOperations(){
    const previous=this.simulationEngine.onMinuteTick;
    this.simulationEngine.onMinuteTick=sim=>{previous&&previous(sim);this.homeOperationsManager&&this.homeOperationsManager.tick(sim);};
    const body=document.getElementById('homeOpsBody');
    body.addEventListener('click',e=>{
      const add=e.target.closest('[data-op-add]'); if(add){const input=document.getElementById('homeOpsName');if(this.homeOperationsManager.addResident(input?.value,document.getElementById('homeOpsKind')?.value)){if(input)input.value='';this.openHomeOperations();}return;}
      const rem=e.target.closest('[data-op-remove]'); if(rem){this.homeOperationsManager.removeResident(rem.dataset.opRemove);this.openHomeOperations();return;}
      const service=e.target.closest('[data-op-service]'); if(service){this.homeOperationsManager.service(service.dataset.opService);this._playUiTone(660);this.openHomeOperations();return;}
      const sc=e.target.closest('[data-op-scenario]'); if(sc){sc.dataset.opScenario==='clear'?this.homeOperationsManager.clearScenario():this.homeOperationsManager.setScenario(sc.dataset.opScenario);this._playUiTone(sc.dataset.opScenario==='clear'?520:380);this.openHomeOperations();}
    });
  }

  openHomeOperations(){
    const m=this.homeOperationsManager;if(!m)return;
    const sum=m.summary(), residents=m.state.residents||[], devices=this.objectManager.getDevices();
    const flow=sum.flow, realistic=this.experienceMode==='realistic',scenarioLabel=sum.scenario?({heatwave:I18n.t('homeOps.heatwave'),winter:I18n.t('homeOps.winter'),blackout:I18n.t('homeOps.blackout')}[sum.scenario]||sum.scenario):I18n.t('homeOps.none');
    document.getElementById('homeOpsBody').innerHTML=`<div class="feature-grid"><section class="feature-section"><h3>👨‍👩‍👧‍👦 ${I18n.t('homeOps.residents')}</h3><div class="field-row"><input id="homeOpsName" class="std-input" placeholder="${I18n.t('homeOps.namePlaceholder')}"><select id="homeOpsKind" class="std-select"><option value="adult">${I18n.t('homeOps.adult')}</option><option value="child">${I18n.t('homeOps.child')}</option><option value="senior">${I18n.t('homeOps.senior')}</option></select><button class="small-btn" data-op-add>＋</button></div><div class="ops-list">${residents.length?residents.map(r=>`<div class="ops-row"><span>${r.name} · ${I18n.t('homeOps.'+r.kind)}</span><button class="small-btn" data-op-remove="${r.id}">✕</button></div>`).join(''):`<small>${I18n.t('homeOps.noResidents')}</small>`}</div></section><section class="feature-section"><h3>🔧 ${I18n.t('homeOps.maintenance')}</h3><p>${I18n.t('homeOps.condition')}: <b>${sum.averageCondition.toFixed(0)}%</b> · ${I18n.t('homeOps.alerts')}: <b>${sum.alerts}</b></p>${realistic?devices.filter(d=>d.maintenance).slice(0,8).map(d=>`<div class="ops-row"><span>${d.customName||I18n.deviceName(d.def)} <b>${(d.maintenance.condition||100).toFixed(0)}%</b></span><button class="small-btn" data-op-service="${d.id}">${I18n.t('homeOps.service')}</button></div>`).join(''):`<small>${I18n.t('homeOps.realisticOnly')}</small>`}</section></div><section class="feature-section"><h3>⚡ ${I18n.t('homeOps.flow')}</h3><div class="flow-strip"><span>☀ ${Math.round(flow.pv)} W</span><b>→</b><span>🏠 ${Math.round(flow.pv+flow.battery+flow.grid)} W</span><b>→</b><span>🔌 ${Math.round(flow.grid)} W</span></div><small>${I18n.t('homeOps.flowHint')}</small></section><section class="feature-section"><h3>🌦 ${I18n.t('homeOps.scenarios')}</h3><div class="button-row"><button class="small-btn" data-op-scenario="heatwave">🔥 ${I18n.t('homeOps.heatwave')}</button><button class="small-btn" data-op-scenario="winter">❄ ${I18n.t('homeOps.winter')}</button>${realistic?`<button class="small-btn" data-op-scenario="blackout">🔌 ${I18n.t('homeOps.blackout')}</button>`:''}<button class="small-btn" data-op-scenario="clear">✓ ${I18n.t('homeOps.clear')}</button></div><small>${I18n.t('homeOps.active')}: <b>${scenarioLabel}</b></small></section>`;
    this._closeAllModals();document.getElementById('homeOpsModal').classList.remove('hidden');
  }
  _playUiTone(freq=520){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const c=new C(),o=c.createOscillator(),g=c.createGain();o.frequency.value=freq;o.type='sine';g.gain.setValueAtTime(.035,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.16);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.16);}catch(e){}}
  openUpgrades(){this._renderUpgrades();this._closeAllModals();document.getElementById('upgradesModal').classList.remove('hidden');}
  _renderUpgrades(){
    const s=this.getEnergySettings(),money=x=>EnergyCalculator.fmtCost(x,s.currency),defs=this.homeEnergyManager.upgrades();
    document.getElementById('upgradesBody').innerHTML=`<p class="feature-lede" data-i18n="upgrade.intro">${I18n.t('upgrade.intro')}</p><div class="upgrade-grid">${defs.map(d=>`<article class="feature-card ${d.installed?'is-installed':''}"><div class="feature-card-icon">${d.icon}</div><h3>${I18n.t(d.nameKey)}</h3><p>${I18n.t(d.descKey)}</p><div class="feature-stat"><span>${I18n.t('upgrade.cost')}</span><b>${money(d.cost)}</b></div><div class="feature-stat"><span>${I18n.t('upgrade.saving')}</span><b>${d.available?(d.installed?money(s.modernizations.installed[d.id].annualSavingZl||0):money(this._upgradeAnnualSaving(d.id))):'—'}</b></div><div class="feature-stat"><span>${I18n.t('upgrade.payback')}</span><b>${d.installed?(d.paybackYears?d.paybackYears.toFixed(1)+' '+I18n.t('common.years'):I18n.t('upgrade.unknown')):'—'}</b></div>${d.installed?`<span class="feature-installed">${I18n.t('upgrade.installed')}</span>`:d.available?`<button class="small-btn" data-upgrade="${d.id}">${I18n.t('upgrade.buy')}</button>`:`<button class="small-btn" disabled>${I18n.t('upgrade.requires.'+d.requires)}</button>`}</article>`).join('')}</div><div class="feature-summary">${I18n.t('report.investment')}: <b>${money(s.modernizations.investmentZl||0)}</b></div>`;
  }
  _upgradeAnnualSaving(id){const def=this.homeEnergyManager.upgrades().find(x=>x.id===id);if(def&&!def.available)return 0;const s=this.getEnergySettings(),key=[id,this.simulationEngine.simDate.toISOString().slice(0,7),s.tariffCode,JSON.stringify(s.tariffPrices),JSON.stringify(s.modernizations.installed)].join('|');if(this.homeEnergyManager._upgradeCache.has(key))return this.homeEnergyManager._upgradeCache.get(key);const before=this.analyticsManager.projections(this.simulationEngine.todayKWh,this.simulationEngine.todaySolarKWh,this.simulationEngine.todayCost).yearCost,clone=JSON.parse(JSON.stringify(s));clone.modernizations=clone.modernizations||{installed:{}};clone.modernizations.installed[id]={};const old=this.getEnergySettings;let saving=0;try{this.getEnergySettings=()=>clone;this.analyticsManager.invalidateCache();const after=this.analyticsManager.projections(this.simulationEngine.todayKWh,this.simulationEngine.todaySolarKWh,this.simulationEngine.todayCost).yearCost;saving=Math.max(0,before-after);}finally{this.getEnergySettings=old;this.analyticsManager.invalidateCache();}this.homeEnergyManager._upgradeCache.set(key,saving);return saving;}
  openAudit(){this._renderAudit();this._closeAllModals();document.getElementById('auditModal').classList.remove('hidden');}
  _renderAudit(){
    const mgr=this.homeEnergyManager,a=mgr.audit,p=a?mgr.auditProgress():null,findings=mgr.auditFindings();
    const targets=`<div class="audit-targets"><label>${I18n.t('audit.billTarget')}<input type="number" id="auditBill" min="0" max="100" value="10"></label><label>${I18n.t('audit.selfTarget')}<input type="number" id="auditSelf" min="0" max="100" value="40"></label><label>${I18n.t('audit.budgetTarget')}<input type="number" id="auditBudget" min="0" step="1" value="0"></label></div>`;
    const active=p&&a.status==='active'?`<section class="challenge-active"><h3>${I18n.t('audit.progress')}</h3><div class="challenge-progress-track"><i style="width:${p.dayReady?100:Math.min(100,p.elapsed/1440*100)}%"></i></div><div class="challenge-progress-meta"><span>${I18n.t('challenge.progressLabel')}: ${Math.min(24,Math.floor(p.elapsed/60))} / 24 h</span><span>${p.dayReady?I18n.t('audit.ready'):I18n.t('audit.wait')}</span></div><div class="audit-goals">${p.goals.map(g=>`<div class="feature-stat"><span>${I18n.t(g.id==='bill'?'challenge.bill.title':g.id==='selfUse'?'challenge.solar.title':'challenge.budget.title')}</span><b>${Number(g.current).toFixed(1)} / ${g.target}${g.id==='budget'?' PLN':'%'}</b></div>`).join('')}</div>${p.dayReady?`<button class="primary-btn" data-audit-finish>${I18n.t('audit.finish')}</button>`:''}</section>`:'';
    const result=a&&a.status==='complete'?`<section class="feature-result"><h3>${I18n.t(a.result.passed?'audit.pass':'audit.fail')}</h3><p>${I18n.t('report.cost')}: ${EnergyCalculator.fmtCost(a.result.currentYearCost,this.getEnergySettings().currency)} · ${I18n.t('challenge.solar.title')}: ${a.result.selfUsePct.toFixed(1)}%</p></section>`:'';
    document.getElementById('auditBody').innerHTML=`${!p||a.status!=='active'?`${targets}<button class="primary-btn" data-audit-start>${I18n.t('audit.start')}</button>`:''}${active}${result}<h3 class="feature-section-title">${I18n.t('audit.findings')}</h3><div class="feature-list">${findings.map(f=>`<div class="feature-list-row"><span>⚠ ${I18n.t(f.titleKey)}</span><b>${f.detail}</b>${f.upgrade?`<button class="small-btn" data-audit-upgrade>${I18n.t('audit.applyUpgrade')}</button>`:''}</div>`).join('')||`<p>${I18n.t('bld.noIssues')}</p>`}</div>`;
  }
  openFinalReport(){this._renderFinalReport();this._closeAllModals();document.getElementById('reportModal').classList.remove('hidden');}
  _renderFinalReport(){
    const r=this.homeEnergyManager.report(),s=this.getEnergySettings(),money=x=>EnergyCalculator.fmtCost(x,s.currency),kwh=x=>EnergyCalculator.fmtKWh(x),rows=(pairs)=>pairs.map(([k,v])=>`<div class="report-row"><span>${I18n.t(k)}</span><b>${v}</b></div>`).join('');
    const sections=[['report.energy',[['report.consumption',kwh(r.consumptionKWh)],['report.average',kwh(r.averageDailyKWh)],['report.grid',kwh(r.importKWh)],['report.pv',kwh(r.solarKWh)],['report.pvCapacity',EnergyCalculator.fmtW(r.pvCapacityW)],['report.export',kwh(r.exportKWh)],['report.batteryCharge',kwh(r.batteryChargeKWh)],['report.batteryDischarge',kwh(r.batteryDischargeKWh)]]],['report.costs',[['report.cost',money(r.costZl)],['report.evCost',money(r.evCostZl)],['report.saving',money(r.lifetimeSavingsZl)],['report.investment',money(r.investmentZl)],['report.payback',r.paybackYears==null?'—':r.paybackYears.toFixed(1)]]],['report.ecology',[['report.co2',`${r.co2Kg.toFixed(1)} kg`],['report.co2Reduction',`${r.co2ReductionKg.toFixed(1)} kg`],['report.renewable',`${r.renewablePct.toFixed(1)}%`]]],['report.installation',[['report.peak',EnergyCalculator.fmtW(r.maxLoadW)],['report.overload',`${r.overloadMinutes} min`],['report.trips',r.electricalTripCount],['report.pvCount',r.pvCount]]],['report.home',[['report.temperature',`${r.averageIndoorC.toFixed(1)}°C`],['report.comfort',`${r.comfortPct.toFixed(0)}%`],['report.efficiency',r.energyScore]]]];
    const hist=this.simulationEngine.history.slice(-14),max=Math.max(1,...hist.map(x=>Math.max(x.consumedKWh||0,x.solarKWh||0)));
    const chart=hist.length?`<div class="report-chart">${hist.map(d=>`<div class="report-chart-day" title="${d.dateISO}"><i style="height:${Math.max(2,(d.consumedKWh||0)/max*100)}%"></i><b style="height:${Math.max(1,(d.solarKWh||0)/max*100)}%"></b></div>`).join('')}</div><div class="report-legend"><span>■ ${I18n.t('report.consumption')}</span><span>■ ${I18n.t('report.pv')}</span></div>`:`<p class="feature-lede">${I18n.t('report.noData')}</p>`;
    const achievementStates=this.homeEnergyManager.achievementProgress(),rewards={under5:10,pvSelfUse:15,lowPeak:10,outageHour:20,retrofit:15,solarDay:20,lowCarbon:15,positiveBalance:25};
    document.getElementById('reportBody').innerHTML=`<div class="report-actions"><div class="report-period">${I18n.t('report.period')}: ${Math.floor(r.elapsedMinutes/60)} h · ${r.days.toFixed(1)} d · ${I18n.t('season.'+r.season)} · ${this.simulationEngine.skyCondition?I18n.t(this.simulationEngine.skyCondition.nameKey):''}</div><button class="small-btn" id="reportExportBtn">⬇ ${I18n.t('report.download')}</button><button class="small-btn" id="reportCsvBtn">⬇ CSV</button></div><div class="report-grid">${sections.map(([title,items])=>`<section class="report-section"><h3>${I18n.t(title)}</h3>${rows(items)}</section>`).join('')}</div><section class="report-section"><h3>${I18n.t('report.trend')}</h3>${chart}</section><section class="report-section"><h3>${I18n.t('achievement.title')} · ${I18n.t('achievement.points')}: ${this.homeEnergyManager.achievements.points}</h3><div class="achievement-grid">${achievementStates.map(a=>`<div class="achievement-item ${a.unlocked?'unlocked':''}"><b>${I18n.t('achievement.'+a.id)}</b><div class="challenge-mini-track"><i style="width:${a.pct}%"></i></div><small>${a.unlocked?I18n.t('achievement.unlocked'):I18n.t(a.ready?'achievement.locked':'achievement.inProgress')} · ${a.value.toFixed(1)} / ${a.target} · ${I18n.t('achievement.reward',{points:rewards[a.id]})}</small></div>`).join('')}</div></section>`;
    document.getElementById('reportExportBtn').addEventListener('click',()=>this._exportFinalReport(r));
    document.getElementById('reportCsvBtn').addEventListener('click',()=>this._exportHistoryCsv());
  }
  _exportHistoryCsv(){const rows=[['date','consumed_kWh','solar_kWh','import_kWh','export_kWh','cost'],...this.simulationEngine.history.slice(-400).map(d=>[d.dateISO,d.consumedKWh||0,d.solarKWh||0,d.importKWh||0,d.exportKWh||0,d.cost||0])];const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(';')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download='energyroom-historia.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  _exportFinalReport(report){
    const payload={title:I18n.t('energy.report'),exportedAt:new Date().toISOString(),language:I18n.lang,project:this.projectManager.projectName,report,days:this.simulationEngine.history.slice(-14),challenges:this.challengeManager.results};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`energyroom-report-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    this.toast(I18n.t('report.downloaded'));
  }
  _syncChallengeMode(){
    const active=!!(this.challengeManager&&this.challengeManager.active);
    document.body.dataset.challenge=active?'active':'';
    document.getElementById('btnChallenges').classList.toggle('active',active);
  }
  openChallenges(){ this._renderChallenges(); this._closeAllModals(); document.getElementById('challengesModal').classList.remove('hidden'); }
  _challengeValue(kind,value){
    if(kind==='bill'||kind==='solar'||kind==='independence') return `${Number(value).toFixed(1)}%`;
    if(kind==='budget') return EnergyCalculator.fmtCost(value,this.getEnergySettings().currency);
    if(kind==='consumption') return EnergyCalculator.fmtKWh(value);
    if(kind==='outage') return `${Number(value).toFixed(0)} ${I18n.t('common.minutes')}`;
    return `${Number(value).toFixed(0)}`;
  }
  _renderChallenges(){
    const manager=this.challengeManager, active=manager.active, progress=active?manager.progress():null;
    const history=manager.results.map(r=>`<div class="challenge-result ${r.passed?'passed':'failed'}"><span>${r.passed?'✓':'×'}</span><b>${I18n.t(manager.definitions.find(d=>d.id===r.id)?.titleKey||'challenge.title')}</b><small>${I18n.t(r.passed?'challenge.resultPass':'challenge.resultFail')} · ${this._challengeValue(manager.definitions.find(d=>d.id===r.id)?.kind,r.current)}</small></div>`).join('');
    const activeHtml=active&&progress?`<section class="challenge-active"><div class="challenge-active-head"><span>🎯</span><div><small>${I18n.t('challenge.active')}</small><b>${I18n.t(progress.def.titleKey)}</b></div><button class="small-btn" data-ch-finish="1">${I18n.t('challenge.finish')}</button></div>
      <p>${I18n.t(progress.def.conditionKey,{target:progress.def.target})}</p><div class="challenge-progress-track"><i style="width:${progress.pct}%"></i></div>
      <div class="challenge-progress-meta"><span>${I18n.t('challenge.progressLabel')}: <b>${this._challengeValue(progress.def.kind,progress.current)}</b></span><span>${Math.round(progress.pct)}%</span></div>${progress.def.kind==='outage'?`<small>${I18n.t('challenge.outageUnserved',{kwh:progress.unservedKWh.toFixed(3),served:progress.servedKWh.toFixed(2)})}</small>`:''}
      ${progress.def.requiresDay?`<div class="challenge-time ${progress.dayReady?'ready':''}">${I18n.t(progress.dayReady?'challenge.dayReady':'challenge.dayWait',{hours:Math.min(24,Math.floor(progress.elapsed/60))})}</div>`:''}</section>`:'';
    const cards=manager.definitions.filter(d=>!d.requiresRealistic||this.experienceMode==='realistic').map(d=>{
      const isActive=active&&active.id===d.id, p=isActive?progress:null;
      const goal=I18n.t(d.goalKey,{target:d.target});
      return `<article class="challenge-card ${isActive?'is-active':''}"><div class="challenge-card-icon">${d.icon}</div><div class="challenge-card-main"><h3>${I18n.t(d.titleKey)}</h3><p>${I18n.t(d.descKey)}</p><div class="challenge-goal"><b>${I18n.t('challenge.goalLabel')}:</b> ${goal}</div>${p?`<div class="challenge-mini-track"><i style="width:${p.pct}%"></i></div><small>${I18n.t('challenge.progressLabel')}: ${this._challengeValue(d.kind,p.current)} / ${goal}</small>`:''}</div>
        ${isActive?`<span class="challenge-active-tag">${I18n.t('challenge.active')}</span>`:`<button class="small-btn" data-ch-start="${d.id}" ${active?'disabled':''}>${active?I18n.t('challenge.active'):I18n.t('challenge.start')}</button>`}</article>`;
    }).join('');
    const info=this.experienceMode==='realistic'?'challenge.realisticNote':'challenge.casualNote';
    document.getElementById('challengesBody').innerHTML=`<p class="feature-lede">${I18n.t(info)}</p>${activeHtml}<div class="challenge-grid">${cards}</div>${history?`<section class="challenge-history"><h3>${I18n.t('challenge.history')}</h3>${history}</section>`:''}`;
  }

  _finishWelcome(applySetup){
    if(applySetup){
      const mode=document.getElementById('welcomeMode').value;
      const price=Number(String(document.getElementById('welcomePrice').value).replace(',','.'));
      if(!['casual','realistic','kids'].includes(mode) || !Number.isFinite(price) || price<0.01 || price>20){
        document.getElementById('welcomePrice').focus();
        this.toast(I18n.t('welcome.invalidPrice'));
        return;
      }
      this.experienceMode=mode;
      try { localStorage.setItem('energyroom_experience',mode); } catch(e){}
      this.updateModeUI();
      this._applyRealismMode();
      this.petManager.rename(document.getElementById('welcomePetName').value);
      const settings=this.getEnergySettings(), tariff=TariffManager.get(settings.tariffCode||'G11');
      settings.tariffPrices=settings.tariffPrices||{};
      settings.tariffPrices[tariff.code]=settings.tariffPrices[tariff.code]||{...tariff.defaultPrices};
      settings.tariffPrices[tariff.code][tariff.defaultRate]=price;
      this.setEnergySettings(settings);
      this.simulationEngine._recomputeInstant(false);
      this.analyticsManager.invalidateCache();
      this.projectManager.pushHistory();
      this.projectManager.saveLocal();
    }
    try { localStorage.setItem('energyroom_welcome_done','1'); } catch(e){}
    document.getElementById('welcomeModal').classList.add('hidden');
  }

  // ============================================================
  // ROOM TABS — switch between rooms / whole-house overview + wall slider
  // ============================================================
  _bindRoomTabs(){
    document.getElementById('wallVisRange').addEventListener('input', (e)=>{
      const t = Number(e.target.value)/100;
      this.roomBuilder.setWallVisibility(t);
      const house = this.getHouseState(); house.wallVisibility = t; this.setHouseState(house);
      document.getElementById('wallVisLabel').textContent = t<0.05 ? I18n.t('nav.wallsOpen') : (t>0.95 ? I18n.t('nav.wallsClosed') : Math.round(t*100)+'%');
    });
  }

  /** Storey switcher (only shown when the house has more than one level or the designer is open). */
  renderLevelTabs(){
    const house = this.getHouseState(), wrap = document.getElementById('levelTabs');
    const levels = BuildingModel.sortedLevels(house).reverse();
    wrap.classList.toggle('hidden', levels.length < 2 && !this.designerOpen);
    wrap.innerHTML = '';
    for (const l of levels){
      const b = document.createElement('button');
      b.className = 'room-tab' + (l.id===house.activeLevelId && house.activeRoomId!=='__all__' ? ' active' : '');
      b.textContent = '⬍ ' + l.name;
      b.addEventListener('click', ()=>this.setActiveLevel(l.id));
      wrap.appendChild(b);
    }
  }
  setActiveLevel(levelId){
    const house = this.getHouseState();
    house.activeLevelId = levelId;
    const cur = house.rooms.find(r=>r.id===house.activeRoomId);
    if (!cur || cur.levelId !== levelId){
      const first = BuildingModel.roomsOnLevel(house, levelId)[0];
      house.activeRoomId = first ? first.id : '__all__';
    }
    this.setHouseState(house);
    this.applyLevelView();
    this.renderRoomTabs();
    this._focusActiveRoom();
  }

  renderRoomTabs(){
    const house = this.getHouseState();
    const wrap = document.getElementById('roomTabs');
    wrap.innerHTML = '';
    this.renderLevelTabs();
    const multi = house.levels.length > 1;
    for (const r of house.rooms){
      if (multi && r.levelId !== house.activeLevelId) continue;   // only this storey's rooms get tabs (the "whole house" tab shows all)
      const b = document.createElement('button');
      b.className = 'room-tab' + (r.id===house.activeRoomId ? ' active' : '');
      b.dataset.roomId=r.id;
      const roomTemp=this.simulationEngine.roomTemperatures[r.id];
      b.innerHTML = `<span>${getRoomTypeMeta(r.type).icon} ${this._roomDisplayName(r)}</span><small class="room-temp" data-room-temp="${r.id}" title="${I18n.t('room.temperatureNow')}">${Number.isFinite(roomTemp)?roomTemp.toFixed(1)+'°C':'—'}</small>`;
      b.addEventListener('click', ()=>this.setActiveRoom(r.id));
      wrap.appendChild(b);
    }
    const allBtn = document.createElement('button');
    allBtn.className = 'room-tab' + (house.activeRoomId==='__all__' ? ' active' : '');
    allBtn.innerHTML = '🏠 ' + I18n.t('nav.wholeHouse');
    allBtn.addEventListener('click', ()=>this.setActiveRoom('__all__', true));
    wrap.appendChild(allBtn);

    const range = document.getElementById('wallVisRange');
    range.value = Math.round((house.wallVisibility ?? 1)*100);
    document.getElementById('wallVisLabel').textContent = range.value<5?I18n.t('nav.wallsOpen'):(range.value>95?I18n.t('nav.wallsClosed'):range.value+'%');
    this.renderCategoryTabs();
  }

  _roomDisplayName(room){
    const keys = { main:'roomtype.bedroom', living:'roomtype.living', kitchen:'roomtype.kitchen', office:'roomtype.office', garage:'roomtype.garage' };
    const key = keys[room.id] || ('roomtype.'+room.type);
    const typeKey = 'roomtype.'+room.type;
    const known = [I18N_DICT.pl[key], I18N_DICT.en[key], I18N_DICT.pl[typeKey], I18N_DICT.en[typeKey]].filter(Boolean);
    return known.includes(room.name) ? I18n.t(key) : room.name;
  }

  setActiveRoom(roomId, isOverview){
    const house = this.getHouseState();
    house.activeRoomId = roomId;
    const room = house.rooms.find(r=>r.id===roomId);
    if (room) house.activeLevelId = room.levelId;
    this.setHouseState(house);
    this.applyLevelView();
    this.renderRoomTabs();
    this._focusActiveRoom(isOverview);
  }

  _focusActiveRoom(isOverview){
    const house = this.getHouseState();
    if (isOverview || house.activeRoomId==='__all__'){
      let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,maxH=0,minY=Infinity,maxY=-Infinity;
      for (const id in this.roomBuilder.bounds){
        const b = this.roomBuilder.bounds[id];
        minX = Math.min(minX,b.offsetX); maxX = Math.max(maxX,b.offsetX+b.width); minZ=Math.min(minZ,b.offsetZ); maxZ=Math.max(maxZ,b.offsetZ+b.length);
        minY = Math.min(minY,b.elevation); maxY = Math.max(maxY,b.elevation+b.height);
      }
      this.sceneManager.frameArea(minX, minZ, maxX, maxZ, maxY-minY, minY);
      return;
    }
    const b = this.roomBuilder.bounds[house.activeRoomId];
    if (b) this.sceneManager.frameArea(b.offsetX, b.offsetZ, b.offsetX+b.width, b.offsetZ+b.length, b.height, b.elevation);
  }

  // ============================================================
  // LEFT PANEL — asset library
  // ============================================================
  renderCategoryTabs(){
    const wrap = document.getElementById('categoryTabs');
    wrap.innerHTML = '';
    const activeRoom = this.getActiveRoom();
    const roomName = document.getElementById('assetRoomName');
    const roomHint = document.getElementById('assetRoomHint');
    const inOverview = this.getHouseState().activeRoomId === '__all__';
    roomName.textContent = inOverview ? I18n.t('nav.wholeHouse') : this._roomDisplayName(activeRoom);
    roomHint.textContent = I18n.t(inOverview ? 'ui.library.chooseRoom' : 'ui.library.help');
    const cats = [...DEVICE_CATEGORIES.map(c=>({id:c.id, label:I18n.category(c.id)})), { id:'furniture', label:I18n.t('category.furniture') }];
    cats.push({ id:'installation', label:I18n.t('category.installation') });
    if (activeRoom && BuildingModel.roofSlopes(this.getHouseState(), activeRoom).length) cats.push({ id:'solar', label:I18n.t('category.solar') });
    if (!cats.find(c=>c.id===this.currentCategory)) this.currentCategory = cats[0].id;
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
      workbench:'🛠',garageshelf:'📦',toolcabinet:'🧰',bikerack:'🚲', solarpanel:'☀',
      poster:'🖼',walltext:'🔤',books:'📚',chairdrobe:'🪑',plant:'🪴',wallclock:'🕐',mirror:'🪞',croissant:'🥐',
      kitchencounter:'🍳',kitchenisland:'🍽',kitchensink:'🚰',pantry:'🥫',kitchencabinet:'🗄',
      bathtub:'🛁',toilet:'🚽',bathroomsink:'🚰',shower:'🚿',towelrack:'🧻',bathroomcabinet:'🗄',
      barstool:'🪑',armchair:'🛋',vase:'🏺',curtains:'🪟',nightstand:'🗄',crib:'🍼',whiteboard:'📋',
      piano:'🎹',standingdesk:'🗄',officecabinet:'🗄',barcart:'🍸',shoerack:'👞',laundrybasket:'🧺',trashbin:'🗑',
      gazebo:'⛱',gardengarage:'🚘',rainwatertank:'🛢',
      heatpump:'♨',floorheating:'🔥',portableac:'❄',projector:'📽',recordplayer:'🎵',pendantlight:'💡',nightlight:'🌙',
      winefridge:'🍷',blender:'🥤',saunaheater:'🧖',nas:'💾',doorbell:'🔔',
      gardenpump:'💧',ebikecharger:'🔋',poolpump:'🏊',outdoorlighting:'🔦',mowerdock:'🌱',lawnmower:'🌱',irrigation:'🚿',
      freezer:'🧊',rangehood:'💨',inductioncooktop:'🍳',robotvacuum:'🤖',
      waterheater:'🚿',fireplace:'🔥',dehumidifier:'🌫',ceilingfan:'🌀',
      thermostat:'🌡',smartlock:'🔒',smokedetector:'🚨',
      hairdryer:'💨',iron:'👕',evcharger:'⚡',treadmill:'🏃',
    };
    if (this.currentCategory==='solar'){
      for (const def of SOLAR_DEFINITIONS){
        const card = document.createElement('div');
        card.className='asset-card';
        card.innerHTML = `<div class="asset-icon">${ICONS.solarpanel}</div><div class="asset-name">${I18n.deviceName(def)}</div><div class="asset-power" style="color:var(--accent-good)">+${def.peakPowerW}W ${I18n.lang==='pl'?'szczyt':'peak'}</div>`;
        card.addEventListener('click', ()=>this._placeSolarPanel(def.id));
        grid.appendChild(card);
      }
      for (const def of BATTERY_DEFINITIONS){
        const card = document.createElement('div');
        card.className='asset-card';
        card.innerHTML = `<div class="asset-icon">🔋</div><div class="asset-name">${I18n.deviceName(def)}</div><div class="asset-power" style="color:var(--accent-data)">${def.capacityKWh} kWh</div>`;
        card.addEventListener('click', ()=>this._placeBattery(def.id));
        grid.appendChild(card);
      }
      return;
    }
    if (this.currentCategory==='installation'){
      const ELICONS = { socket:'🔌', power_strip:'🧷', switchboard:'🗄', meter:'🔢' };
      for (const def of ELECTRICAL_DEFINITIONS){
        const card = document.createElement('div');
        card.className = 'asset-card';
        const price = def.priceZl + def.laborZl;
        card.innerHTML = `<div class="asset-icon">${ELICONS[def.id]||'⚡'}</div><div class="asset-name">${I18n.deviceName(def)}</div><div class="asset-power" style="color:var(--accent-power)">${price>0 ? I18n.num(price,0)+' zł' : I18n.t('elec.operatorOwned')}</div>`;
        card.addEventListener('click', ()=>{ this._placeElectrical(def.id); if (this.isMobile()) document.getElementById('leftPanel').classList.remove('mobile-open'); });
        grid.appendChild(card);
      }
      return;
    }
    if (this.currentCategory==='furniture'){
      const room = this.getActiveRoom();
      const roomType = room ? room.type : null;
      const list = FURNITURE_DEFINITIONS.filter(f=>!f.onlyIn || f.onlyIn.includes(roomType));
      for (const def of list){
        grid.appendChild(this._assetCard(def.id, I18n.deviceName(def), ICONS[def.modelType]||'▫', null, true));
      }
      return;
    }
    const defs = DEVICE_DEFINITIONS.filter(d=>d.category===this.currentCategory&&(!d.onlyIn||d.onlyIn.includes(this.getActiveRoom()?.type)));
    for (const def of defs){
      grid.appendChild(this._assetCard(def.id, I18n.deviceName(def), ICONS[def.modelType]||'▫', def.ratedPowerW, false));
    }
  }

  _assetCard(defId, name, icon, powerW, isFurniture){
    const card = document.createElement('div');
    card.className='asset-card';
    card.innerHTML = `<div class="asset-icon">${icon}</div><div class="asset-name">${name}</div>` +
      (powerW!=null ? `<div class="asset-power">${EnergyCalculator.fmtW(powerW)}</div>` : `<div class="asset-power">${I18n.t("ui.furnitureTag")}</div>`);
    card.addEventListener('click', ()=>{
      const room = this.getActiveRoom();
      if (!room || room.id==='__all__'){ this.toast(I18n.t('msg.pickRoomObject')); return; }
      const pos = { x: room.settings.width/2, y:0, z: room.settings.length/2 };
      const inst = isFurniture ? this.objectManager.addFurniture(defId,pos,room.id) : this.objectManager.addDevice(defId,pos,room.id);
      if (inst){ this.transformManager.select(inst.id); this.projectManager.pushHistory(); this.log(I18n.t('log.added', { name: I18n.deviceName(inst.def) })); if (this.isMobile()) document.getElementById('leftPanel').classList.remove('mobile-open'); }
    });
    return card;
  }

  _placeSolarPanel(defId){
    const room = this.getActiveRoom();
    if (!room || room.id==='__all__'){ this.toast(I18n.t('msg.pickRoomObject')); return; }
    if (!BuildingModel.roofSlopes(this.getHouseState(), room).length){ this.toast(I18n.t('msg.noPvRoof')); return; }
    const slopeKey = (room.design.roof.type==='gable' && room.design.roof.pvSlope==='b') ? 'b' : 'a';
    const roof = this.roomBuilder.roofGroups[slopeKey==='b' ? room.id+'#b' : room.id];
    if (!roof){ this.toast(I18n.t('msg.noSlopedRoof')); return; }
    const existing = this.objectManager.getSolar(room.id).filter(p=>(p.slope||'a')===slopeKey).length;
    const cols = Math.max(1, Math.floor((roof.userData.span.w) / 1.06));
    const col = existing % cols, row = Math.floor(existing / cols);
    const panelW=1.0, panelL=1.65, gap=0.06;
    const spanW = cols*panelW + (cols-1)*gap;
    const startX = -spanW/2 + panelW/2, startZ = -roof.userData.span.l/2 + panelL/2 + 0.05;
    const lx = startX + col*(panelW+gap), lz = startZ + row*(panelL+gap);
    // ObjectManager auto-parents solar panels to this room's roof group (see getRoofGroup hook
    // in main.js), so a plain addSolar with roof-local x/z is all that's needed here.
    const inst = this.objectManager.addSolar(defId, {x:lx, y:roof.userData.surfaceY, z:lz}, room.id, slopeKey);
    if (!inst) return;
    this.transformManager.select(inst.id);
    this.projectManager.pushHistory();
    this.log(I18n.t('log.pvMounted', { room: room.name }));
    const totalPanels = this.objectManager.getSolar().length;
    this.petManager.awardPVInstalled(totalPanels);
    this.questManager.checkMilestones(this._questCtx());
    if (this.pvInstallMode) this._refreshPvInstallBanner();
    if (this.isMobile()) document.getElementById('leftPanel').classList.remove('mobile-open');
  }

  _placeBattery(defId){
    const room = this.getActiveRoom();
    if (!room || room.id==='__all__'){ this.toast(I18n.t('msg.pickRoomBattery')); return; }
    const pos = { x: room.settings.width*0.5, y:0, z: room.settings.length*0.5 };
    const inst = this.objectManager.addBattery(defId, pos, room.id);
    if (!inst) return;
    this.transformManager.select(inst.id);
    this.projectManager.pushHistory();
    this.log(I18n.t('log.batteryAdded', { name: I18n.deviceName(inst.def) }));
    this.questManager.checkMilestones(this._questCtx());
    if (this.isMobile()) document.getElementById('leftPanel').classList.remove('mobile-open');
  }

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
    document.getElementById('chkGrid').addEventListener('change', (e)=>this.roomBuilder.setGridVisible(e.target.checked));
    document.getElementById('chkSnap').addEventListener('change', (e)=>this.transformManager.setSnap(e.target.checked));
    document.getElementById('gridSnapSelect').addEventListener('change', (e)=>this.transformManager.setGridSnap(Number(e.target.value)));
    document.getElementById('rotSnapSelect').addEventListener('change', (e)=>this.transformManager.setRotSnap(Number(e.target.value)));
    document.querySelectorAll('[data-view]').forEach(b=>{
      b.addEventListener('click', ()=>this.sceneManager.setView(b.dataset.view));
    });
    const dn = document.getElementById('dayNightRange');
    dn.addEventListener('input', ()=>{
      this.sceneManager.setDayNight(Number(dn.value));
      this.updateDayNightLabel(false);
    });
    this.sceneManager.setDayNight(Number(dn.value));
    this.updateDayNightLabel(false);
    I18n.onChange(()=>this.updateDayNightLabel(true));
  }

  /** Slider + label: "10:30 · Poranek". fromSim=true -> follow the simulation clock, false -> the user's manual preview. */
  updateDayNightLabel(fromSim){
    const dn = document.getElementById('dayNightRange'), lbl = document.getElementById('dayNightLabel');
    if (!dn || !lbl) return;
    const hour = fromSim && this.sceneManager._hour != null ? this.sceneManager._hour : Number(dn.value);
    if (fromSim) dn.value = hour.toFixed(1);
    const st = this.sceneManager.sunState;
    const phase = st ? I18n.t('phase.' + st.phase) : '';
    lbl.textContent = ScheduleManager.fromMinutes(Math.round(hour*60)) + (phase ? ' · ' + phase : '');
    if (st) lbl.title = I18n.t('phase.tooltip', { sunrise: ScheduleManager.fromMinutes(Math.round(st.sunriseHour*60)),
      sunset: ScheduleManager.fromMinutes(Math.round(st.sunsetHour*60)), elevation: I18n.num(st.elevationDeg, 0) });
  }

  // ============================================================
  // MOBILE NAV — slide-out drawers for the asset/properties panels
  // ============================================================
  isMobile(){ return window.matchMedia('(max-width: 860px)').matches; }
  /** Force an immediate state/power recompute + visual refresh outside the sim clock,
   *  so manual power-switch / connected toggles feel instant even while paused in Edit mode. */
  _nudgeSim(){ this.simulationEngine._recomputeInstant(false); this.objectManager.updateVisuals(0.3); }
  /** Double-click / double-tap a device in the 3D scene to flip it on/off instantly,
   *  like flipping a real switch - the most direct way to control a device. */
  _quickTogglePower(id){
    const inst = this.objectManager.find(id);
    if (!inst || inst.kind!=='device') return;
    const isOn = inst.runtime.state && inst.runtime.state!=='off' && inst.runtime.state!=='standby';
    this.objectManager.setManualOverride(id, isOn ? 'off' : 'on');
    this._nudgeSim();
    this.projectManager.pushHistory();
    this.log(I18n.t(isOn?'log.dblOff':'log.dblOn', { name: inst.customName||I18n.deviceName(inst.def) }));
    if (this.transformManager.selectedId === id) this.renderProperties(inst);
  }
  /** Shows the continuous sky condition normally (section 10), switching to the more urgent
   *  extreme-event styling whenever one is active (storm/gale/heatwave/coldsnap - unchanged mechanic). */
  _renderWeatherBadge(){
    const el = document.getElementById('weatherBadge');
    const wx = this.weatherManager;
    el.classList.remove('hidden');
    if (wx.active){
      el.className = 'weather-badge active-'+wx.active.id;
      el.innerHTML = `${wx.active.icon} <b>${I18n.t(wx.active.nameKey)}</b>`;
      el.title = I18n.t(wx.active.descKey);
    } else {
      el.className = 'weather-badge sky-'+wx.condition.id;
      el.innerHTML = `${wx.condition.icon} <b>${I18n.t(wx.condition.nameKey)}</b> · ${(wx.factor*100).toFixed(0)}%`;
      el.title = I18n.t('weather.pvFactorHint');
    }
  }

  // ============================================================
  // VIRTUAL NETWORK PET — cosmetic companion, no gameplay/mechanic effect
  // ============================================================
  _bindPetWidget(){
    const widget = document.getElementById('petWidget');
    const panel = document.getElementById('petPanel');
    widget.addEventListener('click', ()=>{
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')){
        this._renderPet();
        document.getElementById('petTipDot').classList.add('hidden');
        this.petManager.awardDataAnalyzed('pet_panel', this.simulationEngine.simDayIndex);
      }
    });
    document.getElementById('petPanelClose').addEventListener('click', ()=> panel.classList.add('hidden'));
    document.getElementById('petNameInput').addEventListener('change', (e)=> this.petManager.rename(e.target.value));
    document.getElementById('petFeedBtn').addEventListener('click', ()=>{
      const ok = this.petManager.feed();
      if (ok){ this._playPetAnim('pulse'); this._petSpeak(I18n.t('pet.feedThanks',{name:this.petManager.name})); this._renderPet(); }
      else this.toast(I18n.t('msg.petWait'));
    });
    document.querySelectorAll('.pet-tab').forEach(t=>{
      t.addEventListener('click', ()=>{
        document.querySelectorAll('.pet-tab').forEach(x=>x.classList.toggle('active', x===t));
        document.querySelectorAll('.pet-tab-pane').forEach(p=>p.classList.add('hidden'));
        document.getElementById('petPane'+t.dataset.pettab[0].toUpperCase()+t.dataset.pettab.slice(1)).classList.remove('hidden');
      });
    });
    this._renderPet();
  }

  _renderPet(){
    const pm = this.petManager;
    const stage = pm.stage;
    document.getElementById('petAvatar').textContent = stage.emoji;
    document.getElementById('petAvatarBig').textContent = stage.emoji;
    document.getElementById('petLevelBadge').textContent = pm.level;
    document.getElementById('petLevelNum').textContent = pm.level;
    document.getElementById('petMaxLabel').textContent = pm.level>=50 ? '★ MAX' : '';
    document.getElementById('petStageName').textContent = I18n.petStage(stage);
    document.getElementById('petNameInput').value = pm.name;
    document.getElementById('petXpFill').style.width = pm.xpPct+'%';
    document.getElementById('petXpLabel').textContent = pm.xpToNext===Infinity
      ? `${Math.round(pm.xp)} XP (${I18n.lang==='en'?'max level':'poziom maks.'})` : `${Math.round(pm.xp)} / ${pm.xpToNext} XP`;
    document.getElementById('petMoodFill').style.width = Math.round(pm.mood)+'%';
    const mood = pm.mood < 25 ? 'low' : pm.mood < 65 ? 'calm' : 'happy';
    const widget = document.getElementById('petWidget');
    widget.classList.remove('mood-low','mood-calm','mood-happy');
    widget.classList.add('mood-'+mood);
    document.getElementById('petAvatar').title = I18n.t('pet.mood.'+mood);
    const tricks = document.getElementById('petTricks');
    tricks.innerHTML = pm.unlockedTricks.map(t=>`<button class="trick-btn" data-trick="${t.id}">✨ ${I18n.t(t.labelKey)}</button>`).join('')
      || ('<div style="font-size:11px;color:var(--text-3)">' + I18n.t('msg.petTricksLater') + '</div>');
    tricks.querySelectorAll('[data-trick]').forEach(b=>{
      b.addEventListener('click', ()=> this._playPetAnim(b.dataset.trick));
    });
    this._renderPetTips();
    this._renderPetQuests();
    this._renderPetUnlocks();
  }

  _renderPetTips(){
    const wrap = document.getElementById('petPaneTips');
    if (!wrap) return;
    const tips = this._latestTips || [];
    wrap.innerHTML = tips.length
      ? tips.map(t=>`<div class="advisor-tip ${t.level}">${t.level==='warning'?'⚠':t.level==='tip'?'💡':'ℹ'} ${t.text}</div>`).join('')
      : `<div class="pet-empty-note">${I18n.t('pet.noTips')}</div>`;
  }
  _renderPetQuests(){
    const wrap = document.getElementById('petPaneQuests');
    if (!wrap) return;
    const list = this.questManager.listWithStatus(this._questCtx());
    wrap.innerHTML = list.map(q=>`
      <div class="quest-item ${q.done?'done':''}">
        <div class="quest-item-head"><span>${q.done?'✅':'⬜'} ${I18n.t(q.titleKey)}</span><span class="quest-xp">+${q.xp} XP</span></div>
        <div class="quest-desc">${I18n.t(q.descKey)}</div>
        <div class="quest-bar"><div class="quest-bar-fill" style="width:${(q.progress*100).toFixed(0)}%"></div></div>
      </div>`).join('');
  }
  _renderPetUnlocks(){
    const wrap = document.getElementById('petPaneUnlocks');
    if (!wrap) return;
    const pm = this.petManager;
    const next = pm.nextUnlock;
    let html = pm.unlockedFeatures.map(u=>`<div class="unlock-item done">✅ ${I18n.t(u.labelKey)} <span class="unlock-lvl">Lv.${u.atLevel}</span></div>`).join('');
    if (next) html += `<div class="unlock-item next">🔒 ${I18n.t(next.labelKey)} <span class="unlock-lvl">${I18n.t('pet.nextUnlock')}: Lv.${next.atLevel}</span></div>`;
    wrap.innerHTML = html;
  }

  _playPetAnim(name){
    const avatars = [document.getElementById('petAvatar'), document.getElementById('petAvatarBig')];
    for (const el of avatars){
      if (!el) continue;
      el.classList.remove('pet-anim-spin','pet-anim-pulse','pet-anim-burst');
      void el.offsetWidth; // restart animation
      el.classList.add('pet-anim-'+name);
      setTimeout(()=> el.classList.remove('pet-anim-'+name), 1000);
    }
  }

  _bindMobileNav(){
    const left = document.getElementById('leftPanel'), right = document.getElementById('rightPanel');
    const scrim = document.getElementById('mobileScrim');
    const closeDrawers = ()=>{ left.classList.remove('mobile-open'); right.classList.remove('mobile-open'); scrim.classList.add('hidden'); };
    document.getElementById('btnMobileAssets').addEventListener('click', ()=>{
      const opening = !left.classList.contains('mobile-open');
      closeDrawers();
      if (opening){ left.classList.add('mobile-open'); scrim.classList.remove('hidden'); }
    });
    document.getElementById('btnMobileProps').addEventListener('click', ()=>{
      const opening = !right.classList.contains('mobile-open');
      closeDrawers();
      if (opening){ right.classList.add('mobile-open'); scrim.classList.remove('hidden'); }
    });
    scrim.addEventListener('click', closeDrawers);
    this._closeMobileDrawers = closeDrawers;
  }

  _focusSelected(){ const inst=this.objectManager.find(this.transformManager.selectedId); if (inst) this.sceneManager.focusOn(inst.group); }
  _duplicateSelected(){
    if (!this.transformManager.selectedId) return;
    const copy = this.objectManager.duplicate(this.transformManager.selectedId);
    if (copy){ this.transformManager.select(copy.id); this.projectManager.pushHistory(); this.log(I18n.t('log.duplicated', { name: I18n.deviceName(copy.def) })); }
  }
  _deleteSelected(){
    const id = this.transformManager.selectedId; if (!id) return;
    const inst = this.objectManager.find(id);
    this.objectManager.remove(id);
    this.transformManager.deselect();
    this.projectManager.pushHistory();
    if (inst) this.log(I18n.t('log.removed', { name: I18n.deviceName(inst.def) }));
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
      else if (e.key.toLowerCase()==='g'){ const c=document.getElementById('chkGrid'); c.checked=!c.checked; this.roomBuilder.setGridVisible(c.checked); }
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
      tip.innerHTML = `<b>${inst.customName||inst.def.name}</b><div class="t-row"><span>${I18n.t('ui.type')}</span><b>${I18n.t('ui.furniture')}</b></div>`;
      return;
    }
    if (inst.kind==='solar'){
      const gen = -inst.runtime.powerW;
      tip.innerHTML = `<b>${inst.customName||inst.def.name}</b>
        <div class="t-row"><span>${I18n.t('ui.production_now')}</span><b style="color:var(--accent-good)">${EnergyCalculator.fmtW(Math.max(0,gen))}</b></div>
        <div class="t-row"><span>${I18n.t('ui.peak_power')}</span><b>${EnergyCalculator.fmtW(inst.def.peakPowerW)}</b></div>`;
      return;
    }
    if (inst.kind==='battery'){
      const soc = inst.runtime.socKWh ?? inst.def.capacityKWh*0.5;
      const pct = Math.round(soc/inst.def.capacityKWh*100);
      tip.innerHTML = `<b>${inst.customName||inst.def.name}</b>
        <div class="t-row"><span>${I18n.t('ui.state_of_charge')}</span><b>${pct}%</b></div>
        <div class="t-row"><span>${I18n.t('ui.state')}</span><b>${inst.runtime.state||'idle'}</b></div>`;
      return;
    }
    if (inst.kind==='electrical'){
      const live = inst.runtime.state==='live';
      tip.innerHTML = `<b>${InstallationPanel.esc(inst.customName||I18n.deviceName(inst.def))}</b>
        <div class="t-row"><span>${I18n.t('ui.state')}</span><b style="color:${live?'var(--accent-good)':'var(--accent-danger)'}">${live ? I18n.t('elec.status.live') : I18n.t('elec.status.'+(inst.runtime.status||'noSupply'))}</b></div>
        ${inst.def.type==='socket' || inst.def.type==='strip' ? `<div class="t-row"><span>${I18n.t('elec.current')}</span><b>${I18n.num(inst.runtime.currentA||0,2)} A</b></div>` : ''}`;
      return;
    }
    const today = this.simulationEngine.todayKWhByDevice[inst.id]||0;
    const moLabel = inst.manualOverride ? ` <span style="color:${inst.manualOverride==='on'?'var(--accent-good)':'var(--accent-danger)'}">(wymuszono ${inst.manualOverride.toUpperCase()})</span>` : '';
    tip.innerHTML = `<b>${inst.customName||inst.def.name}</b>
      <div class="t-row"><span>${I18n.t('ui.power')}</span><b>${EnergyCalculator.fmtW(inst.runtime.powerW||0)}</b></div>
      <div class="t-row"><span>${I18n.t('ui.state')}</span><b>${inst.runtime.state}${moLabel}</b></div>
      <div class="t-row"><span>${I18n.t('ui.today')}</span><b>${EnergyCalculator.fmtKWh(today)}</b></div>
      <div style="margin-top:6px;font-size:10.5px;color:var(--text-3)">${I18n.t('ui.double_click_to_toggle_power')}</div>`;
  }

  // ============================================================
  // RIGHT PANEL — properties
  // ============================================================
  renderProperties(inst, transformOnly){
    const empty = document.getElementById('propEmpty');
    const content = document.getElementById('propContent');
    if (!inst){ empty.classList.remove('hidden'); content.classList.add('hidden'); return; }
    empty.classList.add('hidden'); content.classList.remove('hidden');
    if (this.isMobile() && !transformOnly){
      document.getElementById('leftPanel').classList.remove('mobile-open');
      document.getElementById('rightPanel').classList.add('mobile-open');
      document.getElementById('mobileScrim').classList.remove('hidden');
    }

    if (transformOnly && this._lastRenderedId===inst.id){
      this._writeTransformFields(inst);
      return;
    }
    this._lastRenderedId = inst.id;

    const isDevice = inst.kind==='device';
    const isSolar = inst.kind==='solar';
    const isBattery = inst.kind==='battery';
    const isElectrical = inst.kind==='electrical';
    let html = `<input class="prop-name-input" id="propNameInput" value="${InstallationPanel.esc(inst.customName||I18n.deviceName(inst.def))}">`;

    if (isBattery){
      const def = inst.def;
      const storage=inst.storage||(inst.storage={mode:'auto',sohPct:100,temperatureC:20,throughputKWh:0,maxChargeW:def.maxChargeW,maxDischargeW:def.maxDischargeW,reservePct:0});
      const capacityFactor=HomeEnergyManager.batteryCapacityFactor(this.getEnergySettings()),nominalCap=def.capacityKWh*capacityFactor,usableCap=nominalCap*storage.sohPct/100,soc = inst.runtime.socKWh ?? usableCap*0.5;
      const socPct = Math.round((soc/usableCap)*100);
      const state = inst.runtime.state||'idle';
      const stateLabel = state==='charging' ? '🔌 ' + I18n.t('battery.charging') : state==='discharging' ? '⚡ ' + I18n.t('battery.discharging') : '⏸ ' + I18n.t('battery.idle');
      const pw = inst.runtime.powerW||0;
      html += `
      <div class="prop-section">
        <h4>${I18n.t('ui.energy_storage')}</h4>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.manufacturer')}</span><span class="val">${def.manufacturer}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.capacity')}</span><span class="val">${usableCap.toFixed(1)} / ${nominalCap.toFixed(1)} kWh</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.state')}</span><span class="val">${stateLabel}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.power_now')}</span><span class="val" style="color:${pw>0?'var(--accent-power)':pw<0?'var(--accent-good)':'var(--text-2)'}">${pw>0?'+':''}${EnergyCalculator.fmtW(pw)}</span></div>
        <div class="soc-bar"><div class="soc-fill" style="width:${socPct}%"></div></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.state_of_charge')}</span><span class="val">${socPct}% (${soc.toFixed(1)} / ${usableCap.toFixed(1)} kWh)</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('battery.soh')}</span><span class="val"><span id="batterySoh">${storage.sohPct.toFixed(1)}%</span> · ${I18n.t('battery.temperature')} <span id="batteryTemp">${storage.temperatureC.toFixed(1)}°C</span></span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('battery.chargeCycles')}</span><span class="val">${EnergyCalculator.fmtKWh(storage.throughputKWh||0)}</span></div>
        <div class="field-row"><label>${I18n.t('battery.mode')}</label><select id="batteryMode">${['auto','self','cheap','backup','pv'].map(m=>`<option value="${m}" ${storage.mode===m?'selected':''}>${I18n.t('battery.mode.'+m)}</option>`).join('')}</select></div>
        <div class="field-row"><label>${I18n.t('battery.maxCharge')}</label><input type="number" id="batteryMaxCharge" min="0" max="${def.maxChargeW}" value="${storage.maxChargeW}"></div>
        <div class="field-row"><label>${I18n.t('battery.maxDischarge')}</label><input type="number" id="batteryMaxDischarge" min="0" max="${def.maxDischargeW}" value="${storage.maxDischargeW}"></div>
        <div class="field-row"><label>${I18n.t('battery.reserve')} </label><input type="number" id="batteryReserve" min="0" max="90" value="${storage.reservePct||0}"></div>
        <div class="toggle-row"><span class="lbl">${I18n.t('ui.connected')}</span>
          <label class="switch"><input type="checkbox" id="propConnected" ${inst.connected?'checked':''}><span class="slider-tog"></span></label>
        </div>
        <div style="margin-top:6px"><span class="badge estimated">${I18n.t('ui.badge.estimated')}</span></div>
        <div style="font-size:11px;color:var(--text-3);margin-top:6px">${I18n.sourceNote(def)}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:6px">${I18n.t('ui.it_charges_from_pv_surplus_and_dis')}</div>
      </div>`;
    } else if (isSolar){
      const def = inst.def;
      const gen = Math.max(0, -inst.runtime.powerW);
      const s = this.getEnergySettings();
      const orient = inst.pvOrientation || SolarCalculator.DEFAULT_ORIENTATION;
      const doy = this.simulationEngine.dayOfYear;
      const aim = SolarCalculator.aimQuality(orient, doy);
      const aimLabel = aim>=0.85 ? I18n.t('pv.aimExcellent') : aim>=0.6 ? I18n.t('pv.aimGood') : I18n.t('pv.aimPoor');
      const aimColor = aim>=0.85 ? 'var(--accent-good)' : aim>=0.6 ? 'var(--accent-power)' : 'var(--accent-danger)';
      html += `
      <div class="prop-section">
        <h4>${I18n.t('panel.pv')}</h4>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.manufacturer')}</span><span class="val">${def.manufacturer}</span></div>
        <div class="prop-row"><span class="lbl">Model</span><span class="val">${def.model}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('pv.panelPower')}</span><span class="val">${EnergyCalculator.fmtW(def.peakPowerW)}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('panel.currentProduction')}</span><span class="val" style="color:var(--accent-good)">${EnergyCalculator.fmtW(gen)}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('pv.panelTemperature')}</span><span class="val">${(inst.runtime.panelTemperatureC??20).toFixed(1)}°C</span></div>
        <div class="toggle-row"><span class="lbl">${I18n.t('pv.fault')}</span><label class="switch"><input type="checkbox" id="pvFaultToggle" ${inst.runtime.faulted?'checked':''}><span class="slider-tog"></span></label></div>
        ${(()=>{ const da = inst.runtime.directAccess==null ? 1 : inst.runtime.directAccess; const pct = Math.round(da*100);
          const col = pct>=90 ? 'var(--accent-good)' : pct>=50 ? 'var(--accent-power)' : 'var(--accent-danger)';
          return `<div class="prop-row"><span class="lbl">${I18n.t('pv.directAccess')}</span><span class="val" style="color:${col}">${pct}%</span></div>
        <div class="aim-bar"><div class="aim-fill" style="width:${pct}%;background:${col}"></div></div>
        <div style="font-size:11px;color:var(--text-3);margin:4px 0 6px">${I18n.t('pv.shadeNote')}</div>`; })()}
        <div class="toggle-row"><span class="lbl">${I18n.t('ui.connected_to_the_inverter')}</span>
          <label class="switch"><input type="checkbox" id="propConnected" ${inst.connected?'checked':''}><span class="slider-tog"></span></label>
        </div>
        <div style="margin-top:6px"><span class="badge estimated">${I18n.t('ui.badge.estimated')}</span></div>
        <div style="font-size:11px;color:var(--text-3);margin-top:6px">${I18n.sourceNote(def)}</div>
      </div>
      <div class="prop-section">
        <h4>${I18n.t('pv.orientation')} &amp; ${I18n.t('pv.tilt')}</h4>
        <div class="prop-row"><span class="lbl">${I18n.t('pv.compass')}</span><span class="val">${SolarCalculator.compassLabel(orient.azimuthDeg, I18n.lang)} (${orient.azimuthDeg.toFixed(0)}°)</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('pv.tilt')}</span><span class="val">${orient.tiltDeg.toFixed(0)}°</span></div>
        <div class="aim-bar"><div class="aim-fill" style="width:${(aim*100).toFixed(0)}%;background:${aimColor}"></div></div>
        <div class="prop-row"><span class="lbl">${I18n.t('pv.aimQuality')}</span><span class="val" style="color:${aimColor}">${(aim*100).toFixed(0)}% — ${aimLabel}</span></div>
        <div style="font-size:11px;color:var(--text-3);margin-top:6px">${I18n.t('pv.idealNote')}</div>
      </div>`;
    } else if (isDevice){
      const def = inst.def;
      const dsBadge = def.dataSource==='manufacturer' ? '<span class="badge manufacturer">' + I18n.t('ui.badge.manufacturer') + '</span>' : '<span class="badge estimated">' + I18n.t('ui.badge.estimated') + '</span>';
      const dailyKWh = (this.simulationEngine.todayKWhByDevice[inst.id]||0);
      const s = this.getEnergySettings();
      const rate = EnergyCalculator.priceAt(this.simulationEngine.absMin, s);
      const mo = inst.manualOverride;
      html += `
      <div class="prop-section">
        <h4>${I18n.t('ui.powerSection')}</h4>
        <div class="power-switch">
          <button class="ps-btn ${!mo?'active':''}" data-val="auto">🕐 Auto</button>
          <button class="ps-btn on ${mo==='on'?'active':''}" data-val="on">${I18n.t('ui.powerOn')}</button>
          <button class="ps-btn off ${mo==='off'?'active':''}" data-val="off">${I18n.t('ui.powerOff')}</button>
        </div>
        <div style="font-size:11px;color:var(--text-3);margin-top:7px">${mo ? I18n.t('msg.forcedManual') : I18n.t('msg.autoMode')}</div>
      </div>
      <div class="prop-section">
        <h4>${I18n.t('ui.deviceSection')}</h4>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.manufacturer')}</span><span class="val">${def.manufacturer}</span></div>
        <div class="prop-row"><span class="lbl">Model</span><span class="val">${def.model}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.power')}</span><span class="val">${EnergyCalculator.fmtW(inst.runtime.powerW||0)}</span></div>
        <div class="prop-row"><span class="lbl">Standby</span><span class="val">${EnergyCalculator.fmtW(def.standbyPowerW)}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.state')}</span><span class="val">
          <span class="state-pill"><span class="state-dot" style="background:${this._stateColor(inst.runtime.state)}"></span>${inst.runtime.state}</span>
        </span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.energy_today')}</span><span class="val">${EnergyCalculator.fmtKWh(dailyKWh)}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('tariff.currentRate')}</span><span class="val">${rate.toFixed(2)} ${s.currency}/kWh ${EnergyCalculator.isCheapRateAt(this.simulationEngine.absMin,s)?'🟢':EnergyCalculator.isExpensiveRateAt(this.simulationEngine.absMin,s)?'🔴':''} <span class="tariff-code-pill">${s.tariffCode}</span></span></div>
        ${this._deviceSupplyHtml(inst)}
        ${inst.ev?this._evChargePanelHtml(inst,s,rate):''}
        <div class="toggle-row"><span class="lbl">${I18n.t('ui.plugged_into_a_socket')}</span>
          <label class="switch"><input type="checkbox" id="propConnected" ${inst.connected?'checked':''}><span class="slider-tog"></span></label>
        </div>
        <div style="margin-top:6px">${dsBadge}</div>
        <button class="small-btn edu-btn" id="propEduBtn">${I18n.t('ui.how_does_energy_consumption_work')}</button>
      </div>`;
    } else if (isElectrical){
      html += this._electricalPropsHtml(inst);
    } else {
      html += `<div class="prop-section"><h4>${I18n.t('ui.furnitureSection')}</h4>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.type')}</span><span class="val">${I18n.t('ui.furniture')}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.energy_impact')}</span><span class="val">${I18n.t('ui.none')}</span></div>
      </div>`;
    }

    html += `
    <div class="prop-section">
      <h4>Transform ${isSolar?'<span style="color:var(--text-3);font-weight:400;text-transform:none;font-size:10.5px">' + I18n.t('ui.local_to_the_roof') + '</span>':''}</h4>
      <div class="xyz-head"><span></span><span>X</span><span>Y</span><span>Z</span></div>
      <div class="xyz-grid"><span class="axis-lbl">${I18n.t('ui.pos')}</span>
        <input type="number" step="0.05" id="posX"><input type="number" step="0.05" id="posY"><input type="number" step="0.05" id="posZ"></div>
      <div class="xyz-grid"><span class="axis-lbl">${I18n.t('ui.rot')}</span>
        <input type="number" step="1" id="rotX"><input type="number" step="1" id="rotY"><input type="number" step="1" id="rotZ"></div>
      <div class="xyz-grid"><span class="axis-lbl">${I18n.t('ui.scaleLbl')}</span>
        <input type="number" step="0.05" id="scaX"><input type="number" step="0.05" id="scaY"><input type="number" step="0.05" id="scaZ"></div>
      <button class="small-btn" id="propReset">${I18n.t('ui.reset_transform')}</button>
    </div>`;

    if (isDevice){
      const def = inst.def;
      html += `
      <div class="prop-section">
        <h4>${I18n.t('ui.energySection')}</h4>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.ratedPower')}</span><span class="val">${EnergyCalculator.fmtW(def.ratedPowerW)}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.typicalPower')}</span><span class="val">${EnergyCalculator.fmtW(Object.values(def.states).find(v=>v>0)||0)}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.standbyPower')}</span><span class="val">${EnergyCalculator.fmtW(def.standbyPowerW)}</span></div>
        ${def.cycleEnergyKWh!=null ? `<div class="prop-row"><span class="lbl">${I18n.t('ui.cycleEnergy')}</span><span class="val">${def.cycleEnergyKWh} kWh</span></div>`:''}
        <div class="prop-row"><span class="lbl">${I18n.t('ui.energy_class')}</span><span class="val">${def.energyClass}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.data_source')}</span><span class="val">${def.dataSource}</span></div>
        <div style="font-size:11px;color:var(--text-3);margin-top:4px">${I18n.sourceNote(def)}</div>
      </div>
      <div class="prop-section">
        <h4>${I18n.t('sched.title')}</h4>
        <div class="sched-summary-text">${ScheduleManager.summarize(ScheduleManager.normalize(inst.schedule, def), I18n.lang)}</div>
        <div class="timeline24" id="timeline24"></div>
        <button class="small-btn" id="propSchedBtn">${I18n.t('sched.editButton')}</button>
      </div>
      <div class="prop-section"><button class="small-btn" id="propAddCompare">➕ ${I18n.t('stats.compareDevices')} (${this.compareSelection.length}/2)</button></div>`;
    }

    content.innerHTML = html;
    this._writeTransformFields(inst);
    if (isDevice) this._renderDaysAndTimeline(inst);

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
    if (isDevice || isSolar || isBattery){
      const connEl = document.getElementById('propConnected');
      if (connEl) connEl.addEventListener('change', (e)=>{ this.objectManager.setConnected(inst.id, e.target.checked); this._nudgeSim(); this.projectManager.pushHistory(); });
    }
    if (isDevice) this._bindDeviceSupply(inst);
    if (isDevice && inst.ev) this._bindEvControls(inst);
    if (isBattery) this._bindBatteryControls(inst);
    if (isSolar) document.getElementById('pvFaultToggle').addEventListener('change',e=>{inst.runtime.faulted=e.target.checked;this._nudgeSim();this.projectManager.pushHistory();this.renderProperties(inst);});
    if (isElectrical) this._bindElectricalProps(inst);
    if (isDevice){
      content.querySelectorAll('.ps-btn').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          this.objectManager.setManualOverride(inst.id, btn.dataset.val==='auto' ? null : btn.dataset.val);
          this._nudgeSim();
          this.projectManager.pushHistory();
          this.renderProperties(inst);
          this.log(I18n.t('log.powerMode', { name: inst.customName||I18n.deviceName(inst.def), mode: btn.dataset.val }));
        });
      });
      document.getElementById('propEduBtn').addEventListener('click', ()=>this.openEdu(inst));
      document.getElementById('propSchedBtn').addEventListener('click', ()=> this._openDeviceScheduleEditor(inst));
      const cmp = document.getElementById('propAddCompare');
      if (cmp) cmp.addEventListener('click', ()=>{
        if (!this.compareSelection.includes(inst.id)) this.compareSelection.push(inst.id);
        if (this.compareSelection.length>2) this.compareSelection.shift();
        this.renderProperties(inst);
      });
    }
  }

  // ============================================================
  // HOUSE DESIGNER
  // ============================================================
  _bindDesigner(){
    this.designerOpen = false;
    this.designer = new DesignerPanel(document.getElementById('designerBody'), {
      getHouse: ()=>this.getHouseState(),
      onChange: (kind)=>this._designerChanged(kind),
      onAddRoom: (type, levelId)=>this._addRoom(type, levelId),
      onRemoveRoom: (id)=>{ this._removeRoom(id); this.designer.render(); },
      onFocusRoom: (id)=>this.setActiveRoom(id),
      onOpeningState: (roomId, opId, open)=>this.roomBuilder.setOpening(roomId, opId, open),
      onClose: ()=>this.toggleDesigner(false),
    });
    I18n.onChange(()=>{ if (this.designerOpen) this.designer.render(); });
  }
  toggleDesigner(force){
    this.designerOpen = force != null ? force : !this.designerOpen;
    document.getElementById('designerDock').classList.toggle('hidden', !this.designerOpen);
    document.getElementById('btnDesigner').classList.toggle('active', this.designerOpen);
    if (this.designerOpen){ this.designer.msg = null; this.designer.render(); }
    this.renderLevelTabs();
  }
  /** An edit in the designer: rebuild the 3D house, keep the installation inside the new walls, record undo history. */
  _designerChanged(kind){
    const house = this.getHouseState();
    BuildingModel.migrateHouse(house);
    this.setHouseState(house);
    if (kind === 'levelView'){ this.applyLevelView(); this.renderRoomTabs(); return; }
    if (kind === 'openState'){ this.projectManager.pushHistory(); return; }
    this.rebuildHouse();
    this._fitElectricalToRooms();
    this.electrical.prune();
    this.projectManager.pushHistory();
    this.renderRoomTabs();
    this._nudgeSim();
    if (this.transformManager.selectedId){ const inst = this.objectManager.find(this.transformManager.selectedId); if (inst) this.renderProperties(inst); }
  }

  // ============================================================
  // ELECTRICAL INSTALLATION
  // ============================================================
  _bindInstallation(){
    this.installPanel = new InstallationPanel(document.getElementById('installBody'), {
      electrical: this.electrical,
      onChange: ()=>{ this.electrical.prune(); this.projectManager.pushHistory(); this.wireRenderer.markDirty(); this._nudgeSim(); this._refreshSelectedProps(); },
      onSelect: (id)=>{ document.getElementById('installModal').classList.add('hidden'); this.transformManager.select(id); },
      onAddElement: (defId)=>{ this._placeElectrical(defId); },
      getEconomics: ()=>{ const sim = this.simulationEngine; return { energyYearZl: this.analyticsManager.projections(sim.todayKWh, sim.todaySolarKWh, sim.todayCost).yearCost }; },
      getWireVisible: ()=>this.wireRenderer.visible,
      onWireVisible: (v)=>this.wireRenderer.setVisible(v),
    });
    // live numbers while the window is open (skipped while the user is editing a field)
    setInterval(()=>{ const m = document.getElementById('installModal'); if (m && !m.classList.contains('hidden')) this.installPanel.tick(); }, 1000);
    I18n.onChange(()=>{ const m = document.getElementById('installModal'); if (m && !m.classList.contains('hidden')) this.installPanel.render(); });
  }
  openInstallation(){ this._closeAllModals(); this.installPanel.render(); document.getElementById('installModal').classList.remove('hidden'); }
  /** Re-renders the properties panel of the selected object (its supply status just changed). */
  _refreshSelectedProps(){
    const id = this.transformManager.selectedId; if (!id) return;
    const inst = this.objectManager.find(id); if (inst){ this._lastRenderedId = null; this.renderProperties(inst); }
  }
  /** A protection tripped / a cable burned: make the state visible everywhere without waiting for the next tick. */
  onElectricalEvent(ev){
    this._refreshSelectedProps();
    const m = document.getElementById('installModal');
    if (m && !m.classList.contains('hidden')) this.installPanel.render();
  }

  /** Adds a socket / strip / switchboard / meter to the active room (wall elements go on the back wall, then the gizmo moves them). */
  _placeElectrical(defId){
    const room = this.getActiveRoom();
    if (!room || room.id==='__all__'){ this.toast(I18n.t('msg.pickRoomObject')); return null; }
    const def = getElectricalDefinition(defId), el = this.electrical;
    if ((defId==='switchboard' && el.board) || (defId==='meter' && el.meter)){ this.toast(I18n.t('elec.msg.alreadyExists')); return null; }
    const W = room.settings.width, L = room.settings.length;
    const pos = def.wallMount ? { x:W/2, y:def.defaultY, z:0.055 } : { x:W/2, y:0, z:L/2 };
    const inst = this.objectManager.addElectrical(defId, pos, room.id, 0);
    if (!inst) return null;
    if (def.type==='socket'){
      // joins the circuit of the nearest existing socket in this room and is wired right away, so it works immediately
      const near = el.sockets(room.id).filter(x=>x!==inst && x.circuitId)
        .sort((a,b)=>Math.hypot(a.position.x-pos.x,a.position.z-pos.z)-Math.hypot(b.position.x-pos.x,b.position.z-pos.z))[0];
      inst.circuitId = near ? near.circuitId : ((el.data.circuits[0] && el.data.circuits[0].id) || null);
      if (inst.circuitId && el.board) el.wire(inst.id);
    }
    this.wireRenderer.markDirty();
    this.transformManager.select(inst.id); this.projectManager.pushHistory();
    this.log(I18n.t('log.added', { name: I18n.deviceName(inst.def) }));
    return inst;
  }
  _fitElectricalToRooms(){
    for (const inst of this.objectManager.getElectrical()){
      const room = this.getRoom(inst.roomId); if (!room) continue;
      const W = room.settings.width, L = room.settings.length, H = room.settings.height;
      const x = Math.max(0.055, Math.min(inst.position.x, W-0.055)), z = Math.max(0.055, Math.min(inst.position.z, L-0.055)), y = Math.min(inst.position.y, H-0.1);
      if (x!==inst.position.x || z!==inst.position.z || y!==inst.position.y) this.objectManager.applyTransform(inst.id, { x, y, z }, inst.rotation, inst.scale);
    }
    this.wireRenderer.markDirty();
  }

  _electricalPropsHtml(inst){
    const e = this.electrical, d = inst.def, live = inst.runtime.state==='live';
    const pill = `<span class="ip-pill ${live?'ok':'bad'}">${live ? I18n.t('elec.status.live') : I18n.t('elec.status.'+(inst.runtime.status||'noSupply'))}</span>`;
    let body = '';
    if (d.type==='socket'){
      const w = e.wireOf(inst.id), cab = e.cableFor(inst), c = inst.circuitId ? e.circuit(inst.circuitId) : null;
      body = `
        <div class="prop-row"><span class="lbl">${I18n.t('elec.circuit')}</span><span class="val">
          <select id="elCircuit"><option value="">—</option>${e.data.circuits.map(x=>`<option value="${x.id}" ${x.id===inst.circuitId?'selected':''}>${InstallationPanel.esc(x.name||x.id)}</option>`).join('')}</select></span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('elec.wire')}</span><span class="val">${w ? `${cab.label} · ${I18n.num(e.wireLengthM(w),1)} m` : '—'}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('elec.route')}</span><span class="val"><select id="elRoute" ${w?'':'disabled'}>${['ceiling','floor','direct'].map(k=>`<option value="${k}" ${w&&w.route===k?'selected':''}>${I18n.t('elec.route.'+k)}</option>`).join('')}</select></span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('elec.voltage')}</span><span class="val">${I18n.num(inst.runtime.voltageV||0,0)} V</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('elec.current')}</span><span class="val">${I18n.num(inst.runtime.currentA||0,2)} A / ${d.ratedA} A</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('elec.outlets')}</span><span class="val">${e.usedOutlets(inst.id)} / ${d.outlets}</span></div>
        <button class="small-btn" id="elWireToggle">${w ? I18n.t('elec.unwire') : I18n.t('elec.wireIt')}</button>`;
    } else if (d.type==='strip'){
      const socks = e.sockets().filter(x=>e.freeOutlets(x.id)>0 || x.id===inst.plugTo);
      body = `
        <div class="prop-row"><span class="lbl">${I18n.t('elec.pluggedInto')}</span><span class="val"><select id="elStripSocket"><option value="">${I18n.t('elec.notPlugged')}</option>${socks.map(x=>`<option value="${x.id}" ${x.id===inst.plugTo?'selected':''}>${InstallationPanel.esc(this.installPanel.socketLabel(x))}</option>`).join('')}</select></span></div>
        <div class="toggle-row"><span class="lbl">${I18n.t('elec.switch')}</span><label class="switch"><input type="checkbox" id="elStripOn" ${inst.enabled!==false?'checked':''}><span class="slider-tog"></span></label></div>
        <div class="prop-row"><span class="lbl">${I18n.t('elec.current')}</span><span class="val">${I18n.num(inst.runtime.currentA||0,2)} A / ${d.ratedA} A</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('elec.outlets')}</span><span class="val">${e.usedOutlets(inst.id)} / ${d.outlets}</span></div>
        ${inst.runtime.status==='tripped' ? `<button class="small-btn" id="elStripReset">${I18n.t('elec.reset')}</button>` : ''}`;
    } else if (d.type==='board'){
      const m = e.data.mainBreaker;
      body = `
        <div class="prop-row"><span class="lbl">${I18n.t('elec.mainBreaker')}</span><span class="val">${m.ratingA} A · ${m.state==='closed' ? I18n.t('elec.state.closed') : I18n.t('elec.state.tripped')}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('elec.breakers')}</span><span class="val">${e.data.breakers.length}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('elec.circuits')}</span><span class="val">${e.data.circuits.length}</span></div>
        <button class="small-btn" id="elOpenInstall">⚡ ${I18n.t('elec.openInstallation')}</button>`;
    } else {
      body = `<div class="prop-row"><span class="lbl">${I18n.t('elec.role')}</span><span class="val">${I18n.t('elec.meterRole')}</span></div>
        <button class="small-btn" id="elOpenInstall">⚡ ${I18n.t('elec.openInstallation')}</button>`;
    }
    return `<div class="prop-section"><h4>${I18n.t('elec.section')}</h4>
      <div class="prop-row"><span class="lbl">${I18n.t('ui.state')}</span><span class="val">${pill}</span></div>${body}</div>`;
  }
  _bindElectricalProps(inst){
    const e = this.electrical, g = id=>document.getElementById(id);
    const done = ()=>{ e.prune(); this.projectManager.pushHistory(); this.wireRenderer.markDirty(); this._nudgeSim(); this._lastRenderedId = null; this.renderProperties(inst); };
    if (g('elCircuit')) g('elCircuit').addEventListener('change', ev=>{ e.assignSocketCircuit(inst.id, ev.target.value||null); done(); });
    if (g('elRoute')) g('elRoute').addEventListener('change', ev=>{ e.setWireRoute(inst.id, ev.target.value); done(); });
    if (g('elWireToggle')) g('elWireToggle').addEventListener('click', ()=>{ if (e.wireOf(inst.id)) e.unwire(inst.id); else e.wire(inst.id); done(); });
    if (g('elStripSocket')) g('elStripSocket').addEventListener('change', ev=>{ if (ev.target.value) e.plugStrip(inst.id, ev.target.value); else inst.plugTo = null; done(); });
    if (g('elStripOn')) g('elStripOn').addEventListener('change', ev=>{ inst.enabled = ev.target.checked; done(); });
    if (g('elStripReset')) g('elStripReset').addEventListener('click', ()=>{ e.resetStrip(inst.id); done(); });
    if (g('elOpenInstall')) g('elOpenInstall').addEventListener('click', ()=>this.openInstallation());
  }

  /** "Power supply" block of a device: what it is plugged into, why it might be dead, and the supply chain. */
  _deviceSupplyHtml(inst){
    const e = this.electrical, r = e.rt.devices[inst.id], status = inst.runtime.powerStatus || (r ? r.status : 'unassigned');
    const ok = status==='ok' || status==='legacy';
    const chain = e.trace(inst.id).map(n=>{
      const name = I18n.t('elec.node.'+n.type);
      let extra = '';
      if (n.type==='device') extra = ` <b>${EnergyCalculator.fmtW(n.powerW||0)}</b>`;
      else if (n.type==='breaker' || n.type==='main') extra = n.ratingA ? ` ${n.ratingA} A` : '';
      return `<span class="flow-node ${n.ok?'':'flow-bad'}">${name}${extra}</span>`;
    }).join('<span class="flow-arrow">→</span>');
    return `<div class="prop-row"><span class="lbl">${I18n.t('elec.pluggedInto')}</span><span class="val">
        <select id="propPlugTo">${InstallationPanel.plugOptions(this.installPanel, inst)}</select></span></div>
      <div class="prop-row"><span class="lbl">${I18n.t('elec.supply')}</span><span class="val"><span class="ip-pill ${ok?'ok':'bad'}">${I18n.t('elec.status.'+status)}</span></span></div>
      <div class="prop-row"><span class="lbl">${I18n.t('elec.voltage')}</span><span class="val">${I18n.num(inst.runtime.voltageV||0,0)} V</span></div>
      <div class="flow-chain">${chain}</div>`;
  }
  _evChargePanelHtml(inst,settings,rate){
    const ev=inst.ev, socPct=Math.round(ev.socKWh/ev.capacityKWh*100), kmCost=ev.consumptionKWhPer100Km*rate;
    const chargeW=inst.runtime.powerW||ev.maxPowerW,remaining=chargeW>0?Math.max(0,(ev.capacityKWh*ev.targetPct/100-ev.socKWh)/chargeW*60):null;
    const sourceOptions=['auto','grid','solar','battery'].map(id=>`<option value="${id}" ${ev.source===id?'selected':''}>${I18n.t('ev.source.'+id)}</option>`).join('');
    return `<div class="prop-section ev-panel"><h4>🚘 ${I18n.t('ev.title')}</h4>
      <div class="ev-soc-bar"><i id="evSocFill" style="width:${socPct}%"></i></div><div class="prop-row"><span class="lbl">${I18n.t('ev.soc')}</span><span class="val" id="evSocLabel">${socPct}% · ${ev.socKWh.toFixed(1)} / ${ev.capacityKWh} kWh</span></div>
      <label class="ev-setting"><span>${I18n.t('ev.capacity')}</span><span><input class="ev-control" id="evCapacity" type="number" min="20" max="150" step="5" value="${ev.capacityKWh}"> kWh</span></label>
      <div class="prop-row"><span class="lbl">${I18n.t('ev.timeRemaining')}</span><span class="val" id="evTimeRemaining">${remaining==null?I18n.t('common.unknown'):remaining.toFixed(1)+' h'}</span></div>
      <div class="prop-row"><span class="lbl">${I18n.t('ev.source')}</span><span class="val"><select class="ev-control" id="evSource">${sourceOptions}</select></span></div>
      <label class="ev-setting"><span>${I18n.t('ev.maxPower')}</span><span><input class="ev-control" id="evMaxPower" type="number" min="0" max="7400" step="100" value="${ev.maxPowerW}"> W</span></label>
      <label class="ev-setting"><span>${I18n.t('ev.target')}</span><span><input class="ev-control" id="evTarget" type="number" min="50" max="100" step="5" value="${ev.targetPct}"> %</span></label>
      <label class="ev-setting"><span>${I18n.t('ev.consumption')}</span><span><input class="ev-control" id="evConsumption" type="number" min="8" max="40" step="1" value="${ev.consumptionKWhPer100Km}"> kWh/100 km</span></label>
      <div class="ev-stats"><div><small>${I18n.t('ev.chargedToday')}</small><b id="evChargedToday">${EnergyCalculator.fmtKWh(ev.todayKWh||0)}</b></div><div><small>${I18n.t('ev.chargeCost')}</small><b id="evChargeCost">${EnergyCalculator.fmtCost(ev.todayCostZl||0,settings.currency)}</b></div><div><small>${I18n.t('ev.cost100')}</small><b>${EnergyCalculator.fmtCost(kmCost,settings.currency)}</b></div></div>
      <button class="small-btn" id="evTripBtn">🚗 ${I18n.t('ev.simulateTrip')}</button>
      <div class="ev-note">${I18n.t('ev.dispatchNote')}</div></div>`;
  }
  _bindBatteryControls(inst){
    const save=()=>{
      const b=inst.storage||(inst.storage={});
      b.mode=document.getElementById('batteryMode').value;
      b.maxChargeW=Math.max(0,Math.min(inst.def.maxChargeW,+document.getElementById('batteryMaxCharge').value||0));
      b.maxDischargeW=Math.max(0,Math.min(inst.def.maxDischargeW,+document.getElementById('batteryMaxDischarge').value||0));
      b.reservePct=Math.max(0,Math.min(90,+document.getElementById('batteryReserve').value||0));
      this.simulationEngine._recomputeInstant(false);this.projectManager.pushHistory();this.renderProperties(inst);
    };
    ['batteryMode','batteryMaxCharge','batteryMaxDischarge','batteryReserve'].forEach(id=>document.getElementById(id).addEventListener('change',save));
  }
  _bindEvControls(inst){
    const save=()=>{
      const ev=inst.ev;
      ev.source=document.getElementById('evSource').value;
      ev.capacityKWh=Math.max(20,Math.min(150,+document.getElementById('evCapacity').value||60));
      ev.socKWh=Math.min(ev.socKWh,ev.capacityKWh);
      ev.maxPowerW=Math.max(0,Math.min(7400,+document.getElementById('evMaxPower').value||0));
      ev.targetPct=Math.max(50,Math.min(100,+document.getElementById('evTarget').value||80));
      ev.consumptionKWhPer100Km=Math.max(8,Math.min(40,+document.getElementById('evConsumption').value||18));
      this.simulationEngine._recomputeInstant(false); this.projectManager.pushHistory(); this.renderProperties(inst);
    };
    ['evSource','evCapacity','evMaxPower','evTarget','evConsumption'].forEach(id=>document.getElementById(id).addEventListener('change',save));
    document.getElementById('evTripBtn').addEventListener('click',()=>{
      inst.ev.socKWh=Math.max(0,inst.ev.socKWh-inst.ev.consumptionKWhPer100Km);
      this.simulationEngine._recomputeInstant(false); this.projectManager.pushHistory(); this.renderProperties(inst);
      this.toast(I18n.t('ev.tripComplete',{km:100}));
    });
  }
  _bindDeviceSupply(inst){
    const sel = document.getElementById('propPlugTo'); if (!sel) return;
    sel.addEventListener('change', ev=>{
      if (ev.target.value) this.electrical.plugDevice(inst.id, ev.target.value); else this.electrical.unplugDevice(inst.id);
      this.projectManager.pushHistory(); this._nudgeSim(); this._lastRenderedId = null; this.renderProperties(inst);
    });
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
    const stateEl = document.querySelector('.state-pill');
    if (stateEl) stateEl.innerHTML = `<span class="state-dot" style="background:${this._stateColor(inst.runtime.state)}"></span>${inst.runtime.state}`;
  }

  /** Read-only 24h preview strip for TODAY's specific weekday (editing now lives in the schedule modal - section 3). */
  _renderDaysAndTimeline(inst){
    const tl = document.getElementById('timeline24');
    if (!tl) return;
    tl.innerHTML='';
    const dayIdx = this.simulationEngine.simDay;
    for (let h=0; h<24; h++){
      const at=dayIdx*1440+h*60+30;
      const { state } = inst.ev ? {state:ScheduleManager.activeIntervalAt(inst.schedule,at).active&&inst.ev.socKWh<inst.ev.capacityKWh*inst.ev.targetPct/100?'charging':'off'} : ScheduleManager.resolve(inst,at);
      const seg = document.createElement('div');
      seg.className='tl-seg';
      seg.style.flex='1';
      const isOn = state && state!=='off' && state!=='standby';
      seg.style.background = isOn ? 'var(--accent-good)' : (state==='standby' ? 'var(--accent-power)' : 'rgba(255,255,255,0.06)');
      seg.title = `${h}:00 — ${I18n.deviceState(state)}`;
      tl.appendChild(seg);
    }
  }

  // ============================================================
  // FOOTER — live energy monitor
  // ============================================================
  _bindEnergyMonitor(){
    const monitor=document.getElementById('energyMonitor');
    const toggle=document.getElementById('energyMonitorToggle');
    if(!monitor||!toggle)return;
    toggle.addEventListener('click',()=>{
      const open=monitor.classList.toggle('energy-monitor-open');
      toggle.setAttribute('aria-expanded',String(open));
    });
  }
  _frameTick(dt){
    this.objectManager.updateVisuals(dt);
    const sim = this.simulationEngine;
    document.getElementById('simClock').textContent = sim.clockLabel;
    document.getElementById('emPower').textContent = EnergyCalculator.fmtW(sim.currentPowerW);
    document.getElementById('emPowerCompact').textContent = EnergyCalculator.fmtW(sim.currentPowerW);
    document.getElementById('emGen').textContent = EnergyCalculator.fmtW(sim.currentGenW);
    document.getElementById('emNet').textContent = EnergyCalculator.fmtW(sim.netPowerW);
    document.getElementById('emNet').style.color = sim.netPowerW<0 ? 'var(--accent-good)' : 'var(--accent-power)';
    document.getElementById('emToday').textContent = EnergyCalculator.fmtKWh(sim.todayKWh);
    const s = this.getEnergySettings();
    document.getElementById('emCostToday').textContent = EnergyCalculator.fmtCost(sim.todayCost, s.currency);
    const active = this.objectManager.getDevices().filter(d=>d.runtime.state && d.runtime.state!=='off').length;
    document.getElementById('emActive').textContent = active;
    const selected=this.objectManager.find(this.transformManager.selectedId);
    if(selected&&selected.ev){
      const ev=selected.ev,pct=Math.round(ev.socKWh/ev.capacityKWh*100),fill=document.getElementById('evSocFill');
      if(fill) fill.style.width=pct+'%';
      const label=document.getElementById('evSocLabel'); if(label) label.textContent=`${pct}% · ${ev.socKWh.toFixed(1)} / ${ev.capacityKWh} kWh`;
      const time=document.getElementById('evTimeRemaining');if(time){const w=selected.runtime.powerW||ev.maxPowerW;time.textContent=w>0?Math.max(0,(ev.capacityKWh*ev.targetPct/100-ev.socKWh)/w*60).toFixed(1)+' h':I18n.t('common.unknown');}
      const kwh=document.getElementById('evChargedToday'); if(kwh) kwh.textContent=EnergyCalculator.fmtKWh(ev.todayKWh||0);
      const cost=document.getElementById('evChargeCost'); if(cost) cost.textContent=EnergyCalculator.fmtCost(ev.todayCostZl||0,s.currency);
    }
    if(selected&&selected.kind==='battery'&&selected.storage){const soh=document.getElementById('batterySoh'),temp=document.getElementById('batteryTemp');if(soh)soh.textContent=selected.storage.sohPct.toFixed(1)+'%';if(temp)temp.textContent=selected.storage.temperatureC.toFixed(1)+'°C';}
  }

  _slowTick(){
    const sim = this.simulationEngine;
    this._updateRoomComfort();
    this._updateEducationalFact();
    const proj = this.analyticsManager.projections(sim.todayKWh, sim.todaySolarKWh, sim.todayCost);
    const s = this.getEnergySettings();
    document.getElementById('emCostMonth').textContent = EnergyCalculator.fmtCost(proj.monthCost, s.currency);
    document.getElementById('emCostYear').textContent = EnergyCalculator.fmtCost(proj.yearCost, s.currency);
    document.getElementById('emCO2').textContent = Math.round(proj.co2Year)+' kg';
    const month=sim.monthTotals();
    document.getElementById('emMonthUsage').textContent=EnergyCalculator.fmtKWh(month.consumptionKWh);
    document.getElementById('emGridToday').textContent=EnergyCalculator.fmtKWh(sim.todayImportKWh);
    document.getElementById('emExportToday').textContent=EnergyCalculator.fmtKWh(sim.todayExportKWh);
    document.getElementById('emPriceNow').textContent=EnergyCalculator.priceAt(sim.absMin,s).toFixed(2)+' '+s.currency+'/kWh';
    const battSum = this.analyticsManager.batterySummary(sim);
    const battCard = document.getElementById('emBatteryCard');
    if (battSum.count){
      battCard.classList.remove('hidden');
      document.getElementById('emBattery').textContent = Math.round(battSum.socPct)+'%';
    } else battCard.classList.add('hidden');
    if (!document.getElementById('dashboardModal').classList.contains('hidden')) this.refreshDashboard();
    if (!document.getElementById('challengesModal').classList.contains('hidden')) this._renderChallenges();
    if (!document.getElementById('upgradesModal').classList.contains('hidden')) this._renderUpgrades();
    if (!document.getElementById('auditModal').classList.contains('hidden')) this._renderAudit();
    if (!document.getElementById('reportModal').classList.contains('hidden')) this._renderFinalReport();
    if(this.homeEnergyManager){
      const newAchievements=this.homeEnergyManager.evaluateAchievements();
      for(const id of newAchievements)this._award('energy_'+id,I18n.t('achievement.'+id));
    }
    this._syncChallengeMode();
    this._checkAchievements();
    this._runAdvisor();
    this.questManager.checkMilestones(this._questCtx());
  }
  _updateRoomComfort(){
    const temps=this.simulationEngine.roomTemperatures||{};
    document.querySelectorAll('[data-room-temp]').forEach(el=>{
      const value=temps[el.dataset.roomTemp];
      el.textContent=Number.isFinite(value)?value.toFixed(1)+'°C':'—';
      el.classList.toggle('room-temp-cold',Number.isFinite(value)&&value<18);
      el.classList.toggle('room-temp-hot',Number.isFinite(value)&&value>25);
    });
  }
  _updateEducationalFact(force=false){
    if(this.experienceMode!=='kids')return;
    const el=document.getElementById('kidsDynamicFact');if(!el)return;
    const now=Date.now();if(!force&&this._kidsFactChangedAt&&now-this._kidsFactChangedAt<18000)return;
    if(!force&&this._kidsFactChangedAt)this._kidsFactIndex++;
    const facts=['kids.factSolar','kids.factBattery','kids.factStandby','kids.factHeat','kids.factExport'];
    this._kidsFactIndex=((this._kidsFactIndex%facts.length)+facts.length)%facts.length;
    el.textContent=I18n.t(facts[this._kidsFactIndex]);this._kidsFactChangedAt=now;
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
  _closeAllModals(){
    const welcome=document.getElementById('welcomeModal');
    if(welcome && !welcome.classList.contains('hidden')) this._finishWelcome(false);
    document.querySelectorAll('.modal-backdrop').forEach(m=>m.classList.add('hidden'));
  }

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
        if (t.dataset.tab==='solar') this._renderSolarPane();
        if (t.dataset.tab==='scenarios') this._renderScenariosPane();
        if (t.dataset.tab==='stats') this._renderStatsPane();
        if (t.dataset.tab==='savings') this._renderSavingsPane();
        if (t.dataset.tab==='tariff') this._renderTariffPane();
      });
    });
  }

  async openDashboard(){
    document.getElementById('dashboardModal').classList.remove('hidden');
    try { await this._loadChartLibrary(); }
    catch(e){
      this.toast(I18n.t('experience.chartLoadError'));
      const pane=document.getElementById('paneCharts');
      if(pane&&!document.getElementById('chartLibraryNotice')){
        const notice=document.createElement('p');notice.id='chartLibraryNotice';notice.className='feature-lede';notice.textContent=I18n.t('experience.chartLoadError');pane.prepend(notice);
      }
    }
    this.refreshDashboard();
  }

  _loadChartLibrary(){
    if (window.Chart) return Promise.resolve();
    if (!this.chartLibraryPromise){
      this.chartLibraryPromise = new Promise((resolve, reject)=>{
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
        script.onload = ()=>window.Chart ? resolve() : reject(new Error('Chart.js did not initialize'));
        script.onerror = ()=>reject(new Error('Chart.js failed to load'));
        document.head.appendChild(script);
      }).catch(error=>{ this.chartLibraryPromise = null; throw error; });
    }
    return this.chartLibraryPromise;
  }

  refreshDashboard(){
    const sim = this.simulationEngine;
    const proj = this.analyticsManager.projections(sim.todayKWh, sim.todaySolarKWh, sim.todayCost);
    const s = this.getEnergySettings();
    const inst = this.electrical.costBreakdown();     // one-off wiring cost + its yearly amortisation feed the project economics
    const cards = [
      { key:'power', l:I18n.t('chart.currentPower'), v:EnergyCalculator.fmtW(sim.currentPowerW), cls:'power' },
      { key:'gen', l:I18n.t('footer.pvProduction'), v:'+'+EnergyCalculator.fmtW(sim.currentGenW), cls:'good' },
      { key:'today', l:I18n.t('stats.consumption')+' — '+I18n.t('common.today'), v:EnergyCalculator.fmtKWh(proj.today), cls:null },
      { key:'costToday', l:I18n.t('footer.netCostToday'), v:EnergyCalculator.fmtCost(proj.todayCost,s.currency), cls:proj.todayCost<0?'good':null },
      { key:'month', l:I18n.t('common.month'), v:proj.month.toFixed(1)+' kWh', cls:null },
      { key:'costMonth', l:I18n.t('footer.costMonth'), v:EnergyCalculator.fmtCost(proj.monthCost,s.currency), cls:proj.monthCost<0?'good':null },
      { key:'year', l:I18n.t('common.year')+' ('+I18n.t('common.estimate')+')', v:Math.round(proj.year)+' kWh', cls:null },
      { key:'co2', l:'CO₂ / '+I18n.t('common.year')+' ('+I18n.t('stats.reduction')+')', v:Math.round(proj.co2AvoidedYear)+' kg', cls:'good' },
      { key:'lifetime', l:I18n.t('stats.lifetimeSavings'), v:EnergyCalculator.fmtCost(sim.totalSavedPLN,s.currency), cls:'good' },
      { key:'installCost', l:I18n.t('elec.dash.installCost'), v:EnergyCalculator.fmtCost(inst.totalZl,s.currency), cls:null },
      { key:'projectYear', l:I18n.t('elec.dash.projectYear'), v:EnergyCalculator.fmtCost(proj.yearCost+inst.amortizedPerYearZl,s.currency), cls:null },
    ];
    document.getElementById('dashCards').innerHTML = cards.map(c=>`<div class="dash-card ${c.cls?('dc-'+c.cls):''}" data-key="${c.key}"><div class="dc-label">${c.l}</div><div class="dc-value">${c.v}</div></div>`).join('');
    document.querySelectorAll('#dashCards .dash-card').forEach(el=>{
      el.addEventListener('click', ()=>{
        this._expandedCard = (this._expandedCard===el.dataset.key) ? null : el.dataset.key;
        this._renderCardDetail(proj);
      });
    });
    this._renderCardDetail(proj);

    document.getElementById('tabSolar').classList.toggle('hidden', this.objectManager.getSolar().length===0 && this.objectManager.getBattery().length===0);

    this._renderCharts(proj);
    this._renderRanking();
    this._renderScore();
    if(!document.getElementById('paneTariff').classList.contains('hidden'))this._renderTariffPane();
  }

  _renderTariffPane(){
    const sim=this.simulationEngine,s=this.getEnergySettings(),meta=TariffManager.get(s.tariffCode),schedule=s.tariffSchedules[s.tariffCode]||meta.buildDefaultSchedule(),prices=s.tariffPrices[s.tariffCode]||meta.defaultPrices;
    const values=Array.from({length:24},(_,h)=>({hour:h,price:TariffManager.priceAt(meta,prices,schedule,sim.absMin+h*60),rate:TariffManager.rateAt(meta,schedule,sim.absMin+h*60)}));
    const lo=Math.min(...values.map(x=>x.price)),hi=Math.max(...values.map(x=>x.price)),range=Math.max(.01,hi-lo),current=EnergyCalculator.priceAt(sim.absMin,s);
    const hours=(condition)=>values.filter(x=>Math.abs(x.price-condition)<1e-8).map(x=>`${String(x.hour).padStart(2,'0')}:00`).join(', ')||'—';
    document.getElementById('tariffTimelineInner').innerHTML=`<div class="tariff-live"><div><small>${I18n.t('tariff.priceNow')}</small><b>${current.toFixed(2)} ${s.currency}/kWh</b><span>${s.tariffCode} · ${I18n.t(TariffManager.rateMeta(meta,TariffManager.rateAt(meta,schedule,sim.absMin)).labelKey)}</span></div><div><small>${I18n.t('tariff.cheapestHours')}</small><b>${lo.toFixed(2)} ${s.currency}/kWh</b><span>${hours(lo)}</span></div><div><small>${I18n.t('tariff.expensiveHours')}</small><b>${hi.toFixed(2)} ${s.currency}/kWh</b><span>${hours(hi)}</span></div></div><div class="tariff-price-bars">${values.map(x=>`<div class="tariff-price-col" title="${String(x.hour).padStart(2,'0')}:00 · ${x.price.toFixed(2)} ${s.currency}/kWh"><i style="height:${Math.max(5,(x.price-lo)/range*90+10)}%;background:${x.price===lo?'var(--accent-good)':x.price===hi?'var(--accent-danger)':'var(--accent-power)'}"></i><small>${String(x.hour).padStart(2,'0')}</small></div>`).join('')}</div><p class="feature-lede">${I18n.t('tariff.priceHelp')}</p><button class="small-btn" id="tariffOpenSettings">${I18n.t('settings.tariffSection')}</button>`;
    document.getElementById('tariffOpenSettings').addEventListener('click',()=>{this.openSettings();});
  }

  /** Section 7/20/21: click any dashboard card to expand a full drill-down (today/yesterday/week/
   *  month/year/forecast for that metric) - "ogólne informacje → szczegóły" without leaving the page. */
  _renderCardDetail(proj){
    const box = document.getElementById('dashCardDetail');
    document.querySelectorAll('#dashCards .dash-card').forEach(el=>el.classList.toggle('expanded', el.dataset.key===this._expandedCard));
    if (!this._expandedCard){ box.classList.add('hidden'); box.innerHTML=''; return; }
    const sim = this.simulationEngine; const s = this.getEnergySettings();
    const yb = this.analyticsManager.yearBreakdown();
    const y = sim.simDate.getFullYear();
    const rows = (label, val)=>`<div class="cd-row"><span>${label}</span><b>${val}</b></div>`;
    let title='', body='';
    const key = this._expandedCard;
    if (key==='today' || key==='costToday' || key==='power'){
      const bd = this.analyticsManager.breakdownToday(sim);
      title = I18n.t('stats.consumption');
      body = rows(I18n.t('stats.today'), EnergyCalculator.fmtKWh(sim.todayKWh))
        + rows(I18n.t('stats.yesterday'), sim.lastCompletedDay?EnergyCalculator.fmtKWh(sim.lastCompletedDay.consumedKWh):'—')
        + rows(I18n.t('stats.thisWeek'), EnergyCalculator.fmtKWh(proj.week))
        + rows(I18n.t('stats.thisMonth'), EnergyCalculator.fmtKWh(proj.month))
        + rows(I18n.t('stats.yearForecast'), EnergyCalculator.fmtKWh(proj.year))
        + `<div class="cd-sub">${I18n.t('stats.byCategory')}</div>`
        + bd.byCategory.slice(0,6).map(c=>rows(c.label, `${EnergyCalculator.fmtKWh(c.kWh)} (${c.pct.toFixed(0)}%)`)).join('');
    } else if (key==='gen'){
      const solar = this.analyticsManager.solarSummary();
      title = I18n.t('panel.pv');
      body = rows(I18n.t('stats.today'), EnergyCalculator.fmtKWh(sim.todaySolarKWh))
        + rows(I18n.t('stats.yesterday'), sim.lastCompletedDay?EnergyCalculator.fmtKWh(sim.lastCompletedDay.solarKWh):'—')
        + rows(I18n.t('stats.thisWeek'), EnergyCalculator.fmtKWh(proj.weekGen))
        + rows(I18n.t('stats.thisMonth'), EnergyCalculator.fmtKWh(solar.monthGenKWh))
        + rows(I18n.t('stats.thisYear'), EnergyCalculator.fmtKWh(solar.yearGenKWh))
        + rows(I18n.t('pv.panelCount'), solar.count)
        + rows(I18n.t('pv.totalPower'), EnergyCalculator.fmtW(solar.totalPeakW));
    } else if (key==='month' || key==='costMonth'){
      title = I18n.t('common.month');
      body = rows(I18n.t('stats.thisMonth'), EnergyCalculator.fmtKWh(proj.month))
        + rows(I18n.t('footer.costMonth'), EnergyCalculator.fmtCost(proj.monthCost, s.currency))
        + rows(I18n.t('stats.thisYear')+' ('+I18n.t('common.estimate')+')', EnergyCalculator.fmtKWh(proj.year))
        + rows(I18n.t('footer.costYear'), EnergyCalculator.fmtCost(proj.yearCost, s.currency));
    } else if (key==='year' || key==='co2'){
      title = `${I18n.t('common.year')} ${y}`;
      body = yb.months.map(mo=>rows(`${mo.label}${mo.isProjected?' ('+I18n.t('common.estimate')+')':''}`, EnergyCalculator.fmtKWh(mo.consumedKWh))).join('');
    } else if (key==='installCost' || key==='projectYear'){
      const ic = this.electrical.costBreakdown();
      title = I18n.t('elec.dash.economics');
      body = rows(I18n.t('elec.dash.energyYear'), EnergyCalculator.fmtCost(proj.yearCost, s.currency))
        + rows(I18n.t('elec.dash.installAmortized', { years: ELECTRICAL_CONSTANTS.designLifeYears }), EnergyCalculator.fmtCost(ic.amortizedPerYearZl, s.currency))
        + rows(I18n.t('elec.dash.projectYear'), EnergyCalculator.fmtCost(proj.yearCost + ic.amortizedPerYearZl, s.currency))
        + rows(I18n.t('elec.dash.installCost'), EnergyCalculator.fmtCost(ic.totalZl, s.currency))
        + rows(I18n.t('elec.dash.cableLength'), I18n.num(ic.cableM, 1) + ' m')
        + rows(I18n.t('elec.dash.lossesToday'), EnergyCalculator.fmtKWh(sim.todayLossKWh || 0));
    } else if (key==='lifetime'){
      title = I18n.t('stats.lifetimeSavings');
      body = rows(I18n.t('common.since'), EnergyCalculator.fmtCost(sim.totalSavedPLN, s.currency))
        + rows(I18n.t('stats.gridImport'), EnergyCalculator.fmtKWh(sim.totalImportKWh))
        + rows(I18n.t('stats.gridExport'), EnergyCalculator.fmtKWh(sim.totalExportKWh));
    }
    box.innerHTML = `<h4>${title} — ${I18n.t('common.details')}</h4>${body}`;
    box.classList.remove('hidden');
  }

  _chart(id, config){
    if (this.charts[id]) this.charts[id].destroy();
    const ctx = document.getElementById(id).getContext('2d');
    this.charts[id] = new Chart(ctx, config);
  }

  _renderCharts(proj){
    if(typeof Chart==='undefined')return;
    const notice=document.getElementById('chartLibraryNotice');if(notice)notice.remove();
    const gridColor='rgba(255,255,255,0.06)', textColor='#9aa7b8';
    Chart.defaults.color = textColor; Chart.defaults.borderColor = gridColor;
    Chart.defaults.font.family = "'Inter', sans-serif";
    const sim = this.simulationEngine;
    const s = this.getEnergySettings();

    this._chart('chartPowerOverTime', { type:'line', data:{
      labels: sim.powerHistory.map(p=>ScheduleManager.fromMinutes(p.absMin%1440)),
      datasets:[
        { label:I18n.t('chart.consumptionW'), data: sim.powerHistory.map(p=>p.watts), borderColor:'#ffb648', backgroundColor:'rgba(255,182,72,0.12)', fill:true, tension:0.3, pointRadius:0 },
        { label:I18n.t('chart.pvProductionW'), data: sim.powerHistory.map(p=>p.genWatts||0), borderColor:'#34d399', backgroundColor:'rgba(52,211,153,0.10)', fill:true, tension:0.3, pointRadius:0 },
      ]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:I18n.t('chart.powerOverTime'),color:'#e8edf4'}} }});

    const dayBase0 = sim.absMin - sim.minuteOfDay;
    const hourColors = [...Array(24).keys()].map(h=> EnergyCalculator.isCheapRateAt(dayBase0+h*60, s) ? 'rgba(79,209,197,0.85)' : (EnergyCalculator.isExpensiveRateAt(dayBase0+h*60,s) ? 'rgba(255,107,107,0.75)' : 'rgba(255,182,72,0.8)'));
    this._chart('chartEnergyByHour', { type:'bar', data:{
      labels:[...Array(24).keys()].map(h=>h+':00'),
      datasets:[{ label:I18n.t('chart.hourlyEnergy'), data: sim.hourlyKWh, backgroundColor:hourColors }]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:I18n.t('chart.energyByHour'),color:'#e8edf4'}} }});

    const rows = this.analyticsManager.ranking();
    this._chart('chartEnergyByDevice', { type:'doughnut', data:{
      labels: rows.slice(0,8).map(r=>r.name),
      datasets:[{ data: rows.slice(0,8).map(r=>r.dailyKWh), backgroundColor:['#ffb648','#4fd1c5','#9b7bff','#34d399','#ff6b6b','#67c8ff','#f2c14e','#d693ff'] }]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:I18n.t('chart.energyByDevice'),color:'#e8edf4'},legend:{position:'right',labels:{boxWidth:10,font:{size:10}}}} }});

    const wk = proj.weekProjection;
    this._chart('chartCostOverTime', { type:'line', data:{
      labels:[1,2,3,4,5,6,0].map(d=>I18n.dayShort(d)),
      datasets:[{ label:I18n.t('chart.dailyNetCost'), data:[1,2,3,4,5,6,0].map(d=>wk.perWeekdayCost[d]), borderColor:'#4fd1c5', backgroundColor:'rgba(79,209,197,0.12)', fill:true, tension:0.3 }]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:I18n.t('chart.costOverTime'),color:'#e8edf4'}} }});

    const todayShape = this.analyticsManager.computeHourlyShape(sim.simDay);
    const otherDay = (sim.simDay+1)%7;
    const otherShape = this.analyticsManager.computeHourlyShape(otherDay);
    const dayNames=[0,1,2,3,4,5,6].map(d=>I18n.dayShort(d));
    this._chart('chartDailyComparison', { type:'bar', data:{
      labels:[...Array(24).keys()],
      datasets:[
        { label:dayNames[sim.simDay]+' ('+I18n.t('chart.todaySuffix')+')', data:todayShape.hours, backgroundColor:'#ffb648' },
        { label:dayNames[otherDay], data:otherShape.hours, backgroundColor:'#4fd1c5' },
      ]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:I18n.t('chart.dailyComparison'),color:'#e8edf4'}} }});

    this._chart('chartWeekly', { type:'bar', data:{
      labels:[0,1,2,3,4,5,6].map(d=>I18n.dayShort(d)),
      datasets:[
        { label:I18n.t('chart.consumptionKWh'), data:wk.perWeekdayTotal, backgroundColor:'#9b7bff' },
        { label:I18n.t('chart.generationKWh'), data:wk.perWeekdayGen, backgroundColor:'#34d399' },
      ]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:I18n.t('chart.weeklyComparison'),color:'#e8edf4'}} }});

    const months=[0,1,2,3,4,5,6,7,8,9,10,11].map(m=>I18n.t('monthshort.'+m));
    this._chart('chartMonthly', { type:'bar', data:{
      labels:months,
      datasets:[{ label:I18n.t('chart.monthlyNetProjection'), data:months.map(()=>proj.month-proj.monthGen), backgroundColor:'#34d399' }]
    }, options:{ responsive:true, maintainAspectRatio:false, plugins:{title:{display:true,text:I18n.t('chart.monthlyProjection'),color:'#e8edf4'}} }});

    const flowHistory=sim.powerHistory,flowLabels=flowHistory.map(p=>this._historyLabel(p.absMin));
    this._chart('chartPvOutput',{type:'line',data:{labels:flowLabels,datasets:[{label:I18n.t('chart.pvProductionW'),data:flowHistory.map(p=>p.genWatts||0),borderColor:'#f6c453',backgroundColor:'rgba(246,196,83,.12)',fill:true,tension:.25,pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{title:{display:true,text:I18n.t('chart.pvProductionW'),color:'#e8edf4'}}}});
    this._chart('chartGridFlow',{type:'line',data:{labels:flowLabels,datasets:[{label:I18n.t('chart.gridImportW'),data:flowHistory.map(p=>p.gridWatts||0),borderColor:'#61a8ff',tension:.25,pointRadius:0},{label:I18n.t('chart.gridExportW'),data:flowHistory.map(p=>p.exportWatts||0),borderColor:'#4fd1c5',tension:.25,pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{title:{display:true,text:I18n.t('chart.gridImportW'),color:'#e8edf4'}}}});
    this._chart('chartBatteryFlow',{type:'line',data:{labels:flowLabels,datasets:[{label:I18n.t('chart.batteryFlowW'),data:flowHistory.map(p=>p.batteryWatts||0),borderColor:'#b79aff',backgroundColor:'rgba(183,154,255,.12)',fill:true,tension:.25,pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{title:{display:true,text:I18n.t('chart.batteryFlowW'),color:'#e8edf4'}}}});
  }
  _historyLabel(absMin){const minute=((absMin%1440)+1440)%1440;return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;}

  _renderRanking(){
    const rows = this.analyticsManager.ranking();
    const top5 = rows.slice(0,5);
    document.getElementById('top5Ranking').innerHTML = top5.map((r,i)=>`
      <div class="top5-item"><div class="top5-rank">#${i+1}</div><div class="top5-name">${r.name}</div>
      <div class="top5-pct">${I18n.t('ui.pctOfTotalUse', { pct: r.pct.toFixed(0) })}</div></div>`).join('') || '<div style="color:var(--text-3)">' + I18n.t('ui.no_devices_in_the_scene') + '</div>';
    const s = this.getEnergySettings();
    const tbody = document.querySelector('#rankingTable tbody');
    tbody.innerHTML = rows.map(r=>`<tr class="rank-row" data-id="${r.inst.id}">
      <td>${r.name}</td><td>${EnergyCalculator.fmtW(r.currentPowerW)}</td>
      <td>${r.dailyKWh.toFixed(2)}</td><td>${r.monthlyKWh.toFixed(1)}</td>
      <td>${EnergyCalculator.fmtCost(r.monthlyCost,s.currency)}</td><td>${r.pct.toFixed(1)}%</td></tr>`).join('');
    tbody.querySelectorAll('.rank-row').forEach(tr=>{
      tr.addEventListener('click', ()=>{
        const inst = this.objectManager.find(tr.dataset.id);
        if (!inst) return;
        document.getElementById('dashboardModal').classList.add('hidden');
        if (inst.roomId !== this.getHouseState().activeRoomId) this.setActiveRoom(inst.roomId);
        this.transformManager.select(inst.id);
        this.sceneManager.focusOn(inst.group);
      });
    });
  }

  _renderScore(){
    const sc = this.analyticsManager.energyScore();
    const hc = this.analyticsManager.householdComparison(this.simulationEngine.todayKWh);
    const s = this.getEnergySettings();
    document.getElementById('scorePanel').innerHTML = `
      <div class="score-circle" style="--pct:${sc.score}">
        <div class="inner"><div class="score-num">${sc.score}</div><div class="score-grade">Klasa ${sc.grade}</div></div>
      </div>
      <div class="score-info">
        <div class="si-row"><div class="si-label">${I18n.t('ui.biggest_problem')}</div><div class="si-text">${sc.biggestProblem}</div></div>
        <div class="si-row"><div class="si-label">${I18n.t('ui.biggest_saving_opportunity')}</div><div class="si-text">${sc.biggestOpportunity}</div></div>
      </div>
      <div class="household-compare">
        <div class="si-label">${I18n.t('ui.compared_to_the_average_polish_hou')}</div>
        <div class="hc-bars">
          <div class="hc-bar-row"><span class="hc-bar-lbl">${I18n.t('ui.your_home')}</span><div class="hc-bar-track"><div class="hc-bar-fill ${hc.isBetter?'good':'bad'}" style="width:${Math.min(100,(hc.userYearKWh/Math.max(hc.userYearKWh,hc.refKWh))*100)}%"></div></div><span class="hc-bar-val">${Math.round(hc.userYearKWh)} kWh/rok</span></div>
          <div class="hc-bar-row"><span class="hc-bar-lbl">${I18n.t('ui.pl_average')}</span><div class="hc-bar-track"><div class="hc-bar-fill ref" style="width:${Math.min(100,(hc.refKWh/Math.max(hc.userYearKWh,hc.refKWh))*100)}%"></div></div><span class="hc-bar-val">${Math.round(hc.refKWh)} kWh/rok</span></div>
        </div>
        <div class="si-text" style="margin-top:8px">${hc.isBetter
          ? I18n.t('ui.hhLess', { pct: Math.abs(hc.pctDiff).toFixed(0), cost: EnergyCalculator.fmtCost(Math.abs(hc.costDiff),s.currency), col:'var(--accent-good)' })
          : I18n.t('ui.hhMore', { pct: Math.abs(hc.pctDiff).toFixed(0), cost: EnergyCalculator.fmtCost(Math.abs(hc.costDiff),s.currency), col:'var(--accent-power)' })}</div>
        <div style="font-size:10.5px;color:var(--text-3);margin-top:6px">${I18n.t('ui.hhRefNote', { kwh: Math.round(hc.refKWh) })}</div>
      </div>`;
  }

  _renderSolarPane(){
    const pane = document.getElementById('paneSolar');
    const sum = this.analyticsManager.solarSummary();
    const batt = this.analyticsManager.batterySummary(this.simulationEngine);
    const s = this.getEnergySettings();
    if (!sum.count && !batt.count){ pane.innerHTML = '<div style="color:var(--text-3)">' + I18n.t('ui.noPvNoBattery') + '</div>'; return; }
    let html = '';
    if (sum.count){
      html += `
      <h4 style="font-family:var(--font-display);font-size:12px;color:var(--text-3);text-transform:uppercase;margin-bottom:10px">${I18n.t('ui.photovoltaics')}</h4>
      <div class="wi-result" style="margin-bottom:18px">
        <div class="wi-box"><div class="lbl">${I18n.t('ui.number_of_panels')}</div><div class="wv">${sum.count}</div></div>
        <div class="wi-box"><div class="lbl">${I18n.t('ui.installed_power')}</div><div class="wv">${(sum.totalPeakW/1000).toFixed(2)} kWp</div></div>
        <div class="wi-box"><div class="lbl">${I18n.t('ui.production_today_proj')}</div><div class="wv" style="color:var(--accent-good)">${sum.todayGenKWh.toFixed(1)} kWh</div></div>
        <div class="wi-box"><div class="lbl">${I18n.t('ui.credit_year_net_metering')}</div><div class="wv" style="color:var(--accent-good)">${EnergyCalculator.fmtCost(sum.yearCredit,s.currency)}</div></div>
      </div>`;
    }
    if (batt.count){
      html += `
      <h4 style="font-family:var(--font-display);font-size:12px;color:var(--text-3);text-transform:uppercase;margin-bottom:10px">${I18n.t('ui.energy_storage')}</h4>
      <div class="wi-result" style="margin-bottom:18px">
        <div class="wi-box"><div class="lbl">${I18n.t('ui.number_of_storages')}</div><div class="wv">${batt.count}</div></div>
        <div class="wi-box"><div class="lbl">${I18n.t('ui.total_capacity')}</div><div class="wv">${batt.totalCapKWh.toFixed(1)} kWh</div></div>
        <div class="wi-box"><div class="lbl">${I18n.t('ui.charge_now')}</div><div class="wv">${batt.socPct.toFixed(0)}%</div></div>
        <div class="wi-box"><div class="lbl">${I18n.t('ui.charged_discharged_today')}</div><div class="wv">${batt.todayChargeKWh.toFixed(1)} / ${batt.todayDischargeKWh.toFixed(1)} kWh</div></div>
      </div>`;
    }
    html += `<div style="font-size:12px;color:var(--text-3)">${I18n.t('ui.pvModelNote')}</div>`;
    pane.innerHTML = html;
  }

  _renderScenariosPane(){
    const pane = document.getElementById('scenariosPanel');
    const s = this.getEnergySettings();
    const snapshotBtn = (slot)=>`<button class="primary-btn" data-snap="${slot}">💾 Zapisz jako Scenariusz ${slot}</button>`;
    const card = (slot)=>{
      const sc = this.scenarios[slot];
      if (!sc) return `<div class="scenario-card empty"><div class="sc-title">Scenariusz ${slot}</div><div style="color:var(--text-3);font-size:12px;margin:10px 0">${I18n.t('ui.nothing_saved_yet_set_up_the_house')}</div>${snapshotBtn(slot)}</div>`;
      return `<div class="scenario-card">
        <div class="sc-title">${sc.label}</div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.devices_pv_storage')}</span><span class="val">${sc.deviceCount} / ${sc.solarCount} / ${sc.batteryCount}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.consumption_mo')}</span><span class="val">${sc.monthKWh.toFixed(1)} kWh</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.cost_mo')}</span><span class="val">${EnergyCalculator.fmtCost(sc.monthCost,s.currency)}</span></div>
        <div class="prop-row"><span class="lbl">${I18n.t('ui.cost_year')}</span><span class="val">${EnergyCalculator.fmtCost(sc.yearCost,s.currency)}</span></div>
        ${snapshotBtn(slot)}
      </div>`;
    };
    let html = `<div class="scenario-grid">${card('A')}${card('B')}</div>`;
    if (this.scenarios.A && this.scenarios.B){
      const a = this.scenarios.A, b = this.scenarios.B;
      const deltaMonth = a.monthCost - b.monthCost; // positive = B is cheaper
      const deltaYear = a.yearCost - b.yearCost;
      const cheaper = deltaMonth>0 ? 'B' : deltaMonth<0 ? 'A' : null;
      html += `<div class="scenario-result">
        <div class="si-label">${I18n.t('ui.comparison')}</div>
        <div class="si-text">${cheaper ? I18n.t('ui.scenCheaper', { s: cheaper, month: EnergyCalculator.fmtCost(Math.abs(deltaMonth),s.currency), year: EnergyCalculator.fmtCost(Math.abs(deltaYear),s.currency) }) : I18n.t('ui.scenSame')}</div>
      </div>`;
    }
    pane.innerHTML = html;
    pane.querySelectorAll('[data-snap]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const slot = btn.dataset.snap;
        const proj = this.analyticsManager.projections(this.simulationEngine.todayKWh, this.simulationEngine.todaySolarKWh, this.simulationEngine.todayCost);
        const defaultLabel = `Scenariusz ${slot} — ${new Date().toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}`;
        const label = prompt(I18n.t('msg.scenarioNamePrompt'), defaultLabel) || defaultLabel;
        this.scenarios[slot] = {
          label, monthKWh: proj.month, monthCost: proj.monthCost, yearCost: proj.yearCost,
          deviceCount: this.objectManager.getDevices().length,
          solarCount: this.objectManager.getSolar().length,
          batteryCount: this.objectManager.getBattery().length,
        };
        this._renderScenariosPane();
        this.log(I18n.t('log.scenarioSaved', { label }));
      });
    });
  }

  _renderWhatIf(){
    const devices = this.objectManager.getDevices();
    const pane = document.getElementById('whatifPanel');
    if (!devices.length){ pane.innerHTML='<div style="color:var(--text-3)">' + I18n.t('ui.add_devices_to_run_the_analysis') + '</div>'; return; }
    pane.innerHTML = `
      <div class="wi-row">
        <select class="std-select" id="wiDevice">${devices.map(d=>`<option value="${d.id}">${d.customName||d.def.name}</option>`).join('')}</select>
        <span style="color:var(--text-2);font-size:12px">${I18n.t('ui.power_run_time_scale')}</span>
        <input type="range" id="wiScale" min="0.2" max="1.5" step="0.05" value="1" style="width:160px">
        <span id="wiScaleLabel" style="font-family:var(--font-mono)">100%</span>
        <button class="primary-btn" id="wiRun">${I18n.t('ui.calculate')}</button>
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
        <div class="wi-box"><div class="lbl">${I18n.t('ui.before')}</div><div class="wv">${res.beforeMonthKWh.toFixed(1)} kWh</div></div>
        <div class="wi-box"><div class="lbl">${I18n.t('ui.after')}</div><div class="wv">${res.afterMonthKWh.toFixed(1)} kWh</div></div>
        <div class="wi-box"><div class="lbl">${I18n.t('ui.savingMonth')}</div><div class="wv" style="color:var(--accent-good)">${res.savingKWh.toFixed(1)} kWh · ${EnergyCalculator.fmtCost(res.savingCost,s.currency)}</div></div>
        <div class="wi-box"><div class="lbl">${I18n.t('ui.savingYear')}</div><div class="wv" style="color:var(--accent-good)">${EnergyCalculator.fmtCost(res.savingYearCost,s.currency)}</div></div>`;
      if (res.savingKWh>0) this._checkAchievements();
    });
  }

  _renderCompare(){
    const pane = document.getElementById('comparePanel');
    this._compareSubTab = this._compareSubTab || 'devices';
    pane.innerHTML = `
      <div class="sub-tabs">
        <button class="sub-tab ${this._compareSubTab==='devices'?'active':''}" data-sub="devices">${I18n.t('stats.compareDevices')}</button>
        <button class="sub-tab ${this._compareSubTab==='periods'?'active':''}" data-sub="periods">${I18n.t('stats.comparePeriod')}</button>
        <button class="sub-tab ${this._compareSubTab==='beforeAfter'?'active':''}" data-sub="beforeAfter">${I18n.t('compare.beforeAfter')}</button>
      </div>
      <div id="compareSubBody"></div>`;
    pane.querySelectorAll('.sub-tab').forEach(b=>{
      b.addEventListener('click', ()=>{ this._compareSubTab=b.dataset.sub; this._renderCompare(); });
    });
    if (this._compareSubTab==='periods') this._renderComparePeriods();
    else if(this._compareSubTab==='beforeAfter')this._renderCompareBeforeAfter();
    else this._renderCompareDevices();
  }

  _compareSnapshot(){
    const sim=this.simulationEngine,monthly=this.analyticsManager.projections(sim.todayKWh,sim.todaySolarKWh,sim.todayCost);
    const solar=sim.todaySolarKWh||0;
    return {capturedAt:new Date().toISOString(),simAbsMin:sim.absMin,consumptionKWh:sim.todayKWh||0,costZl:sim.todayCost||0,projectedMonthCostZl:monthly.monthCost||0,solarKWh:solar,solarSelfUsePct:solar>0?Math.max(0,(solar-(sim.todayExportKWh||0))/solar*100):0,comfortPct:sim.comfortPct??100};
  }
  _compareBaselineKey(){return 'energyroom3d_compare_baseline:'+encodeURIComponent(this.projectManager.projectName||'home');}
  _renderCompareBeforeAfter(){
    const pane=document.getElementById('compareSubBody'),key=this._compareBaselineKey();
    let baseline=null;try{baseline=JSON.parse(localStorage.getItem(key)||'null');}catch(e){}
    const current=this._compareSnapshot();
    const controls=`<div class="compare-baseline-actions"><button class="primary-btn" id="compareCapture">${I18n.t('compare.capture')}</button>${baseline?`<button class="small-btn" id="compareClear">${I18n.t('compare.clear')}</button>`:''}</div><p class="feature-lede">${I18n.t('compare.hint')}</p>`;
    if(!baseline){pane.innerHTML=controls+`<div class="pet-empty-note">${I18n.t('compare.noBaseline')}</div>`;}
    else{
      const fmt=(n,d=1)=>Number(n||0).toFixed(d),rows=[
        ['stats.consumption',baseline.consumptionKWh,current.consumptionKWh,' kWh'],['stats.cost',baseline.costZl,current.costZl,' '+this.getEnergySettings().currency],['compare.monthCost',baseline.projectedMonthCostZl,current.projectedMonthCostZl,' '+this.getEnergySettings().currency],['stats.production',baseline.solarKWh,current.solarKWh,' kWh'],['compare.selfUse',baseline.solarSelfUsePct,current.solarSelfUsePct,'%'],['report.comfort',baseline.comfortPct,current.comfortPct,'%']
      ];
      pane.innerHTML=controls+`<p class="compare-captured">${I18n.t('compare.captured')}: ${new Date(baseline.capturedAt).toLocaleString(I18n.lang==='pl'?'pl-PL':'en-GB')}</p><table class="data-table"><thead><tr><th>${I18n.t('compare.metric')}</th><th>${I18n.t('compare.before')}</th><th>${I18n.t('compare.after')}</th><th>${I18n.t('compare.change')}</th></tr></thead><tbody>${rows.map(([key,a,b,suffix])=>{const delta=b-a,better=['stats.consumption','stats.cost','compare.monthCost'].includes(key)?delta<=0:delta>=0;return `<tr><td>${I18n.t(key)}</td><td>${fmt(a)}${suffix}</td><td>${fmt(b)}${suffix}</td><td style="color:${better?'var(--accent-good)':'var(--accent-danger)'}">${delta>0?'+':''}${fmt(delta)}${suffix}</td></tr>`;}).join('')}</tbody></table>`;
    }
    document.getElementById('compareCapture').addEventListener('click',()=>{try{localStorage.setItem(key,JSON.stringify(this._compareSnapshot()));}catch(e){}this._renderCompareBeforeAfter();this.toast(I18n.t('compare.saved'));});
    const clear=document.getElementById('compareClear');if(clear)clear.addEventListener('click',()=>{localStorage.removeItem(key);this._renderCompareBeforeAfter();});
  }

  _renderCompareDevices(){
    const pane = document.getElementById('compareSubBody');
    const devices = this.objectManager.getDevices();
    if (devices.length<2){ pane.innerHTML='<div style="color:var(--text-3)">' + I18n.t('ui.add_at_least_two_devices_to_compar') + '</div>'; return; }
    const a = this.compareSelection[0] || devices[0].id;
    const b = this.compareSelection[1] || devices[1].id;
    pane.innerHTML = `
      <div class="wi-row">
        <select class="std-select" id="cmpA">${devices.map(d=>`<option value="${d.id}" ${d.id===a?'selected':''}>${d.customName||I18n.deviceName(d.def)}</option>`).join('')}</select>
        vs
        <select class="std-select" id="cmpB">${devices.map(d=>`<option value="${d.id}" ${d.id===b?'selected':''}>${d.customName||I18n.deviceName(d.def)}</option>`).join('')}</select>
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
      if (this.petManager.hasFeature('compare_overlay')){
        const hh = this.analyticsManager.householdComparison();
        rowsHtml.push([I18n.t('ui.pctOfAvgHousehold'), (c.a.monthlyKWh*12/hh.refKWh*100).toFixed(0)+'%', (c.b.monthlyKWh*12/hh.refKWh*100).toFixed(0)+'%']);
      }
      document.getElementById('cmpTable').innerHTML = `<thead><tr><th></th><th>${c.a.name}</th><th>${c.b.name}</th></tr></thead>
        <tbody>${rowsHtml.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody>`;
    };
    document.getElementById('cmpA').addEventListener('change', run);
    document.getElementById('cmpB').addEventListener('change', run);
    run();
  }

  /** Section 23: real period-over-period comparison, built only from actually-simulated
   *  history (AnalyticsManager.comparePeriods) - never fabricated when there isn't enough
   *  played history yet, which is stated plainly instead of faked. */
  _renderComparePeriods(){
    const pane = document.getElementById('compareSubBody');
    const s = this.getEnergySettings();
    this._periodRange = this._periodRange || 'month';
    const cmp = this.analyticsManager.comparePeriods(this._periodRange);
    const rangeLabel = this._periodRange==='week' ? I18n.t('common.week') : I18n.t('common.month');
    let body;
    if (cmp.insufficientData){
      body = `<div class="pet-empty-note">${I18n.lang==='pl'
        ? I18n.t('ui.notEnoughHistory', { days: I18n.plural('unit.simDay', cmp.needDays||30) })
        : `Not enough played history yet to compare full periods (need at least ${cmp.needDays||30} simulated days). Speed up time or come back later.`}</div>`;
    } else if (!cmp.hasPrevious){
      body = `<div class="pet-empty-note">${I18n.t('ui.firstPeriod')}</div>`;
    } else {
      const fmtPct = (p)=> p==null ? '—' : (p>=0?'+':'')+p.toFixed(1)+'%';
      const rows = [
        [I18n.t('stats.consumption'), EnergyCalculator.fmtKWh(cmp.previous.consumedKWh), EnergyCalculator.fmtKWh(cmp.current.consumedKWh), fmtPct(cmp.changeConsumedPct)],
        [I18n.t('stats.cost'), EnergyCalculator.fmtCost(cmp.previous.cost,s.currency), EnergyCalculator.fmtCost(cmp.current.cost,s.currency), fmtPct(cmp.changeCostPct)],
        [I18n.t('stats.production'), EnergyCalculator.fmtKWh(cmp.previous.solarKWh), EnergyCalculator.fmtKWh(cmp.current.solarKWh), fmtPct(cmp.changeSolarPct)],
      ];
      body = `<table class="data-table"><thead><tr><th></th><th>${I18n.t('stats.previousPeriod')}</th><th>${I18n.t('stats.currentPeriod')}</th><th>${I18n.t('stats.change')}</th></tr></thead>
        <tbody>${rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td style="color:${parseFloat(r[3])>0?'var(--accent-danger)':'var(--accent-good)'}">${r[3]}</td></tr>`).join('')}</tbody></table>`;
    }
    pane.innerHTML = `
      <div class="wi-row">
        <select class="std-select" id="periodRangeSel">
          <option value="week" ${this._periodRange==='week'?'selected':''}>${I18n.t('common.week')}</option>
          <option value="month" ${this._periodRange==='month'?'selected':''}>${I18n.t('common.month')}</option>
        </select>
      </div>
      ${body}`;
    document.getElementById('periodRangeSel').addEventListener('change', (e)=>{ this._periodRange=e.target.value; this._renderComparePeriods(); });
  }

  // ============================================================
  // ROOM SETTINGS (multi-room aware)
  // ============================================================
  _bindRoomSettings(){}

  /** Adds a new room of `type` to the right of the existing layout and makes it active.
   *  Only 'garage' gets special geometry (door+roof) in RoomBuilder - every other type,
   *  including these, is a standard rectangular room told apart by icon/defaults/onlyIn. */
  _addRoom(type, levelId){
    const house = this.getHouseState();
    const meta = getRoomTypeMeta(type);
    const countSameType = house.rooms.filter(r=>r.type===type).length;
    const name = countSameType>0 ? `${I18n.roomType(type)} ${countSameType+1}` : I18n.roomType(type);
    const id = 'room_' + Date.now().toString(36) + Math.floor(Math.random()*1000).toString(36);
    const room = { id, name, type, settings:{...meta.defaults}, offsetX:0, offsetZ:0, levelId: levelId || house.activeLevelId || house.levels[0].id };
    BuildingModel.ensureRoom(room);
    BuildingModel.placeNewRoom(house, room);          // next to the others, or stacked on a free spot of another storey
    house.rooms.push(room);
    house.activeRoomId = id; house.activeLevelId = room.levelId;
    this.setHouseState(house);
    this.rebuildHouse();
    // a new room gets real sockets on a socket circuit, wired to the switchboard, like every other room
    this.electrical.ensureRoom({ id, name, type, offsetX:room.offsetX, offsetZ:room.offsetZ, elevation:BuildingModel.elevation(house, room), width:room.settings.width, length:room.settings.length, height:room.settings.height });
    this.electrical.autoWire(); this.wireRenderer.markDirty();
    this.projectManager.pushHistory();
    this.renderRoomTabs();
    this.toast(`${meta.icon} ${I18n.t('log.roomAdded', { name })}`);
    this.log(I18n.t('log.roomAddedType', { name, type: I18n.roomType(type) }));
    if (this.designer) this.designer.render();
    return room;
  }

  /** Removes a room and everything placed inside it (ObjectManager.removeRoomGroup),
   *  then re-packs the remaining rooms left-to-right so there's no gap. Like any other
   *  committing change this goes through pushHistory, so Ctrl+Z can bring it back. */
  _removeRoom(roomId){
    const house = this.getHouseState();
    if (house.rooms.length<=1){ this.toast(I18n.t('msg.needOneRoom')); return; }
    const room = house.rooms.find(r=>r.id===roomId);
    if (!room) return;
    const objCount = this.objectManager.getAll(roomId).length;
    const warn = objCount>0 ? ' ' + I18n.t('msg.withObjects', { objects: I18n.plural('unit.object', objCount) }) : '';
    if (!confirm(I18n.t('msg.confirmDeleteRoom', { name: room.name, warn }))) return;
    house.rooms = house.rooms.filter(r=>r.id!==roomId);
    BuildingModel.autoLayout(house);                    // re-pack (only while the layout is still the automatic one)
    house.stairs = house.stairs.filter(s=>s.roomId!==roomId);
    if (house.activeRoomId === roomId){ house.activeRoomId = house.rooms[0].id; house.activeLevelId = house.rooms[0].levelId; }
    this.electrical.dropRoomCircuits(roomId);           // circuits that only served this room disappear with it
    this.objectManager.removeRoomGroup(roomId);
    this.electrical.prune(); this.wireRenderer.markDirty();
    this.setHouseState(house);
    this.rebuildHouse();
    this.projectManager.pushHistory();
    this.renderRoomTabs();
    this.log(I18n.t('log.roomRemoved', { name: room.name }));
    this.toast(I18n.t('log.roomRemoved', { name: room.name }));
  }

  openRoomSettings(){
    const house = this.getHouseState();
    const body = document.getElementById('roomSettingsBody');
    const renderFor = (roomId)=>{
      const house2 = this.getHouseState();
      const room = house2.rooms.find(r=>r.id===roomId) || house2.rooms[0];
      const rs = room.settings;
      body.innerHTML = `
        <div class="rooms-list" id="rsRoomPicker">${house2.rooms.map(r=>`<div class="room-chip ${r.id===room.id?'active':''}" data-room="${r.id}">${getRoomTypeMeta(r.type).icon} ${r.name}</div>`).join('')}</div>
        <div class="room-add-row" style="display:flex;gap:8px;margin:0 0 16px">
          <select id="rsNewRoomType" style="flex:1;background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:7px 10px;font-size:12.5px;color:var(--text-1)">${Object.entries(ROOM_TYPE_META).map(([key,meta])=>`<option value="${key}">${meta.icon} ${I18n.roomType(key)}</option>`).join('')}</select>
          <button class="small-btn" id="rsAddRoom" style="width:auto;white-space:nowrap;margin-top:0;padding:8px 14px">${I18n.t('ui.add_room')}</button>
        </div>
        <div class="field-row"><label>${I18n.t('ui.room_name')}</label><input type="text" id="rsName" value="${room.name}"></div>
        <div class="field-row"><label>${I18n.t('ui.width')}</label><input type="number" id="rsWidth" step="0.1" value="${rs.width}"></div>
        <div class="field-row"><label>${I18n.t('ui.length')}</label><input type="number" id="rsLength" step="0.1" value="${rs.length}"></div>
        <div class="field-row"><label>${I18n.t('ui.height')}</label><input type="number" id="rsHeight" step="0.1" value="${rs.height}"></div>
        <div class="field-row"><label>${I18n.t('ui.floor')}</label><select id="rsFloor">${['Wood','Tile','Concrete','Carpet'].map(o=>`<option ${o===rs.floor?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="field-row"><label>${I18n.t('ui.wall')}</label><select id="rsWall">${['White','Gray','Brick','Concrete'].map(o=>`<option ${o===rs.wall?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="field-row"><label>${I18n.t('ui.wall_visibility_preview')}</label><input type="range" id="rsWallVis" min="0" max="100" value="${Math.round((house2.wallVisibility??1)*100)}"></div>
        <button class="primary-btn" id="rsApply" style="margin-top:14px;width:100%">Zastosuj zmiany dla: ${room.name}</button>
        <button class="small-btn danger" id="rsRemoveRoom" style="margin-top:8px" ${house2.rooms.length<=1?'disabled':''}>🗑 ${I18n.t('ui.removeRoom', { name: room.name })}</button>
        <div style="font-size:11px;color:var(--text-3);margin-top:10px">${I18n.t('ui.wallSliderHint')}</div>`;
      body.querySelectorAll('#rsRoomPicker .room-chip').forEach(chip=>{
        chip.addEventListener('click', ()=>renderFor(chip.dataset.room));
      });
      document.getElementById('rsAddRoom').addEventListener('click', ()=>{
        this._addRoom(document.getElementById('rsNewRoomType').value);
        renderFor(this.getHouseState().activeRoomId);
      });
      document.getElementById('rsRemoveRoom').addEventListener('click', ()=>{
        this._removeRoom(room.id);
        const after = this.getHouseState();
        renderFor(after.activeRoomId);
      });
      document.getElementById('rsWallVis').addEventListener('input', (e)=>{
        const t = Number(e.target.value)/100;
        this.roomBuilder.setWallVisibility(t);
        document.getElementById('wallVisRange').value = e.target.value;
        document.getElementById('wallVisLabel').textContent = e.target.value<5?I18n.t('nav.wallsOpen'):(e.target.value>95?I18n.t('nav.wallsClosed'):e.target.value+'%');
      });
      document.getElementById('rsApply').addEventListener('click', ()=>{
        room.name = document.getElementById('rsName').value || room.name;
        const newWidth = Math.max(3, Number(document.getElementById('rsWidth').value)||rs.width);
        const deltaW = newWidth - rs.width;
        room.settings = {
          width: newWidth,
          length: Math.max(3, Number(document.getElementById('rsLength').value)||rs.length),
          height: Math.max(2.2, Number(document.getElementById('rsHeight').value)||rs.height),
          floor: document.getElementById('rsFloor').value,
          wall: document.getElementById('rsWall').value,
          ceiling: 'White',
        };
        house2.wallVisibility = Number(document.getElementById('rsWallVis').value)/100;
        // keep rooms laid out left-to-right with a fixed gap, so resizing one shifts the next
        BuildingModel.refit(house2, house2.rooms.find(r=>r.id===room.id));   // openings / partitions / stairs stay inside the new walls
        if (deltaW !== 0) BuildingModel.autoLayout(house2);
        this.setHouseState(house2);
        this.rebuildHouse();
        this._fitElectricalToRooms();
        this.projectManager.pushHistory();
        document.getElementById('roomSettingsModal').classList.add('hidden');
        this.renderRoomTabs();
        this.log(I18n.t('log.roomUpdated', { name: room.name }));
      });
    };
    renderFor(house.activeRoomId==='__all__' ? house.rooms[0].id : house.activeRoomId);
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
        <label class="chk"><input type="checkbox" id="shPresence" ${ctx.presence?'checked':''}> ${I18n.t('ui.presenceLabel')}</label>
        <label class="chk">${I18n.t('ui.temperatureLabel')} <input type="range" id="shTemp" min="15" max="32" value="${ctx.tempC}" style="width:120px"> <span id="shTempLabel">${ctx.tempC}°C</span></label>
      </div>
      <div class="rule-builder">
        <div><label>${I18n.t('ui.if')}</label><select class="std-select" id="ruleIf">
          <option value="time">${I18n.t('ui.at')}</option>
          <option value="noPresence">${I18n.t('ui.nobody_is_there')}</option>
          <option value="presence">${I18n.t('ui.someone_is_present')}</option>
          <option value="tempAbove">${I18n.t('ui.temperature_above')}</option>
        </select></div>
        <div id="ruleIfValueWrap"><label>${I18n.t('ui.value')}</label><input class="std-input" id="ruleIfValue" type="time" value="23:00"></div>
        <div><label>TO</label><select class="std-select" id="ruleTarget">${devices.map(d=>`<option value="${d.id}">${d.customName||d.def.name}</option>`).join('')}</select></div>
        <div><label>${I18n.t('ui.set_state')}</label><select class="std-select" id="ruleThen"></select></div>
        <button class="primary-btn" id="ruleAdd">${I18n.t('ui.add_rule')}</button>
      </div>
      <div class="wi-row" style="margin-bottom:10px">
        <button class="small-btn" id="presetMotion">${I18n.t('ui.no_presence_turn_the_light_off')}</button>
        <button class="small-btn" id="presetNight">${I18n.t('ui.23_00_all_tv_av_to_standby')}</button>
        <button class="small-btn" id="presetTemp">${I18n.t('ui.temperature_gt_26_c_turn_the_a_c_o')}</button>
      </div>
      <div id="ruleList"></div>`;

    const ifSelect = document.getElementById('ruleIf');
    const valueWrap = document.getElementById('ruleIfValueWrap');
    const updateValueField = ()=>{
      if (ifSelect.value==='time') valueWrap.innerHTML = '<label>' + I18n.t('ui.value') + '</label><input class="std-input" id="ruleIfValue" type="time" value="23:00">';
      else if (ifSelect.value==='tempAbove') valueWrap.innerHTML = '<label>' + I18n.t('ui.value_c') + '</label><input class="std-input" id="ruleIfValue" type="number" value="26">';
      else valueWrap.innerHTML = '<label>' + I18n.t('ui.value') + '</label><input class="std-input" id="ruleIfValue" disabled value="—">';
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
      if (light){ this.automationManager.addRule({ name:I18n.t('rule.noPresenceLightOff'), ifType:'noPresence', targetInstId:light.id, thenState:'off' }); this._renderRuleList(); }
      else alert(I18n.t('msg.addLightFirst'));
    });
    document.getElementById('presetNight').addEventListener('click', ()=>{
      const tv = devices.find(d=>d.def.category==='rtv');
      if (tv){ this.automationManager.addRule({ name:I18n.t('rule.tvStandby'), ifType:'time', ifValue:'23:00', targetInstId:tv.id, thenState:'standby' }); this._renderRuleList(); }
      else alert(I18n.t('msg.addTvFirst'));
    });
    document.getElementById('presetTemp').addEventListener('click', ()=>{
      const ac = devices.find(d=>d.def.category==='climate');
      if (ac){ this.automationManager.addRule({ name:I18n.t('rule.hotAc'), ifType:'tempAbove', ifValue:26, targetInstId:ac.id, thenState:Object.keys(ac.def.states)[0] }); this._renderRuleList(); }
      else alert(I18n.t('msg.addAcFirst'));
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
        <button class="small-btn" data-rule="${r.id}" style="margin-top:8px;width:auto">${I18n.t('ui.delete_rule')}</button></div>`;
    }).join('') : '<div style="color:var(--text-3);font-size:12.5px">' + I18n.t('ui.no_automations_yet_add_your_first_') + '</div>';
    list.querySelectorAll('[data-rule]').forEach(b=>{
      b.addEventListener('click', ()=>{ this.automationManager.removeRule(b.dataset.rule); this._renderRuleList(); });
    });
  }

  // ============================================================
  // SETTINGS (tariff / price / currency / CO2 / solar assumptions)
  // ============================================================
  _bindSettingsModal(){}
  _tariffPriceFieldsHtml(s, code){
    const t = TariffManager.get(code);
    const prices = s.tariffPrices[code] || t.defaultPrices;
    return t.rates.map(r=>`
      <div class="field-row"><label>${I18n.t(r.labelKey)}</label><input type="number" step="0.01" class="tariff-rate-input" data-rate="${r.id}" value="${prices[r.id]}"></div>
    `).join('');
  }
  _tariffScheduleSummaryHtml(s, code){
    const t = TariffManager.get(code);
    if (t.rates.length<=1) return `<div style="font-size:11.5px;color:var(--text-3)">${I18n.t('tariff.G11.desc')}</div>`;
    const schedule = s.tariffSchedules[code];
    const lines = [];
    for (const d of [1,2,3,4,5,6,0]){
      const ivs = schedule.days[d]||[];
      if (!ivs.length) continue;
      lines.push(`<b>${I18n.dayShort(d)}</b>: ` + ivs.map(iv=>`${iv.start}-${iv.end} (${I18n.t(TariffManager.rateMeta(t,iv.rate).labelKey)})`).join(', '));
    }
    return lines.length ? lines.map(l=>`<div class="tariff-sched-line">${l}</div>`).join('') : `<div style="font-size:11.5px;color:var(--text-3)">${I18n.t('tariff.rate.day')} ${I18n.t('common.all')}</div>`;
  }
  _numOrNull(v){ return (v===''||v==null||!isFinite(Number(v))) ? null : Math.max(0, Number(v)); }
  /** Applies a new PV order immediately (no Save needed): settings, undo history and a fresh instant resolve so the
   *  footer / flow / panels reflect the new priority within the same frame. */
  _applyPvOrder(order){
    const es = this.getEnergySettings();
    es.pvOrder = order.slice();
    es.pvPriority = order[0]==='battery' ? 'battery_first' : 'home_first'; // legacy mirror for anything still reading it
    this.setEnergySettings(es);
    this.projectManager.pushHistory();
    this.simulationEngine._recomputeInstant(false);
    this.log(I18n.t('log.pvOrderChanged', { order: order.map(k=>I18n.t(PriorityList.META[k].labelKey)).join(' → ') }));
  }
  openSettings(){
    const s = this.getEnergySettings();
    const body = document.getElementById('settingsBody');
    const renderBody = ()=>{
      const cur = this.getEnergySettings();
      const t = TariffManager.get(cur.tariffCode);
      body.innerHTML = `
      <div class="field-row"><label>${I18n.t('settings.language')}</label>
        <div class="lang-switch">
          <button class="lang-btn ${I18n.lang==='pl'?'active':''}" data-lang="pl">PL</button>
          <button class="lang-btn ${I18n.lang==='en'?'active':''}" data-lang="en">EN</button>
        </div>
      </div>
      <hr style="border-color:var(--border);margin:14px 0">
      <h4 class="settings-section-h">${I18n.t('settings.tariffSection')}</h4>
      <div class="field-row"><label>${I18n.t('tariff.title')}</label>
        <select id="setTariffCode">${TariffManager.CODES.map(c=>`<option value="${c}" ${c===cur.tariffCode?'selected':''}>${c} — ${I18n.t(TariffManager.get(c).shortDescKey)}</option>`).join('')}</select>
      </div>
      <div id="tariffPriceFields">${this._tariffPriceFieldsHtml(cur, cur.tariffCode)}</div>
      <div class="field-row"><label>${I18n.t('tariff.exportPrice')}</label><input type="number" step="0.01" id="setExportPrice" value="${cur.exportPricePerKWh}"></div>
      <div class="tariff-detail-box" id="tariffDetailBox">${this._tariffScheduleSummaryHtml(cur, cur.tariffCode)}</div>
      <button class="small-btn" id="setEditTariffSched" ${t.rates.length<=1?'disabled':''}>🕐 ${I18n.t('tariff.editSchedule')}</button>

      <hr style="border-color:var(--border);margin:16px 0">
      <h4 class="settings-section-h">${I18n.t('settings.pvSection')}</h4>
      <div class="field-row" style="display:block"><label style="display:block;margin-bottom:2px">${I18n.t('priority.title')}</label>
        <div style="font-size:11px;color:var(--text-3)">${I18n.t('pvsink.intro')}</div>
        <div id="pvPriorityList"></div>
      </div>
      <div class="field-row"><label>${I18n.t('pv.exportLimit')}</label><input type="number" min="0" step="100" id="setExportLimit" placeholder="${I18n.t('pv.noLimit')}" value="${cur.exportLimitW==null?'':cur.exportLimitW}"></div>
      <div class="field-row"><label>${I18n.t('pv.importLimit')}</label><input type="number" min="0" step="100" id="setImportLimit" placeholder="${I18n.t('pv.noLimit')}" value="${cur.importLimitW==null?'':cur.importLimitW}"></div>
      <div class="field-row"><label>${I18n.t('battery.reserve')}</label><input type="number" min="0" max="90" step="1" id="setBatteryReserve" value="${cur.batteryReservePct||0}"></div>
      <div class="field-row"><label>${I18n.t('pv.inverterPower')}</label><input type="number" min="0" step="100" id="setInverterPower" value="${cur.inverterMaxW??''}" placeholder="${I18n.t('pv.noLimit')}"></div>
      <div class="field-row"><label>${I18n.t('pv.inverterEfficiency')}</label><input type="number" min="50" max="100" step="1" id="setInverterEfficiency" value="${Math.round((cur.inverterEfficiency??.96)*100)}"></div>
      <div class="field-row"><label>${I18n.t('pv.soiling')}</label><input type="number" min="0" max="100" step="1" id="setPvSoiling" value="${cur.pvSoilingPct??2}"></div>
      <div class="field-row"><label>${I18n.t('pv.snow')}</label><input type="number" min="0" max="100" step="1" id="setPvSnow" value="${cur.pvSnowPct||0}"></div>
      <div class="field-row"><span>${I18n.t('energy.gridConnection')}</span><label class="switch"><input type="checkbox" id="setGridOnline" ${this.simulationEngine.gridOnline?'checked':''}><span class="slider-tog"></span></label></div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:10px">${I18n.t('pv.limitsNote')}</div>

      <hr style="border-color:var(--border);margin:16px 0">
      <h4 class="settings-section-h">${I18n.t('settings.generalSection')}</h4>
      <div class="field-row"><label>${I18n.t('common.currency')}</label><input type="text" id="setCurrency" value="${cur.currency}" maxlength="4"></div>
      <div class="field-row"><label>${I18n.t('ui.additional_fees_month')}</label><input type="number" step="0.5" id="setFees" value="${cur.extraFeesPerMonth}"></div>
      <div class="field-row"><label>${I18n.t('settings.co2Factor')}</label><input type="number" step="0.01" id="setCo2" value="${cur.co2Factor}"></div>
      <div class="field-row"><label>${I18n.t('settings.avgHousehold')}</label><input type="number" step="50" id="setAvgHousehold" value="${cur.avgHouseholdKWhYear}"></div>
      <div style="font-size:11px;color:var(--text-3);margin:8px 0 14px">${I18n.t('ui.settingsAssumptions')}</div>
      <button class="primary-btn" id="setApply" style="width:100%">${I18n.t('common.save')}</button>

      <hr style="border-color:var(--border);margin:18px 0">
      <h4 class="settings-section-h">${I18n.t('ui.project')}</h4>
      <div class="wi-row">
        <button class="small-btn" id="projNew">🆕 ${I18n.t('nav.newSim')}</button>
        <button class="small-btn" id="projSave">${I18n.t('ui.saveBtn')}</button>
        <button class="small-btn" id="projLoad">${I18n.t('ui.loadBtn')}</button>
        <button class="small-btn" id="projExport">${I18n.t('ui.exportBtn')}</button>
        <button class="small-btn" id="projImport">${I18n.t('ui.importBtn')}</button>
        <input type="file" id="projImportFile" accept="application/json" class="hidden">
      </div>

      <hr style="border-color:var(--border);margin:18px 0">
      <h4 class="settings-section-h" style="color:var(--accent-danger)">${I18n.t('settings.dangerZone')}</h4>
      <button class="small-btn danger" id="setResetSim" style="width:100%">🗑 ${I18n.t('settings.resetSim')}</button>`;

      body.querySelectorAll('.lang-btn').forEach(b=>{
        b.addEventListener('click', ()=>{ I18n.setLang(b.dataset.lang); renderBody(); });
      });
      document.getElementById('setTariffCode').addEventListener('change', (e)=>{
        document.getElementById('tariffPriceFields').innerHTML = this._tariffPriceFieldsHtml(this.getEnergySettings(), e.target.value);
        document.getElementById('tariffDetailBox').innerHTML = this._tariffScheduleSummaryHtml(this.getEnergySettings(), e.target.value);
        document.getElementById('setEditTariffSched').disabled = TariffManager.get(e.target.value).rates.length<=1;
      });
      // visual 3-slot PV priority - applied to the running simulation the moment it changes
      this.pvPriorityList = new PriorityList(document.getElementById('pvPriorityList'), {
        order: SimulationEngine.normalizePvOrder(cur.pvOrder, cur.pvPriority),
        onChange: (order)=>this._applyPvOrder(order),
      });
      document.getElementById('setEditTariffSched').addEventListener('click', ()=>{
        const code = document.getElementById('setTariffCode').value;
        const cur2 = this.getEnergySettings();
        const t2 = TariffManager.get(code);
        this._openScheduleEditor({
          title: `${I18n.t('tariff.title')} ${code}`,
          mode: 'rate',
          rateOptions: t2.rates.map(r=>({ id:r.id, label:I18n.t(r.labelKey), color:r.color })),
          schedule: JSON.parse(JSON.stringify(cur2.tariffSchedules[code])),
          onSave: (schedule)=>{
            const es = this.getEnergySettings();
            es.tariffSchedules[code] = schedule;
            this.setEnergySettings(es);
            this.projectManager.pushHistory();
            this.log(`${I18n.t('tariff.title')} ${code}: ${I18n.t('sched.save')}`);
            renderBody();
          },
        });
      });
      document.getElementById('setApply').addEventListener('click', ()=>{
        const cur3 = this.getEnergySettings();
        const code = document.getElementById('setTariffCode').value;
        const newPrices = { ...cur3.tariffPrices };
        newPrices[code] = {};
        document.querySelectorAll('.tariff-rate-input').forEach(inp=>{ newPrices[code][inp.dataset.rate] = Number(inp.value)||0; });
        this.setEnergySettings({
          ...cur3,
          tariffCode: code,
          tariffPrices: newPrices,
          exportPricePerKWh: Number(document.getElementById('setExportPrice').value)||0,
          exportLimitW: this._numOrNull(document.getElementById('setExportLimit').value),
          importLimitW: this._numOrNull(document.getElementById('setImportLimit').value),
          batteryReservePct: Math.max(0, Math.min(90, Number(document.getElementById('setBatteryReserve').value)||0)),
          inverterMaxW:this._numOrNull(document.getElementById('setInverterPower').value),
          inverterEfficiency:Math.max(.5,Math.min(1,(Number(document.getElementById('setInverterEfficiency').value)||96)/100)),
          pvSoilingPct:Math.max(0,Math.min(100,Number(document.getElementById('setPvSoiling').value)||0)),
          pvSnowPct:Math.max(0,Math.min(100,Number(document.getElementById('setPvSnow').value)||0)),
          currency: document.getElementById('setCurrency').value||'PLN',
          extraFeesPerMonth: Number(document.getElementById('setFees').value)||0,
          co2Factor: Number(document.getElementById('setCo2').value)||0.65,
          avgHouseholdKWhYear: Number(document.getElementById('setAvgHousehold').value)||2900,
        });
        this.simulationEngine.gridOnline=document.getElementById('setGridOnline').checked;
        this.simulationEngine._recomputeInstant(false);
        this.projectManager.pushHistory();
        this.log(I18n.t('log.energySettingsUpdated'));
        document.getElementById('settingsModal').classList.add('hidden');
      });
      document.getElementById('projNew').addEventListener('click', ()=>{ document.getElementById('settingsModal').classList.add('hidden'); this._openNewSimModal(); });
      document.getElementById('projSave').addEventListener('click', ()=>this.projectManager.saveLocal());
      document.getElementById('projLoad').addEventListener('click', ()=>{ this.projectManager.loadLocal(); this.transformManager.deselect(); this.renderRoomTabs(); document.getElementById('settingsModal').classList.add('hidden'); });
      document.getElementById('projExport').addEventListener('click', ()=>this.projectManager.exportFile());
      document.getElementById('projImport').addEventListener('click', ()=>document.getElementById('projImportFile').click());
      document.getElementById('projImportFile').addEventListener('change', (e)=>{
        if (e.target.files[0]) this.projectManager.importFile(e.target.files[0], ()=>{ this.transformManager.deselect(); this.renderRoomTabs(); document.getElementById('settingsModal').classList.add('hidden'); });
      });
      document.getElementById('setResetSim').addEventListener('click', ()=>{
        if (confirm(I18n.t('settings.resetConfirm'))){
          this.projectManager.resetSimulation();
          this.transformManager.deselect();
          this.renderRoomTabs();
          document.getElementById('settingsModal').classList.add('hidden');
          this.toast(I18n.t('log.simulationReset'));
        }
      });
    };
    renderBody();
    document.getElementById('settingsModal').classList.remove('hidden');
  }

  // ============================================================
  // EDUCATIONAL MODAL
  // ============================================================
  _bindEduModal(){}
  openEdu(inst){
    document.getElementById('eduTitle').textContent = this.experienceMode==='kids'
      ? `${inst.customName||I18n.deviceName(inst.def)} — ${I18n.t('kids.deviceTitle')}`
      : `${inst.customName||I18n.deviceName(inst.def)} — ${I18n.t('ui.eduHow')}`;
    const def = inst.def;
    const dailyKWh = this.simulationEngine.todayKWhByDevice[inst.id]||0;
    const s = this.getEnergySettings();
    if(this.experienceMode==='kids'){
      document.getElementById('eduBody').innerHTML = `
        <div class="kids-lesson-hero"><span>🔎</span><div><b>${I18n.t('kids.deviceTitle')}</b><p>${I18n.t('kids.deviceIntro',{name:I18n.deviceName(def)})}</p></div></div>
        <div class="kids-lesson-grid"><div><small>${I18n.t('kids.powerLabel')}</small><b>${EnergyCalculator.fmtW(def.ratedPowerW)}</b><p>${I18n.t('kids.powerPlain')}</p></div><div><small>${I18n.t('kids.todayLabel')}</small><b>${EnergyCalculator.fmtKWh(dailyKWh)}</b><p>${I18n.t('kids.energyPlain')}</p></div></div>
        <div class="edu-term">💡 ${I18n.t('kids.standbyTip')}</div>
        ${this._kidsQuizHtml()}`;
      this._bindKidsQuiz(document.getElementById('eduBody'));
    } else document.getElementById('eduBody').innerHTML = `
      <div class="edu-term"><b>${I18n.t('ui.rated_power')}</b> ${EnergyCalculator.fmtW(def.ratedPowerW)}</div>
      <div class="edu-term">${I18n.deviceEdu(def)}</div>
      <div class="edu-term"><b>${I18n.t('ui.consumption_today')}</b> ${EnergyCalculator.fmtKWh(dailyKWh)} · <b>${I18n.t('ui.cost')}</b> ${EnergyCalculator.fmtCost(dailyKWh*EnergyCalculator.effectivePrice(s),s.currency)}</div>
      <div class="edu-term"><b>${I18n.t('tariff.title')}:</b> ${s.tariffCode} — ${I18n.t(TariffManager.get(s.tariffCode).shortDescKey)}</div>
      <div class="edu-term"><b>${I18n.t('ui.w_watt')}</b> ${I18n.t('edu.power')}</div>
      <div class="edu-term"><b>kW</b> — 1000 W.</div>
      <div class="edu-term"><b>${I18n.t('ui.wh_kwh')}</b> ${I18n.t('edu.energy')}</div>
      <div class="edu-term"><b>${I18n.t('ui.power_vs_energy')}</b> ${I18n.t('edu.powerVsEnergy')}</div>
      <div class="edu-term"><b>Standby</b> ${I18n.t('edu.standby')}</div>
      <div class="edu-term"><b>${I18n.t('ui.duty_cycle')}</b> ${I18n.t('edu.cycle')}</div>
      <div class="edu-term"><b>${I18n.t('ui.day_night_tariff')}</b> ${I18n.t('edu.dayNight')}</div>
      <div class="edu-term"><b>${I18n.t('ui.energy_cost')}</b> ${I18n.t('edu.cost', { cur: s.currency })}</div>`;
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
    document.getElementById('btnKidsGuide').addEventListener('click', ()=>this.openKidsTutorial());
    document.getElementById('btnKidsLesson').addEventListener('click', ()=>this.openKidsTutorial());
    document.getElementById('kidsNextFact').addEventListener('click',()=>{this._kidsFactIndex++;this._kidsFactChangedAt=Date.now();this._updateEducationalFact(true);});
    document.getElementById('kidsTutorialClose').addEventListener('click', ()=>this.closeKidsTutorial());
    document.getElementById('kidsTutorialBack').addEventListener('click', ()=>this.showKidsTutorialStep(this.kidsTutorialStep-1));
    document.getElementById('kidsTutorialNext').addEventListener('click', ()=>{
      if(this.kidsTutorialStep>=3){ this.closeKidsTutorial(); this.openKidsQuiz(); }
      else this.showKidsTutorialStep(this.kidsTutorialStep+1);
    });
  }

  openKidsTutorial(){
    this.kidsTutorialStep=0;
    this.showKidsTutorialStep(0);
    document.getElementById('kidsTutorialModal').classList.remove('hidden');
  }
  closeKidsTutorial(){
    document.getElementById('kidsTutorialModal').classList.add('hidden');
    try { localStorage.setItem('energyroom3d_kids_guide_seen','1'); } catch(e){}
  }
  showKidsTutorialStep(index){
    this.kidsTutorialStep=Math.max(0,Math.min(3,index));
    const n=this.kidsTutorialStep+1;
    document.getElementById('kidsTutorialIcon').textContent=['🏠','🧸','⚡','🧠'][this.kidsTutorialStep];
    document.getElementById('kidsTutorialProgress').innerHTML=Array.from({length:4},(_,i)=>`<i class="${i<=this.kidsTutorialStep?'active':''}"></i>`).join('');
    document.getElementById('kidsTutorialStep').textContent=I18n.t('kids.stepCount',{current:n,total:4});
    document.getElementById('kidsTutorialTitle').textContent=I18n.t(`kids.step${n}.title`);
    document.getElementById('kidsTutorialText').textContent=I18n.t(`kids.step${n}.text`);
    document.getElementById('kidsTutorialTip').innerHTML=`<b>✨ ${I18n.t('kids.tryThis')}</b><span>${I18n.t(`kids.step${n}.tip`)}</span>`;
    document.getElementById('kidsTutorialBack').disabled=this.kidsTutorialStep===0;
    document.getElementById('kidsTutorialNext').textContent=I18n.t(n===4?'kids.quizStart':'kids.next');
  }
  _kidsQuizHtml(){
    const choices=['ceiling_lamp','tv_55','kettle'].map(id=>DEVICE_DEFINITIONS.find(d=>d.id===id)).filter(Boolean);
    return `<section class="kids-quiz"><div class="kids-quiz-kicker">🎯 ${I18n.t('kids.quizKicker')}</div><h3>${I18n.t('kids.quizQuestion')}</h3><p>${I18n.t('kids.quizHint')}</p><div class="kids-quiz-options">${choices.map(d=>`<button class="kids-quiz-choice" data-kids-answer="${d.id}"><span>${({'ceiling_lamp':'💡','tv_55':'📺','kettle':'🫖'})[d.id]}</span>${I18n.deviceName(d)}</button>`).join('')}</div><div class="kids-quiz-feedback" aria-live="polite"></div></section>`;
  }
  _bindKidsQuiz(root){
    const correct=['ceiling_lamp','tv_55','kettle'].map(id=>DEVICE_DEFINITIONS.find(d=>d.id===id)).filter(Boolean).sort((a,b)=>b.ratedPowerW-a.ratedPowerW)[0];
    root.querySelectorAll('.kids-quiz-choice').forEach(btn=>btn.addEventListener('click',()=>{
      const right=btn.dataset.kidsAnswer===correct.id, feedback=root.querySelector('.kids-quiz-feedback');
      root.querySelectorAll('.kids-quiz-choice').forEach(b=>b.classList.remove('right','wrong'));
      btn.classList.add(right?'right':'wrong');
      feedback.className='kids-quiz-feedback '+(right?'right':'try-again');
      feedback.textContent=I18n.t(right?'kids.quizCorrect':'kids.quizTry',{name:I18n.deviceName(correct),power:EnergyCalculator.fmtW(correct.ratedPowerW)});
    }));
  }
  openKidsQuiz(){
    const title=I18n.t('kids.quizTitle'), body=document.getElementById('eduBody');
    document.getElementById('eduTitle').textContent=title;
    body.innerHTML=`<div class="kids-lesson-hero"><span>🌟</span><div><b>${I18n.t('kids.quizLearnTitle')}</b><p>${I18n.t('kids.quizLearnText')}</p></div></div>${this._kidsQuizHtml()}`;
    this._bindKidsQuiz(body);
    document.getElementById('kidsTutorialModal').classList.add('hidden');
    this._closeAllModals();
    document.getElementById('eduModal').classList.remove('hidden');
  }

  // ============================================================
  // ACHIEVEMENTS (gamification basics — spec #40)
  // ============================================================
  toast(text, isAchievement){
    this._petSpeak(isAchievement ? `🏆 ${text}` : text, !!isAchievement);
  }
  _petSpeak(message, achievement=false){
    const bubble = document.getElementById('petBubble');
    if (!bubble || !message) return;
    const entry = { message:String(message), achievement };
    if (bubble.classList.contains('hidden')) this._showPetBubble(entry);
    else if (this._petBubbleQueue.length < 3) this._petBubbleQueue.push(entry);
    else this._petBubbleQueue[this._petBubbleQueue.length-1] = entry;
  }
  _showPetBubble(entry){
    const bubble = document.getElementById('petBubble');
    if (!bubble) return;
    clearTimeout(this._petBubbleTimer);
    bubble.textContent = entry.message;
    bubble.classList.toggle('achievement', entry.achievement);
    bubble.classList.remove('hidden','pet-bubble-in');
    void bubble.offsetWidth;
    bubble.classList.add('pet-bubble-in');
    this._petBubbleTimer = setTimeout(()=>{
      const next = this._petBubbleQueue.shift();
      if (next) this._showPetBubble(next);
      else { bubble.classList.add('hidden'); bubble.classList.remove('pet-bubble-in','achievement'); }
    }, entry.achievement ? 6500 : 5000);
  }
  _award(id, text){
    if (this.achievements.has(id)) return;
    this.achievements.add(id);
    this.toast(text, true);
    this.log(I18n.t('log.achievementUnlocked', { text }));
  }
  _checkAchievements(){
    const earned=this.homeEnergyManager?this.homeEnergyManager.evaluateAchievements():[];
    for(const id of earned){
      this._award('energy_'+id, I18n.t('achievement.'+id));
    }
    const sc = this.analyticsManager.energyScore();
    if (sc.score>90) this._award('efficient_room', I18n.t('ach.efficientRoom'));
    if (this.automationManager.rules.length>=1) this._award('smart_home', I18n.t('ach.smartHome'));
    const disconnectedStandby = this.objectManager.getDevices().filter(d=>!d.connected && d.def.standbyPowerW>0).length;
    if (disconnectedStandby>=3) this._award('standby_killer', I18n.t('ach.standbyKiller'));
    if (this.objectManager.getSolar().length>=1) this._award('sun_powered', I18n.t('ach.sunPowered'));
    if (this.simulationEngine.currentGenW > this.simulationEngine.currentPowerW && this.objectManager.getSolar().length) this._award('net_positive', I18n.t('ach.netPositive'));
  }

  // ============================================================
  // QUESTS / ADVISOR CONTEXT (sections 16-19)
  // ============================================================
  /** Cheap 18-sample morning-window estimate (06:00-09:00), cached 5s - baseline for the
   *  "frugal morning" quest. Recomputed on demand rather than every tick. */
  _morningProjectedKWh(){
    if (this._morningProjCache!=null && (Date.now()-(this._morningProjCacheAt||0))<5000) return this._morningProjCache;
    const instances = this.objectManager.getDevices();
    const dayIdx = this.simulationEngine.simDay;
    let kwh = 0;
    for (let m=6*60; m<9*60; m+=10){
      let w=0;
      for (const inst of instances) w += ScheduleManager.resolve(inst, dayIdx*1440+m).powerW;
      kwh += EnergyCalculator.wattsMinutesToKWh(w,10);
    }
    this._morningProjCache = kwh; this._morningProjCacheAt = Date.now();
    return kwh;
  }
  _questCtx(){
    const sim = this.simulationEngine, s = this.getEnergySettings();
    return {
      solarCount: this.objectManager.getSolar().length,
      batteryCount: this.objectManager.getBattery().length,
      dayEntry: { consumedKWh:sim.todayKWh, solarKWh:sim.todaySolarKWh, importKWh:sim.todayImportKWh, exportKWh:sim.todayExportKWh, cost:sim.todayCost, morningKWh:sim.todayMorningKWh },
      morningProjectedKWh: this._morningProjectedKWh(),
      effectivePrice: EnergyCalculator.effectivePrice(s),
      isFlatTariff: TariffManager.isFlat(s.tariffCode),
      simDayIndex: sim.simDayIndex,
    };
  }
  /** Runs the pet's rule-based advisor every slow-tick (section 16). New tips are merged in front
   *  of still-relevant older ones (deduped by id) and a small dot marks the pet icon so the player
   *  notices without an intrusive popup for every observation. */
  _runAdvisor(){
    const ctx = { sim: this.simulationEngine, instances: this.objectManager.getDevices(), analytics: this.analyticsManager, settings: this.getEnergySettings(), pet: this.petManager };
    const fresh = this.advisorEngine.evaluate(ctx);
    if (fresh.length){
      const previous = this._latestTips||[];
      const newlyAdded = fresh.filter(t=>!previous.some(old=>old.id===t.id));
      const keep = previous.filter(old=>!fresh.some(t=>t.id===old.id));
      this._latestTips = fresh.concat(keep).slice(0,8);
      const dot = document.getElementById('petTipDot');
      if (dot) dot.classList.remove('hidden');
      const panel = document.getElementById('petPanel');
      if (panel && !panel.classList.contains('hidden')) this._renderPetTips();
      if (newlyAdded.length) this._petSpeak(`${I18n.t('pet.tipPrefix')}: ${newlyAdded[0].text}`, newlyAdded[0].level==='warning');
    }
  }

  // ============================================================
  // LANGUAGE SWITCHING (section 1) — re-render every open surface
  // ============================================================
  _onLanguageChange(){
    this.updateModeUI();
    this._updateEducationalFact(true);
    if(!document.getElementById('kidsTutorialModal').classList.contains('hidden')) this.showKidsTutorialStep(this.kidsTutorialStep||0);
    this.renderCategoryTabs();
    this.renderAssetGrid();
    this.renderRoomTabs();
    this._renderWeatherBadge();
    this._renderPet();
    const inst = this.objectManager.find(this.transformManager.selectedId);
    if (inst) this.renderProperties(inst);
    if(!document.getElementById('eduModal').classList.contains('hidden') && this.experienceMode==='kids'){
      if(inst && inst.kind==='device') this.openEdu(inst); else this.openKidsQuiz();
    }
    if (!document.getElementById('dashboardModal').classList.contains('hidden')) this.refreshDashboard();
    if (!document.getElementById('challengesModal').classList.contains('hidden')) this._renderChallenges();
    if (!document.getElementById('settingsModal').classList.contains('hidden')) this.openSettings();
    if (!document.getElementById('smartHomeModal').classList.contains('hidden')) this.openSmartHome();
    if (!document.getElementById('roomSettingsModal').classList.contains('hidden')) this.openRoomSettings();
    if (this.pvInstallMode) this._refreshPvInstallBanner();
  }

  // ============================================================
  // PV INSTALL MODE (sections 14/15) — panels start uninstalled; this is the guided flow
  // ============================================================
  _bindPvInstallMode(){
    document.getElementById('btnPvInstall').addEventListener('click', ()=> this._togglePvInstallMode());
    document.getElementById('pvInstallFinishBtn').addEventListener('click', ()=> this._togglePvInstallMode(false));
  }
  _togglePvInstallMode(force){
    this.pvInstallMode = force!=null ? force : !this.pvInstallMode;
    document.getElementById('btnPvInstall').classList.toggle('active', this.pvInstallMode);
    document.getElementById('pvInstallBanner').classList.toggle('hidden', !this.pvInstallMode);
    if (this.pvInstallMode){
      const house = this.getHouseState();
      const garage = house.rooms.find(r=>this.roomBuilder.roofGroups[r.id]) || house.rooms[0];
      if (garage) this.setActiveRoom(garage.id);   // any room whose roof can carry panels (mono-pitch / gable)
      this.currentCategory = 'solar';
      this.renderCategoryTabs(); this.renderAssetGrid();
      if (this.isMobile()) document.getElementById('leftPanel').classList.add('mobile-open');
      this._refreshPvInstallBanner();
    } else {
      this._checkAchievements();
    }
  }
  _refreshPvInstallBanner(){
    if (!this.pvInstallMode) return;
    const solar = this.analyticsManager.solarSummary();
    const el = document.getElementById('pvInstallStats');
    el.innerHTML = solar.count
      ? `${I18n.t('pv.panelCount')}: <b>${solar.count}</b> · ${I18n.t('pv.totalPower')}: <b>${EnergyCalculator.fmtW(solar.totalPeakW)}</b> · ${I18n.t('pv.aimQuality')}: <b>${(solar.avgAimQuality*100).toFixed(0)}%</b>`
      : `<span style="opacity:.85">${I18n.t('pv.notInstalledYet')}</span>`;
  }

  // ============================================================
  // SCHEDULE / TARIFF INTERVAL EDITOR (section 3) — generic: binary (device on/off)
  // or rate (multi-colour tariff zones), both built on the same rich per-day model.
  // ============================================================
  _bindScheduleModal(){}
  _openDeviceScheduleEditor(inst){
    const schedule = ScheduleManager.normalize(inst.schedule, inst.def);
    this._openScheduleEditor({
      title: `🕐 ${inst.customName||I18n.deviceName(inst.def)}`,
      mode: 'binary',
      device:inst,
      schedule: JSON.parse(JSON.stringify(schedule)),
      onSave: (sched)=>{
        this.objectManager.setSchedule(inst.id, sched);
        this.projectManager.pushHistory();
        this.questManager.markScheduleEdited();
        this.petManager.awardScheduleSaved(inst.id);
        this.questManager.checkMilestones(this._questCtx());
        const fresh = this.objectManager.find(inst.id);
        if (fresh) this.renderProperties(fresh);
        this.log(`${I18n.t('sched.save')}: ${inst.customName||I18n.deviceName(inst.def)}`);
      },
    });
  }
  _openScheduleEditor(opts){
    this._schedState = { schedule: opts.schedule, mode: opts.mode, rateOptions: opts.rateOptions||[], onSave: opts.onSave, selectedDay: this.simulationEngine.simDay,device:opts.device||null,recommendation:null };
    document.getElementById('scheduleModalTitle').textContent = opts.title;
    this._renderScheduleEditor();
    document.getElementById('scheduleModal').classList.remove('hidden');
  }
  _renderScheduleEditor(){
    const st = this._schedState;
    const body = document.getElementById('scheduleModalBody');
    const dayOrder = [1,2,3,4,5,6,0]; // Monday-first display, internal index stays 0=Sun..6=Sat
    const preset = ScheduleManager.presets();
    const isRate = st.mode==='rate';

    const dayTabsHtml = dayOrder.map(d=>{
      const count = (st.schedule.days[d]||[]).length;
      return `<button class="sched-day-tab ${d===st.selectedDay?'active':''} ${count?'':'empty'}" data-day="${d}">${I18n.dayShort(d)}${count?` <span class="cnt">${count}</span>`:''}</button>`;
    }).join('');

    const intervals = st.schedule.days[st.selectedDay]||[];
    const rowsHtml = intervals.map((iv,i)=>`
      <div class="interval-row">
        <input type="time" class="iv-start" data-i="${i}" value="${iv.start}">
        <span>–</span>
        <input type="time" class="iv-end" data-i="${i}" value="${iv.end}">
        ${isRate ? `<select class="iv-rate" data-i="${i}">${st.rateOptions.map(r=>`<option value="${r.id}" ${iv.rate===r.id?'selected':''}>${r.label}</option>`).join('')}</select>` : ''}
        <button class="iv-remove" data-i="${i}" title="${I18n.t('sched.removeInterval')}">✕</button>
      </div>`).join('') || `<div class="pet-empty-note">${I18n.t('sched.noIntervals')}</div>`;

    body.innerHTML = `
      ${st.mode==='binary' ? `<div class="toggle-row"><span>${I18n.t('sched.active')}</span><label class="switch"><input type="checkbox" id="schedEnabledToggle" ${st.schedule.enabled?'checked':''}><span class="slider-tog"></span></label></div>` : ''}
      <div class="sched-day-tabs">${dayTabsHtml}</div>
      <div class="sched-quick-row">
        <span class="sched-quick-lbl">${I18n.t('sched.applyToOthers')}:</span>
        <button class="small-btn" data-preset="all">${I18n.t('sched.selectAll')}</button>
        <button class="small-btn" data-preset="workdays">${I18n.t('sched.selectWorkdays')}</button>
        <button class="small-btn" data-preset="weekend">${I18n.t('sched.selectWeekend')}</button>
      </div>
      <div class="sched-timeline">${this._scheduleTimelineHtml(intervals, isRate, st.rateOptions)}</div>
      <div class="interval-list">${rowsHtml}</div>
      <button class="small-btn" id="schedAddInterval">➕ ${I18n.t('sched.addInterval')}</button>
      ${st.device?`<section class="schedule-planner"><div><b>🧭 ${I18n.t('sched.plannerTitle')}</b><p>${I18n.t('sched.plannerHint')}</p></div><select class="std-select" id="schedPlannerGoal"><option value="cheap" ${st.plannerGoal!=='solar'?'selected':''}>${I18n.t('sched.goalCheap')}</option><option value="solar" ${st.plannerGoal==='solar'?'selected':''} ${this.objectManager.getSolar().length?'':'disabled'}>${I18n.t('sched.goalSolar')}</option></select><button class="small-btn" id="schedRecommend">${I18n.t('sched.findWindow')}</button><div id="schedRecommendation" class="schedule-recommendation ${st.recommendation?'':'hidden'}">${st.recommendation?I18n.t(st.recommendation.goal==='solar'?'sched.recommendationSolar':'sched.recommendation',{start:st.recommendation.start,end:st.recommendation.end,cost:st.recommendation.cost.toFixed(2),currency:this.getEnergySettings().currency,covered:st.recommendation.coveredKWh.toFixed(2)}):''}</div>${st.recommendation?`<button class="small-btn" id="schedApplyRecommendation">${I18n.t('sched.applyWindow')}</button>`:''}</section>`:''}
      <div style="font-size:11px;color:var(--text-3);margin:8px 0">${I18n.t('sched.perDayHint')}</div>
      <button class="primary-btn" id="schedSaveBtn" style="width:100%;margin-top:8px">${I18n.t('sched.save')}</button>`;

    body.querySelectorAll('.sched-day-tab').forEach(b=>{
      b.addEventListener('click', ()=>{ st.selectedDay = Number(b.dataset.day); this._renderScheduleEditor(); });
    });
    body.querySelectorAll('[data-preset]').forEach(b=>{
      b.addEventListener('click', ()=>{
        ScheduleManager.copyDayToOthers(st.schedule, st.selectedDay, preset[b.dataset.preset]);
        this._renderScheduleEditor();
      });
    });
    body.querySelectorAll('.iv-start,.iv-end').forEach(inp=>{
      inp.addEventListener('change', ()=>{
        const i = Number(inp.dataset.i);
        intervals[i][inp.classList.contains('iv-start')?'start':'end'] = inp.value;
        this._renderScheduleEditor();
      });
    });
    body.querySelectorAll('.iv-rate').forEach(sel=>{
      sel.addEventListener('change', ()=>{ intervals[Number(sel.dataset.i)].rate = sel.value; this._renderScheduleEditor(); });
    });
    body.querySelectorAll('.iv-remove').forEach(b=>{
      b.addEventListener('click', ()=>{ ScheduleManager.removeInterval(st.schedule, st.selectedDay, Number(b.dataset.i)); this._renderScheduleEditor(); });
    });
    document.getElementById('schedAddInterval').addEventListener('click', ()=>{
      const newIv = isRate ? { start:'08:00', end:'16:00', rate: st.rateOptions[0].id } : { start:'08:00', end:'16:00' };
      ScheduleManager.addInterval(st.schedule, st.selectedDay, newIv);
      this._renderScheduleEditor();
    });
    const recommend=document.getElementById('schedRecommend');
    const goalSelect=document.getElementById('schedPlannerGoal');
    if(goalSelect)goalSelect.addEventListener('change',()=>{st.plannerGoal=goalSelect.value;st.recommendation=null;this._renderScheduleEditor();});
    if(recommend)recommend.addEventListener('click',()=>{st.plannerGoal=document.getElementById('schedPlannerGoal').value;st.recommendation=this._findCheapestWindow(st.device,st.selectedDay,st.plannerGoal);this._renderScheduleEditor();});
    const applyRecommendation=document.getElementById('schedApplyRecommendation');
    if(applyRecommendation)applyRecommendation.addEventListener('click',()=>{
      const r=st.recommendation;if(!r)return;
      st.schedule.days[st.selectedDay]=[{start:r.start,end:r.end}];
      if(st.device.def.profileType==='cycle')st.schedule.cycles[st.selectedDay]=[r.start];
      st.schedule.enabled=true;st.recommendation=null;this._renderScheduleEditor();
    });
    const enabledToggle = document.getElementById('schedEnabledToggle');
    if (enabledToggle) enabledToggle.addEventListener('change', (e)=>{ st.schedule.enabled = e.target.checked; });
    document.getElementById('schedSaveBtn').addEventListener('click', ()=>{
      st.onSave(st.schedule);
      document.getElementById('scheduleModal').classList.add('hidden');
    });
  }
  _findCheapestWindow(device,selectedDay=this.simulationEngine.simDay,goal='cheap'){
    const s=this.getEnergySettings(),sim=this.simulationEngine;
    const sequence=device.def.profileType==='cycle'?(device.def.cycleSequence||[]):[];
    const duration=sequence.length?sequence.reduce((sum,step)=>sum+step.minutes,0):60;
    const loadW=sequence.length?sequence.reduce((sum,step)=>sum+(device.def.states[step.state]||0)*step.minutes,0)/Math.max(1,duration):Math.max(0,device.def.ratedPowerW||device.runtime.powerW||0);
    let best=null;const panels=goal==='solar'?this.objectManager.getSolar():[];
    let pvMultiplier=Math.max(.5,Math.min(1,+(s.inverterEfficiency??.96)));
    if(typeof HomeEnergyManager!=='undefined'){
      pvMultiplier*=HomeEnergyManager.pvModuleFactor(s);
      if(s.realismMode!=='arcade')pvMultiplier*=s.realismMode==='educational'?Math.sqrt(HomeEnergyManager.pvFactor(s)):HomeEnergyManager.pvFactor(s);
    }
    if(s.inverterMaxW!=null)pvMultiplier=Math.min(pvMultiplier,Math.max(0,+s.inverterMaxW)/Math.max(1,panels.reduce((sum,p)=>sum+p.def.peakPowerW,0)));
    let dayOffset=(selectedDay-sim.simDay+7)%7;
    let firstMinute=dayOffset===0?Math.ceil(sim.minuteOfDay/15)*15:0;
    if(firstMinute>1440-duration){dayOffset+=7;firstMinute=0;}
    const dayBase=sim.absMin-sim.minuteOfDay+dayOffset*1440;
    for(let startMinute=firstMinute;startMinute<=1440-duration;startMinute+=15){
      let priceEnergy=0,pvSum=0,minutesCovered=0;
      for(let m=0;m<duration;m+=15){
        const stepMinutes=Math.min(15,duration-m),absMin=dayBase+startMinute+m+stepMinutes/2;priceEnergy+=EnergyCalculator.priceAt(absMin,s)*stepMinutes;minutesCovered+=stepMinutes;
        if(panels.length&&typeof SolarCalculator!=='undefined'){
          const futureDate=new Date(sim.simDate);futureDate.setDate(futureDate.getDate()+dayOffset);
          const doy=SunPosition.dayOfYear(futureDate),wx=sim.weatherManager?sim.weatherManager.getMultipliers():{solarMult:1};
          pvSum+=panels.reduce((sum,p)=>sum+SolarCalculator.resolve(p,absMin,doy,wx.solarMult),0)*stepMinutes;
        }
      }
      const avgPrice=priceEnergy/Math.max(1,minutesCovered),avgPvW=pvSum/Math.max(1,minutesCovered)*pvMultiplier,coveredW=Math.min(loadW,avgPvW);
      const energyKWh=loadW*duration/60000,coveredKWh=Math.min(energyKWh,coveredW*duration/60000);
      const cost=goal==='solar'?Math.max(0,energyKWh-coveredKWh)*avgPrice:energyKWh*avgPrice,score=goal==='solar'?-coveredKWh:cost;
      if(!best||score<best.score)best={start:ScheduleManager.fromMinutes(startMinute),end:ScheduleManager.fromMinutes((startMinute+duration)%1440),cost,avgPrice,score,goal,coveredKWh};
    }
    return best;
  }
  /** 96 ticks (15-min resolution) across 24h for the selected day - reuses ScheduleManager's own
   *  interval-membership test so the preview can never disagree with the actual simulation logic. */
  _scheduleTimelineHtml(intervals, isRate, rateOptions){
    const colorFor = (iv)=> isRate ? ((rateOptions.find(r=>r.id===iv.rate)||{}).color||'#4fd1c5') : 'var(--accent-good)';
    let segs = '';
    for (let m=0; m<1440; m+=15){
      const hit = intervals.find(iv=> ScheduleManager._minuteInInterval(m, iv));
      segs += `<div class="tl-seg" style="flex:1;background:${hit?colorFor(hit):'rgba(255,255,255,0.06)'}" title="${ScheduleManager.fromMinutes(m)}"></div>`;
    }
    return `<div class="timeline24">${segs}</div><div class="timeline-hours"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>`;
  }

  // ============================================================
  // NEW SIMULATION WIZARD (section 29)
  // ============================================================
  _bindNewSimModal(){}
  _openNewSimModal(){
    const body = document.getElementById('newSimModalBody');
    body.innerHTML = `
      <div class="field-row"><label>${I18n.t('newsim.projectName')}</label><input type="text" id="nsName" value="${I18n.lang==='pl'?'Nowy Dom':'New Home'}"></div>
      <div class="field-row"><label>${I18n.t('newsim.tariff')}</label>
        <select id="nsTariff">${TariffManager.CODES.map(c=>`<option value="${c}">${c} — ${I18n.t(TariffManager.get(c).shortDescKey)}</option>`).join('')}</select>
      </div>
      <div style="font-size:11.5px;color:var(--accent-danger);margin:10px 0">${I18n.t('newsim.warning')}</div>
      <button class="primary-btn" id="nsConfirm" style="width:100%">${I18n.t('newsim.confirmStart')}</button>`;
    document.getElementById('nsConfirm').addEventListener('click', ()=>{
      const name = document.getElementById('nsName').value;
      const tariffCode = document.getElementById('nsTariff').value;
      this.projectManager.startNewSimulation({ projectName:name, tariffCode });
      if (window.EnergyRoom3D){ window.EnergyRoom3D.buildDemoMainRoom(); window.EnergyRoom3D.buildDemoGarage(); }
      if (window.EnergyRoom3D) window.EnergyRoom3D.buildDemoGarden();
      this.projectManager.pushHistory();
      this.transformManager.deselect();
      this.renderRoomTabs();
      document.getElementById('newSimModal').classList.add('hidden');
      document.getElementById('projectNameLabel').textContent = this.projectManager.projectName;
      this.toast(`🆕 ${I18n.t('log.newProjectCreated')}`);
    });
    document.getElementById('newSimModal').classList.remove('hidden');
  }

  // ============================================================
  // DASHBOARD: STATISTICS RANGE SELECTOR incl. year table (sections 7/8/20) & SAVINGS (section 13)
  // ============================================================
  _renderStatsPane(){
    const wrap = document.getElementById('statsInner');
    this._statsRangeSel = this._statsRangeSel || 'today';
    const sim = this.simulationEngine, s = this.getEnergySettings();
    const proj = this.analyticsManager.projections(sim.todayKWh, sim.todaySolarKWh, sim.todayCost);
    let body = '';
    if (this._statsRangeSel==='today'){
      const bd = this.analyticsManager.breakdownToday(sim);
      body = `
        <div class="stats-grid">
          <div class="stat-box"><div class="lbl">${I18n.t('stats.consumption')}</div><div class="val">${EnergyCalculator.fmtKWh(sim.todayKWh)}</div></div>
          <div class="stat-box"><div class="lbl">${I18n.t('stats.production')}</div><div class="val good">${EnergyCalculator.fmtKWh(sim.todaySolarKWh)}</div></div>
          <div class="stat-box"><div class="lbl">${I18n.t('stats.gridImport')}</div><div class="val">${EnergyCalculator.fmtKWh(sim.todayImportKWh)}</div></div>
          <div class="stat-box"><div class="lbl">${I18n.t('stats.gridExport')}</div><div class="val good">${EnergyCalculator.fmtKWh(sim.todayExportKWh)}</div></div>
        </div>
        <h4>${I18n.t('stats.byCategory')}</h4>
        ${bd.byCategory.map(c=>`<div class="cd-row"><span>${c.label}</span><b>${EnergyCalculator.fmtKWh(c.kWh)} (${c.pct.toFixed(0)}%)</b></div>`).join('') || `<div class="pet-empty-note">—</div>`}
        <h4>${I18n.t('stats.byRoom')}</h4>
        ${bd.byRoom.map(r=>{ const room=this.getRoom(r.id); return `<div class="cd-row"><span>${room?room.name:r.id}</span><b>${EnergyCalculator.fmtKWh(r.kWh)} (${r.pct.toFixed(0)}%)</b></div>`; }).join('') || `<div class="pet-empty-note">—</div>`}`;
    } else if (this._statsRangeSel==='week'){
      body = `<div class="stats-grid">
        <div class="stat-box"><div class="lbl">${I18n.t('stats.consumption')}</div><div class="val">${EnergyCalculator.fmtKWh(proj.week)}</div></div>
        <div class="stat-box"><div class="lbl">${I18n.t('stats.production')}</div><div class="val good">${EnergyCalculator.fmtKWh(proj.weekGen)}</div></div>
        <div class="stat-box"><div class="lbl">${I18n.t('stats.cost')}</div><div class="val">${EnergyCalculator.fmtCost(proj.weekCost,s.currency)}</div></div>
      </div>`;
    } else if (this._statsRangeSel==='month'){
      body = `<div class="stats-grid">
        <div class="stat-box"><div class="lbl">${I18n.t('stats.consumption')}</div><div class="val">${EnergyCalculator.fmtKWh(proj.month)}</div></div>
        <div class="stat-box"><div class="lbl">${I18n.t('stats.production')}</div><div class="val good">${EnergyCalculator.fmtKWh(proj.monthGen)}</div></div>
        <div class="stat-box"><div class="lbl">${I18n.t('stats.cost')}</div><div class="val">${EnergyCalculator.fmtCost(proj.monthCost,s.currency)}</div></div>
      </div>`;
    } else {
      const yb = this.analyticsManager.yearBreakdown();
      body = `<table class="data-table"><thead><tr><th>${I18n.t('common.month')}</th><th>${I18n.t('stats.consumption')}</th><th>${I18n.t('stats.production')}</th><th>${I18n.t('stats.cost')}</th><th></th></tr></thead>
        <tbody>${yb.months.map(mo=>`<tr><td>${mo.label}</td><td>${EnergyCalculator.fmtKWh(mo.consumedKWh)}</td><td>${EnergyCalculator.fmtKWh(mo.solarKWh)}</td><td>${EnergyCalculator.fmtCost(mo.cost,s.currency)}</td><td>${mo.isReal?`<span class="badge real">${I18n.t('common.real')}</span>`:mo.isPartial?`<span class="badge partial">~</span>`:`<span class="badge estimated">${I18n.t('common.estimate')}</span>`}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td><b>${yb.year}</b></td><td><b>${EnergyCalculator.fmtKWh(yb.totals.consumedKWh)}</b></td><td><b>${EnergyCalculator.fmtKWh(yb.totals.solarKWh)}</b></td><td><b>${EnergyCalculator.fmtCost(yb.totals.cost,s.currency)}</b></td><td></td></tr></tfoot>
        </table>`;
    }
    wrap.innerHTML = `
      <div class="stats-range-sel">
        <button class="srange-btn ${this._statsRangeSel==='today'?'active':''}" data-r="today">${I18n.t('stats.range.today')}</button>
        <button class="srange-btn ${this._statsRangeSel==='week'?'active':''}" data-r="week">${I18n.t('stats.range.week')}</button>
        <button class="srange-btn ${this._statsRangeSel==='month'?'active':''}" data-r="month">${I18n.t('stats.range.month')}</button>
        <button class="srange-btn ${this._statsRangeSel==='year'?'active':''}" data-r="year">${I18n.t('stats.range.year')}</button>
      </div>
      ${body}`;
    wrap.querySelectorAll('.srange-btn').forEach(b=>{
      b.addEventListener('click', ()=>{ this._statsRangeSel=b.dataset.r; this._renderStatsPane(); this.petManager.awardDataAnalyzed('stats_'+b.dataset.r, sim.simDayIndex); });
    });
  }

  _renderSavingsPane(){
    const wrap = document.getElementById('savingsInner');
    const s = this.getEnergySettings();
    const sav = this.analyticsManager.savingsAnalysis();
    wrap.innerHTML = `
      <div class="savings-compare">
        <div class="savings-col"><div class="lbl">${I18n.t('stats.withoutPV')}</div><div class="val">${EnergyCalculator.fmtCost(sav.withoutPVMonth,s.currency)}/${I18n.t('common.month')}</div><div class="val2">${EnergyCalculator.fmtCost(sav.withoutPVYear,s.currency)}/${I18n.t('common.year')}</div></div>
        <div class="savings-arrow">→</div>
        <div class="savings-col good"><div class="lbl">${I18n.t('stats.withPV')}</div><div class="val">${EnergyCalculator.fmtCost(sav.withPVMonth,s.currency)}/${I18n.t('common.month')}</div><div class="val2">${EnergyCalculator.fmtCost(sav.withPVYear,s.currency)}/${I18n.t('common.year')}</div></div>
      </div>
      <div class="savings-headline">${sav.reductionPct.toFixed(1)}% ${I18n.t('stats.reduction').toLowerCase()}</div>
      <div class="cd-row"><span>${I18n.t('stats.savings')} / ${I18n.t('common.month')}</span><b class="good-text">${EnergyCalculator.fmtCost(sav.savingMonth,s.currency)}</b></div>
      <div class="cd-row"><span>${I18n.t('stats.savings')} / ${I18n.t('common.year')}</span><b class="good-text">${EnergyCalculator.fmtCost(sav.savingYear,s.currency)}</b></div>
      <div class="cd-row"><span>${I18n.t('stats.lifetimeSavings')}</span><b class="good-text">${EnergyCalculator.fmtCost(sav.lifetimeSavingPLN,s.currency)}</b></div>
      <div class="cd-row"><span>${I18n.t('stats.gridImport')} (${I18n.t('common.since')})</span><b>${EnergyCalculator.fmtKWh(sav.lifetimeImportKWh)}</b></div>
      <div class="cd-row"><span>${I18n.t('stats.gridExport')} (${I18n.t('common.since')})</span><b>${EnergyCalculator.fmtKWh(sav.lifetimeExportKWh)}</b></div>`;
  }
}
