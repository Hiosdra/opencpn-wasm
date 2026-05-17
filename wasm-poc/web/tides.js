/**
 * Tides and Currents Display for OpenCPN WASM
 * Provides tide prediction, station display, current arrows, and tide panel.
 */
(function() {
  'use strict';

  // --- Tide Station Database (~50 major stations worldwide) ---
  // Each station: { id, name, lat, lon, harmonics: { M2, S2, K1, O1 } }
  // Harmonics: { amp (meters), phase (degrees) }
  const STATIONS = [
    { id: 'seattle', name: 'Seattle, WA', lat: 47.6025, lon: -122.3393, harmonics: { M2: { amp: 1.12, phase: 235 }, S2: { amp: 0.28, phase: 265 }, K1: { amp: 0.84, phase: 135 }, O1: { amp: 0.50, phase: 120 } } },
    { id: 'sanfran', name: 'San Francisco, CA', lat: 37.8067, lon: -122.4650, harmonics: { M2: { amp: 0.58, phase: 194 }, S2: { amp: 0.14, phase: 220 }, K1: { amp: 0.37, phase: 100 }, O1: { amp: 0.23, phase: 90 } } },
    { id: 'newyork', name: 'New York (The Battery)', lat: 40.7003, lon: -74.0142, harmonics: { M2: { amp: 0.67, phase: 17 }, S2: { amp: 0.16, phase: 45 }, K1: { amp: 0.10, phase: 320 }, O1: { amp: 0.06, phase: 300 } } },
    { id: 'boston', name: 'Boston, MA', lat: 42.3539, lon: -71.0503, harmonics: { M2: { amp: 1.40, phase: 348 }, S2: { amp: 0.25, phase: 20 }, K1: { amp: 0.14, phase: 100 }, O1: { amp: 0.10, phase: 85 } } },
    { id: 'miami', name: 'Miami, FL', lat: 25.7617, lon: -80.1867, harmonics: { M2: { amp: 0.19, phase: 340 }, S2: { amp: 0.06, phase: 10 }, K1: { amp: 0.08, phase: 5 }, O1: { amp: 0.07, phase: 350 } } },
    { id: 'galveston', name: 'Galveston, TX', lat: 29.3100, lon: -94.7933, harmonics: { M2: { amp: 0.15, phase: 50 }, S2: { amp: 0.04, phase: 80 }, K1: { amp: 0.14, phase: 10 }, O1: { amp: 0.14, phase: 355 } } },
    { id: 'anchorage', name: 'Anchorage, AK', lat: 61.2375, lon: -149.8908, harmonics: { M2: { amp: 3.54, phase: 320 }, S2: { amp: 0.98, phase: 355 }, K1: { amp: 0.65, phase: 270 }, O1: { amp: 0.40, phase: 255 } } },
    { id: 'honolulu', name: 'Honolulu, HI', lat: 21.3069, lon: -157.8672, harmonics: { M2: { amp: 0.19, phase: 60 }, S2: { amp: 0.07, phase: 55 }, K1: { amp: 0.16, phase: 85 }, O1: { amp: 0.09, phase: 65 } } },
    { id: 'juneau', name: 'Juneau, AK', lat: 58.2994, lon: -134.4117, harmonics: { M2: { amp: 2.41, phase: 290 }, S2: { amp: 0.66, phase: 320 }, K1: { amp: 0.48, phase: 260 }, O1: { amp: 0.30, phase: 245 } } },
    { id: 'charleston', name: 'Charleston, SC', lat: 32.7817, lon: -79.9250, harmonics: { M2: { amp: 0.78, phase: 355 }, S2: { amp: 0.14, phase: 30 }, K1: { amp: 0.10, phase: 15 }, O1: { amp: 0.07, phase: 5 } } },
    { id: 'london', name: 'London (Tower Pier)', lat: 51.5056, lon: -0.0764, harmonics: { M2: { amp: 2.19, phase: 338 }, S2: { amp: 0.70, phase: 15 }, K1: { amp: 0.12, phase: 155 }, O1: { amp: 0.10, phase: 130 } } },
    { id: 'dover', name: 'Dover, UK', lat: 51.1167, lon: 1.3167, harmonics: { M2: { amp: 2.30, phase: 330 }, S2: { amp: 0.75, phase: 5 }, K1: { amp: 0.08, phase: 140 }, O1: { amp: 0.06, phase: 125 } } },
    { id: 'brest', name: 'Brest, France', lat: 48.3833, lon: -4.4833, harmonics: { M2: { amp: 2.08, phase: 115 }, S2: { amp: 0.75, phase: 150 }, K1: { amp: 0.07, phase: 200 }, O1: { amp: 0.06, phase: 180 } } },
    { id: 'hamburg', name: 'Hamburg, Germany', lat: 53.5461, lon: 9.9689, harmonics: { M2: { amp: 1.45, phase: 290 }, S2: { amp: 0.40, phase: 325 }, K1: { amp: 0.08, phase: 60 }, O1: { amp: 0.06, phase: 45 } } },
    { id: 'rotterdam', name: 'Rotterdam, Netherlands', lat: 51.9000, lon: 4.5000, harmonics: { M2: { amp: 0.78, phase: 310 }, S2: { amp: 0.21, phase: 345 }, K1: { amp: 0.06, phase: 100 }, O1: { amp: 0.04, phase: 85 } } },
    { id: 'lisbon', name: 'Lisbon, Portugal', lat: 38.6942, lon: -9.1772, harmonics: { M2: { amp: 1.05, phase: 55 }, S2: { amp: 0.38, phase: 85 }, K1: { amp: 0.07, phase: 50 }, O1: { amp: 0.05, phase: 35 } } },
    { id: 'gibraltar', name: 'Gibraltar', lat: 36.1408, lon: -5.3536, harmonics: { M2: { amp: 0.30, phase: 45 }, S2: { amp: 0.12, phase: 75 }, K1: { amp: 0.04, phase: 60 }, O1: { amp: 0.02, phase: 45 } } },
    { id: 'naples', name: 'Naples, Italy', lat: 40.8375, lon: 14.2681, harmonics: { M2: { amp: 0.10, phase: 280 }, S2: { amp: 0.04, phase: 310 }, K1: { amp: 0.05, phase: 55 }, O1: { amp: 0.03, phase: 40 } } },
    { id: 'piraeus', name: 'Piraeus, Greece', lat: 37.9419, lon: 23.6278, harmonics: { M2: { amp: 0.05, phase: 60 }, S2: { amp: 0.02, phase: 90 }, K1: { amp: 0.03, phase: 50 }, O1: { amp: 0.02, phase: 35 } } },
    { id: 'istanbul', name: 'Istanbul, Turkey', lat: 41.0136, lon: 28.9550, harmonics: { M2: { amp: 0.03, phase: 180 }, S2: { amp: 0.01, phase: 210 }, K1: { amp: 0.05, phase: 30 }, O1: { amp: 0.03, phase: 15 } } },
    { id: 'suez', name: 'Suez, Egypt', lat: 29.9667, lon: 32.5500, harmonics: { M2: { amp: 0.40, phase: 120 }, S2: { amp: 0.15, phase: 155 }, K1: { amp: 0.05, phase: 80 }, O1: { amp: 0.03, phase: 65 } } },
    { id: 'mumbai', name: 'Mumbai, India', lat: 18.9322, lon: 72.8347, harmonics: { M2: { amp: 1.50, phase: 320 }, S2: { amp: 0.62, phase: 355 }, K1: { amp: 0.30, phase: 310 }, O1: { amp: 0.13, phase: 295 } } },
    { id: 'singapore', name: 'Singapore', lat: 1.2644, lon: 103.8203, harmonics: { M2: { amp: 0.76, phase: 100 }, S2: { amp: 0.37, phase: 140 }, K1: { amp: 0.30, phase: 350 }, O1: { amp: 0.20, phase: 335 } } },
    { id: 'hongkong', name: 'Hong Kong', lat: 22.2833, lon: 114.1667, harmonics: { M2: { amp: 0.37, phase: 200 }, S2: { amp: 0.14, phase: 240 }, K1: { amp: 0.31, phase: 320 }, O1: { amp: 0.23, phase: 300 } } },
    { id: 'shanghai', name: 'Shanghai, China', lat: 31.3833, lon: 121.5000, harmonics: { M2: { amp: 1.58, phase: 245 }, S2: { amp: 0.58, phase: 285 }, K1: { amp: 0.25, phase: 220 }, O1: { amp: 0.16, phase: 200 } } },
    { id: 'tokyo', name: 'Tokyo, Japan', lat: 35.6528, lon: 139.7700, harmonics: { M2: { amp: 0.46, phase: 295 }, S2: { amp: 0.20, phase: 340 }, K1: { amp: 0.23, phase: 200 }, O1: { amp: 0.15, phase: 180 } } },
    { id: 'sydney', name: 'Sydney, Australia', lat: -33.8569, lon: 151.2108, harmonics: { M2: { amp: 0.50, phase: 225 }, S2: { amp: 0.10, phase: 260 }, K1: { amp: 0.15, phase: 30 }, O1: { amp: 0.10, phase: 15 } } },
    { id: 'auckland', name: 'Auckland, NZ', lat: -36.8406, lon: 174.7656, harmonics: { M2: { amp: 1.00, phase: 255 }, S2: { amp: 0.20, phase: 290 }, K1: { amp: 0.10, phase: 60 }, O1: { amp: 0.05, phase: 45 } } },
    { id: 'capetown', name: 'Cape Town, SA', lat: -33.9039, lon: 18.4017, harmonics: { M2: { amp: 0.47, phase: 70 }, S2: { amp: 0.17, phase: 105 }, K1: { amp: 0.06, phase: 330 }, O1: { amp: 0.05, phase: 315 } } },
    { id: 'dakar', name: 'Dakar, Senegal', lat: 14.6928, lon: -17.4467, harmonics: { M2: { amp: 0.48, phase: 340 }, S2: { amp: 0.18, phase: 15 }, K1: { amp: 0.06, phase: 30 }, O1: { amp: 0.04, phase: 15 } } },
    { id: 'riodejaneiro', name: 'Rio de Janeiro, Brazil', lat: -22.8833, lon: -43.1667, harmonics: { M2: { amp: 0.30, phase: 85 }, S2: { amp: 0.12, phase: 105 }, K1: { amp: 0.06, phase: 180 }, O1: { amp: 0.05, phase: 165 } } },
    { id: 'buenosaires', name: 'Buenos Aires, Argentina', lat: -34.5833, lon: -58.3667, harmonics: { M2: { amp: 0.32, phase: 230 }, S2: { amp: 0.12, phase: 270 }, K1: { amp: 0.08, phase: 150 }, O1: { amp: 0.06, phase: 135 } } },
    { id: 'panama', name: 'Panama City (Pacific)', lat: 8.9500, lon: -79.5333, harmonics: { M2: { amp: 1.63, phase: 130 }, S2: { amp: 0.55, phase: 160 }, K1: { amp: 0.27, phase: 220 }, O1: { amp: 0.16, phase: 200 } } },
    { id: 'vancouver', name: 'Vancouver, BC', lat: 49.2900, lon: -123.1117, harmonics: { M2: { amp: 1.00, phase: 242 }, S2: { amp: 0.26, phase: 270 }, K1: { amp: 0.82, phase: 140 }, O1: { amp: 0.48, phase: 125 } } },
    { id: 'victoria', name: 'Victoria, BC', lat: 48.4236, lon: -123.3692, harmonics: { M2: { amp: 0.58, phase: 248 }, S2: { amp: 0.14, phase: 278 }, K1: { amp: 0.70, phase: 138 }, O1: { amp: 0.42, phase: 123 } } },
    { id: 'portland', name: 'Portland, ME', lat: 43.6567, lon: -70.2467, harmonics: { M2: { amp: 1.35, phase: 350 }, S2: { amp: 0.24, phase: 22 }, K1: { amp: 0.14, phase: 95 }, O1: { amp: 0.10, phase: 80 } } },
    { id: 'norfolk', name: 'Norfolk, VA', lat: 36.9450, lon: -76.3300, harmonics: { M2: { amp: 0.37, phase: 5 }, S2: { amp: 0.06, phase: 35 }, K1: { amp: 0.08, phase: 10 }, O1: { amp: 0.06, phase: 355 } } },
    { id: 'keywest', name: 'Key West, FL', lat: 24.5508, lon: -81.8075, harmonics: { M2: { amp: 0.17, phase: 350 }, S2: { amp: 0.05, phase: 25 }, K1: { amp: 0.09, phase: 5 }, O1: { amp: 0.08, phase: 350 } } },
    { id: 'sandiego', name: 'San Diego, CA', lat: 32.7142, lon: -117.1733, harmonics: { M2: { amp: 0.52, phase: 185 }, S2: { amp: 0.15, phase: 210 }, K1: { amp: 0.33, phase: 100 }, O1: { amp: 0.21, phase: 85 } } },
    { id: 'losangeles', name: 'Los Angeles, CA', lat: 33.7200, lon: -118.2717, harmonics: { M2: { amp: 0.52, phase: 187 }, S2: { amp: 0.14, phase: 212 }, K1: { amp: 0.33, phase: 102 }, O1: { amp: 0.22, phase: 87 } } },
    { id: 'astoria', name: 'Astoria, OR', lat: 46.2075, lon: -123.7683, harmonics: { M2: { amp: 0.90, phase: 215 }, S2: { amp: 0.20, phase: 245 }, K1: { amp: 0.42, phase: 125 }, O1: { amp: 0.26, phase: 110 } } },
    { id: 'darwin', name: 'Darwin, Australia', lat: -12.4500, lon: 130.8333, harmonics: { M2: { amp: 1.82, phase: 300 }, S2: { amp: 0.90, phase: 340 }, K1: { amp: 0.58, phase: 340 }, O1: { amp: 0.30, phase: 320 } } },
    { id: 'hobart', name: 'Hobart, Australia', lat: -42.8833, lon: 147.3333, harmonics: { M2: { amp: 0.38, phase: 190 }, S2: { amp: 0.07, phase: 230 }, K1: { amp: 0.14, phase: 30 }, O1: { amp: 0.09, phase: 15 } } },
    { id: 'wellington', name: 'Wellington, NZ', lat: -41.2833, lon: 174.7833, harmonics: { M2: { amp: 0.44, phase: 200 }, S2: { amp: 0.08, phase: 240 }, K1: { amp: 0.07, phase: 45 }, O1: { amp: 0.04, phase: 30 } } },
    { id: 'reykjavik', name: 'Reykjavik, Iceland', lat: 64.1500, lon: -21.9333, harmonics: { M2: { amp: 1.32, phase: 155 }, S2: { amp: 0.40, phase: 190 }, K1: { amp: 0.10, phase: 175 }, O1: { amp: 0.06, phase: 155 } } },
    { id: 'bergen', name: 'Bergen, Norway', lat: 60.3944, lon: 5.3250, harmonics: { M2: { amp: 0.40, phase: 295 }, S2: { amp: 0.13, phase: 330 }, K1: { amp: 0.04, phase: 10 }, O1: { amp: 0.02, phase: 355 } } },
    { id: 'copenhagen', name: 'Copenhagen, Denmark', lat: 55.6931, lon: 12.5992, harmonics: { M2: { amp: 0.10, phase: 115 }, S2: { amp: 0.03, phase: 145 }, K1: { amp: 0.03, phase: 60 }, O1: { amp: 0.02, phase: 45 } } },
    { id: 'aden', name: 'Aden, Yemen', lat: 12.7833, lon: 45.0167, harmonics: { M2: { amp: 0.55, phase: 45 }, S2: { amp: 0.22, phase: 80 }, K1: { amp: 0.22, phase: 330 }, O1: { amp: 0.15, phase: 315 } } },
    { id: 'colombo', name: 'Colombo, Sri Lanka', lat: 6.9344, lon: 79.8500, harmonics: { M2: { amp: 0.20, phase: 70 }, S2: { amp: 0.08, phase: 100 }, K1: { amp: 0.10, phase: 350 }, O1: { amp: 0.04, phase: 330 } } },
    { id: 'ushuaia', name: 'Ushuaia, Argentina', lat: -54.8000, lon: -68.3000, harmonics: { M2: { amp: 0.55, phase: 120 }, S2: { amp: 0.20, phase: 155 }, K1: { amp: 0.15, phase: 50 }, O1: { amp: 0.10, phase: 35 } } },
  ];

  // Constituent angular speeds (degrees per hour)
  const SPEEDS = {
    M2: 28.984104,  // Principal lunar semidiurnal
    S2: 30.000000,  // Principal solar semidiurnal
    K1: 15.041069,  // Luni-solar diurnal
    O1: 13.943036   // Principal lunar diurnal
  };

  // --- Simplified Current Data (major straits/channels) ---
  const CURRENTS = [
    { name: 'Golden Gate', lat: 37.81, lon: -122.47, maxSpeed: 4.5, floodDir: 70, ebbDir: 250 },
    { name: 'The Narrows (NY)', lat: 40.61, lon: -74.04, maxSpeed: 3.0, floodDir: 0, ebbDir: 180 },
    { name: 'Strait of Juan de Fuca', lat: 48.38, lon: -123.50, maxSpeed: 3.0, floodDir: 90, ebbDir: 270 },
    { name: 'Strait of Gibraltar', lat: 35.98, lon: -5.50, maxSpeed: 4.0, floodDir: 80, ebbDir: 260 },
    { name: 'Singapore Strait', lat: 1.20, lon: 103.85, maxSpeed: 3.5, floodDir: 270, ebbDir: 90 },
    { name: 'English Channel (Dover)', lat: 51.00, lon: 1.50, maxSpeed: 3.5, floodDir: 40, ebbDir: 220 },
    { name: 'Bosphorus', lat: 41.10, lon: 29.05, maxSpeed: 3.0, floodDir: 25, ebbDir: 205 },
    { name: 'Puget Sound (Admiralty)', lat: 48.17, lon: -122.73, maxSpeed: 5.0, floodDir: 180, ebbDir: 0 },
    { name: 'Deception Pass, WA', lat: 48.40, lon: -122.64, maxSpeed: 8.0, floodDir: 90, ebbDir: 270 },
    { name: 'Race Rocks, BC', lat: 48.30, lon: -123.53, maxSpeed: 6.0, floodDir: 60, ebbDir: 240 },
    { name: 'Malacca Strait', lat: 2.50, lon: 101.70, maxSpeed: 2.5, floodDir: 315, ebbDir: 135 },
    { name: 'Torres Strait', lat: -10.58, lon: 142.20, maxSpeed: 4.0, floodDir: 270, ebbDir: 90 },
  ];

  // --- Tide Prediction Engine ---

  function predictTide(station, time) {
    const t = (typeof time === 'number') ? time : time.getTime();
    const hours = t / 3600000;
    let height = 0;
    for (const [constituent, params] of Object.entries(station.harmonics)) {
      const speed = SPEEDS[constituent];
      if (!speed) continue;
      const angle = (speed * hours + params.phase) * Math.PI / 180;
      height += params.amp * Math.cos(angle);
    }
    return height;
  }

  function predictTideCurve(station, startTime, hours) {
    const startMs = (typeof startTime === 'number') ? startTime : startTime.getTime();
    const points = [];
    const step = hours <= 6 ? 5 : hours <= 24 ? 10 : 30;
    for (let m = 0; m <= hours * 60; m += step) {
      const t = startMs + m * 60000;
      points.push({ time: t, height: predictTide(station, t) });
    }
    return points;
  }

  function getCurrentState(station, time) {
    const t = (typeof time === 'number') ? time : time.getTime();
    const h0 = predictTide(station, t - 300000);
    const h1 = predictTide(station, t);
    return { height: h1, rising: h1 > h0 };
  }

  function findNextHighLow(station, fromTime, lookAheadHours) {
    lookAheadHours = lookAheadHours || 14;
    const from = (typeof fromTime === 'number') ? fromTime : fromTime.getTime();
    const results = [];
    let prevH = predictTide(station, from);
    let prevSlope = null;
    for (let m = 10; m <= lookAheadHours * 60; m += 10) {
      const t = from + m * 60000;
      const h = predictTide(station, t);
      const slope = h - prevH;
      if (prevSlope !== null) {
        if (prevSlope > 0 && slope <= 0) {
          results.push({ type: 'high', time: t - 300000, height: predictTide(station, t - 300000) });
        } else if (prevSlope < 0 && slope >= 0) {
          results.push({ type: 'low', time: t - 300000, height: predictTide(station, t - 300000) });
        }
      }
      prevSlope = slope;
      prevH = h;
    }
    return results;
  }

  function getCurrentForTime(current, time) {
    const t = (typeof time === 'number') ? time : time.getTime();
    const hours = t / 3600000;
    const cycle = Math.cos(SPEEDS.M2 * hours * Math.PI / 180);
    const speed = Math.abs(cycle) * current.maxSpeed;
    const dir = cycle > 0 ? current.floodDir : current.ebbDir;
    return { speed, dir };
  }

  // --- Nearest Station ---
  function findNearestStation(lat, lon) {
    let best = null, bestDist = Infinity;
    for (const s of STATIONS) {
      const d = Math.hypot(s.lat - lat, s.lon - lon);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    return best;
  }

  // --- Rendering ---
  let selectedStation = null;

  function render(ctx, toScreen, zoom) {
    const now = Date.now();

    // Draw tide station diamonds
    for (const station of STATIONS) {
      const [sx, sy] = toScreen(station.lat, station.lon);
      if (sx < -20 || sy < -20 || sx > ctx.canvas.width + 20 || sy > ctx.canvas.height + 20) continue;

      const state = getCurrentState(station, now);
      const size = Math.max(5, Math.min(10, zoom * 0.8));

      ctx.save();
      ctx.translate(sx, sy);
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.7, 0);
      ctx.lineTo(0, size);
      ctx.lineTo(-size * 0.7, 0);
      ctx.closePath();
      ctx.fillStyle = state.rising ? '#4caf50' : '#e53935';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();

      if (zoom > 8) {
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(state.height.toFixed(1) + 'm', 0, -size - 4);
      }
      ctx.restore();
    }

    // Draw current arrows
    for (const current of CURRENTS) {
      const [sx, sy] = toScreen(current.lat, current.lon);
      if (sx < -30 || sy < -30 || sx > ctx.canvas.width + 30 || sy > ctx.canvas.height + 30) continue;

      const { speed, dir } = getCurrentForTime(current, now);
      if (speed < 0.1) continue;

      const arrowLen = Math.min(30, 6 + speed * 5);
      const rad = (dir - 90) * Math.PI / 180;

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(rad);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(arrowLen, 0);
      ctx.lineTo(arrowLen - 5, -3);
      ctx.moveTo(arrowLen, 0);
      ctx.lineTo(arrowLen - 5, 3);

      if (speed < 1.5) ctx.strokeStyle = '#4fc3f7';
      else if (speed < 3) ctx.strokeStyle = '#ffb74d';
      else ctx.strokeStyle = '#e53935';

      ctx.lineWidth = Math.max(1.5, speed * 0.5);
      ctx.stroke();

      if (zoom > 6) {
        ctx.rotate(-rad);
        ctx.font = '9px sans-serif';
        ctx.fillStyle = '#b0bec5';
        ctx.textAlign = 'center';
        ctx.fillText(speed.toFixed(1) + 'kn', 0, -8);
      }
      ctx.restore();
    }
  }

  // --- Tide Panel ---
  function showTidePanel(container) {
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
      maxWidth: '400px',
      minHeight: '250px'
    });

    // Station selector
    const select = document.createElement('select');
    Object.assign(select.style, {
      width: '100%', marginBottom: '8px', padding: '4px',
      background: '#1a2744', color: '#e0e0e0', border: '1px solid #53a8b6',
      borderRadius: '4px', fontSize: '12px'
    });
    for (const s of STATIONS) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (selectedStation && selectedStation.id === s.id) opt.selected = true;
      select.appendChild(opt);
    }
    if (!selectedStation) selectedStation = STATIONS[0];
    panel.appendChild(select);

    // Info area
    const info = document.createElement('div');
    info.style.marginBottom = '8px';
    panel.appendChild(info);

    // Canvas for tide curve
    const canvas = document.createElement('canvas');
    canvas.width = 376;
    canvas.height = 140;
    canvas.style.width = '100%';
    canvas.style.borderRadius = '4px';
    canvas.style.background = '#0d1b2a';
    panel.appendChild(canvas);

    function updatePanel() {
      const station = STATIONS.find(s => s.id === select.value) || STATIONS[0];
      selectedStation = station;
      const now = Date.now();
      const state = getCurrentState(station, now);
      const nextHL = findNextHighLow(station, now);
      const nextEvent = nextHL[0];

      let infoHtml = `<div style="color:#53a8b6;font-weight:bold;margin-bottom:4px">${station.name}</div>`;
      infoHtml += `<span>Height: <b>${state.height.toFixed(2)}m</b> (${state.rising ? '↑ Rising' : '↓ Falling'})</span>`;
      if (nextEvent) {
        const minsTo = Math.round((nextEvent.time - now) / 60000);
        const h = Math.floor(minsTo / 60);
        const m = minsTo % 60;
        infoHtml += `<br>Next ${nextEvent.type}: ${nextEvent.height.toFixed(2)}m in ${h}h ${m}m`;
      }
      info.innerHTML = infoHtml;

      // Draw tide curve
      const cCtx = canvas.getContext('2d');
      cCtx.clearRect(0, 0, canvas.width, canvas.height);
      const startTime = now - 6 * 3600000;
      const curve = predictTideCurve(station, startTime, 24);

      if (curve.length < 2) return;
      const heights = curve.map(p => p.height);
      const minH = Math.min(...heights) - 0.2;
      const maxH = Math.max(...heights) + 0.2;
      const range = maxH - minH || 1;

      const w = canvas.width, h = canvas.height;
      const pad = { top: 15, bottom: 20, left: 35, right: 10 };

      // Grid lines
      cCtx.strokeStyle = '#1a3055';
      cCtx.lineWidth = 0.5;
      for (let v = Math.ceil(minH); v <= Math.floor(maxH); v += 0.5) {
        const y = pad.top + (1 - (v - minH) / range) * (h - pad.top - pad.bottom);
        cCtx.beginPath(); cCtx.moveTo(pad.left, y); cCtx.lineTo(w - pad.right, y); cCtx.stroke();
        cCtx.fillStyle = '#607d8b';
        cCtx.font = '9px sans-serif';
        cCtx.textAlign = 'right';
        cCtx.fillText(v.toFixed(1), pad.left - 4, y + 3);
      }

      // Time labels
      cCtx.fillStyle = '#607d8b';
      cCtx.font = '9px sans-serif';
      cCtx.textAlign = 'center';
      for (let i = 0; i <= 24; i += 3) {
        const x = pad.left + (i / 24) * (w - pad.left - pad.right);
        const t = new Date(startTime + i * 3600000);
        cCtx.fillText(t.getHours().toString().padStart(2, '0') + ':00', x, h - 4);
      }

      // Tide curve
      cCtx.beginPath();
      for (let i = 0; i < curve.length; i++) {
        const x = pad.left + ((curve[i].time - startTime) / (24 * 3600000)) * (w - pad.left - pad.right);
        const y = pad.top + (1 - (curve[i].height - minH) / range) * (h - pad.top - pad.bottom);
        if (i === 0) cCtx.moveTo(x, y); else cCtx.lineTo(x, y);
      }
      cCtx.strokeStyle = '#53a8b6';
      cCtx.lineWidth = 2;
      cCtx.stroke();

      // Current time marker
      const nowX = pad.left + ((now - startTime) / (24 * 3600000)) * (w - pad.left - pad.right);
      cCtx.beginPath();
      cCtx.moveTo(nowX, pad.top);
      cCtx.lineTo(nowX, h - pad.bottom);
      cCtx.strokeStyle = '#ffab40';
      cCtx.lineWidth = 1;
      cCtx.setLineDash([3, 3]);
      cCtx.stroke();
      cCtx.setLineDash([]);

      // Current height dot
      const nowY = pad.top + (1 - (state.height - minH) / range) * (h - pad.top - pad.bottom);
      cCtx.beginPath();
      cCtx.arc(nowX, nowY, 4, 0, Math.PI * 2);
      cCtx.fillStyle = '#ffab40';
      cCtx.fill();
    }

    select.addEventListener('change', updatePanel);
    updatePanel();
    container.appendChild(panel);
  }

  // --- Handle station click ---
  function handleClick(lat, lon, screenX, screenY, container) {
    const nearest = findNearestStation(lat, lon);
    if (!nearest) return;
    const dist = Math.hypot(nearest.lat - lat, nearest.lon - lon);
    if (dist > 2) return;
    selectedStation = nearest;
    if (container) showTidePanel(container);
  }

  // --- Public API ---
  window.TidesDisplay = {
    render: render,
    showTidePanel: showTidePanel,
    predictTide: predictTide,
    predictTideCurve: predictTideCurve,
    findNearestStation: findNearestStation,
    handleClick: handleClick,
    getStations: function() { return STATIONS; },
    getCurrents: function() { return CURRENTS; }
  };

})();
