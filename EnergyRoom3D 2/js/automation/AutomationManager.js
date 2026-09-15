/**
 * AUTOMATION MANAGER
 * Simple IF / THEN / AFTER rule engine for the Smart Home tab.
 * Rules don't touch THREE.js or the DOM directly - they only set
 * `instance.runtime.automationOverride` which SimulationEngine reads
 * ahead of the normal schedule-based resolution.
 * Unity mapping: AutomationManager MonoBehaviour + AutomationRule SO.
 */
class AutomationManager {
  constructor({ getInstances, onLog }){
    this.getInstances = getInstances;
    this.onLog = onLog || (()=>{});
    this.rules = [];
    this.context = { presence: true, tempC: 23 };
    this._firedToday = new Set(); // rule ids fired today (for 'time' triggers, once/day)
    this._lastDay = -1;
  }

  addRule(rule){
    rule.id = rule.id || ('rule_'+Date.now()+'_'+Math.floor(Math.random()*1000));
    this.rules.push(rule);
    return rule;
  }
  removeRule(id){ this.rules = this.rules.filter(r=>r.id!==id); }

  setPresence(v){ this.context.presence = v; }
  setTemp(v){ this.context.tempC = v; }

  /** Called every simulated minute by SimulationEngine */
  evaluate(absMin){
    const day = Math.floor(absMin/1440);
    if (day !== this._lastDay){ this._lastDay = day; this._firedToday.clear(); }
    const instances = this.getInstances();
    const minuteOfDay = absMin % 1440;

    for (const rule of this.rules){
      const target = instances.find(i=>i.id===rule.targetInstId);
      if (!target) continue;
      let conditionMet = false;
      if (rule.ifType === 'time'){
        conditionMet = ScheduleManager.toMinutes(rule.ifValue) === minuteOfDay && !this._firedToday.has(rule.id);
        if (conditionMet) this._firedToday.add(rule.id);
      } else if (rule.ifType === 'noPresence'){
        conditionMet = this.context.presence === false;
      } else if (rule.ifType === 'presence'){
        conditionMet = this.context.presence === true;
      } else if (rule.ifType === 'tempAbove'){
        conditionMet = this.context.tempC > rule.ifValue;
      }

      if (conditionMet){
        this._applyState(target, rule.thenState, absMin, rule);
        if (rule.afterMinutes && rule.thenState2){
          target.runtime.pendingAutomation = { atMin: absMin+rule.afterMinutes, state: rule.thenState2, ruleName: rule.name };
        }
      }

      // resolve any pending delayed action ("AFTER 5 minut -> wyłącz")
      const pending = target.runtime.pendingAutomation;
      if (pending && absMin >= pending.atMin){
        this._applyState(target, pending.state, absMin, rule);
        target.runtime.pendingAutomation = null;
      }
    }
  }

  _applyState(inst, state, absMin, rule){
    const wasOverride = inst.runtime.automationOverride;
    if (wasOverride && wasOverride.state===state) return;
    inst.runtime.automationOverride = { state, since: absMin };
    this.onLog(`[Automatyzacja] ${rule.name}: ${inst.customName||inst.def.name} → ${state}`);
  }

  clearOverride(instId){
    const inst = this.getInstances().find(i=>i.id===instId);
    if (inst) inst.runtime.automationOverride = null;
  }
}
