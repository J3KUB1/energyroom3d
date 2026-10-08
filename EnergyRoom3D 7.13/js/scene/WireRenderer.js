/**
 * WIRE RENDERER
 * Draws the installation's cables as thin tubes following ElectricalSystem.wirePath() - the same route that is
 * measured and priced. Geometry is rebuilt only when the installation or an element's position changes
 * (marked dirty, rebuilt at most once per frame); colours are refreshed a few times a second from the live loads:
 * grey = idle, green -> amber -> red as the cable approaches its ampacity, dark red = damaged / de-energised by a trip.
 */
class WireRenderer {
  constructor(scene, electrical){
    this.scene = scene; this.electrical = electrical;
    this.group = new THREE.Group(); this.group.name = 'Wires'; scene.add(this.group);
    this.visible = true; this.dirty = true; this.meshes = new Map(); // wireId -> mesh
    this._lastColor = 0;
  }
  setVisible(v){ this.visible = !!v; this.group.visible = this.visible; }
  markDirty(){ this.dirty = true; }

  /** Call every frame (cheap when nothing changed). */
  update(nowMs){
    if (this.dirty){ this._rebuild(); this.dirty = false; }
    if (this.group.visible && nowMs - this._lastColor > 400){ this._lastColor = nowMs; this._recolor(); }
  }

  _rebuild(){
    for (const m of this.meshes.values()){ this.group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.meshes.clear();
    for (const w of this.electrical.data.wires){
      const pts = this.electrical.wirePath(w);
      if (pts.length < 2) continue;
      const path = new THREE.CurvePath();
      for (let i = 1; i < pts.length; i++){
        const a = pts[i-1], b = pts[i];
        if (Math.abs(a.x-b.x) + Math.abs(a.y-b.y) + Math.abs(a.z-b.z) < 1e-4) continue;
        path.add(new THREE.LineCurve3(new THREE.Vector3(a.x,a.y,a.z), new THREE.Vector3(b.x,b.y,b.z)));
      }
      if (!path.curves.length) continue;
      const geo = new THREE.TubeGeometry(path, Math.max(8, path.curves.length * 6), 0.009, 5, false);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color:0x8a94a3 }));
      mesh.userData.wireId = w.id; mesh.renderOrder = 3;
      this.group.add(mesh); this.meshes.set(w.id, mesh);
    }
    this._recolor();
  }

  _recolor(){
    const e = this.electrical, map = new Map(e._els().map(x => [x.id, x]));
    for (const w of e.data.wires){
      const mesh = this.meshes.get(w.id); if (!mesh) continue;
      const s = map.get(w.toId);
      let color = 0x8a94a3;
      if (w.damaged) color = 0x7f1d1d;
      else if (s){
        const cab = e.cableFor(s), I = (s.runtime && s.runtime.currentA) || 0, r = I / cab.ampacityA;
        if (s.runtime && s.runtime.state === 'off') color = 0x4b5563;
        else if (I > 0.05) color = r < 0.6 ? 0x4ade80 : r < 0.9 ? 0xfacc15 : 0xf87171;
        else color = 0x64748b;
      }
      mesh.material.color.setHex(color);
    }
  }
}
