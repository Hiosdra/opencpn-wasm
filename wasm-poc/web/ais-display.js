/**
 * ais-display.js — AIS target display and management for OpenCPN WASM.
 *
 * Renders AIS targets on a 2D canvas overlay, computes CPA/TCPA alerts,
 * provides target info popups and a sortable target list panel.
 *
 * Depends on: App (window.App) — bus, ais, vessel, settings, alarms
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // Constants
  // ══════════════════════════════════════════════════════════════

  var DEG = Math.PI / 180;
  var NM_PER_DEG_LAT = 60;

  var CPA_DANGER_NM = 0.5;
  var CPA_WARNING_NM = 1.0;
  var TCPA_THRESHOLD_MIN = 30;

  var PREDICTION_INTERVALS = [6, 12, 18]; // minutes

  var DEFAULT_SHIP_SIZE = 20;
  var LABEL_ZOOM_THRESHOLD = 0.003; // radians per pixel — show labels when zoomed in past this

  var HIT_RADIUS = 15; // pixels for click detection

  // Nav status codes
  var NAV_UNDERWAY_ENGINE = 0;
  var NAV_AT_ANCHOR = 1;
  var NAV_NOT_UNDER_COMMAND = 2;
  var NAV_MOORED = 5;

  // ══════════════════════════════════════════════════════════════
  // Color palettes per color scheme
  // ══════════════════════════════════════════════════════════════

  var COLORS = {
    day: {
      classA: '#1a3a6b',
      classB: '#4a90d9',
      fishing: '#e68a00',
      tanker: '#cc2222',
      cargo: '#2d8f2d',
      passenger: '#00b8d4',
      sar: '#ffffff',
      danger: '#ff0000',
      warning: '#ffaa00',
      ownShip: '#000000',
      vector: 'rgba(0,0,0,0.6)',
      prediction: 'rgba(0,0,0,0.3)',
      rangeRing: 'rgba(0,0,0,0.2)',
      label: '#222222'
    },
    dusk: {
      classA: '#5577bb',
      classB: '#7799dd',
      fishing: '#ff9933',
      tanker: '#ee4444',
      cargo: '#55bb55',
      passenger: '#44ccee',
      sar: '#dddddd',
      danger: '#ff2222',
      warning: '#ffbb33',
      ownShip: '#cccccc',
      vector: 'rgba(200,200,200,0.6)',
      prediction: 'rgba(200,200,200,0.3)',
      rangeRing: 'rgba(200,200,200,0.2)',
      label: '#ddcccc'
    },
    night: {
      classA: '#334466',
      classB: '#446688',
      fishing: '#884400',
      tanker: '#881111',
      cargo: '#226622',
      passenger: '#226677',
      sar: '#666666',
      danger: '#cc0000',
      warning: '#884400',
      ownShip: '#880000',
      vector: 'rgba(136,0,0,0.6)',
      prediction: 'rgba(136,0,0,0.3)',
      rangeRing: 'rgba(136,0,0,0.2)',
      label: '#880000'
    }
  };

  // ══════════════════════════════════════════════════════════════
  // Utility helpers
  // ══════════════════════════════════════════════════════════════

  function getTargetColor(target, palette) {
    var st = target.shipType || 0;
    if (st === 30 || st === 7) return palette.fishing; // Fishing / engaged in fishing
    if (st >= 80 && st <= 89) return palette.tanker;
    if (st >= 70 && st <= 79) return palette.cargo;
    if (st >= 60 && st <= 69) return palette.passenger;
    if (st === 35 || st === 51 || st === 55 || st === 58 || st === 59) return palette.sar;
    // Class distinction
    if (target.type === 'B') return palette.classB;
    return palette.classA;
  }

  function getShipSize(target) {
    if (target.length && target.length > 0) {
      // Scale: real length in meters → pixels, capped
      return Math.max(12, Math.min(40, target.length * 0.15));
    }
    return DEFAULT_SHIP_SIZE;
  }

  function bearingBetween(lat1, lon1, lat2, lon2) {
    var dLon = (lon2 - lon1) * DEG;
    var y = Math.sin(dLon) * Math.cos(lat2 * DEG);
    var x = Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
            Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos(dLon);
    return ((Math.atan2(y, x) / DEG) + 360) % 360;
  }

  function distanceNM(lat1, lon1, lat2, lon2) {
    var dLat = (lat2 - lat1) * DEG;
    var dLon = (lon2 - lon1) * DEG;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 3440.065;
  }

  function formatDeg(v) { return v != null ? v.toFixed(1) + '°' : '—'; }
  function formatKn(v) { return v != null ? v.toFixed(1) + ' kn' : '—'; }
  function formatNM(v) { return v != null ? v.toFixed(2) + ' NM' : '—'; }
  function formatMin(v) { return v != null ? v.toFixed(1) + ' min' : '—'; }

  function formatPos(lat, lon) {
    if (lat == null || lon == null) return '—';
    var fmtOne = function (v, pos, neg) {
      var a = Math.abs(v);
      var d = Math.floor(a);
      var m = (a - d) * 60;
      return d + '°' + m.toFixed(3) + "'" + (v >= 0 ? pos : neg);
    };
    return fmtOne(lat, 'N', 'S') + ' ' + fmtOne(lon, 'E', 'W');
  }

  // ══════════════════════════════════════════════════════════════
  // Ship shape rendering
  // ══════════════════════════════════════════════════════════════

  function drawShipTriangle(ctx, x, y, cog, size, color, filled) {
    var angle = (cog || 0) * DEG - Math.PI / 2;
    var halfW = size * 0.35;
    var len = size;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.moveTo(len * 0.6, 0);           // bow
    ctx.lineTo(-len * 0.4, -halfW);     // port stern
    ctx.lineTo(-len * 0.25, 0);         // stern center indent
    ctx.lineTo(-len * 0.4, halfW);      // starboard stern
    ctx.closePath();

    if (filled) {
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawNavStatusIcon(ctx, x, y, navStatus, size, color) {
    var r = size * 0.3;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;

    switch (navStatus) {
      case NAV_AT_ANCHOR:
        // Circle with a hook below
        ctx.beginPath();
        ctx.arc(x, y - r * 0.5, r * 0.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.5 + r * 0.6);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r * 0.4, y + r * 0.7);
        ctx.stroke();
        break;

      case NAV_MOORED:
        // Square
        ctx.strokeRect(x - r * 0.6, y - r * 0.6, r * 1.2, r * 1.2);
        break;

      case NAV_NOT_UNDER_COMMAND:
        // X mark
        ctx.beginPath();
        ctx.moveTo(x - r * 0.5, y - r * 0.5);
        ctx.lineTo(x + r * 0.5, y + r * 0.5);
        ctx.moveTo(x + r * 0.5, y - r * 0.5);
        ctx.lineTo(x - r * 0.5, y + r * 0.5);
        ctx.stroke();
        break;

      default:
        // Underway using engine — small triangle (already drawn as ship shape)
        break;
    }
    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════
  // Panel DOM helpers
  // ══════════════════════════════════════════════════════════════

  function createPanel(id, title, width) {
    var existing = document.getElementById(id);
    if (existing) { existing.remove(); }

    var panel = document.createElement('div');
    panel.id = id;
    panel.style.cssText =
      'position:fixed;top:60px;right:10px;width:' + (width || 320) + 'px;' +
      'max-height:80vh;overflow-y:auto;z-index:9000;' +
      'background:rgba(22,33,62,0.94);color:#e0e0e0;' +
      'border:1px solid #53a8b6;border-radius:6px;' +
      'font-family:sans-serif;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

    var header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:8px 12px;background:#16213e;border-radius:5px 5px 0 0;' +
      'border-bottom:1px solid #53a8b6;cursor:move;';
    header.innerHTML = '<span style="font-weight:bold;color:#53a8b6;">' + title + '</span>';

    var closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'cursor:pointer;color:#53a8b6;font-size:16px;padding:0 4px;';
    closeBtn.onclick = function () { panel.remove(); };
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // Drag support
    var dragging = false, dragX = 0, dragY = 0;
    header.onmousedown = function (e) {
      dragging = true;
      dragX = e.clientX - panel.offsetLeft;
      dragY = e.clientY - panel.offsetTop;
      e.preventDefault();
    };
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      panel.style.left = (e.clientX - dragX) + 'px';
      panel.style.top = (e.clientY - dragY) + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', function () { dragging = false; });

    document.body.appendChild(panel);
    return panel;
  }

  function createRow(label, value) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;padding:3px 12px;border-bottom:1px solid rgba(83,168,182,0.15);';
    row.innerHTML = '<span style="color:#8ab4c0;">' + label + '</span><span>' + (value || '—') + '</span>';
    return row;
  }

  // ══════════════════════════════════════════════════════════════
  // AISDisplay Class
  // ══════════════════════════════════════════════════════════════

  function AISDisplay(app) {
    this._app = app;
    this._dirty = true;
    this._flashState = false;
    this._flashTimer = 0;
    this._cpaCache = new Map(); // mmsi → {cpa, tcpa, state}
    this._screenTargets = [];   // [{mmsi, x, y, size}] for hit testing
    this._rangeRings = [1, 2, 5]; // NM

    // Subscribe to AIS updates for dirty-check re-rendering
    var self = this;
    if (app && app.bus) {
      app.bus.on('ais-update', function () { self._dirty = true; });
      app.bus.on('ais-new', function () { self._dirty = true; });
      app.bus.on('ais-lost', function () { self._dirty = true; });
      app.bus.on('vessel-update', function () { self._dirty = true; });
    }

    // Flash timer for danger targets (toggle every 500ms)
    setInterval(function () {
      self._flashTimer++;
      self._flashState = (self._flashTimer % 2) === 0;
    }, 500);
  }

  // ──────────────────────────────────────────────────────────────
  // Main render — called per frame
  // ──────────────────────────────────────────────────────────────

  AISDisplay.prototype.render = function (ctx, toScreen, zoom, colorScheme) {
    if (!this._app || !this._app.ais) return;
    if (!this._app.settings.get('showAisTargets') && !this._app.settings.get('showOwnShip')) return;

    var palette = COLORS[colorScheme] || COLORS.day;
    var targets = this._app.ais.getActive();
    var vessel = this._app.vessel;
    var canvasW = ctx.canvas.width;
    var canvasH = ctx.canvas.height;

    this._screenTargets = [];
    this._updateCPA(targets, vessel);

    // Draw range rings around own ship
    if (this._app.settings.get('showOwnShip') && vessel.hasPosition) {
      this._drawRangeRings(ctx, toScreen, vessel, palette, zoom);
    }

    // Draw AIS targets
    if (this._app.settings.get('showAisTargets')) {
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (t.lat == null || t.lon == null) continue;

        var sp = toScreen(t.lat, t.lon);
        if (!sp) continue;

        // Viewport culling with margin
        var margin = 50;
        if (sp.x < -margin || sp.x > canvasW + margin ||
            sp.y < -margin || sp.y > canvasH + margin) continue;

        var cpaInfo = this._cpaCache.get(t.mmsi);
        var isDanger = cpaInfo && cpaInfo.state === 'danger';
        var isWarning = cpaInfo && cpaInfo.state === 'warning';
        var size = getShipSize(t);

        // Determine color
        var color;
        if (isDanger) {
          color = palette.danger;
        } else if (isWarning) {
          color = palette.warning;
        } else {
          color = getTargetColor(t, palette);
        }

        // Danger flashing — skip draw on flash-off state for filled
        var filled = isDanger;
        if (isDanger && !this._flashState) {
          filled = false;
        }

        // Draw ship shape or nav status icon
        if (t.navStatus === NAV_AT_ANCHOR || t.navStatus === NAV_MOORED || t.navStatus === NAV_NOT_UNDER_COMMAND) {
          drawNavStatusIcon(ctx, sp.x, sp.y, t.navStatus, size, color);
        } else {
          drawShipTriangle(ctx, sp.x, sp.y, t.cog, size, color, filled);
        }

        // SOG/COG vector line
        if (t.sog != null && t.sog > 0.5 && t.cog != null) {
          this._drawVector(ctx, sp.x, sp.y, t.cog, t.sog, palette.vector);
        }

        // Prediction lines
        if (t.sog != null && t.sog > 0.5 && t.cog != null) {
          this._drawPrediction(ctx, t, toScreen, palette.prediction);
        }

        // Name label if zoomed in
        if (zoom && zoom < LABEL_ZOOM_THRESHOLD) {
          var label = t.name || String(t.mmsi);
          ctx.save();
          ctx.font = '11px sans-serif';
          ctx.fillStyle = palette.label;
          ctx.textAlign = 'center';
          ctx.fillText(label, sp.x, sp.y - size * 0.6 - 4);
          ctx.restore();
        }

        // Store for hit-testing
        this._screenTargets.push({ mmsi: t.mmsi, x: sp.x, y: sp.y, size: size });
      }
    }

    // Draw own ship
    if (this._app.settings.get('showOwnShip') && vessel.hasPosition) {
      this._drawOwnShip(ctx, toScreen, vessel, palette, zoom);
    }

    this._dirty = false;
  };

  // ──────────────────────────────────────────────────────────────
  // Own ship rendering
  // ──────────────────────────────────────────────────────────────

  AISDisplay.prototype._drawOwnShip = function (ctx, toScreen, vessel, palette, zoom) {
    var sp = toScreen(vessel.lat, vessel.lon);
    if (!sp) return;

    var size = 24;
    var hdg = !isNaN(vessel.hdg) ? vessel.hdg : vessel.cog;

    // GPS accuracy circle (drawn beneath the vessel icon)
    if (vessel.accuracy > 0) {
      var accuracyLatDeg = vessel.accuracy / 111320;
      var sp2 = toScreen(vessel.lat + accuracyLatDeg, vessel.lon);
      if (sp2) {
        var r = Math.abs(sp.y - sp2.y);
        if (r > 4) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(83,168,182,0.10)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(83,168,182,0.45)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }

    // Draw boat icon (filled triangle)
    ctx.save();
    var angle = (hdg || 0) * DEG - Math.PI / 2;
    ctx.translate(sp.x, sp.y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.moveTo(size * 0.7, 0);
    ctx.lineTo(-size * 0.4, -size * 0.35);
    ctx.lineTo(-size * 0.2, 0);
    ctx.lineTo(-size * 0.4, size * 0.35);
    ctx.closePath();
    ctx.fillStyle = palette.ownShip;
    ctx.fill();
    ctx.strokeStyle = palette.ownShip;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Heading line (solid)
    if (!isNaN(vessel.hdg)) {
      var hdgAngle = vessel.hdg * DEG;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(sp.x + Math.sin(hdgAngle) * 60, sp.y - Math.cos(hdgAngle) * 60);
      ctx.strokeStyle = palette.ownShip;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // COG line (dashed, if different from heading)
    if (vessel.sog > 0.5) {
      var cogAngle = vessel.cog * DEG;
      var cogLen = Math.min(vessel.sog * 8, 100);
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(sp.x + Math.sin(cogAngle) * cogLen, sp.y - Math.cos(cogAngle) * cogLen);
      ctx.strokeStyle = palette.vector;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  };

  // ──────────────────────────────────────────────────────────────
  // Range rings
  // ──────────────────────────────────────────────────────────────

  AISDisplay.prototype._drawRangeRings = function (ctx, toScreen, vessel, palette, zoom) {
    var sp = toScreen(vessel.lat, vessel.lon);
    if (!sp) return;

    // Compute pixel radius for 1 NM: project a point 1 NM north
    var oneMileLat = vessel.lat + (1 / 60);
    var sp1 = toScreen(oneMileLat, vessel.lon);
    if (!sp1) return;
    var pixelsPerNM = Math.abs(sp1.y - sp.y);
    if (pixelsPerNM < 2) return; // too zoomed out

    ctx.save();
    ctx.strokeStyle = palette.rangeRing;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = palette.rangeRing;
    ctx.textAlign = 'left';

    for (var i = 0; i < this._rangeRings.length; i++) {
      var nm = this._rangeRings[i];
      var r = pixelsPerNM * nm;
      if (r > 2000) continue; // skip if too large
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(nm + ' NM', sp.x + r * 0.707 + 4, sp.y - r * 0.707 - 2);
    }
    ctx.restore();
  };

  // ──────────────────────────────────────────────────────────────
  // SOG/COG vector
  // ──────────────────────────────────────────────────────────────

  AISDisplay.prototype._drawVector = function (ctx, x, y, cog, sog, color) {
    var angle = cog * DEG;
    var len = Math.min(sog * 6, 80); // length proportional to speed
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.sin(angle) * len, y - Math.cos(angle) * len);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  };

  // ──────────────────────────────────────────────────────────────
  // Prediction dashed lines (6/12/18 min)
  // ──────────────────────────────────────────────────────────────

  AISDisplay.prototype._drawPrediction = function (ctx, target, toScreen, color) {
    var sog = target.sog; // knots
    var cog = target.cog * DEG;
    var cosLat = Math.cos((target.lat || 0) * DEG);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);

    var prevPt = toScreen(target.lat, target.lon);
    if (!prevPt) { ctx.restore(); return; }

    ctx.beginPath();
    ctx.moveTo(prevPt.x, prevPt.y);

    for (var i = 0; i < PREDICTION_INTERVALS.length; i++) {
      var minutes = PREDICTION_INTERVALS[i];
      var hours = minutes / 60;
      var distNM = sog * hours;
      var dLat = (distNM * Math.cos(cog)) / 60;
      var dLon = (distNM * Math.sin(cog)) / (60 * cosLat);
      var predLat = target.lat + dLat;
      var predLon = target.lon + dLon;
      var pt = toScreen(predLat, predLon);
      if (pt) {
        ctx.lineTo(pt.x, pt.y);
        // Draw a small tick mark at each interval
        ctx.moveTo(pt.x - 3, pt.y - 3);
        ctx.lineTo(pt.x + 3, pt.y + 3);
        ctx.moveTo(pt.x, pt.y);
      }
    }
    ctx.stroke();
    ctx.restore();
  };

  // ──────────────────────────────────────────────────────────────
  // CPA/TCPA update and alerting
  // ──────────────────────────────────────────────────────────────

  AISDisplay.prototype._updateCPA = function (targets, vessel) {
    if (!vessel || !vessel.hasPosition) return;

    var cpaDanger = this._app.settings.get('cpaDanger') || CPA_DANGER_NM;
    var cpaWarning = this._app.settings.get('cpaWarning') || CPA_WARNING_NM;
    var tcpaThreshold = TCPA_THRESHOLD_MIN;

    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var result = this._app.ais.computeCPA(t, vessel);
      if (!result) {
        this._cpaCache.set(t.mmsi, { cpa: null, tcpa: null, state: 'normal' });
        continue;
      }

      var state = 'normal';
      if (result.cpa < cpaDanger && result.tcpa < tcpaThreshold && result.tcpa >= 0) {
        state = 'danger';
      } else if (result.cpa < cpaWarning && result.tcpa < tcpaThreshold && result.tcpa >= 0) {
        state = 'warning';
      }

      this._cpaCache.set(t.mmsi, { cpa: result.cpa, tcpa: result.tcpa, state: state });

      // Trigger alarms
      var alarmId = 'ais-cpa-' + t.mmsi;
      if (state === 'danger') {
        var msg = 'DANGER: ' + (t.name || t.mmsi) + ' CPA ' + result.cpa.toFixed(2) + ' NM in ' + result.tcpa.toFixed(1) + ' min';
        this._app.alarms.set(alarmId, msg, 'danger');
      } else if (state === 'warning') {
        var msg2 = 'WARNING: ' + (t.name || t.mmsi) + ' CPA ' + result.cpa.toFixed(2) + ' NM in ' + result.tcpa.toFixed(1) + ' min';
        this._app.alarms.set(alarmId, msg2, 'warning');
      } else {
        this._app.alarms.clear(alarmId);
      }
    }
  };

  // ──────────────────────────────────────────────────────────────
  // Hit testing
  // ──────────────────────────────────────────────────────────────

  AISDisplay.prototype.hitTest = function (screenX, screenY) {
    var closest = null;
    var closestDist = Infinity;

    for (var i = 0; i < this._screenTargets.length; i++) {
      var st = this._screenTargets[i];
      var dx = screenX - st.x;
      var dy = screenY - st.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var hitR = Math.max(HIT_RADIUS, st.size * 0.6);
      if (dist < hitR && dist < closestDist) {
        closest = this._app.ais.get(st.mmsi);
        closestDist = dist;
      }
    }
    return closest;
  };

  // ──────────────────────────────────────────────────────────────
  // Target info popup
  // ──────────────────────────────────────────────────────────────

  AISDisplay.prototype.showTargetInfo = function (mmsi) {
    var target = this._app.ais.get(mmsi);
    if (!target) return;

    var panel = createPanel('ais-target-info', 'AIS Target Info', 340);
    var body = document.createElement('div');
    body.style.padding = '8px 0';

    var name = target.name || 'Unknown';
    var typeName = target.getShipTypeName ? target.getShipTypeName() : (target.shipType || '—');
    var navStatusName = target.getNavStatusName ? target.getNavStatusName() : '—';
    var dims = (target.length && target.beam) ? target.length + ' × ' + target.beam + ' m' : '—';
    var cpaInfo = this._cpaCache.get(mmsi);

    body.appendChild(createRow('Name', name));
    body.appendChild(createRow('MMSI', String(mmsi)));
    body.appendChild(createRow('Call Sign', target.callsign || '—'));
    body.appendChild(createRow('IMO', target.imo || '—'));
    body.appendChild(createRow('Type', typeName));
    body.appendChild(createRow('Dimensions', dims));
    body.appendChild(createRow('Draught', target.draught ? target.draught + ' m' : '—'));
    body.appendChild(createRow('Position', formatPos(target.lat, target.lon)));
    body.appendChild(createRow('SOG', formatKn(target.sog)));
    body.appendChild(createRow('COG', formatDeg(target.cog)));
    body.appendChild(createRow('Heading', formatDeg(target.hdg)));
    body.appendChild(createRow('ROT', target.rot != null ? target.rot + '°/min' : '—'));
    body.appendChild(createRow('Nav Status', navStatusName));
    body.appendChild(createRow('Destination', target.destination || '—'));
    body.appendChild(createRow('ETA', target.eta || '—'));

    if (cpaInfo && cpaInfo.cpa != null) {
      var cpaRow = createRow('CPA', formatNM(cpaInfo.cpa));
      var tcpaRow = createRow('TCPA', formatMin(cpaInfo.tcpa));
      if (cpaInfo.state === 'danger') {
        cpaRow.style.color = '#ff4444';
        tcpaRow.style.color = '#ff4444';
      } else if (cpaInfo.state === 'warning') {
        cpaRow.style.color = '#ffaa00';
        tcpaRow.style.color = '#ffaa00';
      }
      body.appendChild(cpaRow);
      body.appendChild(tcpaRow);
    }

    // Distance and bearing from own vessel
    var vessel = this._app.vessel;
    if (vessel.hasPosition && target.lat != null && target.lon != null) {
      var dist = distanceNM(vessel.lat, vessel.lon, target.lat, target.lon);
      var brg = bearingBetween(vessel.lat, vessel.lon, target.lat, target.lon);
      body.appendChild(createRow('Distance', formatNM(dist)));
      body.appendChild(createRow('Bearing', formatDeg(brg)));
    }

    panel.appendChild(body);
  };

  // ──────────────────────────────────────────────────────────────
  // Target list panel
  // ──────────────────────────────────────────────────────────────

  AISDisplay.prototype.showTargetList = function () {
    var self = this;
    var targets = this._app.ais.getActive();
    var vessel = this._app.vessel;

    var panel = createPanel('ais-target-list', 'AIS Targets (' + targets.length + ')', 520);

    // Sort controls
    var controls = document.createElement('div');
    controls.style.cssText = 'padding:6px 12px;display:flex;gap:8px;border-bottom:1px solid rgba(83,168,182,0.3);';
    controls.innerHTML =
      '<span style="color:#8ab4c0;font-size:11px;">Sort:</span>' +
      '<button id="ais-sort-dist" style="background:#1a3355;color:#53a8b6;border:1px solid #53a8b6;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px;">Distance</button>' +
      '<button id="ais-sort-cpa" style="background:#1a3355;color:#53a8b6;border:1px solid #53a8b6;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px;">CPA</button>';
    panel.appendChild(controls);

    // Table
    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';

    var thead = document.createElement('thead');
    thead.innerHTML =
      '<tr style="color:#53a8b6;text-align:left;border-bottom:1px solid rgba(83,168,182,0.4);">' +
      '<th style="padding:4px 6px;">Name/MMSI</th>' +
      '<th style="padding:4px 6px;">Dist</th>' +
      '<th style="padding:4px 6px;">Brg</th>' +
      '<th style="padding:4px 6px;">SOG</th>' +
      '<th style="padding:4px 6px;">CPA</th>' +
      '<th style="padding:4px 6px;">TCPA</th>' +
      '</tr>';
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    tbody.id = 'ais-list-body';

    var enriched = this._enrichTargets(targets, vessel);
    this._renderListRows(tbody, enriched, self);

    table.appendChild(tbody);
    panel.appendChild(table);

    // Sort event handlers
    setTimeout(function () {
      var btnDist = document.getElementById('ais-sort-dist');
      var btnCpa = document.getElementById('ais-sort-cpa');
      if (btnDist) btnDist.onclick = function () {
        enriched.sort(function (a, b) { return (a.distance || Infinity) - (b.distance || Infinity); });
        self._renderListRows(tbody, enriched, self);
      };
      if (btnCpa) btnCpa.onclick = function () {
        enriched.sort(function (a, b) { return (a.cpa || Infinity) - (b.cpa || Infinity); });
        self._renderListRows(tbody, enriched, self);
      };
    }, 0);
  };

  AISDisplay.prototype._enrichTargets = function (targets, vessel) {
    var results = [];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var entry = {
        target: t,
        mmsi: t.mmsi,
        name: t.name || String(t.mmsi),
        sog: t.sog,
        distance: null,
        bearing: null,
        cpa: null,
        tcpa: null,
        state: 'normal'
      };

      if (vessel.hasPosition && t.lat != null && t.lon != null) {
        entry.distance = distanceNM(vessel.lat, vessel.lon, t.lat, t.lon);
        entry.bearing = bearingBetween(vessel.lat, vessel.lon, t.lat, t.lon);
      }

      var cpaInfo = this._cpaCache.get(t.mmsi);
      if (cpaInfo) {
        entry.cpa = cpaInfo.cpa;
        entry.tcpa = cpaInfo.tcpa;
        entry.state = cpaInfo.state;
      }

      results.push(entry);
    }
    // Default sort by distance
    results.sort(function (a, b) { return (a.distance || Infinity) - (b.distance || Infinity); });
    return results;
  };

  AISDisplay.prototype._renderListRows = function (tbody, enriched, self) {
    tbody.innerHTML = '';
    for (var i = 0; i < enriched.length; i++) {
      var e = enriched[i];
      var tr = document.createElement('tr');
      tr.style.cssText = 'cursor:pointer;border-bottom:1px solid rgba(83,168,182,0.1);';

      if (e.state === 'danger') {
        tr.style.background = 'rgba(255,0,0,0.15)';
        tr.style.color = '#ff6666';
      } else if (e.state === 'warning') {
        tr.style.background = 'rgba(255,170,0,0.1)';
        tr.style.color = '#ffcc66';
      }

      tr.onmouseenter = function () { this.style.background = 'rgba(83,168,182,0.15)'; };
      tr.onmouseleave = (function (state) {
        return function () {
          if (state === 'danger') this.style.background = 'rgba(255,0,0,0.15)';
          else if (state === 'warning') this.style.background = 'rgba(255,170,0,0.1)';
          else this.style.background = '';
        };
      })(e.state);

      // Click handler — center chart and show info
      tr.onclick = (function (mmsi, lat, lon) {
        return function () {
          if (self._app.bus && lat != null && lon != null) {
            self._app.bus.emit('center-on', { lat: lat, lon: lon });
          }
          self.showTargetInfo(mmsi);
        };
      })(e.mmsi, e.target.lat, e.target.lon);

      var td = function (text) {
        var cell = document.createElement('td');
        cell.style.padding = '4px 6px';
        cell.textContent = text;
        return cell;
      };

      tr.appendChild(td(e.name));
      tr.appendChild(td(e.distance != null ? e.distance.toFixed(1) : '—'));
      tr.appendChild(td(e.bearing != null ? e.bearing.toFixed(0) + '°' : '—'));
      tr.appendChild(td(e.sog != null ? e.sog.toFixed(1) : '—'));
      tr.appendChild(td(e.cpa != null ? e.cpa.toFixed(2) : '—'));
      tr.appendChild(td(e.tcpa != null ? e.tcpa.toFixed(1) : '—'));

      tbody.appendChild(tr);
    }
  };

  AISDisplay.prototype.hideTargetList = function () {
    var el = document.getElementById('ais-target-list');
    if (el) el.remove();
  };

  // ══════════════════════════════════════════════════════════════
  // Expose globally
  // ══════════════════════════════════════════════════════════════

  window.AISDisplay = AISDisplay;

})();
