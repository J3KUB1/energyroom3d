const fs = require('fs'), path = require('path');
const { createContext, test, assert, summary, ROOT } = require('./harness');
const ctx = createContext();
const DICT = ctx.$('I18N_DICT');
console.log('I18n coverage');

function walk(dir, out){ for (const f of fs.readdirSync(dir)){ const p = path.join(dir,f); const st = fs.statSync(p);
  if (st.isDirectory()) { if (f!=='tests' && f!=='node_modules') walk(p,out); } else if (/\.(js|html)$/.test(f)) out.push(p); } return out; }
const files = walk(ROOT, []).filter(f => !/dictionary\.js$|catalog_en\.js$/.test(f));

test('PL and EN dictionaries define exactly the same keys', () => {
  const pl = Object.keys(DICT.pl), en = Object.keys(DICT.en);
  const missingEn = pl.filter(k => !(k in DICT.en)), missingPl = en.filter(k => !(k in DICT.pl));
  assert(!missingEn.length && !missingPl.length, `missing in EN: ${missingEn.slice(0,8)} | missing in PL: ${missingPl.slice(0,8)}`);
});
test('placeholders {x} are identical in PL and EN for every key', () => {
  const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  const bad = Object.keys(DICT.pl).filter(k => k in DICT.en && ph(DICT.pl[k]) !== ph(DICT.en[k]));
  assert(!bad.length, 'mismatch: ' + bad.slice(0,8).join(', '));
});
test('every literal I18n.t(...) key used in code exists in both languages', () => {
  const missing = new Set();
  for (const f of files){
    const src = fs.readFileSync(f,'utf8');
    for (const m of src.matchAll(/I18n\.(?:t|plural)\(\s*'([A-Za-z0-9_.\-]+)'/g)){
      const k = m[1];
      if (k.endsWith('.')) continue;
      if (!(k in DICT.pl) && !(k+'.many' in DICT.pl) && !(k+'.one' in DICT.pl)) missing.add(path.basename(f)+': '+k);
    }
  }
  assert(!missing.size, 'undefined keys: ' + [...missing].slice(0,12).join(' | '));
});
test('every data-i18n / data-i18n-title key in HTML exists', () => {
  const missing = [];
  for (const f of files.filter(f=>f.endsWith('.html'))){
    const src = fs.readFileSync(f,'utf8');
    for (const m of src.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) if (!(m[1] in DICT.pl)) missing.push(m[1]);
  }
  assert(!missing.length, missing.slice(0,10).join(', '));
});
test('Polish plural forms (1 / 2-4 / 5+ / 12-14 / 22)', () => {
  ctx.$("I18n.lang='pl'");
  const f = n => ctx.$(`I18n.plural('unit.panel', ${n})`);
  assert(f(1)==='1 panel', f(1)); assert(f(2)==='2 panele', f(2)); assert(f(5)==='5 paneli', f(5));
  assert(f(12)==='12 paneli', f(12)); assert(f(22)==='22 panele', f(22)); assert(f(0)==='0 paneli', f(0));
});
test('English plural forms', () => {
  ctx.$("I18n.lang='en'");
  assert(ctx.$("I18n.plural('unit.device', 1)")==='1 device'); assert(ctx.$("I18n.plural('unit.device', 3)")==='3 devices');
  ctx.$("I18n.lang='pl'");
});
test('t() interpolates named params in both languages', () => {
  ctx.$("I18n.lang='pl'"); assert(ctx.$("I18n.t('log.added',{name:'TV'})")==='Dodano: TV');
  ctx.$("I18n.lang='en'"); assert(ctx.$("I18n.t('log.added',{name:'TV'})")==='Added: TV');
  ctx.$("I18n.lang='pl'");
});
test('catalog: every device has an English edu + note; fallback never blank', () => {
  const defs = ctx.$('DEVICE_DEFINITIONS');
  const miss = defs.filter(d => !ctx.$('CATALOG_EN').edu[d.id] || !ctx.$('CATALOG_EN').note[d.id]).map(d=>d.id);
  assert(!miss.length, 'no EN for: ' + miss.join(','));
  ctx.$("I18n.lang='en'"); assert(ctx.$("I18n.deviceEdu(DEVICE_DEFINITIONS[0])").startsWith('A gaming PC'));
  ctx.$("I18n.lang='pl'"); assert(ctx.$("I18n.deviceEdu(DEVICE_DEFINITIONS[0])").startsWith('Komputer'));
});
test('dynamic key families used by the installation UI are all translated (statuses, diagnostics, cost lines, nodes, events)', () => {
  const src = fs.readFileSync(path.join(ROOT,'js/energy/ElectricalSystem.js'),'utf8');
  const need = [];
  for (const m of src.matchAll(/status\s*[:=]\s*'([A-Za-z]+)'/g)) need.push('elec.status.'+m[1]);
  for (const m of src.matchAll(/\?\s*'([a-zA-Z]+)'\s*:\s*'([a-zA-Z]+)'/g)) {}
  for (const m of src.matchAll(/return '([a-zA-Z]+)';/g)) if (/^(noSupply|mainTripped|noCircuit|noBreaker|breakerTripped|noWire|cableDamaged|ok)$/.test(m[1])) need.push('elec.status.'+m[1]);
  for (const m of src.matchAll(/code:'([A-Za-z]+)'/g)) need.push('elec.diag.'+m[1]);
  for (const m of src.matchAll(/type:'(grid|meter|main|board|breaker|circuit|socket|strip|device)'/g)) need.push('elec.node.'+m[1]);
  for (const m of src.matchAll(/push\('([A-Za-z]+)',/g)) need.push('elec.cost.'+m[1]);
  for (const k of ['live','unassigned','legacy','unplugged','stripOff','stripTripped','stripNotPlugged']) need.push('elec.status.'+k);
  for (const k of ['closed','tripped','off','cableDamaged']) need.push('elec.state.'+k);
  for (const k of ['circuits','elements','devices','costs']) need.push('elec.tab.'+k);
  for (const k of ['ceiling','floor','direct']) need.push('elec.route.'+k);
  for (const k of ['breakerOverload','breakerShort','mainTrip','stripTrip','cableOverheat']) need.push('elec.event.'+k);
  for (const d of ctx.$('ELECTRICAL_DEFINITIONS')) need.push(d.nameKey);
  const missing = [...new Set(need)].filter(k => k !== 'elec.status.pending').filter(k => !(k in DICT.pl) || !(k in DICT.en));
  assert(!missing.length, 'untranslated: ' + missing.join(', '));
  assert(need.length > 40, 'scan found too few keys: ' + need.length);
});
test('designer key families are translated: error codes, issues, materials, glazing, doors, roofs, sides, tabs, room types', () => {
  const src = fs.readFileSync(path.join(ROOT,'js/energy/BuildingModel.js'),'utf8');
  const need = [];
  for (const m of src.matchAll(/(?:error\s*:\s*|return\s+)'([A-Za-z]+)'/g)) need.push('bld.err.'+m[1]);
  for (const m of src.matchAll(/code\s*:\s*'([A-Za-z]+)'/g)) need.push('bld.issue.'+m[1]);
  for (const k of ['WALL_MATERIALS','GLAZING_TYPES','DOOR_TYPES','ROOF_TYPES']) for (const d of Object.values(ctx.$(k))) need.push(d.labelKey);
  for (const sd of ['N','E','S','W']) need.push('bld.side.'+sd);
  for (const t of ['levels','walls','partitions','roof','balance']) need.push('bld.tab.'+t);
  for (const t of ['window','door','garage']) need.push('bld.kind.'+t);
  for (const t of Object.keys(ctx.$('ROOM_TYPE_META'))) need.push('roomtype.'+t);
  for (const t of ['walls','windows','doors','floor','roof','vent','total','mass','tau','glazing','gainSummer','gainWinter','couplings','house']) need.push('bld.bal.'+t);
  for (const t of ['wall','floor','ceiling','door']) need.push('bld.bal.kind.'+t);
  const missing = [...new Set(need)].filter(k => !(k in DICT.pl) || !(k in DICT.en));
  assert(!missing.length, 'untranslated: ' + missing.join(', '));
  assert(need.length > 45, 'scan found too few keys: ' + need.length);
});
summary();
