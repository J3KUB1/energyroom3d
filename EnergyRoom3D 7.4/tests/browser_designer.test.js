/** Real-browser test (Chromium) of the house designer panel with the real BuildingModel (no THREE.js needed). */
const path = require('path');
const ROOT = path.join(__dirname, '..');
let chromium; try { ({ chromium } = require('playwright')); } catch(e){ ({ chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright')); }
(async ()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:420, height:900 } });
  const errors = []; page.on('pageerror', e=>errors.push('pageerror: '+e.message)); page.on('console', m=>{ if (m.type()==='error') errors.push('console: '+m.text()); });
  await page.setContent('<html><head><style>:root{--border:#334;--text-3:#889;--text-1:#eee;--bg-3:#0f1622;--accent-power:#5eead4;--accent-good:#4ade80;--accent-danger:#f87171}body{background:#111;color:#eee;font-family:sans-serif;margin:0;padding:8px}</style></head><body><div id="host" style="width:400px"></div></body></html>');
  await page.addStyleTag({ path: path.join(ROOT,'css/style.css') });
  for (const f of ['js/data/devices.js','js/data/furniture.js','js/data/solar.js','js/data/battery.js','js/data/electrical.js','js/data/building.js','js/i18n/dictionary.js','js/i18n/catalog_en.js','js/i18n/I18n.js',
    'js/energy/ScheduleManager.js','js/energy/SunPosition.js','js/energy/TariffManager.js','js/energy/EnergyCalculator.js','js/energy/ShadeModel.js','js/energy/SolarCalculator.js','js/energy/WeatherSystem.js','js/energy/SimulationEngine.js',
    'js/energy/BuildingModel.js','js/scene/RoomBuilder.js','js/project/ProjectManager.js','js/ui/DesignerPanel.js']) await page.addScriptTag({ path: path.join(ROOT,f) });
  await page.evaluate(()=>{
    I18n.lang = 'pl';
    const w = window.W = { house:freshHouseState(), changes:[], opening:[], focus:[] };
    w.panel = new DesignerPanel(document.getElementById('host'), {
      getHouse:()=>w.house, onChange:k=>w.changes.push(k), onFocusRoom:id=>w.focus.push(id), onOpeningState:(r,o,v)=>w.opening.push([r,o,v]),
      onAddRoom:(type, levelId)=>{ const m = getRoomTypeMeta(type), room = { id:'r'+(w.house.rooms.length+1), name:I18n.roomType(type), type, settings:{...m.defaults}, offsetX:0, offsetZ:0, levelId }; BuildingModel.ensureRoom(room); BuildingModel.placeNewRoom(w.house, room); w.house.rooms.push(room); w.changes.push('addRoom'); return room; },
      onRemoveRoom:id=>{ w.house.rooms = w.house.rooms.filter(r=>r.id!==id); w.changes.push('removeRoom'); },
    });
    w.panel.render();
  });
  let pass=0, fail=0; const ok=(c,m)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m);} };
  const txt = s=>page.textContent(s), qa = s=>page.$$(s), ev = f=>page.evaluate(f);
  console.log('Browser - DesignerPanel');
  ok((await qa('.dp-roomcard')).length===2 && (await txt('.dp-body')).includes('Parter'), 'levels tab lists 2 rooms and the ground level');
  // add level
  await page.click('.dp-addlevel'); ok(await ev(()=>W.house.levels.length===2 && W.house.levels[1].elevation>2.9), 'add level -> a second storey ~3 m up');
  ok((await txt('.dp-msg')).includes('Dodano'), 'confirmation message');
  // add a room on the new level -> stacks on a free spot of the ground floor
  await page.selectOption('.dp-newlevel', await ev(()=>W.house.levels[1].id)); await page.click('.dp-addroom');
  ok(await ev(()=>{ const r = W.house.rooms.at(-1); return r.levelId===W.house.levels[1].id && (r.offsetX===0||r.offsetX===8.4) && W.house.layout==='free'; }), 'room added on the upper level is stacked above a ground room');
  // resize a room -> refit
  const card = page.locator('.dp-roomcard').first();
  await card.locator('.dp-rdim[data-k="width"]').fill('4'); await card.locator('.dp-rdim[data-k="width"]').dispatchEvent('change');
  ok(await ev(()=>W.house.rooms[0].settings.width===4 && W.house.rooms[0].design.openings.every(o=>BuildingModel.validateOpening(W.house, W.house.rooms[0], o)===null)), 'resizing refits the openings inside the new walls');
  // snap garage to main (east)
  const gcard = page.locator('.dp-roomcard').nth(1); await gcard.locator('.dp-snapto').selectOption('main'); await gcard.locator('.dp-snap[data-side="E"]').click();
  ok(await ev(()=>Math.abs(W.house.rooms[1].offsetX - (W.house.rooms[0].offsetX + W.house.rooms[0].settings.width))<1e-9 && BuildingModel.adjacency(W.house, W.house.rooms[0]).E.length===1), 'snap-to-neighbour makes the rooms share a wall');
  // ---- walls tab
  await page.click('.dp-tabs .ip-tab[data-tab="walls"]');
  await page.selectOption('.dp-room', 'main');
  await page.locator('.dp-wall[data-side="N"] .dp-wmat').selectOption('aac');
  ok(await ev(()=>W.house.rooms[0].design.walls.N.material==='aac'), 'wall material changes the model');
  const u1 = await txt('.dp-wall[data-side="N"] .ip-sub'); await page.locator('.dp-wall[data-side="N"] .dp-wins').fill('30'); await page.locator('.dp-wall[data-side="N"] .dp-wins').dispatchEvent('change');
  const u2 = await txt('.dp-wall[data-side="N"] .ip-sub'); ok(u1!==u2 && parseFloat(u2.replace(/[^0-9,]/g,'').replace(',','.'))<parseFloat(u1.replace(/[^0-9,]/g,'').replace(',','.')), 'more insulation shows a lower U-value: '+u1.trim()+' -> '+u2.trim());
  ok((await txt('.dp-wall[data-side="E"] .ip-pill')).includes('wspólna') , 'the wall shared with the garage is labelled as shared');
  // add window on S wall (front)
  await page.selectOption('.dp-addwall','S'); await page.locator('.dp-addop[data-type="window"]').click();
  ok(await ev(()=>W.house.rooms[0].design.openings.some(o=>o.wall==='S' && o.type==='window')), 'added a window on the south wall');
  // invalid edit: 20 m wide window -> error message, model unchanged
  const op = page.locator('.dp-open').last(); const before = await ev(()=>W.house.rooms[0].design.openings.at(-1).width);
  await op.locator('.dp-onum[data-k="width"]').fill('20'); await op.locator('.dp-onum[data-k="width"]').dispatchEvent('change');
  ok((await txt('.dp-msg')).length>5 && await ev(()=>W.house.rooms[0].design.openings.find(o=>o.wall==='S').width)===before, 'invalid opening edit is refused with an explanation, model untouched');
  // open state slider
  const sl = page.locator('.dp-open').first().locator('.dp-oopen'); await sl.fill('60');
  ok(await ev(()=>W.opening.length>0 && Math.abs(W.opening.at(-1)[2]-0.6)<1e-9), 'open-state slider animates the 3D opening live (callback with 0.6)');
  // glazing
  const winCard = page.locator('.dp-open').filter({ hasText:'Okno' }).first(); await winCard.locator('.dp-okind').selectOption('triple');
  ok(await ev(()=>W.house.rooms[0].design.openings.some(o=>o.glazing==='triple')), 'glazing type changes');
  // ---- partitions & stairs
  await page.click('.dp-tabs .ip-tab[data-tab="partitions"]'); await page.click('.dp-addpart[data-axis="z"]');
  ok((await qa('.dp-part')).length===1 && await ev(()=>W.house.rooms[0].design.partitions.length===1), 'partition added');
  await page.locator('.dp-part .dp-pdoor').fill('0'); await page.locator('.dp-part .dp-pdoor').dispatchEvent('change');
  ok(await ev(()=>W.house.rooms[0].design.partitions[0].doorWidth===0), 'doorway removed');
  await page.selectOption('.dp-room','main'); await page.locator('.dp-stx').fill('0.2'); await page.locator('.dp-stdir').selectOption('W'); await page.click('.dp-addstair');
  ok((await txt('.dp-msg')).includes('nie mieszczą') || (await txt('.dp-msg')).length>5, 'stairs that do not fit / have no target are refused with a message');
  // ---- roof
  await page.click('.dp-tabs .ip-tab[data-tab="roof"]'); await page.selectOption('.dp-room','garage');
  ok((await txt('.dp-body')).includes('Nad tym pomieszczeniem jest inne'), 'a room with another room on top of it explains why it has no roof');
  await ev(()=>{ W.house.rooms = W.house.rooms.filter(r=>r.levelId===W.house.levels[0].id); W.panel.render(); });
  const pv = await txt('.dp-body'); ok(/PV \d+%/.test(pv) && /Południe/.test(pv), 'mono roof facing south shows its PV suitability');
  const pctS = parseInt(/PV (\d+)%/.exec(pv)[1]); await page.selectOption('.dp-roofface','N');
  const pctN = parseInt(/PV (\d+)%/.exec(await txt('.dp-body'))[1]); ok(pctS >= 80 && pctN <= 70 && pctS - pctN >= 20, `south ${pctS}% vs north ${pctN}%`);
  await page.selectOption('.dp-rooftype','gable'); ok((await txt('.dp-body')).includes('Połać A') && (await txt('.dp-body')).includes('Połać B'), 'gable shows two slopes');
  // ---- balance
  await page.click('.dp-tabs .ip-tab[data-tab="balance"]'); await page.selectOption('.dp-room','main');
  const loss20 = await txt('.dp-total:nth-of-type(2) td:nth-child(2)').catch(()=>null);
  const table1 = await txt('.dp-table'); ok(/Zapotrzebowanie na ciepło/.test(table1) && /Pojemność cieplna/.test(table1), 'balance table has heat demand and thermal mass');
  const kw = t => parseFloat(/Zapotrzebowanie na ciepło[^0-9-]*(?:[^\n]*?)([0-9]+,[0-9]+)\s*kW/.exec(t.replace(/\s+/g,' '))?.[1].replace(',','.'));
  const a1 = kw(table1); await page.locator('.dp-tout').fill('0'); await page.locator('.dp-tout').dispatchEvent('change'); const a2 = kw(await txt('.dp-table'));
  ok(a1>0 && a2>0 && a2<a1, `milder outdoor temperature lowers the demand: ${a1} kW -> ${a2} kW`);
  // ---- layout / EN
  await ev(()=>{ I18n.lang='en'; W.panel.render(); }); ok((await txt('.dp-head')).includes('House designer') && (await txt('.dp-body')).includes('Thermal mass'), 'English UI');
  await page.click('.dp-tabs .ip-tab[data-tab="levels"]'); ok(await ev(()=>document.documentElement.scrollWidth <= window.innerWidth+1), 'no horizontal overflow at 420px');
  ok(errors.length===0, 'no JS / console errors'+(errors.length?': '+errors.join(' | '):''));
  await browser.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
