/**
 * DESIGNER PANEL ("Projektant domu")
 * Editor for the building itself: levels (storeys / basement), rooms (type, size, position, level, snapping to neighbours),
 * walls (material, insulation), openings (windows, doors, garage doors: position, size, glazing, open/closed),
 * partition walls, stairs, roofs (flat / mono-pitch / gable, pitch, facing, PV slope) and a live thermal balance
 * (U-values, UA, heat loss, solar gain, thermal mass) computed by BuildingModel.
 * DOM only, no THREE.js. Every edit goes through BuildingModel (which validates it) and then onChange(kind) so the
 * app rebuilds the 3D house, refits the installation and records undo history.
 */
class DesignerPanel {
  constructor(container, opts){
    this.el = container;
    this.getHouse = opts.getHouse;
    this.onChange = opts.onChange || (()=>{});
    this.onAddRoom = opts.onAddRoom || (()=>null);
    this.onRemoveRoom = opts.onRemoveRoom || (()=>{});
    this.onFocusRoom = opts.onFocusRoom || (()=>{});
    this.onOpeningState = opts.onOpeningState || (()=>{});
    this.onClose = opts.onClose || (()=>{});
    this.tab = 'levels';
    this.roomId = null;
    this.msg = null;              // {level:'error'|'info', text}
    this.designT = { tin:21, tout:-20 };
    this.addWall = 'S';
    this.el.classList.add('dp-root');
  }

  static esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c])); }
  static num(v, d){ return I18n.num(v, d == null ? 2 : d); }
  get house(){ return this.getHouse(); }
  room(id){ return this.house.rooms.find(r => r.id === (id || this.roomId)) || this.house.rooms[0]; }
  levelName(id){ return BuildingModel.level(this.house, id).name; }
  roomLabel(r){ return `${this.levelName(r.levelId)} · ${r.name}`; }
  sideName(s){ return I18n.t('bld.side.' + s); }

  say(level, text){ this.msg = { level, text }; }
  err(code){ this.say('error', I18n.t('bld.err.' + code)); }
  changed(kind){ this.onChange(kind); this.render(); }

  // ------------------------------------------------------------------ frame
  render(){
    const h = this.house, tabs = ['levels', 'walls', 'partitions', 'roof', 'balance'];
    if (!h.rooms.some(r => r.id === this.roomId)) this.roomId = (h.rooms.find(r => r.id === h.activeRoomId) || h.rooms[0]).id;
    const roomSel = ['walls', 'partitions', 'roof', 'balance'].includes(this.tab)
      ? `<div class="dp-roomsel"><label>${I18n.t('bld.room')}<select class="dp-room">${h.rooms.map(r => `<option value="${r.id}" ${r.id === this.roomId ? 'selected' : ''}>${DesignerPanel.esc(this.roomLabel(r))}</option>`).join('')}</select></label>
         <button type="button" class="small-btn dp-focus">${I18n.t('bld.focus')}</button></div>` : '';
    this.el.innerHTML = `
      <div class="dp-head"><b>🏗 ${I18n.t('bld.title')}</b><button type="button" class="dp-close" aria-label="${I18n.t('bld.close')}">✕</button></div>
      <div class="ip-tabs dp-tabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" class="ip-tab ${this.tab === t ? 'active' : ''}" data-tab="${t}">${I18n.t('bld.tab.' + t)}</button>`).join('')}</div>
      ${this.msg ? `<div class="dp-msg dp-${this.msg.level}">${DesignerPanel.esc(this.msg.text)}</div>` : ''}
      ${roomSel}
      <div class="dp-body">${this['_' + this.tab + 'Html']()}</div>`;
    this._bind();
  }

  // ------------------------------------------------------------------ tab: levels + rooms
  _levelsHtml(){
    const h = this.house, levels = BuildingModel.sortedLevels(h).reverse();
    const typeOpts = sel => Object.keys(ROOM_TYPE_META).map(t => `<option value="${t}" ${t === sel ? 'selected' : ''}>${ROOM_TYPE_META[t].icon} ${I18n.roomType(t)}</option>`).join('');
    const lvlOpts = sel => levels.map(l => `<option value="${l.id}" ${l.id === sel ? 'selected' : ''}>${DesignerPanel.esc(l.name)}</option>`).join('');
    const lv = levels.map(l => {
      const n = BuildingModel.roomsOnLevel(h, l.id).length;
      return `<div class="ip-card dp-level" data-level="${l.id}"><div class="ip-row">
        <input class="ip-name dp-lname" value="${DesignerPanel.esc(l.name)}" aria-label="${I18n.t('bld.levelName')}">
        <span class="ip-sub">${I18n.t('bld.elevation')}: ${DesignerPanel.num(l.elevation)} m · ${I18n.plural('unit.room', n)}</span>
        <button type="button" class="small-btn dp-lgo ${h.activeLevelId === l.id ? 'active' : ''}">${I18n.t('bld.showLevel')}</button>
        <button type="button" class="small-btn dp-ldel">${I18n.t('bld.delete')}</button></div></div>`;
    }).join('');
    const rooms = h.rooms.map(r => {
      const s = r.settings, others = h.rooms.filter(o => o.id !== r.id);
      return `<div class="ip-card dp-roomcard" data-room="${r.id}">
        <div class="ip-row"><input class="ip-name dp-rname" value="${DesignerPanel.esc(r.name)}" aria-label="${I18n.t('bld.roomName')}">
          <button type="button" class="small-btn dp-rfocus">${I18n.t('bld.focus')}</button><button type="button" class="small-btn dp-rdel">${I18n.t('bld.delete')}</button></div>
        <div class="ip-grid">
          <label>${I18n.t('bld.type')}<select class="dp-rtype">${typeOpts(r.type)}</select></label>
          <label>${I18n.t('bld.level')}<select class="dp-rlevel">${lvlOpts(r.levelId)}</select></label></div>
        <div class="ip-grid dp-nums">
          <label>${I18n.t('bld.width')}<input type="number" class="dp-rdim" data-k="width" min="1.5" max="30" step="0.1" value="${s.width}"></label>
          <label>${I18n.t('bld.length')}<input type="number" class="dp-rdim" data-k="length" min="1.5" max="30" step="0.1" value="${s.length}"></label>
          <label>${I18n.t('bld.height')}<input type="number" class="dp-rdim" data-k="height" min="0.8" max="6" step="0.05" value="${s.height}"></label>
          <label>X<input type="number" class="dp-rpos" data-k="offsetX" step="0.1" value="${r.offsetX || 0}"></label>
          <label>Z<input type="number" class="dp-rpos" data-k="offsetZ" step="0.1" value="${r.offsetZ || 0}"></label></div>
        ${others.length ? `<div class="ip-grid"><label>${I18n.t('bld.snapTo')}<select class="dp-snapto">${others.map(o => `<option value="${o.id}">${DesignerPanel.esc(this.roomLabel(o))}</option>`).join('')}</select></label>
          <div class="ip-actions dp-snapbtns">${['N', 'E', 'S', 'W'].map(sd => `<button type="button" class="small-btn dp-snap" data-side="${sd}" title="${I18n.t('bld.snapSide', { side: this.sideName(sd) })}">${sd}</button>`).join('')}</div></div>` : ''}
      </div>`;
    }).join('');
    return `
      <h4 class="ip-h">${I18n.t('bld.levels')}</h4>${lv}
      <div class="ip-actions"><button type="button" class="small-btn dp-addlevel">＋ ${I18n.t('bld.addLevel')}</button><button type="button" class="small-btn dp-addbasement">＋ ${I18n.t('bld.addBasement')}</button>
        <label class="ip-check"><input type="checkbox" class="dp-viewall" ${h.levelView === 'all' ? 'checked' : ''}> ${I18n.t('bld.viewAll')}</label></div>
      <h4 class="ip-h">${I18n.t('bld.rooms')}</h4>${rooms}
      <div class="ip-card"><div class="ip-grid"><label>${I18n.t('bld.type')}<select class="dp-newtype">${typeOpts('room')}</select></label><label>${I18n.t('bld.level')}<select class="dp-newlevel">${lvlOpts(h.activeLevelId)}</select></label></div>
        <div class="ip-actions"><button type="button" class="small-btn dp-addroom">＋ ${I18n.t('bld.addRoom')}</button></div></div>`;
  }

  // ------------------------------------------------------------------ tab: walls + openings
  _wallsHtml(){
    const h = this.house, r = this.room(), d = r.design, adj = BuildingModel.adjacency(h, r), outdoor = BuildingModel.isOutdoor(r);
    if (outdoor) return `<div class="ip-empty">${I18n.t('bld.outdoorNoWalls')}</div>`;
    const matOpts = sel => Object.values(WALL_MATERIALS).map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${I18n.t(m.labelKey)}</option>`).join('');
    const walls = BuildingModel.SIDES.map(sd => {
      const w = d.walls[sd], U = BuildingModel.wallU(w, true), shared = adj[sd].map(n => (h.rooms.find(x => x.id === n.roomId) || {}).name).filter(Boolean);
      return `<div class="ip-card dp-wall" data-side="${sd}"><div class="ip-row"><b>${this.sideName(sd)}</b>
          <span class="ip-pill ${shared.length ? 'ok' : 'bad'}">${shared.length ? I18n.t('bld.sharedWith', { rooms: shared.join(', ') }) : I18n.t('bld.exterior')}</span>
          <span class="ip-sub">U = ${DesignerPanel.num(U)} W/m²K</span></div>
        <div class="ip-grid"><label>${I18n.t('bld.material')}<select class="dp-wmat">${matOpts(w.material)}</select></label>
          <label>${I18n.t('bld.insulation')} (cm)<input type="number" class="dp-wins" min="0" max="40" step="1" value="${w.insulationCm}"></label>
          ${sd === 'S' ? `<label class="ip-check"><input type="checkbox" class="dp-front" ${d.frontWall ? 'checked' : ''}> ${I18n.t('bld.frontWall')}</label>` : ''}</div></div>`;
    }).join('');
    const opens = d.openings.slice().sort((a, b) => a.wall.localeCompare(b.wall) || a.pos - b.pos).map(o => {
      const isW = o.type === 'window', kinds = isW ? Object.values(GLAZING_TYPES) : Object.values(DOOR_TYPES);
      return `<div class="ip-card dp-open" data-open="${o.id}">
        <div class="ip-row"><b>${isW ? '🪟' : (o.type === 'garage' ? '🚗' : '🚪')} ${I18n.t('bld.kind.' + o.type)}</b>
          <button type="button" class="small-btn dp-odel">${I18n.t('bld.delete')}</button></div>
        <div class="ip-grid dp-nums">
          <label>${I18n.t('bld.wall')}<select class="dp-owall">${BuildingModel.SIDES.map(sd => `<option value="${sd}" ${o.wall === sd ? 'selected' : ''}>${this.sideName(sd)}</option>`).join('')}</select></label>
          <label>${I18n.t('bld.pos')}<input type="number" class="dp-onum" data-k="pos" step="0.05" value="${DesignerPanel.num(o.pos)}"></label>
          <label>${I18n.t('bld.width')}<input type="number" class="dp-onum" data-k="width" step="0.05" value="${DesignerPanel.num(o.width)}"></label>
          <label>${I18n.t('bld.height')}<input type="number" class="dp-onum" data-k="height" step="0.05" value="${DesignerPanel.num(o.height)}"></label>
          ${isW ? `<label>${I18n.t('bld.sill')}<input type="number" class="dp-onum" data-k="sill" step="0.05" value="${DesignerPanel.num(o.sill)}"></label>` : ''}
          <label>${isW ? I18n.t('bld.glazing') : I18n.t('bld.doorType')}<select class="dp-okind">${kinds.map(k => `<option value="${k.id}" ${(isW ? o.glazing : o.doorType) === k.id ? 'selected' : ''}>${I18n.t(k.labelKey)}</option>`).join('')}</select></label>
          <label>${I18n.t('bld.openState')}: ${Math.round(o.open * 100)}%<input type="range" class="dp-oopen" min="0" max="100" value="${Math.round(o.open * 100)}"></label></div></div>`;
    }).join('');
    return `
      <div class="ip-grid"><label>${I18n.t('bld.floorInsulation')} (cm)<input type="number" class="dp-floorins" min="0" max="40" step="1" value="${d.floorInsulationCm}"></label></div>
      <h4 class="ip-h">${I18n.t('bld.walls')}</h4>${walls}
      <h4 class="ip-h">${I18n.t('bld.openings')}</h4>${opens || `<div class="ip-empty">${I18n.t('bld.noOpenings')}</div>`}
      <div class="ip-card"><div class="ip-grid"><label>${I18n.t('bld.wall')}<select class="dp-addwall">${BuildingModel.SIDES.map(sd => `<option value="${sd}" ${this.addWall === sd ? 'selected' : ''}>${this.sideName(sd)}</option>`).join('')}</select></label></div>
        <div class="ip-actions"><button type="button" class="small-btn dp-addop" data-type="window">＋ ${I18n.t('bld.kind.window')}</button>
          <button type="button" class="small-btn dp-addop" data-type="door">＋ ${I18n.t('bld.kind.door')}</button><button type="button" class="small-btn dp-addop" data-type="garage">＋ ${I18n.t('bld.kind.garage')}</button></div></div>`;
  }

  // ------------------------------------------------------------------ tab: partitions + stairs
  _partitionsHtml(){
    const h = this.house, r = this.room(), d = r.design;
    if (BuildingModel.isOutdoor(r)) return `<div class="ip-empty">${I18n.t('bld.outdoorNoWalls')}</div>`;
    const matOpts = sel => ['drywall', 'brick', 'silicate', 'aac', 'concrete', 'timber'].map(m => `<option value="${m}" ${m === sel ? 'selected' : ''}>${I18n.t(WALL_MATERIALS[m].labelKey)}</option>`).join('');
    const parts = d.partitions.map(p => `<div class="ip-card dp-part" data-part="${p.id}"><div class="ip-row"><b>${I18n.t('bld.partition')}</b><span class="ip-sub">${DesignerPanel.num(BuildingModel.partitionLength(p))} m</span>
        <button type="button" class="small-btn dp-pdel">${I18n.t('bld.delete')}</button></div>
      <div class="ip-grid dp-nums"><label>${I18n.t('bld.material')}<select class="dp-pmat">${matOpts(p.material)}</select></label>
        <label>${I18n.t('bld.doorGap')} (m)<input type="number" class="dp-pdoor" min="0" max="3" step="0.1" value="${p.doorWidth}"></label></div></div>`).join('');
    const lv = BuildingModel.sortedLevels(h), stairsHere = h.stairs.filter(s => s.roomId === r.id);
    const up = lv.filter(l => l.elevation > BuildingModel.elevation(h, r) + 0.01);
    const stairs = stairsHere.map(s => {
      const t = BuildingModel.stairTarget(h, s), run = BuildingModel.stairRun(h, r, s.toLevelId);
      return `<div class="ip-card dp-stair" data-stair="${s.id}"><div class="ip-row"><b>🪜 ${I18n.t('bld.stair')}</b>
          <span class="ip-sub">${I18n.t('bld.stairTo', { level: this.levelName(s.toLevelId), room: t ? t.name : '—' })} · ${I18n.t('bld.stairRun', { run: DesignerPanel.num(run.run, 1), n: run.risers })}</span>
          <button type="button" class="small-btn dp-sdel">${I18n.t('bld.delete')}</button></div></div>`;
    }).join('');
    return `
      <h4 class="ip-h">${I18n.t('bld.partitions')}</h4>${parts || `<div class="ip-empty">${I18n.t('bld.noPartitions')}</div>`}
      <div class="ip-actions"><button type="button" class="small-btn dp-addpart" data-axis="z">＋ ${I18n.t('bld.splitLong')}</button><button type="button" class="small-btn dp-addpart" data-axis="x">＋ ${I18n.t('bld.splitWide')}</button></div>
      <h4 class="ip-h">${I18n.t('bld.stairs')}</h4>${stairs || `<div class="ip-empty">${I18n.t('bld.noStairs')}</div>`}
      ${up.length ? `<div class="ip-card"><div class="ip-grid dp-nums"><label>${I18n.t('bld.stairTarget')}<select class="dp-stlevel">${up.map(l => `<option value="${l.id}">${DesignerPanel.esc(l.name)}</option>`).join('')}</select></label>
          <label>${I18n.t('bld.direction')}<select class="dp-stdir">${BuildingModel.SIDES.map(sd => `<option value="${sd}">${this.sideName(sd)}</option>`).join('')}</select></label>
          <label>X<input type="number" class="dp-stx" step="0.1" value="1.0"></label><label>Z<input type="number" class="dp-stz" step="0.1" value="${DesignerPanel.num(Math.max(1, r.settings.length - 0.4), 1)}"></label></div>
        <div class="ip-actions"><button type="button" class="small-btn dp-addstair">＋ ${I18n.t('bld.addStair')}</button></div></div>` : `<div class="ip-empty">${I18n.t('bld.needUpperLevel')}</div>`}`;
  }

  // ------------------------------------------------------------------ tab: roof
  _roofHtml(){
    const h = this.house, r = this.room(), d = r.design.roof, eff = BuildingModel.roofSpec(h, r);
    if (BuildingModel.isOutdoor(r)) return `<div class="ip-empty">${I18n.t('bld.outdoorNoRoof')}</div>`;
    const covered = eff.type === 'none' && d.type !== 'none';
    const slopes = BuildingModel.roofSlopes(h, r);
    const q = sl => BuildingModel.pvSuitability(sl.pitch * 180 / Math.PI, sl.azimuthDeg);   // yearly yield vs the optimum fixed panel
    return `
      ${covered ? `<div class="dp-msg dp-info">${I18n.t('bld.roofCovered')}</div>` : ''}
      <div class="ip-grid dp-nums"><label>${I18n.t('bld.roofType')}<select class="dp-rooftype">${Object.values(ROOF_TYPES).map(t => `<option value="${t.id}" ${d.type === t.id ? 'selected' : ''}>${I18n.t(t.labelKey)}</option>`).join('')}</select></label>
        <label>${I18n.t('bld.pitch')} (°)<input type="number" class="dp-roofnum" data-k="pitchDeg" min="3" max="60" step="1" value="${d.pitchDeg}"></label>
        <label>${I18n.t('bld.overhang')} (m)<input type="number" class="dp-roofnum" data-k="overhang" min="0" max="1.2" step="0.05" value="${d.overhang}"></label>
        <label>${I18n.t('bld.facing')}<select class="dp-roofface">${BuildingModel.SIDES.map(sd => `<option value="${sd}" ${d.facing === sd ? 'selected' : ''}>${this.sideName(sd)}</option>`).join('')}</select></label>
        <label>${I18n.t('bld.roofInsulation')} (cm)<input type="number" class="dp-roofnum" data-k="insulationCm" min="0" max="60" step="1" value="${d.insulationCm}"></label>
        ${d.type === 'gable' ? `<label>${I18n.t('bld.pvSlope')}<select class="dp-pvslope"><option value="a" ${d.pvSlope !== 'b' ? 'selected' : ''}>A</option><option value="b" ${d.pvSlope === 'b' ? 'selected' : ''}>B</option></select></label>` : ''}</div>
      ${slopes.map(sl => `<div class="ip-card"><div class="ip-row"><b>${I18n.t('bld.slope')} ${sl.key.toUpperCase()}</b>
          <span class="ip-pill ${q(sl) >= 75 ? 'ok' : 'bad'}">PV ${q(sl)}%</span></div>
        <div class="ip-sub">${SolarCalculator.compassLabel(sl.azimuthDeg, I18n.lang)} (${sl.azimuthDeg}°) · ${DesignerPanel.num(sl.pitch * 180 / Math.PI, 0)}° · ${DesignerPanel.num(sl.areaM2, 1)} m² · ${I18n.t('bld.pvPlaces', { n: Math.max(0, Math.floor(sl.spanW / 1.06)) * Math.max(0, Math.floor(sl.spanL / 1.71)) })}</div></div>`).join('')}
      ${!slopes.length && !covered ? `<div class="ip-empty">${I18n.t('bld.noPvRoof')}</div>` : ''}`;
  }

  // ------------------------------------------------------------------ tab: thermal balance
  _balanceHtml(){
    const h = this.house, r = this.room(), env = BuildingModel.envelope(h, r), T = this.designT;
    if (env.outdoor) return `<div class="ip-empty">${I18n.t('bld.outdoorNoBalance')}</div>`;
    const q = BuildingModel.designHeatLossW(env, T.tin, T.tout), gW = (el, az) => BuildingModel.solarGainW(env, el, az, 1);
    const ua = env.ua, row = (k, v, u) => `<tr><td>${I18n.t('bld.bal.' + k)}</td><td>${v}</td><td>${u || 'W/K'}</td></tr>`;
    const tot = { area:0, loss:0 };
    for (const o of h.rooms){ const e = BuildingModel.envelope(h, o); if (!e.outdoor){ tot.area += e.floorArea; tot.loss += BuildingModel.designHeatLossW(e, T.tin, T.tout); } }
    const issues = BuildingModel.validate(h);
    const tau = env.thermalMassJK / Math.max(1, (ua.total + env.hv) * 3600);
    return `
      <div class="ip-grid dp-nums"><label>${I18n.t('bld.tin')} (°C)<input type="number" class="dp-tin" step="1" value="${T.tin}"></label><label>${I18n.t('bld.tout')} (°C)<input type="number" class="dp-tout" step="1" value="${T.tout}"></label></div>
      <table class="ip-table dp-table"><tbody>
        ${row('walls', DesignerPanel.num(ua.walls, 1))}${row('windows', DesignerPanel.num(ua.windows, 1))}${row('doors', DesignerPanel.num(ua.doors, 1))}
        ${row('floor', DesignerPanel.num(ua.floor, 1))}${row('roof', DesignerPanel.num(ua.roof, 1))}${row('vent', DesignerPanel.num(env.hv, 1))}
        <tr class="dp-total"><td>${I18n.t('bld.bal.total')}</td><td>${DesignerPanel.num(ua.total + env.hv, 1)}</td><td>W/K</td></tr>
        <tr class="dp-total"><td>${I18n.t('bld.bal.designLoss', { tin: T.tin, tout: T.tout })}</td><td>${DesignerPanel.num(q / 1000, 2)}</td><td>kW (${DesignerPanel.num(q / env.floorArea, 0)} W/m²)</td></tr>
        ${row('mass', DesignerPanel.num(env.thermalMassJK / 1e6, 1), 'MJ/K')}${row('tau', DesignerPanel.num(tau, 1), 'h')}
        ${row('glazing', DesignerPanel.num(env.windowToFloor * 100, 0), '% ' + I18n.t('bld.bal.ofFloor'))}
        ${row('gainSummer', DesignerPanel.num(gW(60, 180), 0), 'W')}${row('gainWinter', DesignerPanel.num(gW(15, 180), 0), 'W')}
      </tbody></table>
      ${env.couplings.length ? `<h4 class="ip-h">${I18n.t('bld.bal.couplings')}</h4>${env.couplings.map(c => `<div class="ip-sub">${DesignerPanel.esc((h.rooms.find(x => x.id === c.roomId) || {}).name)} · ${I18n.t('bld.bal.kind.' + c.kind)} · ${DesignerPanel.num(c.UA, 1)} W/K</div>`).join('')}` : ''}
      <h4 class="ip-h">${I18n.t('bld.bal.house')}</h4>
      <div class="ip-sub">${I18n.t('bld.bal.houseLine', { area: DesignerPanel.num(tot.area, 0), kw: DesignerPanel.num(tot.loss / 1000, 1), wm2: DesignerPanel.num(tot.loss / Math.max(1, tot.area), 0) })}</div>
      <h4 class="ip-h">${I18n.t('bld.issues')}</h4>
      ${issues.length ? `<ul class="ip-issues">${issues.map(i => `<li class="ip-${i.level === 'error' ? 'error' : i.level === 'warning' ? 'warning' : 'info'}">${I18n.t('bld.issue.' + i.code, this._issueParams(i))}</li>`).join('')}</ul>` : `<div class="ip-ok">✔ ${I18n.t('bld.noIssues')}</div>`}`;
  }
  _issueParams(i){ const p = Object.assign({}, i.params || {}); if (p.err) p.err = I18n.t('bld.err.' + p.err); return p; }

  // ------------------------------------------------------------------ events
  _bind(){
    const q = (sel, fn) => this.el.querySelectorAll(sel).forEach(fn), h = this.house;
    q('.dp-close', b => b.addEventListener('click', () => this.onClose()));
    q('.dp-tabs .ip-tab', b => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.msg = null; this.render(); }));
    q('.dp-room', s => s.addEventListener('change', () => { this.roomId = s.value; this.msg = null; this.render(); }));
    q('.dp-focus', b => b.addEventListener('click', () => this.onFocusRoom(this.roomId)));
    q('.dp-tin', i => i.addEventListener('change', () => { this.designT.tin = Number(i.value); this.render(); }));
    q('.dp-tout', i => i.addEventListener('change', () => { this.designT.tout = Number(i.value); this.render(); }));

    // ---- levels & rooms
    q('.dp-level', c => {
      const id = c.dataset.level, l = BuildingModel.level(h, id);
      c.querySelector('.dp-lname').addEventListener('change', e => { l.name = e.target.value.trim().slice(0, 30) || l.name; this.changed('levels'); });
      c.querySelector('.dp-lgo').addEventListener('click', () => { h.activeLevelId = id; this.changed('levelView'); });
      c.querySelector('.dp-ldel').addEventListener('click', () => { const e = BuildingModel.removeLevel(h, id); if (e) this.err(e); else this.msg = null; this.changed('levels'); });
    });
    q('.dp-addlevel', b => b.addEventListener('click', () => { const l = BuildingModel.addLevel(h); h.activeLevelId = l.id; this.say('info', I18n.t('bld.levelAdded', { name:l.name })); this.changed('levels'); }));
    q('.dp-addbasement', b => b.addEventListener('click', () => { const l = BuildingModel.addLevel(h, { below:true }); h.activeLevelId = l.id; this.say('info', I18n.t('bld.levelAdded', { name:l.name })); this.changed('levels'); }));
    q('.dp-viewall', c => c.addEventListener('change', () => { h.levelView = c.checked ? 'all' : 'cutaway'; this.changed('levelView'); }));
    q('.dp-roomcard', c => {
      const id = c.dataset.room, r = h.rooms.find(x => x.id === id); if (!r) return;
      const geometry = () => { const n = BuildingModel.refit(h, r); if (n) this.say('info', I18n.t('bld.refitRemoved', { n })); this.changed('geometry'); };
      c.querySelector('.dp-rname').addEventListener('change', e => { r.name = e.target.value.trim().slice(0, 30) || r.name; this.changed('rooms'); });
      c.querySelector('.dp-rfocus').addEventListener('click', () => this.onFocusRoom(id));
      c.querySelector('.dp-rdel').addEventListener('click', () => this.onRemoveRoom(id));
      c.querySelector('.dp-rtype').addEventListener('change', e => { r.type = e.target.value; const m = getRoomTypeMeta(r.type); Object.assign(r.settings, m.defaults); r.design = null; BuildingModel.ensureRoom(r); geometry(); });
      c.querySelector('.dp-rlevel').addEventListener('change', e => { r.levelId = e.target.value; h.layout = 'free'; geometry(); });
      c.querySelectorAll('.dp-rdim').forEach(i => i.addEventListener('change', () => { const v = Number(i.value); const lim = { width:[1.5, 30], length:[1.5, 30], height:[0.8, 6] }[i.dataset.k]; r.settings[i.dataset.k] = Math.max(lim[0], Math.min(lim[1], v || lim[0])); geometry(); }));
      c.querySelectorAll('.dp-rpos').forEach(i => i.addEventListener('change', () => { r[i.dataset.k] = Number(i.value) || 0; h.layout = 'free'; geometry(); }));
      c.querySelectorAll('.dp-snap').forEach(b => b.addEventListener('click', () => {
        const other = h.rooms.find(x => x.id === c.querySelector('.dp-snapto').value); if (!other) return;
        BuildingModel.snapToRoom(h, r, other, b.dataset.side); h.layout = 'free'; geometry();
      }));
    });
    q('.dp-addroom', b => b.addEventListener('click', () => { const r = this.onAddRoom(this.el.querySelector('.dp-newtype').value, this.el.querySelector('.dp-newlevel').value); if (r) this.roomId = r.id; this.render(); }));

    // ---- walls & openings
    const room = this.room();
    q('.dp-wall', c => {
      const side = c.dataset.side, w = room.design.walls[side];
      c.querySelector('.dp-wmat').addEventListener('change', e => { w.material = e.target.value; this.changed('walls'); });
      c.querySelector('.dp-wins').addEventListener('change', e => { w.insulationCm = Math.max(0, Math.min(40, Number(e.target.value) || 0)); this.changed('walls'); });
      const f = c.querySelector('.dp-front'); if (f) f.addEventListener('change', () => { room.design.frontWall = f.checked; this.changed('walls'); });
    });
    q('.dp-floorins', i => i.addEventListener('change', () => { room.design.floorInsulationCm = Math.max(0, Math.min(40, Number(i.value) || 0)); this.changed('walls'); }));
    q('.dp-addwall', s => s.addEventListener('change', () => { this.addWall = s.value; }));
    q('.dp-addop', b => b.addEventListener('click', () => {
      const t = b.dataset.type, side = this.el.querySelector('.dp-addwall').value; this.addWall = side;
      const len = BuildingModel.sideLength(room, side), H = room.settings.height;
      const spec = t === 'window' ? { width:1.2, height:1.2, sill:0.9, glazing:'double' } : t === 'garage' ? { width:Math.min(2.5, len - 0.5), height:Math.min(2.1, H - 0.2), doorType:'garage' } : { width:0.9, height:Math.min(2.05, H - 0.2), doorType:'exterior' };
      const pos = BuildingModel.suggestPos(h, room, side, spec.width);
      if (pos == null){ this.err('wallFull'); return this.render(); }
      const res = BuildingModel.addOpening(h, room.id, Object.assign({ type:t, wall:side, pos }, spec));
      if (res.error) { this.err(res.error); this.render(); } else { this.msg = null; this.changed('openings'); }
    }));
    q('.dp-open', c => {
      const id = c.dataset.open, o = room.design.openings.find(x => x.id === id); if (!o) return;
      const patch = p => { const res = BuildingModel.updateOpening(h, room.id, id, p); if (res.error){ this.err(res.error); this.render(); } else { this.msg = null; this.changed('openings'); } };
      c.querySelector('.dp-odel').addEventListener('click', () => { BuildingModel.removeOpening(h, room.id, id); this.changed('openings'); });
      c.querySelector('.dp-owall').addEventListener('change', e => patch({ wall:e.target.value }));
      c.querySelectorAll('.dp-onum').forEach(i => i.addEventListener('change', () => patch({ [i.dataset.k]: Number(i.value) })));
      c.querySelector('.dp-okind').addEventListener('change', e => patch(o.type === 'window' ? { glazing:e.target.value } : { doorType:e.target.value }));
      const sl = c.querySelector('.dp-oopen');
      sl.addEventListener('input', () => { o.open = Number(sl.value) / 100; this.onOpeningState(room.id, id, o.open); });     // live: animates the 3D door / window
      sl.addEventListener('change', () => { this.changed('openState'); });
    });

    // ---- partitions & stairs
    q('.dp-addpart', b => b.addEventListener('click', () => {
      const W = room.settings.width, L = room.settings.length, axis = b.dataset.axis;
      const res = axis === 'z' ? BuildingModel.addPartition(h, room.id, { x1:W / 2, z1:0.1, x2:W / 2, z2:L - 0.1 }) : BuildingModel.addPartition(h, room.id, { x1:0.1, z1:L / 2, x2:W - 0.1, z2:L / 2 });
      if (res.error) { this.err(res.error); this.render(); } else { this.msg = null; this.changed('partitions'); }
    }));
    q('.dp-part', c => {
      const id = c.dataset.part, p = room.design.partitions.find(x => x.id === id); if (!p) return;
      c.querySelector('.dp-pdel').addEventListener('click', () => { BuildingModel.removePartition(h, room.id, id); this.changed('partitions'); });
      c.querySelector('.dp-pmat').addEventListener('change', e => { p.material = e.target.value; this.changed('partitions'); });
      c.querySelector('.dp-pdoor').addEventListener('change', e => { p.doorWidth = Math.max(0, Math.min(3, Number(e.target.value) || 0)); this.changed('partitions'); });
    });
    q('.dp-addstair', b => b.addEventListener('click', () => {
      const res = BuildingModel.addStair(h, { roomId:room.id, toLevelId:this.el.querySelector('.dp-stlevel').value, dir:this.el.querySelector('.dp-stdir').value, x:Number(this.el.querySelector('.dp-stx').value), z:Number(this.el.querySelector('.dp-stz').value) });
      if (res.error) { this.err(res.error); this.render(); } else { this.msg = null; this.changed('stairs'); }
    }));
    q('.dp-stair', c => c.querySelector('.dp-sdel').addEventListener('click', () => { BuildingModel.removeStair(h, c.dataset.stair); this.changed('stairs'); }));

    // ---- roof
    const roof = room.design.roof;
    q('.dp-rooftype', s => s.addEventListener('change', () => { roof.type = s.value; this.changed('roof'); }));
    q('.dp-roofnum', i => i.addEventListener('change', () => { roof[i.dataset.k] = Number(i.value); BuildingModel.ensureRoom(room); this.changed('roof'); }));
    q('.dp-roofface', s => s.addEventListener('change', () => { roof.facing = s.value; this.changed('roof'); }));
    q('.dp-pvslope', s => s.addEventListener('change', () => { roof.pvSlope = s.value; this.changed('roof'); }));
  }
}
