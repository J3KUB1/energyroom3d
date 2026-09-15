/**
 * 3D Energy Simulator Enterprise - Version 1.4
 *
 * Nowości w v1.4 (ponad bazę v1.3):
 *  - Harmonogram godzinowy (siatka 24h) zamiast jednej liczby "h/dobę"
 *  - Moc w trybie standby (spoczynkowa) obok mocy roboczej
 *  - Taryfa dwustrefowa (dzień/noc) z konfigurowalnymi granicami godzin
 *  - Współczynnik sprawności instalacji (straty)
 *  - Podgląd oświetlenia sceny dzień/noc (kosmetyczny, niezależny od kalkulacji)
 *  - Historia zmian z cofaniem/ponawianiem (Ctrl+Z / Ctrl+Shift+Z)
 *  - Scenariusze: zapisywanie/wczytywanie nazwanych wariantów sceny + import/eksport do pliku .json
 *  - Grupowanie urządzeń w zwijane sekcje
 *  - Miniaturowy podgląd modelu 3D przed potwierdzeniem importu
 */

const STORAGE_KEY = 'papaj_energy_simulator_v14_state';
const SCENARIOS_KEY = 'papaj_energy_simulator_v14_scenarios';
const MAX_PERSIST_FILE_SIZE = 2 * 1024 * 1024; // 2MB - powyżej tego custom model nie jest zapisywany do localStorage
const MAX_UPLOAD_FILE_SIZE = 50 * 1024 * 1024; // 50MB - twardy limit importu pliku
const MAX_HISTORY_LENGTH = 50;

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

function numOr(value, fallback) {
    return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

function buildScheduleFromHours(hours) {
    const h = Math.max(0, Math.min(24, Math.round(hours || 0)));
    const arr = new Array(24).fill(false);
    for (let i = 0; i < h; i++) arr[i] = true;
    return arr;
}

function normalizeSchedule(schedule, fallbackHours) {
    if (Array.isArray(schedule) && schedule.length === 24) {
        return schedule.map(Boolean);
    }
    return buildScheduleFromHours(fallbackHours !== undefined ? fallbackHours : 8);
}

function isDayHour(hour, dayStart, nightStart) {
    if (dayStart < nightStart) {
        return hour >= dayStart && hour < nightStart;
    }
    // Przypadek "zawijania" (np. dzień zaczyna się później niż noc) - rzadki, ale obsłużony
    return hour >= dayStart || hour < nightStart;
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

class EnergySimulatorv14 {
    constructor() {
        this.devices = [];

        this.energyRate = 1.00;
        this.energyRateNight = 0.65;
        this.twoZoneTariff = false;
        this.dayStart = 6;
        this.nightStart = 22;
        this.efficiency = 100;
        this.tariffDelta = 0;
        this.previewHour = 12;

        this.selectedFile = null;
        this.selectedDeviceId = null;
        this.collapsedGroups = new Set();

        this._saveTimer = null;
        this._indicatorTimer = null;
        this._highlightHelper = null;
        this._cameraTween = null;
        this._restoring = false;

        this._history = [];
        this._historyIndex = -1;

        this._pendingModel = null;
        this._pendingArrayBuffer = null;
        this._previewActive = false;

        this.initThree();
        this.initGLTF();
        this.initPreviewViewport();
        this.initEvents();
        this.initDragDrop();
        this.initConfirmModal();

        // Wczytaj zapisany stan roboczy lub użyj domyślnego zestawu urządzeń
        let initialData = null;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) initialData = JSON.parse(raw);
        } catch (err) {
            console.warn('Nie udało się odczytać zapisanego stanu:', err);
        }
        if (!initialData || !Array.isArray(initialData.devices)) {
            initialData = this.buildDefaultStateData();
        }
        this.applyState(initialData, { recordHistory: true });

        this.refreshScenarioSelect();
        this.setPreviewHour(this.previewHour);

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

        this._ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(this._ambientLight);

        this._dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        this._dirLight.position.set(8, 12, 6);
        this._dirLight.castShadow = true;
        this._dirLight.shadow.mapSize.width = 2048;
        this._dirLight.shadow.mapSize.height = 2048;
        this.scene.add(this._dirLight);

        this.createRoomEnvironment();

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

        const floorGeo = new THREE.PlaneGeometry(roomSize, roomSize);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        const grid = new THREE.GridHelper(roomSize, 10, 0x6366f1, 0x334155);
        grid.position.y = 0.01;
        this.scene.add(grid);

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

    createProceduralModel(type) {
        const group = new THREE.Group();

        if (type === 'server') {
            const bodyGeo = new THREE.BoxGeometry(0.8, 1.8, 0.8);
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 0.9;
            body.castShadow = true;
            group.add(body);

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
            const deskGeo = new THREE.BoxGeometry(1.6, 0.05, 0.8);
            const deskMat = new THREE.MeshStandardMaterial({ color: 0x334155 });
            const desk = new THREE.Mesh(deskGeo, deskMat);
            desk.position.y = 0.75;
            desk.castShadow = true;
            group.add(desk);

            const legGeo = new THREE.BoxGeometry(0.05, 0.75, 0.7);
            const legMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
            const legLeft = new THREE.Mesh(legGeo, legMat);
            legLeft.position.set(-0.7, 0.375, 0);
            const legRight = legLeft.clone();
            legRight.position.x = 0.7;
            group.add(legLeft, legRight);

            const monGeo = new THREE.BoxGeometry(0.8, 0.45, 0.04);
            const monMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3 });
            const mon = new THREE.Mesh(monGeo, monMat);
            mon.position.set(0, 1.1, -0.1);
            mon.castShadow = true;
            group.add(mon);

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

    /* ------------------------- ZAZNACZANIE / KAMERA ------------------------- */

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

    focusOnDevice(id) {
        const dev = this.devices.find((d) => d.id === id);
        if (!dev) return;

        this.selectDevice(id, false);

        const box = new THREE.Box3().setFromObject(dev.meshGroup);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 1);
        const distance = maxDim * 2.2 + 1.5;
        const dir = new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance);
        const targetCamPos = center.clone().add(dir);

        this._cameraTween = {
            fromPos: this.camera.position.clone(),
            toPos: targetCamPos,
            fromTarget: this.controls.target.clone(),
            toTarget: center.clone(),
            start: performance.now(),
            duration: 700
        };
    }

    /* ------------------------- ZARZĄDZANIE URZĄDZENIAMI ------------------------- */

    buildDefaultStateData() {
        return {
            energyRateDay: 1.00,
            energyRateNight: 0.65,
            twoZoneTariff: false,
            dayStart: 6,
            nightStart: 22,
            efficiency: 100,
            devices: [
                {
                    id: generateId(), name: 'Serwer Rack Enterprise', power: 600, standbyPower: 15,
                    schedule: buildScheduleFromHours(24), group: 'Serwerownia', enabled: true,
                    type: 'preset', presetType: 'server', fileName: 'Procedural Built-in',
                    posX: -2, posZ: -1.5
                },
                {
                    id: generateId(), name: 'Stacja AI / Workstation', power: 350, standbyPower: 8,
                    schedule: buildScheduleFromHours(10), group: 'Biuro', enabled: true,
                    type: 'preset', presetType: 'workstation', fileName: 'Procedural Built-in',
                    posX: 1.5, posZ: -1
                }
            ]
        };
    }

    addPresetDevice(type, overrideX, overrideZ) {
        const presets = {
            server: { name: 'Serwer Rack Enterprise', power: 600, standbyPower: 15, hours: 24, group: 'Serwerownia' },
            workstation: { name: 'Stacja AI / Workstation', power: 350, standbyPower: 8, hours: 10, group: 'Biuro' },
            heatpump: { name: 'Pompa Ciepła Industrial', power: 2000, standbyPower: 5, hours: 8, group: 'Instalacje' },
            lighting: { name: 'Panel Oświetlenia LED', power: 80, standbyPower: 0, hours: 12, group: 'Oświetlenie' }
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
            standbyPower: config.standbyPower,
            schedule: buildScheduleFromHours(config.hours),
            group: config.group,
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
        this.clearPendingModel();

        this.selectedFile = file;
        const cleanName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        document.getElementById('custom-name').value = cleanName;
        document.getElementById('file-details').classList.remove('hidden');

        const wrap = document.getElementById('model-preview-wrap');
        const loading = document.getElementById('model-preview-loading');
        wrap.classList.remove('hidden');
        loading.classList.remove('hidden');
        loading.textContent = 'Ładowanie podglądu...';

        const reader = new FileReader();
        reader.onload = (e) => {
            const arrayBuffer = e.target.result;
            this._pendingArrayBuffer = arrayBuffer;

            this.gltfLoader.parse(arrayBuffer, '', (gltf) => {
                const wrapperGroup = this.prepareGltfModel(gltf);
                this._pendingModel = wrapperGroup;

                this.previewScene.add(wrapperGroup);
                this.fitPreviewCamera(wrapperGroup);
                this._previewActive = true;
                loading.classList.add('hidden');
            }, (error) => {
                console.error('Błąd generowania podglądu:', error);
                loading.textContent = 'Nie udało się wygenerować podglądu (plik może być uszkodzony).';
            });
        };
        reader.onerror = () => {
            loading.textContent = 'Nie udało się odczytać pliku.';
        };
        reader.readAsArrayBuffer(file);
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

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        if (maxDim > 2 || maxDim < 0.2) {
            const scaleFactor = 1.2 / maxDim;
            model.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }

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
        if (!this.selectedFile || !this._pendingModel) {
            alert('Poczekaj na wygenerowanie podglądu modelu (lub wybierz plik ponownie).');
            return;
        }

        const name = document.getElementById('custom-name').value || this.selectedFile.name;
        const power = Math.max(0, parseFloat(document.getElementById('custom-power').value) || 100);
        const hours = parseFloat(document.getElementById('custom-hours').value) || 8;
        const file = this.selectedFile;
        const arrayBuffer = this._pendingArrayBuffer;
        const wrapperGroup = this._pendingModel;

        this.previewScene.remove(wrapperGroup);
        this._pendingModel = null;
        this._previewActive = false;

        const id = generateId();
        const posX = (Math.random() - 0.5) * 4;
        const posZ = (Math.random() - 0.5) * 4;
        wrapperGroup.position.x += posX;
        wrapperGroup.position.z += posZ;

        this.scene.add(wrapperGroup);

        let fileDataUrl = null;
        if (file.size <= MAX_PERSIST_FILE_SIZE && arrayBuffer) {
            try {
                fileDataUrl = arrayBufferToBase64(arrayBuffer);
            } catch (err) {
                console.warn('Nie udało się zakodować pliku do zapisu:', err);
            }
        }

        this.registerDevice({
            id,
            name,
            power,
            standbyPower: Math.round(power * 0.05),
            schedule: buildScheduleFromHours(hours),
            group: 'Bez grupy',
            enabled: true,
            meshGroup: wrapperGroup,
            fileName: file.name,
            type: 'custom',
            fileDataUrl
        });

        this.hideCustomModelForm();
    }

    hideCustomModelForm() {
        document.getElementById('file-details').classList.add('hidden');
        document.getElementById('model-preview-wrap').classList.add('hidden');
        document.getElementById('file-input').value = '';
        this.selectedFile = null;
        this._pendingArrayBuffer = null;
    }

    cancelCustomModel() {
        this.clearPendingModel();
        this.hideCustomModelForm();
    }

    registerDevice(data) {
        const device = {
            id: data.id,
            name: data.name,
            power: data.power,
            standbyPower: data.standbyPower !== undefined ? Math.max(0, data.standbyPower) : 0,
            schedule: normalizeSchedule(data.schedule, data.hours),
            group: (data.group && String(data.group).trim()) || 'Bez grupy',
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
        this.commit();
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
        this.showConfirmModal(`Czy na pewno chcesz usunąć „${dev.name}” ze sceny? Tej operacji nie można cofnąć przyciskiem, ale zostanie zapisana w historii (Ctrl+Z).`, () => {
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
            this.commit();
        }
    }

    toggleDevice(id) {
        const dev = this.devices.find((d) => d.id === id);
        if (dev) {
            dev.enabled = !dev.enabled;
            this.applyEnabledVisual(dev);
            this.renderUI();
            this.commit();
        }
    }

    updatePower(id, power) {
        const dev = this.devices.find((d) => d.id === id);
        if (dev) {
            dev.power = Math.max(0, parseFloat(power) || 0);
            this.updateLabel(dev);
            this.renderUI();
            this.commit();
        }
    }

    updateStandbyPower(id, value) {
        const dev = this.devices.find((d) => d.id === id);
        if (dev) {
            dev.standbyPower = Math.max(0, parseFloat(value) || 0);
            this.renderUI();
            this.commit();
        }
    }

    updateGroup(id, value) {
        const dev = this.devices.find((d) => d.id === id);
        if (dev) {
            dev.group = (value && value.trim()) || 'Bez grupy';
            this.renderUI();
            this.commit();
        }
    }

    toggleScheduleHour(id, hour) {
        const dev = this.devices.find((d) => d.id === id);
        if (!dev) return;
        dev.schedule[hour] = !dev.schedule[hour];
        this.renderUI();
        this.commit();
    }

    applySchedulePreset(id, preset) {
        const dev = this.devices.find((d) => d.id === id);
        if (!dev) return;

        const arr = new Array(24).fill(false);
        if (preset === 'full') {
            arr.fill(true);
        } else if (preset === 'work') {
            for (let h = 8; h < 16; h++) arr[h] = true;
        } else if (preset === 'night') {
            for (let h = 22; h < 24; h++) arr[h] = true;
            for (let h = 0; h < 6; h++) arr[h] = true;
        }
        // preset === 'off' -> zostaje same false

        dev.schedule = arr;
        this.renderUI();
        this.commit();
    }

    /* ------------------------- KOSZTY (HARMONOGRAM + TARYFA) ------------------------- */

    computeDeviceDailyStats(device, rateMultiplier) {
        const multiplier = rateMultiplier !== undefined ? rateMultiplier : 1;
        let kwh = 0;
        let cost = 0;

        if (device.enabled) {
            const effFactor = Math.max(0.01, this.efficiency / 100);
            for (let hour = 0; hour < 24; hour++) {
                const isOn = !!device.schedule[hour];
                const powerW = isOn ? device.power : device.standbyPower;
                const hourKwh = (powerW / 1000) / effFactor;
                const baseRate = this.twoZoneTariff
                    ? (isDayHour(hour, this.dayStart, this.nightStart) ? this.energyRate : this.energyRateNight)
                    : this.energyRate;

                kwh += hourKwh;
                cost += hourKwh * baseRate * multiplier;
            }
        }

        return { kwh, cost };
    }

    /* ------------------------- EVENTY / USTAWIENIA GLOBALNE ------------------------- */

    initEvents() {
        const energyRateInput = document.getElementById('energy-rate');
        energyRateInput.addEventListener('input', (e) => {
            this.energyRate = parseFloat(e.target.value) || 0;
            this.calculateTotals();
            this.renderCostBreakdown();
        });
        energyRateInput.addEventListener('change', () => this.commit());

        document.getElementById('two-zone-toggle').addEventListener('change', (e) => {
            this.twoZoneTariff = e.target.checked;
            document.getElementById('two-zone-fields').classList.toggle('hidden', !this.twoZoneTariff);
            this.calculateTotals();
            this.renderCostBreakdown();
            this.commit();
        });

        const nightRateInput = document.getElementById('energy-rate-night');
        nightRateInput.addEventListener('input', (e) => {
            this.energyRateNight = parseFloat(e.target.value) || 0;
            this.calculateTotals();
            this.renderCostBreakdown();
        });
        nightRateInput.addEventListener('change', () => this.commit());

        const dayStartInput = document.getElementById('day-start');
        dayStartInput.addEventListener('change', (e) => {
            this.dayStart = Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0));
            this.calculateTotals();
            this.renderCostBreakdown();
            this.setPreviewHour(this.previewHour);
            this.commit();
        });

        const nightStartInput = document.getElementById('night-start');
        nightStartInput.addEventListener('change', (e) => {
            this.nightStart = Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0));
            this.calculateTotals();
            this.renderCostBreakdown();
            this.setPreviewHour(this.previewHour);
            this.commit();
        });

        const efficiencyInput = document.getElementById('efficiency');
        efficiencyInput.addEventListener('input', (e) => {
            this.efficiency = parseFloat(e.target.value) || 100;
            document.getElementById('efficiency-label').textContent = `${this.efficiency}%`;
            this.calculateTotals();
            this.renderCostBreakdown();
        });
        efficiencyInput.addEventListener('change', () => this.commit());

        const previewHourSlider = document.getElementById('preview-hour');
        previewHourSlider.addEventListener('input', (e) => {
            this.setPreviewHour(parseInt(e.target.value, 10));
        });

        const tariffSlider = document.getElementById('tariff-delta');
        tariffSlider.addEventListener('input', (e) => {
            this.tariffDelta = parseFloat(e.target.value) || 0;
            this.updateTariffForecast();
        });

        window.addEventListener('keydown', (e) => {
            const tag = (e.target && e.target.tagName) || '';
            const isEditable = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || (e.target && e.target.isContentEditable);
            if (isEditable) return;

            const isCtrl = e.ctrlKey || e.metaKey;
            if (!isCtrl) return;

            const key = e.key.toLowerCase();
            if (key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
            } else if ((key === 'z' && e.shiftKey) || key === 'y') {
                e.preventDefault();
                this.redo();
            }
        });
    }

    syncSettingsInputs() {
        document.getElementById('energy-rate').value = this.energyRate.toFixed(2);
        document.getElementById('energy-rate-night').value = this.energyRateNight.toFixed(2);
        document.getElementById('two-zone-toggle').checked = this.twoZoneTariff;
        document.getElementById('two-zone-fields').classList.toggle('hidden', !this.twoZoneTariff);
        document.getElementById('day-start').value = this.dayStart;
        document.getElementById('night-start').value = this.nightStart;
        document.getElementById('efficiency').value = this.efficiency;
        document.getElementById('efficiency-label').textContent = `${this.efficiency}%`;
    }

    updateTariffForecast() {
        const label = document.getElementById('tariff-delta-label');
        const forecastEl = document.getElementById('tariff-forecast');
        const sign = this.tariffDelta > 0 ? '+' : '';
        label.textContent = `${sign}${this.tariffDelta}%`;
        label.className = `text-[10px] font-mono font-bold ${
            this.tariffDelta > 0 ? 'text-rose-400' : this.tariffDelta < 0 ? 'text-emerald-400' : 'text-slate-500'
        }`;

        const totalKwh = this._lastTotalKwh || 0;
        if (totalKwh === 0) {
            forecastEl.textContent = 'Dodaj urządzenia, aby zobaczyć prognozę.';
            return;
        }

        let adjustedCost = 0;
        this.devices.forEach((dev) => {
            adjustedCost += this.computeDeviceDailyStats(dev, 1 + this.tariffDelta / 100).cost;
        });

        const yearlyBase = (this._lastTotalCost || 0) * 365;
        const yearlyAdjusted = adjustedCost * 365;
        const diff = yearlyAdjusted - yearlyBase;

        if (this.tariffDelta === 0) {
            forecastEl.textContent = `Prognoza roczna bez zmian: ${yearlyBase.toFixed(2)} PLN`;
        } else {
            const diffSign = diff > 0 ? '+' : '';
            forecastEl.textContent = `Prognoza roczna: ${yearlyAdjusted.toFixed(2)} PLN (${diffSign}${diff.toFixed(2)} PLN)`;
        }
    }

    /* ------------------------- PODGLĄD DZIEŃ/NOC (KOSMETYCZNY) ------------------------- */

    setPreviewHour(hour) {
        this.previewHour = hour;
        document.getElementById('preview-hour-label').textContent = `${String(hour).padStart(2, '0')}:00`;
        document.getElementById('preview-hour').value = hour;

        const isDay = isDayHour(hour, this.dayStart, this.nightStart);
        const t = isDay ? 1 : 0.08;

        const dayAmbient = 0.8, nightAmbient = 0.15;
        const dayDirIntensity = 1.0, nightDirIntensity = 0.25;
        const dayBg = new THREE.Color(0x080d1a);
        const nightBg = new THREE.Color(0x02040a);
        const dayDirColor = new THREE.Color(0xffffff);
        const nightDirColor = new THREE.Color(0x3b82f6);

        this._ambientLight.intensity = nightAmbient + (dayAmbient - nightAmbient) * t;
        this._dirLight.intensity = nightDirIntensity + (dayDirIntensity - nightDirIntensity) * t;
        this._dirLight.color.copy(nightDirColor).lerp(dayDirColor, t);
        this.scene.background = nightBg.clone().lerp(dayBg, t);
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

    /* ------------------------- PODGLĄD MODELU (MINI VIEWPORT) ------------------------- */

    initPreviewViewport() {
        const canvas = document.getElementById('model-preview-canvas');
        this.previewScene = new THREE.Scene();
        this.previewScene.background = new THREE.Color(0x020617);
        this.previewCamera = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
        this.previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        const amb = new THREE.AmbientLight(0xffffff, 0.9);
        this.previewScene.add(amb);
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(3, 5, 4);
        this.previewScene.add(dir);
    }

    resizePreviewRenderer() {
        const canvas = document.getElementById('model-preview-canvas');
        const w = canvas.clientWidth || 300;
        const h = canvas.clientHeight || 140;
        this.previewRenderer.setSize(w, h, false);
        this.previewCamera.aspect = w / h;
        this.previewCamera.updateProjectionMatrix();
    }

    fitPreviewCamera(wrapperGroup) {
        this.resizePreviewRenderer();
        const box = new THREE.Box3().setFromObject(wrapperGroup);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 0.3);
        const dist = maxDim * 2.4;
        this.previewCamera.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist * 0.7);
        this.previewCamera.lookAt(center);
    }

    clearPendingModel() {
        if (this._pendingModel) {
            this.previewScene.remove(this._pendingModel);
            disposeObject3D(this._pendingModel);
            this._pendingModel = null;
        }
        this._pendingArrayBuffer = null;
        this._previewActive = false;
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

    /* ------------------------- AUTOZAPIS / HISTORIA / STAN ------------------------- */

    serializeState() {
        return {
            energyRateDay: this.energyRate,
            energyRateNight: this.energyRateNight,
            twoZoneTariff: this.twoZoneTariff,
            dayStart: this.dayStart,
            nightStart: this.nightStart,
            efficiency: this.efficiency,
            devices: this.devices.map((d) => ({
                id: d.id,
                name: d.name,
                power: d.power,
                standbyPower: d.standbyPower,
                schedule: d.schedule.slice(),
                group: d.group,
                enabled: d.enabled,
                type: d.type,
                presetType: d.presetType,
                fileName: d.fileName,
                fileDataUrl: d.fileDataUrl,
                posX: d.meshGroup.position.x,
                posZ: d.meshGroup.position.z
            }))
        };
    }

    commit() {
        if (this._restoring) return;
        this.scheduleSave();
        this.pushHistory();
    }

    scheduleSave() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.saveState(), 300);
    }

    saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.serializeState()));
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

    pushHistory() {
        const snapshot = JSON.stringify(this.serializeState());
        if (this._history.length && this._history[this._historyIndex] === snapshot) {
            return;
        }
        this._history = this._history.slice(0, this._historyIndex + 1);
        this._history.push(snapshot);
        if (this._history.length > MAX_HISTORY_LENGTH) {
            this._history.shift();
        }
        this._historyIndex = this._history.length - 1;
        this.updateHistoryButtons();
    }

    undo() {
        if (this._historyIndex <= 0) return;
        this._historyIndex--;
        const snapshot = JSON.parse(this._history[this._historyIndex]);
        this.applyState(snapshot, { recordHistory: false });
    }

    redo() {
        if (this._historyIndex >= this._history.length - 1) return;
        this._historyIndex++;
        const snapshot = JSON.parse(this._history[this._historyIndex]);
        this.applyState(snapshot, { recordHistory: false });
    }

    updateHistoryButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        undoBtn.disabled = this._historyIndex <= 0;
        redoBtn.disabled = this._historyIndex >= this._history.length - 1;
    }

    clearScene() {
        if (this._highlightHelper) {
            this.scene.remove(this._highlightHelper);
            this._highlightHelper.geometry.dispose();
            this._highlightHelper.material.dispose();
            this._highlightHelper = null;
        }
        this.devices.forEach((d) => {
            disposeObject3D(d.meshGroup);
            this.scene.remove(d.meshGroup);
        });
        this.devices = [];
        this.selectedDeviceId = null;
    }

    applyState(data, opts) {
        const options = opts || {};
        const recordHistory = options.recordHistory !== undefined ? options.recordHistory : true;

        if (!data || !Array.isArray(data.devices)) {
            alert('Nieprawidłowy format danych scenariusza.');
            return false;
        }

        this._restoring = true;
        this.clearScene();

        this.energyRate = numOr(data.energyRateDay !== undefined ? data.energyRateDay : data.energyRate, 1.00);
        this.energyRateNight = numOr(data.energyRateNight, this.energyRate);
        this.twoZoneTariff = !!data.twoZoneTariff;
        this.dayStart = numOr(data.dayStart, 6);
        this.nightStart = numOr(data.nightStart, 22);
        this.efficiency = numOr(data.efficiency, 100);
        this.collapsedGroups = new Set();
        this.syncSettingsInputs();
        this.setPreviewHour(this.previewHour);

        let pending = 0;
        let finished = false;
        const finalize = () => {
            if (pending === 0 && finished) {
                this._restoring = false;
                this.renderUI();
                if (recordHistory) {
                    this.pushHistory();
                } else {
                    this.updateHistoryButtons();
                }
                this.scheduleSave();
            }
        };

        (data.devices || []).forEach((saved) => {
            const schedule = normalizeSchedule(saved.schedule, saved.hours);

            if (saved.type === 'custom' && saved.fileDataUrl) {
                pending++;
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
                            standbyPower: saved.standbyPower,
                            schedule,
                            group: saved.group,
                            enabled: saved.enabled,
                            meshGroup: wrapperGroup,
                            fileName: saved.fileName,
                            type: 'custom',
                            fileDataUrl: saved.fileDataUrl
                        });

                        pending--;
                        finalize();
                    }, (err) => {
                        console.error('Błąd przywracania modelu custom:', err);
                        pending--;
                        finalize();
                    });
                } catch (err) {
                    console.error('Błąd dekodowania zapisanego modelu:', err);
                    pending--;
                }
            } else if (saved.type === 'preset' && saved.presetType) {
                const meshGroup = this.createProceduralModel(saved.presetType);
                meshGroup.position.set(saved.posX || 0, 0, saved.posZ || 0);
                this.scene.add(meshGroup);

                this.registerDevice({
                    id: saved.id,
                    name: saved.name,
                    power: saved.power,
                    standbyPower: saved.standbyPower,
                    schedule,
                    group: saved.group,
                    enabled: saved.enabled,
                    meshGroup,
                    fileName: 'Procedural Built-in',
                    type: 'preset',
                    presetType: saved.presetType
                });
            }
        });

        finished = true;
        finalize();
        return true;
    }

    /* ------------------------- SCENARIUSZE ------------------------- */

    loadScenarioDirectory() {
        try {
            const raw = localStorage.getItem(SCENARIOS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (err) {
            return {};
        }
    }

    saveScenarioDirectory(dir) {
        try {
            localStorage.setItem(SCENARIOS_KEY, JSON.stringify(dir));
        } catch (err) {
            alert('Nie udało się zapisać scenariusza (limit pamięci przeglądarki lub localStorage niedostępny).');
        }
    }

    refreshScenarioSelect() {
        const dir = this.loadScenarioDirectory();
        const select = document.getElementById('scenario-select');
        const current = select.value;
        select.innerHTML = '<option value="">— wybierz scenariusz —</option>' +
            Object.keys(dir).sort((a, b) => a.localeCompare(b)).map((name) =>
                `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
            ).join('');
        if (dir[current]) select.value = current;
    }

    saveAsScenario() {
        const nameInput = document.getElementById('scenario-name');
        const name = nameInput.value.trim();
        if (!name) {
            alert('Podaj nazwę scenariusza.');
            return;
        }
        const dir = this.loadScenarioDirectory();
        dir[name] = this.serializeState();
        this.saveScenarioDirectory(dir);
        this.refreshScenarioSelect();
        document.getElementById('scenario-select').value = name;
        nameInput.value = '';
        this.flashAutosaveIndicator();
    }

    loadSelectedScenario() {
        const select = document.getElementById('scenario-select');
        const name = select.value;
        if (!name) {
            alert('Wybierz scenariusz z listy.');
            return;
        }
        const dir = this.loadScenarioDirectory();
        const data = dir[name];
        if (!data) return;

        this.showConfirmModal(`Wczytać scenariusz „${name}”? Bieżąca scena zostanie zastąpiona (możesz cofnąć przez Ctrl+Z).`, () => {
            this.applyState(data, { recordHistory: true });
        });
    }

    deleteSelectedScenario() {
        const select = document.getElementById('scenario-select');
        const name = select.value;
        if (!name) {
            alert('Wybierz scenariusz z listy.');
            return;
        }
        this.showConfirmModal(`Usunąć zapisany scenariusz „${name}”? Tej operacji nie można cofnąć.`, () => {
            const dir = this.loadScenarioDirectory();
            delete dir[name];
            this.saveScenarioDirectory(dir);
            this.refreshScenarioSelect();
        });
    }

    exportSceneToFile() {
        const data = this.serializeState();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        a.download = `energy-scenario-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    importSceneFromFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            let data;
            try {
                data = JSON.parse(e.target.result);
            } catch (err) {
                alert('Nieprawidłowy plik JSON.');
                event.target.value = '';
                return;
            }
            this.showConfirmModal('Zaimportować scenariusz z pliku? Zastąpi to bieżącą scenę (możesz cofnąć przez Ctrl+Z).', () => {
                this.applyState(data, { recordHistory: true });
            });
            event.target.value = '';
        };
        reader.readAsText(file);
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

    renderScheduleGrid(dev) {
        const cells = dev.schedule.map((on, hour) => `
            <div class="sched-cell ${on ? 'on' : (dev.standbyPower > 0 ? 'standby' : '')}"
                 title="${hour}:00–${(hour + 1) % 24}:00 · ${on ? dev.power : dev.standbyPower}W"
                 onclick="app.toggleScheduleHour('${dev.id}', ${hour})"></div>
        `).join('');

        const onCount = dev.schedule.filter(Boolean).length;

        return `
            <div class="space-y-1">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                    <label class="text-[10px] text-slate-400">Harmonogram — ${onCount}h aktywne / dobę</label>
                    <div class="flex gap-1">
                        <button class="sched-preset-btn" onclick="event.stopPropagation(); app.applySchedulePreset('${dev.id}','full')">24h</button>
                        <button class="sched-preset-btn" onclick="event.stopPropagation(); app.applySchedulePreset('${dev.id}','work')">8–16</button>
                        <button class="sched-preset-btn" onclick="event.stopPropagation(); app.applySchedulePreset('${dev.id}','night')">22–6</button>
                        <button class="sched-preset-btn" onclick="event.stopPropagation(); app.applySchedulePreset('${dev.id}','off')">0h</button>
                    </div>
                </div>
                <div class="grid grid-cols-24 gap-[2px]" onclick="event.stopPropagation()">
                    ${cells}
                </div>
            </div>
        `;
    }

    renderDeviceCard(dev) {
        const stats = this.computeDeviceDailyStats(dev);
        const persistWarning = (dev.type === 'custom' && !dev.fileDataUrl)
            ? `<div class="text-[9px] text-amber-500/80 mt-0.5 flex items-center gap-1"><i data-lucide="alert-triangle" class="w-2.5 h-2.5"></i> Duży plik – model nie zostanie zapisany po odświeżeniu</div>`
            : '';

        return `
            <div class="device-card p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-2.5 cursor-pointer ${dev.id === this.selectedDeviceId ? 'selected' : ''}"
                 data-id="${dev.id}" onclick="app.handleCardClick(event, '${dev.id}')">
                <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0">
                        <div class="font-bold text-xs text-slate-200 truncate">${escapeHtml(dev.name)}</div>
                        <div class="text-[9px] text-slate-500 font-mono truncate">Typ: ${escapeHtml(dev.fileName)}</div>
                        ${persistWarning}
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <button onclick="event.stopPropagation(); app.focusOnDevice('${dev.id}')" title="Wyśrodkuj kamerę" class="text-slate-500 hover:text-indigo-400 transition">
                            <i data-lucide="focus" class="w-4 h-4"></i>
                        </button>
                        <button onclick="event.stopPropagation(); app.toggleDevice('${dev.id}')" class="px-2 py-0.5 rounded text-[10px] font-bold ${dev.enabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-500 border border-slate-700'}">
                            ${dev.enabled ? 'ON' : 'OFF'}
                        </button>
                        <button onclick="event.stopPropagation(); app.requestRemoveDevice('${dev.id}')" class="text-slate-500 hover:text-rose-400 transition">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>

                <div class="flex items-center gap-2 flex-wrap">
                    <label class="text-[10px] text-slate-400 whitespace-nowrap">Moc:</label>
                    <input type="number" class="power-input" value="${dev.power}" min="0" step="1"
                        onclick="event.stopPropagation()"
                        onchange="app.updatePower('${dev.id}', this.value)">
                    <span class="text-[10px] text-slate-500">W</span>

                    <label class="text-[10px] text-slate-400 whitespace-nowrap ml-1">Standby:</label>
                    <input type="number" class="power-input" value="${dev.standbyPower}" min="0" step="1"
                        onclick="event.stopPropagation()"
                        onchange="app.updateStandbyPower('${dev.id}', this.value)">
                    <span class="text-[10px] text-slate-500">W</span>
                </div>

                <div class="flex items-center gap-2">
                    <label class="text-[10px] text-slate-400 whitespace-nowrap">Grupa:</label>
                    <input type="text" value="${escapeHtml(dev.group)}" placeholder="np. Piętro 1"
                        class="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[10px] text-white focus:outline-none focus:border-indigo-500 min-w-0"
                        onclick="event.stopPropagation()"
                        onchange="app.updateGroup('${dev.id}', this.value)">
                </div>

                ${this.renderScheduleGrid(dev)}

                <div class="flex justify-between items-center text-[11px] pt-1.5 border-t border-slate-800/80 font-mono">
                    <span class="text-slate-400">${stats.kwh.toFixed(2)} kWh/dzień</span>
                    <span class="text-emerald-400 font-bold">${stats.cost.toFixed(2)} PLN</span>
                </div>
            </div>
        `;
    }

    renderUI() {
        const listEl = document.getElementById('devices-list');

        if (this.devices.length === 0) {
            listEl.innerHTML = `<p class="text-xs text-slate-500 text-center py-6">Brak aktywnych obiektów na scenie.</p>`;
            this.calculateTotals();
            this.renderCostBreakdown();
            return;
        }

        const groups = new Map();
        this.devices.forEach((dev) => {
            const key = dev.group || 'Bez grupy';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(dev);
        });

        let html = '';
        groups.forEach((devicesInGroup, groupName) => {
            const isOpen = !this.collapsedGroups.has(groupName);
            const groupCost = devicesInGroup.reduce((sum, d) => sum + this.computeDeviceDailyStats(d).cost, 0);

            html += `
                <details class="group-block" ${isOpen ? 'open' : ''} data-group="${escapeHtml(groupName)}">
                    <summary class="flex items-center justify-between cursor-pointer py-1.5 px-0.5 select-none">
                        <span class="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 uppercase tracking-wide min-w-0">
                            <i data-lucide="chevron-right" class="w-3.5 h-3.5 group-chevron flex-shrink-0"></i>
                            <span class="truncate">${escapeHtml(groupName)}</span>
                            <span class="text-slate-600 font-normal normal-case flex-shrink-0">(${devicesInGroup.length})</span>
                        </span>
                        <span class="text-[10px] font-mono text-emerald-400 flex-shrink-0">${groupCost.toFixed(2)} PLN/d</span>
                    </summary>
                    <div class="space-y-2.5 pt-2">
                        ${devicesInGroup.map((dev) => this.renderDeviceCard(dev)).join('')}
                    </div>
                </details>
            `;
        });

        listEl.innerHTML = html;

        listEl.querySelectorAll('details.group-block').forEach((detailsEl) => {
            detailsEl.addEventListener('toggle', () => {
                const name = detailsEl.dataset.group;
                if (detailsEl.open) {
                    this.collapsedGroups.delete(name);
                } else {
                    this.collapsedGroups.add(name);
                }
            });
        });

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

        const enabledDevices = this.devices.filter((d) => d.enabled && (d.power > 0 || d.standbyPower > 0));
        if (enabledDevices.length === 0) {
            card.classList.add('hidden');
            return;
        }
        card.classList.remove('hidden');

        const colors = ['#6366f1', '#10b981', '#f59e0b', '#38bdf8', '#f43f5e', '#a855f7', '#eab308', '#22d3ee'];
        const costs = enabledDevices.map((d) => this.computeDeviceDailyStats(d).cost);
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

        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = '#0f172a';
        ctx.fill();
    }

    calculateTotals() {
        let totalKwh = 0;
        let totalCost = 0;

        this.devices.forEach((dev) => {
            const stats = this.computeDeviceDailyStats(dev);
            totalKwh += stats.kwh;
            totalCost += stats.cost;
        });

        this._lastTotalKwh = totalKwh;
        this._lastTotalCost = totalCost;

        document.getElementById('total-daily-kwh').innerText = `${totalKwh.toFixed(2)} kWh`;
        document.getElementById('total-daily-cost').innerText = `${totalCost.toFixed(2)} PLN`;
        document.getElementById('total-monthly-cost').innerText = `${(totalCost * 30).toFixed(2)} PLN`;
        document.getElementById('total-yearly-cost').innerText = `${(totalCost * 365).toFixed(2)} PLN`;

        this.updateTariffForecast();
    }

    onWindowResize() {
        const container = document.getElementById('canvas-container');
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);

        if (this.previewRenderer) this.resizePreviewRenderer();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        if (this._cameraTween) {
            const t = Math.min(1, (performance.now() - this._cameraTween.start) / this._cameraTween.duration);
            const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            this.camera.position.lerpVectors(this._cameraTween.fromPos, this._cameraTween.toPos, ease);
            this.controls.target.lerpVectors(this._cameraTween.fromTarget, this._cameraTween.toTarget, ease);
            if (t >= 1) this._cameraTween = null;
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);

        if (this._previewActive && this._pendingModel) {
            this._pendingModel.rotation.y += 0.01;
            this.previewRenderer.render(this.previewScene, this.previewCamera);
        }
    }
}

let app;
window.addEventListener('DOMContentLoaded', () => {
    app = new EnergySimulatorv14();
});
