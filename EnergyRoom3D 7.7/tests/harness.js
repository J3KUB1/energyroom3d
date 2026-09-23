/**
 * Headless test harness: loads the app's plain <script> files into one vm context (same shared
 * global scope as the browser) with minimal DOM stubs. No THREE.js / DOM rendering involved - it
 * exercises the pure simulation logic exactly as shipped.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

function createContext(extraFiles){
  const store = {};
  const ctx = {
    console, Math, Date, JSON, Array, Object, Map, Set, Number, String, Infinity, NaN, isFinite, parseFloat, parseInt,
    localStorage: { getItem:k=>store[k]??null, setItem:(k,v)=>{store[k]=String(v);}, removeItem:k=>{delete store[k];} },
    document: { documentElement:{ setAttribute(){} }, querySelectorAll:()=>[], getElementById:()=>null },
    requestAnimationFrame: ()=>0, cancelAnimationFrame: ()=>{},
    window: {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const files = [
    'js/data/devices.js','js/data/furniture.js','js/data/solar.js','js/data/battery.js','js/data/electrical.js','js/data/building.js',
    'js/i18n/dictionary.js','js/i18n/catalog_en.js','js/i18n/I18n.js',
    'js/energy/ScheduleManager.js','js/energy/SunPosition.js','js/energy/TariffManager.js',
    'js/energy/EnergyCalculator.js','js/energy/ShadeModel.js','js/energy/SolarCalculator.js','js/energy/WeatherSystem.js',
    'js/energy/ElectricalSystem.js','js/energy/BuildingModel.js','js/energy/SimulationEngine.js','js/automation/AutomationManager.js',
    'js/scene/DayNightCycle.js','js/scene/RoomBuilder.js','js/project/ProjectManager.js',
  ].concat(extraFiles || []);
  for (const f of files){
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  // top-level const/class declarations live in the context's global lexical scope; expose via eval
  ctx.$ = (expr)=> vm.runInContext(expr, ctx);
  return ctx;
}

let passed = 0, failed = 0; const failures = [];
function test(name, fn){
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch(e){ failed++; failures.push(name); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function assert(c, msg){ if (!c) throw new Error(msg || 'assertion failed'); }
function near(a, b, tol, msg){ if (Math.abs(a-b) > (tol==null?1e-6:tol)) throw new Error((msg||'near')+': '+a+' vs '+b); }
function summary(){ console.log(`\n${passed} passed, ${failed} failed`); if (failed){ console.log('Failed: '+failures.join(', ')); process.exit(1); } }
module.exports = { createContext, test, assert, near, summary, ROOT };
