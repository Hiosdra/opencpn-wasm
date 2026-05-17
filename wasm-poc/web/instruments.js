/**
 * instruments.js — Dashboard instruments panel for OpenCPN WASM.
 *
 * Displays: SOG, COG, HDG, depth, wind, position, GPS status.
 * Reads from NMEAParser state. Updates at configurable rate.
 */

(function() {
'use strict';

const INSTRUMENT_DEFS = {
    sog:    { label: 'SOG',      unit: 'kn',  format: v => v.toFixed(1), key: 'sog' },
    cog:    { label: 'COG',      unit: '°T',  format: v => v.toFixed(0).padStart(3, '0'), key: 'cog' },
    hdg:    { label: 'HDG',      unit: '°T',  format: v => v.toFixed(0).padStart(3, '0'), key: 'hdg' },
    depth:  { label: 'Depth',    unit: 'm',   format: v => v.toFixed(1), key: 'depth' },
    windSp: { label: 'Wind',     unit: 'kn',  format: v => v.toFixed(0), key: 'windSpeedKn' },
    windDir:{ label: 'Wind Dir', unit: '°T',  format: v => v.toFixed(0).padStart(3, '0'), key: 'windDirTrue' },
    lat:    { label: 'Lat',      unit: '',    format: v => formatDDM(v, true), key: 'lat' },
    lon:    { label: 'Lon',      unit: '',    format: v => formatDDM(v, false), key: 'lon' },
    alt:    { label: 'Alt',      unit: 'm',   format: v => v.toFixed(0), key: 'altitude' },
    sats:   { label: 'Sats',     unit: '',    format: v => String(v), key: 'satellites' },
};

function formatDDM(val, isLat) {
    const abs = Math.abs(val);
    const deg = Math.floor(abs);
    const min = (abs - deg) * 60;
    const dir = isLat ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
    return `${deg}°${min.toFixed(2)}'${dir}`;
}

class InstrumentPanel {
    constructor(container) {
        this.container = container;
        this.panel = document.createElement('div');
        this.panel.id = 'instrument-panel';
        this.panel.style.cssText = `
            position: absolute; top: 60px; left: 16px; z-index: 15;
            background: rgba(22,33,62,0.92); border: 1px solid rgba(83,168,182,0.3);
            border-radius: 6px; padding: 8px; display: none;
            font-family: 'Courier New', monospace; font-size: 13px;
            color: #e0e0e0; min-width: 180px; user-select: none;
        `;
        container.appendChild(this.panel);

        this.instruments = ['sog', 'cog', 'hdg', 'depth', 'lat', 'lon', 'sats'];
        this.elements = {};
        this._build();
        this._updateInterval = null;
        this.visible = false;
    }

    _build() {
        this.panel.innerHTML = '';
        const title = document.createElement('div');
        title.style.cssText = 'color:#53a8b6;font-weight:bold;margin-bottom:6px;font-size:11px;';
        title.textContent = '📊 INSTRUMENTS';
        this.panel.appendChild(title);

        for (const key of this.instruments) {
            const def = INSTRUMENT_DEFS[key];
            if (!def) continue;

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.05);';

            const lbl = document.createElement('span');
            lbl.style.color = '#53a8b6';
            lbl.textContent = def.label;

            const val = document.createElement('span');
            val.style.cssText = 'font-weight:bold;min-width:80px;text-align:right;';
            val.textContent = '---';

            row.appendChild(lbl);
            row.appendChild(val);
            this.panel.appendChild(row);
            this.elements[key] = val;
        }
    }

    show() {
        this.visible = true;
        this.panel.style.display = 'block';
    }

    hide() {
        this.visible = false;
        this.panel.style.display = 'none';
    }

    toggle() {
        this.visible ? this.hide() : this.show();
    }

    /**
     * Update from NMEA parser state or manual data.
     * @param {Object} state — { sog, cog, hdg, depth, lat, lon, satellites, ... }
     */
    update(state) {
        if (!this.visible || !state) return;

        for (const key of this.instruments) {
            const def = INSTRUMENT_DEFS[key];
            const el = this.elements[key];
            if (!def || !el) continue;

            const val = state[def.key];
            if (val !== undefined && val !== null && !isNaN(val)) {
                el.textContent = def.format(val) + (def.unit ? ` ${def.unit}` : '');
                el.style.color = '#e0e0e0';
            } else {
                el.textContent = '---';
                el.style.color = '#555';
            }
        }
    }

    /**
     * Start auto-updating from an NMEAParser instance.
     */
    startAutoUpdate(parser, intervalMs = 1000) {
        this.stopAutoUpdate();
        this._updateInterval = setInterval(() => {
            if (parser && typeof parser.getState === 'function') {
                this.update(parser.getState());
            }
        }, intervalMs);
    }

    stopAutoUpdate() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
            this._updateInterval = null;
        }
    }

    setColorScheme(scheme) {
        const schemes = {
            day:   { bg: 'rgba(240,240,235,0.92)', border: 'rgba(100,100,100,0.3)', text: '#333', accent: '#0066aa', val: '#111' },
            dusk:  { bg: 'rgba(60,40,30,0.92)', border: 'rgba(150,100,60,0.3)', text: '#ddc', accent: '#cc8844', val: '#eedd88' },
            night: { bg: 'rgba(40,0,0,0.92)', border: 'rgba(100,30,30,0.3)', text: '#aa5555', accent: '#cc3333', val: '#ff6666' },
        };
        const s = schemes[scheme] || schemes.day;
        this.panel.style.background = s.bg;
        this.panel.style.borderColor = s.border;
        this.panel.style.color = s.val;
        const labels = this.panel.querySelectorAll('span:first-child');
        labels.forEach(l => l.style.color = s.accent);
    }
}

window.InstrumentPanel = InstrumentPanel;

})();
