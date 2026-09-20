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
summary();
