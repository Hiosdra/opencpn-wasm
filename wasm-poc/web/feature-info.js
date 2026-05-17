/**
 * Chart Feature Info Panel for OpenCPN WASM
 * Hit-tests chart features and displays S-57 attribute information.
 */
(function() {
  'use strict';

  // --- Human-readable attribute names ---
  const ATTR_NAMES = {
    OBJNAM: 'Name',
    NOBJNM: 'National name',
    INFORM: 'Information',
    NINFOM: 'National information',
    VALSOU: 'Sounding value',
    DRVAL1: 'Depth range (min)',
    DRVAL2: 'Depth range (max)',
    VALDCO: 'Depth contour value',
    LITCHR: 'Light character',
    COLOUR: 'Color',
    COLPAT: 'Color pattern',
    CATLIT: 'Category of light',
    CATOBS: 'Category of obstruction',
    CATLAM: 'Category of buoy (lateral)',
    CATCAN: 'Category of canal',
    CATCAM: 'Category of buoy (cardinal)',
    CATLMK: 'Category of landmark',
    CATNAV: 'Category of nav line',
    CATSLC: 'Category of shoreline',
    CATREA: 'Category of restricted area',
    CATSPM: 'Category of special purpose',
    CATWRK: 'Category of wreck',
    HEIGHT: 'Height',
    VERDAT: 'Vertical datum',
    VERLEN: 'Vertical length',
    HORLEN: 'Horizontal length',
    HORWID: 'Horizontal width',
    SIGPER: 'Signal period',
    SIGGRP: 'Signal group',
    SIGSEQ: 'Signal sequence',
    SECTR1: 'Sector limit 1',
    SECTR2: 'Sector limit 2',
    ORIENT: 'Orientation',
    RADIUS: 'Radius',
    STATUS: 'Status',
    CONDTN: 'Condition',
    CONVIS: 'Conspicuous (visually)',
    CONRAD: 'Conspicuous (radar)',
    BOYSHP: 'Buoy shape',
    BCNSHP: 'Beacon shape',
    TOPSHP: 'Topmark shape',
    MARSYS: 'Mark system (IALA)',
    NATCON: 'Nature of construction',
    NATQUA: 'Nature of surface (quality)',
    NATSUR: 'Nature of surface',
    WATLEV: 'Water level',
    QUASOU: 'Quality of sounding',
    SOUACC: 'Sounding accuracy',
    TECSOU: 'Technique of sounding',
    RESTRN: 'Restriction',
    TXTDSC: 'Text description',
    PITEFN: 'Pilot district',
    PRCTRY: 'Producing country',
    RYTEFN: 'Route number',
    SORDAT: 'Source date',
    SORIND: 'Source indication',
    SCAMAX: 'Scale max',
    SCAMIN: 'Scale min',
    SCVAL1: 'Scale value 1',
    SCVAL2: 'Scale value 2',
    DUNITS: 'Depth units',
    HUNITS: 'Height units',
    PUNITS: 'Position units',
    BTEFN: 'Berth number',
    BRIDGE: 'Bridge clearance',
    COMCHA: 'Communication channel',
    CURVEL: 'Current velocity',
    DATEND: 'Date end',
    DATSTA: 'Date start',
    ELEVAT: 'Elevation',
    EXCLIT: 'Exhibition condition',
    LIFCAP: 'Lifting capacity',
    MLTYLT: 'Multiplicity of lights',
    PEREND: 'Period end',
    PERSTA: 'Period start',
    T_ACWL: 'Accuracy (water level)',
    T_HWLW: 'Height (high water/low water)',
    T_TINT: 'Time interval',
    T_VAHC: 'Value (harmonic constituents)'
  };

  // Light character lookup
  const LITCHR_VALUES = {
    1: 'Fixed', 2: 'Flashing', 3: 'Long-flashing', 4: 'Quick', 5: 'Very quick',
    6: 'Ultra quick', 7: 'Isophase', 8: 'Occulting', 9: 'Interrupted quick',
    10: 'Interrupted very quick', 11: 'Morse', 12: 'Fixed/Flashing', 13: 'Alternating'
  };

  // Color lookup
  const COLOUR_VALUES = {
    1: 'White', 2: 'Black', 3: 'Red', 4: 'Green', 5: 'Blue', 6: 'Yellow',
    7: 'Grey', 8: 'Brown', 9: 'Amber', 10: 'Violet', 11: 'Orange', 12: 'Magenta', 13: 'Pink'
  };

  // Status lookup
  const STATUS_VALUES = {
    1: 'Permanent', 2: 'Occasional', 3: 'Recommended', 4: 'Not in use',
    5: 'Periodic', 6: 'Reserved', 7: 'Temporary', 8: 'Private',
    9: 'Mandatory', 11: 'Extinguished', 12: 'Illuminated', 13: 'Historic',
    14: 'Public', 15: 'Synchronized', 16: 'Watched', 17: 'Un-watched', 18: 'Existence doubtful'
  };

  // --- Panel state ---
  let panelEl = null;
  let visible = false;

  // --- Format attribute value ---
  function formatAttrValue(key, value) {
    if (value === null || value === undefined) return '—';

    if (key === 'LITCHR') {
      const vals = String(value).split(',').map(v => LITCHR_VALUES[parseInt(v)] || v);
      return vals.join(', ');
    }
    if (key === 'COLOUR') {
      const vals = String(value).split(',').map(v => COLOUR_VALUES[parseInt(v)] || v);
      return vals.join(', ');
    }
    if (key === 'STATUS') {
      const vals = String(value).split(',').map(v => STATUS_VALUES[parseInt(v)] || v);
      return vals.join(', ');
    }
    if (key === 'VALSOU' || key === 'DRVAL1' || key === 'DRVAL2') {
      return parseFloat(value).toFixed(1) + ' m';
    }
    if (key === 'HEIGHT' || key === 'VERLEN' || key === 'ELEVAT') {
      return parseFloat(value).toFixed(1) + ' m';
    }
    if (key === 'SIGPER') {
      return parseFloat(value).toFixed(1) + ' s';
    }
    if (key === 'ORIENT') {
      return parseFloat(value).toFixed(1) + '°';
    }
    if (key === 'RADIUS') {
      return parseFloat(value).toFixed(0) + ' m';
    }

    return String(value);
  }

  // --- Format coordinates ---
  function formatCoord(lat, lon) {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    const latAbs = Math.abs(lat);
    const lonAbs = Math.abs(lon);
    const latDeg = Math.floor(latAbs);
    const latMin = ((latAbs - latDeg) * 60).toFixed(3);
    const lonDeg = Math.floor(lonAbs);
    const lonMin = ((lonAbs - lonDeg) * 60).toFixed(3);
    return `${latDeg}°${latMin}'${latDir}  ${lonDeg}°${lonMin}'${lonDir}`;
  }

  // --- Get class name ---
  function getClassName(classCode) {
    if (window.App && window.App.S57_CLASS_NAMES && window.App.S57_CLASS_NAMES[classCode]) {
      return window.App.S57_CLASS_NAMES[classCode];
    }
    return classCode;
  }

  // --- Create / update panel ---
  function createPanel() {
    if (panelEl) return panelEl;

    panelEl = document.createElement('div');
    panelEl.id = 'feature-info-panel';
    Object.assign(panelEl.style, {
      position: 'fixed',
      zIndex: '10000',
      background: 'rgba(22,33,62,0.95)',
      color: '#e0e0e0',
      fontFamily: 'sans-serif',
      fontSize: '12px',
      padding: '12px',
      borderRadius: '8px',
      border: '1px solid #53a8b6',
      maxWidth: '320px',
      maxHeight: '400px',
      overflowY: 'auto',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      display: 'none',
      lineHeight: '1.5'
    });

    document.body.appendChild(panelEl);
    return panelEl;
  }

  function positionPanel(screenX, screenY) {
    const panel = createPanel();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = screenX + 15;
    let top = screenY - 10;

    if (left + 320 > vw) left = screenX - 335;
    if (left < 5) left = 5;
    if (top + 300 > vh) top = vh - 310;
    if (top < 5) top = 5;

    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  // --- Show panel for features at location ---
  function show(lat, lon, screenX, screenY) {
    if (!window.App || !window.App.featureIndex) return;

    const radiusDeg = 0.005;
    const features = window.App.featureIndex.query(lat, lon, radiusDeg);

    if (!features || features.length === 0) {
      hide();
      return;
    }

    // Sort by distance
    features.sort(function(a, b) {
      const dA = Math.hypot((a.lat || 0) - lat, (a.lon || 0) - lon);
      const dB = Math.hypot((b.lat || 0) - lat, (b.lon || 0) - lon);
      return dA - dB;
    });

    const panel = createPanel();
    positionPanel(screenX, screenY);

    let html = '';

    if (features.length > 1) {
      html += '<div style="margin-bottom:8px;color:#90a4ae;font-size:11px;">' +
              features.length + ' features found</div>';
    }

    const shown = features.slice(0, 5);
    for (let fi = 0; fi < shown.length; fi++) {
      const feature = shown[fi];
      if (fi > 0) html += '<div style="border-top:1px solid #2a3f5f;margin:8px 0;"></div>';
      html += renderFeature(feature, lat, lon);
    }

    html += '<div style="text-align:right;margin-top:8px;">' +
            '<span id="fi-close-btn" style="color:#53a8b6;cursor:pointer;font-size:11px;">✕ Close</span></div>';

    panel.innerHTML = html;
    panel.style.display = 'block';
    visible = true;

    const closeBtn = document.getElementById('fi-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', hide);
    }

    setTimeout(function() {
      document.addEventListener('mousedown', outsideClickHandler);
    }, 100);
  }

  function outsideClickHandler(e) {
    if (panelEl && !panelEl.contains(e.target)) {
      hide();
    }
  }

  function renderFeature(feature, queryLat, queryLon) {
    let html = '';

    const classCode = feature.classCode || feature.type || feature.objectClass || 'Unknown';
    const className = getClassName(classCode);
    html += '<div style="color:#53a8b6;font-weight:bold;font-size:13px;margin-bottom:4px;">' +
            escapeHtml(className) + '</div>';

    if (className !== classCode) {
      html += '<div style="color:#607d8b;font-size:10px;margin-bottom:4px;">' +
              escapeHtml(String(classCode)) + '</div>';
    }

    const fLat = feature.lat !== undefined ? feature.lat : queryLat;
    const fLon = feature.lon !== undefined ? feature.lon : queryLon;
    html += '<div style="color:#90a4ae;font-size:11px;margin-bottom:6px;">' +
            formatCoord(fLat, fLon) + '</div>';

    const attrs = feature.attributes || feature.attrs || feature.properties || {};
    const attrKeys = Object.keys(attrs).filter(function(k) {
      return attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== '';
    });

    if (attrKeys.length > 0) {
      html += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
      for (const key of attrKeys) {
        const displayName = ATTR_NAMES[key] || key;
        const displayValue = formatAttrValue(key, attrs[key]);
        html += '<tr>' +
                '<td style="padding:2px 6px 2px 0;color:#90a4ae;white-space:nowrap;vertical-align:top;">' +
                escapeHtml(displayName) + '</td>' +
                '<td style="padding:2px 0;color:#e0e0e0;word-break:break-word;">' +
                escapeHtml(displayValue) + '</td></tr>';
      }
      html += '</table>';
    } else {
      html += '<div style="color:#607d8b;font-size:11px;">No attributes available</div>';
    }

    if (feature.chart || feature.chartName) {
      html += '<div style="color:#607d8b;font-size:10px;margin-top:4px;">Chart: ' +
              escapeHtml(feature.chart || feature.chartName) + '</div>';
    }

    return html;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Hide panel ---
  function hide() {
    if (panelEl) {
      panelEl.style.display = 'none';
    }
    visible = false;
    document.removeEventListener('mousedown', outsideClickHandler);
  }

  // --- Public API ---
  window.FeatureInfoPanel = {
    show: show,
    hide: hide,
    isVisible: function() { return visible; }
  };

})();
