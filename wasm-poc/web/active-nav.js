/**
 * active-nav.js — Active route navigation for OpenCPN WASM.
 *
 * Provides real-time route following with navigation calculations,
 * CDI rendering, active route overlay, nav info panel, alarms,
 * and track recording.
 *
 * Dependencies: navigation.js (Route, Waypoint, Track, NavStore,
 * gcDistance, gcBearing, crossTrackError), app.js (App.bus, App.vessel,
 * App.settings, App.alarms).
 */
(function() {
'use strict';

const EARTH_RADIUS_NM = 3440.065;
const DEG = Math.PI / 180;

// ══════════════════════════════════════════════════════════════
// ActiveNavigation Class
// ══════════════════════════════════════════════════════════════

class ActiveNavigation {
    constructor(app) {
        this._app = app;
        this._bus = app.bus;
        this._vessel = app.vessel;
        this._settings = app.settings;

        // Active route state
        this._route = null;
        this._waypointIndex = 0; // index of active (target) waypoint
        this._reversed = false;
        this._activatedAt = null;

        // Navigation data
        this._nav = {
            btw: 0,      // bearing to waypoint (degrees true)
            dtw: 0,      // distance to waypoint (NM)
            xte: 0,      // cross-track error (NM, + = right)
            vmg: 0,      // velocity made good (knots)
            eta: null,    // ETA at active waypoint (Date)
            ttg: 0,       // time to go to waypoint (seconds)
            etaRoute: null, // ETA at route end (Date)
            ttgRoute: 0,  // TTG to route end (seconds)
            courseToSteer: 0, // recommended course
            progress: 0   // route completion 0-1
        };

        // Track recording state
        this._recording = false;
        this._recordTrack = null;
        this._recordInterval = 10000; // ms
        this._recordTimer = null;
        this._blinkState = false;
        this._blinkTimer = null;

        // Previous position for VMG calculation
        this._prevPos = null;
        this._prevTime = 0;

        // Nav panel DOM reference
        this._panelEl = null;

        // Subscribe to vessel updates
        this._vesselUnsub = this._bus.on('vessel-update', () => this._onVesselUpdate());
    }

    // ── Public API ────────────────────────────────────────────

    activate(route) {
        if (!route || !route.waypoints || route.waypoints.length < 2) {
            console.warn('[ActiveNav] Cannot activate route with fewer than 2 waypoints');
            return;
        }

        this._route = route;
        this._route.active = true;
        this._waypointIndex = 1; // target is second waypoint (first leg)
        this._reversed = false;
        this._activatedAt = Date.now();
        this._prevPos = null;
        this._prevTime = 0;

        this._bus.emit('route-activated', { route: this._route });
        this._onVesselUpdate();
    }

    deactivate() {
        if (this._route) {
            this._route.active = false;
            const route = this._route;
            this._route = null;
            this._waypointIndex = 0;
            this._reversed = false;
            this._activatedAt = null;
            this._nav = { btw: 0, dtw: 0, xte: 0, vmg: 0, eta: null, ttg: 0, etaRoute: null, ttgRoute: 0, courseToSteer: 0, progress: 0 };

            this._bus.emit('route-deactivated', { route });

            // Clear nav alarms
            if (this._app.alarms) {
                this._app.alarms.clear('xte-alarm');
                this._app.alarms.clear('arrival-alarm');
            }
        }
    }

    get isActive() { return this._route !== null; }

    get activeRoute() { return this._route; }

    get activeWaypointIndex() { return this._waypointIndex; }

    get navData() {
        return { ...this._nav };
    }

    skipToWaypoint(index) {
        if (!this._route) return;
        if (index < 1 || index >= this._route.waypoints.length) return;
        this._waypointIndex = index;
        this._prevPos = null;
        this._prevTime = 0;
        this._bus.emit('waypoint-skipped', { index, waypoint: this._route.waypoints[index] });
        this._onVesselUpdate();
    }

    reverseRoute() {
        if (!this._route) return;
        this._route.reverse();
        this._reversed = !this._reversed;
        // Reset to first leg of reversed route
        this._waypointIndex = 1;
        this._prevPos = null;
        this._bus.emit('route-reversed', { route: this._route });
        this._onVesselUpdate();
    }

    // ── Track Recording ──────────────────────────────────────

    startRecording(interval) {
        if (this._recording) return;
        this._recordInterval = (interval || 10) * 1000;
        this._recordTrack = new Track('Track ' + new Date().toISOString().slice(0, 19).replace('T', ' '));
        this._recordTrack.recording = true;
        this._recording = true;

        this._recordTimer = setInterval(() => this._recordPoint(), this._recordInterval);
        this._blinkTimer = setInterval(() => { this._blinkState = !this._blinkState; }, 500);

        // Record initial point
        this._recordPoint();
        this._bus.emit('recording-started', { track: this._recordTrack });
    }

    stopRecording() {
        if (!this._recording) return;
        this._recording = false;
        if (this._recordTimer) { clearInterval(this._recordTimer); this._recordTimer = null; }
        if (this._blinkTimer) { clearInterval(this._blinkTimer); this._blinkTimer = null; }
        this._blinkState = false;

        if (this._recordTrack) {
            this._recordTrack.recording = false;
            // Persist to NavStore
            const tracks = NavStore.loadTracks();
            tracks.push(this._recordTrack);
            NavStore.saveTracks(tracks);
            this._bus.emit('recording-stopped', { track: this._recordTrack });
        }
        const track = this._recordTrack;
        this._recordTrack = null;
        return track;
    }

    get isRecording() { return this._recording; }

    // ── Rendering: Active Route on Chart ─────────────────────

    renderActiveRoute(ctx, toScreen, zoom) {
        if (!this._route || !this._vessel.hasPosition) return;

        const wps = this._route.waypoints;
        const xteLimit = this._settings.get('xteAlarm') || 0.5;
        const arrivalRadius = this._settings.get('arrivalRadius') || 0.1;

        ctx.save();

        // Draw XTE corridor on active leg
        this._renderXTECorridor(ctx, toScreen, xteLimit);

        // Draw route legs
        for (let i = 1; i < wps.length; i++) {
            const from = toScreen(wps[i - 1].lat, wps[i - 1].lon);
            const to = toScreen(wps[i].lat, wps[i].lon);

            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);

            if (i === this._waypointIndex) {
                // Active leg — thicker, brighter
                ctx.strokeStyle = '#00ffcc';
                ctx.lineWidth = 4;
                ctx.setLineDash([]);
            } else {
                ctx.strokeStyle = 'rgba(0, 255, 204, 0.5)';
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]);
            }
            ctx.stroke();
        }

        // Draw waypoint circles and arrival zones
        for (let i = 0; i < wps.length; i++) {
            const pt = toScreen(wps[i].lat, wps[i].lon);

            // Arrival circle
            const radiusPx = this._nmToPixels(arrivalRadius, wps[i].lat, zoom, toScreen);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, radiusPx, 0, Math.PI * 2);
            ctx.strokeStyle = i === this._waypointIndex ? '#00ffcc' : 'rgba(0, 255, 204, 0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.stroke();

            // Waypoint dot
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, i === this._waypointIndex ? 6 : 4, 0, Math.PI * 2);
            ctx.fillStyle = i === this._waypointIndex ? '#00ffcc' : '#ffffff';
            ctx.fill();

            // Turn radius indicator at intermediate waypoints
            if (i > 0 && i < wps.length - 1) {
                this._renderTurnRadius(ctx, toScreen, i, zoom);
            }
        }

        // Bearing line from vessel to active waypoint
        if (this._waypointIndex < wps.length) {
            const vesselPt = toScreen(this._vessel.lat, this._vessel.lon);
            const wpPt = toScreen(wps[this._waypointIndex].lat, wps[this._waypointIndex].lon);

            ctx.beginPath();
            ctx.moveTo(vesselPt.x, vesselPt.y);
            ctx.lineTo(wpPt.x, wpPt.y);
            ctx.strokeStyle = 'rgba(255, 200, 0, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 6]);
            ctx.stroke();
        }

        ctx.restore();

        // Recording indicator
        if (this._recording && this._blinkState) {
            ctx.save();
            ctx.fillStyle = '#ff3333';
            ctx.beginPath();
            ctx.arc(20, 20, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // ── Rendering: CDI ───────────────────────────────────────

    renderCDI(ctx, width, height) {
        if (!this._route) return;

        const xte = this._nav.xte;
        const barY = height - 60;
        const barH = 40;
        const barW = width - 40;
        const barX = 20;
        const centerX = barX + barW / 2;

        ctx.save();

        // Background
        ctx.fillStyle = 'rgba(20, 25, 35, 0.85)';
        ctx.beginPath();
        ctx.roundRect(barX - 10, barY - 10, barW + 20, barH + 20, 6);
        ctx.fill();

        // Scale marks
        const scaleMarks = [0.1, 0.25, 0.5]; // NM
        const maxScale = 0.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;

        for (const mark of scaleMarks) {
            const offsetPx = (mark / maxScale) * (barW / 2);
            // Right side
            ctx.beginPath();
            ctx.moveTo(centerX + offsetPx, barY);
            ctx.lineTo(centerX + offsetPx, barY + barH);
            ctx.stroke();
            // Left side
            ctx.beginPath();
            ctx.moveTo(centerX - offsetPx, barY);
            ctx.lineTo(centerX - offsetPx, barY + barH);
            ctx.stroke();

            // Labels
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(mark.toString(), centerX + offsetPx, barY - 2);
            ctx.fillText(mark.toString(), centerX - offsetPx, barY - 2);
        }

        // Center line
        ctx.beginPath();
        ctx.moveTo(centerX, barY);
        ctx.lineTo(centerX, barY + barH);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Needle (XTE indicator)
        const clampedXTE = Math.max(-maxScale, Math.min(maxScale, xte));
        const needleX = centerX + (clampedXTE / maxScale) * (barW / 2);
        const absXTE = Math.abs(xte);

        let needleColor;
        if (absXTE < 0.1) {
            needleColor = '#00cc66'; // green — on track
        } else if (absXTE < 0.5) {
            needleColor = '#ffcc00'; // yellow — drifting
        } else {
            needleColor = '#ff3333'; // red — off track
        }

        ctx.beginPath();
        ctx.moveTo(needleX, barY + 2);
        ctx.lineTo(needleX, barY + barH - 2);
        ctx.strokeStyle = needleColor;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Needle triangle indicator
        ctx.beginPath();
        ctx.moveTo(needleX - 5, barY - 4);
        ctx.lineTo(needleX + 5, barY - 4);
        ctx.lineTo(needleX, barY + 2);
        ctx.closePath();
        ctx.fillStyle = needleColor;
        ctx.fill();

        // Labels
        ctx.fillStyle = '#cccccc';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('L', barX - 8, barY + barH / 2 + 4);
        ctx.textAlign = 'right';
        ctx.fillText('R', barX + barW + 8, barY + barH / 2 + 4);

        // XTE readout
        ctx.textAlign = 'center';
        ctx.font = '11px monospace';
        ctx.fillStyle = needleColor;
        const side = xte >= 0 ? 'R' : 'L';
        ctx.fillText(`XTE: ${absXTE.toFixed(3)} NM ${side}`, centerX, barY + barH + 14);

        ctx.restore();
    }

    // ── Rendering: Navigation Info Panel ─────────────────────

    renderNavPanel(container) {
        if (!container) return;

        if (!this._panelEl) {
            this._panelEl = document.createElement('div');
            this._panelEl.className = 'active-nav-panel';
            this._panelEl.innerHTML = this._buildPanelHTML();
            this._applyPanelStyles(this._panelEl);
            container.appendChild(this._panelEl);
        }

        if (!this._route) {
            this._panelEl.style.display = 'none';
            return;
        }

        this._panelEl.style.display = 'block';
        this._updatePanelContent();
    }

    // ── Internal: Vessel Update Handler ──────────────────────

    _onVesselUpdate() {
        if (!this._route || !this._vessel.hasPosition) return;

        const wps = this._route.waypoints;
        const wp = wps[this._waypointIndex];
        if (!wp) return;

        const vLat = this._vessel.lat;
        const vLon = this._vessel.lon;

        // BTW and DTW
        this._nav.btw = gcBearing(vLat, vLon, wp.lat, wp.lon);
        this._nav.dtw = gcDistance(vLat, vLon, wp.lat, wp.lon);

        // XTE — cross-track error relative to active leg
        const fromWP = wps[this._waypointIndex - 1];
        if (fromWP) {
            this._nav.xte = crossTrackError(vLat, vLon, fromWP.lat, fromWP.lon, wp.lat, wp.lon);
        } else {
            this._nav.xte = 0;
        }

        // VMG — velocity made good towards waypoint
        const now = Date.now();
        if (this._prevPos && (now - this._prevTime) > 500) {
            const prevDTW = gcDistance(this._prevPos.lat, this._prevPos.lon, wp.lat, wp.lon);
            const dt = (now - this._prevTime) / 3600000; // hours
            this._nav.vmg = dt > 0 ? (prevDTW - this._nav.dtw) / dt : 0;
        } else if (this._vessel.sog > 0) {
            // Fallback: project SOG along bearing difference
            const bearingDiff = Math.abs(this._nav.btw - this._vessel.cog);
            this._nav.vmg = this._vessel.sog * Math.cos(bearingDiff * DEG);
        }
        this._prevPos = { lat: vLat, lon: vLon };
        this._prevTime = now;

        // TTG and ETA for active waypoint
        if (this._nav.vmg > 0.1) {
            this._nav.ttg = (this._nav.dtw / this._nav.vmg) * 3600; // seconds
            this._nav.eta = new Date(now + this._nav.ttg * 1000);
        } else {
            this._nav.ttg = Infinity;
            this._nav.eta = null;
        }

        // TTG and ETA for route end
        const remainingDist = this._remainingRouteDistance();
        if (this._nav.vmg > 0.1) {
            this._nav.ttgRoute = (remainingDist / this._nav.vmg) * 3600;
            this._nav.etaRoute = new Date(now + this._nav.ttgRoute * 1000);
        } else {
            this._nav.ttgRoute = Infinity;
            this._nav.etaRoute = null;
        }

        // Course to steer — adjust for XTE
        const xteGain = 2.0; // degrees per 0.1 NM of XTE
        const correction = -this._nav.xte * xteGain * 10;
        this._nav.courseToSteer = ((this._nav.btw + correction) + 360) % 360;

        // Progress
        const totalDist = this._route.totalDistance();
        const covered = totalDist - remainingDist;
        this._nav.progress = totalDist > 0 ? Math.max(0, Math.min(1, covered / totalDist)) : 0;

        // Check arrival
        const arrivalRadius = this._settings.get('arrivalRadius') || 0.1;
        if (this._nav.dtw <= arrivalRadius) {
            this._onArrival();
        }

        // XTE alarm
        const xteAlarmLimit = this._settings.get('xteAlarm') || 0.5;
        if (Math.abs(this._nav.xte) > xteAlarmLimit && this._app.alarms) {
            this._app.alarms.set('xte-alarm',
                `XTE ${Math.abs(this._nav.xte).toFixed(2)} NM exceeds limit`,
                'warning');
        } else if (this._app.alarms) {
            this._app.alarms.clear('xte-alarm');
        }

        this._bus.emit('nav-update', this._nav);
    }

    _onArrival() {
        const wps = this._route.waypoints;
        const arrivedWP = wps[this._waypointIndex];

        // Fire arrival alarm
        if (this._app.alarms) {
            this._app.alarms.set('arrival-alarm',
                `Arriving at ${arrivedWP.name || 'WP' + this._waypointIndex}`,
                'info');
        }
        this._bus.emit('waypoint-arrived', { index: this._waypointIndex, waypoint: arrivedWP });

        // Advance to next waypoint
        if (this._waypointIndex < wps.length - 1) {
            this._waypointIndex++;
            this._prevPos = null;
            this._prevTime = 0;
            this._bus.emit('waypoint-advance', {
                index: this._waypointIndex,
                waypoint: wps[this._waypointIndex]
            });
        } else {
            // Route complete
            if (this._app.alarms) {
                this._app.alarms.set('route-complete',
                    `Route "${this._route.name}" completed`,
                    'info');
            }
            this._bus.emit('route-completed', { route: this._route });
        }
    }

    _remainingRouteDistance() {
        if (!this._route || !this._vessel.hasPosition) return 0;
        const wps = this._route.waypoints;
        // Distance from vessel to active WP
        let remaining = this._nav.dtw;
        // Plus all subsequent legs
        for (let i = this._waypointIndex; i < wps.length - 1; i++) {
            remaining += gcDistance(wps[i].lat, wps[i].lon, wps[i + 1].lat, wps[i + 1].lon);
        }
        return remaining;
    }

    // ── Internal: Track Recording ────────────────────────────

    _recordPoint() {
        if (!this._recording || !this._vessel.hasPosition) return;
        this._recordTrack.addPoint(
            this._vessel.lat,
            this._vessel.lon,
            Date.now(),
            this._vessel.sog,
            this._vessel.cog
        );
    }

    // ── Internal: Chart Rendering Helpers ────────────────────

    _renderXTECorridor(ctx, toScreen, xteLimit) {
        if (this._waypointIndex < 1) return;
        const wps = this._route.waypoints;
        const from = wps[this._waypointIndex - 1];
        const to = wps[this._waypointIndex];

        const bearing = gcBearing(from.lat, from.lon, to.lat, to.lon);
        const perpL = (bearing - 90 + 360) % 360;
        const perpR = (bearing + 90) % 360;

        // Offset points for corridor lines
        const fromL = this._offsetPoint(from.lat, from.lon, perpL, xteLimit);
        const fromR = this._offsetPoint(from.lat, from.lon, perpR, xteLimit);
        const toL = this._offsetPoint(to.lat, to.lon, perpL, xteLimit);
        const toR = this._offsetPoint(to.lat, to.lon, perpR, xteLimit);

        const p1 = toScreen(fromL.lat, fromL.lon);
        const p2 = toScreen(toL.lat, toL.lon);
        const p3 = toScreen(fromR.lat, fromR.lon);
        const p4 = toScreen(toR.lat, toR.lon);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = 'rgba(255, 100, 100, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 8]);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    _renderTurnRadius(ctx, toScreen, waypointIndex, zoom) {
        const wps = this._route.waypoints;
        const prev = wps[waypointIndex - 1];
        const curr = wps[waypointIndex];
        const next = wps[waypointIndex + 1];
        if (!prev || !next) return;

        const bearingIn = gcBearing(prev.lat, prev.lon, curr.lat, curr.lon);
        const bearingOut = gcBearing(curr.lat, curr.lon, next.lat, next.lon);
        let turnAngle = bearingOut - bearingIn;
        if (turnAngle > 180) turnAngle -= 360;
        if (turnAngle < -180) turnAngle += 360;

        // Draw turn arc indicator
        const pt = toScreen(curr.lat, curr.lon);
        const startAngle = ((bearingIn - 90) * DEG);
        const endAngle = ((bearingOut - 90) * DEG);
        const radius = 12;

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, startAngle, endAngle, turnAngle < 0);
        ctx.strokeStyle = 'rgba(0, 255, 204, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.stroke();
    }

    _offsetPoint(lat, lon, bearing, distanceNm) {
        const δ = distanceNm / EARTH_RADIUS_NM;
        const θ = bearing * DEG;
        const φ1 = lat * DEG;
        const λ1 = lon * DEG;

        const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
        const φ2 = Math.asin(sinφ2);
        const λ2 = λ1 + Math.atan2(
            Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
            Math.cos(δ) - Math.sin(φ1) * sinφ2
        );
        return { lat: φ2 / DEG, lon: ((λ2 / DEG) + 540) % 360 - 180 };
    }

    _nmToPixels(nm, lat, zoom, toScreen) {
        // Approximate NM to screen pixels at given latitude
        const p1 = toScreen(lat, 0);
        const p2 = toScreen(lat, nm / (60 * Math.cos(lat * DEG)));
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.max(6, Math.sqrt(dx * dx + dy * dy));
    }

    // ── Internal: Nav Panel ──────────────────────────────────

    _buildPanelHTML() {
        return `
            <div class="anp-header">
                <span class="anp-title">NAV</span>
                <span class="anp-route-name"></span>
                <span class="anp-recording-dot"></span>
            </div>
            <div class="anp-compass">
                <canvas class="anp-compass-canvas" width="80" height="80"></canvas>
            </div>
            <div class="anp-data">
                <div class="anp-row"><span class="anp-label">BTW</span><span class="anp-value anp-btw">---°</span></div>
                <div class="anp-row"><span class="anp-label">DTW</span><span class="anp-value anp-dtw">-.- NM</span></div>
                <div class="anp-row"><span class="anp-label">XTE</span><span class="anp-value anp-xte">0.000</span></div>
                <div class="anp-row"><span class="anp-label">VMG</span><span class="anp-value anp-vmg">-.- kn</span></div>
                <div class="anp-row"><span class="anp-label">ETA</span><span class="anp-value anp-eta">--:--</span></div>
                <div class="anp-row"><span class="anp-label">TTG</span><span class="anp-value anp-ttg">--:--</span></div>
                <div class="anp-row"><span class="anp-label">Next</span><span class="anp-value anp-next">---</span></div>
            </div>
            <div class="anp-progress">
                <div class="anp-progress-bar"><div class="anp-progress-fill"></div></div>
                <span class="anp-progress-pct">0%</span>
            </div>
        `;
    }

    _applyPanelStyles(el) {
        el.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            width: 200px;
            background: rgba(15, 20, 30, 0.9);
            border: 1px solid rgba(0, 204, 180, 0.4);
            border-radius: 8px;
            padding: 10px;
            font-family: 'JetBrains Mono', 'Fira Code', monospace;
            font-size: 12px;
            color: #e0e0e0;
            z-index: 1000;
            backdrop-filter: blur(8px);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

        const style = document.createElement('style');
        style.textContent = `
            .active-nav-panel .anp-header {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-bottom: 8px;
                padding-bottom: 6px;
                border-bottom: 1px solid rgba(0, 204, 180, 0.3);
            }
            .active-nav-panel .anp-title {
                font-weight: bold;
                color: #00ccb4;
                font-size: 13px;
            }
            .active-nav-panel .anp-route-name {
                flex: 1;
                color: #aaa;
                font-size: 11px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .active-nav-panel .anp-recording-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: transparent;
            }
            .active-nav-panel .anp-recording-dot.active {
                background: #ff3333;
                animation: anp-blink 1s infinite;
            }
            @keyframes anp-blink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.2; }
            }
            .active-nav-panel .anp-compass {
                display: flex;
                justify-content: center;
                margin-bottom: 8px;
            }
            .active-nav-panel .anp-data {
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .active-nav-panel .anp-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .active-nav-panel .anp-label {
                color: #888;
                font-size: 10px;
                text-transform: uppercase;
            }
            .active-nav-panel .anp-value {
                color: #e0e0e0;
                font-size: 12px;
                font-weight: 500;
            }
            .active-nav-panel .anp-progress {
                margin-top: 8px;
                padding-top: 6px;
                border-top: 1px solid rgba(0, 204, 180, 0.2);
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .active-nav-panel .anp-progress-bar {
                flex: 1;
                height: 4px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 2px;
                overflow: hidden;
            }
            .active-nav-panel .anp-progress-fill {
                height: 100%;
                background: #00ccb4;
                border-radius: 2px;
                transition: width 0.5s ease;
            }
            .active-nav-panel .anp-progress-pct {
                font-size: 10px;
                color: #00ccb4;
                min-width: 30px;
                text-align: right;
            }
        `;
        if (!document.querySelector('#active-nav-panel-styles')) {
            style.id = 'active-nav-panel-styles';
            document.head.appendChild(style);
        }
    }

    _updatePanelContent() {
        const el = this._panelEl;
        if (!el) return;

        const wps = this._route.waypoints;
        const targetWP = wps[this._waypointIndex];

        // Header
        el.querySelector('.anp-route-name').textContent = this._route.name;
        const dot = el.querySelector('.anp-recording-dot');
        dot.classList.toggle('active', this._recording);

        // Data values
        el.querySelector('.anp-btw').textContent = this._formatBearing(this._nav.btw);
        el.querySelector('.anp-dtw').textContent = this._formatDistance(this._nav.dtw);

        const absXTE = Math.abs(this._nav.xte);
        const xteDir = this._nav.xte >= 0 ? 'R' : 'L';
        const xteEl = el.querySelector('.anp-xte');
        xteEl.textContent = `${absXTE.toFixed(3)} ${xteDir}`;
        xteEl.style.color = absXTE < 0.1 ? '#00cc66' : absXTE < 0.5 ? '#ffcc00' : '#ff3333';

        el.querySelector('.anp-vmg').textContent = this._nav.vmg.toFixed(1) + ' kn';
        el.querySelector('.anp-eta').textContent = this._nav.eta ? this._formatTime(this._nav.eta) : '--:--';
        el.querySelector('.anp-ttg').textContent = this._formatDuration(this._nav.ttg);
        el.querySelector('.anp-next').textContent = targetWP ? (targetWP.name || `WP${this._waypointIndex}`) : '---';

        // Progress
        const pct = Math.round(this._nav.progress * 100);
        el.querySelector('.anp-progress-fill').style.width = pct + '%';
        el.querySelector('.anp-progress-pct').textContent = pct + '%';

        // Compass rose
        this._renderCompassRose(el.querySelector('.anp-compass-canvas'));
    }

    _renderCompassRose(canvas) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const size = canvas.width;
        const cx = size / 2;
        const cy = size / 2;
        const r = size / 2 - 6;

        ctx.clearRect(0, 0, size, size);

        // Outer ring
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 204, 180, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Cardinal marks
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', cx, cy - r + 8);
        ctx.fillText('S', cx, cy + r - 8);
        ctx.fillText('E', cx + r - 8, cy);
        ctx.fillText('W', cx - r + 8, cy);

        // Tick marks every 30°
        for (let deg = 0; deg < 360; deg += 30) {
            const angle = (deg - 90) * DEG;
            const inner = r - 4;
            const outer = r;
            ctx.beginPath();
            ctx.moveTo(cx + inner * Math.cos(angle), cy + inner * Math.sin(angle));
            ctx.lineTo(cx + outer * Math.cos(angle), cy + outer * Math.sin(angle));
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // BTW needle
        const btwAngle = (this._nav.btw - 90) * DEG;
        const needleLen = r - 12;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + needleLen * Math.cos(btwAngle), cy + needleLen * Math.sin(btwAngle));
        ctx.strokeStyle = '#00ccb4';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Arrow head
        const tipX = cx + needleLen * Math.cos(btwAngle);
        const tipY = cy + needleLen * Math.sin(btwAngle);
        const headLen = 8;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
            tipX - headLen * Math.cos(btwAngle - 0.4),
            tipY - headLen * Math.sin(btwAngle - 0.4)
        );
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
            tipX - headLen * Math.cos(btwAngle + 0.4),
            tipY - headLen * Math.sin(btwAngle + 0.4)
        );
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#00ccb4';
        ctx.fill();
    }

    // ── Formatting Helpers ───────────────────────────────────

    _formatBearing(deg) {
        return String(Math.round(((deg % 360) + 360) % 360)).padStart(3, '0') + '°T';
    }

    _formatDistance(nm) {
        if (nm < 0.1) return Math.round(nm * 1852) + ' m';
        return nm.toFixed(2) + ' NM';
    }

    _formatTime(date) {
        if (!date || !(date instanceof Date)) return '--:--';
        return date.toTimeString().slice(0, 5);
    }

    _formatDuration(seconds) {
        if (!isFinite(seconds) || seconds <= 0) return '--:--';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
        const s = Math.floor(seconds % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    // ── Cleanup ──────────────────────────────────────────────

    destroy() {
        this.deactivate();
        this.stopRecording();
        if (this._vesselUnsub) this._vesselUnsub();
        if (this._panelEl && this._panelEl.parentNode) {
            this._panelEl.parentNode.removeChild(this._panelEl);
        }
        this._panelEl = null;
    }
}

// ── Expose globally ──────────────────────────────────────────
window.ActiveNavigation = ActiveNavigation;

})();
