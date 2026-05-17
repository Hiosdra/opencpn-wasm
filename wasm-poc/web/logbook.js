/**
 * Voyage Logbook for OpenCPN WASM
 * Auto-logs vessel state, supports manual entries, viewing, and export.
 */
(function() {
  'use strict';

  // --- State ---
  let running = false;
  let intervalId = null;
  let logInterval = 10 * 60 * 1000;
  let entries = [];
  let busUnsubscribe = null;

  // --- Storage helpers ---
  const STORE_KEY = 'logbook';

  async function loadEntries() {
    if (!window.App || !window.App.storage) return;
    try {
      const stored = await window.App.storage.getAll(STORE_KEY);
      if (Array.isArray(stored)) {
        entries = stored.sort(function(a, b) { return a.time - b.time; });
      }
    } catch (e) {
      // Storage not available yet
    }
  }

  async function saveEntry(entry) {
    entries.push(entry);
    if (window.App && window.App.storage) {
      try {
        await window.App.storage.put(STORE_KEY, entry.id, entry);
      } catch (e) {
        // Fallback: keep in memory
      }
    }
  }

  async function deleteEntry(id) {
    entries = entries.filter(function(e) { return e.id !== id; });
    if (window.App && window.App.storage) {
      try {
        await window.App.storage.delete(STORE_KEY, id);
      } catch (e) {
        // ignore
      }
    }
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function getVesselState() {
    if (!window.App || !window.App.vessel) {
      return { lat: null, lon: null, sog: null, cog: null, depth: null };
    }
    const v = window.App.vessel;
    return {
      lat: v.lat !== undefined ? v.lat : (v.position ? v.position.lat : null),
      lon: v.lon !== undefined ? v.lon : (v.position ? v.position.lon : null),
      sog: v.sog !== undefined ? v.sog : null,
      cog: v.cog !== undefined ? v.cog : null,
      depth: v.depth !== undefined ? v.depth : null
    };
  }

  function createEntry(notes) {
    const state = getVesselState();
    return {
      id: generateId(),
      time: Date.now(),
      lat: state.lat,
      lon: state.lon,
      sog: state.sog,
      cog: state.cog,
      depth: state.depth,
      notes: notes || '',
      type: notes ? 'manual' : 'auto'
    };
  }

  // --- Auto-logging ---
  function autoLog() {
    const entry = createEntry('');
    saveEntry(entry);
    if (window.App && window.App.bus) {
      window.App.bus.emit('logbook-entry', entry);
    }
  }

  function start(intervalMinutes) {
    if (running) return;
    running = true;

    if (intervalMinutes) logInterval = intervalMinutes * 60 * 1000;
    loadEntries();

    autoLog();
    intervalId = setInterval(autoLog, logInterval);

    if (window.App && window.App.bus) {
      let lastAutoTime = Date.now();
      busUnsubscribe = window.App.bus.on('vessel-update', function() {
        if (Date.now() - lastAutoTime >= logInterval) {
          lastAutoTime = Date.now();
          autoLog();
        }
      });
    }
  }

  function stop() {
    running = false;
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    if (busUnsubscribe && typeof busUnsubscribe === 'function') {
      busUnsubscribe();
      busUnsubscribe = null;
    }
  }

  function addEntry(text) {
    const entry = createEntry(text || '');
    entry.type = 'manual';
    saveEntry(entry);
    if (window.App && window.App.bus) {
      window.App.bus.emit('logbook-entry', entry);
    }
    return entry;
  }

  // --- Format helpers ---
  function formatTime(ts) {
    const d = new Date(ts);
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }

  function formatCoord(lat, lon) {
    if (lat === null || lon === null) return '—';
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    const latAbs = Math.abs(lat);
    const lonAbs = Math.abs(lon);
    return latAbs.toFixed(4) + '°' + latDir + ' ' + lonAbs.toFixed(4) + '°' + lonDir;
  }

  function formatVal(v, unit, decimals) {
    if (v === null || v === undefined) return '—';
    return parseFloat(v).toFixed(decimals || 1) + (unit || '');
  }

  // --- Logbook Viewer Panel ---
  function showPanel(container) {
    container.innerHTML = '';

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: 'rgba(22,33,62,0.95)',
      color: '#e0e0e0',
      fontFamily: 'sans-serif',
      fontSize: '12px',
      padding: '12px',
      borderRadius: '8px',
      border: '1px solid #53a8b6',
      maxWidth: '700px',
      maxHeight: '500px',
      overflowY: 'auto'
    });

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';

    const title = document.createElement('div');
    title.textContent = 'Voyage Logbook';
    title.style.cssText = 'color:#53a8b6;font-weight:bold;font-size:14px;';
    titleBar.appendChild(title);

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:6px;';

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = running ? '⏹ Stop' : '▶ Start';
    toggleBtn.style.cssText = btnStyle();
    toggleBtn.addEventListener('click', function() {
      if (running) { stop(); toggleBtn.textContent = '▶ Start'; }
      else { start(); toggleBtn.textContent = '⏹ Stop'; }
    });
    controls.appendChild(toggleBtn);

    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Entry';
    addBtn.style.cssText = btnStyle();
    addBtn.addEventListener('click', function() {
      const text = prompt('Log entry note:');
      if (text !== null && text.trim()) {
        addEntry(text.trim());
        renderTable();
      }
    });
    controls.appendChild(addBtn);

    const csvBtn = document.createElement('button');
    csvBtn.textContent = '⬇ CSV';
    csvBtn.style.cssText = btnStyle();
    csvBtn.addEventListener('click', function() { downloadFile(exportCSV(), 'logbook.csv', 'text/csv'); });
    controls.appendChild(csvBtn);

    const htmlBtn = document.createElement('button');
    htmlBtn.textContent = '⬇ HTML';
    htmlBtn.style.cssText = btnStyle();
    htmlBtn.addEventListener('click', function() { downloadFile(exportHTML(), 'logbook.html', 'text/html'); });
    controls.appendChild(htmlBtn);

    titleBar.appendChild(controls);
    panel.appendChild(titleBar);

    // Quick entries
    const quickRow = document.createElement('div');
    quickRow.style.cssText = 'margin-bottom:10px;display:flex;gap:4px;flex-wrap:wrap;';
    const quickEntries = ['Departed', 'Arrived', 'Anchored', 'Underway', 'Weather change', 'Sail change', 'Engine on', 'Engine off'];
    for (const q of quickEntries) {
      const qBtn = document.createElement('button');
      qBtn.textContent = q;
      qBtn.style.cssText = 'padding:2px 6px;font-size:10px;border-radius:3px;border:1px solid #37474f;' +
                           'background:transparent;color:#90a4ae;cursor:pointer;';
      qBtn.addEventListener('click', function() {
        addEntry(q);
        renderTable();
      });
      quickRow.appendChild(qBtn);
    }
    panel.appendChild(quickRow);

    // Date filter
    const filterRow = document.createElement('div');
    filterRow.style.cssText = 'margin-bottom:8px;display:flex;gap:8px;align-items:center;font-size:11px;';
    filterRow.innerHTML = '<span style="color:#90a4ae;">Filter:</span>';

    const fromInput = document.createElement('input');
    fromInput.type = 'date';
    fromInput.style.cssText = inputStyle();
    filterRow.appendChild(fromInput);

    const toSpan = document.createElement('span');
    toSpan.textContent = ' to ';
    toSpan.style.color = '#90a4ae';
    filterRow.appendChild(toSpan);

    const toInput = document.createElement('input');
    toInput.type = 'date';
    toInput.style.cssText = inputStyle();
    filterRow.appendChild(toInput);

    const filterBtn = document.createElement('button');
    filterBtn.textContent = 'Apply';
    filterBtn.style.cssText = btnStyle();
    filterBtn.addEventListener('click', renderTable);
    filterRow.appendChild(filterBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = btnStyle();
    clearBtn.addEventListener('click', function() {
      fromInput.value = '';
      toInput.value = '';
      renderTable();
    });
    filterRow.appendChild(clearBtn);

    panel.appendChild(filterRow);

    // Table container
    const tableContainer = document.createElement('div');
    tableContainer.style.cssText = 'overflow-x:auto;';
    panel.appendChild(tableContainer);

    function renderTable() {
      let filtered = entries.slice();

      if (fromInput.value) {
        const from = new Date(fromInput.value).getTime();
        filtered = filtered.filter(function(e) { return e.time >= from; });
      }
      if (toInput.value) {
        const to = new Date(toInput.value).getTime() + 86400000;
        filtered = filtered.filter(function(e) { return e.time < to; });
      }

      filtered.sort(function(a, b) { return b.time - a.time; });

      if (filtered.length === 0) {
        tableContainer.innerHTML = '<div style="color:#607d8b;padding:20px;text-align:center;">No entries</div>';
        return;
      }

      let html = '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
      html += '<thead><tr style="color:#53a8b6;border-bottom:1px solid #2a3f5f;">';
      html += '<th style="padding:4px;text-align:left;">Time</th>';
      html += '<th style="padding:4px;text-align:left;">Position</th>';
      html += '<th style="padding:4px;text-align:right;">SOG</th>';
      html += '<th style="padding:4px;text-align:right;">COG</th>';
      html += '<th style="padding:4px;text-align:right;">Depth</th>';
      html += '<th style="padding:4px;text-align:left;">Notes</th>';
      html += '</tr></thead><tbody>';

      for (const entry of filtered) {
        const rowColor = entry.type === 'manual' ? '#1a3350' : 'transparent';
        html += `<tr style="border-bottom:1px solid #1a2744;background:${rowColor};">`;
        html += `<td style="padding:3px 4px;white-space:nowrap;">${formatTime(entry.time)}</td>`;
        html += `<td style="padding:3px 4px;white-space:nowrap;">${formatCoord(entry.lat, entry.lon)}</td>`;
        html += `<td style="padding:3px 4px;text-align:right;">${formatVal(entry.sog, ' kn')}</td>`;
        html += `<td style="padding:3px 4px;text-align:right;">${formatVal(entry.cog, '°', 0)}</td>`;
        html += `<td style="padding:3px 4px;text-align:right;">${formatVal(entry.depth, ' m')}</td>`;
        html += `<td style="padding:3px 4px;color:${entry.type === 'manual' ? '#53a8b6' : '#90a4ae'};">${escapeHtml(entry.notes)}</td>`;
        html += '</tr>';
      }

      html += '</tbody></table>';
      html += `<div style="color:#607d8b;font-size:10px;margin-top:6px;">${filtered.length} entries shown</div>`;
      tableContainer.innerHTML = html;
    }

    loadEntries().then(renderTable);

    if (window.App && window.App.bus) {
      window.App.bus.on('logbook-entry', renderTable);
    }

    container.appendChild(panel);
  }

  // --- Export CSV ---
  function exportCSV() {
    const header = 'Time,Latitude,Longitude,SOG (kn),COG (°),Depth (m),Notes\n';
    const rows = entries
      .slice()
      .sort(function(a, b) { return a.time - b.time; })
      .map(function(e) {
        return [
          formatTime(e.time),
          e.lat !== null ? e.lat.toFixed(6) : '',
          e.lon !== null ? e.lon.toFixed(6) : '',
          e.sog !== null ? e.sog.toFixed(1) : '',
          e.cog !== null ? e.cog.toFixed(0) : '',
          e.depth !== null ? e.depth.toFixed(1) : '',
          '"' + (e.notes || '').replace(/"/g, '""') + '"'
        ].join(',');
      });
    return header + rows.join('\n');
  }

  // --- Export HTML ---
  function exportHTML() {
    const sorted = entries.slice().sort(function(a, b) { return a.time - b.time; });

    let html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
    html += '<title>Voyage Logbook</title>';
    html += '<style>body{font-family:sans-serif;margin:20px;color:#333;}';
    html += 'table{border-collapse:collapse;width:100%;}';
    html += 'th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:12px;}';
    html += 'th{background:#f0f0f0;font-weight:bold;}';
    html += 'tr:nth-child(even){background:#f9f9f9;}';
    html += '.manual{background:#e8f5e9;}';
    html += 'h1{font-size:18px;margin-bottom:4px;}';
    html += '.meta{color:#666;font-size:12px;margin-bottom:16px;}</style></head><body>';
    html += '<h1>Voyage Logbook</h1>';
    html += '<div class="meta">Generated: ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC | ' + sorted.length + ' entries</div>';
    html += '<table><thead><tr><th>Time (UTC)</th><th>Latitude</th><th>Longitude</th><th>SOG (kn)</th><th>COG (°)</th><th>Depth (m)</th><th>Notes</th></tr></thead><tbody>';

    for (const e of sorted) {
      const cls = e.type === 'manual' ? ' class="manual"' : '';
      html += '<tr' + cls + '>';
      html += '<td>' + formatTime(e.time) + '</td>';
      html += '<td>' + (e.lat !== null ? e.lat.toFixed(6) : '—') + '</td>';
      html += '<td>' + (e.lon !== null ? e.lon.toFixed(6) : '—') + '</td>';
      html += '<td>' + formatVal(e.sog, '', 1) + '</td>';
      html += '<td>' + formatVal(e.cog, '', 0) + '</td>';
      html += '<td>' + formatVal(e.depth, '', 1) + '</td>';
      html += '<td>' + escapeHtml(e.notes || '') + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table></body></html>';
    return html;
  }

  // --- Download helper ---
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // --- Style helpers ---
  function btnStyle() {
    return 'padding:3px 8px;font-size:11px;border-radius:4px;border:1px solid #53a8b6;' +
           'cursor:pointer;background:transparent;color:#53a8b6;';
  }

  function inputStyle() {
    return 'padding:2px 4px;font-size:11px;background:#1a2744;color:#e0e0e0;' +
           'border:1px solid #37474f;border-radius:3px;';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Public API ---
  window.Logbook = {
    start: start,
    stop: stop,
    addEntry: addEntry,
    showPanel: showPanel,
    exportCSV: exportCSV,
    exportHTML: exportHTML,
    getEntries: function() { return entries.slice(); },
    setInterval: function(minutes) { logInterval = minutes * 60 * 1000; },
    isRunning: function() { return running; },
    clearAll: async function() {
      const ids = entries.map(function(e) { return e.id; });
      entries = [];
      if (window.App && window.App.storage) {
        for (const id of ids) {
          try { await window.App.storage.delete(STORE_KEY, id); } catch (e) {}
        }
      }
    }
  };

})();
