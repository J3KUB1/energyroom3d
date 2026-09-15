/**
 * 3D Energy Simulator Pro Engine
 * Architecture: ES6 Class-based Modular Controller
 */

class EnergySimulator {
    constructor() {
        this.devices = [];
        this.selectedDeviceId = null;
        this.energyRate = 1.00;

        // Szablony gotowych obiektów 3D
        this.deviceTemplates = {
            pc: { name: 'Komputer Stacjonarny', power: 350, hours: 8, color: 0x3b82f6, size: [0.6, 0.8, 0.6], yOffset: 0.4 },
            tv: { name: 'Telewizor OLED', power: 150, hours: 5, color: 0x475569, size: [1.6, 0.9, 0.1], yOffset: 1.2 },
            fridge: { name: 'Lodówka', power: 100, hours: 24, color: 0x10b981, size: [0.8, 1.8, 0.8], yOffset: 0.9 },
            lamp: { name: 'Lampa Stojąca', power: 60, hours: 6, color: 0xfacc15, size: [0.3, 1.5, 0.3], yOffset: 0.75 },
            console: { name: 'Konsola do Gier', power: 200, hours: 4, color: 0xa855f7, size: [0.5, 0.2, 0.4], yOffset: 0.1 }
        };

        this.initThree();
        this.initGLTFLoader();
        this.initEvents();
        this.animate();
    }

    // Inicjalizacja silnika Three.js
    initThree() {
        const container = document.getElementById('canvas-container');
        
        // Scena
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x090d16);

        // Kamera
        this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
        this.camera.position.set(7, 6, 9);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        // Orbit Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.02;

        // Oświetlenie
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(8, 12, 6);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        this.scene.add(dirLight);

        // Tworzenie środowiska (Pokój)
        this.createRoom();

        // Raycasting
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Event listener dla resize
        window.addEventListener('resize', () => this.onWindowResize());
    }

    createRoom() {
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

    initGLTFLoader() {
        this.gltfLoader = new THREE.GLTFLoader();
    }

    // Dodawanie urządzeń podstawowych (Box Geometry)
    addDevice(type) {
        const tmpl = this.deviceTemplates[type];
        if (!tmpl) return;

        const id = Date.now();
        const geo = new THREE.BoxGeometry(...tmpl.size);
        const mat = new THREE.MeshStandardMaterial({ 
            color: tmpl.color, 
            roughness: 0.3,
            metalness: 0.2,
            emissive: tmpl.color,
            emissiveIntensity: 0.2
        });
        
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const posX = (Math.random() - 0.5) * 4;
        const posZ = (Math.random() - 0.5) * 4;
        mesh.position.set(posX, tmpl.yOffset, posZ);
        mesh.userData = { id: id };

        this.scene.add(mesh);

        this.registerDevice(id, tmpl.name, tmpl.power, tmpl.hours, mesh, tmpl.color, 'primitive');
    }

    // Ładowanie własnych plików GLTF/GLB
    loadCustomModel(file) {
        const url = URL.createObjectURL(file);
        
        this.gltfLoader.load(url, (gltf) => {
            const model = gltf.scene;
            const id = Date.now();

            // Obliczenie Bounding Boxa, aby idealnie usadowić obiekt na podłodze
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            // Wyśrodkowanie geometrii
            model.position.x = -center.x;
            model.position.y = -box.min.y;
            model.position.z = -center.z;

            const wrapper = new THREE.Group();
            wrapper.add(model);

            // Cienie dla wszystkich elementów składowych modelu
            model.traverse((node) => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }
            });

            const posX = (Math.random() - 0.5) * 3;
            const posZ = (Math.random() - 0.5) * 3;
            wrapper.position.set(posX, 0, posZ);
            wrapper.userData = { id: id };

            this.scene.add(wrapper);

            const fileName = file.name.replace(/\.[^/.]+$/, "");
            this.registerDevice(id, `Model: ${fileName}`, 150, 5, wrapper, 0x6366f1, 'gltf');
            
            URL.revokeObjectURL(url);
        }, undefined, (error) => {
            console.error('Błąd podczas ładowania modelu GLTF:', error);
            alert('Wystąpił błąd podczas ładowania modelu 3D.');
        });
    }

    registerDevice(id, name, power, hours, mesh, baseColor, type) {
        const deviceData = {
            id: id,
            name: name,
            power: power,
            hours: hours,
            enabled: true,
            mesh: mesh,
            baseColor: baseColor,
            type: type
        };

        this.devices.push(deviceData);
        this.selectDevice(id);
        this.renderUI();
    }

    removeDevice(id) {
        const index = this.devices.findIndex(d => d.id === id);
        if (index !== -1) {
            this.scene.remove(this.devices[index].mesh);
            this.devices.splice(index, 1);
            if (this.selectedDeviceId === id) {
                this.selectedDeviceId = null;
            }
            this.renderUI();
        }
    }

    toggleDevice(id) {
        const dev = this.devices.find(d => d.id === id);
        if (dev) {
            dev.enabled = !dev.enabled;
            
            // Efekt włączenia/wyłączenia wizualnego
            dev.mesh.traverse((node) => {
                if (node.isMesh && node.material) {
                    node.material.transparent = !dev.enabled;
                    node.material.opacity = dev.enabled ? 1.0 : 0.4;
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

    selectDevice(id) {
        this.selectedDeviceId = id;
        
        // Podświetlenie wybranego obiektu
        this.devices.forEach(d => {
            const isSelected = d.id === id;
            d.mesh.traverse((node) => {
                if (node.isMesh && node.material && node.material.emissive) {
                    if (isSelected) {
                        node.material.emissive.setHex(0x6366f1);
                        node.material.emissiveIntensity = 0.4;
                    } else {
                        node.material.emissive.setHex(d.baseColor || 0x000000);
                        node.material.emissiveIntensity = d.enabled ? 0.1 : 0.0;
                    }
                }
            });
        });

        this.renderTransformCard();
        this.renderUIListOnly();
    }

    initEvents() {
        const container = document.getElementById('canvas-container');
        
        // Raycaster na kliknięcie
        container.addEventListener('pointerdown', (e) => {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            this.raycaster.setFromCamera(this.mouse, this.camera);
            
            const interactiveObjects = [];
            this.devices.forEach(d => {
                d.mesh.traverse((child) => {
                    if (child.isMesh) interactiveObjects.push(child);
                });
            });

            const intersects = this.raycaster.intersectObjects(interactiveObjects);

            if (intersects.length > 0) {
                let obj = intersects[0].object;
                while (obj.parent && !obj.userData.id) {
                    obj = obj.parent;
                }
                if (obj.userData.id) {
                    this.selectDevice(obj.userData.id);
                }
            }
        });

        // Obsługa pliku GLTF (Input oraz Drag & Drop)
        const gltfInput = document.getElementById('gltf-input');
        const dropZone = document.getElementById('drop-zone');

        dropZone.addEventListener('click', () => gltfInput.click());
        
        gltfInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadCustomModel(e.target.files[0]);
            }
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('border-indigo-500');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('border-indigo-500');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('border-indigo-500');
            if (e.dataTransfer.files.length > 0) {
                this.loadCustomModel(e.dataTransfer.files[0]);
            }
        });

        // Stawka PLN/kWh
        document.getElementById('energy-rate').addEventListener('input', (e) => {
            this.energyRate = parseFloat(e.target.value) || 0;
            this.calculateTotals();
        });

        // Kontrolki transformacji
        document.getElementById('input-power').addEventListener('input', (e) => {
            const dev = this.getSelectedDevice();
            if (dev) {
                dev.power = parseFloat(e.target.value) || 0;
                document.getElementById('val-power').innerText = `${dev.power} W`;
                this.renderUI();
            }
        });

        document.getElementById('input-pos-x').addEventListener('input', (e) => {
            const dev = this.getSelectedDevice();
            if (dev) {
                dev.mesh.position.x = parseFloat(e.target.value);
                document.getElementById('val-pos-x').innerText = e.target.value;
            }
        });

        document.getElementById('input-pos-z').addEventListener('input', (e) => {
            const dev = this.getSelectedDevice();
            if (dev) {
                dev.mesh.position.z = parseFloat(e.target.value);
                document.getElementById('val-pos-z').innerText = e.target.value;
            }
        });

        document.getElementById('input-rot-y').addEventListener('input', (e) => {
            const dev = this.getSelectedDevice();
            if (dev) {
                const deg = parseFloat(e.target.value);
                dev.mesh.rotation.y = (deg * Math.PI) / 180;
                document.getElementById('val-rot-y').innerText = `${deg}°`;
            }
        });

        document.getElementById('input-scale').addEventListener('input', (e) => {
            const dev = this.getSelectedDevice();
            if (dev) {
                const scale = parseFloat(e.target.value);
                dev.mesh.scale.set(scale, scale, scale);
                document.getElementById('val-scale').innerText = `${scale}x`;
            }
        });
    }

    getSelectedDevice() {
        return this.devices.find(d => d.id === this.selectedDeviceId);
    }

    renderTransformCard() {
        const card = document.getElementById('transform-card');
        const dev = this.getSelectedDevice();

        if (!dev) {
            card.classList.add('hidden');
            return;
        }

        card.classList.remove('hidden');
        document.getElementById('selected-device-name').innerText = dev.name;
        
        document.getElementById('input-power').value = dev.power;
        document.getElementById('val-power').innerText = `${dev.power} W`;

        const posX = dev.mesh.position.x.toFixed(2);
        const posZ = dev.mesh.position.z.toFixed(2);
        const rotY = Math.round((dev.mesh.rotation.y * 180) / Math.PI) % 360;
        const scale = dev.mesh.scale.x.toFixed(2);

        document.getElementById('input-pos-x').value = posX;
        document.getElementById('val-pos-x').innerText = posX;

        document.getElementById('input-pos-z').value = posZ;
        document.getElementById('val-pos-z').innerText = posZ;

        document.getElementById('input-rot-y').value = rotY;
        document.getElementById('val-rot-y').innerText = `${rotY}°`;

        document.getElementById('input-scale').value = scale;
        document.getElementById('val-scale').innerText = `${scale}x`;
    }

    renderUI() {
        this.renderUIListOnly();
        this.calculateTotals();
        lucide.createIcons();
    }

    renderUIListOnly() {
        const listEl = document.getElementById('devices-list');
        
        if (this.devices.length === 0) {
            listEl.innerHTML = `<p class="text-xs text-slate-500 text-center py-6">Brak obiektów w pokoju. Dodaj urządzenie z listy lub wgraj własny plik 3D.</p>`;
            return;
        }

        listEl.innerHTML = this.devices.map(dev => {
            const dailyKwh = dev.enabled ? ((dev.power * dev.hours) / 1000).toFixed(2) : '0.00';
            const dailyCost = (dailyKwh * this.energyRate).toFixed(2);
            const isSelected = dev.id === this.selectedDeviceId;

            return `
                <div class="p-3 rounded-xl bg-slate-900/90 border ${isSelected ? 'border-indigo-500 ring-1 ring-indigo-500/50' : 'border-slate-800'} transition-all flex flex-col gap-2">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2 cursor-pointer" onclick="app.selectDevice(${dev.id})">
                            <span class="font-bold text-xs text-slate-200">${dev.name}</span>
                            <span class="text-[10px] text-slate-400 font-mono">(${dev.power}W)</span>
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
                        <label class="text-[10px] text-slate-400 w-16">Czas: ${dev.hours}h/d</label>
                        <input type="range" min="0" max="24" step="0.5" value="${dev.hours}" 
                            oninput="app.updateHours(${dev.id}, this.value)" 
                            class="slider-custom h-1">
                    </div>

                    <div class="flex justify-between items-center text-[11px] pt-1 border-t border-slate-800/80 font-mono">
                        <span class="text-slate-400">${dailyKwh} kWh/dzień</span>
                        <span class="text-emerald-400 font-bold">${dailyCost} PLN</span>
                    </div>
                </div>
            `;
        }).join('');
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

// Inicjalizacja Aplikacji po załadowaniu struktury DOM
let app;
window.addEventListener('DOMContentLoaded', () => {
    app = new EnergySimulator();
});