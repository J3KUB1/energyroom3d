/**
 * SCHEDULE MANAGER
 * Resolves, for any device instance and any simulated minute, which
 * state the device is in and how much power it draws. Also the single
 * source of truth for the "rich schedule" data shape used by the
 * schedule editor UI: independent, multi-interval, per-weekday windows
 * (e.g. Monday 06:30-08:00 + 16:00-22:30, Tuesday different hours,
 * Sunday off entirely), with full support for intervals that cross
 * midnight (22:00 -> 02:00).
 *
 * Day index convention throughout the whole app: 0=Sunday .. 6=Saturday
 * (matches JS Date#getDay()), exactly like the original single-window
 * schedule already did - this file only adds richness, it doesn't
 * change that convention.
 *
 * BACKWARD COMPATIBILITY: old projects (and old device defaults in
 * devices.js) store schedule as a flat {start,end,days:[...],cycles:[...]}.
 * normalize() upgrades that on first touch into the rich per-day shape;
 * nothing is ever lost, and re-serializing a normalized schedule stays
 * fully readable by this same normalize() (it's idempotent).
 *
 * Pure logic - no THREE.js, no DOM. Unity mapping: ScheduleManager +
 * a per-device RuntimeState updated by SimulationManager.Tick().
 */
const ScheduleManager = {
  DAY_KEYS: [0,1,2,3,4,5,6],
  WEEKDAY_KEYS: [1,2,3,4,5],
  WEEKEND_KEYS: [0,6],

  // ---------------- time helpers ----------------
  /** "HH:MM" -> minutes since midnight */
  toMinutes(hhmm){
    const [h,m] = hhmm.split(':').map(Number);
    return h*60+m;
  },
  fromMinutes(min){
    min = ((min%1440)+1440)%1440;
    const h = Math.floor(min/60), m = Math.floor(min%60);
    return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
  },
  isValidTime(hhmm){ return typeof hhmm==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm); },

  // ---------------- rich schedule shape ----------------
  /**
   * Returns a normalized rich schedule:
   * { enabled:bool, days:{0:[{start,end}],1:[...],...,6:[...]}, cycles:{0:[...],...,6:[...]} }
   * Accepts: already-rich schedules (days is a plain object), legacy
   * schedules (days is an array + top-level start/end/cycles), or
   * null/undefined (falls back to `fallbackDef.defaultSchedule` if given,
   * else an "always on, every day" schedule).
   */
  normalize(schedule, fallbackDef){
    const src = schedule || (fallbackDef && fallbackDef.defaultSchedule) || { start:'00:00', end:'23:59', days:[0,1,2,3,4,5,6] };
    const out = { enabled: src.enabled !== false, days: {}, cycles: {} };
    if (src.days && !Array.isArray(src.days) && typeof src.days === 'object'){
      // already rich - defensive per-day copy + validation
      for (const d of this.DAY_KEYS){
        out.days[d] = Array.isArray(src.days[d]) ? src.days[d].filter(iv=>iv && this.isValidTime(iv.start) && this.isValidTime(iv.end)).map(iv=>({start:iv.start,end:iv.end})) : [];
      }
      const srcCycles = src.cycles && !Array.isArray(src.cycles) ? src.cycles : {};
      for (const d of this.DAY_KEYS) out.cycles[d] = Array.isArray(srcCycles[d]) ? srcCycles[d].filter(t=>this.isValidTime(t)) : [];
      return out;
    }
    // legacy: single {start,end} window replicated across `days` array, single shared `cycles` list
    const legacyDays = Array.isArray(src.days) ? src.days.filter(d=>d>=0&&d<=6) : [0,1,2,3,4,5,6];
    const start = this.isValidTime(src.start) ? src.start : '00:00';
    const end = this.isValidTime(src.end) ? src.end : '23:59';
    const legacyCycles = Array.isArray(src.cycles) ? src.cycles.filter(t=>this.isValidTime(t)) : [];
    for (const d of this.DAY_KEYS){
      out.days[d] = legacyDays.includes(d) ? [{start,end}] : [];
      out.cycles[d] = legacyDays.includes(d) ? [...legacyCycles] : [];
    }
    return out;
  },
  /** Public entry point used by ObjectManager.setSchedule / ProjectManager - normalize + defensive copy */
  validateSchedule(schedule, fallbackDef){
    return this.normalize(schedule, fallbackDef);
  },

  intervalsForDay(schedule, dayIdx){
    if (!schedule || !schedule.days) return [];
    return schedule.days[((dayIdx%7)+7)%7] || [];
  },
  cyclesForDay(schedule, dayIdx){
    if (!schedule || !schedule.cycles) return [];
    return schedule.cycles[((dayIdx%7)+7)%7] || [];
  },
  setDayIntervals(schedule, dayIdx, intervals){
    schedule.days[((dayIdx%7)+7)%7] = intervals.filter(iv=>this.isValidTime(iv.start)&&this.isValidTime(iv.end));
    return schedule;
  },
  addInterval(schedule, dayIdx, interval){
    const d = ((dayIdx%7)+7)%7;
    schedule.days[d] = [...(schedule.days[d]||[]), interval];
    return schedule;
  },
  removeInterval(schedule, dayIdx, index){
    const d = ((dayIdx%7)+7)%7;
    schedule.days[d] = (schedule.days[d]||[]).filter((_,i)=>i!==index);
    return schedule;
  },
  /** Copy one day's intervals+cycles onto a list of other days (the schedule editor's "apply to other days") */
  copyDayToOthers(schedule, fromDay, toDays){
    const f = ((fromDay%7)+7)%7;
    const src = (schedule.days[f]||[]).map(iv=>({...iv}));
    const srcCycles = (schedule.cycles[f]||[]).slice();
    for (const d of toDays){
      const dd = ((d%7)+7)%7;
      if (dd===f) continue;
      schedule.days[dd] = src.map(iv=>({...iv}));
      schedule.cycles[dd] = srcCycles.slice();
    }
    return schedule;
  },
  /** Day index presets for the editor's quick-select chips */
  presets(){
    return {
      all: [0,1,2,3,4,5,6],
      weekdays: [1,2,3,4,5],
      weekend: [0,6],
    };
  },

  /** true if `minuteOfDay` (0..1439) falls inside interval, handling midnight wrap (22:00->02:00) */
  _minuteInInterval(minuteOfDay, iv){
    const s = this.toMinutes(iv.start), e = this.toMinutes(iv.end);
    if (s === e) return true; // 24h
    if (s < e) return minuteOfDay >= s && minuteOfDay < e;
    return minuteOfDay >= s || minuteOfDay < e; // wraps past midnight
  },

  /**
   * Finds which interval (if any) is active at `absMin`, checking both
   * today's intervals AND yesterday's intervals that wrap into today
   * (e.g. a 22:00->02:00 interval defined on Monday is still "active"
   * on Tuesday between 00:00 and 02:00).
   * Returns {active, interval, ownerDay, windowStartAbs, windowEndAbs} or {active:false}.
   */
  activeIntervalAt(schedule, absMin){
    if (!schedule || schedule.enabled===false) return { active:false };
    const dayIdx = Math.floor(absMin/1440)%7;
    const prevDay = ((dayIdx-1)%7+7)%7;
    const minuteOfDay = absMin % 1440;
    const dayBase = absMin - minuteOfDay;

    for (const iv of this.intervalsForDay(schedule, dayIdx)){
      const s = this.toMinutes(iv.start), e = this.toMinutes(iv.end);
      if (s <= e){
        if (minuteOfDay >= s && minuteOfDay < e) return { active:true, interval:iv, ownerDay:dayIdx, windowStartAbs: dayBase+s, windowEndAbs: dayBase+e };
      } else {
        // wraps past midnight - the part that falls on `dayIdx` itself is [s,1440)
        if (minuteOfDay >= s) return { active:true, interval:iv, ownerDay:dayIdx, windowStartAbs: dayBase+s, windowEndAbs: dayBase+1440+e };
      }
    }
    for (const iv of this.intervalsForDay(schedule, prevDay)){
      const s = this.toMinutes(iv.start), e = this.toMinutes(iv.end);
      if (s > e && minuteOfDay < e){ // yesterday's wrap bleeding into today, e.g. 22:00->02:00
        return { active:true, interval:iv, ownerDay:prevDay, windowStartAbs: dayBase-1440+s, windowEndAbs: dayBase+e };
      }
    }
    return { active:false };
  },

  /** Is `day` (0=Sun..6=Sat) included in a *legacy* schedule.days array - kept for any external caller still using old shape */
  dayActive(schedule, day){
    return !schedule.days || (Array.isArray(schedule.days) ? schedule.days.includes(day) : (schedule.days[day]||[]).length>0);
  },

  /**
   * Resolve device state + power at absolute simulated minute `absMin`.
   * Returns {state, powerW}. `inst` is the placed device instance
   * (has .def, .schedule, .connected, .runtime{}).
   */
  resolve(inst, absMin){
    const def = inst.def;
    if (!inst.connected) return { state:'off', powerW:0 };
    const schedule = this.normalize(inst.schedule, def);

    if (def.profileType === 'always'){
      return { state:'on', powerW: def.states.on };
    }

    if (def.profileType === 'continuous'){
      return this._resolveCycle(def.cycleSequence, absMin, def.states, true);
    }

    if (def.profileType === 'window'){
      const found = this.activeIntervalAt(schedule, absMin);
      if (!found.active){
        const st = def.idleState;
        return { state: st, powerW: def.states[st] ?? 0 };
      }
      const windowLen = found.windowEndAbs - found.windowStartAbs || 1440;
      const posInWindow = absMin - found.windowStartAbs;
      let acc = 0;
      for (const step of def.windowProfile){
        const dur = step.fraction * windowLen;
        if (posInWindow < acc+dur){
          return { state: step.state, powerW: def.states[step.state] ?? 0 };
        }
        acc += dur;
      }
      const last = def.windowProfile[def.windowProfile.length-1];
      return { state:last.state, powerW: def.states[last.state] ?? 0 };
    }

    if (def.profileType === 'cycle'){
      // find the most recent trigger (today or yesterday, in case a cycle spans midnight) that is still running
      const cycleTotal = def.cycleSequence.reduce((s,c)=>s+c.minutes,0);
      const dayIdx = Math.floor(absMin/1440)%7;
      const todayStartAbs = absMin - (absMin%1440);
      for (const dOff of [0,-1]){
        const trigDay = ((dayIdx+dOff)%7+7)%7;
        const dayStartAbs = todayStartAbs + dOff*1440;
        for (const t of this.cyclesForDay(schedule, trigDay)){
          const trigAbsMin = dayStartAbs + this.toMinutes(t);
          const elapsed = absMin - trigAbsMin;
          if (elapsed >= 0 && elapsed < cycleTotal){
            return this._resolveCycle(def.cycleSequence, elapsed, def.states, false);
          }
        }
      }
      const st = def.idleState;
      return { state: st, powerW: def.states[st] ?? 0 };
    }

    return { state:'off', powerW:0 };
  },
  /** For continuous loops: elapsed = absMin mod total. For single-shot: elapsed passed directly */
  _resolveCycle(sequence, elapsedOrAbs, states, loop){
    const total = sequence.reduce((s,c)=>s+c.minutes,0) || 1;
    let pos = loop ? (((elapsedOrAbs%total)+total)%total) : elapsedOrAbs;
    let acc = 0;
    for (const step of sequence){
      if (pos < acc+step.minutes) return { state: step.state, powerW: states[step.state] ?? 0 };
      acc += step.minutes;
    }
    const last = sequence[sequence.length-1];
    return { state:last.state, powerW: states[last.state] ?? 0 };
  },
  /** Representative "fully on" state for a device definition - used by the manual power
   *  switch (spec: user should be able to force a device on/off regardless of schedule). */
  dominantState(def){
    if (def.profileType === 'always') return 'on';
    if (def.profileType === 'window'){
      let best = def.windowProfile[0];
      for (const step of def.windowProfile) if (step.fraction > best.fraction) best = step;
      return best.state;
    }
    if (def.profileType === 'cycle' || def.profileType === 'continuous'){
      return def.cycleSequence[0].state;
    }
    return Object.keys(def.states)[0];
  },

  /** Human-readable "8h/day, Mon-Fri" style summary of a rich schedule - used in list views/tooltips. lang: 'pl'|'en' */
  summarize(schedule, lang){
    lang = lang || 'pl';
    if (!schedule || schedule.enabled===false) return lang==='pl' ? 'Wyłączony harmonogram' : 'Schedule disabled';
    const activeDays = this.DAY_KEYS.filter(d=>(schedule.days[d]||[]).length>0);
    if (!activeDays.length) return lang==='pl' ? 'Brak aktywnych dni' : 'No active days';
    const preset = this.presets();
    const eq = (a,b)=> a.length===b.length && a.every(x=>b.includes(x));
    let dayLabel;
    if (eq(activeDays, preset.all)) dayLabel = lang==='pl' ? 'codziennie' : 'every day';
    else if (eq(activeDays, preset.weekdays)) dayLabel = lang==='pl' ? 'dni robocze' : 'weekdays';
    else if (eq(activeDays, preset.weekend)) dayLabel = lang==='pl' ? 'weekend' : 'weekends';
    else {
      const short = lang==='pl' ? ['Nd','Pn','Wt','Śr','Cz','Pt','So'] : ['Su','Mo','Tu','We','Th','Fr','Sa'];
      dayLabel = activeDays.map(d=>short[d]).join(', ');
    }
    let totalMin = 0;
    for (const d of activeDays){
      for (const iv of schedule.days[d]){
        const s = this.toMinutes(iv.start), e = this.toMinutes(iv.end);
        totalMin += (e>s) ? (e-s) : (1440-s+e);
      }
    }
    const avgH = activeDays.length ? (totalMin/activeDays.length/60) : 0;
    return `${avgH.toFixed(1)}h/${lang==='pl'?'dzień':'day'} · ${dayLabel}`;
  },
};
