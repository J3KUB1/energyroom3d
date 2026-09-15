/**
 * TRANSFORM MANAGER
 * Selection (raycast picking + highlight) + Move/Rotate/Scale gizmo
 * (THREE.TransformControls) + grid/rotation snapping.
 * Unity mapping: SelectionManager + the Unity Editor's own gizmo
 * (this module exists purely because Three.js needs one, unlike Unity).
 */
class TransformManager {
  constructor(sceneManager, objectManager){
    this.sm = sceneManager; this.om = objectManager;
    this.selectedId = null;
    this.snapEnabled = true;
    this.gridSnap = 0.25; // meters
    this.rotSnapDeg = 15;
    this.onSelect = ()=>{};
    this.onHover = ()=>{};
    this.onTransformCommit = ()=>{};
    this.onToggle = ()=>{}; // double-click / double-tap quick power toggle

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.gizmo = new THREE.TransformControls(sceneManager.camera, sceneManager.renderer.domElement);
    this.gizmo.setSize(0.85);
    this.gizmo.addEventListener('dragging-changed', (e)=>{ sceneManager.controls.enabled = !e.value; });
    this.gizmo.addEventListener('objectChange', ()=>this._onGizmoChange());
    sceneManager.scene.add(this.gizmo);
    this._applySnap();

    // selection highlight box
    this.highlight = new THREE.BoxHelper(new THREE.Object3D(), 0x5eead4);
    this.highlight.visible = false;
    sceneManager.scene.add(this.highlight);

    const dom = sceneManager.renderer.domElement;
    dom.addEventListener('click', (e)=>this._onClick(e));
    dom.addEventListener('mousemove', (e)=>this._onMove(e));
    dom.addEventListener('dblclick', (e)=>this._onDblClick(e));

    sceneManager.onFrame(()=>{
      if (this.selectedId){
        const inst = this.om.find(this.selectedId);
        if (inst){ this.highlight.setFromObject(inst.group); }
      }
    });
  }

  _ndc(e){
    const rect = this.sm.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX-rect.left)/rect.width)*2-1;
    this.mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
  }

  _pick(e){
    this._ndc(e);
    this.raycaster.setFromCamera(this.mouse, this.sm.camera);
    const hits = this.raycaster.intersectObjects(this.om.root.children, true);
    for (const h of hits){
      let o = h.object;
      while (o && !o.userData.instId) o = o.parent;
      if (o) return o.userData.instId;
    }
    return null;
  }

  _onClick(e){
    if (this.gizmo.dragging) return;
    const id = this._pick(e);
    this.select(id);
  }
  _onMove(e){
    const id = this._pick(e);
    this.onHover(id ? this.om.find(id) : null, e);
  }
  _onDblClick(e){
    const id = this._pick(e);
    if (id) this.onToggle(id);
  }

  select(id){
    this.selectedId = id;
    const inst = id ? this.om.find(id) : null;
    if (inst){
      this.gizmo.attach(inst.group);
      this.gizmo.setSpace(inst.kind==='solar' ? 'local' : 'world'); // panels live on a tilted roof group
      this.highlight.visible = true;
      this.highlight.setFromObject(inst.group);
    } else {
      this.gizmo.detach();
      this.highlight.visible = false;
    }
    this.onSelect(inst);
  }
  deselect(){ this.select(null); }

  setMode(mode){ this.gizmo.setMode(mode); } // 'translate' | 'rotate' | 'scale'
  setSnap(enabled){ this.snapEnabled = enabled; this._applySnap(); }
  setGridSnap(m){ this.gridSnap = m; this._applySnap(); }
  setRotSnap(deg){ this.rotSnapDeg = deg; this._applySnap(); }
  _applySnap(){
    this.gizmo.setTranslationSnap(this.snapEnabled ? this.gridSnap : null);
    this.gizmo.setRotationSnap(this.snapEnabled ? THREE.MathUtils.degToRad(this.rotSnapDeg) : null);
    this.gizmo.setScaleSnap(this.snapEnabled ? 0.05 : null);
  }

  _onGizmoChange(){
    const inst = this.om.find(this.selectedId);
    if (!inst) return;
    inst.position = { x:inst.group.position.x, y:inst.group.position.y, z:inst.group.position.z };
    inst.rotation = { x:inst.group.rotation.x, y:inst.group.rotation.y, z:inst.group.rotation.z };
    inst.scale = { x:inst.group.scale.x, y:inst.group.scale.y, z:inst.group.scale.z };
    this.onTransformCommit(inst);
  }

  setTransformManual(id, field, axis, value){
    const inst = this.om.find(id); if (!inst) return;
    if (field==='position') inst.position[axis]=value;
    if (field==='rotation') inst.rotation[axis]=THREE.MathUtils.degToRad(value);
    if (field==='scale') inst.scale[axis]=Math.max(0.05, value);
    this.om.applyTransform(id, inst.position, inst.rotation, inst.scale);
    this.onTransformCommit(inst);
  }
}
