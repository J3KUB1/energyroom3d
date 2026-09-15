/**
 * 3D Energy Simulator Enterprise - Version 1.3
 * Built-in Models & Custom Models Engine
 *
 * Nowości w v1.3:
 *  - Autozapis stanu sceny do localStorage (wraz z importowanymi plikami .gltf/.glb poniżej limitu rozmiaru)
 *  - Edytowalna moc (W) urządzenia po dodaniu do sceny
 *  - Zwalnianie pamięci GPU (dispose geometrii/materiałów) przy usuwaniu urządzeń
 *  - Walidacja pliku custom (rozszerzenie + rozmiar) przed próbą parsowania
 *  - Rozkład kosztu dobowego jako wykres kołowy (canvas, bez zewnętrznych bibliotek)
 *  - Symulacja "co jeśli" zmiany taryfy energetycznej
 *  - Synchronizacja zaznaczenia: klik na obiekt 3D <-> podświetlenie na liście (i odwrotnie)
 *  - Etykiety 3D nad urządzeniami (nazwa + moc)
 *  - Potwierdzenie przed usunięciem urządzenia (modal zamiast natychmiastowego usunięcia)
 *  - Import przez przeciągnięcie pliku (drag & drop) na scenę
 *  - Bezpieczniejsze, unikalne ID urządzeń (crypto.randomUUID z fallbackiem)
 */

const STORAGE_KEY = 'papaj_energy_simulator_v13_state';
const MAX_PERSIST_FILE_SIZE = 2 * 1024 * 1024; // 2MB - powyżej tego custom model nie jest zapisywany do localStorage
const MAX_UPLOAD_FILE_SIZE = 50 * 1024 * 1024; // 50MB - twardy limit importu pliku

/* ---------------------------------------------------------- */
/* Funkcje pomocnicze (globalne, bezstanowe)                   */
/* ---------------------------------------------------------- */

function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function disposeMaterial(material) {
    Object.keys(material).forEach((key) => {
        const value = material[key];
        if (value && typeof value.dispose === 'function') {
            value.dispose();
        }
    });
    material.dispose();
}

function disposeObject3D(object) {
    object.traverse((node) => {
        if (node.isMesh) {
            if (node.geometry) node.geometry.dispose();
            if (Array.isArray(node.material)) {
                node.material.forEach(disposeMaterial);
            } else if (node.material) {
                disposeMaterial(node.material);
            }
        }
        if (node.isSprite && node.material) {
            if (node.material.map) node.material.map.dispose();
            node.material.dispose();
        }
    });
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/* ---------------------------------------------------------- */
/* Główna klasa aplikacji                                       */
/* ---------------------------------------------------------- */

class EnergySimulatorv13 {
    constructor() {
        this.devices = [];
        this.energyRate = 1.00;
        this.tariffDelta = 0;
        this.selectedFile = null;
        this.selectedDeviceId = null;
        this._saveTimer = null;
        this._indicatorTimer = null;
        this._highlightHelper = null;

        this.initThree();
        this.initGLTF();
        this.initEvents();
        this.initDragDrop();
        this.initConfirmModal();

        const restored = this.loadState();
        if (!restored) {
            this.loadDefaultPresets();
        }

        this.animate();
    }

    /* ------------------------- SCENA 3D ------------------------- */

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

        // Raycasting do zaznaczania obiektów kliknięciem
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this._downX = 0;
        this._downY = 0;

        this.renderer.domElement.addEventListener('pointerdown', (e) => {
            this._downX = e.clientX;
            this._downY = e.clientY;
        });
        this.renderer.domElement.addEventListener('pointerup', (e) => {
            const dx = e.clientX - this._downX;
            const dy = e.clientY - this._downY;
            if (Math.sqrt(dx * dx + dy * dy) < 5) {
                this.onCanvasClick(e);
            }
        });

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

    /* Wygeneruj proceduralnie domyślne obiekty 3D */
    createProceduralModel(type) {
        const group = new THREE.Group();

        if (type === 'server') {
            const bodyGeo = new THREE.BoxGeometry(0.8, 1.8, 0.8);
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 0.9;
            body.castShadow = true;
            group.add(body);

            // Diody statusu
            for (let i = 0; i < 6; i++) {
                const ledGeo = new THREE.BoxGeometry(0.6, 0.05, 0.02);
                const ledMat = new THREE.MeshStandardMaterial({
                    color: i % 2 === 0 ? 0x10b981 : 0x6366f1,
                    emissive: i % 2 === 0 ? 0x10b981 : 0x6366f1,
                    emissiveIntensity: 0.8
                });
                const led = new THREE.Mesh(ledGeo, ledMat);
                led.position.set(0, 0.3 + (i * 0.22), 0.41);
                group.add(led);
            }
        }
        else if (type === 'workstation') {
            // Biurko
            const deskGeo = new THREE.BoxGeometry(1.6, 0.05, 0.8);
            const deskMat = new THREE.MeshStandardMaterial({ color: 0x334155 });
            const desk = new THREE.Mesh(deskGeo, deskMat);
            desk.position.y = 0.75;
            desk.castShadow = true;
            group.add(desk);

            // Nogi
            const legGeo = new THREE.BoxGeometry(0.05, 0.75, 0.7);
            const legMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
            const legLeft = new THREE.Mesh(legGeo, legMat);
            legLeft.position.set(-0.7, 0.375, 0);
            const legRight = legLeft.clone();
            legRight.position.x = 0.7;
            group.add(legLeft, legRight);

            // Monitor
            const monGeo = new THREE.BoxGeometry(0.8, 0.45, 0.04);
            const monMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3 });
            const mon = new THREE.Mesh(monGeo, monMat);
            mon.position.set(0, 1.1, -0.1);
            mon.castShadow = true;
            group.add(mon);

            // Ekran
            const screenGeo = new THREE.PlaneGeometry(0.76, 0.41);
            const screenMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
            const screen = new THREE.Mesh(screenGeo, screenMat);
            screen.position.set(0, 1.1, -0.078);
            group.add(screen);
        }
        else if (type === 'heatpump') {
            const bodyGeo = new THREE.BoxGeometry(1.2, 1.4, 0.5);
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 0.7;
            body.castShadow = true;
            group.add(body);

            // Wentylator (pierścień)
            const fanGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.05, 32);
            const fanMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
            const fan = new THREE.Mesh(fanGeo, fanMat);
            fan.rotation.x = Math.PI / 2;
            fan.position.set(0, 0.7, 0.24);
            group.add(fan);
        }
        else if (type === 'lighting') {
            const standGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.8);
            const standMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8 });
            const stand = new THREE.Mesh(standGeo, standMat);
            stand.position.y = 0.9;
            group.add(stand);

            const lampGeo = new THREE.CylinderGeometry(0.3, 0.1, 0.3, 16);
            const lampMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.6 });
            const lamp = new THREE.Mesh(lampGeo, lampMat);
            lamp.position.y = 1.8;
            group.add(lamp);
        }

        return group;
    }

    /* ------------------------- ETYKIETY 3D ------------------------- */

    createLabelSprite(text) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const fontSize = 40;
        ctx.font = `bold ${fontSize}px sans-serif`;
        const padding = 22;
        const textWidth = ctx.measureText(text).width;
        canvas.width = Math.ceil(textWidth + padding * 2);
        canvas.height = fontSize + padding;

        // Tło z zaokrąglonymi rogami
        ctx.font = `bold ${fontSize}px sans-serif`;
        this.roundRectPath(ctx, 1, 1, canvas.width - 2, canvas.height - 2, 16);
        ctx.fillStyle = 'rgba(8, 13, 26, 0.85)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.85)';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = '#e2e8f0';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
        const sprite = new THREE.Sprite(material);
        const aspect = canvas.width / canvas.height;
        const spriteHeight = 0.4;
        sprite.scale.set(spriteHeight * aspect, spriteHeight, 1);
        sprite.renderOrder = 999;
        return sprite;
    }

    roundRectPath(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    attachLabel(device) {
        const text = `${device.name} · ${device.power}W`;
        const sprite = this.createLabelSprite(text);
        const box = new THREE.Box3().setFromObject(device.meshGroup);
        const localHeight = box.max.y - device.meshGroup.position.y;
        sprite.position.set(0, Math.max(localHeight, 0.3) + 0.35, 0);
        device.meshGroup.add(sprite);
        device.label = sprite;
    }

    updateLabel(device) {
        if (device.label) {
            device.meshGroup.remove(device.label);
            if (device.label.material.map) device.label.material.map.dispose();
            device.label.material.dispose();
            device.label = null;
        }
        this.attachLabel(device);
    }

    /* ------------------------- ZAZNACZANIE OBIEKTÓW ------------------------- */

    onCanvasClick(event) {
        const container = document.getElementById('canvas-container');
        const rect = container.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const meshGroups = this.devices.map((d) => d.meshGroup);
        const intersects = this.raycaster.intersectObjects(meshGroups, true);

        if (intersects.length > 0) {
            const hitObject = intersects[0].object;
            const dev = this.devices.find((d) => {
                let found = false;
                d.meshGroup.traverse((n) => { if (n === hitObject) found = true; });
                return found;
            });
            this.selectDevice(dev ? dev.id : null, true);
        } else {
            this.selectDevice(null);
        }
    }

    selectDevice(id, scrollIntoView) {
        this.selectedDeviceId = id;

        if (this._highlightHelper) {
            this.scene.remove(this._highlightHelper);
            this._highlightHelper.geometry.dispose();
            this._highlightHelper.material.dispose();
            this._highlightHelper = null;
        }

        document.querySelectorAll('.device-card').forEach((el) => {
            el.classList.toggle('selected', el.dataset.id === String(id));
        });

        const dev = this.devices.find((d) => d.id === id);
        if (dev) {
            const helper = new THREE.BoxHelper(dev.meshGroup, 0x6366f1);
            this.scene.add(helper);
            this._highlightHelper = helper;

            if (scrollIntoView) {
                const el = document.querySelector(`.device-card[data-id="${id}"]`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    handleCardClick(event, id) {
        this.selectDevice(id, false);
    }

    /* ------------------------- ZARZĄDZANIE URZĄDZENIAMI ------------------------- */

    loadDefaultPresets() {
        this.addPresetDevice('server', -2, -1.5);
        this.addPresetDevice('workstation', 1.5, -1);
    }

    addPresetDevice(type, overrideX, overrideZ) {
        const presets = {
            server: { name: 'Serwer Rack Enterprise', power: 600, hours: 24 },
            workstation: { name: 'Stacja AI / Workstation', power: 350, hours: 10 },
            heatpump: { name: 'Pompa Ciepła Industrial', power: 2000, hours: 8 },
            lighting: { name: 'Panel Oświetlenia LED', power: 80, hours: 12 }
        };

        const config = presets[type];
        if (!config) return;

        const meshGroup = this.createProceduralModel(type);
        const id = generateId();

        const posX = overrideX !== undefined ? overrideX : (Math.random() - 0.5) * 4;
        const posZ = overrideZ !== undefined ? overrideZ : (Math.random() - 0.5) * 4;
        meshGroup.position.set(posX, 0, posZ);

        this.scene.add(meshGroup);
        this.registerDevice({
            id,
            name: config.name,
            power: config.power,
            hours: config.hours,
            enabled: true,
            meshGroup,
            fileName: 'Procedural Built-in',
            type: 'preset',
            presetType: type
        });
    }

    validateFile(file) {
        const validExt = /\.(gltf|glb)$/i.test(file.name);
        if (!validExt) {
            alert('Nieprawidłowy format pliku. Akceptowane są tylko pliki .gltf i .glb.');
            return false;
        }
        if (file.size > MAX_UPLOAD_FILE_SIZE) {
            alert(`Plik jest zbyt duży (limit ${MAX_UPLOAD_FILE_SIZE / (1024 * 1024)} MB).`);
            return false;
        }
        return true;
    }

    acceptFile(file) {
        this.selectedFile = file;
        const cleanName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        document.getElementById('custom-name').value = cleanName;
        document.getElementById('file-details').classList.remove('hidden');
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (!this.validateFile(file)) {
            event.target.value = '';
            return;
        }
        this.acceptFile(file);
    }

    prepareGltfModel(gltf) {
        const model = gltf.scene;

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

        return wrapperGroup;
    }

    confirmAddCustomModel() {
        if (!this.selectedFile) return;

        const name = document.getElementById('custom-name').value || this.selectedFile.name;
        const power = parseFloat(document.getElementById('custom-power').value) || 100;
        const hours = parseFloat(document.getElementById('custom-hours').value) || 8;
        const file = this.selectedFile;

        this.showToast(`Parsowanie pliku: ${file.name}...`);

        const reader = new FileReader();
        reader.onload = (e) => {
            const arrayBuffer = e.target.result;

            this.gltfLoader.parse(arrayBuffer, '', (gltf) => {
                const wrapperGroup = this.prepareGltfModel(gltf);
                const id = generateId();

                const posX = (Math.random() - 0.5) * 4;
                const posZ = (Math.random() - 0.5) * 4;
                wrapperGroup.position.x += posX;
                wrapperGroup.position.z += posZ;

                this.scene.add(wrapperGroup);

                let fileDataUrl = null;
                if (file.size <= MAX_PERSIST_FILE_SIZE) {
                    try {
                        fileDataUrl = arrayBufferToBase64(arrayBuffer);
                    } catch (err) {
                        console.warn('Nie udało się zakodować pliku do zapisu:', err);
                    }
                }

                this.registerDevice({
                    id, name, power, hours,
                    enabled: true,
                    meshGroup: wrapperGroup,
                    fileName: file.name,
                    type: 'custom',
                    fileDataUrl
                });

                this.hideToast();

                // Reset formularza
                document.getElementById('file-details').classList.add('hidden');
                document.getElementById('file-input').value = '';
                this.selectedFile = null;
            }, (error) => {
                console.error('Błąd ładowania pliku GLTF:', error);
                alert('Wystąpił błąd podczas parsowania pliku 3D. Upewnij się, że plik to poprawny model .gltf/.glb.');
                this.hideToast();
            });
        };

        reader.readAsArrayBuffer(file);
    }

    registerDevice(data) {
        const device = {
            id: data.id,
            name: data.name,
            power: data.power,
            hours: data.hours,
            enabled: data.enabled !== undefined ? data.enabled : true,
            meshGroup: data.meshGroup,
            fileName: data.fileName,
            type: data.type || 'preset',
            presetType: data.presetType || null,
            fileDataUrl: data.fileDataUrl || null,
            label: null
        };

        this.attachLabel(device);
        if (!device.enabled) {
            this.applyEnabledVisual(device);
        }

        this.devices.push(device);
        this.renderUI();
        this.scheduleSave();
        return device;
    }

    applyEnabledVisual(device) {
        device.meshGroup.traverse((node) => {
            if (node.isMesh && node.material) {
                const mats = Array.isArray(node.material) ? node.material : [node.material];
                mats.forEach((m) => {
                    m.transparent = !device.enabled;
                    m.opacity = device.enabled ? 1.0 : 0.3;
                });
            }
        });
    }

    requestRemoveDevice(id) {
        const dev = this.devices.find((d) => d.id === id);
        if (!dev) return;
        this.showConfirmModal(`Czy na pewno chcesz usunąć „${dev.name}” ze sceny? Tej operacji nie można cofnąć.`, () => {
            this.removeDevice(id);
        });
    }

    removeDevice(id) {
        const index = this.devices.findIndex((d) => d.id === id);
        if (index !== -1) {
            const dev = this.devices[index];
            if (this.selectedDeviceId === id) this.selectDevice(null);
            disposeObject3D(dev.meshGroup);
            this.scene.remove(dev.meshGroup);
            this.devices.splice(index, 1);
            this.renderUI();
            this.scheduleSave();
        }
    }

    toggleDevice(id) {
        const dev = this.devices.find((d) => d.id === id);
        if (dev) {
            dev.enabled = !dev.enabled;
            this.applyEnabledVisual(dev);
            this.renderUI();
            this.scheduleSave();
        }
    }

    updateHours(id, hours) {
        const dev = this.devices.find((d) => d.id === id);
        if (dev) {
            dev.hours = parseFloat(hours);
            this.renderUI();
            this.scheduleSave();
        }
    }

    updatePower(id, power) {
        const dev = this.devices.find((d) => d.id === id);
        if (dev) {
            dev.power = Math.max(0, parseFloat(power) || 0);
            this.updateLabel(dev);
            this.renderUI();
            this.scheduleSave();
        }
    }

    /* ------------------------- EVENTY / TARYFA ------------------------- */

    initEvents() {
        document.getElementById('energy-rate').addEventListener('input', (e) => {
            this.energyRate = parseFloat(e.target.value) || 0;
            this.calculateTotals();
            this.renderCostBreakdown();
            this.scheduleSave();
        });

        const tariffSlider = document.getElementById('tariff-delta');
        tariffSlider.addEventListener('input', (e) => {
            this.tariffDelta = parseFloat(e.target.value) || 0;
            this.updateTariffForecast();
        });

        this.updateTariffForecast();
    }

    updateTariffForecast() {
        const label = document.getElementById('tariff-delta-label');
        const forecastEl = document.getElementById('tariff-forecast');
        const sign = this.tariffDelta > 0 ? '+' : '';
        label.textContent = `${sign}${this.tariffDelta}%`;
        label.className = `text-[10px] font-mono font-bold ${
            this.tariffDelta > 0 ? 'text-rose-400' : this.tariffDelta < 0 ? 'text-emerald-400' : 'text-slate-500'
        }`;

        let totalKwh = 0;
        this.devices.forEach((d) => { if (d.enabled) totalKwh += (d.power * d.hours) / 1000; });

        if (totalKwh === 0) {
            forecastEl.textContent = 'Dodaj urządzenia, aby zobaczyć prognozę.';
            return;
        }

        const adjustedRate = this.energyRate * (1 + this.tariffDelta / 100);
        const yearlyBase = totalKwh * this.energyRate * 365;
        const yearlyAdjusted = totalKwh * adjustedRate * 365;
        const diff = yearlyAdjusted - yearlyBase;

        if (this.tariffDelta === 0) {
            forecastEl.textContent = `Prognoza roczna bez zmian: ${yearlyBase.toFixed(2)} PLN`;
        } else {
            const diffSign = diff > 0 ? '+' : '';
            forecastEl.textContent = `Prognoza roczna: ${yearlyAdjusted.toFixed(2)} PLN (${diffSign}${diff.toFixed(2)} PLN)`;
        }
    }

    /* ------------------------- DRAG & DROP ------------------------- */

    initDragDrop() {
        const container = document.getElementById('canvas-container');
        const overlay = document.getElementById('dropzone-overlay');
        let dragCounter = 0;

        container.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter++;
            overlay.classList.add('drag-active');
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        container.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                overlay.classList.remove('drag-active');
            }
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter = 0;
            overlay.classList.remove('drag-active');

            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            if (!file) return;
            if (!this.validateFile(file)) return;

            this.acceptFile(file);
            document.getElementById('file-details').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    /* ------------------------- MODAL POTWIERDZENIA ------------------------- */

    initConfirmModal() {
        this._confirmCallback = null;

        document.getElementById('confirm-modal-cancel').addEventListener('click', () => this.hideConfirmModal());
        document.getElementById('confirm-modal-ok').addEventListener('click', () => {
            const cb = this._confirmCallback;
            this.hideConfirmModal();
            if (cb) cb();
        });
        document.getElementById('confirm-modal').addEventListener('click', (e) => {
            if (e.target.id === 'confirm-modal') this.hideConfirmModal();
        });
    }

    showConfirmModal(text, onConfirm) {
        document.getElementById('confirm-modal-text').textContent = text;
        this._confirmCallback = onConfirm;
        document.getElementById('confirm-modal').classList.add('visible');
    }

    hideConfirmModal() {
        document.getElementById('confirm-modal').classList.remove('visible');
        this._confirmCallback = null;
    }

    /* ------------------------- AUTOZAPIS (localStorage) ------------------------- */

    scheduleSave() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.saveState(), 400);
    }

    saveState() {
        try {
            const data = {
                energyRate: this.energyRate,
                devices: this.devices.map((d) => ({
                    id: d.id,
                    name: d.name,
                    power: d.power,
                    hours: d.hours,
                    enabled: d.enabled,
                    type: d.type,
                    presetType: d.presetType,
                    fileName: d.fileName,
                    fileDataUrl: d.fileDataUrl,
                    posX: d.meshGroup.position.x,
                    posZ: d.meshGroup.position.z
                }))
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            this.flashAutosaveIndicator();
        } catch (err) {
            console.warn('Nie udało się zapisać stanu (localStorage pełny lub niedostępny):', err);
        }
    }

    flashAutosaveIndicator() {
        const el = document.getElementById('autosave-indicator');
        el.classList.add('visible');
        clearTimeout(this._indicatorTimer);
        this._indicatorTimer = setTimeout(() => el.classList.remove('visible'), 1500);
    }

    loadState() {
        let raw;
        try {
            raw = localStorage.getItem(STORAGE_KEY);
        } catch (err) {
            return false;
        }
        if (!raw) return false;

        let data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            return false;
        }
        if (!data || !Array.isArray(data.devices)) return false;

        this.energyRate = typeof data.energyRate === 'number' ? data.energyRate : 1.00;
        document.getElementById('energy-rate').value = this.energyRate.toFixed(2);

        data.devices.forEach((saved) => {
            if (saved.type === 'custom' && saved.fileDataUrl) {
                try {
                    const buffer = base64ToArrayBuffer(saved.fileDataUrl);
                    this.gltfLoader.parse(buffer, '', (gltf) => {
                        const wrapperGroup = this.prepareGltfModel(gltf);
                        wrapperGroup.position.x += saved.posX || 0;
                        wrapperGroup.position.z += saved.posZ || 0;
                        this.scene.add(wrapperGroup);

                        this.registerDevice({
                            id: saved.id,
                            name: saved.name,
                            power: saved.power,
                            hours: saved.hours,
                            enabled: saved.enabled,
                            meshGroup: wrapperGroup,
                            fileName: saved.fileName,
                            type: 'custom',
                            fileDataUrl: saved.fileDataUrl
                        });
                    }, (err) => {
                        console.error('Błąd przywracania zapisanego modelu custom:', err);
                    });
                } catch (err) {
                    console.error('Błąd dekodowania zapisanego modelu:', err);
                }
            } else if (saved.type === 'preset' && saved.presetType) {
                const meshGroup = this.createProceduralModel(saved.presetType);
                meshGroup.position.set(saved.posX || 0, 0, saved.posZ || 0);
                this.scene.add(meshGroup);

                this.registerDevice({
                    id: saved.id,
                    name: saved.name,
                    power: saved.power,
                    hours: saved.hours,
                    enabled: saved.enabled,
                    meshGroup,
                    fileName: 'Procedural Built-in',
                    type: 'preset',
                    presetType: saved.presetType
                });
            }
        });

        return true;
    }

    /* ------------------------- UI / RENDEROWANIE ------------------------- */

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
            listEl.innerHTML = `<p class="text-xs text-slate-500 text-center py-6">Brak aktywnych obiektów na scenie.</p>`;
            this.calculateTotals();
            this.renderCostBreakdown();
            return;
        }

        listEl.innerHTML = this.devices.map((dev) => {
            const dailyKwh = dev.enabled ? ((dev.power * dev.hours) / 1000) : 0;
            const dailyCost = dailyKwh * this.energyRate;
            const persistWarning = (dev.type === 'custom' && !dev.fileDataUrl)
                ? `<div class="text-[9px] text-amber-500/80 mt-0.5 flex items-center gap-1"><i data-lucide="alert-triangle" class="w-2.5 h-2.5"></i> Duży plik – model nie zostanie zapisany po odświeżeniu</div>`
                : '';

            return `
                <div class="device-card p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-2 cursor-pointer ${dev.id === this.selectedDeviceId ? 'selected' : ''}"
                     data-id="${dev.id}" onclick="app.handleCardClick(event, '${dev.id}')">
                    <div class="flex items-center justify-between gap-2">
                        <div class="min-w-0">
                            <div class="font-bold text-xs text-slate-200 truncate">${escapeHtml(dev.name)}</div>
                            <div class="text-[9px] text-slate-500 font-mono truncate">Typ: ${escapeHtml(dev.fileName)}</div>
                            ${persistWarning}
                        </div>
                        <div class="flex items-center gap-2 flex-shrink-0">
                            <button onclick="event.stopPropagation(); app.toggleDevice('${dev.id}')" class="px-2 py-0.5 rounded text-[10px] font-bold ${dev.enabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-500 border border-slate-700'}">
                                ${dev.enabled ? 'ON' : 'OFF'}
                            </button>
                            <button onclick="event.stopPropagation(); app.requestRemoveDevice('${dev.id}')" class="text-slate-500 hover:text-rose-400 transition">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>

                    <div class="flex items-center gap-2">
                        <label class="text-[10px] text-slate-400 whitespace-nowrap">Moc:</label>
                        <input type="number" class="power-input" value="${dev.power}" min="0" step="1"
                            onclick="event.stopPropagation()"
                            onchange="app.updatePower('${dev.id}', this.value)">
                        <span class="text-[10px] text-slate-500">W</span>
                    </div>

                    <div class="flex items-center gap-3">
                        <label class="text-[10px] text-slate-400 w-20">Czas: ${dev.hours}h/d</label>
                        <input type="range" min="0" max="24" step="0.5" value="${dev.hours}"
                            onclick="event.stopPropagation()"
                            oninput="app.updateHours('${dev.id}', this.value)"
                            class="slider-custom h-1">
                    </div>

                    <div class="flex justify-between items-center text-[11px] pt-1.5 border-t border-slate-800/80 font-mono">
                        <span class="text-slate-400">${dailyKwh.toFixed(2)} kWh/dzień</span>
                        <span class="text-emerald-400 font-bold">${dailyCost.toFixed(2)} PLN</span>
                    </div>
                </div>
            `;
        }).join('');

        this.calculateTotals();
        this.renderCostBreakdown();
        lucide.createIcons();
    }

    renderCostBreakdown() {
        const card = document.getElementById('breakdown-card');
        const canvas = document.getElementById('cost-chart');
        const legend = document.getElementById('cost-legend');
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const enabledDevices = this.devices.filter((d) => d.enabled && d.power > 0 && d.hours > 0);
        if (enabledDevices.length === 0) {
            card.classList.add('hidden');
            return;
        }
        card.classList.remove('hidden');

        const colors = ['#6366f1', '#10b981', '#f59e0b', '#38bdf8', '#f43f5e', '#a855f7', '#eab308', '#22d3ee'];
        const costs = enabledDevices.map((d) => (d.power * d.hours / 1000) * this.energyRate);
        const total = costs.reduce((a, b) => a + b, 0);

        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const radius = Math.min(cx, cy) - 4;
        let startAngle = -Math.PI / 2;

        legend.innerHTML = '';

        enabledDevices.forEach((dev, i) => {
            const share = total > 0 ? costs[i] / total : 0;
            const angle = share * Math.PI * 2;
            const color = colors[i % colors.length];

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, startAngle, startAngle + angle);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();

            startAngle += angle;

            const row = document.createElement('div');
            row.className = 'flex items-center justify-between gap-2';
            row.innerHTML = `
                <span class="flex items-center gap-1.5 min-w-0">
                    <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${color}"></span>
                    <span class="truncate text-slate-300">${escapeHtml(dev.name)}</span>
                </span>
                <span class="text-slate-500 flex-shrink-0">${(share * 100).toFixed(0)}%</span>
            `;
            legend.appendChild(row);
        });

        // Efekt "donut"
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = '#0f172a';
        ctx.fill();
    }

    calculateTotals() {
        let totalKwh = 0;

        this.devices.forEach((dev) => {
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

        this.updateTariffForecast();
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
    app = new EnergySimulatorv13();
});
