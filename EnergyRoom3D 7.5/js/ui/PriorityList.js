/**
 * PRIORITY LIST (visual 3-slot PV usage priority)
 * A small self-contained component: three rows (Home / Battery / Grid) the user can reorder by
 * dragging (mouse AND touch - pointer events, not HTML5 drag&drop which does not work on phones),
 * or with the up/down buttons / keyboard (Alt+Arrow) for accessibility. Shows the current order as a
 * summary line. Every committed change calls onChange(order) so the simulation can apply it immediately.
 * No dependency on THREE.js or the rest of the UI - only I18n for labels.
 */
class PriorityList {
  static META = {
    home:    { icon:'🏠', labelKey:'pvsink.home',    descKey:'pvsink.homeDesc' },
    battery: { icon:'🔋', labelKey:'pvsink.battery', descKey:'pvsink.batteryDesc' },
    grid:    { icon:'🔌', labelKey:'pvsink.grid',    descKey:'pvsink.gridDesc' },
  };

  constructor(container, { order, onChange }){
    this.el = container;
    this.order = SimulationEngine.normalizePvOrder(order);
    this.onChange = onChange || (()=>{});
    this._drag = null;
    this.render();
  }

  setOrder(order, silent){
    const o = SimulationEngine.normalizePvOrder(order);
    if (o.join() === this.order.join()) return;
    this.order = o; this.render();
    if (!silent) this.onChange(this.order.slice());
  }

  /** "Dom → Bateria → Sieć" in the active language. */
  summary(){ return this.order.map(k => I18n.t(PriorityList.META[k].labelKey)).join(' → '); }

  move(sink, delta){
    const i = this.order.indexOf(sink), j = i + delta;
    if (i < 0 || j < 0 || j >= this.order.length) return;
    const o = this.order.slice(); [o[i], o[j]] = [o[j], o[i]];
    this.order = o; this.render();
    this.onChange(this.order.slice());
    const btn = this.el.querySelector(`.pl-row[data-sink="${sink}"] .${delta<0?'pl-up':'pl-down'}`);
    if (btn) btn.focus();
  }

  render(){
    const M = PriorityList.META;
    this.el.classList.add('pl-root');
    this.el.innerHTML = `
      <div class="pl-list" role="list" aria-label="${I18n.t('pvsink.listLabel')}">
        ${this.order.map((k, i) => `
        <div class="pl-row" role="listitem" data-sink="${k}" tabindex="0">
          <span class="pl-rank">${i+1}</span>
          <span class="pl-handle" title="${I18n.t('pvsink.dragHint')}" aria-hidden="true">⋮⋮</span>
          <span class="pl-icon">${M[k].icon}</span>
          <span class="pl-text"><b>${I18n.t(M[k].labelKey)}</b><small>${I18n.t(M[k].descKey)}</small></span>
          <span class="pl-btns">
            <button type="button" class="pl-up" ${i===0?'disabled':''} aria-label="${I18n.t('pvsink.moveUp')}">▲</button>
            <button type="button" class="pl-down" ${i===this.order.length-1?'disabled':''} aria-label="${I18n.t('pvsink.moveDown')}">▼</button>
          </span>
        </div>`).join('')}
      </div>
      <div class="pl-summary"><span class="pl-summary-lbl">${I18n.t('pvsink.current')}:</span> <b class="pl-summary-val">${this.summary()}</b></div>`;
    this._bind();
  }

  _bind(){
    const list = this.el.querySelector('.pl-list');
    list.querySelectorAll('.pl-row').forEach(row => {
      const sink = row.dataset.sink;
      row.querySelector('.pl-up').addEventListener('click', ()=>this.move(sink, -1));
      row.querySelector('.pl-down').addEventListener('click', ()=>this.move(sink, +1));
      row.addEventListener('keydown', (e)=>{
        if (!e.altKey) return;
        if (e.key === 'ArrowUp'){ e.preventDefault(); this.move(sink, -1); }
        if (e.key === 'ArrowDown'){ e.preventDefault(); this.move(sink, +1); }
      });
      const handle = row.querySelector('.pl-handle');
      handle.addEventListener('pointerdown', (e)=>this._dragStart(e, row, list));
    });
  }

  _dragStart(e, row, list){
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    this._drag = { row, list, startOrder: this.order.join(), pointerId: e.pointerId };
    row.classList.add('pl-dragging');
    // Listen on the document, NOT on the handle: re-inserting the dragged row into the DOM (live reordering)
    // releases pointer capture on the handle, which would swallow the final pointerup.
    const move = (ev)=>{ if (ev.pointerId === this._drag?.pointerId) this._dragMove(ev); };
    const up = (ev)=>{
      if (this._drag && ev.pointerId !== this._drag.pointerId) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      this._dragEnd();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }

  _dragMove(e){
    const d = this._drag; if (!d) return;
    const rows = Array.from(d.list.querySelectorAll('.pl-row'));
    // find the slot under the pointer by comparing to each row's vertical midpoint
    let target = rows.length - 1;
    for (let i = 0; i < rows.length; i++){
      if (rows[i] === d.row) continue;
      const r = rows[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height/2){ target = i; break; }
    }
    const cur = rows.indexOf(d.row);
    if (target === cur) return;
    const ref = rows[target];
    if (target > cur) ref.after(d.row); else ref.before(d.row);
    // live rank numbers while dragging
    Array.from(d.list.querySelectorAll('.pl-row')).forEach((r, i) => { r.querySelector('.pl-rank').textContent = i+1; });
  }

  _dragEnd(){
    const d = this._drag; if (!d) return; this._drag = null;
    d.row.classList.remove('pl-dragging');
    const order = Array.from(d.list.querySelectorAll('.pl-row')).map(r => r.dataset.sink);
    if (order.join() !== d.startOrder){
      this.order = order; this.render(); this.onChange(this.order.slice());
    }
  }
}
