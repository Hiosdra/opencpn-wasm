/**
 * NMEA0183 Parser for OpenCPN WASM port.
 * Parses standard NMEA0183 sentences and maintains navigational state.
 */
(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────

  function parseFloat_(v) {
    if (v === '' || v === undefined) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  function parseInt_(v) {
    if (v === '' || v === undefined) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }

  /** Convert ddmm.mmm(m) + hemisphere to signed decimal degrees. */
  function parseLatitude(field, hem) {
    if (!field || !hem) return null;
    const deg = parseInt(field.substring(0, 2), 10);
    const min = parseFloat(field.substring(2));
    if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
    let val = deg + min / 60;
    if (hem === 'S') val = -val;
    return Math.round(val * 1e7) / 1e7;
  }

  /** Convert dddmm.mmm(m) + hemisphere to signed decimal degrees. */
  function parseLongitude(field, hem) {
    if (!field || !hem) return null;
    const deg = parseInt(field.substring(0, 3), 10);
    const min = parseFloat(field.substring(3));
    if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
    let val = deg + min / 60;
    if (hem === 'W') val = -val;
    return Math.round(val * 1e7) / 1e7;
  }

  /** Parse NMEA time field hhmmss.ss → "hh:mm:ss.ss" or null. */
  function parseTime(field) {
    if (!field || field.length < 6) return null;
    const h = field.substring(0, 2);
    const m = field.substring(2, 4);
    const s = field.substring(4);
    return h + ':' + m + ':' + s;
  }

  /** Parse NMEA date field ddmmyy → "YYYY-MM-DD" or null. */
  function parseDate(field) {
    if (!field || field.length < 6) return null;
    const d = field.substring(0, 2);
    const m = field.substring(2, 4);
    let y = parseInt(field.substring(4, 6), 10);
    y += y >= 80 ? 1900 : 2000;
    return y + '-' + m + '-' + d;
  }

  // ── Checksum ─────────────────────────────────────────────────────────

  /**
   * Validate NMEA checksum.
   * Expects a sentence starting with '$' or '!' and ending with '*XX'.
   * Returns true if valid, false if invalid, null if no checksum present.
   */
  function validateChecksum(sentence) {
    if (typeof sentence !== 'string') return false;
    const s = sentence.trim();
    const starIdx = s.lastIndexOf('*');
    if (starIdx === -1) return null; // no checksum field
    const body = s.substring(1, starIdx); // between $ and *
    const provided = s.substring(starIdx + 1).toUpperCase();
    if (provided.length < 2) return false;
    let calc = 0;
    for (let i = 0; i < body.length; i++) {
      calc ^= body.charCodeAt(i);
    }
    const expected = ('0' + calc.toString(16).toUpperCase()).slice(-2);
    return expected === provided.substring(0, 2);
  }

  // ── Sentence parsers ────────────────────────────────────────────────

  const parsers = {};

  parsers.RMC = function (f) {
    return {
      time: parseTime(f[1]),
      status: f[2] || null,        // A = active, V = void
      lat: parseLatitude(f[3], f[4]),
      lon: parseLongitude(f[5], f[6]),
      sog: parseFloat_(f[7]),
      cog: parseFloat_(f[8]),
      date: parseDate(f[9]),
      magVar: f[10] ? (parseFloat_(f[10]) * (f[11] === 'W' ? -1 : 1)) : null,
      mode: f[12] || null,
    };
  };

  parsers.GGA = function (f) {
    return {
      time: parseTime(f[1]),
      lat: parseLatitude(f[2], f[3]),
      lon: parseLongitude(f[4], f[5]),
      quality: parseInt_(f[6]),     // 0=invalid,1=GPS,2=DGPS,...
      satellites: parseInt_(f[7]),
      hdop: parseFloat_(f[8]),
      altitude: parseFloat_(f[9]),
      geoidSep: parseFloat_(f[11]),
    };
  };

  parsers.GLL = function (f) {
    return {
      lat: parseLatitude(f[1], f[2]),
      lon: parseLongitude(f[3], f[4]),
      time: parseTime(f[5]),
      status: f[6] || null,
      mode: f[7] || null,
    };
  };

  parsers.VTG = function (f) {
    return {
      cogTrue: parseFloat_(f[1]),
      cogMag: parseFloat_(f[3]),
      sogKnots: parseFloat_(f[5]),
      sogKmh: parseFloat_(f[7]),
      mode: f[9] || null,
    };
  };

  parsers.HDT = function (f) {
    return { heading: parseFloat_(f[1]) };
  };

  parsers.HDM = function (f) {
    return { heading: parseFloat_(f[1]) };
  };

  parsers.DBT = function (f) {
    return {
      depthFeet: parseFloat_(f[1]),
      depthMeters: parseFloat_(f[3]),
      depthFathoms: parseFloat_(f[5]),
    };
  };

  parsers.DBS = parsers.DBT; // same field layout

  parsers.MWD = function (f) {
    return {
      windDirTrue: parseFloat_(f[1]),
      windDirMag: parseFloat_(f[3]),
      windSpeedKnots: parseFloat_(f[5]),
      windSpeedMs: parseFloat_(f[7]),
    };
  };

  parsers.MWV = function (f) {
    return {
      windAngle: parseFloat_(f[1]),
      reference: f[2] || null,     // R = relative, T = true
      windSpeed: parseFloat_(f[3]),
      windUnit: f[4] || null,      // K/M/N/S
      status: f[5] || null,        // A = valid
    };
  };

  parsers.XTE = function (f) {
    return {
      status: f[1] || null,
      xte: parseFloat_(f[3]),
      steerDir: f[4] || null,      // L/R
      units: f[5] || null,         // N = nautical miles
    };
  };

  parsers.APB = function (f) {
    return {
      status: f[1] || null,
      xte: parseFloat_(f[4]),
      steerDir: f[5] || null,
      arrivalCircle: f[6] || null,
      arrivalPerp: f[7] || null,
      bearingOrigToDest: parseFloat_(f[8]),
      bearingOrigToDest_type: f[9] || null,
      waypointId: f[10] || null,
      bearingToWp: parseFloat_(f[11]),
      bearingToWp_type: f[12] || null,
      headingToWp: parseFloat_(f[13]),
      headingToWp_type: f[14] || null,
    };
  };

  parsers.BOD = function (f) {
    return {
      bearingTrue: parseFloat_(f[1]),
      bearingMag: parseFloat_(f[3]),
      destWpId: f[5] || null,
      origWpId: f[6] || null,
    };
  };

  parsers.BWC = function (f) {
    return {
      time: parseTime(f[1]),
      lat: parseLatitude(f[2], f[3]),
      lon: parseLongitude(f[4], f[5]),
      bearingTrue: parseFloat_(f[6]),
      bearingMag: parseFloat_(f[8]),
      distance: parseFloat_(f[10]),
      waypointId: f[12] || null,
      mode: f[13] || null,
    };
  };

  parsers.RMB = function (f) {
    return {
      status: f[1] || null,
      xte: parseFloat_(f[2]),
      steerDir: f[3] || null,
      origWpId: f[4] || null,
      destWpId: f[5] || null,
      destLat: parseLatitude(f[6], f[7]),
      destLon: parseLongitude(f[8], f[9]),
      range: parseFloat_(f[10]),
      bearing: parseFloat_(f[11]),
      velocity: parseFloat_(f[12]),
      arrived: f[13] || null,      // A = arrived, V = not arrived
    };
  };

  // ── NMEAParser class ────────────────────────────────────────────────

  function NMEAParser() {
    this._listeners = {};
    this._buffer = '';
    this._state = {
      position: null,   // { lat, lon }
      sog: null,
      cog: null,
      hdg: null,
      depth: null,
      wind: null,
      fix: null,
      satellites: null,
      altitude: null,
      magVar: null,
      time: null,
      date: null,
    };
  }

  /**
   * Parse a single NMEA sentence string.
   * Returns { type, talker, valid, data } or null on failure.
   */
  NMEAParser.prototype.parse = function (sentence) {
    if (typeof sentence !== 'string') return null;
    var s = sentence.trim();
    if (s.length === 0) return null;

    // Must start with '$' (or '!')
    if (s[0] !== '$' && s[0] !== '!') return null;

    // Validate checksum if present
    var csValid = validateChecksum(s);
    if (csValid === false) return null; // bad checksum → reject

    // Strip checksum for parsing
    var starIdx = s.lastIndexOf('*');
    var body = starIdx !== -1 ? s.substring(1, starIdx) : s.substring(1);

    var fields = body.split(',');
    if (fields.length < 1) return null;

    var header = fields[0]; // e.g. "GPRMC" or "SDDBT"
    if (header.length < 3) return null;

    // Some sentences have 2-char talker + 3-char type, others vary.
    // Standard: 2-char talker, rest is sentence type.
    var talker, sentenceType;
    if (header.length >= 5) {
      talker = header.substring(0, 2);
      sentenceType = header.substring(2);
    } else if (header.length === 4) {
      talker = header.substring(0, 1);
      sentenceType = header.substring(1);
    } else {
      talker = '';
      sentenceType = header;
    }

    var parser = parsers[sentenceType];
    if (!parser) {
      // Return a raw result for unknown sentence types
      return { type: sentenceType, talker: talker, valid: true, data: { fields: fields } };
    }

    var data;
    try {
      data = parser(fields);
    } catch (e) {
      return null;
    }

    // Update internal state
    this._updateState(sentenceType, data);

    return { type: sentenceType, talker: talker, valid: true, data: data };
  };

  /** Update aggregated navigational state from parsed data. */
  NMEAParser.prototype._updateState = function (type, data) {
    var st = this._state;

    switch (type) {
      case 'RMC':
        if (data.lat !== null && data.lon !== null && data.status === 'A') {
          st.position = { lat: data.lat, lon: data.lon };
        }
        if (data.sog !== null) st.sog = data.sog;
        if (data.cog !== null) st.cog = data.cog;
        if (data.magVar !== null) st.magVar = data.magVar;
        if (data.time !== null) st.time = data.time;
        if (data.date !== null) st.date = data.date;
        break;

      case 'GGA':
        if (data.lat !== null && data.lon !== null && data.quality > 0) {
          st.position = { lat: data.lat, lon: data.lon };
        }
        st.fix = data.quality;
        st.satellites = data.satellites;
        if (data.altitude !== null) st.altitude = data.altitude;
        if (data.time !== null) st.time = data.time;
        break;

      case 'GLL':
        if (data.lat !== null && data.lon !== null && data.status === 'A') {
          st.position = { lat: data.lat, lon: data.lon };
        }
        if (data.time !== null) st.time = data.time;
        break;

      case 'VTG':
        if (data.sogKnots !== null) st.sog = data.sogKnots;
        if (data.cogTrue !== null) st.cog = data.cogTrue;
        break;

      case 'HDT':
        if (data.heading !== null) st.hdg = data.heading;
        break;

      case 'HDM':
        // Only use magnetic heading if no true heading is set
        if (data.heading !== null && st.hdg === null) st.hdg = data.heading;
        break;

      case 'DBT':
      case 'DBS':
        if (data.depthMeters !== null) {
          st.depth = data.depthMeters;
        } else if (data.depthFeet !== null) {
          st.depth = data.depthFeet * 0.3048;
        }
        break;

      case 'MWD':
        st.wind = {
          dirTrue: data.windDirTrue,
          dirMag: data.windDirMag,
          speedKnots: data.windSpeedKnots,
          speedMs: data.windSpeedMs,
        };
        break;

      case 'MWV':
        if (data.status === 'A') {
          st.wind = st.wind || {};
          st.wind.angle = data.windAngle;
          st.wind.reference = data.reference;
          st.wind.speed = data.windSpeed;
          st.wind.unit = data.windUnit;
        }
        break;
    }
  };

  /**
   * Register a callback for a specific sentence type.
   * Callback receives (data, fullResult) where fullResult includes type/talker/valid.
   */
  NMEAParser.prototype.on = function (sentenceType, callback) {
    if (typeof callback !== 'function') return;
    var key = sentenceType.toUpperCase();
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(callback);
  };

  /** Remove a previously registered callback. */
  NMEAParser.prototype.off = function (sentenceType, callback) {
    var key = sentenceType.toUpperCase();
    var arr = this._listeners[key];
    if (!arr) return;
    var idx = arr.indexOf(callback);
    if (idx !== -1) arr.splice(idx, 1);
  };

  /**
   * Feed raw data (potentially partial lines).
   * Buffers until complete sentences are available, then parses and fires callbacks.
   */
  NMEAParser.prototype.feed = function (rawData) {
    if (typeof rawData !== 'string') return;
    this._buffer += rawData;

    // Process all complete lines
    var newlineIdx;
    while ((newlineIdx = this._buffer.indexOf('\n')) !== -1) {
      var line = this._buffer.substring(0, newlineIdx).replace(/\r$/, '');
      this._buffer = this._buffer.substring(newlineIdx + 1);

      if (line.length === 0) continue;

      var result = this.parse(line);
      if (result) {
        this._fireCallbacks(result);
      }
    }

    // Guard against unbounded buffer growth from malformed data
    if (this._buffer.length > 1024) {
      // Try to salvage: find the last '$' or '!' and keep from there
      var lastStart = Math.max(this._buffer.lastIndexOf('$'), this._buffer.lastIndexOf('!'));
      if (lastStart > 0) {
        this._buffer = this._buffer.substring(lastStart);
      } else {
        this._buffer = '';
      }
    }
  };

  NMEAParser.prototype._fireCallbacks = function (result) {
    var arr = this._listeners[result.type];
    if (arr) {
      for (var i = 0; i < arr.length; i++) {
        try {
          arr[i](result.data, result);
        } catch (e) {
          // swallow callback errors to keep parser running
          if (typeof console !== 'undefined' && console.error) {
            console.error('NMEAParser callback error:', e);
          }
        }
      }
    }
  };

  /** Return a snapshot of the latest known navigational state. */
  NMEAParser.prototype.getState = function () {
    // Return a shallow clone so callers can't mutate internal state
    var s = this._state;
    return {
      position: s.position ? { lat: s.position.lat, lon: s.position.lon } : null,
      sog: s.sog,
      cog: s.cog,
      hdg: s.hdg,
      depth: s.depth,
      wind: s.wind ? Object.assign({}, s.wind) : null,
      fix: s.fix,
      satellites: s.satellites,
      altitude: s.altitude,
      magVar: s.magVar,
      time: s.time,
      date: s.date,
    };
  };

  /** Static method — also accessible as instance method via prototype. */
  NMEAParser.validateChecksum = validateChecksum;
  NMEAParser.prototype.validateChecksum = validateChecksum;

  // ── Export ───────────────────────────────────────────────────────────

  if (typeof window !== 'undefined') {
    window.NMEAParser = NMEAParser;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = NMEAParser;
  }
})();
