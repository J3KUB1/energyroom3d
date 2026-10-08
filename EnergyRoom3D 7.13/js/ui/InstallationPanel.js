/**
 * INSTALLATION PANEL
 * The editor / monitor for the house wiring: main breaker, circuits + breakers + cables (with live load bars),
 * sockets / strips / device plugs, wire routing + lengths, design diagnostics and the itemised installation cost.
 * DOM only; every change goes through ElectricalSystem and then calls onChange() (history, wire redraw, re-render).
 * No THREE.js dependency, so it can be tested in a plain browser page.
 */
class InstallationPanel {
  constructor(container, opts){
    this.el = container;
    this.e = opts.electrical;
    this.onChange = opts.onChange || (()=>{});
    this.onSelect = opts.onSelect || (()=>{});
    this.onAddElement = opts.onAddElement || (()=>{});
    this.getEconomics = opts.getEconomics || (()=>null);
    this.getWireVisible = opts.getWireVisible || (()=>true);
    this.onWireVisible = opts.onWireVisible || (()=>{});
    this.tab = 'circuits';
    this.el.classList.add('ip-root');
  }

  static esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c])); }
  static fmtA(a){ return I18n.num(a, a < 10 ? 2 : 1) + ' A'; }
  static fmtW(w){ return w >= 1000 ? I18n.num(w/1000, 2) + ' kW' : Math.round(w) + ' W'; }
  static fmtZl(v){ return I18n.num(v, 2) + ' zł'; }

  /** Device / socket labels shared with the properties panel. */
  socketLabel(s){
    if (s.customName) return s.customName;
    const room = this.e._room(s.roomId), n = this.e.sockets(s.roomId).indexOf(s) + 1;
    return `${room.name} · ${I18n.t('elec.socketShort')} ${n}`;
  }
  targetLabel(t){
    if (t.def.type === 'strip') return t.customName || `${I18n.t('elec.stripShort')} · ${this.e._room(t.roomId).name}`;
    return this.socketLabel(t);
  }
  circuitLabel(c){ return c.name || c.id; }
  breakerLabel(b){ return `${b.curve}${b.ratingA} A` + (b.name ? ' · ' + b.name : ''); }
  deviceLabel(d){ return d.customName || I18n.deviceName(d.def); }

  /** <option>s for "plug this device into ..." (targets with a free outlet, plus the current one). */
  static plugOptions(panelOrSystem, dev, esc){
    const sys = panelOrSystem.e || panelOrSystem, lab = panelOrSystem.targetLabel ? (t)=>panelOrSystem.targetLabel(t) : (t)=>t.id;
    const opts = [`<option value="">${I18n.t('elec.notPlugged')}</option>`];
    const targets = sys.sockets().concat(sys.strips());
    targets.sort((a, b) => (a.roomId === dev.roomId ? -1 : 1) - (b.roomId === dev.roomId ? -1 : 1));
    for (const t of targets){
      const free = sys.freeOutlets(t.id);
      if (free <= 0 && dev.plugTo !== t.id) continue;
      opts.push(`<option value="${t.id}" ${dev.plugTo === t.id ? 'selected' : ''}>${InstallationPanel.esc(lab(t))} (${I18n.t('elec.freeOutlets', { n: free + (dev.plugTo === t.id ? 1 : 0) })})</option>`);
    }
    return opts.join('');
  }

  // ------------------------------------------------------------------ render
  render(){
    const e = this.e, d = e.data;
    const diags = e.diagnostics();
    const tabs = ['circuits', 'elements', 'devices', 'costs'];
    this.el.innerHTML = `
      ${this._mainHtml(diags)}
      <div class="ip-tabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" class="ip-tab ${this.tab===t?'active':''}" data-tab="${t}">${I18n.t('elec.tab.'+t)}</button>`).join('')}</div>
      <div class="ip-body">${this['_' + this.tab + 'Html']()}</div>`;
    this._bind();
  }

  /** Called periodically while the modal is open: re-renders unless the user is typing/choosing in a control. */
  tick(){
    const a = document.activeElement;
    if (a && this.el.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    this.render();
  }

  _mainHtml(diags){
    const e = this.e, d = e.data, m = d.mainBreaker, rt = e.rt.main;
    const pct = Math.min(100, Math.round(rt.ratio * 100));
    const col = rt.ratio < 0.7 ? 'var(--accent-good)' : rt.ratio < 1 ? 'var(--accent-power)' : 'var(--accent-danger)';
    const tripped = m.state === 'tripped';
    const issues = diags.filter(x => x.level !== 'info');
    return `
    <div class="ip-card ip-main ${tripped ? 'ip-bad' : ''}">
      <div class="ip-row">
        <b>${I18n.t('elec.mainBreaker')}</b>
        <select class="ip-main-rating" aria-label="${I18n.t('elec.mainBreaker')}">${MAIN_BREAKER_RATINGS.map(r => `<option value="${r}" ${r===m.ratingA?'selected':''}>${r} A</option>`).join('')}</select>
        <span class="ip-pill ${tripped ? 'bad' : 'ok'}">${tripped ? I18n.t('elec.state.tripped') : I18n.t('elec.state.closed')}</span>
        ${tripped ? `<button type="button" class="small-btn ip-reset-main">${I18n.t('elec.reset')}</button>` : ''}
      </div>
      <div class="ip-bar"><div class="ip-fill" style="width:${pct}%;background:${col}"></div></div>
      <div class="ip-sub">${I18n.t('elec.houseLoad')}: ${InstallationPanel.fmtA(rt.currentA)} / ${m.ratingA} A · ${InstallationPanel.fmtW(rt.currentA * d.supplyVoltageV)} · ${I18n.t('elec.cableLosses')}: ${I18n.num(e.rt.lossW, 0)} W</div>
      <label class="ip-check"><input type="checkbox" class="ip-strict" ${d.strict ? 'checked' : ''}> ${I18n.t('elec.strict')}</label>
      <label class="ip-check"><input type="checkbox" class="ip-wires" ${this.getWireVisible() ? 'checked' : ''}> ${I18n.t('elec.showWires')}</label>
      ${issues.length ? `<ul class="ip-issues">${issues.map(x => `<li class="ip-${x.level}">${I18n.t('elec.diag.' + x.code, this._diagParams(x))}</li>`).join('')}</ul>` : `<div class="ip-ok">✔ ${I18n.t('elec.noIssues')}</div>`}
    </div>`;
  }
  _diagParams(x){
    const p = Object.assign({}, x.params || {}), map = this.e._elMap();
    if (p.id && map.has(p.id)) p.name = this.targetLabel(map.get(p.id));
    return p;
  }

  _circuitsHtml(){
    const e = this.e, d = e.data;
    const cards = d.circuits.map(c => {
      const b = c.breakerId ? e.breaker(c.breakerId) : null, cab = getCableType(c.cableId), rt = e.rt.circuits[c.id] || { currentA:0, powerW:0, voltageV:d.supplyVoltageV, maxA:0, maxW:0, lossW:0 };
      const sockets = e.sockets().filter(s => s.circuitId === c.id);
      const damaged = sockets.some(s => { const w = e.wireOf(s.id); return w && w.damaged; });
      const tripped = b && b.state === 'tripped';
      const maxA = b ? Math.min(b.ratingA, cab.ampacityA) : 0;
      const ratio = maxA ? rt.currentA / maxA : 0, pct = Math.min(100, Math.round(ratio * 100));
      const col = ratio < 0.7 ? 'var(--accent-good)' : ratio < 1 ? 'var(--accent-power)' : 'var(--accent-danger)';
      const under = b && b.ratingA > cab.ampacityA;
      return `
      <div class="ip-card ${tripped || damaged ? 'ip-bad' : ''}" data-circuit="${c.id}">
        <div class="ip-row">
          <input class="ip-name" value="${InstallationPanel.esc(c.name)}" placeholder="${I18n.t('elec.circuitName')}" aria-label="${I18n.t('elec.circuitName')}">
          <span class="ip-pill ${tripped || damaged ? 'bad' : 'ok'}">${damaged ? I18n.t('elec.state.cableDamaged') : tripped ? I18n.t('elec.state.tripped') : I18n.t('elec.state.closed')}</span>
        </div>
        <div class="ip-grid">
          <label>${I18n.t('elec.breaker')}<select class="ip-breaker">
            ${d.breakers.map(x => `<option value="${x.id}" ${x.id===c.breakerId?'selected':''}>${InstallationPanel.esc(this.breakerLabel(x))}</option>`).join('')}
            <option value="__new">＋ ${I18n.t('elec.newBreaker')}</option></select></label>
          <label>${I18n.t('elec.rating')}<span class="ip-inline"><select class="ip-rating" ${b?'':'disabled'}>${BREAKER_RATINGS.map(r => `<option value="${r}" ${b && r===b.ratingA?'selected':''}>${r} A</option>`).join('')}</select>
            <select class="ip-curve" ${b?'':'disabled'}>${['B','C'].map(k => `<option value="${k}" ${b && k===b.curve?'selected':''}>${k}</option>`).join('')}</select></span></label>
          <label>${I18n.t('elec.cable')}<select class="ip-cable">${CABLE_TYPES.map(t => `<option value="${t.id}" ${t.id===c.cableId?'selected':''}>${t.label} (${t.ampacityA} A)</option>`).join('')}</select></label>
        </div>
        <div class="ip-bar"><div class="ip-fill" style="width:${pct}%;background:${col}"></div></div>
        <div class="ip-sub">${I18n.t('elec.voltage')}: ${I18n.num(rt.voltageV, 0)} V · ${I18n.t('elec.current')}: ${InstallationPanel.fmtA(rt.currentA)} / ${maxA} A · ${I18n.t('elec.power')}: ${InstallationPanel.fmtW(rt.powerW)} / ${InstallationPanel.fmtW(maxA * d.supplyVoltageV)}</div>
        <div class="ip-sub">${I18n.plural('unit.socket', sockets.length)}${under ? ` · <span class="ip-error">${I18n.t('elec.diag.cableUndersized', { circuit:this.circuitLabel(c), breaker:b.ratingA, cable:cab.label, ampacity:cab.ampacityA })}</span>` : ''}</div>
        <div class="ip-actions">
          ${tripped ? `<button type="button" class="small-btn ip-reset-br">${I18n.t('elec.reset')}</button>` : ''}
          ${damaged ? `<button type="button" class="small-btn ip-repair">${I18n.t('elec.repairCable')}</button>` : ''}
          <button type="button" class="small-btn ip-del">${I18n.t('elec.delete')}</button>
        </div>
      </div>`;
    }).join('');
    return `${cards || `<div class="ip-empty">${I18n.t('elec.noCircuits')}</div>`}
      <div class="ip-actions"><button type="button" class="small-btn ip-add-circuit">＋ ${I18n.t('elec.addCircuit')}</button>
      <button type="button" class="small-btn ip-auto">⚙ ${I18n.t('elec.autoInstall')}</button></div>`;
  }

  _elementsHtml(){
    const e = this.e, d = e.data, rooms = e.ctx.getRooms() || [];
    const devs = e.ctx.getDevices();
    const statusText = s => s.runtime.status && s.runtime.status !== 'ok' ? I18n.t('elec.status.' + s.runtime.status) : (s.runtime.state === 'live' ? I18n.t('elec.status.live') : '—');
    const parts = [];
    for (const r of rooms){
      const sockets = e.sockets(r.id), strips = e.strips().filter(s => s.roomId === r.id);
      if (!sockets.length && !strips.length) continue;
      parts.push(`<h4 class="ip-h">${InstallationPanel.esc(r.name)}</h4>`);
      for (const s of sockets){
        const w = e.wireOf(s.id), cab = e.cableFor(s), len = w ? e.wireLengthM(w) : 0;
        const plugged = devs.filter(x => x.plugTo === s.id).map(x => this.deviceLabel(x)), stripsOn = e.strips().filter(x => x.plugTo === s.id).length;
        parts.push(`
        <div class="ip-card ip-el ${s.runtime.state === 'live' ? '' : 'ip-dim'}" data-socket="${s.id}">
          <div class="ip-row"><b>🔌 ${InstallationPanel.esc(this.socketLabel(s))}</b><span class="ip-pill ${s.runtime.state === 'live' ? 'ok' : 'bad'}">${statusText(s)}</span>
            <button type="button" class="small-btn ip-select">${I18n.t('elec.select')}</button></div>
          <div class="ip-grid">
            <label>${I18n.t('elec.circuit')}<select class="ip-s-circuit"><option value="">—</option>${d.circuits.map(c => `<option value="${c.id}" ${c.id===s.circuitId?'selected':''}>${InstallationPanel.esc(this.circuitLabel(c))}</option>`).join('')}</select></label>
            <label>${I18n.t('elec.route')}<select class="ip-s-route" ${w?'':'disabled'}>${['ceiling','floor','direct'].map(k => `<option value="${k}" ${w && w.route===k?'selected':''}>${I18n.t('elec.route.'+k)}</option>`).join('')}</select></label>
            <label>${I18n.t('elec.wire')}<button type="button" class="small-btn ip-s-wire">${w ? I18n.t('elec.unwire') : I18n.t('elec.wireIt')}</button></label>
          </div>
          <div class="ip-sub">${w ? `${cab.label} · ${I18n.num(len, 1)} m · ` : ''}${I18n.t('elec.voltage')}: ${I18n.num(s.runtime.voltageV || 0, 0)} V · ${InstallationPanel.fmtA(s.runtime.currentA || 0)} · ${I18n.t('elec.outlets')}: ${e.usedOutlets(s.id)}/${s.def.outlets}</div>
          ${plugged.length || stripsOn ? `<div class="ip-sub">↳ ${plugged.map(InstallationPanel.esc).join(', ')}${stripsOn ? (plugged.length ? ', ' : '') + I18n.plural('unit.strip', stripsOn) : ''}</div>` : ''}
        </div>`);
      }
      for (const st of strips){
        const trip = st.runtime.status === 'tripped', sockOpts = e.sockets().filter(x => e.freeOutlets(x.id) > 0 || x.id === st.plugTo);
        parts.push(`
        <div class="ip-card ip-el ${trip ? 'ip-bad' : ''}" data-strip="${st.id}">
          <div class="ip-row"><b>🧷 ${InstallationPanel.esc(this.targetLabel(st))}</b>
            <span class="ip-pill ${trip ? 'bad' : (st.runtime.state === 'live' ? 'ok' : 'bad')}">${trip ? I18n.t('elec.state.tripped') : (st.runtime.state === 'live' ? I18n.t('elec.status.live') : I18n.t('elec.state.off'))}</span>
            <button type="button" class="small-btn ip-select">${I18n.t('elec.select')}</button></div>
          <div class="ip-grid">
            <label>${I18n.t('elec.pluggedInto')}<select class="ip-st-socket"><option value="">${I18n.t('elec.notPlugged')}</option>${sockOpts.map(x => `<option value="${x.id}" ${x.id===st.plugTo?'selected':''}>${InstallationPanel.esc(this.socketLabel(x))}</option>`).join('')}</select></label>
            <label>${I18n.t('elec.switch')}<input type="checkbox" class="ip-st-on" ${st.enabled !== false ? 'checked' : ''}></label>
          </div>
          <div class="ip-sub">${InstallationPanel.fmtA(st.runtime.currentA || 0)} / ${st.def.ratedA} A · ${I18n.t('elec.outlets')}: ${e.usedOutlets(st.id)}/${st.def.outlets}</div>
          ${trip ? `<div class="ip-actions"><button type="button" class="small-btn ip-st-reset">${I18n.t('elec.reset')}</button></div>` : ''}
        </div>`);
      }
    }
    return `${parts.join('') || `<div class="ip-empty">${I18n.t('elec.noElements')}</div>`}
      <div class="ip-actions">
        <button type="button" class="small-btn ip-add" data-def="socket">＋ ${I18n.t('elec.def.socket')}</button>
        <button type="button" class="small-btn ip-add" data-def="power_strip">＋ ${I18n.t('elec.def.power_strip')}</button>
        <button type="button" class="small-btn ip-autowire">↯ ${I18n.t('elec.autoWire')}</button>
      </div>`;
  }

  _devicesHtml(){
    const e = this.e, devs = e.ctx.getDevices();
    if (!devs.length) return `<div class="ip-empty">${I18n.t('elec.noDevices')}</div>`;
    return devs.map(d => {
      const r = e.rt.devices[d.id], status = r ? r.status : 'unassigned';
      const ok = status === 'ok' || status === 'legacy';
      return `<div class="ip-card ip-dev ${ok ? '' : 'ip-bad'}" data-device="${d.id}">
        <div class="ip-row"><b>${InstallationPanel.esc(this.deviceLabel(d))}</b><span class="ip-pill ${ok ? 'ok' : 'bad'}">${I18n.t('elec.status.' + status)}</span></div>
        <div class="ip-grid"><label>${I18n.t('elec.pluggedInto')}<select class="ip-d-plug">${InstallationPanel.plugOptions(this, d)}</select></label>
          <label>${I18n.t('elec.power')}<span>${InstallationPanel.fmtW(d.runtime.powerW || 0)}${r && r.voltageV ? ' · ' + I18n.num(r.voltageV, 0) + ' V' : ''}</span></label></div>
      </div>`;
    }).join('');
  }

  _costsHtml(){
    const c = this.e.costBreakdown(), eco = this.getEconomics();
    const nm = i => i.key === 'cable' ? `${I18n.t('elec.cost.cable')} ${i.label}` : i.key === 'breaker' ? `${I18n.t('elec.cost.breaker')} ${i.curve}${i.ratingA} A${i.name ? ' · ' + InstallationPanel.esc(i.name) : ''}`
      : i.key === 'mainBreaker' ? `${I18n.t('elec.cost.mainBreaker')} ${i.ratingA} A` : I18n.t('elec.cost.' + i.key);
    const qty = i => i.key === 'cable' ? I18n.num(i.qty, 1) + ' m' : i.qty;
    return `
      <table class="ip-table"><thead><tr><th>${I18n.t('elec.cost.item')}</th><th>${I18n.t('elec.cost.qty')}</th><th>${I18n.t('elec.cost.material')}</th><th>${I18n.t('elec.cost.labor')}</th><th>${I18n.t('elec.cost.total')}</th></tr></thead>
      <tbody>${c.items.map(i => `<tr><td>${nm(i)}</td><td>${qty(i)}</td><td>${InstallationPanel.fmtZl(i.materialZl)}</td><td>${InstallationPanel.fmtZl(i.laborZl)}</td><td>${InstallationPanel.fmtZl(i.totalZl)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4"><b>${I18n.t('elec.cost.sum')}</b> (${I18n.num(c.cableM, 1)} m ${I18n.t('elec.cost.ofCable')})</td><td><b>${InstallationPanel.fmtZl(c.totalZl)}</b></td></tr></tfoot></table>
      <div class="ip-card"><div class="ip-sub">${I18n.t('elec.cost.amortized', { years: ELECTRICAL_CONSTANTS.designLifeYears, perYear: InstallationPanel.fmtZl(c.amortizedPerYearZl) })}</div>
      ${eco ? `<div class="ip-sub">${I18n.t('elec.cost.energyYear')}: ${InstallationPanel.fmtZl(eco.energyYearZl)}</div>
        <div class="ip-sub"><b>${I18n.t('elec.cost.projectYear')}: ${InstallationPanel.fmtZl(eco.energyYearZl + c.amortizedPerYearZl)}</b></div>` : ''}</div>`;
  }

  // ------------------------------------------------------------------ events
  _bind(){
    const q = (sel, fn) => this.el.querySelectorAll(sel).forEach(fn), e = this.e;
    const done = () => { this.onChange(); this.render(); };
    q('.ip-tab', b => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.render(); }));
    q('.ip-main-rating', s => s.addEventListener('change', () => { e.setMainBreaker(Number(s.value)); done(); }));
    q('.ip-reset-main', b => b.addEventListener('click', () => { e.resetMain(); done(); }));
    q('.ip-strict', c => c.addEventListener('change', () => { e.data.strict = c.checked; done(); }));
    q('.ip-wires', c => c.addEventListener('change', () => { this.onWireVisible(c.checked); }));
    // circuits
    q('[data-circuit]', card => {
      const id = card.dataset.circuit, c = e.circuit(id); if (!c) return;
      card.querySelector('.ip-name').addEventListener('change', ev => { c.name = ev.target.value.trim().slice(0, 40); done(); });
      card.querySelector('.ip-breaker').addEventListener('change', ev => {
        if (ev.target.value === '__new'){ const b = e.addBreaker({ name:c.name }); e.setCircuitBreaker(id, b.id); }
        else e.setCircuitBreaker(id, ev.target.value);
        done();
      });
      card.querySelector('.ip-rating').addEventListener('change', ev => { if (c.breakerId){ e.setBreakerRating(c.breakerId, Number(ev.target.value)); done(); } });
      card.querySelector('.ip-curve').addEventListener('change', ev => { if (c.breakerId){ e.setBreakerRating(c.breakerId, e.breaker(c.breakerId).ratingA, ev.target.value); done(); } });
      card.querySelector('.ip-cable').addEventListener('change', ev => { e.setCircuitCable(id, ev.target.value); done(); });
      const rb = card.querySelector('.ip-reset-br'); if (rb) rb.addEventListener('click', () => { e.resetBreaker(c.breakerId); done(); });
      const rp = card.querySelector('.ip-repair'); if (rp) rp.addEventListener('click', () => {
        for (const s of e.sockets().filter(x => x.circuitId === id)){ const w = e.wireOf(s.id); if (w && w.damaged) e.repairWire(w.id); }
        done();
      });
      card.querySelector('.ip-del').addEventListener('click', () => { e.removeCircuit(id); done(); });
    });
    q('.ip-add-circuit', b => b.addEventListener('click', () => { e.addCircuit({ name:I18n.t('elec.newCircuitName', { n: e.data.circuits.length + 1 }) }); done(); }));
    q('.ip-auto', b => b.addEventListener('click', () => { e.autoInstall(); done(); }));
    // sockets
    q('[data-socket]', card => {
      const id = card.dataset.socket;
      card.querySelector('.ip-select').addEventListener('click', () => this.onSelect(id));
      card.querySelector('.ip-s-circuit').addEventListener('change', ev => { e.assignSocketCircuit(id, ev.target.value || null); done(); });
      card.querySelector('.ip-s-route').addEventListener('change', ev => { e.setWireRoute(id, ev.target.value); done(); });
      card.querySelector('.ip-s-wire').addEventListener('click', () => { if (e.wireOf(id)) e.unwire(id); else e.wire(id); done(); });
    });
    q('[data-strip]', card => {
      const id = card.dataset.strip, st = e._elMap().get(id);
      card.querySelector('.ip-select').addEventListener('click', () => this.onSelect(id));
      card.querySelector('.ip-st-socket').addEventListener('change', ev => { if (ev.target.value) e.plugStrip(id, ev.target.value); else st.plugTo = null; done(); });
      card.querySelector('.ip-st-on').addEventListener('change', ev => { st.enabled = ev.target.checked; done(); });
      const r = card.querySelector('.ip-st-reset'); if (r) r.addEventListener('click', () => { e.resetStrip(id); done(); });
    });
    q('.ip-add', b => b.addEventListener('click', () => { this.onAddElement(b.dataset.def); this.render(); }));
    q('.ip-autowire', b => b.addEventListener('click', () => { e.autoWire(); done(); }));
    // devices
    q('[data-device]', card => {
      const id = card.dataset.device;
      card.querySelector('.ip-d-plug').addEventListener('change', ev => { if (ev.target.value) e.plugDevice(id, ev.target.value); else e.unplugDevice(id); done(); });
    });
  }
}
