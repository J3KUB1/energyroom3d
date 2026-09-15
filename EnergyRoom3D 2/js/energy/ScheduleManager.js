/**
 * SCHEDULE MANAGER
 * Resolves, for any device instance and any simulated minute-of-week,
 * which state the device is in and how much power it draws.
 * Pure logic - no THREE.js, no DOM. Unity mapping: ScheduleManager + a
 * per-device RuntimeState updated by SimulationManager.Tick().
 */
const ScheduleManager = {
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
  /** Is `day` (0=Sun..6=Sat) included in schedule.days */
  dayActive(schedule, day){
    return !schedule.days || schedule.days.includes(day);
  },
  /** Returns true if minuteOfDay falls inside [start,end) window, handling midnight wrap */
  inWindow(schedule, minuteOfDay){
    const s = this.toMinutes(schedule.start), e = this.toMinutes(schedule.end);
    if (s === e) return true; // 24h
    if (s < e) return minuteOfDay >= s && minuteOfDay < e;
    return minuteOfDay >= s || minuteOfDay < e; // wraps past midnight
  },
  /**
   * Resolve device state + power at absolute simulated minute `absMin`
   * (minutes since simulation epoch). Returns {state, powerW}.
   * `inst` is the placed device instance (has .def, .schedule, .connected, .runtime{})
   */
  resolve(inst, absMin){
    const def = inst.def;
    if (!inst.connected) return { state:'off', powerW:0 };
    const dayIdx = Math.floor(absMin/1440) % 7;
    const minuteOfDay = absMin % 1440;
    const schedule = inst.schedule || def.defaultSchedule;

    if (def.profileType === 'always'){
      return { state:'on', powerW: def.states.on };
    }

    if (def.profileType === 'continuous'){
      return this._resolveCycle(def.cycleSequence, absMin, def.states, true);
    }

    if (def.profileType === 'window'){
      const active = this.dayActive(schedule, dayIdx) && this.inWindow(schedule, minuteOfDay);
      if (!active) {
        const st = def.idleState;
        return { state: st, powerW: def.states[st] ?? 0 };
      }
      // position within the window, 0..windowLen
      const s = this.toMinutes(schedule.start), e = this.toMinutes(schedule.end);
      const windowLen = (e>s) ? (e-s) : (1440-s+e) || 1440;
      const posInWindow = ((minuteOfDay - s) % 1440 + 1440) % 1440;
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
      const todayStartAbs = absMin - minuteOfDay;
      for (const t of (schedule.cycles||[])){
        for (const dOff of [0,-1]){
          const trigDay = ((dayIdx+dOff)%7+7)%7;
          if (!this.dayActive(schedule, trigDay)) continue;
          const dayStartAbs = todayStartAbs + dOff*1440;
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
  validateSchedule(schedule){
    // defensive validation per spec section 49
    const out = { start:'00:00', end:'23:59', days:[0,1,2,3,4,5,6] };
    try {
      if (schedule.start && /^\d{2}:\d{2}$/.test(schedule.start)) out.start = schedule.start;
      if (schedule.end && /^\d{2}:\d{2}$/.test(schedule.end)) out.end = schedule.end;
      if (Array.isArray(schedule.days) && schedule.days.length) out.days = schedule.days.filter(d=>d>=0&&d<=6);
      if (Array.isArray(schedule.cycles)) out.cycles = schedule.cycles.filter(c=>/^\d{2}:\d{2}$/.test(c));
    } catch(e){ /* fall back to defaults */ }
    return out;
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
  }
};
