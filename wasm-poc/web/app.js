/**
 * app.js — Central application core for OpenCPN WASM.
 *
 * Provides: event bus, chart registry, vessel state, AIS target store,
 * settings/preferences, storage API (IndexedDB), render scheduling.
 *
 * All modules communicate through this — no direct cross-module dependencies.
 */
(function() {
'use strict';

// ══════════════════════════════════════════════════════════════
// Event Bus — pub/sub for decoupled communication
// ══════════════════════════════════════════════════════════════
class EventBus {
    constructor() { this._handlers = {}; }

    on(event, handler) {
        (this._handlers[event] || (this._handlers[event] = [])).push(handler);
        return () => this.off(event, handler);
    }

    off(event, handler) {
        const h = this._handlers[event];
        if (h) this._handlers[event] = h.filter(fn => fn !== handler);
    }

    emit(event, data) {
        const h = this._handlers[event];
        if (h) for (const fn of h) try { fn(data); } catch(e) { console.error(`[Event ${event}]`, e); }
    }

    once(event, handler) {
        const unsub = this.on(event, data => { unsub(); handler(data); });
        return unsub;
    }
}

// ══════════════════════════════════════════════════════════════
// Chart Registry — manages all loaded charts
// ══════════════════════════════════════════════════════════════
class ChartRegistry {
    constructor(bus) {
        this._bus = bus;
        this._charts = new Map(); // id → ChartEntry
        this._nextId = 1;
        this._groups = new Map(); // groupName → Set<chartId>
        this._groups.set('default', new Set());
    }

    add(chartData, meta = {}) {
        const id = meta.id || `chart-${this._nextId++}`;
        const entry = {
            id,
            data: chartData,
            type: meta.type || 'unknown', // 's57', 'kap', 'mbtiles'
            name: meta.name || id,
            scale: chartData.scale || meta.scale || 0,
            extent: chartData.extent || meta.extent || null,
            visible: true,
            group: meta.group || 'default',
            renderData: null, // filled by renderer
            rasterLayer: null,
        };
        this._charts.set(id, entry);
        const grp = this._groups.get(entry.group) || new Set();
        grp.add(id);
        this._groups.set(entry.group, grp);
        this._bus.emit('chart-added', entry);
        return id;
    }

    remove(id) {
        const entry = this._charts.get(id);
        if (!entry) return;
        this._charts.delete(id);
        for (const [, grp] of this._groups) grp.delete(id);
        this._bus.emit('chart-removed', entry);
    }

    get(id) { return this._charts.get(id); }

    getAll() { return Array.from(this._charts.values()); }

    getVisible() {
        return this.getAll().filter(c => c.visible);
    }

    getForViewport(extent, zoom) {
        return this.getVisible()
            .filter(c => c.extent && this._overlaps(c.extent, extent))
            .sort((a, b) => {
                // Prefer chart whose scale is closest to view scale
                const da = Math.abs(Math.log(a.scale || 1) - Math.log(zoom || 1));
                const db = Math.abs(Math.log(b.scale || 1) - Math.log(zoom || 1));
                return da - db;
            });
    }

    setVisible(id, visible) {
        const e = this._charts.get(id);
        if (e) { e.visible = visible; this._bus.emit('chart-visibility', { id, visible }); }
    }

    count() { return this._charts.size; }

    getGroups() { return Array.from(this._groups.keys()); }

    getGroupCharts(group) {
        const ids = this._groups.get(group);
        return ids ? Array.from(ids).map(id => this._charts.get(id)).filter(Boolean) : [];
    }

    _overlaps(a, b) {
        return !(a.maxLon < b.minLon || a.minLon > b.maxLon ||
                 a.maxLat < b.minLat || a.minLat > b.maxLat);
    }
}

// ══════════════════════════════════════════════════════════════
// Vessel State — own ship position and dynamics
// ══════════════════════════════════════════════════════════════
class VesselState {
    constructor(bus) {
        this._bus = bus;
        this.lat = NaN;
        this.lon = NaN;
        this.sog = 0;   // knots
        this.cog = 0;   // degrees true
        this.hdg = NaN;  // heading true
        this.depth = NaN; // meters
        this.windSpeedKn = NaN;
        this.windDirTrue = NaN;
        this.altitude = NaN;
        this.satellites = 0;
        this.fixQuality = 0;
        this.utc = '';
        this._history = []; // last N positions for track recording
        this._maxHistory = 10000;
    }

    update(data) {
        let changed = false;
        for (const [k, v] of Object.entries(data)) {
            if (k in this && this[k] !== v) { this[k] = v; changed = true; }
        }
        if (changed) {
            if (!isNaN(this.lat) && !isNaN(this.lon)) {
                this._history.push({ lat: this.lat, lon: this.lon, time: Date.now(), sog: this.sog, cog: this.cog });
                if (this._history.length > this._maxHistory) this._history.shift();
            }
            this._bus.emit('vessel-update', this);
        }
    }

    get hasPosition() { return !isNaN(this.lat) && !isNaN(this.lon); }

    getHistory(maxAge = Infinity) {
        if (maxAge === Infinity) return this._history;
        const cutoff = Date.now() - maxAge;
        return this._history.filter(p => p.time >= cutoff);
    }
}

// ══════════════════════════════════════════════════════════════
// AIS Target Store — centralized AIS target management
// ══════════════════════════════════════════════════════════════
class AISStore {
    constructor(bus) {
        this._bus = bus;
        this._targets = new Map(); // mmsi → target
        this._maxAge = 600000; // 10 min stale
    }

    update(target) {
        const existing = this._targets.get(target.mmsi);
        this._targets.set(target.mmsi, target);
        this._bus.emit(existing ? 'ais-update' : 'ais-new', target);
    }

    remove(mmsi) {
        this._targets.delete(mmsi);
        this._bus.emit('ais-lost', { mmsi });
    }

    get(mmsi) { return this._targets.get(mmsi); }

    getAll() { return Array.from(this._targets.values()); }

    getActive() {
        const cutoff = Date.now() - this._maxAge;
        return this.getAll().filter(t => (t.lastUpdate || 0) > cutoff);
    }

    prune() {
        const cutoff = Date.now() - this._maxAge;
        for (const [mmsi, t] of this._targets) {
            if ((t.lastUpdate || 0) < cutoff) {
                this._targets.delete(mmsi);
                this._bus.emit('ais-lost', { mmsi });
            }
        }
    }

    // CPA/TCPA calculation relative to own vessel
    computeCPA(target, vessel) {
        if (!vessel.hasPosition || isNaN(target.lat) || isNaN(target.lon)) return null;
        const DEG = Math.PI / 180;
        const NM_PER_DEG_LAT = 60;
        const cosLat = Math.cos(vessel.lat * DEG);

        // Relative position in NM
        const dx = (target.lon - vessel.lon) * NM_PER_DEG_LAT * cosLat;
        const dy = (target.lat - vessel.lat) * NM_PER_DEG_LAT;

        // Velocity components (SOG in knots, COG in degrees true)
        const tSog = target.sog || 0, tCog = (target.cog || 0) * DEG;
        const vSog = vessel.sog || 0, vCog = vessel.cog * DEG;

        const dvx = tSog * Math.sin(tCog) - vSog * Math.sin(vCog);
        const dvy = tSog * Math.cos(tCog) - vSog * Math.cos(vCog);

        const dvSq = dvx * dvx + dvy * dvy;
        if (dvSq < 0.0001) return { cpa: Math.sqrt(dx * dx + dy * dy), tcpa: 0 };

        const tcpa = -(dx * dvx + dy * dvy) / dvSq; // hours
        if (tcpa < 0) return { cpa: Math.sqrt(dx * dx + dy * dy), tcpa: 0 };

        const cpx = dx + dvx * tcpa;
        const cpy = dy + dvy * tcpa;
        return { cpa: Math.sqrt(cpx * cpx + cpy * cpy), tcpa: tcpa * 60 }; // cpa in NM, tcpa in minutes
    }
}

// ══════════════════════════════════════════════════════════════
// Settings — user preferences with persistence
// ══════════════════════════════════════════════════════════════
const DEFAULT_SETTINGS = {
    // Safety
    safetyDepth: 5,        // meters
    shallowDepth: 2,       // meters
    deepDepth: 30,         // meters
    safetyContour: 10,     // meters

    // Display
    units: 'nautical',     // 'nautical' | 'metric' | 'imperial'
    colorScheme: 'day',    // 'day' | 'dusk' | 'night'
    showSoundings: true,
    showLightChars: true,
    showBuoyLabels: true,
    showDepthContours: true,
    showLandFeatures: true,
    showTextLabels: true,
    showAisTargets: true,
    showOwnShip: true,
    showGrid: false,
    showTides: false,
    showCurrents: false,

    // Chart display
    depthUnitDisplay: 'meters', // 'meters' | 'feet' | 'fathoms'
    symbolScale: 1.0,

    // Navigation
    arrivalRadius: 0.1,    // NM
    xteAlarm: 0.5,         // NM
    anchorAlarmRadius: 0.05, // NM (about 93m)

    // Connections
    nmeaSources: [],       // [{type:'ws', url:'ws://...', enabled:true}]
};

class Settings {
    constructor(bus) {
        this._bus = bus;
        this._data = { ...DEFAULT_SETTINGS };
        this._load();
    }

    get(key) { return this._data[key]; }

    set(key, value) {
        if (this._data[key] === value) return;
        const old = this._data[key];
        this._data[key] = value;
        this._save();
        this._bus.emit('setting-changed', { key, value, old });
    }

    getAll() { return { ...this._data }; }

    setMany(obj) {
        const changes = [];
        for (const [k, v] of Object.entries(obj)) {
            if (this._data[k] !== v) {
                const old = this._data[k];
                this._data[k] = v;
                changes.push({ key: k, value: v, old });
            }
        }
        if (changes.length) {
            this._save();
            for (const c of changes) this._bus.emit('setting-changed', c);
        }
    }

    reset() {
        this._data = { ...DEFAULT_SETTINGS };
        this._save();
        this._bus.emit('settings-reset');
    }

    _save() {
        try { localStorage.setItem('opencpn-settings', JSON.stringify(this._data)); } catch {}
    }

    _load() {
        try {
            const s = localStorage.getItem('opencpn-settings');
            if (s) Object.assign(this._data, JSON.parse(s));
        } catch {}
    }
}

// ══════════════════════════════════════════════════════════════
// Storage API — IndexedDB wrapper for large data
// ══════════════════════════════════════════════════════════════
class StorageAPI {
    constructor() {
        this._db = null;
        this._ready = this._init();
    }

    async _init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('opencpn-wasm', 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('charts')) {
                    db.createObjectStore('charts', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('tides')) {
                    db.createObjectStore('tides', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('grib')) {
                    db.createObjectStore('grib', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('logbook')) {
                    db.createObjectStore('logbook', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('blobs')) {
                    db.createObjectStore('blobs', { keyPath: 'id' });
                }
            };
            req.onsuccess = () => { this._db = req.result; resolve(); };
            req.onerror = () => reject(req.error);
        });
    }

    async put(store, data) {
        await this._ready;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(store, 'readwrite');
            tx.objectStore(store).put(data);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    async get(store, id) {
        await this._ready;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(store, 'readonly');
            const req = tx.objectStore(store).get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async getAll(store) {
        await this._ready;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async delete(store, id) {
        await this._ready;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(store, 'readwrite');
            tx.objectStore(store).delete(id);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    async clear(store) {
        await this._ready;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(store, 'readwrite');
            tx.objectStore(store).clear();
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }
}

// ══════════════════════════════════════════════════════════════
// Render Scheduler — batched requestAnimationFrame
// ══════════════════════════════════════════════════════════════
class RenderScheduler {
    constructor(bus) {
        this._bus = bus;
        this._dirty = false;
        this._renderFn = null;
        this._rafId = null;
    }

    setRenderer(fn) { this._renderFn = fn; }

    requestRender() {
        if (this._dirty) return;
        this._dirty = true;
        this._rafId = requestAnimationFrame(() => {
            this._dirty = false;
            if (this._renderFn) this._renderFn();
            this._bus.emit('frame-rendered');
        });
    }

    cancel() {
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        this._dirty = false;
    }
}

// ══════════════════════════════════════════════════════════════
// Alarm System — for anchor watch, XTE, CPA alerts
// ══════════════════════════════════════════════════════════════
class AlarmSystem {
    constructor(bus) {
        this._bus = bus;
        this._alarms = new Map(); // id → { message, active, priority }
    }

    set(id, message, priority = 'warning') {
        const alarm = { id, message, priority, active: true, time: Date.now() };
        this._alarms.set(id, alarm);
        this._bus.emit('alarm', alarm);
        this._playSound(priority);
    }

    clear(id) {
        this._alarms.delete(id);
        this._bus.emit('alarm-cleared', { id });
    }

    getActive() {
        return Array.from(this._alarms.values()).filter(a => a.active);
    }

    _playSound(priority) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = priority === 'danger' ? 880 : 440;
            gain.gain.value = priority === 'danger' ? 0.3 : 0.15;
            osc.start();
            osc.stop(ctx.currentTime + (priority === 'danger' ? 0.5 : 0.2));
        } catch {}
    }
}

// ══════════════════════════════════════════════════════════════
// Feature Index — spatial index for chart feature hit-testing
// ══════════════════════════════════════════════════════════════
class FeatureIndex {
    constructor() {
        this._features = []; // [{id, chartId, type, code, lat, lon, bbox, attrs}]
        this._cellSize = 0.01; // degrees
        this._grid = new Map(); // "cellX,cellY" → [featureIdx]
    }

    build(chartId, chartData) {
        if (!chartData) return;

        // Index point features
        const pts = chartData.points;
        if (pts && pts.coords) {
            const n = pts.classCodes.length;
            for (let i = 0; i < n; i++) {
                const lon = pts.coords[i * 2];
                const lat = pts.coords[i * 2 + 1];
                const attrs = {};
                if (pts.depths && pts.depths[i] !== -999) attrs.depth = pts.depths[i];
                if (pts.names && pts.names[i]) attrs.name = pts.names[i];
                this._addFeature({
                    id: `${chartId}-pt-${i}`,
                    chartId, type: 'point',
                    code: pts.classCodes[i],
                    lat, lon,
                    bbox: { minLat: lat, maxLat: lat, minLon: lon, maxLon: lon },
                    attrs
                });
            }
        }

        // Index line features (use midpoint for grid)
        if (chartData.lines) {
            const lines = chartData.lines;
            let ci = 0;
            for (let li = 0; li < (lines.featureCount || 0); li++) {
                const code = lines.classCodes ? lines.classCodes[li] : 0;
                const count = lines.counts ? lines.counts[li] : 0;
                if (count < 2) { ci += count; continue; }
                let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
                for (let j = 0; j < count; j++) {
                    const lon = lines.coords[(ci + j) * 2];
                    const lat = lines.coords[(ci + j) * 2 + 1];
                    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
                    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
                }
                const midLon = (minLon + maxLon) / 2;
                const midLat = (minLat + maxLat) / 2;
                this._addFeature({
                    id: `${chartId}-ln-${li}`,
                    chartId, type: 'line', code,
                    lat: midLat, lon: midLon,
                    bbox: { minLat, maxLat, minLon, maxLon },
                    attrs: {}
                });
                ci += count;
            }
        }

        // Index polygon features (use centroid for grid)
        if (chartData.polygons) {
            const polys = chartData.polygons;
            let ci = 0;
            for (let pi = 0; pi < (polys.featureCount || 0); pi++) {
                const code = polys.classCodes ? polys.classCodes[pi] : 0;
                const count = polys.counts ? polys.counts[pi] : 0;
                if (count < 3) { ci += count; continue; }
                let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
                let sumLat = 0, sumLon = 0;
                for (let j = 0; j < count; j++) {
                    const lon = polys.coords[(ci + j) * 2];
                    const lat = polys.coords[(ci + j) * 2 + 1];
                    sumLat += lat; sumLon += lon;
                    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
                    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
                }
                const attrs = {};
                if (polys.drval1 && polys.drval1[pi] !== -999) attrs.drval1 = polys.drval1[pi];
                if (polys.drval2 && polys.drval2[pi] !== -999) attrs.drval2 = polys.drval2[pi];
                this._addFeature({
                    id: `${chartId}-pg-${pi}`,
                    chartId, type: 'polygon', code,
                    lat: sumLat / count, lon: sumLon / count,
                    bbox: { minLat, maxLat, minLon, maxLon },
                    attrs
                });
                ci += count;
            }
        }
    }

    _addFeature(f) {
        const idx = this._features.length;
        this._features.push(f);
        const cx = Math.floor(f.lon / this._cellSize);
        const cy = Math.floor(f.lat / this._cellSize);
        const key = `${cx},${cy}`;
        const cell = this._grid.get(key) || [];
        cell.push(idx);
        this._grid.set(key, cell);
    }

    query(lat, lon, radiusDeg = 0.005) {
        const results = [];
        const cx0 = Math.floor((lon - radiusDeg) / this._cellSize);
        const cx1 = Math.floor((lon + radiusDeg) / this._cellSize);
        const cy0 = Math.floor((lat - radiusDeg) / this._cellSize);
        const cy1 = Math.floor((lat + radiusDeg) / this._cellSize);
        const rSq = radiusDeg * radiusDeg;

        for (let cx = cx0; cx <= cx1; cx++) {
            for (let cy = cy0; cy <= cy1; cy++) {
                const cell = this._grid.get(`${cx},${cy}`);
                if (!cell) continue;
                for (const idx of cell) {
                    const f = this._features[idx];
                    if (f.type === 'point') {
                        const dx = f.lon - lon, dy = f.lat - lat;
                        if (dx * dx + dy * dy <= rSq) results.push(f);
                    } else {
                        // For lines/polygons, check bbox overlap
                        if (lon >= f.bbox.minLon - radiusDeg && lon <= f.bbox.maxLon + radiusDeg &&
                            lat >= f.bbox.minLat - radiusDeg && lat <= f.bbox.maxLat + radiusDeg) {
                            results.push(f);
                        }
                    }
                }
            }
        }
        return results;
    }

    removeChart(chartId) {
        // Rebuild without removed chart's features
        const kept = this._features.filter(f => f.chartId !== chartId);
        this._features = [];
        this._grid.clear();
        for (const f of kept) this._addFeature(f);
    }

    clear() {
        this._features = [];
        this._grid.clear();
    }
}

// ══════════════════════════════════════════════════════════════
// S-57 Object Class Name Lookup
// ══════════════════════════════════════════════════════════════
const S57_CLASS_NAMES = {
    1: 'ADMARE', 2: 'AIRARE', 3: 'ACHBRT', 4: 'ACHARE', 5: 'BCNCAR',
    6: 'BCNISD', 7: 'BCNLAT', 8: 'BCNSAW', 9: 'BCNSPP', 10: 'BERTHS',
    11: 'BRIDGE', 12: 'COALNE', 13: 'CANALS', 14: 'CBLARE', 15: 'CBLOHD',
    16: 'CBLSUB', 17: 'BOYCAR', 18: 'BOYISD', 19: 'BOYLAT', 20: 'BOYSAW',
    21: 'BOYSPP', 22: 'BUAARE', 23: 'BUISGL', 24: 'CANBNK', 25: 'CAUSWY',
    26: 'CTNARE', 27: 'CHKPNT', 28: 'CGUSTA', 29: 'CONVYR', 30: 'DEPCNT',
    31: 'DAMCON', 32: 'DEPARE', // using 32 sometimes for DEPARE
    33: 'DMPGRD', 34: 'DOCARE', 35: 'DRGARE', 36: 'DRYDOC', 37: 'DWRTCL',
    38: 'DWRTPT', 39: 'EXCNST', 40: 'FAIRWY', 41: 'FERYRT', 42: 'DEPARE',
    43: 'FLODOC', 44: 'FOGSIG', 45: 'FORSTC', 46: 'FSHZNE', 47: 'FSHFAC',
    48: 'FSHGRD', 49: 'GATCON', 50: 'GRIDRN', 51: 'HRBARE', 52: 'HRBFAC',
    53: 'HULKES', 54: 'ICEARE', 55: 'ICNARE', 56: 'ISTZNE', 57: 'LAKARE',
    58: 'LNDARE', // sometimes 58 for LNDARE
    59: 'LNDELV', 60: 'LNDMRK', 61: 'LNDRGN', 62: 'LITFLT',
    63: 'LITVES', 64: 'LOCMAG', 65: 'RIVERS', // sometimes 65
    66: 'LOGPON', 67: 'LOKBSN',
    68: 'MAGVAR', 69: 'MARCUL', 70: 'MIPARE', 71: 'LNDARE', 72: 'MORFAC',
    73: 'NAVLNE', 74: 'OBSTRN', 75: 'LIGHTS', 76: 'OFSPLF', 77: 'OSPARE',
    78: 'OILBAR', 79: 'PILPNT', 80: 'PILBOP', 81: 'PIPARE', 82: 'PIPOHD',
    83: 'PIPSOL', 84: 'PONTON', 85: 'PRCARE', 86: 'OBSTRN', 87: 'PYLONS',
    88: 'RADLNE', 89: 'RADRNG', 90: 'RADRFL', 91: 'RADSTA', 92: 'RTPBCN',
    93: 'RDOCAL', 94: 'RDOSTA', 95: 'RAILWY', 96: 'RAPIDS', 97: 'RCRTCL',
    98: 'RECTRC', 99: 'RESARE', 100: 'RETRFL', 101: 'RIVERS', 102: 'ROADWY',
    103: 'RUNWAY', 104: 'SBDARE', 105: 'SEAARE', 106: 'SILTNK', 107: 'SLCONS',
    108: 'SLOTOP', 109: 'SLOGRD', 110: 'SMCFAC', 111: 'SOUNDG', 112: 'SPRING',
    113: 'STSLNE', 114: 'SUBTLN', 115: 'SWPARE', 116: 'T_HMON', 117: 'T_NHMN',
    118: 'T_TIMS', 119: 'TESARE', 120: 'TS_FEB', 121: 'TS_PAD', 122: 'TS_PNH',
    123: 'TS_PRH', 124: 'TS_TIS', 125: 'TIDEWY', 126: 'TOPMAR', 127: 'TSELNE',
    128: 'TSEZNE', 129: 'TSSBND', 130: 'TSSCRS', 131: 'TSSLPT', 132: 'TSSRON',
    133: 'TUNNEL', 134: 'TWRTPT', 135: 'UWTROC', 136: 'UNSARE',
    137: 'VEGATN', 138: 'WATTUR', 139: 'WATFAL', 140: 'WEDKLP',
    141: 'WRECKS', 142: 'TS_ISB', 143: 'MPAARE', 154: 'SEAARE', 159: 'SOUNDG',
};

// ══════════════════════════════════════════════════════════════
// App singleton — assembled from all components
// ══════════════════════════════════════════════════════════════
const bus = new EventBus();
const app = {
    bus,
    charts: new ChartRegistry(bus),
    vessel: new VesselState(bus),
    ais: new AISStore(bus),
    settings: new Settings(bus),
    storage: new StorageAPI(),
    scheduler: new RenderScheduler(bus),
    alarms: new AlarmSystem(bus),
    featureIndex: new FeatureIndex(),
    S57_CLASS_NAMES,
};

// Wire NMEA parser → vessel state + AIS store
bus.on('nmea-sentence', (sentence) => {
    if (typeof NMEAParser !== 'undefined' && app._nmeaParser) {
        app._nmeaParser.feed(sentence);
    }
});

// Expose globally
window.App = app;
window.EventBus = EventBus;

})();
