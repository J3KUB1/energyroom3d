/**
 * QUEST MANAGER
 * Section 19's task system. Every quest's completion condition reads
 * real simulated numbers (a finished day's history entry, or live
 * instance/PV state) - never a random roll. Two kinds:
 *   - milestone: one-off, persists once achieved (e.g. "install your
 *     first PV panel").
 *   - daily: re-evaluated against each freshly-COMPLETED simulated day
 *     (SimulationEngine.history entries / lastCompletedDay), so it can
 *     be earned again on a later day - keeps the loop alive over a long
 *     playthrough instead of being a one-shot checklist.
 * Rewards XP through PetManager.awardQuestComplete() - deliberately not
 * its own separate currency, so the pet's level stays the single
 * visible measure of "how much have I engaged with this house".
 */
const QUEST_DEFINITIONS = [
  { id:'first_pv', type:'milestone', xp:60, titleKey:'quest.firstPv.title', descKey:'quest.firstPv.desc',
    check:(ctx)=> ctx.solarCount >= 1 },
  { id:'first_schedule', type:'milestone', xp:30, titleKey:'quest.firstSchedule.title', descKey:'quest.firstSchedule.desc',
    check:(ctx)=> ctx.scheduleEditedCount >= 1 },
  { id:'first_battery', type:'milestone', xp:40, titleKey:'quest.firstBattery.title', descKey:'quest.firstBattery.desc',
    check:(ctx)=> ctx.batteryCount >= 1 },
  { id:'frugal_morning', type:'daily', xp:15, titleKey:'quest.frugalMorning.title', descKey:'quest.frugalMorning.desc',
    progress:(ctx)=>{
      if (!ctx.dayEntry || !ctx.morningProjectedKWh) return 0;
      const ratio = ctx.dayEntry.morningKWh / ctx.morningProjectedKWh;
      return Math.max(0, Math.min(1, (1-ratio)/0.15));
    },
    check:(ctx)=> ctx.dayEntry && ctx.morningProjectedKWh>0 && (ctx.dayEntry.morningKWh <= ctx.morningProjectedKWh*0.85) },
  { id:'sun_shift', type:'daily', xp:15, titleKey:'quest.sunShift.title', descKey:'quest.sunShift.desc',
    progress:(ctx)=> ctx.dayEntry && ctx.dayEntry.solarKWh>0 ? Math.min(1, ((ctx.dayEntry.solarKWh-ctx.dayEntry.exportKWh)/ctx.dayEntry.solarKWh)/0.6) : 0,
    check:(ctx)=> ctx.dayEntry && ctx.dayEntry.solarKWh>0 && ((ctx.dayEntry.solarKWh-ctx.dayEntry.exportKWh)/ctx.dayEntry.solarKWh) >= 0.6 },
  { id:'cheap_tariff', type:'daily', xp:15, titleKey:'quest.cheapTariff.title', descKey:'quest.cheapTariff.desc',
    progress:(ctx)=>{
      if (!ctx.dayEntry || !ctx.dayEntry.importKWh || ctx.isFlatTariff) return 0;
      const avgPrice = ctx.dayEntry.cost/Math.max(0.01,ctx.dayEntry.importKWh);
      return Math.max(0, Math.min(1, (ctx.effectivePrice-avgPrice)/(ctx.effectivePrice*0.15)));
    },
    check:(ctx)=>{
      if (!ctx.dayEntry || !ctx.dayEntry.importKWh || ctx.isFlatTariff) return false;
      const avgPrice = ctx.dayEntry.cost/Math.max(0.01,ctx.dayEntry.importKWh);
      return avgPrice <= ctx.effectivePrice*0.85;
    } },
  { id:'max_selfuse', type:'daily', xp:25, titleKey:'quest.maxSelfuse.title', descKey:'quest.maxSelfuse.desc',
    progress:(ctx)=> ctx.dayEntry && ctx.dayEntry.solarKWh>0 ? Math.min(1, ((ctx.dayEntry.solarKWh-ctx.dayEntry.exportKWh)/ctx.dayEntry.solarKWh)/0.8) : 0,
    check:(ctx)=> ctx.dayEntry && ctx.dayEntry.solarKWh>0 && ((ctx.dayEntry.solarKWh-ctx.dayEntry.exportKWh)/ctx.dayEntry.solarKWh) >= 0.8 },
];

class QuestManager {
  constructor({ onLog, onComplete } = {}){
    this.onLog = onLog || (()=>{});
    this.onComplete = onComplete || (()=>{}); // (quest) => petManager.awardQuestComplete(quest.xp)
    this.completedMilestones = {}; // id -> true
    this.completedDailyLog = []; // {id, simDayIndex} - last 60, for the "recently completed" list + dedupe
    this.scheduleEditedCount = 0;
    this._load();
  }

  markScheduleEdited(){ this.scheduleEditedCount++; this._save(); }

  /** Milestones: check continuously (cheap - only a few instant conditions), e.g. after PV/battery placement or a schedule save. */
  checkMilestones(ctx){
    for (const q of QUEST_DEFINITIONS){
      if (q.type!=='milestone' || this.completedMilestones[q.id]) continue;
      if (q.check({...ctx, scheduleEditedCount:this.scheduleEditedCount})){
        this.completedMilestones[q.id] = true;
        this._save();
        this.onLog(`🎯 ${I18n.t('pet.questCompleted')} ${I18n.t(q.titleKey)}`);
        this.onComplete(q);
      }
    }
  }

  /** Daily quests: check once, against the day that JUST finished (dayEntry), on day rollover. */
  checkDaily(dayEntry, simDayIndex, extraCtx){
    const ctx = { ...extraCtx, dayEntry };
    for (const q of QUEST_DEFINITIONS){
      if (q.type!=='daily') continue;
      const already = this.completedDailyLog.some(e=>e.id===q.id && e.simDayIndex===simDayIndex);
      if (already) continue;
      if (q.check(ctx)){
        this.completedDailyLog.unshift({ id:q.id, simDayIndex, xp:q.xp });
        if (this.completedDailyLog.length>60) this.completedDailyLog.pop();
        this._save();
        this.onLog(`🎯 ${I18n.t('pet.questCompleted')} ${I18n.t(q.titleKey)}`);
        this.onComplete(q);
      }
    }
  }

  /** For the Quests tab: every quest with its current status/progress, given the latest known context. */
  listWithStatus(ctx){
    const fullCtx = { ...ctx, scheduleEditedCount:this.scheduleEditedCount };
    return QUEST_DEFINITIONS.map(q=>{
      if (q.type==='milestone'){
        return { ...q, done: !!this.completedMilestones[q.id], progress: this.completedMilestones[q.id]?1:(q.check(fullCtx)?1:0) };
      }
      const doneToday = this.completedDailyLog.some(e=>e.id===q.id && e.simDayIndex===ctx.simDayIndex);
      const progress = q.progress ? q.progress(fullCtx) : (doneToday?1:0);
      return { ...q, done: doneToday, progress: Math.max(0,Math.min(1,progress)) };
    });
  }
  recentlyCompleted(limit){ return this.completedDailyLog.slice(0, limit||5); }

  _save(){
    try{ localStorage.setItem('energyroom3d_quests', JSON.stringify({ completedMilestones:this.completedMilestones, completedDailyLog:this.completedDailyLog.slice(0,60), scheduleEditedCount:this.scheduleEditedCount })); }catch(e){}
  }
  _load(){
    try{
      const raw = localStorage.getItem('energyroom3d_quests');
      if (!raw) return;
      const d = JSON.parse(raw);
      this.completedMilestones = d.completedMilestones || {};
      this.completedDailyLog = Array.isArray(d.completedDailyLog) ? d.completedDailyLog : [];
      this.scheduleEditedCount = d.scheduleEditedCount || 0;
    }catch(e){}
  }
}
