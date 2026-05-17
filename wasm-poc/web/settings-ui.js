/**
 * settings-ui.js — Settings dialog and layers panel for OpenCPN WASM.
 *
 * Provides: SettingsUI (tabbed settings dialog), LayersPanel (quick toggles).
 *
 * Depends on: window.App (bus, settings), window.ConnectionManager (optional)
 */
(function() {
'use strict';

const PANEL_STYLES = `
    .ocpn-panel {
        background: rgba(22,33,62,0.95);
        border: 1px solid rgba(83,168,182,0.3);
        border-radius: 6px;
        color: #e0e0e0;
        font-family: sans-serif;
        font-size: 13px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .ocpn-panel-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid rgba(83,168,182,0.2);
    }
    .ocpn-panel-header h2 {
        margin: 0; font-size: 15px; color: #53a8b6; font-weight: 600;
    }
    .ocpn-panel-close {
        background: none; border: none; color: #888; font-size: 18px;
        cursor: pointer; padding: 0 4px; line-height: 1;
    }
    .ocpn-panel-close:hover { color: #e0e0e0; }

    .ocpn-tabs {
        display: flex; border-bottom: 1px solid rgba(83,168,182,0.2);
        padding: 0 8px;
    }
    .ocpn-tab {
        padding: 8px 14px; cursor: pointer; font-size: 12px;
        color: #888; border-bottom: 2px solid transparent;
        transition: color 0.15s, border-color 0.15s;
    }
    .ocpn-tab:hover { color: #c0c0c0; }
    .ocpn-tab.active { color: #53a8b6; border-bottom-color: #53a8b6; }

    .ocpn-tab-content { padding: 14px; display: none; max-height: 400px; overflow-y: auto; }
    .ocpn-tab-content.active { display: block; }

    .ocpn-field { margin-bottom: 10px; }
    .ocpn-field label {
        display: block; font-size: 11px; color: #999;
        margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .ocpn-field input[type="number"],
    .ocpn-field input[type="text"] {
        background: rgba(0,0,0,0.3); border: 1px solid rgba(83,168,182,0.3);
        color: #e0e0e0; padding: 5px 8px; border-radius: 3px;
        width: 100px; font-size: 13px;
    }
    .ocpn-field input[type="number"]:focus,
    .ocpn-field input[type="text"]:focus {
        outline: none; border-color: #53a8b6;
    }
    .ocpn-field input[type="range"] {
        width: 140px; accent-color: #53a8b6;
    }

    .ocpn-radio-group { display: flex; gap: 12px; flex-wrap: wrap; }
    .ocpn-radio-group label {
        display: flex; align-items: center; gap: 4px;
        font-size: 12px; color: #ccc; cursor: pointer;
        text-transform: none; letter-spacing: 0;
    }
    .ocpn-radio-group input[type="radio"] { accent-color: #53a8b6; }

    .ocpn-checkbox-group { display: flex; flex-direction: column; gap: 6px; }
    .ocpn-checkbox-group label {
        display: flex; align-items: center; gap: 6px;
        font-size: 12px; color: #ccc; cursor: pointer;
        text-transform: none; letter-spacing: 0;
    }
    .ocpn-checkbox-group input[type="checkbox"] { accent-color: #53a8b6; }

    .ocpn-range-row {
        display: flex; align-items: center; gap: 8px;
    }
    .ocpn-range-value {
        font-size: 12px; color: #53a8b6; min-width: 30px;
    }

    /* Layers panel */
    .ocpn-layers {
        padding: 10px 12px;
    }
    .ocpn-layers h3 {
        margin: 0 0 8px 0; font-size: 13px; color: #53a8b6;
    }
    .ocpn-layer-toggle {
        display: flex; align-items: center; gap: 8px;
        padding: 4px 0; cursor: pointer;
    }
    .ocpn-layer-toggle input[type="checkbox"] { accent-color: #53a8b6; }
    .ocpn-layer-toggle span { font-size: 12px; color: #ccc; }
`;

// ══════════════════════════════════════════════════════════════
// SettingsUI — Tabbed settings dialog
// ══════════════════════════════════════════════════════════════
class SettingsUI {
    constructor(app, container) {
        this._app = app;
        this._container = container;
        this._el = null;
        this._visible = false;
        this._activeTab = 'safety';
    }

    show() {
        if (this._visible) return;
        this._visible = true;
        this._render();
    }

    hide() {
        if (!this._visible) return;
        this._visible = false;
        if (this._el) {
            this._el.remove();
            this._el = null;
        }
    }

    toggle() {
        this._visible ? this.hide() : this.show();
    }

    _render() {
        if (this._el) this._el.remove();

        const el = document.createElement('div');
        el.className = 'ocpn-panel ocpn-settings-dialog';
        el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:420px;max-width:90vw;z-index:10000;';

        el.innerHTML = `
            <style>${PANEL_STYLES}</style>
            <div class="ocpn-panel-header">
                <h2>Settings</h2>
                <button class="ocpn-panel-close" title="Close">&times;</button>
            </div>
            <div class="ocpn-tabs">
                <div class="ocpn-tab${this._activeTab === 'safety' ? ' active' : ''}" data-tab="safety">Safety</div>
                <div class="ocpn-tab${this._activeTab === 'display' ? ' active' : ''}" data-tab="display">Display</div>
                <div class="ocpn-tab${this._activeTab === 'navigation' ? ' active' : ''}" data-tab="navigation">Navigation</div>
                <div class="ocpn-tab${this._activeTab === 'connections' ? ' active' : ''}" data-tab="connections">Connections</div>
            </div>
            <div class="ocpn-tab-content${this._activeTab === 'safety' ? ' active' : ''}" data-content="safety">
                ${this._renderSafety()}
            </div>
            <div class="ocpn-tab-content${this._activeTab === 'display' ? ' active' : ''}" data-content="display">
                ${this._renderDisplay()}
            </div>
            <div class="ocpn-tab-content${this._activeTab === 'navigation' ? ' active' : ''}" data-content="navigation">
                ${this._renderNavigation()}
            </div>
            <div class="ocpn-tab-content${this._activeTab === 'connections' ? ' active' : ''}" data-content="connections">
                <div id="settings-connections-container"></div>
            </div>
        `;

        this._container.appendChild(el);
        this._el = el;

        // Tab switching
        el.querySelectorAll('.ocpn-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                el.querySelectorAll('.ocpn-tab').forEach(t => t.classList.remove('active'));
                el.querySelectorAll('.ocpn-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const content = el.querySelector(`[data-content="${tab.dataset.tab}"]`);
                if (content) content.classList.add('active');
                this._activeTab = tab.dataset.tab;
            });
        });

        // Close button
        el.querySelector('.ocpn-panel-close').addEventListener('click', () => this.hide());

        // Bind inputs
        this._bindInputs(el);

        // Render connections panel
        const connContainer = el.querySelector('#settings-connections-container');
        if (connContainer && window.ConnectionManager && this._app._connectionManager) {
            this._app._connectionManager.renderPanel(connContainer);
        } else if (connContainer) {
            connContainer.innerHTML = '<p style="color:#888;font-size:12px;">No connection manager available.</p>';
        }
    }

    _renderSafety() {
        const s = this._app.settings;
        return `
            <div class="ocpn-field">
                <label>Safety Depth (m)</label>
                <input type="number" data-setting="safetyDepth" value="${s.get('safetyDepth')}" min="0" step="0.5"/>
            </div>
            <div class="ocpn-field">
                <label>Shallow Depth Contour (m)</label>
                <input type="number" data-setting="shallowDepth" value="${s.get('shallowDepth')}" min="0" step="0.5"/>
            </div>
            <div class="ocpn-field">
                <label>Deep Depth Contour (m)</label>
                <input type="number" data-setting="deepDepth" value="${s.get('deepDepth')}" min="0" step="1"/>
            </div>
            <div class="ocpn-field">
                <label>Safety Contour (m)</label>
                <input type="number" data-setting="safetyContour" value="${s.get('safetyContour')}" min="0" step="0.5"/>
            </div>
        `;
    }

    _renderDisplay() {
        const s = this._app.settings;
        return `
            <div class="ocpn-field">
                <label>Units</label>
                <div class="ocpn-radio-group">
                    <label><input type="radio" name="units" value="nautical" ${s.get('units') === 'nautical' ? 'checked' : ''}/> Nautical</label>
                    <label><input type="radio" name="units" value="metric" ${s.get('units') === 'metric' ? 'checked' : ''}/> Metric</label>
                    <label><input type="radio" name="units" value="imperial" ${s.get('units') === 'imperial' ? 'checked' : ''}/> Imperial</label>
                </div>
            </div>
            <div class="ocpn-field">
                <label>Depth Units</label>
                <div class="ocpn-radio-group">
                    <label><input type="radio" name="depthUnitDisplay" value="meters" ${s.get('depthUnitDisplay') === 'meters' ? 'checked' : ''}/> Meters</label>
                    <label><input type="radio" name="depthUnitDisplay" value="feet" ${s.get('depthUnitDisplay') === 'feet' ? 'checked' : ''}/> Feet</label>
                    <label><input type="radio" name="depthUnitDisplay" value="fathoms" ${s.get('depthUnitDisplay') === 'fathoms' ? 'checked' : ''}/> Fathoms</label>
                </div>
            </div>
            <div class="ocpn-field">
                <label>Color Scheme</label>
                <div class="ocpn-radio-group">
                    <label><input type="radio" name="colorScheme" value="day" ${s.get('colorScheme') === 'day' ? 'checked' : ''}/> Day</label>
                    <label><input type="radio" name="colorScheme" value="dusk" ${s.get('colorScheme') === 'dusk' ? 'checked' : ''}/> Dusk</label>
                    <label><input type="radio" name="colorScheme" value="night" ${s.get('colorScheme') === 'night' ? 'checked' : ''}/> Night</label>
                </div>
            </div>
            <div class="ocpn-field">
                <label>Symbol Scale</label>
                <div class="ocpn-range-row">
                    <input type="range" data-setting="symbolScale" min="0.5" max="2.0" step="0.1" value="${s.get('symbolScale')}"/>
                    <span class="ocpn-range-value">${s.get('symbolScale').toFixed(1)}</span>
                </div>
            </div>
            <div class="ocpn-field">
                <label>Visibility</label>
                <div class="ocpn-checkbox-group">
                    <label><input type="checkbox" data-setting="showSoundings" ${s.get('showSoundings') ? 'checked' : ''}/> Show Soundings</label>
                    <label><input type="checkbox" data-setting="showLightChars" ${s.get('showLightChars') ? 'checked' : ''}/> Show Light Characters</label>
                    <label><input type="checkbox" data-setting="showBuoyLabels" ${s.get('showBuoyLabels') ? 'checked' : ''}/> Show Buoy Labels</label>
                    <label><input type="checkbox" data-setting="showDepthContours" ${s.get('showDepthContours') ? 'checked' : ''}/> Show Depth Contours</label>
                    <label><input type="checkbox" data-setting="showTextLabels" ${s.get('showTextLabels') ? 'checked' : ''}/> Show Text Labels</label>
                    <label><input type="checkbox" data-setting="showAisTargets" ${s.get('showAisTargets') ? 'checked' : ''}/> Show AIS Targets</label>
                    <label><input type="checkbox" data-setting="showOwnShip" ${s.get('showOwnShip') ? 'checked' : ''}/> Show Own Ship</label>
                    <label><input type="checkbox" data-setting="showGrid" ${s.get('showGrid') ? 'checked' : ''}/> Show Grid</label>
                </div>
            </div>
        `;
    }

    _renderNavigation() {
        const s = this._app.settings;
        return `
            <div class="ocpn-field">
                <label>Arrival Radius (NM)</label>
                <input type="number" data-setting="arrivalRadius" value="${s.get('arrivalRadius')}" min="0.01" step="0.01"/>
            </div>
            <div class="ocpn-field">
                <label>XTE Alarm Limit (NM)</label>
                <input type="number" data-setting="xteAlarm" value="${s.get('xteAlarm')}" min="0.01" step="0.01"/>
            </div>
            <div class="ocpn-field">
                <label>Anchor Alarm Radius (NM)</label>
                <input type="number" data-setting="anchorAlarmRadius" value="${s.get('anchorAlarmRadius')}" min="0.01" step="0.01"/>
            </div>
        `;
    }

    _bindInputs(el) {
        const s = this._app.settings;

        // Number/text inputs with data-setting
        el.querySelectorAll('input[type="number"][data-setting]').forEach(input => {
            input.addEventListener('change', () => {
                s.set(input.dataset.setting, parseFloat(input.value));
            });
        });

        // Radio groups
        el.querySelectorAll('input[type="radio"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    s.set(radio.name, radio.value);
                }
            });
        });

        // Checkboxes with data-setting
        el.querySelectorAll('input[type="checkbox"][data-setting]').forEach(cb => {
            cb.addEventListener('change', () => {
                s.set(cb.dataset.setting, cb.checked);
            });
        });

        // Range slider with data-setting
        el.querySelectorAll('input[type="range"][data-setting]').forEach(range => {
            range.addEventListener('input', () => {
                const val = parseFloat(range.value);
                s.set(range.dataset.setting, val);
                const valueEl = range.parentElement.querySelector('.ocpn-range-value');
                if (valueEl) valueEl.textContent = val.toFixed(1);
            });
        });
    }
}

// ══════════════════════════════════════════════════════════════
// LayersPanel — Quick chart layer toggles
// ══════════════════════════════════════════════════════════════
const LAYER_TOGGLES = [
    { key: 'showSoundings',     label: 'Soundings' },
    { key: 'showLightChars',    label: 'Lights' },
    { key: 'showBuoyLabels',    label: 'Buoys & Beacons' },
    { key: 'showDepthContours', label: 'Depth Contours' },
    { key: 'showLandFeatures',  label: 'Land Features' },
    { key: 'showTextLabels',    label: 'Text Labels' },
    { key: 'showAisTargets',    label: 'AIS Targets' },
];

class LayersPanel {
    constructor(app, container) {
        this._app = app;
        this._container = container;
        this._el = null;
        this._visible = false;
    }

    show() {
        if (this._visible) return;
        this._visible = true;
        this._render();
    }

    hide() {
        if (!this._visible) return;
        this._visible = false;
        if (this._settingListener) {
            this._app.bus.off('setting-changed', this._settingListener);
            this._settingListener = null;
        }
        if (this._el) {
            this._el.remove();
            this._el = null;
        }
    }

    toggle() {
        this._visible ? this.hide() : this.show();
    }

    _render() {
        if (this._el) this._el.remove();

        const el = document.createElement('div');
        el.className = 'ocpn-panel ocpn-layers-panel';
        el.style.cssText = 'position:fixed;top:60px;right:10px;width:200px;z-index:9000;';

        const s = this._app.settings;

        let togglesHtml = '';
        for (const t of LAYER_TOGGLES) {
            togglesHtml += `
                <div class="ocpn-layer-toggle">
                    <input type="checkbox" data-layer="${t.key}" ${s.get(t.key) ? 'checked' : ''}/>
                    <span>${t.label}</span>
                </div>
            `;
        }

        el.innerHTML = `
            <style>${PANEL_STYLES}</style>
            <div class="ocpn-panel-header">
                <h2 style="font-size:13px;">Layers</h2>
                <button class="ocpn-panel-close" title="Close">&times;</button>
            </div>
            <div class="ocpn-layers">
                ${togglesHtml}
            </div>
        `;

        this._container.appendChild(el);
        this._el = el;

        // Close button
        el.querySelector('.ocpn-panel-close').addEventListener('click', () => this.hide());

        // Bind toggles
        el.querySelectorAll('input[data-layer]').forEach(cb => {
            cb.addEventListener('change', () => {
                s.set(cb.dataset.layer, cb.checked);
            });
        });

        // Listen for external setting changes to stay in sync
        this._settingListener = ({ key, value }) => {
            const cb = el.querySelector(`input[data-layer="${key}"]`);
            if (cb) cb.checked = !!value;
        };
        this._app.bus.on('setting-changed', this._settingListener);
    }
}

// ══════════════════════════════════════════════════════════════
// Export
// ══════════════════════════════════════════════════════════════
window.SettingsUI = SettingsUI;
window.LayersPanel = LayersPanel;

})();
