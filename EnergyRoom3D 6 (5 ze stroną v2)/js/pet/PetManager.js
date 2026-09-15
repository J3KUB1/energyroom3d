/**
 * PET MANAGER
 * A small companion that "lives in the cables" - fed by data bits
 * (a trickle of XP from active network/computer devices while the
 * simulation runs) plus manual feeding. Simple deterministic RPG
 * leveling (fixed XP thresholds) - no AI, no learning, no generative
 * behavior, exactly as requested. Purely cosmetic: nothing it does
 * changes energy numbers or device behavior, and there is no
 * multiplayer in this app, so leveling only unlocks cosmetic tricks -
 * never combat/"attack" actions, which would need a multiplayer
 * backend this project doesn't have.
 * Persisted directly to localStorage (it's a companion across
 * projects, not project data - so it deliberately sits outside
 * ProjectManager's undo/redo history).
 */
const PET_STAGES = [
  { level:1, name:'Bit',         emoji:'✨', color:'#4fd1c5', xpToNext:80   },
  { level:2, name:'Pakiet',      emoji:'📦', color:'#67c8ff', xpToNext:220  },
  { level:3, name:'Proces',      emoji:'🌀', color:'#a78bfa', xpToNext:500  },
  { level:4, name:'Serwer',      emoji:'🖥️', color:'#ffb648', xpToNext:1000 },
  { level:5, name:'Rdzeń Sieci', emoji:'🌐', color:'#3ee79b', xpToNext:Infinity },
];
const PET_TRICKS = [
  { atLevel:2, id:'spin',  label:'Zawirowanie' },
  { atLevel:3, id:'pulse', label:'Puls danych' },
  { atLevel:4, id:'burst', label:'Wybuch bitów' },
];

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
    this._load();
  }

  get stage(){ return PET_STAGES[Math.min(this.level-1, PET_STAGES.length-1)]; }
  get xpToNext(){ return this.stage.xpToNext; }
  get xpPct(){ return Math.min(100, (this.xp/this.xpToNext)*100); }
  get unlockedTricks(){ return PET_TRICKS.filter(t=>t.atLevel<=this.level); }

  /** Called once per simulated minute (only while playing) with the count of currently-active
   *  network/computer devices - the "data bits" flowing through the house feed the pet a trickle. */
  tickPassive(activeNetworkDeviceCount){
    if (activeNetworkDeviceCount>0){
      this._gainXP(activeNetworkDeviceCount * 0.015);
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
    this._gainXP(12);
    this.mood = Math.min(100, this.mood + 15);
    this._save();
    this.onChange(this);
    return true;
  }

  rename(name){
    this.name = (name && name.trim()) ? name.trim().slice(0,24) : this.name;
    this._save();
    this.onChange(this);
  }

  _gainXP(amount){
    this.xp += amount;
    while (this.xp >= this.xpToNext && this.level < PET_STAGES.length){
      this.xp -= this.xpToNext;
      this.level++;
      this.onLevelUp(this.stage);
      this.onLog(`🐾 ${this.name} awansował na poziom ${this.level}: ${this.stage.name}!`);
    }
    this._save();
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
      if (typeof d.level === 'number') this.level = Math.max(1, Math.min(PET_STAGES.length, d.level));
      if (typeof d.mood === 'number') this.mood = d.mood;
    } catch(e){ /* corrupt/blocked storage - just start fresh */ }
  }
}
