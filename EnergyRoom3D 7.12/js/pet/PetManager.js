/**
 * PET MANAGER
 * A small companion that lives in the cables - still purely cosmetic
 * in the sense that it never changes energy numbers or device
 * behavior, and still simple deterministic RPG leveling (a fixed
 * formula, not AI/learning/generative behavior). What changed from
 * the original 5-level version: XP now comes from real, traceable
 * simulated outcomes (energy actually saved, a schedule actually
 * configured, PV actually installed, a quest actually finished,
 * self-consumption actually improved) rather than only a passive
 * "active device" trickle, the curve now runs 50 levels deep with
 * front-loaded easy levels and much steeper later ones (formula-based,
 * so it extends to 100 later with no data migration), and leveling
 * unlocks a mix of real bonus conveniences and genuine cosmetic
 * variety - never anything required for the app's core functionality
 * (spec section 18's explicit constraint).
 * Persisted to localStorage - a companion across projects, not
 * project data, so it deliberately sits outside ProjectManager's
 * project-file JSON.
 */
const PET_STAGES = [
  { atLevel:1,  name:'Bit',              emoji:'✨',  color:'#4fd1c5' },
  { atLevel:3,  name:'Pakiet',           emoji:'📦',  color:'#67c8ff' },
  { atLevel:6,  name:'Proces',           emoji:'🌀',  color:'#a78bfa' },
  { atLevel:10, name:'Serwer',           emoji:'🖥️', color:'#ffb648' },
  { atLevel:15, name:'Rdzeń Sieci',      emoji:'🌐',  color:'#3ee79b' },
  { atLevel:20, name:'Strażnik Sieci',   emoji:'🛡️', color:'#ff8fb1' },
  { atLevel:27, name:'Orbitujący Rdzeń', emoji:'🪐',  color:'#8fd3ff' },
  { atLevel:35, name:'Kwantowy Rdzeń',   emoji:'⚛️',  color:'#c792ff' },
  { atLevel:45, name:'Archiwum Wiedzy',  emoji:'📚',  color:'#ffd166' },
  { atLevel:50, name:'Duch Systemu',     emoji:'👻',  color:'#e0e6ee' },
];
const PET_TRICKS = [
  { atLevel:3,  id:'spin',    labelKey:'pet.trick.spin' },
  { atLevel:6,  id:'pulse',   labelKey:'pet.trick.pulse' },
  { atLevel:10, id:'burst',   labelKey:'pet.trick.burst' },
  { atLevel:20, id:'shimmer', labelKey:'pet.trick.shimmer' },
  { atLevel:30, id:'aura',    labelKey:'pet.trick.aura' },
  { atLevel:50, id:'legend',  labelKey:'pet.trick.legend' },
];
/** Feature unlocks - a mix of real (non-essential) bonuses and cosmetic milestones.
 *  None of these ever gate a core mechanic (tariffs/schedules/PV/priority/stats stay
 *  fully available from level 1 - spec section 18). `kind` lets the UI badge them. */
const PET_UNLOCKS = [
  { atLevel:1,  id:'tips_basic',      kind:'feature',  labelKey:'unlock.tipsBasic' },
  { atLevel:5,  id:'tip_trends',      kind:'feature',  labelKey:'unlock.tipTrends' },
  { atLevel:8,  id:'schedule_presets',kind:'feature',  labelKey:'unlock.schedulePresets' },
  { atLevel:12, id:'tip_seasonal',    kind:'feature',  labelKey:'unlock.tipSeasonal' },
  { atLevel:15, id:'compare_overlay', kind:'feature',  labelKey:'unlock.compareOverlay' },
  { atLevel:25, id:'tip_efficiency',  kind:'feature',  labelKey:'unlock.tipEfficiency' },
  { atLevel:40, id:'quest_master',    kind:'feature',  labelKey:'unlock.questMaster' },
];
/** xpToNext(level): front levels cheap, later levels much steeper - pure formula so it extends
 *  to level 100+ later with zero data migration (spec section 17's explicit ask). */
function petXpToNext(level){ return Math.round(35 * Math.pow(level, 1.62) + 18*level); }
const PET_MAX_LEVEL = 50;

class PetManager {
  constructor({ onLog, onLevelUp, onChange } = {}){
    this.onLog = onLog || (()=>{});
    this.onLevelUp = onLevelUp || (()=>{});
    this.onChange = onChange || (()=>{});
    this.name = 'Byte';
    this.xp = 0;
    this.level = 1;
    this.mood = 80; // 0..100, cosmetic only
    this._lastFeedTs = 0;
    this._dailyAwardKeys = {}; // dedupe key -> simDayIndex, so daily/interaction bonuses can't be farmed by spam-clicking
    this._load();
  }

  get stage(){ let s=PET_STAGES[0]; for (const st of PET_STAGES) if (st.atLevel<=this.level) s=st; return s; }
  get xpToNext(){ return this.level>=PET_MAX_LEVEL ? Infinity : petXpToNext(this.level); }
  get xpPct(){ return this.level>=PET_MAX_LEVEL ? 100 : Math.min(100, (this.xp/this.xpToNext)*100); }
  get unlockedTricks(){ return PET_TRICKS.filter(t=>t.atLevel<=this.level); }
  get unlockedFeatures(){ return PET_UNLOCKS.filter(u=>u.atLevel<=this.level); }
  hasFeature(id){ return this.unlockedFeatures.some(u=>u.id===id); }
  get nextUnlock(){ return PET_UNLOCKS.concat(PET_TRICKS.map(t=>({atLevel:t.atLevel,labelKey:t.labelKey}))).filter(u=>u.atLevel>this.level).sort((a,b)=>a.atLevel-b.atLevel)[0] || null; }

  /** Called once per simulated minute (only while playing) with the count of currently-active
   *  network/computer devices - a small ambient trickle, kept from the original version. */
  tickPassive(activeNetworkDeviceCount){
    if (activeNetworkDeviceCount>0){
      this._gainXP(activeNetworkDeviceCount * 0.01, null);
      this.mood = Math.min(100, this.mood + 0.02);
    } else {
      this.mood = Math.max(0, this.mood - 0.01);
    }
    this.onChange(this);
  }

  /** Direct feed button - small cooldown so it can't be spammed for instant max level. */
  feed(){
    const now = Date.now();
    if (now - this._lastFeedTs < 4000) return false;
    this._lastFeedTs = now;
    this._gainXP(6, null);
    this.mood = Math.min(100, this.mood + 15);
    this._save();
    this.onChange(this);
    return true;
  }

  /** section 17 XP sources - each traces to a real, checkable simulated outcome. `dedupeKey` +
   *  `simDayIndex` prevent the same day's outcome (or the same one-off action) from being farmed
   *  by re-opening a panel or re-saving the same schedule repeatedly. */
  awardDailyOutcome(dayEntry, sim, simDayIndex){
    const key = 'daily:'+simDayIndex;
    if (this._dailyAwardKeys[key]) return;
    this._dailyAwardKeys[key] = true;
    let xp = 2; // baseline for having played a full simulated day at all
    const selfConsumptionPct = dayEntry.solarKWh>0 ? Math.max(0,(dayEntry.solarKWh-dayEntry.exportKWh)/dayEntry.solarKWh*100) : 0;
    if (selfConsumptionPct >= 70) xp += 8; else if (selfConsumptionPct >= 50) xp += 4;
    const baselineCost = dayEntry.consumedKWh * EnergyCalculator.effectivePrice(sim.getSettings ? sim.getSettings() : {});
    const saved = Math.max(0, baselineCost - dayEntry.cost);
    xp += Math.min(20, saved*1.2);
    this._gainXP(xp, I18n.t('pet.xpReason.dailyOutcome'));
  }
  awardScheduleSaved(instId){
    const key = 'sched:'+instId+':'+Math.floor(Date.now()/60000/60); // once per instance per simulated-ish hour window
    if (this._dailyAwardKeys[key]) return;
    this._dailyAwardKeys[key] = true;
    this._gainXP(10, I18n.t('pet.xpReason.schedule'));
  }
  awardPVInstalled(newPanelTotalCount){
    const key = 'pv:'+newPanelTotalCount;
    if (this._dailyAwardKeys[key]) return;
    this._dailyAwardKeys[key] = true;
    const xp = newPanelTotalCount<=1 ? 80 : Math.max(6, 24 - newPanelTotalCount*1.5);
    this._gainXP(xp, I18n.t('pet.xpReason.pvInstall'));
  }
  awardQuestComplete(xpReward){ this._gainXP(xpReward, I18n.t('pet.xpReason.quest')); }
  awardDataAnalyzed(tabId, simDayIndex){
    const key = 'tab:'+tabId+':'+simDayIndex;
    if (this._dailyAwardKeys[key]) return;
    this._dailyAwardKeys[key] = true;
    this._gainXP(3, I18n.t('pet.xpReason.analysis'));
  }
  awardEfficiencyImproved(scoreDelta){
    if (scoreDelta<=0) return;
    this._gainXP(Math.min(15, scoreDelta*1.5), I18n.t('pet.xpReason.efficiency'));
  }

  rename(name){
    this.name = (name && name.trim()) ? name.trim().slice(0,24) : this.name;
    this._save();
    this.onChange(this);
  }

  _gainXP(amount, reason){
    if (!(amount>0)) return;
    this.xp += amount;
    while (this.level < PET_MAX_LEVEL && this.xp >= this.xpToNext){
      this.xp -= this.xpToNext;
      this.level++;
      this.onLevelUp(this.stage, this.level);
      this.onLog(`🐾 ${this.name} ${I18n.t('pet.leveledUp', { level: this.level, stage: I18n.petStage(this.stage) })}`);
    }
    this._save();
    this.onChange(this);
  }

  _save(){
    try { localStorage.setItem('energyroom3d_pet', JSON.stringify({ name:this.name, xp:this.xp, level:this.level, mood:this.mood })); }
    catch(e){ /* best effort - a full/blocked localStorage just means the pet won't persist */ }
  }
  _load(){
    try {
      const raw = localStorage.getItem('energyroom3d_pet');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.name) this.name = d.name;
      if (typeof d.xp === 'number') this.xp = d.xp;
      if (typeof d.level === 'number') this.level = Math.max(1, Math.min(PET_MAX_LEVEL, d.level));
      if (typeof d.mood === 'number') this.mood = d.mood;
    } catch(e){ /* corrupt/blocked storage - just start fresh */ }
  }
}
