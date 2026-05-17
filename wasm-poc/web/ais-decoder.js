/**
 * AIS Decoder for OpenCPN WASM port.
 * Decodes AIS messages from NMEA-encapsulated !AIVDM / !AIVDO sentences.
 */
(function () {
  'use strict';

  // ── 6-bit ASCII armor ───────────────────────────────────────────────

  /**
   * Decode AIS 6-bit ASCII payload into a bit array (array of 0/1).
   * Each character maps to 6 bits.
   */
  function payloadToBits(payload, fillBits) {
    var bits = [];
    for (var i = 0; i < payload.length; i++) {
      var code = payload.charCodeAt(i) - 48;
      if (code > 40) code -= 8;
      for (var b = 5; b >= 0; b--) {
        bits.push((code >> b) & 1);
      }
    }
    // Remove fill bits from the end
    var fb = parseInt(fillBits, 10) || 0;
    if (fb > 0 && fb < bits.length) {
      bits.length -= fb;
    }
    return bits;
  }

  /** Extract an unsigned integer from a bit array. */
  function getUint(bits, start, len) {
    var val = 0;
    var end = Math.min(start + len, bits.length);
    for (var i = start; i < end; i++) {
      val = (val << 1) | bits[i];
    }
    return val;
  }

  /** Extract a signed integer (two's complement) from a bit array. */
  function getInt(bits, start, len) {
    var val = getUint(bits, start, len);
    if (val >= (1 << (len - 1))) {
      val -= (1 << len);
    }
    return val;
  }

  /** AIS 6-bit character table. */
  var AIS_CHARS = '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !"#$%&\'()*+,-./0123456789:;<=>?';

  /** Extract a string from a bit array (6 bits per character). */
  function getString(bits, start, len) {
    var chars = Math.floor(len / 6);
    var result = '';
    for (var i = 0; i < chars; i++) {
      var code = getUint(bits, start + i * 6, 6);
      result += AIS_CHARS[code] || '?';
    }
    return result.replace(/@+$/, '').trim();
  }

  /** Parse longitude from AIS (1/10000 minute, 28 bits signed). */
  function aisLon(bits, start) {
    var raw = getInt(bits, start, 28);
    if (raw === 0x6791AC0) return null; // 181° = not available
    return Math.round(raw / 600000 * 1e7) / 1e7;
  }

  /** Parse latitude from AIS (1/10000 minute, 27 bits signed). */
  function aisLat(bits, start) {
    var raw = getInt(bits, start, 27);
    if (raw === 0x3412140) return null; // 91° = not available
    return Math.round(raw / 600000 * 1e7) / 1e7;
  }

  // ── NMEA checksum validation ────────────────────────────────────────

  function validateChecksum(sentence) {
    if (typeof sentence !== 'string') return false;
    var s = sentence.trim();
    var starIdx = s.lastIndexOf('*');
    if (starIdx === -1) return null;
    var body = s.substring(1, starIdx);
    var provided = s.substring(starIdx + 1).toUpperCase();
    if (provided.length < 2) return false;
    var calc = 0;
    for (var i = 0; i < body.length; i++) {
      calc ^= body.charCodeAt(i);
    }
    var expected = ('0' + calc.toString(16).toUpperCase()).slice(-2);
    return expected === provided.substring(0, 2);
  }

  // ── Ship type names ─────────────────────────────────────────────────

  var SHIP_TYPE_NAMES = {
    0: 'Not available',
    20: 'Wing in ground', 21: 'Wing in ground (A)', 22: 'Wing in ground (B)',
    23: 'Wing in ground (C)', 24: 'Wing in ground (D)', 25: 'Wing in ground',
    26: 'Wing in ground', 27: 'Wing in ground', 28: 'Wing in ground',
    29: 'Wing in ground (no other info)',
    30: 'Fishing',
    31: 'Towing', 32: 'Towing (large)',
    33: 'Dredging/underwater ops',
    34: 'Diving operations',
    35: 'Military operations',
    36: 'Sailing',
    37: 'Pleasure craft',
    40: 'High speed craft', 41: 'High speed craft (A)',
    42: 'High speed craft (B)', 43: 'High speed craft (C)',
    44: 'High speed craft (D)', 45: 'High speed craft',
    46: 'High speed craft', 47: 'High speed craft',
    48: 'High speed craft', 49: 'High speed craft (no other info)',
    50: 'Pilot vessel',
    51: 'Search and rescue vessel',
    52: 'Tug',
    53: 'Port tender',
    54: 'Anti-pollution equipment',
    55: 'Law enforcement',
    56: 'Spare - local vessel', 57: 'Spare - local vessel',
    58: 'Medical transport',
    59: 'Noncombatant ship',
    60: 'Passenger', 61: 'Passenger (A)', 62: 'Passenger (B)',
    63: 'Passenger (C)', 64: 'Passenger (D)', 65: 'Passenger',
    66: 'Passenger', 67: 'Passenger', 68: 'Passenger',
    69: 'Passenger (no other info)',
    70: 'Cargo', 71: 'Cargo (A)', 72: 'Cargo (B)',
    73: 'Cargo (C)', 74: 'Cargo (D)', 75: 'Cargo',
    76: 'Cargo', 77: 'Cargo', 78: 'Cargo',
    79: 'Cargo (no other info)',
    80: 'Tanker', 81: 'Tanker (A)', 82: 'Tanker (B)',
    83: 'Tanker (C)', 84: 'Tanker (D)', 85: 'Tanker',
    86: 'Tanker', 87: 'Tanker', 88: 'Tanker',
    89: 'Tanker (no other info)',
    90: 'Other', 91: 'Other (A)', 92: 'Other (B)',
    93: 'Other (C)', 94: 'Other (D)', 95: 'Other',
    96: 'Other', 97: 'Other', 98: 'Other',
    99: 'Other (no other info)',
  };

  function getShipTypeName(code) {
    return SHIP_TYPE_NAMES[code] || 'Unknown';
  }

  // ── Nav status names ────────────────────────────────────────────────

  var NAV_STATUS_NAMES = {
    0: 'Under way using engine',
    1: 'At anchor',
    2: 'Not under command',
    3: 'Restricted manoeuvrability',
    4: 'Constrained by draught',
    5: 'Moored',
    6: 'Aground',
    7: 'Engaged in fishing',
    8: 'Under way sailing',
    9: 'Reserved for HSC',
    10: 'Reserved for WIG',
    11: 'Power-driven vessel towing astern',
    12: 'Power-driven vessel pushing ahead/towing alongside',
    13: 'Reserved',
    14: 'AIS-SART, MOB-AIS, EPIRB-AIS',
    15: 'Not defined',
  };

  function getNavStatusName(code) {
    if (code === null || code === undefined) return 'Unknown';
    return NAV_STATUS_NAMES[code] || 'Unknown';
  }

  // ── AISTarget ───────────────────────────────────────────────────────

  function AISTarget(mmsi) {
    this.mmsi = mmsi;
    this.type = null;
    this.name = null;
    this.callsign = null;
    this.imo = null;
    this.shipType = null;
    this.lat = null;
    this.lon = null;
    this.sog = null;
    this.cog = null;
    this.hdg = null;
    this.rot = null;
    this.navStatus = null;
    this.destination = null;
    this.eta = null;
    this.length = null;
    this.beam = null;
    this.draught = null;
    this.lastUpdate = null;

    // Aid to navigation fields
    this.aidType = null;
    this.aidName = null;
    this.posAccuracy = null;

    // Dimensions from A/B/C/D
    this._dimA = 0;
    this._dimB = 0;
    this._dimC = 0;
    this._dimD = 0;
  }

  AISTarget.prototype.isMoving = function () {
    return this.sog !== null && this.sog > 0.5;
  };

  AISTarget.prototype.getShipTypeName = function () {
    return getShipTypeName(this.shipType);
  };

  AISTarget.prototype.getNavStatusName = function () {
    return getNavStatusName(this.navStatus);
  };

  // ── Message decoders ────────────────────────────────────────────────

  var msgDecoders = {};

  /** Messages 1, 2, 3 — Class A Position Report. */
  function decodeMsg123(bits, target) {
    if (bits.length < 168) return null;

    target.navStatus = getUint(bits, 38, 4);

    var rotRaw = getInt(bits, 42, 8);
    if (rotRaw === -128) {
      target.rot = null;
    } else {
      // ROT indicator to deg/min: sign(raw) * (raw/4.733)^2
      target.rot = rotRaw === 0 ? 0 :
        (rotRaw > 0 ? 1 : -1) * Math.round(Math.pow(rotRaw / 4.733, 2) * 10) / 10;
    }

    var sogRaw = getUint(bits, 50, 10);
    target.sog = sogRaw === 1023 ? null : sogRaw / 10;

    target.posAccuracy = getUint(bits, 60, 1);
    target.lon = aisLon(bits, 61);
    target.lat = aisLat(bits, 89);

    var cogRaw = getUint(bits, 116, 12);
    target.cog = cogRaw === 3600 ? null : cogRaw / 10;

    var hdgRaw = getUint(bits, 128, 9);
    target.hdg = hdgRaw === 511 ? null : hdgRaw;

    target.lastUpdate = Date.now();
    return target;
  }

  msgDecoders[1] = decodeMsg123;
  msgDecoders[2] = decodeMsg123;
  msgDecoders[3] = decodeMsg123;

  /** Message 5 — Static and Voyage Related Data (Class A). */
  msgDecoders[5] = function (bits, target) {
    if (bits.length < 424) return null;

    target.imo = getUint(bits, 40, 30);
    target.callsign = getString(bits, 70, 42);
    target.name = getString(bits, 112, 120);
    target.shipType = getUint(bits, 232, 8);

    target._dimA = getUint(bits, 240, 9);
    target._dimB = getUint(bits, 249, 9);
    target._dimC = getUint(bits, 258, 6);
    target._dimD = getUint(bits, 264, 6);
    target.length = target._dimA + target._dimB || null;
    target.beam = target._dimC + target._dimD || null;

    // ETA: month(4) day(5) hour(5) minute(6)
    var etaMonth = getUint(bits, 274, 4);
    var etaDay = getUint(bits, 278, 5);
    var etaHour = getUint(bits, 283, 5);
    var etaMin = getUint(bits, 288, 6);
    if (etaMonth > 0 && etaDay > 0) {
      target.eta = ('0' + etaMonth).slice(-2) + '-' + ('0' + etaDay).slice(-2) +
        ' ' + ('0' + etaHour).slice(-2) + ':' + ('0' + etaMin).slice(-2);
    }

    var draughtRaw = getUint(bits, 294, 8);
    target.draught = draughtRaw === 0 ? null : draughtRaw / 10;

    target.destination = getString(bits, 302, 120);

    target.lastUpdate = Date.now();
    return target;
  };

  /** Message 18 — Standard Class B Position Report. */
  msgDecoders[18] = function (bits, target) {
    if (bits.length < 168) return null;

    var sogRaw = getUint(bits, 46, 10);
    target.sog = sogRaw === 1023 ? null : sogRaw / 10;

    target.posAccuracy = getUint(bits, 56, 1);
    target.lon = aisLon(bits, 57);
    target.lat = aisLat(bits, 85);

    var cogRaw = getUint(bits, 112, 12);
    target.cog = cogRaw === 3600 ? null : cogRaw / 10;

    var hdgRaw = getUint(bits, 124, 9);
    target.hdg = hdgRaw === 511 ? null : hdgRaw;

    target.lastUpdate = Date.now();
    return target;
  };

  /** Message 19 — Extended Class B Position Report. */
  msgDecoders[19] = function (bits, target) {
    if (bits.length < 312) return null;

    var sogRaw = getUint(bits, 46, 10);
    target.sog = sogRaw === 1023 ? null : sogRaw / 10;

    target.posAccuracy = getUint(bits, 56, 1);
    target.lon = aisLon(bits, 57);
    target.lat = aisLat(bits, 85);

    var cogRaw = getUint(bits, 112, 12);
    target.cog = cogRaw === 3600 ? null : cogRaw / 10;

    var hdgRaw = getUint(bits, 124, 9);
    target.hdg = hdgRaw === 511 ? null : hdgRaw;

    target.name = getString(bits, 143, 120);
    target.shipType = getUint(bits, 263, 8);

    target._dimA = getUint(bits, 271, 9);
    target._dimB = getUint(bits, 280, 9);
    target._dimC = getUint(bits, 289, 6);
    target._dimD = getUint(bits, 295, 6);
    target.length = target._dimA + target._dimB || null;
    target.beam = target._dimC + target._dimD || null;

    target.lastUpdate = Date.now();
    return target;
  };

  /** Message 21 — Aid to Navigation Report. */
  msgDecoders[21] = function (bits, target) {
    if (bits.length < 272) return null;

    target.aidType = getUint(bits, 38, 5);
    target.aidName = getString(bits, 43, 120);
    target.name = target.aidName;

    target.posAccuracy = getUint(bits, 163, 1);
    target.lon = aisLon(bits, 164);
    target.lat = aisLat(bits, 192);

    target._dimA = getUint(bits, 219, 9);
    target._dimB = getUint(bits, 228, 9);
    target._dimC = getUint(bits, 237, 6);
    target._dimD = getUint(bits, 243, 6);
    target.length = target._dimA + target._dimB || null;
    target.beam = target._dimC + target._dimD || null;

    target.lastUpdate = Date.now();
    return target;
  };

  /** Message 24 — Class B CS Static Data Report. */
  msgDecoders[24] = function (bits, target) {
    var partNum = getUint(bits, 38, 2);

    if (partNum === 0) {
      // Part A: name
      if (bits.length < 168) return null;
      target.name = getString(bits, 40, 120);
    } else if (partNum === 1) {
      // Part B: ship type, vendor, callsign, dimensions
      if (bits.length < 168) return null;
      target.shipType = getUint(bits, 40, 8);
      // Vendor ID: bits 48-65 (skip for now)
      target.callsign = getString(bits, 90, 42);

      target._dimA = getUint(bits, 132, 9);
      target._dimB = getUint(bits, 141, 9);
      target._dimC = getUint(bits, 150, 6);
      target._dimD = getUint(bits, 156, 6);
      target.length = target._dimA + target._dimB || null;
      target.beam = target._dimC + target._dimD || null;
    }

    target.lastUpdate = Date.now();
    return target;
  };

  // ── AISDecoder ──────────────────────────────────────────────────────

  function AISDecoder() {
    this._targets = new Map();
    this._fragments = {};          // keyed by seqId for multi-part assembly
    this._listeners = {};
  }

  /**
   * Decode a single VDM / VDO sentence.
   * Returns decoded target object, or null if incomplete / invalid.
   */
  AISDecoder.prototype.decode = function (sentence) {
    if (typeof sentence !== 'string') return null;
    var s = sentence.trim();
    if (s.length === 0) return null;

    // Validate checksum
    var csValid = validateChecksum(s);
    if (csValid === false) return null;

    // Strip checksum for field parsing
    var starIdx = s.lastIndexOf('*');
    var body = starIdx !== -1 ? s.substring(1, starIdx) : s.substring(1);
    var fields = body.split(',');

    // Verify this is VDM or VDO
    var header = fields[0];
    if (!header || (header.indexOf('VDM') === -1 && header.indexOf('VDO') === -1)) {
      return null;
    }

    var totalFragments = parseInt(fields[1], 10) || 1;
    var fragNum = parseInt(fields[2], 10) || 1;
    var seqId = fields[3] || '';
    var payload = fields[5] || '';
    var fillBits = fields[6] || '0';

    if (totalFragments === 1) {
      // Single-part message
      return this._decodePayload(payload, fillBits);
    }

    // Multi-part assembly
    var key = seqId || '_auto_' + totalFragments;
    if (fragNum === 1) {
      this._fragments[key] = { total: totalFragments, parts: {}, ts: Date.now() };
    }
    var frag = this._fragments[key];
    if (!frag) {
      // First fragment wasn't fragment 1 — create entry anyway
      frag = { total: totalFragments, parts: {}, ts: Date.now() };
      this._fragments[key] = frag;
    }
    frag.parts[fragNum] = { payload: payload, fillBits: fillBits };

    // Check if all parts are collected
    if (Object.keys(frag.parts).length < frag.total) {
      return null; // still waiting
    }

    // Assemble
    var fullPayload = '';
    var lastFill = '0';
    for (var i = 1; i <= frag.total; i++) {
      var part = frag.parts[i];
      if (!part) {
        delete this._fragments[key];
        return null; // missing fragment
      }
      fullPayload += part.payload;
      lastFill = part.fillBits;
    }
    delete this._fragments[key];

    return this._decodePayload(fullPayload, lastFill);
  };

  /** Decode an assembled AIS payload. */
  AISDecoder.prototype._decodePayload = function (payload, fillBits) {
    if (!payload) return null;
    var bits = payloadToBits(payload, fillBits);
    if (bits.length < 38) return null; // minimum: type(6) + repeat(2) + mmsi(30)

    var msgType = getUint(bits, 0, 6);
    var mmsi = getUint(bits, 8, 30);
    if (mmsi === 0) return null;

    var decoder = msgDecoders[msgType];
    if (!decoder) return null; // unsupported message type

    var isNew = !this._targets.has(mmsi);
    var target = this._targets.get(mmsi);
    if (!target) {
      target = new AISTarget(mmsi);
      this._targets.set(mmsi, target);
    }
    target.type = msgType;

    var result = decoder(bits, target);
    if (!result) return null;

    // Fire events
    if (isNew) {
      this._fireEvent('target-new', target);
    }
    this._fireEvent('target-update', target);

    return target;
  };

  /** Get all known targets as a Map<mmsi, AISTarget>. */
  AISDecoder.prototype.getTargets = function () {
    return this._targets;
  };

  /** Get a specific target by MMSI. */
  AISDecoder.prototype.getTarget = function (mmsi) {
    return this._targets.get(mmsi) || null;
  };

  /**
   * Remove targets not updated within maxAgeSeconds.
   * Fires 'target-lost' for each removed target.
   */
  AISDecoder.prototype.pruneStale = function (maxAgeSeconds) {
    if (maxAgeSeconds === undefined) maxAgeSeconds = 600;
    var cutoff = Date.now() - maxAgeSeconds * 1000;
    var self = this;
    this._targets.forEach(function (target, mmsi) {
      if (target.lastUpdate !== null && target.lastUpdate < cutoff) {
        self._fireEvent('target-lost', target);
        self._targets.delete(mmsi);
      }
    });

    // Also prune stale fragment buffers (>60s old)
    var fragCutoff = Date.now() - 60000;
    var keys = Object.keys(this._fragments);
    for (var i = 0; i < keys.length; i++) {
      if (this._fragments[keys[i]].ts < fragCutoff) {
        delete this._fragments[keys[i]];
      }
    }
  };

  /**
   * Register an event listener.
   * Events: 'target-update', 'target-new', 'target-lost'
   */
  AISDecoder.prototype.on = function (event, callback) {
    if (typeof callback !== 'function') return;
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  };

  /** Remove a previously registered event listener. */
  AISDecoder.prototype.off = function (event, callback) {
    var arr = this._listeners[event];
    if (!arr) return;
    var idx = arr.indexOf(callback);
    if (idx !== -1) arr.splice(idx, 1);
  };

  AISDecoder.prototype._fireEvent = function (event, data) {
    var arr = this._listeners[event];
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      try {
        arr[i](data);
      } catch (e) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('AISDecoder event error:', e);
        }
      }
    }
  };

  // ── Export ───────────────────────────────────────────────────────────

  if (typeof window !== 'undefined') {
    window.AISDecoder = AISDecoder;
    window.AISTarget = AISTarget;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AISDecoder: AISDecoder, AISTarget: AISTarget };
  }
})();
