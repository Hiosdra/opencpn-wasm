/**
 * text-renderer.js — 2D canvas overlay for text labels on the chart.
 *
 * Renders soundings (depth numbers), feature names, depth contour labels,
 * buoy/beacon names, and light characteristics as crisp text over the WebGL canvas.
 */

(function() {
'use strict';

class TextRenderer {
    constructor(container) {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'text-overlay';
        this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;';
        container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
        this._labels = [];      // cached label data
        this._occGrid = null;   // collision grid
    }

    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
    }

    /**
     * Build label data from parsed chart.
     * Called once per chart load — produces a list of labels with world coords.
     */
    buildLabels(chartData) {
        this._labels = [];
        if (!chartData) return;

        const pts = chartData.points;
        if (pts && pts.coords) {
            const n = pts.classCodes.length;
            for (let i = 0; i < n; i++) {
                const code = pts.classCodes[i];
                const lon = pts.coords[i * 2];
                const lat = pts.coords[i * 2 + 1];
                const depth = pts.depths[i];

                // Soundings — display depth value
                if (code === 159) { // SOUNDG
                    const d = Math.abs(depth);
                    let text;
                    if (d < 10) {
                        const whole = Math.floor(d);
                        const frac = Math.round((d - whole) * 10);
                        text = frac > 0 ? `${whole}` : `${whole}`;
                        if (frac > 0) text = `${whole}`;
                        // Sounding format: integer part normal, decimal subscript
                        this._labels.push({
                            type: 'sounding',
                            lon, lat,
                            whole, frac,
                            depth: d,
                            priority: d < 5 ? 8 : (d < 10 ? 6 : 4),
                            minZoom: d < 30 ? 0.5 : 2
                        });
                    } else {
                        this._labels.push({
                            type: 'sounding',
                            lon, lat,
                            whole: Math.round(d), frac: 0,
                            depth: d,
                            priority: 3,
                            minZoom: 1
                        });
                    }
                    continue;
                }

                // Lights — show characteristic
                if (code === 75 && pts.litchr) { // LIGHTS
                    const litchr = pts.litchr[i];
                    const colour = pts.colour ? pts.colour[i] : -1;
                    const sigper = pts.sigper ? pts.sigper[i] : -999;
                    const height = pts.height ? pts.height[i] : -999;
                    const sectr1 = pts.sectr1 ? pts.sectr1[i] : -999;
                    const sectr2 = pts.sectr2 ? pts.sectr2[i] : -999;

                    let label = this._lightCharacteristic(litchr, colour, sigper, height);
                    if (label) {
                        this._labels.push({
                            type: 'light',
                            lon, lat,
                            text: label,
                            colour, sectr1, sectr2,
                            priority: 7,
                            minZoom: 0.3
                        });
                    }
                    continue;
                }

                // Buoys — show name
                if ((code === 17 || code === 18 || code === 19) && pts.names && pts.names[i]) {
                    this._labels.push({
                        type: 'buoy',
                        lon, lat,
                        text: pts.names[i],
                        code,
                        priority: 6,
                        minZoom: 1
                    });
                    continue;
                }

                // Beacons
                if ((code === 4 || code === 5 || code === 6) && pts.names && pts.names[i]) {
                    this._labels.push({
                        type: 'beacon',
                        lon, lat,
                        text: pts.names[i],
                        code,
                        priority: 6,
                        minZoom: 1
                    });
                    continue;
                }

                // Named points (any feature with OBJNAM)
                if (pts.names && pts.names[i] && pts.names[i].length > 0) {
                    this._labels.push({
                        type: 'name',
                        lon, lat,
                        text: pts.names[i],
                        code,
                        priority: 4,
                        minZoom: 0.8
                    });
                }
            }
        }

        // Polygon labels (area names, DEPARE depth labels)
        const polys = chartData.polygons;
        if (polys && polys.classCodes) {
            const np = polys.classCodes.length;
            let coordIdx = 0, ringIdx = 0;
            for (let i = 0; i < np; i++) {
                const code = polys.classCodes[i];
                const nRings = polys.ringCounts[i];
                // Compute centroid from first ring
                const firstRingSize = polys.ringSizes[ringIdx];
                let cx = 0, cy = 0;
                for (let j = 0; j < firstRingSize; j++) {
                    cx += polys.coords[(coordIdx + j) * 2];
                    cy += polys.coords[(coordIdx + j) * 2 + 1];
                }
                cx /= firstRingSize;
                cy /= firstRingSize;

                // Skip all rings for this polygon
                let totalPts = 0;
                for (let r = 0; r < nRings; r++) {
                    totalPts += polys.ringSizes[ringIdx + r];
                }
                coordIdx += totalPts;
                ringIdx += nRings;

                // Named areas
                if (polys.names && polys.names[i] && polys.names[i].length > 0) {
                    this._labels.push({
                        type: 'area-name',
                        lon: cx, lat: cy,
                        text: polys.names[i],
                        code,
                        priority: 3,
                        minZoom: 0.3
                    });
                }
            }
        }

        // Sort by priority (high first) for collision detection
        this._labels.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Render all visible labels for the current view.
     * Called after every WebGL render.
     */
    render(cx, cy, zoom, canvasWidth, canvasHeight, colorScheme) {
        const ctx = this.ctx;
        if (!ctx) return;

        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        if (this._labels.length === 0) return;

        const aspect = canvasWidth / canvasHeight;
        const scaleX = zoom * (aspect < 1 ? 1 : 1 / aspect);
        const scaleY = zoom * (aspect > 1 ? 1 : aspect);

        // Determine visible world bounds
        const halfW = 1 / scaleX;
        const halfH = 1 / scaleY;
        const viewMinX = cx - halfW;
        const viewMaxX = cx + halfW;
        const viewMinY = cy - halfH;
        const viewMaxY = cy + halfH;

        // Collision grid (cells of ~30px)
        const cellSize = 30;
        const gridW = Math.ceil(canvasWidth / cellSize);
        const gridH = Math.ceil(canvasHeight / cellSize);
        const grid = new Uint8Array(gridW * gridH);

        const isDark = colorScheme === 'night';
        const isDusk = colorScheme === 'dusk';

        for (const label of this._labels) {
            if (zoom < label.minZoom) continue;

            const wx = lonToX(label.lon);
            const wy = latToY(label.lat);

            // Frustum cull
            if (wx < viewMinX || wx > viewMaxX || wy < viewMinY || wy > viewMaxY) continue;

            // World → screen
            const sx = ((wx - cx) * scaleX + 1) * 0.5 * canvasWidth;
            const sy = (1 - (wy - cy) * scaleY) * 0.5 * canvasHeight;

            if (label.type === 'sounding') {
                this._drawSounding(ctx, sx, sy, label, grid, gridW, cellSize, isDark);
            } else if (label.type === 'light') {
                this._drawLightLabel(ctx, sx, sy, label, isDark);
                if (label.sectr1 > -900 && label.sectr2 > -900) {
                    this._drawLightSector(ctx, sx, sy, label, isDark);
                }
            } else {
                this._drawTextLabel(ctx, sx, sy, label, grid, gridW, cellSize, isDark, isDusk);
            }
        }
    }

    _drawSounding(ctx, sx, sy, label, grid, gridW, cellSize, isDark) {
        const { whole, frac, depth } = label;

        // Font sizes
        const mainSize = depth < 10 ? 11 : 10;
        const subSize = 8;

        // Collision check (approximate label bounds)
        const approxW = (String(whole).length * 7 + (frac > 0 ? 6 : 0));
        const approxH = 14;
        const gx = Math.floor(sx / cellSize);
        const gy = Math.floor(sy / cellSize);

        if (gx < 0 || gx >= gridW || gy < 0 || gy >= Math.ceil(ctx.canvas.height / cellSize)) return;
        const gx2 = Math.min(gridW - 1, gx + Math.ceil(approxW / cellSize));
        const gy2 = Math.min(Math.ceil(ctx.canvas.height / cellSize) - 1, gy + 1);

        // Check for overlap
        for (let y = gy; y <= gy2; y++) {
            for (let x = gx; x <= gx2; x++) {
                if (grid[y * gridW + x]) return;
            }
        }
        // Mark cells
        for (let y = gy; y <= gy2; y++) {
            for (let x = gx; x <= gx2; x++) {
                grid[y * gridW + x] = 1;
            }
        }

        const color = isDark ? 'rgba(180,180,180,0.9)' :
            (depth < 5 ? '#1a1a1a' : (depth < 10 ? '#333' : '#555'));

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (frac > 0 && depth < 31) {
            // Draw whole number
            ctx.font = `bold ${mainSize}px sans-serif`;
            ctx.fillStyle = color;
            const wholeText = String(whole);
            const wholeW = ctx.measureText(wholeText).width;
            ctx.fillText(wholeText, sx - 2, sy);

            // Draw decimal as subscript
            ctx.font = `${subSize}px sans-serif`;
            ctx.fillText(String(frac), sx + wholeW / 2 + 1, sy + 3);
        } else {
            ctx.font = `bold ${mainSize}px sans-serif`;
            ctx.fillStyle = color;
            ctx.fillText(String(whole), sx, sy);
        }
    }

    _drawLightLabel(ctx, sx, sy, label, isDark) {
        ctx.font = '9px sans-serif';
        ctx.fillStyle = isDark ? '#ff6699' : '#cc0066';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(label.text, sx + 8, sy - 4);
    }

    _drawLightSector(ctx, sx, sy, label, isDark) {
        const { sectr1, sectr2, colour } = label;
        const radius = 25;

        // Convert bearing (from north, CW) to canvas angle (from east, CCW)
        const toRad = d => (90 - d) * Math.PI / 180;
        const startAngle = -toRad(sectr2);  // Swap because canvas goes CW
        const endAngle = -toRad(sectr1);

        const colors = {
            1: 'rgba(255,255,255,0.3)',  // white
            3: 'rgba(255,0,0,0.3)',      // red
            4: 'rgba(0,200,0,0.3)',      // green
            6: 'rgba(255,255,0,0.3)',    // yellow
        };
        const sectorColor = colors[colour] || 'rgba(255,0,255,0.2)';

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = sectorColor;
        ctx.fill();
        ctx.strokeStyle = isDark ? 'rgba(255,0,150,0.5)' : 'rgba(200,0,100,0.5)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    }

    _drawTextLabel(ctx, sx, sy, label, grid, gridW, cellSize, isDark, isDusk) {
        const fontSize = label.type === 'area-name' ? 12 : 10;
        ctx.font = `${label.type === 'area-name' ? 'italic ' : ''}${fontSize}px sans-serif`;

        const text = label.text;
        const tm = ctx.measureText(text);
        const tw = tm.width + 4;
        const th = fontSize + 4;

        // Collision check
        const gx = Math.floor((sx - tw / 2) / cellSize);
        const gy = Math.floor((sy - th / 2) / cellSize);
        const gx2 = Math.floor((sx + tw / 2) / cellSize);
        const gy2 = Math.floor((sy + th / 2) / cellSize);
        const maxGx = Math.ceil(ctx.canvas.width / cellSize) - 1;
        const maxGy = Math.ceil(ctx.canvas.height / cellSize) - 1;

        for (let y = Math.max(0, gy); y <= Math.min(maxGy, gy2); y++) {
            for (let x = Math.max(0, gx); x <= Math.min(maxGx, gx2); x++) {
                if (grid[y * gridW + x]) return;
            }
        }
        for (let y = Math.max(0, gy); y <= Math.min(maxGy, gy2); y++) {
            for (let x = Math.max(0, gx); x <= Math.min(maxGx, gx2); x++) {
                grid[y * gridW + x] = 1;
            }
        }

        const colors = {
            'buoy': isDark ? '#88ccff' : '#0066aa',
            'beacon': isDark ? '#88ccff' : '#0066aa',
            'name': isDark ? '#aaaaaa' : '#444444',
            'area-name': isDark ? '#888888' : '#666666',
        };

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Halo for readability
        ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeText(text, sx, sy + (label.type === 'buoy' || label.type === 'beacon' ? -12 : 0));

        ctx.fillStyle = colors[label.type] || '#444';
        ctx.fillText(text, sx, sy + (label.type === 'buoy' || label.type === 'beacon' ? -12 : 0));
    }

    _lightCharacteristic(litchr, colour, sigper, height) {
        const chars = {
            1: 'F', 2: 'Fl', 3: 'LFl', 4: 'Q', 5: 'VQ', 6: 'UQ',
            7: 'Oc', 8: 'Iso', 9: 'F+Fl', 10: 'Fl+LFl',
            11: 'Mo', 12: 'Al', 25: 'Q+LFl', 28: 'Al.Fl',
        };
        const cols = {
            1: 'W', 3: 'R', 4: 'G', 6: 'Y', 11: 'Or',
        };

        let parts = [];
        const ch = chars[litchr];
        if (ch) parts.push(ch);
        const co = cols[colour];
        if (co) parts.push(co);
        if (sigper > 0) parts.push(`${sigper}s`);
        if (height > 0) parts.push(`${Math.round(height)}m`);

        return parts.length > 0 ? parts.join(' ') : null;
    }
}

window.TextRenderer = TextRenderer;

})();
