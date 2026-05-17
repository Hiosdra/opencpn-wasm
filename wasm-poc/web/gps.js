/**
 * gps.js — Device GPS integration for OpenCPN WASM.
 *
 * Bridges navigator.geolocation.watchPosition() → App.vessel
 * so own-ship rendering, anchor watch, and safety features
 * receive live position updates from the device GPS.
 *
 * Requires: app.js (App), renderer.js (window.renderer)
 */
(function () {
'use strict';

class GPSManager {
    constructor() {
        this._watchId = null;
        this._status = 'inactive'; // 'inactive' | 'acquiring' | 'active' | 'error'
        this._firstFix = true;
        this._errorMessage = '';
    }

    get isTracking() {
        return this._status === 'active' || this._status === 'acquiring';
    }

    get status() { return this._status; }
    get errorMessage() { return this._errorMessage; }

    toggle() {
        if (this.isTracking) {
            this.stop();
        } else {
            this.start();
        }
    }

    start() {
        if (!navigator.geolocation) {
            this._setStatus('error', 'Geolocation not supported by this browser');
            this._updateButton();
            return;
        }
        if (this._watchId !== null) return;

        this._firstFix = true;
        this._setStatus('acquiring');
        this._updateButton();

        this._watchId = navigator.geolocation.watchPosition(
            pos => this._onPosition(pos),
            err => this._onError(err),
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
        );

        // Enable own-ship display once when GPS starts
        if (typeof App !== 'undefined') {
            App.settings.set('showOwnShip', true);
        }
    }

    stop() {
        if (this._watchId !== null) {
            navigator.geolocation.clearWatch(this._watchId);
            this._watchId = null;
        }
        this._setStatus('inactive');
        this._updateButton();
    }

    centerOnVessel() {
        if (typeof App === 'undefined' || !App.vessel.hasPosition) return;
        if (typeof renderer !== 'undefined') {
            renderer.centerOn(App.vessel.lat, App.vessel.lon);
        }
    }

    _onPosition(pos) {
        const { latitude: lat, longitude: lon, speed, heading, accuracy } = pos.coords;

        if (typeof App !== 'undefined') {
            const update = { lat, lon, accuracy: accuracy || 0 };
            // speed is m/s from browser → convert to knots
            if (speed != null) update.sog = speed * 1.94384;
            // heading may be null when stationary
            if (heading != null) update.cog = heading;
            App.vessel.update(update);
        }

        const wasFirstFix = this._firstFix;
        this._firstFix = false;
        this._setStatus('active');
        this._updateButton();

        if (wasFirstFix) {
            this.centerOnVessel();
        }

        if (typeof renderer !== 'undefined') renderer.render();

        const statusEl = document.getElementById('status');
        if (statusEl && typeof App !== 'undefined' && App.vessel.hasPosition) {
            statusEl.textContent = `GPS: ${lat.toFixed(4)}°, ${lon.toFixed(4)}° ±${Math.round(accuracy)}m`;
        }
    }

    _onError(err) {
        const msgs = {
            1: 'GPS permission denied',
            2: 'GPS position unavailable',
            3: 'GPS timeout — retrying',
        };
        const msg = msgs[err.code] || 'GPS error';
        this._errorMessage = msg;

        // Timeout (code 3) is recoverable — keep watching
        if (err.code === 3) {
            this._setStatus('acquiring');
        } else {
            this._watchId = null;
            this._setStatus('error', msg);
        }
        this._updateButton();

        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = msg;
    }

    _setStatus(status, message) {
        this._status = status;
        if (message) this._errorMessage = message;
    }

    _updateButton() {
        const btn = document.getElementById('gps-btn');
        if (!btn) return;
        btn.classList.remove('gps-acquiring', 'gps-active', 'gps-error');
        if (this._status === 'acquiring') {
            btn.classList.add('gps-acquiring');
            btn.title = 'GPS: acquiring fix…';
        } else if (this._status === 'active') {
            btn.classList.add('gps-active');
            btn.title = 'GPS active — click to center map';
        } else if (this._status === 'error') {
            btn.classList.add('gps-error');
            btn.title = 'GPS error: ' + this._errorMessage;
        } else {
            btn.title = 'Enable GPS tracking';
        }
    }
}

window.gpsManager = new GPSManager();

// Wire up button after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('gps-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
        if (window.gpsManager.status === 'active') {
            // Re-center on second click when already active
            window.gpsManager.centerOnVessel();
        } else if (window.gpsManager.status === 'acquiring') {
            window.gpsManager.stop();
        } else {
            window.gpsManager.start();
        }
    });
});

})();
