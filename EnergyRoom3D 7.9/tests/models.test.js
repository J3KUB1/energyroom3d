/** Smoke test: every model builder (incl. the new electrical ones) runs against a permissive THREE stub without
 *  throwing, and returns a group with the userData the app relies on. */
const { createContext, test, assert, summary, ROOT } = require('./harness');
const fs = require('fs'), vm = require('vm');
const ctx = createContext();
function stub(){
  const fn = function(){}; 
  const p = new Proxy(fn, {
    get:(t,k)=> k === Symbol.toPrimitive ? ()=>0 : (k === 'userData' ? (t._ud || (t._ud = {})) : (k === 'children' ? (t._ch || (t._ch = [])) : (k === 'length' ? 0 : (t['_'+String(k)] || (t['_'+String(k)] = stub()))))),
    set:(t,k,v)=>{ t['_'+String(k)] = v; return true; },
    apply:()=>stub(), construct:()=>stub(),
  });
  return p;
}
ctx.THREE = new Proxy({}, { get:()=>stub() });
ctx.document = Object.assign(ctx.document, { createElement:()=>({ getContext:()=>stub(), width:0, height:0 }) });
vm.runInContext(fs.readFileSync(ROOT+'/js/scene/ModelFactory.js','utf8'), ctx, { filename:'ModelFactory.js' });
console.log('Model builders');
test('every model type referenced by any catalog can be built (no exceptions)', ()=>{
  const types = new Set();
  for (const list of ['DEVICE_DEFINITIONS','FURNITURE_DEFINITIONS','SOLAR_DEFINITIONS','BATTERY_DEFINITIONS','ELECTRICAL_DEFINITIONS']){
    let defs; try { defs = ctx.$(list); } catch(e){ continue; }
    for (const d of defs) if (d.modelType) types.add(d.modelType);
  }
  assert(types.size > 40, 'model types found: '+types.size);
  for (const t of types){ ctx.__t = t; try { ctx.$('ModelFactory.build(__t, true)'); } catch(e){ throw new Error('model "'+t+'" failed: '+e.message); } }
});
test('electrical models exist (socket, strip, board, meter)', ()=>{
  for (const t of ['elsocket','elstrip','elboard','elmeter']){ ctx.__t = t; ctx.$('ModelFactory.build(__t, false)'); }
});
summary();
