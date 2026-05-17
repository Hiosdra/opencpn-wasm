/**
 * Safety features for OpenCPN WASM — Anchor Watch, MOB, EBL, VRM,
 * Guard Zones, and Depth Alarm with canvas rendering overlays.
 */
(function () {
  'use strict';

  const NM_TO_METERS = 1852;
  const TWO_PI = Math.PI * 2;
  const DEG_TO_RAD = Math.PI / 180;
  const RAD_TO_DEG = 180 / Math.PI;

  class SafetyManager {
    constructor(app) {
      this._app = app;
      this._anchor = null;
      this._mob = null;
      this._ebls = [];
      this._vrms = [];
      this._guardZones = [];
      this._mobAlarmAcknowledged = false;
      this._mobAudioInterval = null;
      this._mobPanelEl = null;

      this._onVesselUpdate = this._onVesselUpdate.bind(this);
      app.bus.on('vessel-update', this._onVesselUpdate);
    }

    // ─── Anchor Watch ───────────────────────────────────────────────────

    setAnchor(lat, lon, radius) {
      const r = radius != null
        ? radius
        : (this._app.settings.get('anchorAlarmRadius') || 0.05);
      this._anchor = { lat, lon, radius: r, active: true, distance: 0, alarm: false };
      this._checkAnchor();
    }

    clearAnchor() {
      this._anchor = null;
      this._app.alarms.clear && this._app.alarms.clear('anchor-watch');
    }

    get anchorWatch() {
      if (!this._anchor) return null;
      return { ...this._anchor };
    }

    _checkAnchor() {
      if (!this._anchor) return;
      const v = this._app.vessel;
      const dist = gcDistance(v.lat, v.lon, this._anchor.lat, this._anchor.lon);
      this._anchor.distance = dist;
      if (dist > this._anchor.radius) {
        this._anchor.alarm = true;
        this._app.alarms.set('anchor-watch', 'Anchor dragging!', 'danger');
      } else {
        this._anchor.alarm = false;
        this._app.alarms.clear && this._app.alarms.clear('anchor-watch');
      }
    }

    // ─── MOB (Man Overboard) ────────────────────────────────────────────

    triggerMOB() {
      const v = this._app.vessel;
      this._mob = {
        lat: v.lat,
        lon: v.lon,
        time: Date.now(),
        bearing: 0,
        distance: 0
      };
      this._mobAlarmAcknowledged = false;
      this._startMOBAlarm();
      this._updateMOB();
      this._app.alarms.set('mob', 'MAN OVERBOARD!', 'danger');
    }

    clearMOB() {
      this._mob = null;
      this._stopMOBAlarm();
      this._app.alarms.clear && this._app.alarms.clear('mob');
      if (this._mobPanelEl) {
        this._mobPanelEl.remove();
        this._mobPanelEl = null;
      }
    }

    get mob() {
      if (!this._mob) return null;
      return { ...this._mob };
    }

    acknowledgeMOBAlarm() {
      this._mobAlarmAcknowledged = true;
      this._stopMOBAlarm();
    }

    _updateMOB() {
      if (!this._mob) return;
      const v = this._app.vessel;
      this._mob.bearing = gcBearing(v.lat, v.lon, this._mob.lat, this._mob.lon);
      this._mob.distance = gcDistance(v.lat, v.lon, this._mob.lat, this._mob.lon);
    }

    _startMOBAlarm() {
      this._stopMOBAlarm();
      this._mobAudioInterval = setInterval(() => {
        if (this._mobAlarmAcknowledged) return;
        this._playAlarmBeep();
      }, 1000);
    }

    _stopMOBAlarm() {
      if (this._mobAudioInterval) {
        clearInterval(this._mobAudioInterval);
        this._mobAudioInterval = null;
      }
    }

    _playAlarmBeep() {
      try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'square';
        osc.frequency.value = 880;
        gain.gain.value = 0.3;
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + 0.2);
      } catch (_) { /* audio not available */ }
    }

    // ─── EBL (Electronic Bearing Line) ──────────────────────────────────

    addEBL(bearing) {
      if (this._ebls.length >= 4) return null;
      const ebl = { bearing: bearing % 360, id: Date.now() };
      this._ebls.push(ebl);
      return this._ebls.length - 1;
    }

    removeEBL(index) {
      if (index >= 0 && index < this._ebls.length) {
        this._ebls.splice(index, 1);
      }
    }

    clearAllEBL() {
      this._ebls = [];
    }

    get ebls() {
      return this._ebls.map(e => ({ ...e }));
    }

    // ─── VRM (Variable Range Marker) ────────────────────────────────────

    addVRM(range) {
      if (this._vrms.length >= 4) return null;
      const vrm = { range, id: Date.now() };
      this._vrms.push(vrm);
      return this._vrms.length - 1;
    }

    removeVRM(index) {
      if (index >= 0 && index < this._vrms.length) {
        this._vrms.splice(index, 1);
      }
    }

    clearAllVRM() {
      this._vrms = [];
    }

    get vrms() {
      return this._vrms.map(v => ({ ...v }));
    }

    // ─── Guard Zones ────────────────────────────────────────────────────

    addGuardZone(innerRadius, outerRadius, startBearing, endBearing) {
      const zone = {
        innerRadius,
        outerRadius,
        startBearing: startBearing % 360,
        endBearing: endBearing % 360,
        id: Date.now(),
        triggered: false,
        targets: []
      };
      this._guardZones.push(zone);
      return this._guardZones.length - 1;
    }

    removeGuardZone(index) {
      if (index >= 0 && index < this._guardZones.length) {
        this._guardZones.splice(index, 1);
      }
    }

    get guardZones() {
      return this._guardZones.map(z => ({ ...z }));
    }

    _checkGuardZones() {
      const v = this._app.vessel;
      const targets = (this._app.vessel.aisTargets || []);
      this._guardZones.forEach((zone, idx) => {
        zone.triggered = false;
        zone.targets = [];
        targets.forEach(t => {
          const dist = gcDistance(v.lat, v.lon, t.lat, t.lon);
          const brg = gcBearing(v.lat, v.lon, t.lat, t.lon);
          if (dist >= zone.innerRadius && dist <= zone.outerRadius &&
              this._bearingInSector(brg, zone.startBearing, zone.endBearing)) {
            zone.triggered = true;
            zone.targets.push(t);
          }
        });
        if (zone.triggered) {
          this._app.alarms.set(
            'guard-zone-' + idx,
            'Target in guard zone ' + (idx + 1),
            'danger'
          );
        } else {
          this._app.alarms.clear && this._app.alarms.clear('guard-zone-' + idx);
        }
      });
    }

    _bearingInSector(bearing, start, end) {
      const b = ((bearing % 360) + 360) % 360;
      const s = ((start % 360) + 360) % 360;
      const e = ((end % 360) + 360) % 360;
      if (s <= e) return b >= s && b <= e;
      return b >= s || b <= e;
    }

    // ─── Depth Alarm ────────────────────────────────────────────────────

    _checkDepth() {
      const depth = this._app.vessel.depth;
      if (depth == null) return;
      const shallow = this._app.settings.get('shallowDepth');
      const safety = this._app.settings.get('safetyDepth');
      if (shallow != null && depth < shallow) {
        this._app.alarms.set('depth', 'Shallow water!', 'danger');
      } else if (safety != null && depth < safety) {
        this._app.alarms.set('depth', 'Approaching shallow water', 'warning');
      } else {
        this._app.alarms.clear && this._app.alarms.clear('depth');
      }
    }

    // ─── Vessel Update Handler ──────────────────────────────────────────

    _onVesselUpdate() {
      this._checkAnchor();
      this._updateMOB();
      this._checkGuardZones();
      this._checkDepth();
    }

    // ─── Rendering ──────────────────────────────────────────────────────

    render(ctx, toScreen, zoom, colorScheme) {
      ctx.save();
      this._renderAnchorWatch(ctx, toScreen, zoom, colorScheme);
      this._renderMOB(ctx, toScreen, zoom, colorScheme);
      this._renderEBLs(ctx, toScreen, zoom, colorScheme);
      this._renderVRMs(ctx, toScreen, zoom, colorScheme);
      this._renderGuardZones(ctx, toScreen, zoom, colorScheme);
      ctx.restore();
    }

    _renderAnchorWatch(ctx, toScreen, zoom, colorScheme) {
      if (!this._anchor) return;
      const center = toScreen(this._anchor.lat, this._anchor.lon);
      const radiusMeters = this._anchor.radius * NM_TO_METERS;

      // Approximate pixel radius using a point offset
      const offsetLat = this._anchor.lat + (this._anchor.radius / 60);
      const edgePoint = toScreen(offsetLat, this._anchor.lon);
      const radiusPx = Math.abs(edgePoint.y - center.y);

      const alarmActive = this._anchor.alarm;
      const circleColor = alarmActive ? '#ff3333' : '#33cc66';

      // Dashed circle
      ctx.beginPath();
      ctx.arc(center.x, center.y, radiusPx, 0, TWO_PI);
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = circleColor;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);

      // Anchor icon at center (simple cross + arc)
      ctx.beginPath();
      ctx.arc(center.x, center.y, 5, 0, TWO_PI);
      ctx.fillStyle = circleColor;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(center.x, center.y - 10);
      ctx.lineTo(center.x, center.y + 10);
      ctx.moveTo(center.x - 6, center.y + 6);
      ctx.lineTo(center.x + 6, center.y + 6);
      ctx.strokeStyle = circleColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Radius label in meters
      ctx.font = '12px monospace';
      ctx.fillStyle = circleColor;
      ctx.textAlign = 'center';
      ctx.fillText(
        Math.round(radiusMeters) + 'm',
        center.x,
        center.y - radiusPx - 8
      );

      // Distance display
      const distMeters = Math.round(this._anchor.distance * NM_TO_METERS);
      ctx.fillText(
        'Dist: ' + distMeters + 'm',
        center.x,
        center.y + radiusPx + 16
      );
    }

    _renderMOB(ctx, toScreen, zoom, colorScheme) {
      if (!this._mob) return;
      const pos = toScreen(this._mob.lat, this._mob.lon);
      const vessel = this._app.vessel;
      const vesselPos = toScreen(vessel.lat, vessel.lon);

      // Flashing red circle
      const flash = Math.floor(Date.now() / 500) % 2 === 0;
      const alpha = flash ? 1.0 : 0.4;

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 20, 0, TWO_PI);
      ctx.fillStyle = 'rgba(255, 0, 0, ' + (alpha * 0.3) + ')';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 0, 0, ' + alpha + ')';
      ctx.lineWidth = 3;
      ctx.stroke();

      // MOB text
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#ff0000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('MOB', pos.x, pos.y);

      // Timestamp
      const elapsed = this._formatElapsed(Date.now() - this._mob.time);
      ctx.font = '11px monospace';
      ctx.fillText(elapsed, pos.x, pos.y + 28);

      // Bearing line from vessel to MOB
      ctx.beginPath();
      ctx.moveTo(vesselPos.x, vesselPos.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#ff3333';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);

      // Bearing + distance label at midpoint
      const mx = (vesselPos.x + pos.x) / 2;
      const my = (vesselPos.y + pos.y) / 2;
      const brgText = Math.round(this._mob.bearing) + '°';
      const distText = this._mob.distance.toFixed(2) + ' NM';
      ctx.font = '11px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(brgText + ' / ' + distText, mx + 6, my);
      ctx.fillText(brgText + ' / ' + distText, mx + 6, my);
    }

    _renderEBLs(ctx, toScreen, zoom, colorScheme) {
      if (this._ebls.length === 0) return;
      const vessel = this._app.vessel;
      const origin = toScreen(vessel.lat, vessel.lon);
      const lineLen = 3000; // extend well beyond visible area

      const colors = ['#00ccff', '#ffcc00', '#ff66cc', '#66ff99'];

      this._ebls.forEach((ebl, i) => {
        const rad = (90 - ebl.bearing) * DEG_TO_RAD; // compass to math angle
        const ex = origin.x + Math.cos(rad) * lineLen;
        const ey = origin.y - Math.sin(rad) * lineLen;

        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = colors[i % colors.length];
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Bearing label at midpoint
        const lx = origin.x + Math.cos(rad) * 80;
        const ly = origin.y - Math.sin(rad) * 80;
        ctx.font = '11px monospace';
        ctx.fillStyle = colors[i % colors.length];
        ctx.textAlign = 'center';
        ctx.fillText(ebl.bearing.toFixed(1) + '°', lx, ly - 6);
      });
    }

    _renderVRMs(ctx, toScreen, zoom, colorScheme) {
      if (this._vrms.length === 0) return;
      const vessel = this._app.vessel;
      const origin = toScreen(vessel.lat, vessel.lon);

      const colors = ['#00ccff', '#ffcc00', '#ff66cc', '#66ff99'];

      this._vrms.forEach((vrm, i) => {
        // Convert NM range to pixels
        const offsetLat = vessel.lat + (vrm.range / 60);
        const edgePoint = toScreen(offsetLat, vessel.lon);
        const radiusPx = Math.abs(edgePoint.y - origin.y);

        ctx.beginPath();
        ctx.arc(origin.x, origin.y, radiusPx, 0, TWO_PI);
        ctx.strokeStyle = colors[i % colors.length];
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Range label at top
        ctx.font = '11px monospace';
        ctx.fillStyle = colors[i % colors.length];
        ctx.textAlign = 'center';
        ctx.fillText(vrm.range.toFixed(2) + ' NM', origin.x, origin.y - radiusPx - 6);
      });
    }

    _renderGuardZones(ctx, toScreen, zoom, colorScheme) {
      if (this._guardZones.length === 0) return;
      const vessel = this._app.vessel;
      const origin = toScreen(vessel.lat, vessel.lon);

      this._guardZones.forEach((zone, idx) => {
        const innerOffLat = vessel.lat + (zone.innerRadius / 60);
        const outerOffLat = vessel.lat + (zone.outerRadius / 60);
        const innerPx = Math.abs(toScreen(innerOffLat, vessel.lon).y - origin.y);
        const outerPx = Math.abs(toScreen(outerOffLat, vessel.lon).y - origin.y);

        // Convert bearings: compass 0=N clockwise → canvas 0=E counter-clockwise
        const startRad = (90 - zone.startBearing) * DEG_TO_RAD;
        const endRad = (90 - zone.endBearing) * DEG_TO_RAD;

        const fillColor = zone.triggered
          ? 'rgba(255, 60, 60, 0.25)'
          : 'rgba(0, 200, 180, 0.15)';
        const strokeColor = zone.triggered ? '#ff3333' : '#00c8b4';

        // Draw sector (outer arc → line → inner arc reversed → line)
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, outerPx, -startRad, -endRad, true);
        ctx.arc(origin.x, origin.y, innerPx, -endRad, -startRad, false);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }

    // ─── MOB Panel ──────────────────────────────────────────────────────

    renderMOBPanel(container) {
      if (!this._mob) {
        if (this._mobPanelEl) {
          this._mobPanelEl.remove();
          this._mobPanelEl = null;
        }
        return;
      }

      if (!this._mobPanelEl) {
        this._mobPanelEl = document.createElement('div');
        this._mobPanelEl.className = 'safety-mob-panel';
        Object.assign(this._mobPanelEl.style, {
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(20, 20, 30, 0.92)',
          border: '2px solid #ff3333',
          borderRadius: '8px',
          padding: '16px',
          color: '#ffffff',
          fontFamily: 'monospace',
          minWidth: '220px',
          zIndex: '9999',
          boxShadow: '0 4px 24px rgba(255, 0, 0, 0.3)'
        });
        container.appendChild(this._mobPanelEl);
      }

      const elapsed = this._formatElapsed(Date.now() - this._mob.time);
      const brg = Math.round(this._mob.bearing);
      const dist = this._mob.distance.toFixed(2);

      // Bearing indicator direction
      const brgRad = (this._mob.bearing - 90) * DEG_TO_RAD;
      const arrowX = 30 + Math.cos(brgRad) * 20;
      const arrowY = 30 + Math.sin(brgRad) * 20;

      this._mobPanelEl.innerHTML = [
        '<div style="text-align:center;margin-bottom:8px;">',
        '  <span style="font-size:18px;font-weight:bold;color:#ff3333;">⚠ MOB</span>',
        '</div>',
        '<svg width="60" height="60" style="display:block;margin:0 auto 8px;">',
        '  <circle cx="30" cy="30" r="28" fill="none" stroke="#00b8a9" stroke-width="2"/>',
        '  <line x1="30" y1="30" x2="' + arrowX + '" y2="' + arrowY + '"',
        '    stroke="#ff3333" stroke-width="3" stroke-linecap="round"/>',
        '  <circle cx="30" cy="30" r="3" fill="#00b8a9"/>',
        '</svg>',
        '<div style="text-align:center;">',
        '  <div style="color:#00b8a9;font-size:13px;">BRG</div>',
        '  <div style="font-size:22px;font-weight:bold;">' + brg + '°</div>',
        '</div>',
        '<div style="text-align:center;margin-top:6px;">',
        '  <div style="color:#00b8a9;font-size:13px;">DIST</div>',
        '  <div style="font-size:22px;font-weight:bold;">' + dist + ' NM</div>',
        '</div>',
        '<div style="text-align:center;margin-top:6px;">',
        '  <div style="color:#00b8a9;font-size:13px;">ELAPSED</div>',
        '  <div style="font-size:16px;">' + elapsed + '</div>',
        '</div>',
        '<div style="text-align:center;margin-top:10px;">',
        '  <span style="font-size:11px;color:#aaa;">',
        '    ' + this._mob.lat.toFixed(5) + ', ' + this._mob.lon.toFixed(5),
        '  </span>',
        '</div>'
      ].join('\n');
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    _formatElapsed(ms) {
      const totalSec = Math.floor(ms / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const pad = n => String(n).padStart(2, '0');
      return pad(h) + ':' + pad(m) + ':' + pad(s);
    }

    destroy() {
      this._app.bus.off('vessel-update', this._onVesselUpdate);
      this._stopMOBAlarm();
      if (this._mobPanelEl) {
        this._mobPanelEl.remove();
        this._mobPanelEl = null;
      }
    }
  }

  window.SafetyManager = SafetyManager;
})();
