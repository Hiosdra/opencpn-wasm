/**
 * renderer.js — WebGL renderer for S-57 chart data from WASM parser.
 *
 * Handles: polygon fill (with Earcut triangulation), line rendering,
 * point markers, pan/zoom, Web Mercator projection.
 */

// earcut v3 exports { default, deviation, flatten }
const earcutFn = (typeof earcut === 'function') ? earcut : earcut.default;

// ── S-57 Object Class codes for styling ──
const S57_CLASSES = {
    // Areas
    42: { name: 'DEPARE', color: [0.6, 0.8, 1.0, 1.0] },  // depth area — light blue
    71: { name: 'LNDARE', color: [0.85, 0.82, 0.72, 1.0] }, // land — tan
    154: { name: 'SEAARE', color: [0.5, 0.7, 0.9, 1.0] },   // sea area — blue
    57: { name: 'LAKARE', color: [0.6, 0.8, 1.0, 1.0] },   // lake
    65: { name: 'RIVERS', color: [0.5, 0.75, 1.0, 1.0] },  // river
    // Lines
    30: { name: 'DEPCNT', color: [0.4, 0.6, 0.8, 0.7] },   // depth contour
    12: { name: 'COALNE', color: [0.2, 0.2, 0.2, 1.0] },   // coastline — dark
    // Points
    159: { name: 'SOUNDG', color: [0.3, 0.5, 0.7, 1.0] },  // soundings — blue
    75: { name: 'LIGHTS', color: [1.0, 1.0, 0.0, 1.0] },   // lights — yellow
    17: { name: 'BOYCAR', color: [1.0, 0.0, 0.0, 1.0] },   // cardinal buoy — red
    86: { name: 'OBSTRN', color: [0.8, 0.2, 0.2, 1.0] },   // obstruction — red
};
const DEFAULT_AREA_COLOR = [0.5, 0.65, 0.85, 0.6];
const DEFAULT_LINE_COLOR = [0.5, 0.5, 0.5, 0.8];
const DEFAULT_POINT_COLOR = [0.7, 0.7, 0.7, 1.0];

// ── Coordinate formatting (DDM — Degrees° Decimal Minutes) ──
function formatDDM(lat, lon) {
    const fmtOne = (v, pos, neg) => {
        const a = Math.abs(v);
        const d = Math.floor(a);
        const m = (a - d) * 60;
        return `${d}°${m.toFixed(2)}'${v >= 0 ? pos : neg}`;
    };
    return `${fmtOne(lat, 'N', 'S')}  ${fmtOne(lon, 'E', 'W')}`;
}

// ── Web Mercator projection ──
function lonToX(lon) { return lon * Math.PI / 180; }
function latToY(lat) {
    const r = lat * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + r / 2));
}
function xToLon(x) { return x * 180 / Math.PI; }
function yToLat(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI; }

// ── Color schemes ──
const COLOR_SCHEMES = {
    day:   { bg: [0.82, 0.89, 0.95], uiBg: 'rgba(22,33,62,0.9)',   uiText: '#e0e0e0', accent: '#53a8b6', headerBg: '#16213e' },
    dusk:  { bg: [0.45, 0.35, 0.40], uiBg: 'rgba(60,30,30,0.9)',    uiText: '#d4b0b0', accent: '#c08060', headerBg: '#3a2020' },
    night: { bg: [0.10, 0.02, 0.02], uiBg: 'rgba(40,5,5,0.9)',      uiText: '#880000', accent: '#cc3333', headerBg: '#200000' },
};

// ── Shader sources ──
const VERT_SRC = `
    attribute vec2 a_position;
    uniform mat3 u_matrix;
    void main() {
        vec3 pos = u_matrix * vec3(a_position, 1.0);
        gl_Position = vec4(pos.xy, 0.0, 1.0);
        gl_PointSize = 4.0;
    }
`;
const FRAG_SRC = `
    precision mediump float;
    uniform vec4 u_color;
    void main() { gl_FragColor = u_color; }
`;

// Texture shaders for raster charts (KAP)
const TEX_VERT_SRC = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    uniform mat3 u_matrix;
    varying vec2 v_texCoord;
    void main() {
        vec3 pos = u_matrix * vec3(a_position, 1.0);
        gl_Position = vec4(pos.xy, 0.0, 1.0);
        v_texCoord = a_texCoord;
    }
`;
const TEX_FRAG_SRC = `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    void main() { gl_FragColor = texture2D(u_texture, v_texCoord); }
`;

class ChartRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl', { antialias: true, alpha: false });
        if (!this.gl) throw new Error('WebGL not supported');

        // Color program (S-57 vector)
        this.program = this._createProgram(VERT_SRC, FRAG_SRC);
        this.aPos = this.gl.getAttribLocation(this.program, 'a_position');
        this.uMatrix = this.gl.getUniformLocation(this.program, 'u_matrix');
        this.uColor = this.gl.getUniformLocation(this.program, 'u_color');

        // Texture program (KAP raster)
        this.texProgram = this._createProgram(TEX_VERT_SRC, TEX_FRAG_SRC);
        this.texAPos = this.gl.getAttribLocation(this.texProgram, 'a_position');
        this.texATC = this.gl.getAttribLocation(this.texProgram, 'a_texCoord');
        this.texUMatrix = this.gl.getUniformLocation(this.texProgram, 'u_matrix');
        this.texUTex = this.gl.getUniformLocation(this.texProgram, 'u_texture');

        // View state
        this.cx = 0; this.cy = 0; // center in Mercator coords
        this.zoom = 1;
        this.colorScheme = 'day';
        this.chartData = null;     // last loaded S-57 data (backward compat)
        this.renderData = null;    // last loaded render data (backward compat)
        this.rasterLayers = [];    // KAP texture layers

        // Multi-chart support
        this.chartLayers = [];     // [{id, data, renderData, type:'s57'|'kap'}]
        this._globalExtent = null; // union of all chart extents

        // Text overlay
        this.textRenderer = typeof TextRenderer !== 'undefined' ?
            new TextRenderer(canvas.parentElement) : null;

        // Module integration hooks (set by main() after module init)
        this.symbolRenderer = null;
        this.aisDisplay = null;
        this.activeNav = null;
        this.safetyManager = null;

        // Interaction
        this._dragging = false;
        this._lastMouse = null;
        this._setupInteraction();
        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _createShader(type, source) {
        const gl = this.gl;
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(s));
            gl.deleteShader(s);
            return null;
        }
        return s;
    }

    _createProgram(vertSrc, fragSrc) {
        const gl = this.gl;
        const vs = this._createShader(gl.VERTEX_SHADER, vertSrc);
        const fs = this._createShader(gl.FRAGMENT_SHADER, fragSrc);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error(gl.getProgramInfoLog(prog));
        }
        return prog;
    }

    _resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.canvas.clientWidth * dpr;
        this.canvas.height = this.canvas.clientHeight * dpr;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        if (this.textRenderer) this.textRenderer.resize(this.canvas.width, this.canvas.height);
        this.render();
    }

    _setupInteraction() {
        const c = this.canvas;

        // ── Mouse pan ──
        c.addEventListener('mousedown', e => {
            this._dragging = true;
            this._lastMouse = [e.clientX, e.clientY];
        });
        window.addEventListener('mouseup', () => { this._dragging = false; });
        window.addEventListener('mousemove', e => {
            this._updateCursorInfo(e);
            if (!this._dragging || !this._lastMouse) return;
            const dx = e.clientX - this._lastMouse[0];
            const dy = e.clientY - this._lastMouse[1];
            const scale = this.zoom * Math.min(this.canvas.width, this.canvas.height) / 2;
            this.cx -= dx / scale;
            this.cy += dy / scale;
            this._lastMouse = [e.clientX, e.clientY];
            this.render();
            this._updateScaleBar();
        });

        // ── Wheel zoom (centered on cursor) ──
        c.addEventListener('wheel', e => {
            e.preventDefault();
            const delta = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
            const zoomSpeed = 0.002;
            const factor = Math.pow(2, -delta * zoomSpeed);

            // Zoom toward cursor position
            const rect = c.getBoundingClientRect();
            const nx = (e.clientX - rect.left) / rect.width * 2 - 1;  // -1..1
            const ny = -((e.clientY - rect.top) / rect.height * 2 - 1);
            const aspect = c.width / c.height;
            const sx = this.zoom * (aspect < 1 ? 1 : 1 / aspect);
            const sy = this.zoom * (aspect > 1 ? 1 : aspect);
            const worldX = nx / sx + this.cx;
            const worldY = ny / sy + this.cy;

            this.zoom *= factor;

            // Adjust center so worldX/worldY stays under cursor
            const sx2 = this.zoom * (aspect < 1 ? 1 : 1 / aspect);
            const sy2 = this.zoom * (aspect > 1 ? 1 : aspect);
            this.cx = worldX - nx / sx2;
            this.cy = worldY - ny / sy2;
            this.render();
            this._updateScaleBar();
        }, { passive: false });

        // ── Touch: pan + pinch-to-zoom ──
        let touches = [];
        let pinchDist = 0;

        c.addEventListener('touchstart', e => {
            e.preventDefault();
            touches = Array.from(e.touches);
            if (touches.length === 2) {
                pinchDist = Math.hypot(
                    touches[1].clientX - touches[0].clientX,
                    touches[1].clientY - touches[0].clientY
                );
            }
        }, { passive: false });

        c.addEventListener('touchmove', e => {
            e.preventDefault();
            const newTouches = Array.from(e.touches);

            if (newTouches.length === 1 && touches.length === 1) {
                // Single-finger pan
                const dx = newTouches[0].clientX - touches[0].clientX;
                const dy = newTouches[0].clientY - touches[0].clientY;
                const scale = this.zoom * Math.min(c.width, c.height) / 2;
                this.cx -= dx / scale;
                this.cy += dy / scale;
                this.render();
            } else if (newTouches.length === 2 && touches.length === 2) {
                // Pinch-to-zoom
                const newDist = Math.hypot(
                    newTouches[1].clientX - newTouches[0].clientX,
                    newTouches[1].clientY - newTouches[0].clientY
                );
                if (pinchDist > 0) {
                    const factor = newDist / pinchDist;
                    this.zoom *= factor;
                    this.render();
                }
                pinchDist = newDist;
            }
            touches = newTouches;
        }, { passive: false });

        c.addEventListener('touchend', e => {
            touches = Array.from(e.touches);
            pinchDist = 0;
        });

        // ── Button controls ──
        document.getElementById('zoom-in').addEventListener('click', () => {
            this.zoom *= 1.4; this.render(); this._updateScaleBar();
        });
        document.getElementById('zoom-out').addEventListener('click', () => {
            this.zoom /= 1.4; this.render(); this._updateScaleBar();
        });
        document.getElementById('reset-view').addEventListener('click', () => {
            if (this.chartData) this.fitExtent(this.chartData.extent);
        });

        // ── Double-click to zoom in ──
        c.addEventListener('dblclick', e => {
            e.preventDefault();
            const rect = c.getBoundingClientRect();
            const nx = (e.clientX - rect.left) / rect.width * 2 - 1;
            const ny = -((e.clientY - rect.top) / rect.height * 2 - 1);
            const aspect = c.width / c.height;
            const sx = this.zoom * (aspect < 1 ? 1 : 1 / aspect);
            const sy = this.zoom * (aspect > 1 ? 1 : aspect);
            // Center on the clicked point, then zoom in
            this.cx = nx / sx + this.cx;
            this.cy = ny / sy + this.cy;
            this.zoom *= 2;
            this.render();
            this._updateScaleBar();
        });

        // ── Keyboard shortcuts ──
        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            const panStep = 0.15 / this.zoom;
            switch (e.key) {
                case '+': case '=': this.zoom *= 1.3; this.render(); this._updateScaleBar(); break;
                case '-': case '_': this.zoom /= 1.3; this.render(); this._updateScaleBar(); break;
                case 'ArrowLeft':  this.cx -= panStep; this.render(); e.preventDefault(); break;
                case 'ArrowRight': this.cx += panStep; this.render(); e.preventDefault(); break;
                case 'ArrowUp':    this.cy += panStep; this.render(); e.preventDefault(); break;
                case 'ArrowDown':  this.cy -= panStep; this.render(); e.preventDefault(); break;
                case 'r': case 'R':
                    if (this.chartData) this.fitExtent(this.chartData.extent);
                    break;
                case 'n': case 'N':
                    const schemes = ['day', 'dusk', 'night'];
                    const idx = (schemes.indexOf(this.colorScheme) + 1) % schemes.length;
                    this.setColorScheme(schemes[idx]);
                    break;
                case 'f': case 'F':
                    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
                    else document.exitFullscreen();
                    break;
            }
        });
    }

    _updateCursorInfo(e) {
        if (!this.chartData) return;
        const rect = this.canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width * 2 - 1;
        const py = -((e.clientY - rect.top) / rect.height * 2 - 1);
        const aspect = this.canvas.width / this.canvas.height;
        const scaleX = this.zoom * (aspect < 1 ? 1 : 1 / aspect);
        const scaleY = this.zoom * (aspect > 1 ? 1 : aspect);
        const mx = px / scaleX + this.cx;
        const my = py / scaleY + this.cy;
        const lon = xToLon(mx);
        const lat = yToLat(my);
        const cursorEl = document.getElementById('info-cursor');
        if (cursorEl) cursorEl.textContent = formatDDM(lat, lon);
    }

    /** Update the scale bar overlay based on current zoom and center latitude */
    _updateScaleBar() {
        const bar = document.getElementById('scale-bar');
        const label = document.getElementById('scale-label');
        if (!bar || !this.chartData) return;

        const aspect = this.canvas.width / this.canvas.height;
        const scaleX = this.zoom * (aspect < 1 ? 1 : 1 / aspect);
        // How many Mercator units correspond to one pixel on screen?
        const mercPerPx = 2 / (scaleX * this.canvas.width);
        // Convert to meters at current latitude (nautical mile = 1852m)
        const lat = yToLat(this.cy);
        const metersPerMercUnit = 6371000 * Math.cos(lat * Math.PI / 180);
        const metersPerPx = mercPerPx * metersPerMercUnit;

        // Choose a nice round distance for a ~120px bar
        const targetPx = 120;
        const targetMeters = metersPerPx * targetPx;
        const nmTarget = targetMeters / 1852;

        // Nice round values in nautical miles, then km, then m
        const niceNm = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
        let bestNm = niceNm[0], bestLabel = '';
        for (const n of niceNm) {
            if (n <= nmTarget * 1.5) { bestNm = n; }
        }

        const barPx = (bestNm * 1852) / metersPerPx;
        if (bestNm >= 1) bestLabel = `${bestNm} nm`;
        else bestLabel = `${(bestNm * 1852).toFixed(0)} m`;

        bar.style.width = `${Math.round(barPx)}px`;
        label.textContent = bestLabel;

        // Also update zoom level display
        const zoomEl = document.getElementById('info-zoom');
        if (zoomEl) {
            const dpi96mPerPx = 0.000264583;
            const dpr = window.devicePixelRatio || 1;
            const chartScale = Math.round(metersPerPx / (dpi96mPerPx / dpr));
            if (chartScale > 0 && isFinite(chartScale)) {
                zoomEl.textContent = `1:${chartScale.toLocaleString()}`;
            }
        }
    }

    setColorScheme(scheme) {
        this.colorScheme = scheme;
        const cs = COLOR_SCHEMES[scheme];
        document.querySelector('header').style.background = cs.headerBg;
        document.querySelectorAll('.btn').forEach(b => { b.style.borderColor = cs.accent; b.style.color = cs.accent; });
        document.querySelector('header h1').style.color = cs.accent;
        const panel = document.getElementById('info-panel');
        if (panel) panel.style.background = cs.uiBg;
        document.getElementById('canvas-container').style.background =
            `rgb(${Math.round(cs.bg[0]*255)},${Math.round(cs.bg[1]*255)},${Math.round(cs.bg[2]*255)})`;
        this.render();
    }

    _getMatrix() {
        const aspect = this.canvas.width / this.canvas.height;
        const scaleX = this.zoom * (aspect < 1 ? 1 : 1 / aspect);
        const scaleY = this.zoom * (aspect > 1 ? 1 : aspect);
        // Column-major 3x3: scale, then translate
        return new Float32Array([
            scaleX, 0, 0,
            0, scaleY, 0,
            -this.cx * scaleX, -this.cy * scaleY, 1
        ]);
    }

    fitExtent(ext) {
        const x0 = lonToX(ext.minLon), x1 = lonToX(ext.maxLon);
        const y0 = latToY(ext.minLat), y1 = latToY(ext.maxLat);
        this.cx = (x0 + x1) / 2;
        this.cy = (y0 + y1) / 2;
        const dx = x1 - x0, dy = y1 - y0;
        const aspect = this.canvas.width / this.canvas.height;
        this.zoom = 1.8 / Math.max(dx * (aspect < 1 ? 1 : 1/aspect),
                                     dy * (aspect > 1 ? 1 : aspect));
        this.render();
        this._updateScaleBar();
    }

    loadChart(data) {
        this.chartData = data;
        const rd = this._buildRenderData(data);
        this.renderData = rd;

        // Multi-chart: add to chart layers
        const layerId = 'S57-' + (this.chartLayers.length + 1);
        this.chartLayers.push({ id: layerId, data, renderData: rd, type: 's57' });

        // Register with App.charts if available
        if (typeof App !== 'undefined' && App.charts) {
            App.charts.add(data, { id: layerId, type: 's57', name: data.name || layerId, scale: data.scale });
        }

        // Build feature index for hit-testing
        if (typeof App !== 'undefined' && App.featureIndex) {
            App.featureIndex.build(layerId, data);
        }

        // Build text labels for soundings, names, etc.
        if (this.textRenderer) this.textRenderer.buildLabels(data);

        // Update global extent
        this._expandExtent(data.extent);

        document.getElementById('info-panel').style.display = 'block';
        document.getElementById('info-scale').textContent = `1:${data.scale || '?'}`;
        document.getElementById('info-features').textContent =
            `${data.stats.polygonCount} areas, ${data.stats.lineCount} lines, ${data.stats.pointCount} points`;
        document.getElementById('info-extent').textContent =
            `${data.extent.minLat.toFixed(3)}°–${data.extent.maxLat.toFixed(3)}° N, ` +
            `${data.extent.minLon.toFixed(3)}°–${data.extent.maxLon.toFixed(3)}° E`;

        this.fitExtent(data.extent);
    }

    /**
     * Load a parsed KAP chart as a textured raster layer.
     * @param {KAPChart} kap - Parsed KAP chart from parseKAP()
     */
    loadKAPChart(kap) {
        const gl = this.gl;

        // Upload decoded image as WebGL texture (already downsampled by parser)
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, kap.outWidth, kap.outHeight, 0,
                      gl.RGBA, gl.UNSIGNED_BYTE, kap.imageData);

        // Build georeferenced quad using REF-derived corner coordinates
        let positions, texCoords;

        if (kap.corners) {
            // Use precise corner-to-Mercator mapping
            const { tl, tr, br, bl } = kap.corners;
            const tlx = lonToX(tl.lon), tly = latToY(tl.lat);
            const trx = lonToX(tr.lon), try_ = latToY(tr.lat);
            const brx = lonToX(br.lon), bry = latToY(br.lat);
            const blx = lonToX(bl.lon), bly = latToY(bl.lat);

            // 2 triangles: TL-BL-TR, TR-BL-BR
            positions = new Float32Array([
                tlx, tly,  blx, bly,  trx, try_,
                trx, try_,  blx, bly,  brx, bry,
            ]);
            texCoords = new Float32Array([
                0, 0,  0, 1,  1, 0,
                1, 0,  0, 1,  1, 1,
            ]);
        } else {
            // Fallback: use extent bounding box
            const ext = kap.extent;
            const x0 = lonToX(ext.minLon), x1 = lonToX(ext.maxLon);
            const y0 = latToY(ext.minLat), y1 = latToY(ext.maxLat);
            positions = new Float32Array([
                x0, y0,  x1, y0,  x0, y1,
                x0, y1,  x1, y0,  x1, y1,
            ]);
            texCoords = new Float32Array([
                0, 1,  1, 1,  0, 0,
                0, 0,  1, 1,  1, 0,
            ]);
        }

        const posVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posVBO);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        const tcVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, tcVBO);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        this.rasterLayers.push({ tex, posVBO, tcVBO, count: 6, name: kap.name });

        // Multi-chart: add to chart layers
        const layerId = 'KAP-' + kap.name;
        this.chartLayers.push({ id: layerId, data: kap, renderData: null, type: 'kap' });

        // Register with App.charts if available
        if (typeof App !== 'undefined' && App.charts) {
            App.charts.add(kap, { id: layerId, type: 'kap', name: kap.name, scale: kap.scale, extent: ext });
        }

        // Merge extent
        if (!this.chartData) this.chartData = {};
        this._expandExtent(ext);

        document.getElementById('info-panel').style.display = 'block';
        document.getElementById('info-scale').textContent = `1:${kap.scale || '?'}`;
        const dsInfo = kap.outWidth < kap.width ? ` (↓${Math.ceil(kap.width/kap.outWidth)}x)` : '';
        document.getElementById('info-features').textContent =
            `Raster ${kap.width}×${kap.height}px${dsInfo}, ${kap.palette.filter(Boolean).length} colors`;
        const fullExt = this._globalExtent || ext;
        document.getElementById('info-extent').textContent =
            `${fullExt.minLat.toFixed(3)}°–${fullExt.maxLat.toFixed(3)}° N, ` +
            `${fullExt.minLon.toFixed(3)}°–${fullExt.maxLon.toFixed(3)}° E`;

        this.fitExtent(this._globalExtent || ext);
    }

    _expandExtent(ext) {
        if (!ext) return;
        if (!this._globalExtent) {
            this._globalExtent = { ...ext };
        } else {
            const ge = this._globalExtent;
            ge.minLat = Math.min(ge.minLat, ext.minLat);
            ge.maxLat = Math.max(ge.maxLat, ext.maxLat);
            ge.minLon = Math.min(ge.minLon, ext.minLon);
            ge.maxLon = Math.max(ge.maxLon, ext.maxLon);
        }
        // Keep backward compat
        if (this.chartData) this.chartData.extent = { ...this._globalExtent };
    }

    /** Get depth-dependent color for DEPARE polygons based on safety settings */
    _getDepthColor(drval1, drval2, code) {
        const safetyDepth = (typeof App !== 'undefined') ? App.settings.get('safetyDepth') : 5;
        const shallowDepth = (typeof App !== 'undefined') ? App.settings.get('shallowDepth') : 2;
        const deepDepth = (typeof App !== 'undefined') ? App.settings.get('deepDepth') : 30;

        // Use getDepthColor from s52-styles if available
        if (typeof getDepthColor === 'function' && drval1 !== undefined && drval1 !== -999) {
            return getDepthColor(drval1);
        }

        // Fallback depth coloring
        const depth = (drval1 !== undefined && drval1 !== -999) ? drval1 : 
                      (drval2 !== undefined && drval2 !== -999) ? drval2 : null;
        if (depth === null) return null;

        if (depth < 0)              return [0.55, 0.75, 0.55, 1.0]; // drying area (green tint)
        if (depth < shallowDepth)   return [0.68, 0.85, 0.88, 1.0]; // very shallow (light cyan)
        if (depth < safetyDepth)    return [0.72, 0.88, 0.92, 1.0]; // shallow (light blue)
        if (depth < 10)             return [0.78, 0.90, 0.95, 1.0]; // medium shallow
        if (depth < deepDepth)      return [0.82, 0.92, 0.96, 1.0]; // medium
        return [0.88, 0.95, 0.98, 1.0];                              // deep (very light)
    }

    _buildRenderData(data) {
        const gl = this.gl;
        const rd = { polygons: [], lines: [], points: [] };

        // ── Polygons (triangulate with Earcut) ──
        if (data.polygons && data.polygons.classCodes.length > 0) {
            const coords = data.polygons.coords;
            const ringCounts = data.polygons.ringCounts;
            const ringSizes = data.polygons.ringSizes;
            const codes = data.polygons.classCodes;

            let coordIdx = 0, ringIdx = 0;
            for (let f = 0; f < codes.length; f++) {
                const nRings = ringCounts[f];
                const flatCoords = [];
                const holes = [];

                for (let r = 0; r < nRings; r++) {
                    const nPts = ringSizes[ringIdx + r];
                    if (r > 0) holes.push(flatCoords.length / 2);
                    for (let p = 0; p < nPts; p++) {
                        flatCoords.push(lonToX(coords[coordIdx]));
                        flatCoords.push(latToY(coords[coordIdx + 1]));
                        coordIdx += 2;
                    }
                }
                ringIdx += nRings;

                if (flatCoords.length >= 6) {
                    const indices = earcutFn(flatCoords, holes.length ? holes : undefined, 2);
                    if (indices.length > 0) {
                        const verts = new Float32Array(flatCoords);
                        const idx = new Uint16Array(indices);
                        const vbo = gl.createBuffer();
                        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
                        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
                        const ibo = gl.createBuffer();
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
                        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
                        const cls = S57_CLASSES[codes[f]];

                        // Depth-dependent coloring for DEPARE
                        let color = cls ? cls.color : DEFAULT_AREA_COLOR;
                        if (codes[f] === 42 || codes[f] === 32) { // DEPARE
                            const drval1 = data.polygons.drval1 ? data.polygons.drval1[f] : -999;
                            const drval2 = data.polygons.drval2 ? data.polygons.drval2[f] : -999;
                            const dc = this._getDepthColor(drval1, drval2, codes[f]);
                            if (dc) color = dc;
                        }

                        rd.polygons.push({
                            vbo, ibo, count: indices.length,
                            code: codes[f],
                            color
                        });
                    }
                }
            }
        }

        // ── Lines ──
        if (data.lines && data.lines.classCodes.length > 0) {
            const coords = data.lines.coords;
            const sizes = data.lines.lineSizes;
            const codes = data.lines.classCodes;
            let ci = 0;
            for (let f = 0; f < codes.length; f++) {
                const n = sizes[f];
                const verts = new Float32Array(n * 2);
                for (let i = 0; i < n; i++) {
                    verts[i * 2] = lonToX(coords[ci]);
                    verts[i * 2 + 1] = latToY(coords[ci + 1]);
                    ci += 2;
                }
                const vbo = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
                gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
                const cls = S57_CLASSES[codes[f]];
                rd.lines.push({
                    vbo, count: n,
                    code: codes[f],
                    color: cls ? cls.color : DEFAULT_LINE_COLOR
                });
            }
        }

        // ── Points (group by class for per-class rendering) ──
        if (data.points && data.points.classCodes.length > 0) {
            const coords = data.points.coords;
            const codes = data.points.classCodes;

            // Group points by class code
            const groups = {};
            for (let i = 0; i < codes.length; i++) {
                const code = codes[i];
                if (!groups[code]) groups[code] = [];
                groups[code].push(i);
            }

            for (const [codeStr, indices] of Object.entries(groups)) {
                const code = parseInt(codeStr);
                const verts = new Float32Array(indices.length * 2);
                for (let j = 0; j < indices.length; j++) {
                    const i = indices[j];
                    verts[j * 2] = lonToX(coords[i * 2]);
                    verts[j * 2 + 1] = latToY(coords[i * 2 + 1]);
                }
                const vbo = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
                gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
                const cls = S57_CLASSES[code];
                rd.points.push({
                    vbo, total: indices.length,
                    code,
                    color: cls ? cls.color : DEFAULT_POINT_COLOR
                });
            }
        }

        return rd;
    }

    render() {
        const gl = this.gl;
        if (!gl) return;

        const bg = COLOR_SCHEMES[this.colorScheme].bg;
        gl.clearColor(bg[0], bg[1], bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const matrix = this._getMatrix();

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // ── Raster layers (KAP) — draw first (under vectors) ──
        if (this.rasterLayers.length > 0) {
            gl.useProgram(this.texProgram);
            gl.enableVertexAttribArray(this.texAPos);
            gl.enableVertexAttribArray(this.texATC);
            gl.uniformMatrix3fv(this.texUMatrix, false, matrix);

            for (const layer of this.rasterLayers) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, layer.tex);
                gl.uniform1i(this.texUTex, 0);

                gl.bindBuffer(gl.ARRAY_BUFFER, layer.posVBO);
                gl.vertexAttribPointer(this.texAPos, 2, gl.FLOAT, false, 0, 0);

                gl.bindBuffer(gl.ARRAY_BUFFER, layer.tcVBO);
                gl.vertexAttribPointer(this.texATC, 2, gl.FLOAT, false, 0, 0);

                gl.drawArrays(gl.TRIANGLES, 0, layer.count);
            }

            gl.disableVertexAttribArray(this.texATC);
            gl.disableVertexAttribArray(this.texAPos);
        }

        // ── Vector layers (S-57) ──
        if (!this.renderData) return;

        gl.useProgram(this.program);
        gl.enableVertexAttribArray(this.aPos);
        gl.uniformMatrix3fv(this.uMatrix, false, matrix);

        // Draw polygons
        for (const poly of this.renderData.polygons) {
            gl.bindBuffer(gl.ARRAY_BUFFER, poly.vbo);
            gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
            // Use S-52 style if available, otherwise fallback
            const style = typeof getS52Style === 'function' ? getS52Style(poly.code) : null;
            const color = style && style.fill ? style.fill : poly.color;
            gl.uniform4fv(this.uColor, color);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, poly.ibo);
            gl.drawElements(gl.TRIANGLES, poly.count, gl.UNSIGNED_SHORT, 0);
        }

        // Draw lines
        for (const line of this.renderData.lines) {
            gl.bindBuffer(gl.ARRAY_BUFFER, line.vbo);
            gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
            const style = typeof getS52Style === 'function' ? getS52Style(line.code) : null;
            const color = style && style.color ? style.color : line.color;
            gl.uniform4fv(this.uColor, color);
            const lw = style && style.lineWidth ? style.lineWidth : 1;
            gl.lineWidth(lw);
            gl.drawArrays(gl.LINE_STRIP, 0, line.count);
        }
        gl.lineWidth(1);

        // Draw points (per-group with S-52 colors)
        for (const ptGroup of this.renderData.points) {
            gl.bindBuffer(gl.ARRAY_BUFFER, ptGroup.vbo);
            gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
            const style = typeof getS52Style === 'function' ? getS52Style(ptGroup.code) : null;
            const color = style && style.color ? style.color : (ptGroup.color || DEFAULT_POINT_COLOR);
            const ps = style && style.pointSize ? style.pointSize : 4;
            gl.uniform4fv(this.uColor, color);
            gl.drawArrays(gl.POINTS, 0, ptGroup.total);
        }

        gl.disableVertexAttribArray(this.aPos);

        // ── Text overlay (soundings, labels, light characteristics) ──
        if (this.textRenderer) {
            this.textRenderer.render(
                this.cx, this.cy, this.zoom,
                this.canvas.width, this.canvas.height,
                this.colorScheme
            );

            const ctx = this.textRenderer.ctx;
            const w = this.canvas.width, h = this.canvas.height;

            // Helper: lat/lon → screen coords (used by all overlay modules)
            const self = this;
            const toScreen = (lat, lon) => {
                const wx = lonToX(lon), wy = latToY(lat);
                const aspect = w / h;
                const sx = self.zoom * (aspect < 1 ? 1 : 1 / aspect);
                const sy = self.zoom * (aspect > 1 ? 1 : aspect);
                return {
                    x: ((wx - self.cx) * sx + 1) * 0.5 * w,
                    y: (1 - (wy - self.cy) * sy) * 0.5 * h
                };
            };

            // ── S-52 Procedural Symbols ──
            if (this.symbolRenderer && this.chartData && this.chartData.points) {
                const pts = this.chartData.points;
                const features = [];
                const n = pts.classCodes ? pts.classCodes.length : 0;
                for (let i = 0; i < n; i++) {
                    const lon = pts.coords[i * 2];
                    const lat = pts.coords[i * 2 + 1];
                    const scr = toScreen(lat, lon);
                    if (scr.x < -50 || scr.x > w + 50 || scr.y < -50 || scr.y > h + 50) continue;
                    const attrs = {};
                    if (pts.depths && pts.depths[i] !== -999) attrs.depth = pts.depths[i];
                    if (pts.names && pts.names[i]) attrs.OBJNAM = pts.names[i];
                    if (pts.colours && pts.colours[i] !== -1) attrs.COLOUR = pts.colours[i];
                    if (pts.boyshps && pts.boyshps[i] !== -1) attrs.BOYSHP = pts.boyshps[i];
                    if (pts.bcnshps && pts.bcnshps[i] !== -1) attrs.BCNSHP = pts.bcnshps[i];
                    if (pts.catlits && pts.catlits[i] !== -1) attrs.CATLIT = pts.catlits[i];
                    if (pts.catcams && pts.catcams[i] !== -1) attrs.CATCAM = pts.catcams[i];
                    if (pts.catlams && pts.catlams[i] !== -1) attrs.CATLAM = pts.catlams[i];
                    features.push({ code: pts.classCodes[i], x: scr.x, y: scr.y, attrs });
                }
                this.symbolRenderer.renderSymbols(ctx, features, this.zoom, this.colorScheme);
            }

            // ── AIS Target Display ──
            if (this.aisDisplay) {
                this.aisDisplay.render(ctx, toScreen, this.zoom, this.colorScheme);
            }

            // ── Active Navigation Overlay ──
            if (this.activeNav) {
                this.activeNav.renderActiveRoute(ctx, toScreen, this.zoom);
                this.activeNav.renderCDI(ctx, w, h);
            }

            // ── Safety Overlays (anchor watch, MOB, EBL, VRM, guard zones) ──
            if (this.safetyManager) {
                this.safetyManager.render(ctx, toScreen, this.zoom, this.colorScheme);
            }
        }
    }
}

// ── Application initialization ──
(async function main() {
    const status = document.getElementById('status');
    const loadBtn = document.getElementById('load-btn');
    const loadFolderBtn = document.getElementById('load-folder-btn');
    const fileInput = document.getElementById('file-input');
    const folderInput = document.getElementById('folder-input');
    const canvas = document.getElementById('chart-canvas');

    // Loading progress bar helpers
    const loadBar = document.getElementById('loading-bar');
    const loadBarInner = document.getElementById('loading-bar-inner');
    function showProgress(pct) {
        loadBar.style.display = 'block';
        loadBarInner.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }
    function hideProgress() {
        loadBarInner.style.width = '100%';
        setTimeout(() => { loadBar.style.display = 'none'; loadBarInner.style.width = '0%'; }, 300);
    }

    const renderer = new ChartRenderer(canvas);
    let chartCount = 0;

    // Load WASM module (for S-57 support)
    status.textContent = 'Loading WASM module…';
    showProgress(10);
    let Module;
    try {
        Module = await OpenCPNChart();
        showProgress(100);
        hideProgress();
        status.textContent = 'Ready — load chart file(s) or folder';
        loadBtn.disabled = false;
        loadFolderBtn.disabled = false;
    } catch (e) {
        console.warn('WASM load failed (KAP-only mode):', e.message);
        hideProgress();
        status.textContent = 'Ready — KAP-only mode';
        loadBtn.disabled = false;
        loadFolderBtn.disabled = false;
    }

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('[SW] Registered:', reg.scope))
            .catch(err => console.warn('[SW] Registration failed:', err));
    }

    loadBtn.addEventListener('click', () => fileInput.click());
    loadFolderBtn.addEventListener('click', () => folderInput.click());

    // ── Night mode button ──
    document.getElementById('night-mode').addEventListener('click', () => {
        const schemes = ['day', 'dusk', 'night'];
        const idx = (schemes.indexOf(renderer.colorScheme) + 1) % schemes.length;
        renderer.setColorScheme(schemes[idx]);
    });

    // ── Keyboard hints toggle ──
    const kbdHints = document.getElementById('kbd-hints');
    document.getElementById('kbd-toggle').addEventListener('click', () => {
        kbdHints.style.display = kbdHints.style.display === 'block' ? 'none' : 'block';
    });

    // ── Drag-and-drop ──
    const dropOverlay = document.getElementById('drop-overlay');
    let dragCounter = 0;

    document.addEventListener('dragenter', e => {
        e.preventDefault();
        dragCounter++;
        dropOverlay.classList.add('active');
    });
    document.addEventListener('dragleave', e => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('active'); }
    });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropOverlay.classList.remove('active');

        const items = Array.from(e.dataTransfer.files);
        const chartFiles = items.filter(f => {
            const ext = f.name.split('.').pop().toLowerCase();
            return ext === 'kap' || ext === '000';
        });

        if (chartFiles.length === 0) {
            status.textContent = 'No .kap or .000 files found in drop';
            return;
        }

        chartFiles.sort((a, b) => a.name.localeCompare(b.name));
        status.textContent = `Loading ${chartFiles.length} chart(s)…`;
        await new Promise(r => setTimeout(r, 30));

        let loaded = 0, failed = 0;
        const t0 = performance.now();
        for (const file of chartFiles) {
            try { await loadSingleFile(file, true); loaded++; }
            catch (err) { failed++; console.error(`Drop load fail: ${file.name}`, err); }
            status.textContent = `Loading ${loaded + failed}/${chartFiles.length}…`;
        }
        const elapsed = (performance.now() - t0).toFixed(0);
        status.textContent = `${loaded} chart(s) loaded in ${elapsed}ms` + (failed ? `, ${failed} failed` : '');
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await loadSingleFile(file);
        fileInput.value = '';
    });

    folderInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        const chartFiles = files.filter(f => {
            const ext = f.name.split('.').pop().toLowerCase();
            return ext === 'kap' || ext === '000';
        });

        if (chartFiles.length === 0) {
            status.textContent = 'No .kap or .000 files found in folder';
            return;
        }

        // Sort: KAP by name for consistent layering
        chartFiles.sort((a, b) => a.name.localeCompare(b.name));

        status.textContent = `Loading ${chartFiles.length} chart(s)…`;
        await new Promise(r => setTimeout(r, 50));

        let loaded = 0, failed = 0;
        const t0 = performance.now();

        for (const file of chartFiles) {
            try {
                await loadSingleFile(file, true);
                loaded++;
            } catch (err) {
                failed++;
                console.error(`Failed to load ${file.name}:`, err);
            }
            status.textContent = `Loading ${loaded + failed}/${chartFiles.length}…`;
        }

        const elapsed = (performance.now() - t0).toFixed(0);
        status.textContent = `${loaded} chart(s) loaded in ${elapsed}ms` +
            (failed ? `, ${failed} failed` : '');
        folderInput.value = '';
    });

    async function loadSingleFile(file, batch = false) {
        const ext = file.name.split('.').pop().toLowerCase();

        if (ext === 'kap') {
            await loadKAPFile(file, batch);
        } else {
            await loadS57File(file, batch);
        }
    }

    async function loadKAPFile(file, batch) {
        if (!batch) status.textContent = `Loading KAP: ${file.name}…`;
        const data = new Uint8Array(await file.arrayBuffer());

        if (!batch) {
            status.textContent = 'Decoding KAP…';
            await new Promise(r => setTimeout(r, 20));
        }

        const t0 = performance.now();
        const kap = parseKAP(data);
        const t1 = performance.now();

        console.log(`KAP decoded: ${file.name} ${kap.width}×${kap.height} in ${(t1 - t0).toFixed(0)}ms`);
        if (!batch) {
            status.textContent = `${file.name} — ${kap.width}×${kap.height}px, decoded in ${(t1-t0).toFixed(0)}ms`;
        }

        chartCount++;
        renderer.loadKAPChart(kap);
        updateChartCount();
    }

    async function loadS57File(file, batch) {
        if (!Module) {
            status.textContent = 'Error: WASM module not loaded (cannot parse S-57)';
            return;
        }
        if (!batch) status.textContent = `Loading ${file.name}…`;
        const data = new Uint8Array(await file.arrayBuffer());

        const filePath = '/' + file.name;
        Module.FS.writeFile(filePath, data);

        // Ensure CSV data files are in MEMFS
        for (const csvName of ['s57objectclasses.csv', 's57attributes.csv', 's57expectedinput.csv']) {
            try {
                Module.FS.stat('/' + csvName);
            } catch {
                try {
                    const resp = await fetch(csvName);
                    if (resp.ok) Module.FS.writeFile('/' + csvName, new Uint8Array(await resp.arrayBuffer()));
                } catch (err) { console.warn(`Could not load ${csvName}:`, err); }
            }
        }

        if (!batch) {
            status.textContent = 'Parsing chart…';
            await new Promise(r => setTimeout(r, 20));
        }

        const t0 = performance.now();
        const chartData = Module.parseChart(filePath, '/');
        const t1 = performance.now();

        if (!chartData || !chartData.extent) throw new Error('Empty parse result');

        console.log(`S-57 parsed: ${file.name} in ${(t1 - t0).toFixed(0)}ms`, chartData.stats);
        if (!batch) status.textContent = `${file.name} — parsed in ${(t1-t0).toFixed(0)}ms`;

        chartCount++;
        renderer.loadChart(chartData);
        updateChartCount();
    }

    function updateChartCount() {
        const el = document.getElementById('info-charts');
        if (el) el.textContent = chartCount;
    }

    // ══════════════════════════════════════════════════
    // Navigation features integration
    // ══════════════════════════════════════════════════

    const navState = {
        waypoints: [],
        routes: [],
        tracks: [],
        measureTool: typeof MeasureTool !== 'undefined' ? new MeasureTool() : null,
        activeRoute: null,
        mode: 'pan',  // 'pan' | 'measure' | 'route' | 'waypoint'
    };

    // Load saved data
    if (typeof NavStore !== 'undefined') {
        navState.waypoints = NavStore.loadWaypoints();
        navState.routes = NavStore.loadRoutes();
        navState.tracks = NavStore.loadTracks();
    }

    // Instrument panel
    const instrumentPanel = typeof InstrumentPanel !== 'undefined' ?
        new InstrumentPanel(document.getElementById('canvas-container')) : null;

    // NMEA parser (for future data input)
    const nmeaParser = typeof NMEAParser !== 'undefined' ? new NMEAParser() : null;
    if (instrumentPanel && nmeaParser) {
        instrumentPanel.startAutoUpdate(nmeaParser);
    }

    // Wire NMEA parser → App vessel state + AIS store
    if (nmeaParser && typeof App !== 'undefined') {
        App._nmeaParser = nmeaParser;
        nmeaParser.onSentence = (type, data) => {
            App.vessel.update(nmeaParser.state);
        };
    }

    // Wire AIS decoder → App AIS store
    const aisDecoder = typeof AISDecoder !== 'undefined' ? new AISDecoder() : null;
    if (aisDecoder && typeof App !== 'undefined') {
        aisDecoder.on('target-update', t => App.ais.update(t));
        aisDecoder.on('target-new', t => App.ais.update(t));
        aisDecoder.on('target-lost', t => App.ais.remove(t.mmsi));
        if (nmeaParser) {
            nmeaParser.onRaw = line => {
                if (line.startsWith('!AIVDM') || line.startsWith('!AIVDO')) {
                    aisDecoder.decode(line);
                }
            };
        }
    }

    // Initialize new modules
    const symbolRenderer = typeof SymbolRenderer !== 'undefined' ? new SymbolRenderer() : null;
    renderer.symbolRenderer = symbolRenderer;

    const aisDisplay = typeof AISDisplay !== 'undefined' ? new AISDisplay(App) : null;
    renderer.aisDisplay = aisDisplay;

    const activeNav = typeof ActiveNavigation !== 'undefined' ? new ActiveNavigation(App) : null;
    renderer.activeNav = activeNav;

    const safetyManager = typeof SafetyManager !== 'undefined' ? new SafetyManager(App) : null;
    renderer.safetyManager = safetyManager;

    // Connection manager
    const connManager = typeof ConnectionManager !== 'undefined' ? new ConnectionManager(App) : null;

    // Settings UI
    const settingsUI = typeof SettingsUI !== 'undefined' ? new SettingsUI(App, document.getElementById('canvas-container')) : null;
    const layersPanel = typeof LayersPanel !== 'undefined' ? new LayersPanel(App, document.getElementById('canvas-container')) : null;

    // Feature info panel (singleton object, not a class)
    const featureInfo = typeof FeatureInfoPanel !== 'undefined' ? FeatureInfoPanel : null;

    // Logbook (singleton object)
    const logbook = typeof Logbook !== 'undefined' ? Logbook : null;

    // Tides display (singleton object)
    const tidesDisplay = typeof TidesDisplay !== 'undefined' ? TidesDisplay : null;

    // GRIB overlay (singleton object)
    const gribOverlay = typeof GribOverlay !== 'undefined' ? GribOverlay : null;

    // Re-render when settings change
    if (typeof App !== 'undefined') {
        App.bus.on('setting-changed', () => renderer.render());
    }

    // ── Helper: screen coords → lat/lon ──
    function screenToLatLon(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const nx = (clientX - rect.left) / rect.width * 2 - 1;
        const ny = -((clientY - rect.top) / rect.height * 2 - 1);
        const aspect = canvas.width / canvas.height;
        const sx = renderer.zoom * (aspect < 1 ? 1 : 1 / aspect);
        const sy = renderer.zoom * (aspect > 1 ? 1 : aspect);
        return {
            lat: yToLat(ny / sy + renderer.cy),
            lon: xToLon(nx / sx + renderer.cx)
        };
    }

    // ── Measure tool ──
    const measureBtn = document.getElementById('measure-btn');
    const measureInfo = document.getElementById('measure-info');

    if (measureBtn) measureBtn.addEventListener('click', () => {
        if (navState.mode === 'measure') {
            navState.mode = 'pan';
            measureInfo.style.display = 'none';
            if (navState.measureTool) navState.measureTool.reset();
            measureBtn.style.background = '';
            canvas.style.cursor = '';
            renderer.render();
        } else {
            navState.mode = 'measure';
            measureInfo.style.display = 'block';
            measureBtn.style.background = '#53a8b6';
            canvas.style.cursor = 'crosshair';
        }
    });

    // ── Route creation ──
    const routeBtn = document.getElementById('route-btn');
    const routeInfo = document.getElementById('route-info');

    if (routeBtn) routeBtn.addEventListener('click', () => {
        if (navState.mode === 'route') {
            finishRoute();
        } else {
            navState.mode = 'route';
            navState.activeRoute = typeof Route !== 'undefined' ? new Route('Route ' + (navState.routes.length + 1)) : null;
            routeInfo.style.display = 'block';
            routeBtn.style.background = '#53a8b6';
            canvas.style.cursor = 'crosshair';
        }
    });

    function finishRoute() {
        if (navState.activeRoute && navState.activeRoute.waypoints && navState.activeRoute.waypoints.length >= 2) {
            navState.routes.push(navState.activeRoute);
            if (typeof NavStore !== 'undefined') NavStore.saveRoutes(navState.routes);
        }
        navState.activeRoute = null;
        navState.mode = 'pan';
        routeInfo.style.display = 'none';
        routeBtn.style.background = '';
        canvas.style.cursor = '';
        renderer.render();
    }

    // ── Instruments toggle ──
    const instrBtn = document.getElementById('instruments-btn');
    if (instrBtn && instrumentPanel) {
        instrBtn.addEventListener('click', () => instrumentPanel.toggle());
    }

    // ── GPX Import/Export ──
    const gpxImportBtn = document.getElementById('gpx-import-btn');
    const gpxExportBtn = document.getElementById('gpx-export-btn');
    const gpxInput = document.getElementById('gpx-input');

    if (gpxImportBtn) gpxImportBtn.addEventListener('click', () => gpxInput.click());
    if (gpxInput) gpxInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            if (typeof NavStore !== 'undefined') {
                const imported = NavStore.importGPX(text);
                navState.waypoints.push(...imported.waypoints);
                navState.routes.push(...imported.routes);
                navState.tracks.push(...imported.tracks);
                NavStore.saveWaypoints(navState.waypoints);
                NavStore.saveRoutes(navState.routes);
                NavStore.saveTracks(navState.tracks);
                status.textContent = `GPX: ${imported.waypoints.length} wpts, ${imported.routes.length} routes, ${imported.tracks.length} tracks`;
                renderer.render();
            }
        } catch (err) { status.textContent = 'GPX import failed: ' + err.message; }
        gpxInput.value = '';
    });

    if (gpxExportBtn) gpxExportBtn.addEventListener('click', () => {
        if (typeof NavStore !== 'undefined') {
            const gpx = NavStore.exportGPX(navState.waypoints, navState.routes, navState.tracks);
            const blob = new Blob([gpx], { type: 'application/gpx+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `opencpn-wasm-${new Date().toISOString().slice(0,10)}.gpx`;
            a.click();
            URL.revokeObjectURL(url);
            status.textContent = 'GPX exported';
        }
    });

    // ── Context menu ──
    const ctxMenu = document.getElementById('context-menu');
    let ctxLat = 0, ctxLon = 0;

    canvas.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (navState.mode === 'measure') {
            // Right-click finishes measurement
            navState.mode = 'pan';
            measureInfo.style.display = 'none';
            measureBtn.style.background = '';
            canvas.style.cursor = '';
            return;
        }
        if (navState.mode === 'route') {
            finishRoute();
            return;
        }
        const pos = screenToLatLon(e.clientX, e.clientY);
        ctxLat = pos.lat; ctxLon = pos.lon;
        ctxMenu.style.display = 'block';
        ctxMenu.style.left = e.clientX + 'px';
        ctxMenu.style.top = e.clientY + 'px';
    });

    document.addEventListener('click', () => { ctxMenu.style.display = 'none'; });

    ctxMenu.addEventListener('click', e => {
        const action = e.target.dataset?.action;
        if (!action) return;
        ctxMenu.style.display = 'none';

        switch (action) {
            case 'waypoint':
                if (typeof Waypoint !== 'undefined') {
                    const wp = new Waypoint(ctxLat, ctxLon, `WP${navState.waypoints.length + 1}`);
                    navState.waypoints.push(wp);
                    if (typeof NavStore !== 'undefined') NavStore.saveWaypoints(navState.waypoints);
                    status.textContent = `Waypoint ${wp.name} at ${formatDDM(ctxLat, ctxLon)}`;
                    renderer.render();
                }
                break;
            case 'measure-from':
                navState.mode = 'measure';
                if (navState.measureTool) {
                    navState.measureTool.reset();
                    navState.measureTool.addPoint(ctxLat, ctxLon);
                }
                measureInfo.style.display = 'block';
                measureBtn.style.background = '#53a8b6';
                canvas.style.cursor = 'crosshair';
                break;
            case 'route-from':
                navState.mode = 'route';
                navState.activeRoute = typeof Route !== 'undefined' ? new Route('Route ' + (navState.routes.length + 1)) : null;
                if (navState.activeRoute && typeof Waypoint !== 'undefined') {
                    const wp = new Waypoint(ctxLat, ctxLon, 'WP1');
                    navState.activeRoute.addWaypoint(wp);
                }
                routeInfo.style.display = 'block';
                routeBtn.style.background = '#53a8b6';
                canvas.style.cursor = 'crosshair';
                updateRouteInfo();
                break;
            case 'copy-coords':
                navigator.clipboard?.writeText(`${ctxLat.toFixed(6)}, ${ctxLon.toFixed(6)}`);
                status.textContent = 'Coordinates copied';
                break;
            case 'chart-info':
                if (renderer.chartData) {
                    const d = renderer.chartData;
                    status.textContent = `Scale 1:${d.scale || '?'}, ${d.stats?.polygonCount || 0} areas, ${d.stats?.lineCount || 0} lines, ${d.stats?.pointCount || 0} pts`;
                }
                break;
            case 'anchor-here':
                if (safetyManager) {
                    safetyManager.setAnchor(ctxLat, ctxLon);
                    status.textContent = `Anchor watch set at ${formatDDM(ctxLat, ctxLon)}`;
                    renderer.render();
                }
                break;
            case 'ebl-here':
                if (safetyManager && typeof App !== 'undefined' && App.vessel.hasPosition) {
                    const brg = typeof gcBearing === 'function' ?
                        gcBearing(App.vessel.lat, App.vessel.lon, ctxLat, ctxLon) : 0;
                    safetyManager.addEBL(brg);
                    status.textContent = `EBL set at ${brg.toFixed(0)}°T`;
                    renderer.render();
                }
                break;
            case 'feature-query':
                if (featureInfo) {
                    const rect = canvas.getBoundingClientRect();
                    featureInfo.show(ctxLat, ctxLon, rect.left + rect.width / 2, rect.top + rect.height / 2);
                }
                break;
            case 'center-here': {
                renderer.cx = lonToX(ctxLon);
                renderer.cy = latToY(ctxLat);
                renderer.render();
                renderer._updateScaleBar();
                break;
            }
        }
    });

    // ── Canvas click handler for measure/route/waypoint modes ──
    canvas.addEventListener('click', e => {
        if (navState.mode === 'pan') return;
        const pos = screenToLatLon(e.clientX, e.clientY);

        if (navState.mode === 'measure' && navState.measureTool) {
            navState.measureTool.addPoint(pos.lat, pos.lon);
            updateMeasureInfo();
            renderer.render();
        }

        if (navState.mode === 'route' && navState.activeRoute && typeof Waypoint !== 'undefined') {
            const wp = new Waypoint(pos.lat, pos.lon, `WP${navState.activeRoute.waypoints.length + 1}`);
            navState.activeRoute.addWaypoint(wp);
            updateRouteInfo();
            renderer.render();
        }
    });

    function updateMeasureInfo() {
        const mt = navState.measureTool;
        if (!mt) return;
        const dist = mt.totalDistance();
        const legs = mt.legs();
        document.getElementById('measure-dist').textContent =
            typeof formatDistance === 'function' ? formatDistance(dist) : dist.toFixed(2) + ' NM';
        document.getElementById('measure-brg').textContent =
            legs.length > 0 ? (typeof formatBearing === 'function' ?
                formatBearing(legs[legs.length - 1].bearing) :
                legs[legs.length - 1].bearing.toFixed(0) + '°') : '—';
        document.getElementById('measure-legs').textContent = legs.length;
    }

    function updateRouteInfo() {
        const rt = navState.activeRoute;
        if (!rt) return;
        document.getElementById('route-name').textContent = rt.name;
        document.getElementById('route-dist').textContent =
            typeof formatDistance === 'function' ? formatDistance(rt.totalDistance()) : rt.totalDistance().toFixed(2) + ' NM';
        document.getElementById('route-wps').textContent = rt.waypoints.length;
    }

    // ── Render navigation overlay (waypoints, routes, tracks, measure) ──
    const origRender = renderer.render.bind(renderer);
    renderer.render = function() {
        origRender();
        renderNavOverlay();
    };

    function renderNavOverlay() {
        if (!renderer.textRenderer) return;
        const ctx = renderer.textRenderer.ctx;
        if (!ctx) return;
        const w = renderer.canvas.width, h = renderer.canvas.height;

        function toScreen(lat, lon) {
            const wx = lonToX(lon), wy = latToY(lat);
            const aspect = w / h;
            const sx = renderer.zoom * (aspect < 1 ? 1 : 1 / aspect);
            const sy = renderer.zoom * (aspect > 1 ? 1 : aspect);
            return {
                x: ((wx - renderer.cx) * sx + 1) * 0.5 * w,
                y: (1 - (wy - renderer.cy) * sy) * 0.5 * h
            };
        }

        // Draw saved routes
        for (const route of navState.routes) {
            if (!route.visible && route.visible !== undefined) continue;
            const wps = route.waypoints;
            if (wps.length < 2) continue;
            ctx.beginPath();
            const p0 = toScreen(wps[0].lat, wps[0].lon);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < wps.length; i++) {
                const p = toScreen(wps[i].lat, wps[i].lon);
                ctx.lineTo(p.x, p.y);
            }
            ctx.strokeStyle = route.color || '#ff6600';
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 4]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Route waypoint markers
            for (const wp of wps) {
                const p = toScreen(wp.lat, wp.lon);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#ff6600';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }

        // Draw active route being created
        if (navState.activeRoute && navState.activeRoute.waypoints.length > 0) {
            const wps = navState.activeRoute.waypoints;
            ctx.beginPath();
            const p0 = toScreen(wps[0].lat, wps[0].lon);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < wps.length; i++) {
                const p = toScreen(wps[i].lat, wps[i].lon);
                ctx.lineTo(p.x, p.y);
            }
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 3]);
            ctx.stroke();
            ctx.setLineDash([]);

            for (const wp of wps) {
                const p = toScreen(wp.lat, wp.lon);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#00ff88';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }

        // Draw standalone waypoints
        for (const wp of navState.waypoints) {
            const p = toScreen(wp.lat, wp.lon);
            // Diamond shape
            ctx.beginPath();
            ctx.moveTo(p.x, p.y - 8);
            ctx.lineTo(p.x + 6, p.y);
            ctx.lineTo(p.x, p.y + 8);
            ctx.lineTo(p.x - 6, p.y);
            ctx.closePath();
            ctx.fillStyle = 'rgba(255,100,0,0.8)';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Label
            ctx.font = '10px sans-serif';
            ctx.fillStyle = '#ff8800';
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.lineWidth = 2;
            ctx.textAlign = 'center';
            ctx.strokeText(wp.name, p.x, p.y - 12);
            ctx.fillText(wp.name, p.x, p.y - 12);
        }

        // Draw measure tool
        if (navState.measureTool && navState.measureTool.points.length > 0) {
            const pts = navState.measureTool.points;
            ctx.beginPath();
            const p0 = toScreen(pts[0].lat, pts[0].lon);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < pts.length; i++) {
                const p = toScreen(pts[i].lat, pts[i].lon);
                ctx.lineTo(p.x, p.y);
            }
            ctx.strokeStyle = '#ff0066';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Distance labels per leg
            const legs = navState.measureTool.legs();
            for (let i = 0; i < legs.length; i++) {
                const pa = toScreen(legs[i].from.lat, legs[i].from.lon);
                const pb = toScreen(legs[i].to.lat, legs[i].to.lon);
                const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
                const text = typeof formatDistance === 'function' ?
                    formatDistance(legs[i].dist) : legs[i].dist.toFixed(2) + ' NM';
                ctx.font = 'bold 10px sans-serif';
                ctx.fillStyle = '#ff0066';
                ctx.strokeStyle = 'rgba(0,0,0,0.7)';
                ctx.lineWidth = 3;
                ctx.textAlign = 'center';
                ctx.strokeText(text, mx, my - 6);
                ctx.fillText(text, mx, my - 6);
            }

            // Point markers
            for (const pt of pts) {
                const p = toScreen(pt.lat, pt.lon);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#ff0066';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        // Draw tracks
        for (const track of navState.tracks) {
            if (track.points.length < 2) continue;
            ctx.beginPath();
            const p0 = toScreen(track.points[0].lat, track.points[0].lon);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < track.points.length; i++) {
                const p = toScreen(track.points[i].lat, track.points[i].lon);
                ctx.lineTo(p.x, p.y);
            }
            ctx.strokeStyle = track.color || '#00aaff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    // ── Keyboard shortcut additions for navigation ──
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        switch (e.key.toLowerCase()) {
            case 'm':
                measureBtn?.click();
                break;
            case 'w':
                if (renderer.chartData) {
                    const lat = yToLat(renderer.cy);
                    const lon = xToLon(renderer.cx);
                    if (typeof Waypoint !== 'undefined') {
                        const wp = new Waypoint(lat, lon, `WP${navState.waypoints.length + 1}`);
                        navState.waypoints.push(wp);
                        if (typeof NavStore !== 'undefined') NavStore.saveWaypoints(navState.waypoints);
                        status.textContent = `Waypoint ${wp.name} at ${formatDDM(lat, lon)}`;
                        renderer.render();
                    }
                }
                break;
            case 'escape':
                if (navState.mode === 'measure') {
                    navState.mode = 'pan';
                    if (navState.measureTool) navState.measureTool.reset();
                    measureInfo.style.display = 'none';
                    measureBtn.style.background = '';
                    canvas.style.cursor = '';
                    renderer.render();
                } else if (navState.mode === 'route') {
                    finishRoute();
                }
                break;
            case 'l':
                layersPanel?.toggle();
                break;
            case 's':
                if (e.ctrlKey || e.metaKey) break; // Don't hijack browser save
                settingsUI?.toggle();
                break;
            case 'a':
                aisDisplay?.showTargetList();
                break;
            case 'o':
                if (safetyManager) {
                    safetyManager.triggerMOB();
                    status.textContent = '🆘 MOB DROPPED!';
                    renderer.render();
                }
                break;
        }
    });

    // ── New toolbar button handlers ──
    const aisBtn = document.getElementById('ais-btn');
    if (aisBtn && aisDisplay) {
        aisBtn.addEventListener('click', () => aisDisplay.showTargetList());
    }

    const anchorBtn = document.getElementById('anchor-btn');
    if (anchorBtn && safetyManager) {
        anchorBtn.addEventListener('click', () => {
            if (safetyManager.anchorWatch && safetyManager.anchorWatch.active) {
                safetyManager.clearAnchor();
                anchorBtn.style.background = '';
                status.textContent = 'Anchor watch cleared';
            } else if (typeof App !== 'undefined' && App.vessel.hasPosition) {
                safetyManager.setAnchor(App.vessel.lat, App.vessel.lon);
                anchorBtn.style.background = '#53a8b6';
                status.textContent = 'Anchor watch set at vessel position';
            } else {
                status.textContent = 'No GPS position — use right-click to set anchor';
            }
            renderer.render();
        });
    }

    const mobBtn = document.getElementById('mob-btn');
    if (mobBtn && safetyManager) {
        mobBtn.addEventListener('click', () => {
            if (safetyManager.mob) {
                safetyManager.clearMOB();
                mobBtn.style.background = '';
                status.textContent = 'MOB cleared';
            } else {
                safetyManager.triggerMOB();
                mobBtn.style.background = '#ff3333';
                status.textContent = '🆘 MAN OVERBOARD!';
            }
            renderer.render();
        });
    }

    const layersBtn = document.getElementById('layers-btn');
    if (layersBtn && layersPanel) {
        layersBtn.addEventListener('click', () => layersPanel.toggle());
    }

    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn && settingsUI) {
        settingsBtn.addEventListener('click', () => settingsUI.toggle());
    }

    const connectionsBtn = document.getElementById('connections-btn');
    if (connectionsBtn && connManager) {
        connectionsBtn.addEventListener('click', () => connManager.renderPanel(document.getElementById('canvas-container')));
    }

    const tidesBtn = document.getElementById('tides-btn');
    if (tidesBtn && tidesDisplay) {
        tidesBtn.addEventListener('click', () => tidesDisplay.showTidePanel(document.getElementById('canvas-container')));
    }

    const logbookBtn = document.getElementById('logbook-btn');
    if (logbookBtn && logbook) {
        logbookBtn.addEventListener('click', () => logbook.showPanel(document.getElementById('canvas-container')));
    }

    const recordBtn = document.getElementById('record-btn');
    if (recordBtn && activeNav) {
        recordBtn.addEventListener('click', () => {
            if (activeNav.isRecording) {
                activeNav.stopRecording();
                recordBtn.style.background = '';
                recordBtn.style.color = '';
                status.textContent = 'Track recording stopped';
            } else {
                activeNav.startRecording(10);
                recordBtn.style.background = '#ff3333';
                recordBtn.style.color = '#fff';
                status.textContent = 'Recording track…';
            }
        });
    }

    const printBtn = document.getElementById('print-btn');
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            renderer.render();
            const link = document.createElement('a');
            link.download = `opencpn-chart-${new Date().toISOString().slice(0,10)}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            status.textContent = 'Chart exported as PNG';
        });
    }

    // ── GRIB file loading ──
    const gribInput = document.getElementById('grib-input');
    if (gribInput && gribOverlay) {
        document.addEventListener('drop', async (e) => {
            const files = Array.from(e.dataTransfer?.files || []);
            const gribFiles = files.filter(f => /\.(grb|grib|grib2)$/i.test(f.name));
            for (const f of gribFiles) {
                try {
                    const buf = await f.arrayBuffer();
                    gribOverlay.loadFile(buf);
                    status.textContent = `GRIB loaded: ${f.name}`;
                } catch (err) { console.error('GRIB load error:', err); }
            }
        });
    }

    // ── Click handler for feature info ──
    canvas.addEventListener('click', e => {
        if (navState.mode !== 'pan') return; // Don't interfere with measure/route modes
        if (featureInfo && e.shiftKey) {
            const pos = screenToLatLon(e.clientX, e.clientY);
            featureInfo.show(pos.lat, pos.lon, e.clientX, e.clientY);
        }
        // AIS target click
        if (aisDisplay && !e.shiftKey) {
            const rect = canvas.getBoundingClientRect();
            const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
            const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
            const hit = aisDisplay.hitTest(sx, sy);
            if (hit) aisDisplay.showTargetInfo(hit.mmsi);
        }
    }, true);
})();
