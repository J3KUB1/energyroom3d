/** Floor-grid geometry test with a tiny THREE stub that records what RoomBuilder would draw. */
const { createContext, test, assert, near, summary } = require('./harness');
const ctx = createContext();
class Obj3D { constructor(){ this.children=[]; this.parent=null; this.visible=true; }
  add(c){ this.children.push(c); c.parent=this; } remove(c){ this.children=this.children.filter(x=>x!==c); }
  traverse(f){ f(this); this.children.forEach(c=>c.traverse&&c.traverse(f)); } }
ctx.THREE = {
  Group: class extends Obj3D {},
  BufferGeometry: class { setAttribute(n,a){ this[n]=a; } dispose(){ this.disposed=true; } },
  Float32BufferAttribute: class { constructor(arr,size){ this.array=arr; this.itemSize=size; } },
  LineBasicMaterial: class { constructor(o){ Object.assign(this,o); } dispose(){} },
  LineSegments: class extends Obj3D { constructor(g,m){ super(); this.geometry=g; this.material=m; } },
};
console.log('Floor grid');
const RB = ctx.$('RoomBuilder');
function makeGrid(W,L,step){
  const rb = Object.create(RB.prototype); rb.gridStep=step; rb.gridVisible=true; rb.gridGroups={}; rb.bounds={ r:{width:W,length:L,height:2.8,offsetX:0} };
  const parent = new ctx.THREE.Group(); rb._buildFloorGrid('r', W, L, parent);
  const g = rb.gridGroups.r; return { rb, g, parent };
}
function segs(g){ return g.children.map(ls=>({ opacity:ls.material.opacity, n:ls.geometry.position.array.length/6, arr:ls.geometry.position.array })); }
test('lines start exactly at the room corner and end exactly at the far wall', ()=>{
  const { g } = makeGrid(5.5,4.0,0.25);
  let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
  for (const s of segs(g)) for (let i=0;i<s.arr.length;i+=3){ minX=Math.min(minX,s.arr[i]); maxX=Math.max(maxX,s.arr[i]); minZ=Math.min(minZ,s.arr[i+2]); maxZ=Math.max(maxZ,s.arr[i+2]); }
  near(minX,0); near(maxX,5.5); near(minZ,0); near(maxZ,4.0);
});
test('line counts match room size / step (minor + major split)', ()=>{
  const { g } = makeGrid(5.5,4.0,0.25);
  const [minor, major, outline] = segs(g);
  // x lines: 0..5.5 => 23; z lines 0..4 => 17; major = whole metres: x 0..5 (6) z 0..4 (5)
  assert(major.n === 6+5, 'major '+major.n); assert(minor.n === (23-6)+(17-5), 'minor '+minor.n); assert(outline.n === 4);
});
test('resizing the room rebuilds the grid to the new size (no stale lines)', ()=>{
  const { rb, g } = makeGrid(5.5,4.0,0.25);
  rb.bounds.r = { width:3.0, length:2.6, height:2.6, offsetX:0 };
  rb._fillGrid(g, rb.bounds.r);
  const all = segs(g); let maxX=0; for (const s of all) for (let i=0;i<s.arr.length;i+=3) maxX=Math.max(maxX,s.arr[i]);
  near(maxX,3.0);
});
test('changing snap step changes the drawn spacing; old geometry disposed', ()=>{
  const { rb, g } = makeGrid(4,4,0.25); const oldGeo = g.children[0].geometry;
  rb.setGridStep(0.5);
  assert(oldGeo.disposed, 'old geometry disposed');
  const [minor, major] = segs(g); assert(major.n===10, 'major '+major.n); assert(minor.n === 8, 'minor '+minor.n);
});
test('grid lines never coincide with the floor plane (y=0.006) and visibility toggles', ()=>{
  const { rb, g } = makeGrid(4,4,0.25);
  for (const s of segs(g)) for (let i=1;i<s.arr.length;i+=3) near(s.arr[i], 0.006);
  rb.setGridVisible(false); assert(g.visible===false); rb.setGridVisible(true); assert(g.visible===true);
});
test('every grid line falls on a multiple of the step (objects snapped to the step sit exactly on lines)', ()=>{
  const step=0.25, { g } = makeGrid(5.5,5.5,step);
  for (const s of segs(g).slice(0,2)) for (let i=0;i<s.arr.length;i+=3){ for (const v of [s.arr[i], s.arr[i+2]]){ const k=v/step; assert(Math.abs(k-Math.round(k))<1e-4 || Math.abs(v-5.5)<1e-6, 'off-grid '+v); } }
});
summary();
