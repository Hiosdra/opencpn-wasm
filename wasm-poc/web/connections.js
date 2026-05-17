/**
 * connections.js — NMEA/SignalK connection manager for OpenCPN WASM.
 *
 * Provides: WebSocket NMEA connections, SignalK client, NMEA replay,
 * and a connection manager UI panel.
 *
 * Depends on: window.App (bus, vessel, settings, ais)
 * Optional: window.NMEAParser, window.AISDecoder
 */
(function() {
'use strict';

let nextConnId = 1;

// ══════════════════════════════════════════════════════════════
// NMEAConnection — WebSocket NMEA sentence stream
// ══════════════════════════════════════════════════════════════
class NMEAConnection {
    constructor(config) {
        this.id = config.id || `nmea-${nextConnId++}`;
        this.name = config.name || 'NMEA WebSocket';
        this.type = 'ws-nmea';
        this.url = config.url;
        this.status = 'disconnected'; // disconnected | connecting | connected | error
        this.stats = { received: 0, errors: 0, lastMessage: null };
        this._ws = null;
        this._reconnectDelay = 1000;
        this._maxReconnect = 30000;
        this._reconnectTimer = null;
        this._shouldConnect = false;
        this._buffer = '';
    }

    start() {
        this._shouldConnect = true;
        this._reconnectDelay = 1000;
        this._connect();
    }

    stop() {
        this._shouldConnect = false;
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
        if (this._ws) {
            this._ws.onclose = null;
            this._ws.close();
            this._ws = null;
        }
        this._setStatus('disconnected');
    }

    _connect() {
        if (!this._shouldConnect) return;
        this._setStatus('connecting');

        try {
            this._ws = new WebSocket(this.url);
        } catch (e) {
            this._setStatus('error');
            this._scheduleReconnect();
            return;
        }

        this._ws.onopen = () => {
            this._reconnectDelay = 1000;
            this._setStatus('connected');
        };

        this._ws.onmessage = (evt) => {
            this._buffer += evt.data;
            const lines = this._buffer.split('\n');
            this._buffer = lines.pop(); // keep incomplete line in buffer
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                this._processLine(trimmed);
            }
        };

        this._ws.onerror = () => {
            this.stats.errors++;
        };

        this._ws.onclose = () => {
            this._ws = null;
            if (this._shouldConnect) {
                this._setStatus('disconnected');
                this._scheduleReconnect();
            }
        };
    }

    _processLine(line) {
        this.stats.received++;
        this.stats.lastMessage = Date.now();

        // Feed to NMEA parser
        if (window.NMEAParser) {
            try { window.NMEAParser.parse(line); } catch (e) { /* ignore parse errors */ }
        }

        // Feed AIS sentences to decoder
        if (window.AISDecoder && (line.indexOf('!AIVDM') === 0 || line.indexOf('!AIVDO') === 0)) {
            try { window.AISDecoder.decode(line); } catch (e) { /* ignore decode errors */ }
        }

        if (window.App && window.App.bus) {
            window.App.bus.emit('nmea-sentence', { connectionId: this.id, sentence: line });
        }
    }

    _scheduleReconnect() {
        if (!this._shouldConnect) return;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnect);
            this._connect();
        }, this._reconnectDelay);
    }

    _setStatus(status) {
        this.status = status;
        if (window.App && window.App.bus) {
            window.App.bus.emit('connection-status', { id: this.id, status });
        }
    }

    toJSON() {
        return { id: this.id, name: this.name, type: this.type, url: this.url, status: this.status, stats: { ...this.stats } };
    }
}

// ══════════════════════════════════════════════════════════════
// SignalKClient — connects to SignalK server (REST + WebSocket)
// ══════════════════════════════════════════════════════════════
class SignalKClient {
    constructor(config) {
        this.id = config.id || `signalk-${nextConnId++}`;
        this.name = config.name || 'SignalK';
        this.type = 'signalk';
        this.url = config.url; // base URL, e.g. http://localhost:3000
        this.status = 'disconnected';
        this.stats = { received: 0, errors: 0, lastMessage: null };
        this._ws = null;
        this._wsUrl = null;
        this._reconnectDelay = 1000;
        this._maxReconnect = 30000;
        this._reconnectTimer = null;
        this._shouldConnect = false;
    }

    async start() {
        this._shouldConnect = true;
        this._reconnectDelay = 1000;
        this._setStatus('connecting');
        await this._discover();
    }

    stop() {
        this._shouldConnect = false;
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
        if (this._ws) {
            this._ws.onclose = null;
            this._ws.close();
            this._ws = null;
        }
        this._setStatus('disconnected');
    }

    async _discover() {
        if (!this._shouldConnect) return;
        try {
            const baseUrl = this.url.replace(/\/$/, '');
            const resp = await fetch(`${baseUrl}/signalk`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const info = await resp.json();

            // Find WebSocket endpoint from endpoints
            const endpoints = info.endpoints || {};
            const versions = Object.keys(endpoints);
            const v1 = versions.find(v => v.startsWith('v1')) || versions[0];
            if (v1 && endpoints[v1]['signalk-ws']) {
                this._wsUrl = endpoints[v1]['signalk-ws'];
            } else if (info.server && info.server.id) {
                // Fallback: construct WS URL
                const wsBase = baseUrl.replace(/^http/, 'ws');
                this._wsUrl = `${wsBase}/signalk/v1/stream?subscribe=all`;
            } else {
                const wsBase = baseUrl.replace(/^http/, 'ws');
                this._wsUrl = `${wsBase}/signalk/v1/stream?subscribe=all`;
            }

            this._connectWs();
        } catch (e) {
            this.stats.errors++;
            this._setStatus('error');
            this._scheduleReconnect();
        }
    }

    _connectWs() {
        if (!this._shouldConnect || !this._wsUrl) return;

        try {
            this._ws = new WebSocket(this._wsUrl);
        } catch (e) {
            this._setStatus('error');
            this._scheduleReconnect();
            return;
        }

        this._ws.onopen = () => {
            this._reconnectDelay = 1000;
            this._setStatus('connected');
            // Subscribe to navigation and environment
            this._subscribe();
        };

        this._ws.onmessage = (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                this._processMessage(msg);
            } catch (e) {
                this.stats.errors++;
            }
        };

        this._ws.onerror = () => {
            this.stats.errors++;
        };

        this._ws.onclose = () => {
            this._ws = null;
            if (this._shouldConnect) {
                this._setStatus('disconnected');
                this._scheduleReconnect();
            }
        };
    }

    _subscribe() {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
        const subscription = {
            context: 'vessels.self',
            subscribe: [
                { path: 'navigation.*' },
                { path: 'environment.*' }
            ]
        };
        this._ws.send(JSON.stringify(subscription));
    }

    _processMessage(msg) {
        this.stats.received++;
        this.stats.lastMessage = Date.now();

        if (!msg.updates) return;

        const vesselData = {};

        for (const update of msg.updates) {
            if (!update.values) continue;
            for (const v of update.values) {
                this._mapValue(v.path, v.value, vesselData);
            }
        }

        if (Object.keys(vesselData).length > 0 && window.App && window.App.vessel) {
            window.App.vessel.update(vesselData);
        }
    }

    _mapValue(path, value, data) {
        // SignalK uses SI units; convert as needed
        switch (path) {
            case 'navigation.position':
                if (value && typeof value.latitude === 'number') {
                    data.lat = value.latitude;
                    data.lon = value.longitude;
                }
                break;
            case 'navigation.speedOverGround':
                // m/s → knots
                data.sog = value * 1.94384;
                break;
            case 'navigation.courseOverGroundTrue':
                // radians → degrees
                data.cog = value * (180 / Math.PI);
                break;
            case 'navigation.headingTrue':
                data.hdg = value * (180 / Math.PI);
                break;
            case 'environment.depth.belowTransducer':
            case 'environment.depth.belowSurface':
                data.depth = value;
                break;
            case 'environment.wind.speedTrue':
                data.windSpeedKn = value * 1.94384;
                break;
            case 'environment.wind.directionTrue':
                data.windDirTrue = value * (180 / Math.PI);
                break;
            case 'navigation.gnss.satellites':
                data.satellites = value;
                break;
        }
    }

    _scheduleReconnect() {
        if (!this._shouldConnect) return;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnect);
            this._discover();
        }, this._reconnectDelay);
    }

    _setStatus(status) {
        this.status = status;
        if (window.App && window.App.bus) {
            window.App.bus.emit('connection-status', { id: this.id, status });
        }
    }

    toJSON() {
        return { id: this.id, name: this.name, type: this.type, url: this.url, status: this.status, stats: { ...this.stats } };
    }
}

// ══════════════════════════════════════════════════════════════
// NMEAReplay — plays back recorded NMEA log files
// ══════════════════════════════════════════════════════════════
class NMEAReplay {
    constructor(config) {
        this.id = config.id || `replay-${nextConnId++}`;
        this.name = config.name || 'NMEA Replay';
        this.type = 'replay';
        this.url = config.url || null;
        this.status = 'disconnected';
        this.stats = { received: 0, errors: 0, lastMessage: null };
        this._lines = [];
        this._index = 0;
        this._playing = false;
        this._speed = 1.0;
        this._timer = null;
        this._intervalMs = 100; // base interval between sentences
    }

    async start() {
        if (this._lines.length === 0 && this.url) {
            await this._loadFromUrl(this.url);
        }
        if (this._lines.length === 0) {
            this._setStatus('error');
            return;
        }
        this._playing = true;
        this._setStatus('connected');
        this._playNext();
    }

    stop() {
        this._playing = false;
        clearTimeout(this._timer);
        this._timer = null;
        this._setStatus('disconnected');
    }

    pause() {
        this._playing = false;
        clearTimeout(this._timer);
        this._timer = null;
        this._setStatus('disconnected');
    }

    resume() {
        if (this._lines.length === 0) return;
        this._playing = true;
        this._setStatus('connected');
        this._playNext();
    }

    setSpeed(speed) {
        this._speed = Math.max(0.1, Math.min(100, speed));
    }

    getSpeed() {
        return this._speed;
    }

    getProgress() {
        if (this._lines.length === 0) return 0;
        return this._index / this._lines.length;
    }

    seek(fraction) {
        this._index = Math.floor(fraction * this._lines.length);
    }

    async loadFromFile(file) {
        const text = await file.text();
        this._lines = text.split('\n').filter(l => l.trim());
        this._index = 0;
    }

    async _loadFromUrl(url) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const text = await resp.text();
            this._lines = text.split('\n').filter(l => l.trim());
            this._index = 0;
        } catch (e) {
            this.stats.errors++;
            this._setStatus('error');
        }
    }

    _playNext() {
        if (!this._playing || this._index >= this._lines.length) {
            if (this._index >= this._lines.length) {
                this._index = 0; // loop
            }
            if (!this._playing) return;
        }

        const line = this._lines[this._index++].trim();
        if (line) {
            this._processLine(line);
        }

        const delay = this._intervalMs / this._speed;
        this._timer = setTimeout(() => this._playNext(), delay);
    }

    _processLine(line) {
        this.stats.received++;
        this.stats.lastMessage = Date.now();

        if (window.NMEAParser) {
            try { window.NMEAParser.parse(line); } catch (e) { /* ignore */ }
        }

        if (window.AISDecoder && (line.indexOf('!AIVDM') === 0 || line.indexOf('!AIVDO') === 0)) {
            try { window.AISDecoder.decode(line); } catch (e) { /* ignore */ }
        }

        if (window.App && window.App.bus) {
            window.App.bus.emit('nmea-sentence', { connectionId: this.id, sentence: line });
        }
    }

    _setStatus(status) {
        this.status = status;
        if (window.App && window.App.bus) {
            window.App.bus.emit('connection-status', { id: this.id, status });
        }
    }

    toJSON() {
        return {
            id: this.id, name: this.name, type: this.type, url: this.url,
            status: this.status, stats: { ...this.stats },
            progress: this.getProgress(), speed: this._speed
        };
    }
}

// ══════════════════════════════════════════════════════════════
// ConnectionManager — manages all connections
// ══════════════════════════════════════════════════════════════

/**
 * TCP/UDP NMEA Proxy via WebSocket:
 *
 * For users with NMEA data on TCP/UDP ports, a WebSocket proxy is needed
 * since browsers cannot access raw TCP/UDP sockets. Options:
 *
 * 1. Use the built-in proxy in server.js (if available):
 *    Start with: node server.js --nmea-proxy --tcp-port 10110
 *    Connect to: ws://localhost:8080/nmea
 *
 * 2. Use socat + websocat:
 *    socat TCP-LISTEN:10110,fork - | websocat -s 8765
 *    Connect to: ws://localhost:8765
 *
 * 3. Use a dedicated bridge like kplex with WebSocket output:
 *    Configure kplex to output to a WebSocket endpoint.
 *
 * 4. Python bridge (minimal):
 *    pip install websockets
 *    python -c "
 *    import asyncio, websockets, socket
 *    async def bridge(ws, path):
 *        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
 *        s.connect(('localhost', 10110))
 *        while True:
 *            data = await asyncio.get_event_loop().run_in_executor(None, s.recv, 4096)
 *            if data: await ws.send(data.decode())
 *    asyncio.run(websockets.serve(bridge, '0.0.0.0', 8765))
 *    "
 *    Connect to: ws://localhost:8765
 */

class ConnectionManager {
    constructor(app) {
        this._app = app;
        this._connections = new Map(); // id → connection instance
    }

    addConnection(config) {
        let conn;
        switch (config.type) {
            case 'ws-nmea':
                conn = new NMEAConnection(config);
                break;
            case 'signalk':
                conn = new SignalKClient(config);
                break;
            case 'replay':
                conn = new NMEAReplay(config);
                break;
            default:
                throw new Error(`Unknown connection type: ${config.type}`);
        }
        this._connections.set(conn.id, conn);
        this._app.bus.emit('connection-added', conn.toJSON());
        return conn.id;
    }

    removeConnection(id) {
        const conn = this._connections.get(id);
        if (!conn) return;
        conn.stop();
        this._connections.delete(id);
        this._app.bus.emit('connection-removed', { id });
    }

    getConnections() {
        return Array.from(this._connections.values()).map(c => c.toJSON());
    }

    getConnection(id) {
        const conn = this._connections.get(id);
        return conn ? conn.toJSON() : null;
    }

    start(id) {
        const conn = this._connections.get(id);
        if (conn) conn.start();
    }

    stop(id) {
        const conn = this._connections.get(id);
        if (conn) conn.stop();
    }

    startAll() {
        for (const conn of this._connections.values()) {
            conn.start();
        }
    }

    stopAll() {
        for (const conn of this._connections.values()) {
            conn.stop();
        }
    }

    getReplay(id) {
        const conn = this._connections.get(id);
        return (conn && conn.type === 'replay') ? conn : null;
    }

    renderPanel(container) {
        const panel = document.createElement('div');
        panel.className = 'conn-manager-panel';
        panel.innerHTML = `
            <style>
                .conn-manager-panel {
                    padding: 12px;
                    font-family: sans-serif;
                    font-size: 13px;
                    color: #e0e0e0;
                }
                .conn-manager-panel h3 {
                    margin: 0 0 10px 0;
                    font-size: 14px;
                    color: #53a8b6;
                }
                .conn-list { list-style: none; padding: 0; margin: 0 0 12px 0; }
                .conn-item {
                    display: flex; align-items: center; gap: 8px;
                    padding: 6px 8px; margin-bottom: 4px;
                    background: rgba(255,255,255,0.03);
                    border-radius: 4px;
                }
                .conn-status-dot {
                    width: 8px; height: 8px; border-radius: 50%;
                    flex-shrink: 0;
                }
                .conn-status-dot.connected { background: #4caf50; }
                .conn-status-dot.connecting { background: #ff9800; }
                .conn-status-dot.disconnected { background: #666; }
                .conn-status-dot.error { background: #f44336; }
                .conn-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .conn-stats { font-size: 11px; color: #888; margin-left: auto; }
                .conn-btn {
                    background: none; border: 1px solid rgba(83,168,182,0.4);
                    color: #53a8b6; border-radius: 3px; padding: 2px 6px;
                    cursor: pointer; font-size: 11px;
                }
                .conn-btn:hover { background: rgba(83,168,182,0.15); }
                .conn-btn.danger { border-color: rgba(244,67,54,0.4); color: #f44336; }
                .conn-btn.danger:hover { background: rgba(244,67,54,0.15); }
                .conn-add-form {
                    display: flex; flex-direction: column; gap: 6px;
                    padding: 8px; background: rgba(255,255,255,0.03);
                    border-radius: 4px; margin-top: 8px;
                }
                .conn-add-form select, .conn-add-form input {
                    background: rgba(0,0,0,0.3); border: 1px solid rgba(83,168,182,0.3);
                    color: #e0e0e0; padding: 4px 6px; border-radius: 3px; font-size: 12px;
                }
                .conn-replay-controls {
                    display: flex; align-items: center; gap: 6px; margin-top: 4px;
                }
                .conn-replay-controls input[type="range"] {
                    width: 60px; accent-color: #53a8b6;
                }
                .conn-replay-controls label { font-size: 11px; color: #888; }
            </style>
            <h3>Connections</h3>
            <ul class="conn-list"></ul>
            <button class="conn-btn" id="conn-add-btn">+ Add Connection</button>
            <div class="conn-add-form" style="display:none">
                <select id="conn-type-sel">
                    <option value="ws-nmea">WebSocket NMEA</option>
                    <option value="signalk">SignalK</option>
                    <option value="replay">NMEA Replay</option>
                </select>
                <input id="conn-url-input" type="text" placeholder="URL (ws://... or http://...)"/>
                <input id="conn-name-input" type="text" placeholder="Name (optional)"/>
                <div style="display:flex;gap:6px;">
                    <button class="conn-btn" id="conn-confirm-add">Add</button>
                    <button class="conn-btn" id="conn-cancel-add">Cancel</button>
                </div>
                <div id="conn-replay-file" style="display:none">
                    <label style="font-size:11px;color:#888;">Or load file:</label>
                    <input type="file" id="conn-replay-file-input" accept=".nmea,.log,.txt" style="font-size:11px;color:#aaa;"/>
                </div>
            </div>
        `;

        container.appendChild(panel);

        const list = panel.querySelector('.conn-list');
        const addBtn = panel.querySelector('#conn-add-btn');
        const addForm = panel.querySelector('.conn-add-form');
        const typeSel = panel.querySelector('#conn-type-sel');
        const urlInput = panel.querySelector('#conn-url-input');
        const nameInput = panel.querySelector('#conn-name-input');
        const confirmBtn = panel.querySelector('#conn-confirm-add');
        const cancelBtn = panel.querySelector('#conn-cancel-add');
        const replayFileDiv = panel.querySelector('#conn-replay-file');
        const replayFileInput = panel.querySelector('#conn-replay-file-input');

        const self = this;

        const refresh = () => {
            list.innerHTML = '';
            for (const conn of self.getConnections()) {
                const li = document.createElement('li');
                li.className = 'conn-item';
                li.innerHTML = `
                    <span class="conn-status-dot ${conn.status}"></span>
                    <span class="conn-name" title="${conn.url || ''}">${conn.name} <small style="color:#666">(${conn.type})</small></span>
                    <span class="conn-stats">${conn.stats.received} msgs</span>
                    ${conn.status === 'connected'
                        ? `<button class="conn-btn" data-action="stop" data-id="${conn.id}">Stop</button>`
                        : `<button class="conn-btn" data-action="start" data-id="${conn.id}">Start</button>`}
                    <button class="conn-btn danger" data-action="remove" data-id="${conn.id}">✕</button>
                `;
                list.appendChild(li);
            }
        };

        list.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            if (action === 'start') self.start(id);
            else if (action === 'stop') self.stop(id);
            else if (action === 'remove') self.removeConnection(id);
            setTimeout(refresh, 100);
        });

        addBtn.addEventListener('click', () => {
            addForm.style.display = addForm.style.display === 'none' ? 'flex' : 'none';
        });

        cancelBtn.addEventListener('click', () => {
            addForm.style.display = 'none';
        });

        typeSel.addEventListener('change', () => {
            replayFileDiv.style.display = typeSel.value === 'replay' ? 'block' : 'none';
        });

        confirmBtn.addEventListener('click', async () => {
            const type = typeSel.value;
            const url = urlInput.value.trim();
            const name = nameInput.value.trim() || undefined;

            if (!url && type !== 'replay') return;

            const id = self.addConnection({ type, url: url || undefined, name });

            // If replay and file chosen, load it
            if (type === 'replay' && replayFileInput.files.length > 0) {
                const replay = self.getReplay(id);
                if (replay) await replay.loadFromFile(replayFileInput.files[0]);
            }

            urlInput.value = '';
            nameInput.value = '';
            addForm.style.display = 'none';
            refresh();
        });

        // Auto-refresh on status changes
        if (this._app && this._app.bus) {
            this._app.bus.on('connection-status', refresh);
            this._app.bus.on('connection-added', refresh);
            this._app.bus.on('connection-removed', refresh);
        }

        refresh();
        return panel;
    }
}

// ══════════════════════════════════════════════════════════════
// Export
// ══════════════════════════════════════════════════════════════
window.ConnectionManager = ConnectionManager;
window.NMEAConnection = NMEAConnection;
window.SignalKClient = SignalKClient;
window.NMEAReplay = NMEAReplay;

})();
