const { createContext, test, assert, summary } = require('./harness');
const ctx=createContext(['js/challenges/ChallengeManager.js']);
const $=ctx.$;
const sim={absMin:100,todayKWh:0,todaySolarKWh:0,todayCost:0,totalUnservedKWh:0,totalConsumedKWh:0,gridOfflineMinutes:0,gridOnline:true};
ctx.__sim=sim;
const manager=$(`new ChallengeManager({simulationEngine:globalThis.__sim,objectManager:{getFurniture:()=>[]},analyticsManager:{projections:()=>({yearCost:100})},getHouseState:()=>({rooms:[]})})`);
console.log('Challenge mode');
test('outage challenge is restricted to realistic mode and disconnects the shared grid',()=>{
  assert(!manager.start('outage',{realistic:false}));
  assert(manager.start('outage',{realistic:true}));
  assert(sim.gridOnline===false);
  const p=manager.progress();assert(p.current===0&&p.pct===0);
});
test('one hour outage passes only when the simulated home stays served and restores prior grid state',()=>{
  sim.absMin+=60;sim.gridOfflineMinutes+=60;sim.totalUnservedKWh=.01;sim.totalConsumedKWh=.1;
  const p=manager.progress();assert(p.ready&&p.passedMetric&&p.unservedKWh===.01&&p.servedKWh===.1);
  sim._recomputeInstant=()=>assert(manager.active===null,'challenge must be cleared before recalculating live grid flows');
  const result=manager.finish();assert(result.passed&&sim.gridOnline===true&&manager.active===null);
  delete sim._recomputeInstant;
});
test('outage fails when battery/PV cannot serve household load',()=>{
  assert(manager.start('outage',{realistic:true}));sim.absMin+=60;sim.gridOfflineMinutes+=60;sim.totalUnservedKWh+=.03;sim.totalConsumedKWh+=.1;
  const result=manager.finish();assert(!result.passed&&sim.gridOnline===true);
});
test('bringing the grid back early cannot satisfy the full outage objective',()=>{
  assert(manager.start('outage',{realistic:true}));sim.gridOnline=true;sim.absMin+=60;sim.totalConsumedKWh+=.1;
  const result=manager.finish();assert(!result.passed&&sim.gridOnline===true);
});
summary();
