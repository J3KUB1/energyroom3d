/**
 * 3D Energy Simulator Enterprise - Version 1.2
 * Engine for Loading & Managing Read-Only Custom 3D Asset Files (.gltf/.glb)
 */

class EnergySimulatorv12 {
    constructor() {
        this.devices = [];
        this.energyRate = 1.00;
        this.selectedFile = null;

        this.initThree();
        this.initGLTF();
        this.initEvents();
        this.animate();
    }

    initThree() {
        const container = document.getElementById('canvas-container');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x080d1a);

        this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
        this.camera.position.set(7, 6, 9);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.02;

        // Oświetlenie
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(8, 12, 6);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        this.scene.add(dirLight);

        this.createRoomEnvironment();

        window.addEventListener('resize', () => this.onWindowResize());
    }

    createRoomEnvironment() {
        const roomSize = 10;
        
        // Podłoga
        const floorGeo = new THREE.PlaneGeometry(roomSize, roomSize);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Siatka podłogowa
        const grid = new THREE.GridHelper(roomSize, 10, 0x6366f1, 0x334155);
        grid.position.y = 0.01;
        this.scene.add(grid);

        // Ściany
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
        
        const backWall = new THREE.Mesh(new THREE.PlaneGeometry(roomSize, 5), wallMat);
        backWall.position.set(0, 2.5, -roomSize / 2);
        backWall.receiveShadow = true;
        this.scene.add(backWall);

        const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(roomSize, 5), wallMat);
        leftWall.position.set(-roomSize / 2, 2.5, 0);
        leftWall.rotation.y = Math.PI / 2;
        leftWall.receiveShadow = true;
        this.scene.add(leftWall);
    }

    initGLTF() {
        this.gltfLoader = new THREE.GLTFLoader();
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.selectedFile = file;
        const cleanName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        
        document.getElementById('custom-name').value = cleanName;
        document.getElementById('file-details').classList.remove('hidden');
    }

    confirmAddCustomModel() {
        if (!this.selectedFile) return;

        const name = document.getElementById('custom-name').value || this.selectedFile.name;
        const power = parseFloat(document.getElementById('custom-power').value) || 100;
        const hours = parseFloat(document.getElementById('custom-hours').value) || 8;

        this.showToast(`Parsowanie pliku: ${this.selectedFile.name}...`);

        const reader = new FileReader();
        reader.onload = (e) => {
            const contents = e.target.result;

            this.gltfLoader.parse(contents, '', (gltf) => {
                const model = gltf.scene;
                const id = Date.now();

                // Normalizacja skali (Bounding Box Auto-Fitting)
                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                
                if (maxDim > 2 || maxDim < 0.2) {
                    const scaleFactor = 1.2 / maxDim;
                    model.scale.set(scaleFactor, scaleFactor, scaleFactor);
                }

                // Centrowanie punktu pivot na dole modelu
                const updatedBox = new THREE.Box3().setFromObject(model);
                const center = updatedBox.getCenter(new THREE.Vector3());

                model.position.x = -center.x;
                model.position.y = -updatedBox.min.y;
                model.position.z = -center.z;

                const wrapperGroup = new THREE.Group();
                wrapperGroup.add(model);

                model.traverse((node) => {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;
                    }
                });

                // Losowa pozycja w obrębie podłogi
                const posX = (Math.random() - 0.5) * 4;
                const posZ = (Math.random() - 0.5) * 4;
                wrapperGroup.position.set(posX, 0, posZ);

                this.scene.add(wrapperGroup);
                this.registerDevice(id, name, power, hours, wrapperGroup, this.selectedFile.name);
                this.hideToast();

                // Reset pól wyboru
                document.getElementById('file-details').classList.add('hidden');
                document.getElementById('file-input').value = '';
                this.selectedFile = null;
            }, (error) => {
                console.error("Błąd ładowania pliku GLTF:", error);
                alert("Wystąpił błąd podczas parsowania struktury pliku 3D. Upewnij się, że plik jest prawidłowym modelem .gltf/.glb.");
                this.hideToast();
            });
        };

        reader.readAsArrayBuffer(this.selectedFile);
    }

    registerDevice(id, name, power, hours, meshGroup, fileName) {
        this.devices.push({
            id: id,
            name: name,
            power: power,
            hours: hours,
            enabled: true,
            meshGroup: meshGroup,
            fileName: fileName
        });
        this.renderUI();
    }

    removeDevice(id) {
        const index = this.devices.findIndex(d => d.id === id);
        if (index !== -1) {
            this.scene.remove(this.devices[index].meshGroup);
            this.devices.splice(index, 1);
            this.renderUI();
        }
    }

    toggleDevice(id) {
        const dev = this.devices.find(d => d.id === id);
        if (dev) {
            dev.enabled = !dev.enabled;
            dev.meshGroup.traverse((node) => {
                if (node.isMesh && node.material) {
                    node.material.transparent = !dev.enabled;
                    node.material.opacity = dev.enabled ? 1.0 : 0.3;
                }
            });
            this.renderUI();
        }
    }

    updateHours(id, hours) {
        const dev = this.devices.find(d => d.id === id);
        if (dev) {
            dev.hours = parseFloat(hours);
            this.renderUI();
        }
    }

    initEvents() {
        document.getElementById('energy-rate').addEventListener('input', (e) => {
            this.energyRate = parseFloat(e.target.value) || 0;
            this.calculateTotals();
        });
    }

    showToast(message) {
        const toast = document.getElementById('loader-toast');
        document.getElementById('loader-text').innerText = message;
        toast.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-[-10px]');
    }

    hideToast() {
        const toast = document.getElementById('loader-toast');
        toast.classList.add('opacity-0', 'pointer-events-none', 'translate-y-[-10px]');
    }

    renderUI() {
        const listEl = document.getElementById('devices-list');
        
        if (this.devices.length === 0) {
            listEl.innerHTML = `<p class="text-xs text-slate-500 text-center py-6">Brak aktywnych obiektów. Załaduj plik 3D z dysku.</p>`;
            this.calculateTotals();
            return;
        }

        listEl.innerHTML = this.devices.map(dev => {
            const dailyKwh = dev.enabled ? ((dev.power * dev.hours) / 1000).toFixed(2) : '0.00';
            const dailyCost = (dailyKwh * this.energyRate).toFixed(2);

            return `
                <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 transition-all flex flex-col gap-2">
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="font-bold text-xs text-slate-200">${dev.name}</div>
                            <div class="text-[9px] text-slate-500 font-mono">Plik: ${dev.fileName}</div>
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="app.toggleDevice(${dev.id})" class="px-2 py-0.5 rounded text-[10px] font-bold ${dev.enabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-500 border border-slate-700'}">
                                ${dev.enabled ? 'ON' : 'OFF'}
                            </button>
                            <button onclick="app.removeDevice(${dev.id})" class="text-slate-500 hover:text-rose-400 transition">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="flex items-center gap-3">
                        <label class="text-[10px] text-slate-400 w-20">Czas: ${dev.hours}h/d</label>
                        <input type="range" min="0" max="24" step="0.5" value="${dev.hours}" 
                            oninput="app.updateHours(${dev.id}, this.value)" 
                            class="slider-custom h-1">
                    </div>

                    <div class="flex justify-between items-center text-[11px] pt-1.5 border-t border-slate-800/80 font-mono">
                        <span class="text-slate-400">${dailyKwh} kWh/dzień</span>
                        <span class="text-emerald-400 font-bold">${dailyCost} PLN</span>
                    </div>
                </div>
            `;
        }).join('');

        this.calculateTotals();
        lucide.createIcons();
    }

    calculateTotals() {
        let totalKwh = 0;
        
        this.devices.forEach(dev => {
            if (dev.enabled) {
                totalKwh += (dev.power * dev.hours) / 1000;
            }
        });

        const dailyCost = totalKwh * this.energyRate;
        const monthlyCost = dailyCost * 30;
        const yearlyCost = dailyCost * 365;

        document.getElementById('total-daily-kwh').innerText = `${totalKwh.toFixed(2)} kWh`;
        document.getElementById('total-daily-cost').innerText = `${dailyCost.toFixed(2)} PLN`;
        document.getElementById('total-monthly-cost').innerText = `${monthlyCost.toFixed(2)} PLN`;
        document.getElementById('total-yearly-cost').innerText = `${yearlyCost.toFixed(2)} PLN`;
    }

    onWindowResize() {
        const container = document.getElementById('canvas-container');
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

let app;
window.addEventListener('DOMContentLoaded', () => {
    app = new EnergySimulatorv12();
});