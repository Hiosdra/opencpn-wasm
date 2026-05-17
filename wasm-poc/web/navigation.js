/**
 * navigation.js — Navigation module for OpenCPN WASM port.
 *
 * Implements waypoints, routes, tracks, measurement tool,
 * great-circle navigation calculations, and GPX import/export.
 *
 * All coordinates are WGS84 decimal degrees.
 * Distances in nautical miles, bearings in degrees true.
 */

// ── Constants ──────────────────────────────────────────────────
const EARTH_RADIUS_NM = 3440.065; // mean Earth radius in nautical miles
const NM_TO_METERS = 1852;
const DEG = Math.PI / 180;
const VALID_ICONS = ['default', 'anchor', 'port', 'fuel', 'danger', 'fish', 'diamond', 'circle', 'mob'];

// ── UUID generation ────────────────────────────────────────────
function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // RFC 4122 v4 fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

// ── Navigation calculation functions ───────────────────────────

/**
 * Great-circle distance between two points using the Haversine formula.
 * @returns {number} Distance in nautical miles.
 */
function gcDistance(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * DEG;
    const dLon = (lon2 - lon1) * DEG;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_NM * c;
}

/**
 * Initial bearing (forward azimuth) from point 1 to point 2.
 * @returns {number} Bearing in degrees true (0–360).
 */
function gcBearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * DEG;
    const φ2 = lat2 * DEG;
    const Δλ = (lon2 - lon1) * DEG;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) / DEG + 360) % 360;
}

/**
 * Cross-track error — perpendicular distance from a point to the
 * great-circle path defined by two other points.
 * @returns {number} Signed distance in NM (positive = right of track).
 */
function crossTrackError(lat, lon, fromLat, fromLon, toLat, toLon) {
    const d13 = gcDistance(fromLat, fromLon, lat, lon) / EARTH_RADIUS_NM; // angular
    const θ13 = gcBearing(fromLat, fromLon, lat, lon) * DEG;
    const θ12 = gcBearing(fromLat, fromLon, toLat, toLon) * DEG;
    return Math.asin(Math.sin(d13) * Math.sin(θ13 - θ12)) * EARTH_RADIUS_NM;
}

/**
 * Destination point given a start, initial bearing, and distance.
 * @param {number} lat - Start latitude (degrees).
 * @param {number} lon - Start longitude (degrees).
 * @param {number} bearing - Initial bearing (degrees true).
 * @param {number} distanceNm - Distance to travel (NM).
 * @returns {{lat: number, lon: number}}
 */
function destinationPoint(lat, lon, bearing, distanceNm) {
    const δ = distanceNm / EARTH_RADIUS_NM; // angular distance
    const θ = bearing * DEG;
    const φ1 = lat * DEG;
    const λ1 = lon * DEG;

    const sinφ2 = Math.sin(φ1) * Math.cos(δ) +
                  Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
    const φ2 = Math.asin(sinφ2);
    const λ2 = λ1 + Math.atan2(
        Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * sinφ2
    );

    return {
        lat: φ2 / DEG,
        lon: ((λ2 / DEG) + 540) % 360 - 180 // normalise to [-180, 180]
    };
}

// ── Formatting helpers ─────────────────────────────────────────

/** Format bearing: "045°T" */
function formatBearing(degrees) {
    const d = ((degrees % 360) + 360) % 360;
    return String(Math.round(d)).padStart(3, '0') + '°T';
}

/** Format distance: "12.3 NM" or "450 m" if < 0.1 NM */
function formatDistance(nm) {
    if (nm < 0.1) {
        return Math.round(nm * NM_TO_METERS) + ' m';
    }
    return nm.toFixed(1) + ' NM';
}

/** Format speed: "5.2 kn" */
function formatSpeed(knots) {
    return knots.toFixed(1) + ' kn';
}

/**
 * Format lat/lon in DDM: "54°32.15'N  018°32.15'E"
 * Returns an object with separate lat and lon strings, plus a combined string.
 */
function formatPosition(lat, lon) {
    const fmt = (v, pos, neg) => {
        const a = Math.abs(v);
        const d = Math.floor(a);
        const m = (a - d) * 60;
        return d + '°' + m.toFixed(2) + "'" + (v >= 0 ? pos : neg);
    };
    const latStr = fmt(lat, 'N', 'S');
    const lonStr = fmt(lon, 'E', 'W');
    return latStr + '  ' + lonStr;
}

// ── XML helpers ────────────────────────────────────────────────

function escapeXml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// ── Waypoint class ─────────────────────────────────────────────

class Waypoint {
    /**
     * @param {number} lat - Latitude (decimal degrees).
     * @param {number} lon - Longitude (decimal degrees).
     * @param {string} name - Display name.
     * @param {string} [icon='default'] - Icon type.
     * @param {string} [description=''] - Optional description.
     */
    constructor(lat, lon, name, icon = 'default', description = '') {
        this.id = generateUUID();
        this.lat = lat;
        this.lon = lon;
        this.name = name || '';
        this.icon = VALID_ICONS.includes(icon) ? icon : 'default';
        this.description = description || '';
        this.createdAt = new Date().toISOString();
    }

    /** Great-circle distance to another waypoint in NM. */
    distanceTo(other) {
        return gcDistance(this.lat, this.lon, other.lat, other.lon);
    }

    /** Initial bearing to another waypoint in degrees true. */
    bearingTo(other) {
        return gcBearing(this.lat, this.lon, other.lat, other.lon);
    }

    /** Serialize to GPX <wpt> element. */
    toGPX() {
        let gpx = `  <wpt lat="${this.lat}" lon="${this.lon}">\n`;
        gpx += `    <name>${escapeXml(this.name)}</name>\n`;
        if (this.description) {
            gpx += `    <desc>${escapeXml(this.description)}</desc>\n`;
        }
        gpx += `    <sym>${escapeXml(this.icon)}</sym>\n`;
        gpx += `    <time>${this.createdAt}</time>\n`;
        gpx += `  </wpt>`;
        return gpx;
    }

    /** Create a plain object for JSON serialization. */
    toJSON() {
        return {
            id: this.id,
            lat: this.lat,
            lon: this.lon,
            name: this.name,
            icon: this.icon,
            description: this.description,
            createdAt: this.createdAt
        };
    }

    /** Reconstruct a Waypoint from a plain object. */
    static fromJSON(obj) {
        const wp = new Waypoint(obj.lat, obj.lon, obj.name, obj.icon, obj.description);
        wp.id = obj.id || wp.id;
        wp.createdAt = obj.createdAt || wp.createdAt;
        return wp;
    }
}

// ── Route class ────────────────────────────────────────────────

class Route {
    /**
     * @param {string} name - Route name.
     */
    constructor(name) {
        this.id = generateUUID();
        this.name = name || 'Unnamed Route';
        this.waypoints = [];
        this.active = false;
        this.visible = true;
        this.color = '#ff0000';
        this.createdAt = new Date().toISOString();
    }

    /** Append a waypoint to the end of the route. */
    addWaypoint(wp) {
        if (!(wp instanceof Waypoint)) {
            throw new TypeError('addWaypoint requires a Waypoint instance');
        }
        this.waypoints.push(wp);
    }

    /** Insert a waypoint at the given index. */
    insertWaypoint(wp, index) {
        if (!(wp instanceof Waypoint)) {
            throw new TypeError('insertWaypoint requires a Waypoint instance');
        }
        const i = Math.max(0, Math.min(index, this.waypoints.length));
        this.waypoints.splice(i, 0, wp);
    }

    /** Remove waypoint at index and return it. */
    removeWaypoint(index) {
        if (index < 0 || index >= this.waypoints.length) return null;
        return this.waypoints.splice(index, 1)[0];
    }

    /** Reverse the waypoint order in-place. */
    reverse() {
        this.waypoints.reverse();
    }

    /** Total route distance in NM. */
    totalDistance() {
        let total = 0;
        for (let i = 1; i < this.waypoints.length; i++) {
            total += this.waypoints[i - 1].distanceTo(this.waypoints[i]);
        }
        return total;
    }

    /**
     * Compute leg details.
     * @returns {Array<{from: Waypoint, to: Waypoint, distance: number, bearing: number, cumulativeDist: number}>}
     */
    legs() {
        const result = [];
        let cumulative = 0;
        for (let i = 1; i < this.waypoints.length; i++) {
            const from = this.waypoints[i - 1];
            const to = this.waypoints[i];
            const distance = from.distanceTo(to);
            const bearing = from.bearingTo(to);
            cumulative += distance;
            result.push({ from, to, distance, bearing, cumulativeDist: cumulative });
        }
        return result;
    }

    /** Serialize to GPX <rte> element. */
    toGPX() {
        let gpx = `  <rte>\n    <name>${escapeXml(this.name)}</name>\n`;
        for (const wp of this.waypoints) {
            gpx += `    <rtept lat="${wp.lat}" lon="${wp.lon}">`;
            gpx += `<name>${escapeXml(wp.name)}</name>`;
            if (wp.description) {
                gpx += `<desc>${escapeXml(wp.description)}</desc>`;
            }
            gpx += `</rtept>\n`;
        }
        gpx += `  </rte>`;
        return gpx;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            waypoints: this.waypoints.map(wp => wp.toJSON()),
            active: this.active,
            visible: this.visible,
            color: this.color,
            createdAt: this.createdAt
        };
    }

    static fromJSON(obj) {
        const route = new Route(obj.name);
        route.id = obj.id || route.id;
        route.active = !!obj.active;
        route.visible = obj.visible !== false;
        route.color = obj.color || '#ff0000';
        route.createdAt = obj.createdAt || route.createdAt;
        route.waypoints = (obj.waypoints || []).map(w => Waypoint.fromJSON(w));
        return route;
    }
}

// ── Track class ────────────────────────────────────────────────

class Track {
    /**
     * @param {string} name - Track name.
     */
    constructor(name) {
        this.id = generateUUID();
        this.name = name || 'Track ' + new Date().toISOString().slice(0, 10);
        this.points = [];
        this.recording = false;
        this.visible = true;
        this.color = '#0000ff';
        this.startTime = null;
    }

    /**
     * Append a track point.
     * @param {number} lat
     * @param {number} lon
     * @param {string|number|Date} [timestamp] - ISO string, epoch ms, or Date.
     * @param {number} [sog] - Speed over ground (knots).
     * @param {number} [cog] - Course over ground (degrees).
     */
    addPoint(lat, lon, timestamp, sog, cog) {
        const ts = timestamp
            ? new Date(timestamp).toISOString()
            : new Date().toISOString();

        const point = { lat, lon, timestamp: ts };
        if (sog != null) point.sog = sog;
        if (cog != null) point.cog = cog;

        this.points.push(point);

        if (this.points.length === 1) {
            this.startTime = ts;
        }
    }

    /** Total track distance in NM. */
    totalDistance() {
        let total = 0;
        for (let i = 1; i < this.points.length; i++) {
            total += gcDistance(
                this.points[i - 1].lat, this.points[i - 1].lon,
                this.points[i].lat, this.points[i].lon
            );
        }
        return total;
    }

    /** Track duration in seconds. */
    duration() {
        if (this.points.length < 2) return 0;
        const first = new Date(this.points[0].timestamp).getTime();
        const last = new Date(this.points[this.points.length - 1].timestamp).getTime();
        return (last - first) / 1000;
    }

    /** Average speed in knots (distance / time). */
    avgSpeed() {
        const dur = this.duration();
        if (dur <= 0) return 0;
        const hours = dur / 3600;
        return this.totalDistance() / hours;
    }

    /** Serialize to GPX <trk> element. */
    toGPX() {
        let gpx = `  <trk>\n    <name>${escapeXml(this.name)}</name>\n`;
        gpx += `    <trkseg>\n`;
        for (const pt of this.points) {
            gpx += `      <trkpt lat="${pt.lat}" lon="${pt.lon}">`;
            gpx += `<time>${pt.timestamp}</time>`;
            if (pt.sog != null) {
                // GPX uses m/s in extensions; store knots in custom extension
                gpx += `<extensions><opencpn:sog>${pt.sog}</opencpn:sog>`;
                if (pt.cog != null) gpx += `<opencpn:cog>${pt.cog}</opencpn:cog>`;
                gpx += `</extensions>`;
            }
            gpx += `</trkpt>\n`;
        }
        gpx += `    </trkseg>\n  </trk>`;
        return gpx;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            points: this.points,
            recording: this.recording,
            visible: this.visible,
            color: this.color,
            startTime: this.startTime
        };
    }

    static fromJSON(obj) {
        const track = new Track(obj.name);
        track.id = obj.id || track.id;
        track.points = obj.points || [];
        track.recording = !!obj.recording;
        track.visible = obj.visible !== false;
        track.color = obj.color || '#0000ff';
        track.startTime = obj.startTime || null;
        return track;
    }
}

// ── MeasureTool class ──────────────────────────────────────────

class MeasureTool {
    constructor() {
        this.points = [];
        this.active = false;
    }

    /** Add a measurement point. */
    addPoint(lat, lon) {
        this.points.push({ lat, lon });
    }

    /** Remove the last added point. */
    removeLastPoint() {
        return this.points.pop() || null;
    }

    /** Clear all measurement points. */
    reset() {
        this.points = [];
    }

    /** Total distance of all legs in NM. */
    totalDistance() {
        let total = 0;
        for (let i = 1; i < this.points.length; i++) {
            total += gcDistance(
                this.points[i - 1].lat, this.points[i - 1].lon,
                this.points[i].lat, this.points[i].lon
            );
        }
        return total;
    }

    /**
     * Leg details for each segment.
     * @returns {Array<{from: {lat,lon}, to: {lat,lon}, dist: number, bearing: number}>}
     */
    legs() {
        const result = [];
        for (let i = 1; i < this.points.length; i++) {
            const from = this.points[i - 1];
            const to = this.points[i];
            result.push({
                from,
                to,
                dist: gcDistance(from.lat, from.lon, to.lat, to.lon),
                bearing: gcBearing(from.lat, from.lon, to.lat, to.lon)
            });
        }
        return result;
    }
}

// ── MOB (Man Overboard) ────────────────────────────────────────

/**
 * Create a Man Overboard waypoint at the given position.
 * @param {number} lat
 * @param {number} lon
 * @returns {Waypoint}
 */
function MOBPoint(lat, lon) {
    const ts = new Date();
    const name = 'MOB ' + ts.toISOString().replace('T', ' ').slice(0, 19);
    const wp = new Waypoint(lat, lon, name, 'mob', 'Man Overboard — ' + ts.toISOString());
    return wp;
}

// ── NavStore — persistence via localStorage ────────────────────

const NAV_STORE_KEYS = {
    waypoints: 'opencpn_waypoints',
    routes: 'opencpn_routes',
    tracks: 'opencpn_tracks'
};

class NavStore {

    static saveWaypoints(waypoints) {
        try {
            const data = waypoints.map(wp => wp.toJSON());
            localStorage.setItem(NAV_STORE_KEYS.waypoints, JSON.stringify(data));
        } catch (e) {
            console.error('NavStore: failed to save waypoints', e);
        }
    }

    static loadWaypoints() {
        try {
            const raw = localStorage.getItem(NAV_STORE_KEYS.waypoints);
            if (!raw) return [];
            return JSON.parse(raw).map(obj => Waypoint.fromJSON(obj));
        } catch (e) {
            console.error('NavStore: failed to load waypoints', e);
            return [];
        }
    }

    static saveRoutes(routes) {
        try {
            const data = routes.map(r => r.toJSON());
            localStorage.setItem(NAV_STORE_KEYS.routes, JSON.stringify(data));
        } catch (e) {
            console.error('NavStore: failed to save routes', e);
        }
    }

    static loadRoutes() {
        try {
            const raw = localStorage.getItem(NAV_STORE_KEYS.routes);
            if (!raw) return [];
            return JSON.parse(raw).map(obj => Route.fromJSON(obj));
        } catch (e) {
            console.error('NavStore: failed to load routes', e);
            return [];
        }
    }

    static saveTracks(tracks) {
        try {
            const data = tracks.map(t => t.toJSON());
            localStorage.setItem(NAV_STORE_KEYS.tracks, JSON.stringify(data));
        } catch (e) {
            console.error('NavStore: failed to save tracks', e);
        }
    }

    static loadTracks() {
        try {
            const raw = localStorage.getItem(NAV_STORE_KEYS.tracks);
            if (!raw) return [];
            return JSON.parse(raw).map(obj => Track.fromJSON(obj));
        } catch (e) {
            console.error('NavStore: failed to load tracks', e);
            return [];
        }
    }

    /**
     * Export all navigation data as a complete GPX 1.1 document.
     * @param {Waypoint[]} waypoints
     * @param {Route[]} routes
     * @param {Track[]} tracks
     * @returns {string} GPX XML string.
     */
    static exportGPX(waypoints, routes, tracks) {
        let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        gpx += `<gpx version="1.1" creator="OpenCPN-WASM"\n`;
        gpx += `     xmlns="http://www.topografix.com/GPX/1/1"\n`;
        gpx += `     xmlns:opencpn="http://www.opencpn.org"\n`;
        gpx += `     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n`;
        gpx += `     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n`;

        if (waypoints && waypoints.length) {
            for (const wp of waypoints) {
                gpx += wp.toGPX() + '\n';
            }
        }
        if (routes && routes.length) {
            for (const rte of routes) {
                gpx += rte.toGPX() + '\n';
            }
        }
        if (tracks && tracks.length) {
            for (const trk of tracks) {
                gpx += trk.toGPX() + '\n';
            }
        }

        gpx += `</gpx>`;
        return gpx;
    }

    /**
     * Parse a GPX string and return extracted navigation objects.
     * @param {string} gpxString - GPX XML content.
     * @returns {{waypoints: Waypoint[], routes: Route[], tracks: Track[]}}
     */
    static importGPX(gpxString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(gpxString, 'application/xml');

        const parserError = doc.querySelector('parsererror');
        if (parserError) {
            throw new Error('Invalid GPX: ' + parserError.textContent.slice(0, 200));
        }

        const waypoints = [];
        const routes = [];
        const tracks = [];

        // Helper: get text content of first child with tag
        const getText = (el, tag) => {
            const child = el.getElementsByTagName(tag)[0];
            return child ? child.textContent : '';
        };

        // Parse waypoints
        const wptElements = doc.getElementsByTagName('wpt');
        for (let i = 0; i < wptElements.length; i++) {
            const el = wptElements[i];
            const lat = parseFloat(el.getAttribute('lat'));
            const lon = parseFloat(el.getAttribute('lon'));
            if (isNaN(lat) || isNaN(lon)) continue;

            const name = getText(el, 'name') || 'WP' + (i + 1);
            const desc = getText(el, 'desc');
            const sym = getText(el, 'sym') || 'default';
            const wp = new Waypoint(lat, lon, name, sym, desc);

            const time = getText(el, 'time');
            if (time) wp.createdAt = time;

            waypoints.push(wp);
        }

        // Parse routes
        const rteElements = doc.getElementsByTagName('rte');
        for (let i = 0; i < rteElements.length; i++) {
            const el = rteElements[i];
            const name = getText(el, 'name') || 'Route ' + (i + 1);
            const route = new Route(name);

            const rtepts = el.getElementsByTagName('rtept');
            for (let j = 0; j < rtepts.length; j++) {
                const pt = rtepts[j];
                const lat = parseFloat(pt.getAttribute('lat'));
                const lon = parseFloat(pt.getAttribute('lon'));
                if (isNaN(lat) || isNaN(lon)) continue;

                const wpName = getText(pt, 'name') || 'RP' + (j + 1);
                const wpDesc = getText(pt, 'desc');
                route.addWaypoint(new Waypoint(lat, lon, wpName, 'default', wpDesc));
            }
            routes.push(route);
        }

        // Parse tracks
        const trkElements = doc.getElementsByTagName('trk');
        for (let i = 0; i < trkElements.length; i++) {
            const el = trkElements[i];
            const name = getText(el, 'name') || 'Track ' + (i + 1);
            const track = new Track(name);

            const trkpts = el.getElementsByTagName('trkpt');
            for (let j = 0; j < trkpts.length; j++) {
                const pt = trkpts[j];
                const lat = parseFloat(pt.getAttribute('lat'));
                const lon = parseFloat(pt.getAttribute('lon'));
                if (isNaN(lat) || isNaN(lon)) continue;

                const time = getText(pt, 'time') || new Date().toISOString();

                // Parse optional SOG/COG from extensions
                let sog, cog;
                const extensions = pt.getElementsByTagName('extensions')[0];
                if (extensions) {
                    const sogEl = extensions.getElementsByTagName('opencpn:sog')[0];
                    const cogEl = extensions.getElementsByTagName('opencpn:cog')[0];
                    if (sogEl) sog = parseFloat(sogEl.textContent);
                    if (cogEl) cog = parseFloat(cogEl.textContent);
                }

                track.addPoint(lat, lon, time, sog, cog);
            }
            tracks.push(track);
        }

        return { waypoints, routes, tracks };
    }
}

// ── Global exports ─────────────────────────────────────────────

window.Waypoint = Waypoint;
window.Route = Route;
window.Track = Track;
window.MeasureTool = MeasureTool;
window.NavStore = NavStore;
window.MOBPoint = MOBPoint;

window.gcDistance = gcDistance;
window.gcBearing = gcBearing;
window.crossTrackError = crossTrackError;
window.destinationPoint = destinationPoint;

window.formatBearing = formatBearing;
window.formatDistance = formatDistance;
window.formatSpeed = formatSpeed;
window.formatPosition = formatPosition;

window.generateUUID = generateUUID;
window.EARTH_RADIUS_NM = EARTH_RADIUS_NM;
window.NM_TO_METERS = NM_TO_METERS;
