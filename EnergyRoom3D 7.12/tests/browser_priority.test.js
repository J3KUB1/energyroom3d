/** Real-browser test (Chromium via Playwright) of the visual PV priority list: click, keyboard, mouse-drag,
 *  language switch, all 6 orders reachable. THREE.js is not needed - the component is standalone. */
const path = require('path');
const ROOT = path.join(__dirname, '..');
let chromium; try { ({ chromium } = require('playwright')); } catch(e){ ({ chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright')); }

(async ()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:420, height:800 } });
  const errors = []; page.on('pageerror', e=>errors.push('pageerror: '+e.message)); page.on('console', m=>{ if (m.type()==='error') errors.push('console: '+m.text()); });
  await page.setContent('<html><head><style>:root{--border:#334;--text-3:#889;--accent-power:#5eead4}body{background:#111;color:#eee;font-family:sans-serif}</style></head><body><div id="host" style="width:360px"></div></body></html>');
  await page.addStyleTag({ path: path.join(ROOT,'css/style.css') });
  for (const f of ['js/i18n/dictionary.js','js/i18n/catalog_en.js','js/i18n/I18n.js','js/energy/SimulationEngine.js','js/ui/PriorityList.js']) await page.addScriptTag({ path: path.join(ROOT,f) });
  await page.evaluate(()=>{ I18n.lang='pl'; window.changes=[]; window.pl = new PriorityList(document.getElementById('host'), { order:['home','battery','grid'], onChange:o=>window.changes.push(o.join('>')) }); });
  let pass=0, fail=0; const ok=(c,m)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m);} };
  const order = ()=>page.evaluate(()=>window.pl.order.join('>'));
  const rows = ()=>page.$$eval('.pl-row', r=>r.map(x=>x.dataset.sink).join('>'));
  console.log('Browser - PriorityList');
  ok(await rows()==='home>battery>grid', 'renders 3 rows in the given order');
  ok((await page.textContent('.pl-summary-val'))==='Dom → Bateria → Sieć', 'summary shows current priority (PL)');
  await page.click('.pl-row[data-sink="home"] .pl-down');
  ok(await order()==='battery>home>grid' && (await page.evaluate(()=>window.changes.at(-1)))==='battery>home>grid', 'down-button reorders and fires onChange immediately');
  ok((await page.textContent('.pl-summary-val'))==='Bateria → Dom → Sieć', 'summary updates');
  // keyboard: Alt+ArrowDown on the focused row
  await page.focus('.pl-row[data-sink="battery"]'); await page.keyboard.press('Alt+ArrowDown');
  ok(await order()==='home>battery>grid', 'Alt+ArrowDown reorders from the keyboard');
  // mouse drag: grab the grid handle (3rd row) and drop above the first row
  const h = await (await page.$('.pl-row[data-sink="grid"] .pl-handle')).boundingBox();
  const first = await (await page.$('.pl-row:first-child')).boundingBox();
  await page.mouse.move(h.x+h.width/2, h.y+h.height/2); await page.mouse.down();
  await page.mouse.move(h.x+h.width/2, (h.y+first.y)/2, { steps:6 });
  await page.mouse.move(h.x+h.width/2, first.y+4, { steps:6 }); await page.mouse.up();
  ok(await order()==='grid>home>battery', 'dragging the 3rd row to the top reorders (got '+await order()+')');
  ok((await page.textContent('.pl-row:first-child .pl-rank'))==='1' && (await page.$$eval('.pl-rank', r=>r.map(x=>x.textContent).join(',')))==='1,2,3', 'rank numbers 1-2-3 stay consistent');
  ok((await page.$$('.pl-dragging')).length===0, 'drag state cleaned up');
  // every one of the 6 permutations is reachable and stable via setOrder
  const perms = [['home','battery','grid'],['home','grid','battery'],['battery','home','grid'],['battery','grid','home'],['grid','home','battery'],['grid','battery','home']];
  let all = true; for (const p of perms){ await page.evaluate(p=>window.pl.setOrder(p), p); if (await order()!==p.join('>') || await rows()!==p.join('>')) all=false; }
  ok(all, 'all 6 orderings render correctly');
  // disabled edge buttons
  await page.evaluate(()=>window.pl.setOrder(['home','battery','grid']));
  ok(await page.$eval('.pl-row:first-child .pl-up', b=>b.disabled) && await page.$eval('.pl-row:last-child .pl-down', b=>b.disabled), 'first row cannot go up, last cannot go down');
  // language switch re-render
  await page.evaluate(()=>{ I18n.lang='en'; window.pl.render(); });
  ok((await page.textContent('.pl-summary-val'))==='Home → Battery → Grid', 'summary in English');
  ok((await page.textContent('.pl-row:first-child b'))==='Home', 'row labels in English');
  // layout sanity on a phone-width viewport: no horizontal overflow
  ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth+1), 'no horizontal overflow at 420px');
  ok(errors.length===0, 'no JS / console errors'+(errors.length?': '+errors.join(' | '):''));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
