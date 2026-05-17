/**
 * GRIB2 Weather Overlay for OpenCPN WASM
 * Parses GRIB2 data and renders wind, pressure, temperature, waves, precipitation.
 */
(function() {
  'use strict';

  // --- State ---
  let gribData = null;
  let timeIndex = 0;
  let activeOverlays = { wind: true, pressure: true, temperature: false, waves: false, precipitation: false };
  let windDisplayMode = 'barbs';
  let animating = false;
  let animTimer = null;

  // --- GRIB2 Parser (Simplified) ---

  function parseGRIB2(buffer) {
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic !== 'GRIB') throw new Error('Not a valid GRIB file');

    const edition = u8[7];
    if (edition !== 2) throw new Error('Only GRIB2 is supported (got edition ' + edition + ')');

    const messages = [];
    let offset = 0;

    while (offset < buffer.byteLength - 4) {
      const msgMagic = String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3]);
      if (msgMagic !== 'GRIB') break;

      const msg = parseMessage(buffer, offset);
      if (msg) messages.push(msg);
      offset += msg ? msg.totalLength : buffer.byteLength;
    }

    return organizeMessages(messages);
  }

  function parseMessage(buffer, startOffset) {
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    let offset = startOffset;

    // Section 0: Indicator
    const totalLength = view.getUint32(offset + 12, false) || (buffer.byteLength - startOffset);
    const endOffset = startOffset + Math.min(totalLength, buffer.byteLength - startOffset);
    offset += 16;

    let discipline = u8[startOffset + 6];
    let gridDef = null;
    let paramCategory = 0, paramNumber = 0;
    let forecastTime = 0;
    let refTime = null;
    let values = null;
    let nBits = 0, refVal = 0, binScale = 0, decScale = 0;

    while (offset < endOffset - 4) {
      const secLen = view.getUint32(offset, false);
      const secNum = u8[offset + 4];

      if (secLen < 5 || secLen > endOffset - offset) break;

      switch (secNum) {
        case 1:
          refTime = new Date(Date.UTC(
            view.getUint16(offset + 12, false),
            u8[offset + 14] - 1, u8[offset + 15],
            u8[offset + 16], u8[offset + 17], u8[offset + 18]
          ));
          break;

        case 3:
          gridDef = parseGridDef(buffer, offset, secLen);
          break;

        case 4:
          paramCategory = u8[offset + 9];
          paramNumber = u8[offset + 10];
          forecastTime = view.getUint32(offset + 18, false);
          break;

        case 5:
          nBits = u8[offset + 11];
          refVal = view.getFloat32(offset + 11, false);
          binScale = view.getInt16(offset + 15, false);
          decScale = view.getInt16(offset + 17, false);
          break;

        case 7:
          values = decodeDataSection(buffer, offset, secLen, gridDef, nBits, refVal, binScale, decScale);
          break;
      }
      offset += secLen;
    }

    return { totalLength, discipline, paramCategory, paramNumber, forecastTime, refTime, gridDef, values };
  }

  function parseGridDef(buffer, offset, secLen) {
    const view = new DataView(buffer);
    const templateNum = view.getUint16(offset + 12, false);
    const ni = view.getUint32(offset + 30, false);
    const nj = view.getUint32(offset + 34, false);
    const lat1 = view.getInt32(offset + 46, false) / 1e6;
    const lon1 = view.getInt32(offset + 50, false) / 1e6;
    const lat2 = view.getInt32(offset + 55, false) / 1e6;
    const lon2 = view.getInt32(offset + 59, false) / 1e6;
    const di = view.getUint32(offset + 63, false) / 1e6;
    const dj = view.getUint32(offset + 67, false) / 1e6;

    return { templateNum, ni: ni || 1, nj: nj || 1, lat1, lon1, lat2, lon2, di: di || 1, dj: dj || 1 };
  }

  function decodeDataSection(buffer, offset, secLen, gridDef, nBits, refVal, binScale, decScale) {
    const dataOffset = offset + 5;
    const numPoints = gridDef ? gridDef.ni * gridDef.nj : 0;
    const values = new Float32Array(numPoints || 1);

    if (nBits === 0) {
      values.fill(refVal);
      return values;
    }

    const bScale = Math.pow(2, binScale);
    const dScale = Math.pow(10, -decScale);
    const byteLen = secLen - 5;
    const u8 = new Uint8Array(buffer, dataOffset, Math.min(byteLen, buffer.byteLength - dataOffset));

    for (let i = 0; i < Math.min(numPoints, Math.floor(byteLen * 8 / Math.max(nBits, 1))); i++) {
      const bitPos = i * nBits;
      const byteIdx = bitPos >> 3;
      const bitOff = bitPos & 7;
      if (byteIdx + 2 >= u8.length) break;
      let raw = ((u8[byteIdx] << 16) | (u8[byteIdx + 1] << 8) | (u8[byteIdx + 2] || 0));
      raw = (raw >> (24 - bitOff - nBits)) & ((1 << nBits) - 1);
      values[i] = (refVal + raw * bScale) * dScale;
    }

    return values;
  }

  function organizeMessages(messages) {
    const timeSteps = {};
    for (const msg of messages) {
      if (!msg) continue;
      const key = msg.forecastTime || 0;
      if (!timeSteps[key]) timeSteps[key] = { forecastTime: key, refTime: msg.refTime, params: {} };

      const paramKey = identifyParam(msg.discipline, msg.paramCategory, msg.paramNumber);
      timeSteps[key].params[paramKey] = {
        gridDef: msg.gridDef,
        values: msg.values,
        discipline: msg.discipline,
        category: msg.paramCategory,
        number: msg.paramNumber
      };
    }

    const sorted = Object.values(timeSteps).sort((a, b) => a.forecastTime - b.forecastTime);
    return {
      timeSteps: sorted,
      refTime: messages[0] && messages[0].refTime,
      numSteps: sorted.length
    };
  }

  function identifyParam(discipline, category, number) {
    if (discipline === 0) {
      if (category === 2 && number === 2) return 'windU';
      if (category === 2 && number === 3) return 'windV';
      if (category === 2 && number === 1) return 'windSpeed';
      if (category === 2 && number === 0) return 'windDir';
      if (category === 3 && number === 0) return 'pressure';
      if (category === 0 && number === 0) return 'temperature';
      if (category === 1 && number === 8) return 'precipitation';
    }
    if (discipline === 10) {
      if (category === 0 && number === 3) return 'waveHeight';
    }
    return `d${discipline}c${category}n${number}`;
  }

  // --- Get grid value at lat/lon via bilinear interpolation ---
  function getGridValue(param, lat, lon) {
    if (!param || !param.gridDef || !param.values) return null;
    const g = param.gridDef;
    if (!g.ni || !g.nj) return null;

    let queryLon = lon;
    if (g.lon1 >= 0 && queryLon < 0) queryLon += 360;

    const fi = (queryLon - g.lon1) / g.di;
    const fj = (g.lat1 - lat) / g.dj;

    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    if (i0 < 0 || i0 >= g.ni - 1 || j0 < 0 || j0 >= g.nj - 1) return null;

    const dx = fi - i0, dy = fj - j0;
    const idx00 = j0 * g.ni + i0;
    const idx10 = j0 * g.ni + i0 + 1;
    const idx01 = (j0 + 1) * g.ni + i0;
    const idx11 = (j0 + 1) * g.ni + i0 + 1;

    if (idx11 >= param.values.length) return null;

    const v = param.values;
    return v[idx00] * (1 - dx) * (1 - dy) + v[idx10] * dx * (1 - dy) +
           v[idx01] * (1 - dx) * dy + v[idx11] * dx * dy;
  }

  // --- Wind Rendering ---

  function drawWindBarb(ctx, x, y, speed, dir) {
    const kts = speed * 1.94384;
    if (kts < 2) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#b0bec5';
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }

    const rad = (dir + 180) * Math.PI / 180;
    const staffLen = 24;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rad);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -staffLen);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    let remaining = kts;
    let pos = staffLen;

    // Pennants (50 kts)
    while (remaining >= 50) {
      ctx.beginPath();
      ctx.moveTo(0, -pos);
      ctx.lineTo(8, -(pos - 3));
      ctx.lineTo(0, -(pos - 6));
      ctx.closePath();
      ctx.fillStyle = '#e0e0e0';
      ctx.fill();
      pos -= 7;
      remaining -= 50;
    }

    // Long barbs (10 kts)
    while (remaining >= 10) {
      ctx.beginPath();
      ctx.moveTo(0, -pos);
      ctx.lineTo(8, -(pos - 2));
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      pos -= 4;
      remaining -= 10;
    }

    // Short barbs (5 kts)
    if (remaining >= 5) {
      ctx.beginPath();
      ctx.moveTo(0, -pos);
      ctx.lineTo(5, -(pos - 1));
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawWindArrow(ctx, x, y, speed, dir) {
    const kts = speed * 1.94384;
    const len = Math.min(20, 5 + kts * 0.4);
    const rad = (dir - 90) * Math.PI / 180;

    let color;
    if (kts < 10) color = '#42a5f5';
    else if (kts < 20) color = '#66bb6a';
    else if (kts < 30) color = '#fdd835';
    else color = '#ef5350';

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rad);
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.lineTo(len / 2, 0);
    ctx.lineTo(len / 2 - 4, -3);
    ctx.moveTo(len / 2, 0);
    ctx.lineTo(len / 2 - 4, 3);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function renderWind(ctx, toScreen, zoom, params) {
    const windU = params.windU;
    const windV = params.windV;
    if (!windU || !windV || !windU.gridDef) return;

    const g = windU.gridDef;
    const step = Math.max(1, Math.floor(20 / zoom));

    for (let j = 0; j < g.nj; j += step) {
      for (let i = 0; i < g.ni; i += step) {
        const lat = g.lat1 - j * g.dj;
        let lon = g.lon1 + i * g.di;
        if (lon > 180) lon -= 360;

        const [sx, sy] = toScreen(lat, lon);
        if (sx < -30 || sy < -30 || sx > ctx.canvas.width + 30 || sy > ctx.canvas.height + 30) continue;

        const idx = j * g.ni + i;
        const u = windU.values[idx];
        const v = windV.values[idx];
        if (u === undefined || v === undefined) continue;

        const speed = Math.sqrt(u * u + v * v);
        const dir = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;

        if (windDisplayMode === 'barbs') {
          drawWindBarb(ctx, sx, sy, speed, dir);
        } else {
          drawWindArrow(ctx, sx, sy, speed, dir);
        }
      }
    }
  }

  // --- Pressure Rendering (Isobars) ---

  function renderPressure(ctx, toScreen, zoom, params) {
    const pressure = params.pressure;
    if (!pressure || !pressure.gridDef || !pressure.values) return;

    const g = pressure.gridDef;
    const interval = 4;
    const values = pressure.values;

    let minP = Infinity, maxP = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i] / 100;
      if (v < minP) minP = v;
      if (v > maxP) maxP = v;
    }

    const startP = Math.ceil(minP / interval) * interval;
    const endP = Math.floor(maxP / interval) * interval;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = '9px sans-serif';

    for (let level = startP; level <= endP; level += interval) {
      ctx.beginPath();
      ctx.strokeStyle = '#b0bec5';

      for (let j = 0; j < g.nj - 1; j += Math.max(1, Math.floor(3 / zoom))) {
        for (let i = 0; i < g.ni - 1; i += Math.max(1, Math.floor(3 / zoom))) {
          const idx00 = j * g.ni + i;
          const idx10 = j * g.ni + i + 1;
          const idx01 = (j + 1) * g.ni + i;
          const idx11 = (j + 1) * g.ni + i + 1;

          const v00 = values[idx00] / 100;
          const v10 = values[idx10] / 100;
          const v01 = values[idx01] / 100;
          const v11 = values[idx11] / 100;

          const threshold = level;
          const code = (v00 >= threshold ? 8 : 0) | (v10 >= threshold ? 4 : 0) |
                       (v11 >= threshold ? 2 : 0) | (v01 >= threshold ? 1 : 0);

          if (code === 0 || code === 15) continue;

          const lat0 = g.lat1 - j * g.dj;
          const lat1r = g.lat1 - (j + 1) * g.dj;
          let lon0 = g.lon1 + i * g.di;
          let lon1r = g.lon1 + (i + 1) * g.di;
          if (lon0 > 180) lon0 -= 360;
          if (lon1r > 180) lon1r -= 360;

          const edges = getMarchingEdges(code, v00, v10, v01, v11, threshold,
            lat0, lon0, lat1r, lon1r);

          for (const edge of edges) {
            const [sx1, sy1] = toScreen(edge[0], edge[1]);
            const [sx2, sy2] = toScreen(edge[2], edge[3]);
            ctx.moveTo(sx1, sy1);
            ctx.lineTo(sx2, sy2);
          }
        }
      }
      ctx.stroke();

      if (level % 8 === 0) {
        const midJ = Math.floor(g.nj / 2);
        const midI = Math.floor(g.ni / 2);
        const lat = g.lat1 - midJ * g.dj;
        let lon = g.lon1 + midI * g.di;
        if (lon > 180) lon -= 360;
        const [lx, ly] = toScreen(lat, lon);
        ctx.fillStyle = '#b0bec5';
        ctx.fillText(level + '', lx, ly);
      }
    }

    findPressureExtrema(values, g, toScreen, ctx);
    ctx.restore();
  }

  function getMarchingEdges(code, v00, v10, v01, v11, threshold, lat0, lon0, lat1, lon1) {
    const edges = [];
    const interp = (a, b, va, vb) => a + (threshold - va) / (vb - va) * (b - a);

    const top = [lat0, interp(lon0, lon1, v00, v10)];
    const bottom = [lat1, interp(lon0, lon1, v01, v11)];
    const left = [interp(lat0, lat1, v00, v01), lon0];
    const right = [interp(lat0, lat1, v10, v11), lon1];

    switch (code) {
      case 1: case 14: edges.push([left[0], left[1], bottom[0], bottom[1]]); break;
      case 2: case 13: edges.push([bottom[0], bottom[1], right[0], right[1]]); break;
      case 3: case 12: edges.push([left[0], left[1], right[0], right[1]]); break;
      case 4: case 11: edges.push([top[0], top[1], right[0], right[1]]); break;
      case 5: case 10: edges.push([top[0], top[1], left[0], left[1]]); edges.push([bottom[0], bottom[1], right[0], right[1]]); break;
      case 6: case 9: edges.push([top[0], top[1], bottom[0], bottom[1]]); break;
      case 7: case 8: edges.push([top[0], top[1], left[0], left[1]]); break;
    }
    return edges;
  }

  function findPressureExtrema(values, g, toScreen, ctx) {
    const checkSize = 5;
    for (let j = checkSize; j < g.nj - checkSize; j += checkSize * 2) {
      for (let i = checkSize; i < g.ni - checkSize; i += checkSize * 2) {
        const idx = j * g.ni + i;
        const v = values[idx] / 100;
        let isMax = true, isMin = true;

        for (let dj = -checkSize; dj <= checkSize && (isMax || isMin); dj++) {
          for (let di = -checkSize; di <= checkSize; di++) {
            if (dj === 0 && di === 0) continue;
            const nIdx = (j + dj) * g.ni + (i + di);
            if (nIdx < 0 || nIdx >= values.length) continue;
            const nv = values[nIdx] / 100;
            if (nv >= v) isMax = false;
            if (nv <= v) isMin = false;
          }
        }

        if (isMax || isMin) {
          const lat = g.lat1 - j * g.dj;
          let lon = g.lon1 + i * g.di;
          if (lon > 180) lon -= 360;
          const [sx, sy] = toScreen(lat, lon);
          ctx.font = 'bold 14px sans-serif';
          ctx.textAlign = 'center';
          if (isMax) {
            ctx.fillStyle = '#ef5350';
            ctx.fillText('H', sx, sy);
          } else {
            ctx.fillStyle = '#42a5f5';
            ctx.fillText('L', sx, sy);
          }
          ctx.font = '9px sans-serif';
          ctx.fillText(Math.round(v) + '', sx, sy + 12);
        }
      }
    }
  }

  // --- Temperature Overlay ---

  function renderTemperature(ctx, toScreen, zoom, params) {
    const temp = params.temperature;
    if (!temp || !temp.gridDef || !temp.values) return;

    const g = temp.gridDef;
    const step = Math.max(1, Math.floor(4 / zoom));

    ctx.globalAlpha = 0.4;
    const cellW = Math.max(2, zoom * g.di * 2);
    const cellH = Math.max(2, zoom * g.dj * 2);

    for (let j = 0; j < g.nj; j += step) {
      for (let i = 0; i < g.ni; i += step) {
        const idx = j * g.ni + i;
        let v = temp.values[idx];
        if (v > 200) v -= 273.15;

        const lat = g.lat1 - j * g.dj;
        let lon = g.lon1 + i * g.di;
        if (lon > 180) lon -= 360;
        const [sx, sy] = toScreen(lat, lon);
        if (sx < -cellW || sy < -cellH || sx > ctx.canvas.width + cellW || sy > ctx.canvas.height + cellH) continue;

        ctx.fillStyle = temperatureColor(v);
        ctx.fillRect(sx - cellW / 2, sy - cellH / 2, cellW, cellH);
      }
    }
    ctx.globalAlpha = 1.0;
  }

  function temperatureColor(celsius) {
    if (celsius < -20) return '#1a237e';
    if (celsius < -10) return '#283593';
    if (celsius < 0) return '#42a5f5';
    if (celsius < 10) return '#66bb6a';
    if (celsius < 20) return '#fdd835';
    if (celsius < 30) return '#ff9800';
    if (celsius < 40) return '#ef5350';
    return '#b71c1c';
  }

  // --- Wave Height Overlay ---

  function renderWaves(ctx, toScreen, zoom, params) {
    const waves = params.waveHeight;
    if (!waves || !waves.gridDef || !waves.values) return;

    const g = waves.gridDef;
    const step = Math.max(1, Math.floor(4 / zoom));
    ctx.globalAlpha = 0.4;
    const cellW = Math.max(2, zoom * g.di * 2);
    const cellH = Math.max(2, zoom * g.dj * 2);

    for (let j = 0; j < g.nj; j += step) {
      for (let i = 0; i < g.ni; i += step) {
        const idx = j * g.ni + i;
        const v = waves.values[idx];
        const lat = g.lat1 - j * g.dj;
        let lon = g.lon1 + i * g.di;
        if (lon > 180) lon -= 360;
        const [sx, sy] = toScreen(lat, lon);
        if (sx < -cellW || sy < -cellH || sx > ctx.canvas.width + cellW || sy > ctx.canvas.height + cellH) continue;

        ctx.fillStyle = waveColor(v);
        ctx.fillRect(sx - cellW / 2, sy - cellH / 2, cellW, cellH);
      }
    }
    ctx.globalAlpha = 1.0;
  }

  function waveColor(meters) {
    if (meters < 0.5) return '#1b5e20';
    if (meters < 1) return '#66bb6a';
    if (meters < 2) return '#fdd835';
    if (meters < 3) return '#ff9800';
    if (meters < 5) return '#ef5350';
    return '#b71c1c';
  }

  // --- Precipitation Overlay ---

  function renderPrecipitation(ctx, toScreen, zoom, params) {
    const precip = params.precipitation;
    if (!precip || !precip.gridDef || !precip.values) return;

    const g = precip.gridDef;
    const step = Math.max(1, Math.floor(4 / zoom));
    ctx.globalAlpha = 0.35;
    const cellW = Math.max(2, zoom * g.di * 2);
    const cellH = Math.max(2, zoom * g.dj * 2);

    for (let j = 0; j < g.nj; j += step) {
      for (let i = 0; i < g.ni; i += step) {
        const idx = j * g.ni + i;
        const v = precip.values[idx];
        if (v < 0.1) continue;

        const lat = g.lat1 - j * g.dj;
        let lon = g.lon1 + i * g.di;
        if (lon > 180) lon -= 360;
        const [sx, sy] = toScreen(lat, lon);
        if (sx < -cellW || sy < -cellH || sx > ctx.canvas.width + cellW || sy > ctx.canvas.height + cellH) continue;

        ctx.fillStyle = precipColor(v);
        ctx.fillRect(sx - cellW / 2, sy - cellH / 2, cellW, cellH);
      }
    }
    ctx.globalAlpha = 1.0;
  }

  function precipColor(mm) {
    if (mm < 1) return '#81d4fa';
    if (mm < 5) return '#4fc3f7';
    if (mm < 10) return '#039be5';
    if (mm < 20) return '#01579b';
    return '#4a148c';
  }

  // --- Main Render ---

  function render(ctx, toScreen, zoom) {
    if (!gribData || !gribData.timeSteps.length) return;
    const step = gribData.timeSteps[Math.min(timeIndex, gribData.timeSteps.length - 1)];
    if (!step) return;

    const params = step.params;

    if (activeOverlays.temperature) renderTemperature(ctx, toScreen, zoom, params);
    if (activeOverlays.waves) renderWaves(ctx, toScreen, zoom, params);
    if (activeOverlays.precipitation) renderPrecipitation(ctx, toScreen, zoom, params);
    if (activeOverlays.pressure) renderPressure(ctx, toScreen, zoom, params);
    if (activeOverlays.wind) renderWind(ctx, toScreen, zoom, params);
  }

  // --- Load File ---

  function loadFile(arrayBuffer) {
    try {
      gribData = parseGRIB2(arrayBuffer);
      timeIndex = 0;
      if (window.App && window.App.bus) {
        window.App.bus.emit('grib-loaded', { numSteps: gribData.numSteps });
      }
      if (window.App && window.App.storage) {
        window.App.storage.put('grib', 'current', arrayBuffer);
      }
      return { success: true, timeSteps: gribData.numSteps };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function setTimeIndex(i) {
    if (!gribData) return;
    timeIndex = Math.max(0, Math.min(i, gribData.timeSteps.length - 1));
    if (window.App && window.App.bus) {
      window.App.bus.emit('grib-time-changed', { index: timeIndex });
    }
  }

  // --- Animation ---

  function startAnimation(intervalMs) {
    if (animating) return;
    animating = true;
    animTimer = setInterval(function() {
      if (!gribData) return;
      timeIndex = (timeIndex + 1) % gribData.timeSteps.length;
      if (window.App && window.App.bus) {
        window.App.bus.emit('grib-time-changed', { index: timeIndex });
      }
    }, intervalMs || 1000);
  }

  function stopAnimation() {
    animating = false;
    if (animTimer) { clearInterval(animTimer); animTimer = null; }
  }

  // --- Control Panel ---

  function showControlPanel(container) {
    container.innerHTML = '';
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: 'rgba(22,33,62,0.95)',
      color: '#e0e0e0',
      fontFamily: 'sans-serif',
      fontSize: '13px',
      padding: '12px',
      borderRadius: '8px',
      border: '1px solid #53a8b6',
      maxWidth: '360px'
    });

    const title = document.createElement('div');
    title.textContent = 'GRIB Weather Overlay';
    title.style.cssText = 'color:#53a8b6;font-weight:bold;font-size:14px;margin-bottom:10px;';
    panel.appendChild(title);

    // File loader
    const fileRow = document.createElement('div');
    fileRow.style.marginBottom = '10px';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.grb,.grib,.grib2';
    fileInput.style.cssText = 'font-size:11px;color:#e0e0e0;';
    fileInput.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(ev) {
        const result = loadFile(ev.target.result);
        statusEl.textContent = result.success ?
          `Loaded: ${result.timeSteps} time steps` : `Error: ${result.error}`;
        updateSlider();
      };
      reader.readAsArrayBuffer(file);
    });
    fileRow.appendChild(fileInput);
    panel.appendChild(fileRow);

    // Status
    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'font-size:11px;color:#90a4ae;margin-bottom:8px;';
    statusEl.textContent = gribData ? `Loaded: ${gribData.numSteps} time steps` : 'No GRIB file loaded';
    panel.appendChild(statusEl);

    // Overlay toggles
    const overlayNames = { wind: 'Wind', pressure: 'Pressure', temperature: 'Temperature', waves: 'Waves', precipitation: 'Precipitation' };
    const toggleRow = document.createElement('div');
    toggleRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;';
    for (const [key, label] of Object.entries(overlayNames)) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `padding:3px 8px;font-size:11px;border-radius:4px;border:1px solid #53a8b6;cursor:pointer;
        background:${activeOverlays[key] ? '#53a8b6' : 'transparent'};color:${activeOverlays[key] ? '#0d1b2a' : '#e0e0e0'};`;
      btn.addEventListener('click', function() {
        activeOverlays[key] = !activeOverlays[key];
        btn.style.background = activeOverlays[key] ? '#53a8b6' : 'transparent';
        btn.style.color = activeOverlays[key] ? '#0d1b2a' : '#e0e0e0';
      });
      toggleRow.appendChild(btn);
    }
    panel.appendChild(toggleRow);

    // Wind mode toggle
    const windRow = document.createElement('div');
    windRow.style.marginBottom = '10px';
    const windLabel = document.createElement('span');
    windLabel.textContent = 'Wind: ';
    windLabel.style.fontSize = '11px';
    windRow.appendChild(windLabel);
    const barbBtn = document.createElement('button');
    barbBtn.textContent = 'Barbs';
    barbBtn.style.cssText = 'padding:2px 6px;font-size:11px;border-radius:3px;border:1px solid #53a8b6;cursor:pointer;margin-right:4px;background:' + (windDisplayMode === 'barbs' ? '#53a8b6' : 'transparent') + ';color:' + (windDisplayMode === 'barbs' ? '#0d1b2a' : '#e0e0e0') + ';';
    const arrowBtn = document.createElement('button');
    arrowBtn.textContent = 'Arrows';
    arrowBtn.style.cssText = 'padding:2px 6px;font-size:11px;border-radius:3px;border:1px solid #53a8b6;cursor:pointer;background:' + (windDisplayMode === 'arrows' ? '#53a8b6' : 'transparent') + ';color:' + (windDisplayMode === 'arrows' ? '#0d1b2a' : '#e0e0e0') + ';';
    barbBtn.addEventListener('click', function() {
      windDisplayMode = 'barbs';
      barbBtn.style.background = '#53a8b6'; barbBtn.style.color = '#0d1b2a';
      arrowBtn.style.background = 'transparent'; arrowBtn.style.color = '#e0e0e0';
    });
    arrowBtn.addEventListener('click', function() {
      windDisplayMode = 'arrows';
      arrowBtn.style.background = '#53a8b6'; arrowBtn.style.color = '#0d1b2a';
      barbBtn.style.background = 'transparent'; barbBtn.style.color = '#e0e0e0';
    });
    windRow.appendChild(barbBtn);
    windRow.appendChild(arrowBtn);
    panel.appendChild(windRow);

    // Time slider
    const timeRow = document.createElement('div');
    timeRow.style.marginBottom = '8px';
    const timeLabel = document.createElement('div');
    timeLabel.style.cssText = 'font-size:11px;margin-bottom:4px;';
    timeRow.appendChild(timeLabel);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '0';
    slider.value = '0';
    slider.style.cssText = 'width:100%;accent-color:#53a8b6;';
    slider.addEventListener('input', function() {
      setTimeIndex(parseInt(slider.value));
      updateTimeLabel();
    });
    timeRow.appendChild(slider);
    panel.appendChild(timeRow);

    // Play/Pause
    const playRow = document.createElement('div');
    const playBtn = document.createElement('button');
    playBtn.textContent = '▶ Play';
    playBtn.style.cssText = 'padding:4px 12px;font-size:12px;border-radius:4px;border:1px solid #53a8b6;cursor:pointer;background:transparent;color:#53a8b6;';
    playBtn.addEventListener('click', function() {
      if (animating) {
        stopAnimation();
        playBtn.textContent = '▶ Play';
      } else {
        startAnimation(800);
        playBtn.textContent = '⏸ Pause';
      }
    });
    playRow.appendChild(playBtn);
    panel.appendChild(playRow);

    function updateSlider() {
      if (!gribData) return;
      slider.max = String(gribData.timeSteps.length - 1);
      slider.value = String(timeIndex);
      updateTimeLabel();
    }

    function updateTimeLabel() {
      if (!gribData || !gribData.timeSteps.length) {
        timeLabel.textContent = 'Time: --';
        return;
      }
      const step = gribData.timeSteps[timeIndex];
      const validTime = step.refTime ? new Date(step.refTime.getTime() + step.forecastTime * 3600000) : null;
      timeLabel.textContent = validTime ?
        `Time: ${validTime.toISOString().slice(0, 16).replace('T', ' ')} UTC (T+${step.forecastTime}h)` :
        `Step ${timeIndex + 1}/${gribData.timeSteps.length}`;
    }

    updateSlider();

    if (window.App && window.App.bus) {
      window.App.bus.on('grib-time-changed', function() {
        slider.value = String(timeIndex);
        updateTimeLabel();
      });
    }

    container.appendChild(panel);
  }

  // --- Public API ---
  window.GribOverlay = {
    loadFile: loadFile,
    render: render,
    setTimeIndex: setTimeIndex,
    showControlPanel: showControlPanel,
    startAnimation: startAnimation,
    stopAnimation: stopAnimation,
    setOverlay: function(name, enabled) { if (name in activeOverlays) activeOverlays[name] = enabled; },
    setWindMode: function(mode) { windDisplayMode = mode === 'arrows' ? 'arrows' : 'barbs'; },
    getData: function() { return gribData; },
    getTimeIndex: function() { return timeIndex; }
  };

})();
