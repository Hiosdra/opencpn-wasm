/**
 * kap-parser.js — Pure JavaScript BSB/KAP raster chart parser.
 *
 * Parses BSB/KAP format nautical charts:
 *   - Text header (BSB, KNP, REF, PLY, RGB lines)
 *   - RLE-encoded indexed-color pixel data
 *   - Line offset table at end of file
 *
 * Returns decoded RGBA ImageData + georeferencing info.
 * Large images are automatically downsampled to fit maxSize.
 */

class KAPChart {
    constructor() {
        this.name = '';
        this.width = 0;       // original pixel width
        this.height = 0;      // original pixel height
        this.outWidth = 0;    // decoded (possibly downsampled) width
        this.outHeight = 0;   // decoded (possibly downsampled) height
        this.scale = 0;
        this.projection = 'MERCATOR';
        this.datum = 'WGS84';
        this.projParam = 0;   // PP — projection parameter (reference latitude)
        this.skew = 0;
        this.palette = [];    // Array of [r,g,b]
        this.refPoints = [];  // {px, py, lat, lon}
        this.plyPoints = [];  // {lat, lon}
        this.nColorSize = 0;
        this.extent = { minLon: 0, maxLon: 0, minLat: 0, maxLat: 0 };
        this.corners = null;  // {tl, tr, br, bl} — lat/lon of image corners
        this.imageData = null; // Uint8ClampedArray RGBA
    }
}

/**
 * Build a pixel→geo transform from REF points (Mercator projection).
 * Returns functions to convert pixel coords to lat/lon.
 */
function _buildGeoTransform(refPoints, projection) {
    if (refPoints.length < 2) return null;

    // Use first and third REF points (diagonal corners) for a linear fit
    // Sort by pixel distance to get a good pair
    const sorted = [...refPoints].sort((a, b) => (a.px + a.py) - (b.px + b.py));
    const p1 = sorted[0];
    const p2 = sorted[sorted.length - 1];

    // Longitude is linear in pixel X
    const lonPerPx = (p2.lon - p1.lon) / (p2.px - p1.px);
    const lonAtOrigin = p1.lon - lonPerPx * p1.px;

    if (projection === 'MERCATOR') {
        // Latitude: linear in Mercator Y-coordinate
        const toMercY = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
        const fromMercY = (my) => (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * 180 / Math.PI;

        const mercY1 = toMercY(p1.lat);
        const mercY2 = toMercY(p2.lat);
        const mercYPerPx = (mercY2 - mercY1) / (p2.py - p1.py);
        const mercYAtOrigin = mercY1 - mercYPerPx * p1.py;

        return (px, py) => ({
            lon: lonAtOrigin + lonPerPx * px,
            lat: fromMercY(mercYAtOrigin + mercYPerPx * py)
        });
    } else {
        // Fallback: linear lat interpolation (good enough for small charts)
        const latPerPx = (p2.lat - p1.lat) / (p2.py - p1.py);
        const latAtOrigin = p1.lat - latPerPx * p1.py;

        return (px, py) => ({
            lon: lonAtOrigin + lonPerPx * px,
            lat: latAtOrigin + latPerPx * py
        });
    }
}

/**
 * Parse a KAP file from a Uint8Array or ArrayBuffer.
 * @param {Uint8Array|ArrayBuffer} buffer - The KAP file data
 * @param {number} [maxSize=4096] - Maximum output dimension (larger images are downsampled)
 * @returns {KAPChart} Parsed chart with decoded image and georef
 */
function parseKAP(buffer, maxSize = 4096) {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const chart = new KAPChart();

    // ── Phase 1: Parse text header (until 0x1A delimiter) ──
    let headerEnd = 0;
    for (let i = 0; i < Math.min(data.length, 100000); i++) {
        if (data[i] === 0x1A) { headerEnd = i; break; }
    }
    if (headerEnd === 0) throw new Error('KAP: No header delimiter found');

    const headerText = new TextDecoder('ascii').decode(data.subarray(0, headerEnd));
    // Join continuation lines (lines starting with whitespace continue the previous record)
    const rawLines = headerText.split(/\r?\n/);
    const lines = [];
    for (const line of rawLines) {
        if (line.match(/^\s+/) && lines.length > 0) {
            lines[lines.length - 1] += ',' + line.trim();
        } else {
            lines.push(line.trim());
        }
    }

    for (const line of lines) {
        if (line.startsWith('!')) continue; // comment

        if (line.startsWith('BSB/') || line.startsWith('NOS/')) {
            const ra = line.match(/RA=(\d+),(\d+)/);
            if (ra) { chart.width = parseInt(ra[1]); chart.height = parseInt(ra[2]); }
            const na = line.match(/NA=([^,\r\n]+)/);
            if (na) chart.name = na[1].trim();
        }
        else if (line.startsWith('KNP/')) {
            const sc = line.match(/SC=(\d+)/);
            if (sc) chart.scale = parseInt(sc[1]);
            const pr = line.match(/PR=([A-Z_]+)/);
            if (pr) chart.projection = pr[1];
            const gd = line.match(/GD=([^,]+)/);
            if (gd) chart.datum = gd[1].trim();
            const pp = line.match(/PP=([0-9.\-]+)/);
            if (pp) chart.projParam = parseFloat(pp[1]);
            const sk = line.match(/SK=([0-9.\-]+)/);
            if (sk) chart.skew = parseFloat(sk[1]);
        }
        else if (line.startsWith('REF/')) {
            const m = line.match(/REF\/\d+,(\d+),(\d+),([0-9.\-]+),([0-9.\-]+)/);
            if (m) {
                chart.refPoints.push({
                    px: parseInt(m[1]), py: parseInt(m[2]),
                    lat: parseFloat(m[3]), lon: parseFloat(m[4])
                });
            }
        }
        else if (line.startsWith('PLY/')) {
            const m = line.match(/PLY\/\d+,([0-9.\-]+),([0-9.\-]+)/);
            if (m) {
                chart.plyPoints.push({ lat: parseFloat(m[1]), lon: parseFloat(m[2]) });
            }
        }
        else if (line.startsWith('RGB/')) {
            const m = line.match(/RGB\/(\d+),(\d+),(\d+),(\d+)/);
            if (m) {
                chart.palette[parseInt(m[1])] = [parseInt(m[2]), parseInt(m[3]), parseInt(m[4])];
            }
        }
    }

    if (chart.width === 0 || chart.height === 0) {
        throw new Error('KAP: Could not parse chart dimensions from header');
    }

    // ── Phase 2: Skip header delimiter bytes and read nColorSize ──
    // Expected: 0x1A [0x0D 0x0A] 0x00 <nColorSize>
    let pos = headerEnd + 1; // skip the 0x1A we found
    // Handle optional 0x0D 0x0A after first 0x1A
    if (pos < data.length && data[pos] === 0x0D) pos++;
    if (pos < data.length && data[pos] === 0x0A) pos++;
    // Skip second 0x1A if present
    if (pos < data.length && data[pos] === 0x1A) pos++;
    // Skip 0x00
    if (pos < data.length && data[pos] === 0x00) pos++;

    chart.nColorSize = data[pos];
    pos++;
    if (chart.nColorSize <= 0 || chart.nColorSize > 7) {
        throw new Error(`KAP: Invalid nColorSize: ${chart.nColorSize}`);
    }

    // ── Phase 3: Read line offset table from end of file ──
    const lineTableOffset = data.length - (chart.height + 1) * 4;
    const lineOffsets = new Uint32Array(chart.height + 1);
    for (let y = 0; y <= chart.height; y++) {
        lineOffsets[y] = view.getUint32(lineTableOffset + y * 4, false); // big-endian
    }
    lineOffsets[chart.height] = lineTableOffset; // sentinel for last line's end bound

    // ── Phase 4: Compute downscale factor ──
    const step = Math.max(1, Math.ceil(Math.max(chart.width, chart.height) / maxSize));
    const outW = Math.ceil(chart.width / step);
    const outH = Math.ceil(chart.height / step);
    chart.outWidth = outW;
    chart.outHeight = outH;

    // ── Phase 5: Decode RLE pixel data (with downsampling) ──
    const nValueShift = 7 - chart.nColorSize;
    const byValueMask = (((1 << chart.nColorSize)) - 1) << nValueShift;
    const byCountMask = (1 << (7 - chart.nColorSize)) - 1;

    const rgba = new Uint8ClampedArray(outW * outH * 4);
    const rowIndices = new Uint8Array(chart.width); // temp: palette indices for one scanline

    for (let oy = 0; oy < outH; oy++) {
        const srcY = oy * step;
        if (srcY >= chart.height) break;

        // Decode full scanline into palette indices
        let lp = lineOffsets[srcY];
        const lineEnd = (srcY + 1 < chart.height) ? lineOffsets[srcY + 1] : lineTableOffset;

        // Skip line number bytes (MSB set = continuation)
        while (lp < lineEnd && (data[lp] & 0x80) !== 0) lp++;
        if (lp < lineEnd) lp++; // skip the final line-number byte (MSB clear)

        let iPixel = 0;
        rowIndices.fill(0);

        while (iPixel < chart.width && lp < lineEnd) {
            let byNext = data[lp++];
            if (byNext === 0) break;

            const pixValue = (byNext & byValueMask) >> nValueShift;
            let runCount = byNext & byCountMask;

            while ((byNext & 0x80) !== 0 && lp < lineEnd) {
                byNext = data[lp++];
                runCount = runCount * 128 + (byNext & 0x7F);
            }
            runCount++;

            const end = Math.min(iPixel + runCount, chart.width);
            for (let p = iPixel; p < end; p++) {
                rowIndices[p] = pixValue;
            }
            iPixel = end;
        }

        // Subsample into output RGBA
        const outBase = oy * outW * 4;
        for (let ox = 0; ox < outW; ox++) {
            const srcX = ox * step;
            const idx = rowIndices[srcX];
            const rgb = chart.palette[idx] || [128, 128, 128];
            const off = outBase + ox * 4;
            rgba[off] = rgb[0];
            rgba[off + 1] = rgb[1];
            rgba[off + 2] = rgb[2];
            rgba[off + 3] = 255;
        }
    }

    chart.imageData = rgba;

    // ── Phase 6: Georeferencing — compute image corner coordinates ──
    const pixToGeo = _buildGeoTransform(chart.refPoints, chart.projection);
    if (pixToGeo) {
        const tl = pixToGeo(0, 0);
        const tr = pixToGeo(chart.width - 1, 0);
        const br = pixToGeo(chart.width - 1, chart.height - 1);
        const bl = pixToGeo(0, chart.height - 1);
        chart.corners = { tl, tr, br, bl };

        chart.extent = {
            minLat: Math.min(tl.lat, tr.lat, br.lat, bl.lat),
            maxLat: Math.max(tl.lat, tr.lat, br.lat, bl.lat),
            minLon: Math.min(tl.lon, tr.lon, br.lon, bl.lon),
            maxLon: Math.max(tl.lon, tr.lon, br.lon, bl.lon),
        };
    } else if (chart.plyPoints.length > 0) {
        chart.extent.minLat = Math.min(...chart.plyPoints.map(p => p.lat));
        chart.extent.maxLat = Math.max(...chart.plyPoints.map(p => p.lat));
        chart.extent.minLon = Math.min(...chart.plyPoints.map(p => p.lon));
        chart.extent.maxLon = Math.max(...chart.plyPoints.map(p => p.lon));
    }

    if (step > 1) {
        console.log(`KAP downsampled ${step}x: ${chart.width}×${chart.height} → ${outW}×${outH}`);
    }

    return chart;
}
