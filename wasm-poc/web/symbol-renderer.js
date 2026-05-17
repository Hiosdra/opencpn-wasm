/**
 * symbol-renderer.js — Procedural IHO S-52 nautical symbol renderer.
 *
 * Draws proper S-52 point symbols (buoys, beacons, lights, wrecks, etc.)
 * on the 2D canvas overlay using only canvas 2D API — no external images.
 *
 * Integrates with window.App event bus and the TextRenderer overlay canvas.
 */
(function() {
'use strict';

// ══════════════════════════════════════════════════════════════
//  S-52 Color Palette
// ══════════════════════════════════════════════════════════════
const COLORS = {
    black:   '#000000',
    white:   '#FFFFFF',
    red:     '#CC1A1A',
    green:   '#1A8C1A',
    yellow:  '#DAC010',
    orange:  '#E68A10',
    magenta: '#D900AA',
    brown:   '#8C5A33',
    gray:    '#888888',
    darkGray:'#444444',
    lightGray:'#CCCCCC',
    buoyRed: '#CC2222',
    buoyGreen:'#228C22',
    buoyYellow:'#DDBB11',
    buoyBlack:'#1A1A1A',
    buoyWhite:'#EEEEEE',
};

// S-57 COLOUR attribute values
const LIGHT_COLORS = {
    1: '#FFFFFF',  // white
    2: '#000000',  // black
    3: '#FF3333',  // red
    4: '#33CC33',  // green
    5: '#3366FF',  // blue
    6: '#FFDD00',  // yellow
    7: '#888888',  // grey
    8: '#8B4513',  // brown
    9: '#FF8800',  // amber/orange
    10:'#DD00DD', // violet
    11:'#FF6600', // orange
    12:'#FF00FF', // magenta
    13:'#FF69B4', // pink
};

// Night/dusk color adjustments
function adjustColor(hex, colorScheme) {
    if (colorScheme === 'day') return hex;
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    if (colorScheme === 'night') {
        return `rgb(${Math.round(r*0.4)},${Math.round(g*0.35)},${Math.round(b*0.35)})`;
    }
    // dusk — warm and slightly dim
    return `rgb(${Math.min(255, Math.round(r*0.85+10))},${Math.round(g*0.75)},${Math.round(b*0.7)})`;
}

// ══════════════════════════════════════════════════════════════
//  Path Cache — reuse pre-built Path2D objects
// ══════════════════════════════════════════════════════════════
const _pathCache = new Map();

function getCachedPath(key, builder) {
    if (_pathCache.has(key)) return _pathCache.get(key);
    const path = builder();
    _pathCache.set(key, path);
    return path;
}

// ══════════════════════════════════════════════════════════════
//  Declutter Grid
// ══════════════════════════════════════════════════════════════
class DeclutterGrid {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.cells = new Set();
    }

    clear() { this.cells.clear(); }

    canPlace(x, y, w, h) {
        const cs = this.cellSize;
        const c0 = Math.floor(x / cs);
        const r0 = Math.floor(y / cs);
        const c1 = Math.floor((x + w) / cs);
        const r1 = Math.floor((y + h) / cs);
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                if (this.cells.has(`${c},${r}`)) return false;
            }
        }
        return true;
    }

    place(x, y, w, h) {
        const cs = this.cellSize;
        const c0 = Math.floor(x / cs);
        const r0 = Math.floor(y / cs);
        const c1 = Math.floor((x + w) / cs);
        const r1 = Math.floor((y + h) / cs);
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                this.cells.add(`${c},${r}`);
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════
//  Symbol Drawing Primitives
// ══════════════════════════════════════════════════════════════

function drawCan(ctx, x, y, s, color) {
    // Cylinder/can buoy shape (rectangular with rounded top)
    ctx.fillStyle = color;
    ctx.strokeStyle = COLORS.black;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x - s*0.35, y - s*0.5, s*0.7, s*0.7);
    ctx.fill();
    ctx.stroke();
    // flat top
    ctx.beginPath();
    ctx.ellipse(x, y - s*0.5, s*0.35, s*0.1, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
}

function drawCone(ctx, x, y, s, color) {
    // Conical buoy shape (triangle)
    ctx.fillStyle = color;
    ctx.strokeStyle = COLORS.black;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - s*0.55);
    ctx.lineTo(x + s*0.35, y + s*0.2);
    ctx.lineTo(x - s*0.35, y + s*0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

function drawSphere(ctx, x, y, s, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = COLORS.black;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, s*0.3, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
}

function drawPillar(ctx, x, y, s, color) {
    // Tall narrow rectangle (pillar buoy)
    ctx.fillStyle = color;
    ctx.strokeStyle = COLORS.black;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x - s*0.15, y - s*0.55, s*0.3, s*0.8);
    ctx.fill();
    ctx.stroke();
}

function drawPole(ctx, x, y, s) {
    // Beacon pole/pile
    ctx.strokeStyle = COLORS.darkGray;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + s*0.5);
    ctx.lineTo(x, y - s*0.3);
    ctx.stroke();
}

function drawTopmarkConeUp(ctx, x, y, s, color) {
    ctx.fillStyle = color || COLORS.black;
    ctx.beginPath();
    ctx.moveTo(x, y - s*0.25);
    ctx.lineTo(x + s*0.15, y);
    ctx.lineTo(x - s*0.15, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

function drawTopmarkConeDown(ctx, x, y, s, color) {
    ctx.fillStyle = color || COLORS.black;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + s*0.15, y - s*0.25);
    ctx.lineTo(x - s*0.15, y - s*0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

function drawTopmarkSphere(ctx, x, y, s, color) {
    ctx.fillStyle = color || COLORS.black;
    ctx.beginPath();
    ctx.arc(x, y - s*0.15, s*0.1, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
}

function drawTopmarkX(ctx, x, y, s, color) {
    ctx.strokeStyle = color || COLORS.buoyYellow;
    ctx.lineWidth = 2;
    const d = s * 0.15;
    ctx.beginPath();
    ctx.moveTo(x - d, y - s*0.3 - d);
    ctx.lineTo(x + d, y - s*0.3 + d);
    ctx.moveTo(x + d, y - s*0.3 - d);
    ctx.lineTo(x - d, y - s*0.3 + d);
    ctx.stroke();
}

function drawTopmarkCylinder(ctx, x, y, s, color) {
    ctx.fillStyle = color || COLORS.buoyRed;
    ctx.strokeStyle = COLORS.black;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x - s*0.1, y - s*0.3, s*0.2, s*0.15);
    ctx.fill();
    ctx.stroke();
}

// ══════════════════════════════════════════════════════════════
//  Symbol Definitions — Buoys
// ══════════════════════════════════════════════════════════════

const SYMBOLS = {};

// BOYLAT (19) — Lateral buoys
SYMBOLS[19] = function(ctx, x, y, s, attrs, cs) {
    const cat = attrs && attrs.CATLAM;
    if (cat === 2) {
        // Starboard — green cone (IALA A)
        drawCone(ctx, x, y, s, adjustColor(COLORS.buoyGreen, cs));
    } else {
        // Port — red can
        drawCan(ctx, x, y, s, adjustColor(COLORS.buoyRed, cs));
    }
};

// BOYCAR (17) — Cardinal buoys
SYMBOLS[17] = function(ctx, x, y, s, attrs, cs) {
    const cat = attrs && attrs.CATCAM;
    ctx.strokeStyle = COLORS.black;
    ctx.lineWidth = 1;

    if (cat === 1) {
        // North cardinal — black over yellow, 2 cones up
        ctx.fillStyle = adjustColor(COLORS.buoyBlack, cs);
        ctx.beginPath();
        ctx.rect(x - s*0.2, y - s*0.5, s*0.4, s*0.35);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = adjustColor(COLORS.buoyYellow, cs);
        ctx.beginPath();
        ctx.rect(x - s*0.2, y - s*0.15, s*0.4, s*0.35);
        ctx.fill(); ctx.stroke();
        // topmark: 2 cones pointing up
        drawTopmarkConeUp(ctx, x, y - s*0.6, s, COLORS.black);
        drawTopmarkConeUp(ctx, x, y - s*0.8, s, COLORS.black);
    } else if (cat === 2) {
        // East cardinal — black/yellow/black, cones base-to-base
        ctx.fillStyle = adjustColor(COLORS.buoyBlack, cs);
        ctx.beginPath();
        ctx.rect(x - s*0.2, y - s*0.5, s*0.4, s*0.23);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = adjustColor(COLORS.buoyYellow, cs);
        ctx.beginPath();
        ctx.rect(x - s*0.2, y - s*0.27, s*0.4, s*0.24);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = adjustColor(COLORS.buoyBlack, cs);
        ctx.beginPath();
        ctx.rect(x - s*0.2, y - s*0.03, s*0.4, s*0.23);
        ctx.fill(); ctx.stroke();
        // topmark: cones base-to-base (diamond)
        drawTopmarkConeUp(ctx, x, y - s*0.6, s, COLORS.black);
        drawTopmarkConeDown(ctx, x, y - s*0.6, s, COLORS.black);
    } else if (cat === 3) {
        // South cardinal — yellow over black, 2 cones down
        ctx.fillStyle = adjustColor(COLORS.buoyYellow, cs);
        ctx.beginPath();
        ctx.rect(x - s*0.2, y - s*0.5, s*0.4, s*0.35);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = adjustColor(COLORS.buoyBlack, cs);
        ctx.beginPath();
        ctx.rect(x - s*0.2, y - s*0.15, s*0.4, s*0.35);
        ctx.fill(); ctx.stroke();
        // topmark: 2 cones pointing down
        drawTopmarkConeDown(ctx, x, y - s*0.6, s, COLORS.black);
        drawTopmarkConeDown(ctx, x, y - s*0.8, s, COLORS.black);
    } else {
        // West cardinal — yellow/black/yellow, cones point-to-point
        ctx.fillStyle = adjustColor(COLORS.buoyYellow, cs);
        ctx.beginPath();
        ctx.rect(x - s*0.2, y - s*0.5, s*0.4, s*0.23);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = adjustColor(COLORS.buoyBlack, cs);
        ctx.beginPath();
        ctx.rect(x - s*0.2, y - s*0.27, s*0.4, s*0.24);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = adjustColor(COLORS.buoyYellow, cs);
        ctx.beginPath();
        ctx.rect(x - s*0.2, y - s*0.03, s*0.4, s*0.23);
        ctx.fill(); ctx.stroke();
        // topmark: cones point-to-point (hourglass)
        drawTopmarkConeDown(ctx, x, y - s*0.65, s, COLORS.black);
        drawTopmarkConeUp(ctx, x, y - s*0.85, s, COLORS.black);
    }
};

// BOYISD (18) — Isolated danger buoy
SYMBOLS[18] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = COLORS.black;
    ctx.lineWidth = 1;
    // Black/red/black horizontal bands
    ctx.fillStyle = adjustColor(COLORS.buoyBlack, cs);
    ctx.beginPath();
    ctx.rect(x - s*0.25, y - s*0.5, s*0.5, s*0.25);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = adjustColor(COLORS.buoyRed, cs);
    ctx.beginPath();
    ctx.rect(x - s*0.25, y - s*0.25, s*0.5, s*0.25);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = adjustColor(COLORS.buoyBlack, cs);
    ctx.beginPath();
    ctx.rect(x - s*0.25, y, s*0.5, s*0.25);
    ctx.fill(); ctx.stroke();
    // Topmark: 2 black spheres
    drawTopmarkSphere(ctx, x, y - s*0.6, s, COLORS.black);
    drawTopmarkSphere(ctx, x, y - s*0.8, s, COLORS.black);
};

// BOYLAT code 19 already defined above

// BOYSAW (20) — Safe water buoy
SYMBOLS[20] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = COLORS.black;
    ctx.lineWidth = 1;
    // Sphere shape with red/white vertical stripes
    ctx.beginPath();
    ctx.arc(x, y - s*0.1, s*0.35, 0, Math.PI*2);
    ctx.fillStyle = adjustColor(COLORS.buoyWhite, cs);
    ctx.fill();
    ctx.stroke();
    // Red vertical stripes
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y - s*0.1, s*0.34, 0, Math.PI*2);
    ctx.clip();
    ctx.fillStyle = adjustColor(COLORS.buoyRed, cs);
    const stripeW = s * 0.14;
    for (let i = -2; i <= 2; i += 2) {
        ctx.fillRect(x + i * stripeW - stripeW*0.5, y - s*0.5, stripeW, s);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y - s*0.1, s*0.35, 0, Math.PI*2);
    ctx.stroke();
    // Topmark: red sphere
    drawTopmarkSphere(ctx, x, y - s*0.55, s, COLORS.buoyRed);
};

// BOYSPP (21) — Special purpose buoy
SYMBOLS[21] = function(ctx, x, y, s, attrs, cs) {
    // Yellow can/pillar with X topmark
    drawCan(ctx, x, y, s, adjustColor(COLORS.buoyYellow, cs));
    drawTopmarkX(ctx, x, y - s*0.2, s, COLORS.buoyYellow);
};

// ══════════════════════════════════════════════════════════════
//  Symbol Definitions — Beacons
// ══════════════════════════════════════════════════════════════

// BCNCAR (5) — Cardinal beacon
SYMBOLS[5] = function(ctx, x, y, s, attrs, cs) {
    drawPole(ctx, x, y, s);
    // Draw cardinal pattern at top of pole (same logic as cardinal buoy but smaller)
    const cat = attrs && attrs.CATCAM;
    const ts = s * 0.7;
    const ty = y - s*0.3;
    ctx.strokeStyle = COLORS.black;
    ctx.lineWidth = 1;
    if (cat === 1) {
        // North
        drawTopmarkConeUp(ctx, x, ty - ts*0.1, ts, COLORS.black);
        drawTopmarkConeUp(ctx, x, ty - ts*0.3, ts, COLORS.black);
    } else if (cat === 2) {
        // East
        drawTopmarkConeUp(ctx, x, ty - ts*0.1, ts, COLORS.black);
        drawTopmarkConeDown(ctx, x, ty - ts*0.1, ts, COLORS.black);
    } else if (cat === 3) {
        // South
        drawTopmarkConeDown(ctx, x, ty - ts*0.1, ts, COLORS.black);
        drawTopmarkConeDown(ctx, x, ty - ts*0.3, ts, COLORS.black);
    } else {
        // West
        drawTopmarkConeDown(ctx, x, ty - ts*0.15, ts, COLORS.black);
        drawTopmarkConeUp(ctx, x, ty - ts*0.35, ts, COLORS.black);
    }
};

// BCNISD (6) — Isolated danger beacon
SYMBOLS[6] = function(ctx, x, y, s, attrs, cs) {
    drawPole(ctx, x, y, s);
    // Black/red/black bands on pole
    ctx.fillStyle = adjustColor(COLORS.buoyBlack, cs);
    ctx.fillRect(x - s*0.08, y - s*0.1, s*0.16, s*0.15);
    ctx.fillStyle = adjustColor(COLORS.buoyRed, cs);
    ctx.fillRect(x - s*0.08, y - s*0.25, s*0.16, s*0.15);
    ctx.fillStyle = adjustColor(COLORS.buoyBlack, cs);
    ctx.fillRect(x - s*0.08, y - s*0.4, s*0.16, s*0.15);
    // Topmark: 2 spheres
    drawTopmarkSphere(ctx, x, y - s*0.5, s*0.7, COLORS.black);
    drawTopmarkSphere(ctx, x, y - s*0.65, s*0.7, COLORS.black);
};

// BCNLAT (7) — Lateral beacon
SYMBOLS[7] = function(ctx, x, y, s, attrs, cs) {
    drawPole(ctx, x, y, s);
    const cat = attrs && attrs.CATLAM;
    if (cat === 2) {
        // Starboard — green triangle topmark
        drawTopmarkConeUp(ctx, x, y - s*0.35, s*0.8, COLORS.buoyGreen);
    } else {
        // Port — red cylinder topmark
        drawTopmarkCylinder(ctx, x, y - s*0.35, s*0.8, COLORS.buoyRed);
    }
};

// BCNSAW (8) — Safe water beacon
SYMBOLS[8] = function(ctx, x, y, s, attrs, cs) {
    drawPole(ctx, x, y, s);
    drawTopmarkSphere(ctx, x, y - s*0.4, s*0.9, COLORS.buoyRed);
};

// BCNSPP (9) — Special purpose beacon
SYMBOLS[9] = function(ctx, x, y, s, attrs, cs) {
    drawPole(ctx, x, y, s);
    drawTopmarkX(ctx, x, y - s*0.1, s*0.9, COLORS.buoyYellow);
};

// ══════════════════════════════════════════════════════════════
//  Symbol Definitions — Lights
// ══════════════════════════════════════════════════════════════

// LIGHTS (75) — Navigational light
SYMBOLS[75] = function(ctx, x, y, s, attrs, cs) {
    const colAttr = attrs && attrs.COLOUR;
    const col = LIGHT_COLORS[colAttr] || LIGHT_COLORS[1];
    const color = adjustColor(col, cs);
    const range = attrs && attrs.VALNMR;

    // Outer glow / range ring
    if (range && range > 0) {
        const ringR = Math.min(s * 1.5, s * 0.5 + range * 1.5);
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(x, y, ringR, 0, Math.PI*2);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
    }

    // Light sectors
    if (attrs && attrs.SECTR1 !== undefined && attrs.SECTR2 !== undefined) {
        const r1 = (attrs.SECTR1 - 90) * Math.PI / 180;
        const r2 = (attrs.SECTR2 - 90) * Math.PI / 180;
        const sectorR = s * 1.2;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, sectorR, r1, r2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }

    // Central circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, s*0.2, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = adjustColor(COLORS.black, cs);
    ctx.lineWidth = 1;
    ctx.stroke();

    // Star rays
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    const rays = 6;
    const innerR = s * 0.22;
    const outerR = s * 0.45;
    for (let i = 0; i < rays; i++) {
        const angle = (i / rays) * Math.PI * 2 - Math.PI/2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * innerR, y + Math.sin(angle) * innerR);
        ctx.lineTo(x + Math.cos(angle) * outerR, y + Math.sin(angle) * outerR);
        ctx.stroke();
    }
};

// ══════════════════════════════════════════════════════════════
//  Symbol Definitions — Wrecks, Rocks, Obstructions
// ══════════════════════════════════════════════════════════════

// WRECKS (141) — Shipwreck
SYMBOLS[141] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.black, cs);
    ctx.lineWidth = 1.5;
    // Hull outline
    ctx.beginPath();
    ctx.moveTo(x - s*0.45, y + s*0.1);
    ctx.quadraticCurveTo(x - s*0.3, y + s*0.35, x, y + s*0.3);
    ctx.quadraticCurveTo(x + s*0.3, y + s*0.35, x + s*0.45, y + s*0.1);
    ctx.stroke();
    // Mast
    ctx.beginPath();
    ctx.moveTo(x, y + s*0.2);
    ctx.lineTo(x, y - s*0.4);
    ctx.stroke();
    // Cross arm
    ctx.beginPath();
    ctx.moveTo(x - s*0.2, y - s*0.2);
    ctx.lineTo(x + s*0.2, y - s*0.2);
    ctx.stroke();
    // Danger indication for dangerous wrecks
    const catwrk = attrs && attrs.CATWRK;
    if (catwrk === 1 || catwrk === 2) {
        // Dotted circle around wreck
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(x, y, s*0.55, 0, Math.PI*2);
        ctx.stroke();
        ctx.setLineDash([]);
    }
};

// UWTROC (135) — Underwater rock
SYMBOLS[135] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.black, cs);
    ctx.lineWidth = 1.5;
    const watlev = attrs && attrs.WATLEV;
    if (watlev === 3) {
        // Awash — asterisk *
        const r = s * 0.3;
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(a)*r, y + Math.sin(a)*r);
            ctx.stroke();
        }
    } else {
        // Submerged — plus +
        const r = s * 0.3;
        ctx.beginPath();
        ctx.moveTo(x - r, y);
        ctx.lineTo(x + r, y);
        ctx.moveTo(x, y - r);
        ctx.lineTo(x, y + r);
        ctx.stroke();
    }
    // Depth label if available
    if (attrs && attrs.VALSOU !== undefined) {
        ctx.font = `${Math.round(s*0.35)}px sans-serif`;
        ctx.fillStyle = adjustColor(COLORS.black, cs);
        ctx.textAlign = 'center';
        ctx.fillText(attrs.VALSOU.toFixed(1), x, y + s*0.55);
    }
};

// OBSTRN (74) — Obstruction
SYMBOLS[74] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.black, cs);
    ctx.lineWidth = 1.5;
    // Danger symbol: circle with cross
    ctx.beginPath();
    ctx.arc(x, y, s*0.3, 0, Math.PI*2);
    ctx.stroke();
    const r = s*0.22;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
};

// OBSTRN alternate code (86)
SYMBOLS[86] = SYMBOLS[74];

// ══════════════════════════════════════════════════════════════
//  Symbol Definitions — Topmarks (standalone)
// ══════════════════════════════════════════════════════════════

// TOPMAR (126) — Topmark
SYMBOLS[126] = function(ctx, x, y, s, attrs, cs) {
    const topshp = attrs && attrs.TOPSHP;
    ctx.strokeStyle = adjustColor(COLORS.black, cs);
    ctx.lineWidth = 1;
    switch(topshp) {
        case 1: // cone point up
            drawTopmarkConeUp(ctx, x, y, s, COLORS.black);
            break;
        case 2: // cone point down
            drawTopmarkConeDown(ctx, x, y, s, COLORS.black);
            break;
        case 3: // sphere
            drawTopmarkSphere(ctx, x, y, s, COLORS.black);
            break;
        case 4: // 2 spheres
            drawTopmarkSphere(ctx, x, y, s, COLORS.black);
            drawTopmarkSphere(ctx, x, y - s*0.25, s, COLORS.black);
            break;
        case 5: // cylinder
            drawTopmarkCylinder(ctx, x, y, s, COLORS.buoyRed);
            break;
        case 6: // X shape
            drawTopmarkX(ctx, x, y + s*0.2, s, COLORS.buoyYellow);
            break;
        case 7: // 2 cones up
            drawTopmarkConeUp(ctx, x, y, s, COLORS.black);
            drawTopmarkConeUp(ctx, x, y - s*0.25, s, COLORS.black);
            break;
        case 8: // 2 cones down
            drawTopmarkConeDown(ctx, x, y, s, COLORS.black);
            drawTopmarkConeDown(ctx, x, y - s*0.25, s, COLORS.black);
            break;
        case 9: // 2 cones point-to-point
            drawTopmarkConeDown(ctx, x, y - s*0.05, s, COLORS.black);
            drawTopmarkConeUp(ctx, x, y - s*0.25, s, COLORS.black);
            break;
        case 10: // 2 cones base-to-base
            drawTopmarkConeUp(ctx, x, y, s, COLORS.black);
            drawTopmarkConeDown(ctx, x, y, s, COLORS.black);
            break;
        default:
            drawTopmarkSphere(ctx, x, y, s, COLORS.black);
    }
};

// ══════════════════════════════════════════════════════════════
//  Symbol Definitions — Landmarks
// ══════════════════════════════════════════════════════════════

// LNDMRK (60) — Landmark
SYMBOLS[60] = function(ctx, x, y, s, attrs, cs) {
    const catlmk = attrs && attrs.CATLMK;
    ctx.strokeStyle = adjustColor(COLORS.darkGray, cs);
    ctx.fillStyle = adjustColor(COLORS.brown, cs);
    ctx.lineWidth = 1.5;

    switch(catlmk) {
        case 17: // church/chapel
        case 2:  // church
            // Tower with cross
            ctx.beginPath();
            ctx.rect(x - s*0.15, y - s*0.2, s*0.3, s*0.5);
            ctx.fill(); ctx.stroke();
            // Spire
            ctx.beginPath();
            ctx.moveTo(x, y - s*0.55);
            ctx.lineTo(x - s*0.12, y - s*0.2);
            ctx.lineTo(x + s*0.12, y - s*0.2);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
            // Cross
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, y - s*0.55);
            ctx.lineTo(x, y - s*0.7);
            ctx.moveTo(x - s*0.08, y - s*0.62);
            ctx.lineTo(x + s*0.08, y - s*0.62);
            ctx.stroke();
            break;
        case 3:  // chimney
            ctx.beginPath();
            ctx.rect(x - s*0.08, y - s*0.5, s*0.16, s*0.7);
            ctx.fill(); ctx.stroke();
            // Smoke
            ctx.strokeStyle = adjustColor(COLORS.gray, cs);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y - s*0.5);
            ctx.quadraticCurveTo(x + s*0.1, y - s*0.6, x, y - s*0.7);
            ctx.stroke();
            break;
        case 20: // tower
        case 14: // tower
            // Generic tower
            ctx.beginPath();
            ctx.moveTo(x - s*0.2, y + s*0.3);
            ctx.lineTo(x - s*0.1, y - s*0.45);
            ctx.lineTo(x + s*0.1, y - s*0.45);
            ctx.lineTo(x + s*0.2, y + s*0.3);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
            break;
        default:
            // Generic landmark circle
            ctx.beginPath();
            ctx.arc(x, y, s*0.25, 0, Math.PI*2);
            ctx.fill(); ctx.stroke();
            // Dot in center
            ctx.fillStyle = adjustColor(COLORS.black, cs);
            ctx.beginPath();
            ctx.arc(x, y, s*0.06, 0, Math.PI*2);
            ctx.fill();
    }
};

// ══════════════════════════════════════════════════════════════
//  Symbol Definitions — Fog Signal, Radar, Pilot
// ══════════════════════════════════════════════════════════════

// FOGSIG (44) — Fog signal
SYMBOLS[44] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1;
    // Horn/diaphone symbol — concentric arcs
    for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(x, y, s * 0.15 * i, -Math.PI*0.4, Math.PI*0.4);
        ctx.stroke();
    }
    // Center dot
    ctx.fillStyle = adjustColor(COLORS.magenta, cs);
    ctx.beginPath();
    ctx.arc(x, y, s*0.06, 0, Math.PI*2);
    ctx.fill();
};

// RADRFL (90) — Radar reflector
SYMBOLS[90] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.darkGray, cs);
    ctx.lineWidth = 1.5;
    // Diamond shape
    const d = s * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, y - d);
    ctx.lineTo(x + d*0.6, y);
    ctx.lineTo(x, y + d);
    ctx.lineTo(x - d*0.6, y);
    ctx.closePath();
    ctx.stroke();
    // Internal lines
    ctx.beginPath();
    ctx.moveTo(x - d*0.6, y);
    ctx.lineTo(x + d*0.6, y);
    ctx.moveTo(x, y - d);
    ctx.lineTo(x, y + d);
    ctx.stroke();
};

// RADSTA (91) — Radar station
SYMBOLS[91] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1.5;
    // Concentric circles with radiating lines
    ctx.beginPath();
    ctx.arc(x, y, s*0.15, 0, Math.PI*2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, s*0.3, 0, Math.PI*2);
    ctx.stroke();
    // Antenna lines
    const rays = 4;
    for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2 - Math.PI/4;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a)*s*0.15, y + Math.sin(a)*s*0.15);
        ctx.lineTo(x + Math.cos(a)*s*0.45, y + Math.sin(a)*s*0.45);
        ctx.stroke();
    }
};

// PILBOP (80) — Pilot boarding place
SYMBOLS[80] = function(ctx, x, y, s, attrs, cs) {
    // Circle with 'P' — pilot diamond
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.fillStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1.5;
    // Diamond outline
    const d = s * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y - d);
    ctx.lineTo(x + d, y);
    ctx.lineTo(x, y + d);
    ctx.lineTo(x - d, y);
    ctx.closePath();
    ctx.stroke();
    // 'P' inside
    ctx.font = `bold ${Math.round(s*0.4)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', x, y);
};

// ══════════════════════════════════════════════════════════════
//  Symbol Definitions — Anchorage, Berths, Mooring
// ══════════════════════════════════════════════════════════════

// ACHARE (4) and ACHBRT (3) — Anchorage
SYMBOLS[4] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.fillStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1.5;
    // Anchor symbol
    const as = s * 0.4;
    // Ring at top
    ctx.beginPath();
    ctx.arc(x, y - as*0.9, as*0.15, 0, Math.PI*2);
    ctx.stroke();
    // Shank
    ctx.beginPath();
    ctx.moveTo(x, y - as*0.75);
    ctx.lineTo(x, y + as*0.5);
    ctx.stroke();
    // Cross bar
    ctx.beginPath();
    ctx.moveTo(x - as*0.4, y - as*0.3);
    ctx.lineTo(x + as*0.4, y - as*0.3);
    ctx.stroke();
    // Flukes (arms)
    ctx.beginPath();
    ctx.moveTo(x - as*0.5, y + as*0.1);
    ctx.quadraticCurveTo(x - as*0.4, y + as*0.5, x, y + as*0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + as*0.5, y + as*0.1);
    ctx.quadraticCurveTo(x + as*0.4, y + as*0.5, x, y + as*0.5);
    ctx.stroke();
};
SYMBOLS[3] = SYMBOLS[4];

// BERTHS (10) — Berth marker
SYMBOLS[10] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1.5;
    // T-shape berth marker
    ctx.beginPath();
    ctx.moveTo(x - s*0.3, y - s*0.3);
    ctx.lineTo(x + s*0.3, y - s*0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - s*0.3);
    ctx.lineTo(x, y + s*0.3);
    ctx.stroke();
    // Bollard circle
    ctx.beginPath();
    ctx.arc(x, y + s*0.3, s*0.08, 0, Math.PI*2);
    ctx.fillStyle = adjustColor(COLORS.magenta, cs);
    ctx.fill();
};

// MORFAC (72) — Mooring facility
SYMBOLS[72] = function(ctx, x, y, s, attrs, cs) {
    const catmor = attrs && attrs.CATMOR;
    ctx.strokeStyle = adjustColor(COLORS.darkGray, cs);
    ctx.lineWidth = 1.5;

    if (catmor === 1 || catmor === 2) {
        // Dolphin / mooring buoy — circle with cross
        ctx.beginPath();
        ctx.arc(x, y, s*0.25, 0, Math.PI*2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - s*0.18, y);
        ctx.lineTo(x + s*0.18, y);
        ctx.moveTo(x, y - s*0.18);
        ctx.lineTo(x, y + s*0.18);
        ctx.stroke();
    } else if (catmor === 7) {
        // Mooring buoy — sphere outline
        ctx.fillStyle = adjustColor(COLORS.buoyYellow, cs);
        ctx.beginPath();
        ctx.arc(x, y, s*0.2, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
    } else {
        // Generic — bollard symbol
        ctx.fillStyle = adjustColor(COLORS.darkGray, cs);
        ctx.beginPath();
        ctx.arc(x, y, s*0.12, 0, Math.PI*2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, s*0.2, 0, Math.PI*2);
        ctx.stroke();
    }
};

// SMCFAC (110) — Small craft facility
SYMBOLS[110] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.fillStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1;
    // Small boat silhouette
    ctx.beginPath();
    ctx.moveTo(x - s*0.35, y + s*0.1);
    ctx.lineTo(x - s*0.25, y + s*0.2);
    ctx.lineTo(x + s*0.25, y + s*0.2);
    ctx.lineTo(x + s*0.35, y + s*0.1);
    ctx.closePath();
    ctx.stroke();
    // Mast
    ctx.beginPath();
    ctx.moveTo(x, y + s*0.1);
    ctx.lineTo(x, y - s*0.3);
    ctx.stroke();
    // Flag
    ctx.beginPath();
    ctx.moveTo(x, y - s*0.3);
    ctx.lineTo(x + s*0.15, y - s*0.22);
    ctx.lineTo(x, y - s*0.15);
    ctx.closePath();
    ctx.fill();
};

// ══════════════════════════════════════════════════════════════
//  Additional Important Symbols
// ══════════════════════════════════════════════════════════════

// SPRING (115) — Spring (in a harbour)
SYMBOLS[115] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.darkGray, cs);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, s*0.2, 0, Math.PI*2);
    ctx.stroke();
    ctx.fillStyle = adjustColor(COLORS.darkGray, cs);
    ctx.beginPath();
    ctx.arc(x, y, s*0.05, 0, Math.PI*2);
    ctx.fill();
};

// RTPBCN (95) — Radar transponder beacon
SYMBOLS[95] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1.5;
    // Circle with radiating arcs
    ctx.beginPath();
    ctx.arc(x, y, s*0.12, 0, Math.PI*2);
    ctx.fillStyle = adjustColor(COLORS.magenta, cs);
    ctx.fill();
    // Arcs
    for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(x, y, s * 0.12 + i*s*0.1, -Math.PI*0.3, Math.PI*0.3);
        ctx.stroke();
    }
};

// LITFLT (73) — Light float
SYMBOLS[73] = function(ctx, x, y, s, attrs, cs) {
    // Ship-shaped float with light
    ctx.strokeStyle = adjustColor(COLORS.black, cs);
    ctx.fillStyle = adjustColor(COLORS.buoyRed, cs);
    ctx.lineWidth = 1;
    // Hull
    ctx.beginPath();
    ctx.moveTo(x - s*0.35, y + s*0.1);
    ctx.lineTo(x - s*0.3, y + s*0.25);
    ctx.lineTo(x + s*0.3, y + s*0.25);
    ctx.lineTo(x + s*0.35, y + s*0.1);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Mast and light
    ctx.beginPath();
    ctx.moveTo(x, y + s*0.1);
    ctx.lineTo(x, y - s*0.35);
    ctx.stroke();
    // Light circle
    const colAttr = attrs && attrs.COLOUR;
    const col = LIGHT_COLORS[colAttr] || LIGHT_COLORS[1];
    ctx.fillStyle = adjustColor(col, cs);
    ctx.beginPath();
    ctx.arc(x, y - s*0.35, s*0.08, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
};

// LITVES (76) — Light vessel
SYMBOLS[76] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.black, cs);
    ctx.fillStyle = adjustColor(COLORS.buoyRed, cs);
    ctx.lineWidth = 1.5;
    // Larger vessel hull
    ctx.beginPath();
    ctx.moveTo(x - s*0.4, y + s*0.05);
    ctx.quadraticCurveTo(x - s*0.35, y + s*0.3, x, y + s*0.25);
    ctx.quadraticCurveTo(x + s*0.35, y + s*0.3, x + s*0.4, y + s*0.05);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Mast
    ctx.beginPath();
    ctx.moveTo(x, y + s*0.05);
    ctx.lineTo(x, y - s*0.45);
    ctx.stroke();
    // Light
    ctx.fillStyle = adjustColor(COLORS.yellow, cs);
    ctx.beginPath();
    ctx.arc(x, y - s*0.45, s*0.1, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
};

// DAYMAR (39) — Daymark
SYMBOLS[39] = function(ctx, x, y, s, attrs, cs) {
    const colour = attrs && attrs.COLOUR;
    const col = colour === 3 ? COLORS.buoyRed : colour === 4 ? COLORS.buoyGreen : COLORS.buoyYellow;
    ctx.fillStyle = adjustColor(col, cs);
    ctx.strokeStyle = adjustColor(COLORS.black, cs);
    ctx.lineWidth = 1;
    // Square daymark
    ctx.beginPath();
    ctx.rect(x - s*0.25, y - s*0.25, s*0.5, s*0.5);
    ctx.fill(); ctx.stroke();
};

// CBLSUB (22) — Submarine cable
SYMBOLS[22] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1.5;
    // Cable marker — wavy line with diamond
    const d = s*0.2;
    ctx.beginPath();
    ctx.moveTo(x, y - d);
    ctx.lineTo(x + d, y);
    ctx.lineTo(x, y + d);
    ctx.lineTo(x - d, y);
    ctx.closePath();
    ctx.stroke();
    // Lightning bolt
    ctx.beginPath();
    ctx.moveTo(x - s*0.05, y - d*1.5);
    ctx.lineTo(x + s*0.05, y - d*0.5);
    ctx.lineTo(x - s*0.05, y + d*0.5);
    ctx.lineTo(x + s*0.05, y + d*1.5);
    ctx.stroke();
};

// PIPSOL (83) — Pipeline submarine
SYMBOLS[83] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1.5;
    // Pipeline marker — circle with arrow
    ctx.beginPath();
    ctx.arc(x, y, s*0.2, 0, Math.PI*2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s*0.35, y);
    ctx.lineTo(x + s*0.35, y);
    ctx.lineTo(x + s*0.25, y - s*0.1);
    ctx.moveTo(x + s*0.35, y);
    ctx.lineTo(x + s*0.25, y + s*0.1);
    ctx.stroke();
};

// SISTAW (112) — Signal station, warning
SYMBOLS[112] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.fillStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1.5;
    // Flag pole with signal flag
    ctx.beginPath();
    ctx.moveTo(x, y + s*0.4);
    ctx.lineTo(x, y - s*0.4);
    ctx.stroke();
    // Signal flag (triangle)
    ctx.beginPath();
    ctx.moveTo(x, y - s*0.4);
    ctx.lineTo(x + s*0.25, y - s*0.3);
    ctx.lineTo(x, y - s*0.2);
    ctx.closePath();
    ctx.fill();
};

// SISTAT (111) — Signal station, traffic
SYMBOLS[111] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.fillStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1.5;
    // Mast with two arms
    ctx.beginPath();
    ctx.moveTo(x, y + s*0.4);
    ctx.lineTo(x, y - s*0.45);
    ctx.stroke();
    // Cross arm
    ctx.beginPath();
    ctx.moveTo(x - s*0.2, y - s*0.3);
    ctx.lineTo(x + s*0.2, y - s*0.3);
    ctx.stroke();
    // Circles at ends
    ctx.beginPath();
    ctx.arc(x - s*0.2, y - s*0.3, s*0.06, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + s*0.2, y - s*0.3, s*0.06, 0, Math.PI*2);
    ctx.fill();
};

// CGUSTA (24) — Coastguard station
SYMBOLS[24] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1.5;
    // House shape with CG
    ctx.beginPath();
    ctx.rect(x - s*0.25, y - s*0.1, s*0.5, s*0.35);
    ctx.stroke();
    // Roof
    ctx.beginPath();
    ctx.moveTo(x - s*0.3, y - s*0.1);
    ctx.lineTo(x, y - s*0.35);
    ctx.lineTo(x + s*0.3, y - s*0.1);
    ctx.closePath();
    ctx.stroke();
    // CG text
    ctx.fillStyle = adjustColor(COLORS.magenta, cs);
    ctx.font = `bold ${Math.round(s*0.2)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CG', x, y + s*0.08);
};

// CRANES (31) — Crane
SYMBOLS[31] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.darkGray, cs);
    ctx.lineWidth = 1.5;
    // Crane: vertical line with diagonal arm
    ctx.beginPath();
    ctx.moveTo(x, y + s*0.35);
    ctx.lineTo(x, y - s*0.3);
    ctx.stroke();
    // Arm
    ctx.beginPath();
    ctx.moveTo(x, y - s*0.25);
    ctx.lineTo(x + s*0.35, y - s*0.45);
    ctx.stroke();
    // Hook
    ctx.beginPath();
    ctx.moveTo(x + s*0.35, y - s*0.45);
    ctx.lineTo(x + s*0.35, y - s*0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + s*0.35, y - s*0.27, s*0.04, 0, Math.PI*2);
    ctx.stroke();
};

// HRBFAC (49) — Harbour facility
SYMBOLS[49] = function(ctx, x, y, s, attrs, cs) {
    ctx.strokeStyle = adjustColor(COLORS.magenta, cs);
    ctx.lineWidth = 1.5;
    // Square with H
    ctx.beginPath();
    ctx.rect(x - s*0.25, y - s*0.25, s*0.5, s*0.5);
    ctx.stroke();
    ctx.fillStyle = adjustColor(COLORS.magenta, cs);
    ctx.font = `bold ${Math.round(s*0.35)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', x, y);
};

// ══════════════════════════════════════════════════════════════
//  Fallback generic symbol
// ══════════════════════════════════════════════════════════════
function drawFallback(ctx, x, y, s, cs) {
    ctx.strokeStyle = adjustColor(COLORS.gray, cs);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, s*0.2, 0, Math.PI*2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, s*0.04, 0, Math.PI*2);
    ctx.fillStyle = adjustColor(COLORS.gray, cs);
    ctx.fill();
}

// ══════════════════════════════════════════════════════════════
//  SymbolRenderer Class
// ══════════════════════════════════════════════════════════════

class SymbolRenderer {
    constructor() {
        this._declutter = new DeclutterGrid(20);
        this._symbolScale = 1.0;
        this._minSize = 10;
        this._maxSize = 32;
        this._baseSize = 16;
    }

    /**
     * Compute symbol pixel size for current zoom.
     */
    _getSize(zoom) {
        let scale = this._symbolScale;
        if (typeof window !== 'undefined' && window.App && window.App.settings) {
            const userScale = window.App.settings.get('symbolScale');
            if (userScale && userScale > 0) scale = userScale;
        }
        const raw = this._baseSize * scale * (0.7 + zoom * 0.1);
        return Math.max(this._minSize, Math.min(this._maxSize, raw));
    }

    /**
     * Render all symbols for the current frame.
     * @param {CanvasRenderingContext2D} ctx
     * @param {Array} features — [{code, x, y, attrs}]
     * @param {number} zoom — current zoom level
     * @param {string} colorScheme — 'day'|'dusk'|'night'
     */
    renderSymbols(ctx, features, zoom, colorScheme) {
        if (!features || features.length === 0) return;

        const cs = colorScheme || 'day';
        const size = this._getSize(zoom);
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        const margin = size;

        // Reset declutter grid
        this._declutter.cellSize = Math.max(12, size * 0.8);
        this._declutter.clear();

        ctx.save();
        ctx.textBaseline = 'middle';

        for (let i = 0; i < features.length; i++) {
            const f = features[i];
            const fx = f.x;
            const fy = f.y;

            // Viewport culling
            if (fx < -margin || fx > w + margin || fy < -margin || fy > h + margin) continue;

            // Declutter: skip overlapping symbols at lower zoom
            if (zoom < 10) {
                const half = size * 0.5;
                if (!this._declutter.canPlace(fx - half, fy - half, size, size)) continue;
                this._declutter.place(fx - half, fy - half, size, size);
            }

            this.drawSymbol(ctx, f.code, fx, fy, f.attrs, size, cs);
        }

        ctx.restore();
    }

    /**
     * Draw a single symbol at screen position.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} code — S-57 object class code
     * @param {number} x — screen X
     * @param {number} y — screen Y
     * @param {object} attrs — feature attributes
     * @param {number} scale — pixel size
     * @param {string} colorScheme
     */
    drawSymbol(ctx, code, x, y, attrs, scale, colorScheme) {
        const cs = colorScheme || 'day';
        const s = scale || this._baseSize;
        const drawFn = SYMBOLS[code];

        ctx.save();
        if (drawFn) {
            drawFn(ctx, x, y, s, attrs, cs);
        } else {
            drawFallback(ctx, x, y, s, cs);
        }
        ctx.restore();
    }

    /**
     * Check if a symbol renderer exists for this code.
     */
    hasSymbol(code) {
        return !!SYMBOLS[code];
    }

    /**
     * Get list of all supported object class codes.
     */
    getSupportedCodes() {
        return Object.keys(SYMBOLS).map(Number);
    }
}

// Export
window.SymbolRenderer = SymbolRenderer;

})();
