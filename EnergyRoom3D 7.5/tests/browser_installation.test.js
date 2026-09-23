/** Real-browser test (Chromium) of the electrical installation panel with a fake scene adapter (no THREE.js needed). */
const path = require('path');
const ROOT = path.join(__dirname, '..');
let chromium; try { ({ chromium } = require('playwright')); } catch(e){ ({ chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright')); }

(async ()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:420, height:900 } });
  const errors = []; page.on('pageerror', e=>errors.push('pageerror: '+e.message)); page.on('console', m=>{ if (m.type()==='error') errors.push('console: '+m.text()); });
  await page.setContent('<html><head><style>:root{--border:#334;--text-3:#889;--text-1:#eee;--bg-3:#0f1622;--accent-power:#5eead4;--accent-good:#4ade80;--accent-danger:#f87171}body{background:#111;color:#eee;font-family:sans-serif;margin:0;padding:8px}</style></head><body><div id="host" style="width:400px"></div></body></html>');
  await page.addStyleTag({ path: path.join(ROOT,'css/style.css') });
  for (const f of ['js/data/devices.js','js/data/electrical.js','js/i18n/dictionary.js','js/i18n/catalog_en.js','js/i18n/I18n.js','js/energy/ElectricalSystem.js','js/ui/InstallationPanel.js'])
    await page.addScriptTag({ path: path.join(ROOT,f) });
  await page.evaluate(()=>{
    I18n.lang = 'pl';
    const w = window.W = { els:[], devs:[], changes:0, selected:[], added:[], nextId:1, wires:true,
      rooms:[ { id:'main', name:'Salon', type:'room', offsetX:0, width:5, length:4, height:2.6 }, { id:'garage', name:'Garaż', type:'garage', offsetX:6, width:4, length:5, height:2.6 } ] };
    w.make = (defId, roomId, pos, rotY)=>{ const e = { id:'el'+(w.nextId++), kind:'electrical', defId, def:getElectricalDefinition(defId), roomId, position:{ x:pos.x, y:pos.y, z:pos.z }, rotation:{x:0,y:rotY||0,z:0}, circuitId:null, plugTo:null, enabled:true, runtime:{} }; w.els.push(e); return e; };
    w.sys = new ElectricalSystem({ getElements:()=>w.els, getDevices:()=>w.devs, getRooms:()=>w.rooms, createElement:(d,r,p,ry)=>w.make(d,r,p,ry), onEvent:()=>{} });
    for (const [n,x,z] of [['Lodówka',1.2,0.3],['TV',3,0.3]]) w.devs.push({ id:'d_'+n, kind:'device', roomId:'main', position:{x,y:0,z}, connected:true, plugTo:null, customName:n, def:{ name:n, ratedPowerW:200 }, runtime:{ powerW:0 } });
    w.sys.autoInstall();
    w.step = (map, n)=>{ for (let i=0;i<(n||1);i++) w.sys.resolve(w.devs.map(d=>({ id:d.id, desiredW:map[d.id]||0, connected:true, plugTo:d.plugTo })), { accumulate:true }); };
    w.panel = new InstallationPanel(document.getElementById('host'), { electrical:w.sys, onChange:()=>{ w.changes++; }, onSelect:id=>w.selected.push(id), onAddElement:d=>w.added.push(d),
      getEconomics:()=>({ energyYearZl: 1234 }), getWireVisible:()=>w.wires, onWireVisible:v=>{ w.wires = v; } });
    w.panel.render();
  });
  let pass=0, fail=0; const ok=(c,m)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m);} };
  const q = s=>page.$(s), qa = s=>page.$$(s), txt = s=>page.textContent(s);
  console.log('Browser - InstallationPanel');
  ok((await qa('[data-circuit]')).length===2, 'renders one card per circuit (2 rooms)');
  ok((await txt('.ip-main')).includes('Wyłącznik główny') && (await txt('.ip-main')).includes('Instalacja bez uwag'), 'main breaker card + "no issues"');
  // change breaker rating
  await page.selectOption('[data-circuit] .ip-rating', '20');
  ok(await page.evaluate(()=>W.sys.data.breakers[0].ratingA===20 && W.changes>0), 'changing the rating updates the model and notifies the app');
  // cable smaller than breaker => error diagnostic appears
  await page.selectOption('[data-circuit] .ip-cable', 'ydy_3x1_5');
  ok((await txt('.ip-main')).includes('za duże dla przewodu'), 'breaker larger than cable -> diagnostic shown');
  ok(await page.evaluate(()=>document.querySelector('[data-circuit] .ip-error')!==null), 'and on the circuit card itself');
  await page.selectOption('[data-circuit] .ip-cable', 'ydy_3x2_5'); await page.selectOption('[data-circuit] .ip-rating', '16');
  // add / delete circuit
  await page.click('.ip-add-circuit'); ok((await qa('[data-circuit]')).length===3, 'add circuit');
  await page.locator('[data-circuit]').last().locator('.ip-del').click(); ok((await qa('[data-circuit]')).length===2, 'delete circuit');
  // trip: overload the first circuit for a few minutes -> card shows tripped + reset button
  await page.evaluate(()=>{ const so = W.sys.sockets('main')[0]; W.sys.data.circuits.forEach(c=>c); W.sys.setBreakerRating(W.sys.circuit(so.circuitId).breakerId, 6);
    W.devs.forEach(d=>W.sys.unplugDevice(d.id)); W.sys.plugDevice('d_Lodówka', so.id); W.sys.plugDevice('d_TV', so.id);
    W.step({ 'd_Lodówka':2000, 'd_TV':2000 }, 5); W.panel.render(); });
  ok((await txt('[data-circuit]')).includes('Zadziałał'), 'tripped breaker is shown as tripped');
  ok((await qa('.ip-reset-br')).length===1, 'reset button available');
  await page.click('.ip-reset-br');
  ok(await page.evaluate(()=>W.sys.data.breakers.every(b=>b.state==='closed')), 'reset closes the breaker');
  // elements tab
  await page.click('.ip-tab[data-tab="elements"]');
  ok((await qa('[data-socket]')).length===8, 'elements tab lists 8 sockets');
  await page.locator('[data-socket]').first().locator('.ip-s-wire').click();
  ok(await page.evaluate(()=>W.sys.sockets().filter(s=>!W.sys.wireOf(s.id)).length===1), 'un-wiring a socket removes its cable');
  await page.locator('[data-socket]').first().locator('.ip-select').click(); ok(await page.evaluate(()=>W.selected.length===1), 'select-in-scene callback fires');
  await page.click('.ip-add[data-def="power_strip"]'); ok(await page.evaluate(()=>W.added[0]==='power_strip'), 'add strip callback');
  // devices tab: plug select
  await page.click('.ip-tab[data-tab="devices"]');
  ok((await qa('[data-device]')).length===2, 'devices tab lists devices');
  const target = await page.evaluate(()=>W.sys.sockets('main')[2].id);
  await page.selectOption('[data-device="d_TV"] .ip-d-plug', target);
  ok(await page.evaluate(t=>W.devs.find(d=>d.id==='d_TV').plugTo===t, target), 'plugging a device through the UI');
  // costs tab
  await page.click('.ip-tab[data-tab="costs"]');
  const costs = await txt('.ip-body');
  ok(/Razem/.test(costs) && /zł/.test(costs) && /Amortyzacja/.test(costs) && /1234,00 zł/.test(costs), 'costs table with total, amortisation and project year cost');
  ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth+1), 'no horizontal page overflow at 420px (costs tab)');
  // language switch
  await page.evaluate(()=>{ I18n.lang='en'; W.panel.render(); });
  ok((await txt('.ip-main')).includes('Main breaker') && (await txt('.ip-body')).includes('Installation cost') || (await txt('.ip-body')).includes('Item'), 'English UI');
  // wires checkbox
  await page.check('.ip-wires'); await page.uncheck('.ip-wires'); ok(await page.evaluate(()=>W.wires===false), 'show-wires toggle callback');
  ok(errors.length===0, 'no JS / console errors'+(errors.length?': '+errors.join(' | '):''));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
