/**
 * s52-styles.js — IHO S-52 Presentation Library styling for S-57 objects.
 *
 * Comprehensive styling rules for ALL S-57 object classes used in maritime
 * electronic navigational charts (ENC). Colors follow the IHO S-52 standard
 * Day colour scheme (COLSTD).
 *
 * Usage:
 *   <script src="s52-styles.js"></script>
 *   const style = window.getS52Style(42);  // DEPARE
 *   const color = window.getDepthColor(7.5);
 *
 * No imports required — attaches to window globals.
 */

(function () {
    'use strict';

    // ────────────────────────────────────────────────────────────
    //  IHO S-52 colour tokens (Day palette, RGBA 0-1)
    // ────────────────────────────────────────────────────────────
    var C = {
        // Water / depth
        DEPVS:  [0.59, 0.83, 0.87, 1.0],  // 0-5 m — shallow danger
        DEPIT:  [0.69, 0.87, 0.90, 1.0],  // 0-5 m — light cyan/teal
        DEPMS:  [0.78, 0.92, 0.95, 1.0],  // 5-10 m
        DEPMD:  [0.85, 0.95, 0.98, 1.0],  // 10-20 m
        DEPDK:  [0.95, 0.98, 1.0,  1.0],  // 20 m+
        DEPDR:  [0.40, 0.60, 0.80, 0.5],  // drying area
        WATER:  [0.75, 0.90, 0.95, 1.0],  // general sea

        // Land
        LANDA:  [0.90, 0.85, 0.70, 1.0],  // land buff/tan
        LANDF:  [0.85, 0.80, 0.65, 1.0],  // built-up / darker tan
        LANDR:  [0.88, 0.83, 0.68, 1.0],  // land region

        // Line colours
        CSTLN:  [0.20, 0.20, 0.20, 1.0],  // coastline
        DEPCT:  [0.50, 0.50, 0.50, 1.0],  // depth contour
        CHBLK:  [0.00, 0.00, 0.00, 1.0],  // chart black
        CHGRD:  [0.55, 0.55, 0.55, 1.0],  // chart gray
        CHGRF:  [0.40, 0.40, 0.40, 1.0],  // dark gray
        CHBRN:  [0.55, 0.35, 0.20, 1.0],  // brown
        CHMGD:  [0.85, 0.00, 0.55, 1.0],  // magenta
        CHMGF:  [0.75, 0.00, 0.50, 0.7],  // magenta faint
        CHRED:  [0.80, 0.10, 0.10, 1.0],  // red
        CHGRN:  [0.10, 0.55, 0.10, 1.0],  // green
        CHYLW:  [0.85, 0.75, 0.10, 1.0],  // yellow
        CHORG:  [0.90, 0.55, 0.10, 1.0],  // orange
        CHNAV:  [0.60, 0.10, 0.60, 1.0],  // purple/nav

        // Misc fills
        RESFL:  [0.90, 0.55, 0.10, 0.20], // restricted area fill
        ANCFL:  [0.60, 0.10, 0.60, 0.15], // anchorage fill
        TSSFL:  [0.85, 0.00, 0.55, 0.12], // TSS fill
        CAUFL:  [0.90, 0.55, 0.10, 0.15], // caution area fill
        DRGFL:  [0.60, 0.80, 0.95, 0.30], // dredged area fill
        MILFL:  [0.80, 0.10, 0.10, 0.15], // military area fill
        FAIRFL: [0.70, 0.88, 0.95, 0.25], // fairway fill

        // Transparent
        CLEAR:  [0.0, 0.0, 0.0, 0.0],
    };

    // ────────────────────────────────────────────────────────────
    //  Depth-colour lookup (IHO S-52 Day colour scheme)
    // ────────────────────────────────────────────────────────────
    var DEPTH_BANDS = [
        { max: 0,   color: C.DEPDR  },
        { max: 5,   color: C.DEPIT  },
        { max: 10,  color: C.DEPMS  },
        { max: 20,  color: C.DEPMD  },
        { max: Infinity, color: C.DEPDK }
    ];

    function getDepthColor(depth) {
        if (depth == null || isNaN(depth)) return C.DEPDK;
        for (var i = 0; i < DEPTH_BANDS.length; i++) {
            if (depth <= DEPTH_BANDS[i].max) return DEPTH_BANDS[i].color;
        }
        return C.DEPDK;
    }

    // ────────────────────────────────────────────────────────────
    //  S-52 Styles — keyed by S-57 OBJL integer codes
    // ────────────────────────────────────────────────────────────
    var S52_STYLES = {

        // ═══════════════════════════════════════════════════════
        //  HYDROGRAPHY — water areas, depths, soundings
        // ═══════════════════════════════════════════════════════

        42: { // DEPARE — Depth area
            name: 'DEPARE', description: 'Depth Area', type: 'area', priority: 1,
            fill: C.DEPIT, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: function (a) {
                var d = (a && a.DRVAL1 != null) ? Number(a.DRVAL1) : null;
                if (d == null) return null;
                return { fill: getDepthColor(d) };
            }
        },

        43: { // DEPCNT — Depth contour
            name: 'DEPCNT', description: 'Depth Contour', type: 'line', priority: 3,
            color: C.DEPCT, lineWidth: 0.7, dash: null,
            labelAttr: 'VALDCO', labelColor: C.DEPCT, labelSize: 10,
            conditional: null
        },

        129: { // SOUNDG — Sounding
            name: 'SOUNDG', description: 'Sounding', type: 'point', priority: 4,
            color: C.CHBLK, pointSize: 3, symbol: 'circle',
            labelAttr: 'DRVAL1', labelColor: C.CHBLK, labelSize: 11,
            conditional: function (a) {
                var d = (a && a.DRVAL1 != null) ? Number(a.DRVAL1) : null;
                if (d != null && d <= 0) return { color: C.CHRED, labelColor: C.CHRED };
                return null;
            }
        },

        119: { // SEAARE — Sea area / named water area
            name: 'SEAARE', description: 'Sea Area', type: 'area', priority: 1,
            fill: C.WATER, outline: null, outlineWidth: 0,
            labelAttr: 'OBJNAM', labelColor: [0.35, 0.55, 0.70, 1.0], labelSize: 12,
            conditional: null
        },

        69: { // LAKARE — Lake
            name: 'LAKARE', description: 'Lake', type: 'area', priority: 2,
            fill: C.DEPIT, outline: [0.45, 0.65, 0.75, 0.6], outlineWidth: 0.5,
            labelAttr: 'OBJNAM', labelColor: [0.30, 0.50, 0.65, 1.0], labelSize: 11,
            conditional: null
        },

        114: { // RIVERS — River
            name: 'RIVERS', description: 'River', type: 'area', priority: 2,
            fill: [0.65, 0.82, 0.88, 1.0], outline: null, outlineWidth: 0,
            labelAttr: 'OBJNAM', labelColor: [0.30, 0.50, 0.65, 1.0], labelSize: 11,
            conditional: null
        },

        46: { // DRGARE — Dredged area
            name: 'DRGARE', description: 'Dredged Area', type: 'area', priority: 2,
            fill: C.DRGFL, outline: [0.30, 0.55, 0.75, 0.6], outlineWidth: 1,
            dash: [6, 4],
            labelAttr: 'DRVAL1', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        134: { // SWPARE — Swept area
            name: 'SWPARE', description: 'Swept Area', type: 'area', priority: 2,
            fill: [0.78, 0.92, 0.95, 0.4], outline: C.CHMGF, outlineWidth: 1,
            dash: [4, 3],
            labelAttr: 'DRVAL1', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        154: { // UNSARE — Unsurveyed area
            name: 'UNSARE', description: 'Unsurveyed Area', type: 'area', priority: 2,
            fill: [0.88, 0.90, 0.92, 0.5], outline: C.CHGRD, outlineWidth: 1,
            dash: [3, 3],
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        121: { // SBDARE — Seabed area
            name: 'SBDARE', description: 'Seabed Area', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: 'NATSUR', labelColor: C.CHGRD, labelSize: 10,
            conditional: null
        },

        143: { // TIDEWY — Tideway
            name: 'TIDEWY', description: 'Tideway', type: 'area', priority: 2,
            fill: [0.70, 0.85, 0.90, 0.4], outline: null, outlineWidth: 0,
            labelAttr: 'OBJNAM', labelColor: C.CHGRD, labelSize: 10,
            conditional: null
        },

        118: { // SNDWAV — Sand waves
            name: 'SNDWAV', description: 'Sand Waves', type: 'area', priority: 1,
            fill: C.CLEAR, outline: C.CHGRD, outlineWidth: 0.5,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  TOPOGRAPHY — land features
        // ═══════════════════════════════════════════════════════

        71: { // LNDARE — Land area
            name: 'LNDARE', description: 'Land Area', type: 'area', priority: 1,
            fill: C.LANDA, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        73: { // LNDRGN — Land region
            name: 'LNDRGN', description: 'Land Region', type: 'area', priority: 1,
            fill: C.LANDR, outline: null, outlineWidth: 0,
            labelAttr: 'OBJNAM', labelColor: [0.40, 0.35, 0.25, 1.0], labelSize: 11,
            conditional: null
        },

        72: { // LNDELV — Land elevation
            name: 'LNDELV', description: 'Land Elevation', type: 'line', priority: 2,
            color: [0.65, 0.55, 0.40, 0.5], lineWidth: 0.5, dash: null,
            labelAttr: 'ELEVAT', labelColor: [0.50, 0.40, 0.30, 1.0], labelSize: 10,
            conditional: null
        },

        13: { // BUAARE — Built-up area
            name: 'BUAARE', description: 'Built-up Area', type: 'area', priority: 2,
            fill: C.LANDF, outline: [0.65, 0.55, 0.40, 0.6], outlineWidth: 0.7,
            labelAttr: 'OBJNAM', labelColor: [0.35, 0.30, 0.20, 1.0], labelSize: 12,
            conditional: null
        },

        12: { // BUISGL — Building, single
            name: 'BUISGL', description: 'Building', type: 'area', priority: 3,
            fill: [0.80, 0.75, 0.60, 1.0], outline: [0.55, 0.50, 0.35, 1.0], outlineWidth: 0.7,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        155: { // VEGATN — Vegetation
            name: 'VEGATN', description: 'Vegetation', type: 'area', priority: 1,
            fill: [0.80, 0.88, 0.70, 0.5], outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        127: { // SLOGRD — Sloping ground
            name: 'SLOGRD', description: 'Sloping Ground', type: 'area', priority: 1,
            fill: [0.88, 0.83, 0.68, 0.5], outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        126: { // SLOTOP — Slope topline
            name: 'SLOTOP', description: 'Slope Topline', type: 'line', priority: 2,
            color: C.CHBRN, lineWidth: 0.7, dash: null,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        66: { // ICEARE — Ice area
            name: 'ICEARE', description: 'Ice Area', type: 'area', priority: 2,
            fill: [0.92, 0.95, 0.98, 0.7], outline: [0.70, 0.80, 0.90, 0.5], outlineWidth: 0.7,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  COASTLINE & SHORELINE
        // ═══════════════════════════════════════════════════════

        30: { // COALNE — Coastline
            name: 'COALNE', description: 'Coastline', type: 'line', priority: 5,
            color: C.CSTLN, lineWidth: 2.5, dash: null,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        70: { // LAKSHR — Lake shore
            name: 'LAKSHR', description: 'Lake Shore', type: 'line', priority: 4,
            color: C.CSTLN, lineWidth: 1.5, dash: null,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        115: { // RIVBNK — River bank
            name: 'RIVBNK', description: 'River Bank', type: 'line', priority: 3,
            color: [0.55, 0.45, 0.30, 1.0], lineWidth: 1.0, dash: null,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        122: { // SLCONS — Shoreline construction
            name: 'SLCONS', description: 'Shoreline Construction', type: 'line', priority: 5,
            color: C.CHGRF, lineWidth: 2.0, dash: null,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  NAVIGATION AIDS — lights, buoys, beacons
        // ═══════════════════════════════════════════════════════

        75: { // LIGHTS — Light
            name: 'LIGHTS', description: 'Light', type: 'point', priority: 8,
            color: C.CHMGD, pointSize: 7, symbol: 'star',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 11,
            conditional: function (a) {
                if (!a || !a.COLOUR) return null;
                var c = Number(a.COLOUR);
                if (c === 3) return { color: C.CHRED, labelColor: C.CHRED };      // red
                if (c === 4) return { color: C.CHGRN, labelColor: C.CHGRN };      // green
                if (c === 6) return { color: C.CHYLW, labelColor: C.CHYLW };      // yellow
                if (c === 1) return { color: [1.0, 1.0, 1.0, 1.0] };             // white
                return null;
            }
        },

        // Buoys
        14: { // BOYCAR — Buoy, cardinal
            name: 'BOYCAR', description: 'Buoy, Cardinal', type: 'point', priority: 7,
            color: C.CHYLW, pointSize: 8, symbol: 'diamond',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        15: { // BOYINB — Buoy, installation
            name: 'BOYINB', description: 'Buoy, Installation', type: 'point', priority: 6,
            color: C.CHYLW, pointSize: 7, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        16: { // BOYISD — Buoy, isolated danger
            name: 'BOYISD', description: 'Buoy, Isolated Danger', type: 'point', priority: 8,
            color: C.CHRED, pointSize: 8, symbol: 'diamond',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        17: { // BOYLAT — Buoy, lateral
            name: 'BOYLAT', description: 'Buoy, Lateral', type: 'point', priority: 7,
            color: C.CHRED, pointSize: 8, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: function (a) {
                if (!a || !a.COLOUR) return null;
                var c = Number(a.COLOUR);
                if (c === 3) return { color: C.CHRED, symbol: 'triangle' };
                if (c === 4) return { color: C.CHGRN, symbol: 'square' };
                return null;
            }
        },

        18: { // BOYSAW — Buoy, safe water
            name: 'BOYSAW', description: 'Buoy, Safe Water', type: 'point', priority: 7,
            color: [0.80, 0.10, 0.10, 1.0], pointSize: 8, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        19: { // BOYSPP — Buoy, special purpose
            name: 'BOYSPP', description: 'Buoy, Special Purpose', type: 'point', priority: 6,
            color: C.CHYLW, pointSize: 7, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        // Beacons
        5: { // BCNCAR — Beacon, cardinal
            name: 'BCNCAR', description: 'Beacon, Cardinal', type: 'point', priority: 7,
            color: C.CHYLW, pointSize: 8, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        6: { // BCNISD — Beacon, isolated danger
            name: 'BCNISD', description: 'Beacon, Isolated Danger', type: 'point', priority: 8,
            color: C.CHRED, pointSize: 8, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        7: { // BCNLAT — Beacon, lateral
            name: 'BCNLAT', description: 'Beacon, Lateral', type: 'point', priority: 7,
            color: C.CHRED, pointSize: 8, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: function (a) {
                if (!a || !a.COLOUR) return null;
                var c = Number(a.COLOUR);
                if (c === 3) return { color: C.CHRED };
                if (c === 4) return { color: C.CHGRN };
                return null;
            }
        },

        8: { // BCNSAW — Beacon, safe water
            name: 'BCNSAW', description: 'Beacon, Safe Water', type: 'point', priority: 7,
            color: [0.80, 0.10, 0.10, 1.0], pointSize: 8, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        9: { // BCNSPP — Beacon, special purpose
            name: 'BCNSPP', description: 'Beacon, Special Purpose', type: 'point', priority: 6,
            color: C.CHYLW, pointSize: 7, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        76: { // LITFLT — Light float
            name: 'LITFLT', description: 'Light Float', type: 'point', priority: 7,
            color: C.CHMGD, pointSize: 8, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        77: { // LITVES — Light vessel
            name: 'LITVES', description: 'Light Vessel', type: 'point', priority: 7,
            color: C.CHMGD, pointSize: 9, symbol: 'diamond',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        39: { // DAYMAR — Daymark
            name: 'DAYMAR', description: 'Daymark', type: 'point', priority: 6,
            color: C.CHBLK, pointSize: 7, symbol: 'square',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        58: { // FOGSIG — Fog signal
            name: 'FOGSIG', description: 'Fog Signal', type: 'point', priority: 5,
            color: C.CHGRD, pointSize: 6, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHGRD, labelSize: 10,
            conditional: null
        },

        113: { // RETRFL — Retro-reflector
            name: 'RETRFL', description: 'Retro-reflector', type: 'point', priority: 5,
            color: C.CHMGD, pointSize: 5, symbol: 'diamond',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        144: { // TOPMAR — Topmark
            name: 'TOPMAR', description: 'Topmark', type: 'point', priority: 6,
            color: C.CHBLK, pointSize: 6, symbol: 'triangle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  HAZARDS — wrecks, rocks, obstructions
        // ═══════════════════════════════════════════════════════

        86: { // OBSTRN — Obstruction
            name: 'OBSTRN', description: 'Obstruction', type: 'point', priority: 8,
            color: [0.15, 0.30, 0.65, 1.0], pointSize: 7, symbol: 'cross',
            labelAttr: 'VALSOU', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        159: { // WRECKS — Wreck
            name: 'WRECKS', description: 'Wreck', type: 'point', priority: 8,
            color: [0.15, 0.30, 0.65, 1.0], pointSize: 8, symbol: 'cross',
            labelAttr: 'VALSOU', labelColor: C.CHBLK, labelSize: 10,
            conditional: function (a) {
                if (!a || !a.WATLEV) return null;
                var w = Number(a.WATLEV);
                if (w === 1 || w === 2) return { color: C.CHBLK, symbol: 'cross' };
                if (w === 5 || w === 4) return { color: [0.15, 0.30, 0.65, 1.0] };
                return null;
            }
        },

        153: { // UWTROC — Underwater / awash rock
            name: 'UWTROC', description: 'Underwater Rock', type: 'point', priority: 8,
            color: C.CHBLK, pointSize: 7, symbol: 'star',
            labelAttr: 'VALSOU', labelColor: C.CHBLK, labelSize: 10,
            conditional: function (a) {
                if (!a || !a.WATLEV) return null;
                var w = Number(a.WATLEV);
                if (w === 4 || w === 5) return { color: [0.15, 0.30, 0.65, 1.0], symbol: 'cross' };
                return null;
            }
        },

        156: { // WATTUR — Water turbulence
            name: 'WATTUR', description: 'Water Turbulence', type: 'point', priority: 5,
            color: C.CHMGD, pointSize: 5, symbol: 'circle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        158: { // WEDKLP — Weed/kelp
            name: 'WEDKLP', description: 'Weed/Kelp', type: 'point', priority: 3,
            color: [0.20, 0.50, 0.20, 0.8], pointSize: 5, symbol: 'circle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  INFRASTRUCTURE — bridges, dams, docks, piers
        // ═══════════════════════════════════════════════════════

        11: { // BRIDGE — Bridge
            name: 'BRIDGE', description: 'Bridge', type: 'line', priority: 6,
            color: C.CHGRF, lineWidth: 3.0, dash: null,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 11,
            conditional: null
        },

        38: { // DAMCON — Dam
            name: 'DAMCON', description: 'Dam', type: 'line', priority: 5,
            color: C.CHGRF, lineWidth: 2.0, dash: null,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        49: { // DYKCON — Dyke
            name: 'DYKCON', description: 'Dyke', type: 'line', priority: 4,
            color: C.CHBRN, lineWidth: 2.0, dash: null,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        95: { // PONTON — Pontoon
            name: 'PONTON', description: 'Pontoon', type: 'area', priority: 4,
            fill: [0.75, 0.75, 0.75, 0.7], outline: C.CHGRF, outlineWidth: 1.0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        65: { // HULKES — Hulk
            name: 'HULKES', description: 'Hulk', type: 'area', priority: 4,
            fill: [0.80, 0.80, 0.80, 0.4], outline: C.CHGRF, outlineWidth: 1.5,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        45: { // DOCARE — Dock area
            name: 'DOCARE', description: 'Dock Area', type: 'area', priority: 3,
            fill: [0.72, 0.86, 0.92, 0.5], outline: C.CHGRF, outlineWidth: 1.0,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        47: { // DRYDOC — Dry dock
            name: 'DRYDOC', description: 'Dry Dock', type: 'area', priority: 3,
            fill: [0.82, 0.78, 0.65, 0.6], outline: C.CHGRF, outlineWidth: 1.0,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        57: { // FLODOC — Floating dock
            name: 'FLODOC', description: 'Floating Dock', type: 'area', priority: 3,
            fill: [0.75, 0.75, 0.75, 0.5], outline: C.CHGRF, outlineWidth: 1.0,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        84: { // MORFAC — Mooring/warping facility
            name: 'MORFAC', description: 'Mooring Facility', type: 'point', priority: 5,
            color: C.CHGRD, pointSize: 6, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        61: { // GATCON — Gate
            name: 'GATCON', description: 'Gate', type: 'line', priority: 5,
            color: C.CHGRF, lineWidth: 2.0, dash: null,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        62: { // GRIDRN — Gridiron
            name: 'GRIDRN', description: 'Gridiron', type: 'area', priority: 3,
            fill: [0.82, 0.78, 0.65, 0.4], outline: C.CHGRD, outlineWidth: 0.7,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        98: { // PYLONS — Pylon/bridge support
            name: 'PYLONS', description: 'Pylon', type: 'point', priority: 5,
            color: C.CHGRF, pointSize: 6, symbol: 'square',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        90: { // PILPNT — Pile
            name: 'PILPNT', description: 'Pile', type: 'point', priority: 5,
            color: C.CHGRF, pointSize: 5, symbol: 'circle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        52: { // FNCLNE — Fence/wall
            name: 'FNCLNE', description: 'Fence/Wall', type: 'line', priority: 3,
            color: C.CHGRD, lineWidth: 0.7, dash: [3, 2],
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        26: { // CAUSWY — Causeway
            name: 'CAUSWY', description: 'Causeway', type: 'line', priority: 4,
            color: C.CHGRF, lineWidth: 2.0, dash: null,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        59: { // FORSTC — Fortified structure
            name: 'FORSTC', description: 'Fortified Structure', type: 'point', priority: 4,
            color: C.CHBLK, pointSize: 7, symbol: 'square',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        125: { // SILTNK — Silo/tank
            name: 'SILTNK', description: 'Silo/Tank', type: 'point', priority: 4,
            color: C.CHBLK, pointSize: 6, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        34: { // CONVYR — Conveyor
            name: 'CONVYR', description: 'Conveyor', type: 'line', priority: 3,
            color: C.CHGRD, lineWidth: 1.0, dash: [4, 2],
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        35: { // CRANES — Crane
            name: 'CRANES', description: 'Crane', type: 'point', priority: 4,
            color: C.CHGRF, pointSize: 6, symbol: 'square',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        151: { // TUNNEL — Tunnel
            name: 'TUNNEL', description: 'Tunnel', type: 'line', priority: 3,
            color: C.CHGRF, lineWidth: 1.5, dash: [6, 3],
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  WATERWAYS — canals, locks, fairways
        // ═══════════════════════════════════════════════════════

        23: { // CANALS — Canal
            name: 'CANALS', description: 'Canal', type: 'area', priority: 2,
            fill: [0.65, 0.82, 0.88, 1.0], outline: C.CSTLN, outlineWidth: 1.0,
            labelAttr: 'OBJNAM', labelColor: [0.30, 0.50, 0.65, 1.0], labelSize: 11,
            conditional: null
        },

        24: { // CANBNK — Canal bank
            name: 'CANBNK', description: 'Canal Bank', type: 'line', priority: 3,
            color: C.CSTLN, lineWidth: 1.0, dash: null,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        51: { // FAIRWY — Fairway
            name: 'FAIRWY', description: 'Fairway', type: 'area', priority: 3,
            fill: C.FAIRFL, outline: [0.40, 0.65, 0.85, 0.5], outlineWidth: 1.0,
            dash: [5, 3],
            labelAttr: 'OBJNAM', labelColor: [0.30, 0.50, 0.70, 1.0], labelSize: 11,
            conditional: null
        },

        79: { // LOKBSN — Lock basin
            name: 'LOKBSN', description: 'Lock Basin', type: 'area', priority: 3,
            fill: [0.72, 0.86, 0.92, 0.5], outline: C.CHGRF, outlineWidth: 1.5,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        80: { // LOGPON — Log pond
            name: 'LOGPON', description: 'Log Pond', type: 'area', priority: 2,
            fill: [0.72, 0.86, 0.92, 0.4], outline: C.CHGRD, outlineWidth: 0.7,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  PORTS & HARBOURS
        // ═══════════════════════════════════════════════════════

        10: { // BERTHS — Berth
            name: 'BERTHS', description: 'Berth', type: 'area', priority: 5,
            fill: [0.60, 0.10, 0.60, 0.15], outline: C.CHNAV, outlineWidth: 1.5,
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        63: { // HRBARE — Harbour area
            name: 'HRBARE', description: 'Harbour Area', type: 'area', priority: 2,
            fill: C.CLEAR, outline: C.CHNAV, outlineWidth: 1.0,
            dash: [5, 3],
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 12,
            conditional: null
        },

        64: { // HRBFAC — Harbour facility
            name: 'HRBFAC', description: 'Harbour Facility', type: 'point', priority: 5,
            color: C.CHNAV, pointSize: 7, symbol: 'anchor',
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        91: { // PILBOP — Pilot boarding place
            name: 'PILBOP', description: 'Pilot Boarding Place', type: 'point', priority: 7,
            color: C.CHMGD, pointSize: 8, symbol: 'diamond',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        128: { // SMCFAC — Small craft facility
            name: 'SMCFAC', description: 'Small Craft Facility', type: 'point', priority: 5,
            color: C.CHNAV, pointSize: 6, symbol: 'anchor',
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  NAVIGATION ROUTES & TRAFFIC
        // ═══════════════════════════════════════════════════════

        85: { // NAVLNE — Navigation line
            name: 'NAVLNE', description: 'Navigation Line', type: 'line', priority: 6,
            color: C.CHMGD, lineWidth: 1.5, dash: [8, 4],
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        109: { // RECTRC — Recommended track
            name: 'RECTRC', description: 'Recommended Track', type: 'line', priority: 6,
            color: C.CHGRN, lineWidth: 1.5, dash: [8, 4],
            labelAttr: 'OBJNAM', labelColor: C.CHGRN, labelSize: 10,
            conditional: null
        },

        108: { // RCRTCL — Recommended route centerline
            name: 'RCRTCL', description: 'Recommended Route Centerline', type: 'line', priority: 6,
            color: C.CHGRN, lineWidth: 1.0, dash: [6, 3],
            labelAttr: null, labelColor: C.CHGRN, labelSize: 10,
            conditional: null
        },

        53: { // FERYRT — Ferry route
            name: 'FERYRT', description: 'Ferry Route', type: 'line', priority: 5,
            color: C.CHMGD, lineWidth: 1.5, dash: [8, 4],
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        40: { // DWRTCL — Deep water route centerline
            name: 'DWRTCL', description: 'DW Route Centerline', type: 'line', priority: 6,
            color: C.CHMGD, lineWidth: 1.5, dash: [10, 4],
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        41: { // DWRTPT — Deep water route part
            name: 'DWRTPT', description: 'DW Route Part', type: 'area', priority: 5,
            fill: C.TSSFL, outline: C.CHMGD, outlineWidth: 1.5,
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        // TSS — Traffic Separation Scheme
        145: { // TSELNE — TSS Line
            name: 'TSELNE', description: 'TSS Separation Line', type: 'line', priority: 6,
            color: C.CHMGD, lineWidth: 2.0, dash: null,
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        146: { // TSSBND — TSS Boundary
            name: 'TSSBND', description: 'TSS Boundary', type: 'line', priority: 6,
            color: C.CHMGD, lineWidth: 1.5, dash: [6, 3],
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        147: { // TSSCRS — TSS Crossing
            name: 'TSSCRS', description: 'TSS Crossing', type: 'area', priority: 5,
            fill: C.TSSFL, outline: C.CHMGD, outlineWidth: 1.5,
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        148: { // TSSLPT — TSS Lane part
            name: 'TSSLPT', description: 'TSS Lane Part', type: 'area', priority: 5,
            fill: C.TSSFL, outline: C.CHMGD, outlineWidth: 1.5,
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        149: { // TSSRON — TSS Roundabout
            name: 'TSSRON', description: 'TSS Roundabout', type: 'area', priority: 5,
            fill: C.TSSFL, outline: C.CHMGD, outlineWidth: 1.5,
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        150: { // TSEZNE — Traffic Separation Zone
            name: 'TSEZNE', description: 'TSS Zone', type: 'area', priority: 5,
            fill: [0.85, 0.00, 0.55, 0.08], outline: C.CHMGD, outlineWidth: 1.0,
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        68: { // ISTZNE — Inshore traffic zone
            name: 'ISTZNE', description: 'Inshore Traffic Zone', type: 'area', priority: 4,
            fill: [0.85, 0.00, 0.55, 0.06], outline: C.CHMGF, outlineWidth: 1.0,
            dash: [5, 3],
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        152: { // TWRTPT — Two-way route part
            name: 'TWRTPT', description: 'Two-way Route Part', type: 'area', priority: 5,
            fill: C.TSSFL, outline: C.CHMGD, outlineWidth: 1.5,
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        110: { // RCTLPT — Recommended Traffic Lane Part
            name: 'RCTLPT', description: 'Recommended Traffic Lane', type: 'area', priority: 5,
            fill: [0.10, 0.55, 0.10, 0.08], outline: C.CHGRN, outlineWidth: 1.0,
            labelAttr: null, labelColor: C.CHGRN, labelSize: 10,
            conditional: null
        },

        104: { // RDOCAL — Radio calling-in point
            name: 'RDOCAL', description: 'Radio Calling-in Point', type: 'point', priority: 6,
            color: C.CHMGD, pointSize: 7, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  REGULATED & RESTRICTED AREAS
        // ═══════════════════════════════════════════════════════

        4: { // ACHARE — Anchorage area
            name: 'ACHARE', description: 'Anchorage Area', type: 'area', priority: 4,
            fill: C.ANCFL, outline: C.CHNAV, outlineWidth: 1.5,
            dash: [6, 4],
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 11,
            conditional: null
        },

        3: { // ACHBRT — Anchor berth
            name: 'ACHBRT', description: 'Anchor Berth', type: 'point', priority: 5,
            color: C.CHNAV, pointSize: 7, symbol: 'anchor',
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        112: { // RESARE — Restricted area
            name: 'RESARE', description: 'Restricted Area', type: 'area', priority: 5,
            fill: C.RESFL, outline: C.CHORG, outlineWidth: 1.5,
            dash: [6, 4],
            labelAttr: 'OBJNAM', labelColor: C.CHORG, labelSize: 11,
            conditional: null
        },

        27: { // CTNARE — Caution area
            name: 'CTNARE', description: 'Caution Area', type: 'area', priority: 5,
            fill: C.CAUFL, outline: C.CHORG, outlineWidth: 1.5,
            dash: [6, 4],
            labelAttr: null, labelColor: C.CHORG, labelSize: 10,
            conditional: null
        },

        96: { // PRCARE — Precautionary area
            name: 'PRCARE', description: 'Precautionary Area', type: 'area', priority: 5,
            fill: [0.90, 0.55, 0.10, 0.10], outline: C.CHORG, outlineWidth: 1.0,
            dash: [6, 3],
            labelAttr: null, labelColor: C.CHORG, labelSize: 10,
            conditional: null
        },

        83: { // MIPARE — Military practice area
            name: 'MIPARE', description: 'Military Practice Area', type: 'area', priority: 5,
            fill: C.MILFL, outline: C.CHRED, outlineWidth: 1.5,
            dash: [8, 4],
            labelAttr: 'OBJNAM', labelColor: C.CHRED, labelSize: 11,
            conditional: null
        },

        48: { // DMPGRD — Dumping ground
            name: 'DMPGRD', description: 'Dumping Ground', type: 'area', priority: 4,
            fill: [0.90, 0.55, 0.10, 0.12], outline: C.CHORG, outlineWidth: 1.0,
            dash: [5, 3],
            labelAttr: null, labelColor: C.CHORG, labelSize: 10,
            conditional: null
        },

        67: { // ICNARE — Incineration area
            name: 'ICNARE', description: 'Incineration Area', type: 'area', priority: 4,
            fill: [0.90, 0.55, 0.10, 0.12], outline: C.CHORG, outlineWidth: 1.0,
            dash: [5, 3],
            labelAttr: null, labelColor: C.CHORG, labelSize: 10,
            conditional: null
        },

        133: { // SUBTLN — Submarine transit lane
            name: 'SUBTLN', description: 'Submarine Transit Lane', type: 'area', priority: 4,
            fill: [0.80, 0.10, 0.10, 0.08], outline: C.CHRED, outlineWidth: 1.0,
            dash: [6, 4],
            labelAttr: null, labelColor: C.CHRED, labelSize: 10,
            conditional: null
        },

        120: { // SPLARE — Sea-plane landing area
            name: 'SPLARE', description: 'Sea-plane Landing Area', type: 'area', priority: 4,
            fill: [0.60, 0.10, 0.60, 0.08], outline: C.CHNAV, outlineWidth: 1.0,
            dash: [5, 3],
            labelAttr: null, labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  CABLES & PIPELINES
        // ═══════════════════════════════════════════════════════

        20: { // CBLARE — Cable area
            name: 'CBLARE', description: 'Cable Area', type: 'area', priority: 4,
            fill: [0.85, 0.00, 0.55, 0.08], outline: C.CHMGF, outlineWidth: 1.0,
            dash: [5, 3],
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        21: { // CBLOHD — Cable, overhead
            name: 'CBLOHD', description: 'Cable, Overhead', type: 'line', priority: 5,
            color: C.CHGRF, lineWidth: 1.5, dash: [4, 2],
            labelAttr: 'VERCLR', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        22: { // CBLSUB — Cable, submarine
            name: 'CBLSUB', description: 'Cable, Submarine', type: 'line', priority: 3,
            color: C.CHMGF, lineWidth: 1.0, dash: [6, 3],
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        92: { // PIPARE — Pipeline area
            name: 'PIPARE', description: 'Pipeline Area', type: 'area', priority: 4,
            fill: [0.85, 0.00, 0.55, 0.08], outline: C.CHMGF, outlineWidth: 1.0,
            dash: [5, 3],
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        93: { // PIPOHD — Pipeline, overhead
            name: 'PIPOHD', description: 'Pipeline, Overhead', type: 'line', priority: 5,
            color: C.CHGRF, lineWidth: 1.5, dash: [4, 2],
            labelAttr: 'VERCLR', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        94: { // PIPSOL — Pipeline, submarine/land
            name: 'PIPSOL', description: 'Pipeline, Submarine', type: 'line', priority: 3,
            color: C.CHMGF, lineWidth: 1.0, dash: [6, 3],
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  OFFSHORE INSTALLATIONS
        // ═══════════════════════════════════════════════════════

        87: { // OFSPLF — Offshore platform
            name: 'OFSPLF', description: 'Offshore Platform', type: 'point', priority: 7,
            color: C.CHBLK, pointSize: 9, symbol: 'square',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        88: { // OSPARE — Offshore production area
            name: 'OSPARE', description: 'Offshore Production Area', type: 'area', priority: 4,
            fill: [0.90, 0.55, 0.10, 0.10], outline: C.CHORG, outlineWidth: 1.0,
            dash: [5, 3],
            labelAttr: 'OBJNAM', labelColor: C.CHORG, labelSize: 10,
            conditional: null
        },

        89: { // OILBAR — Oil barrier
            name: 'OILBAR', description: 'Oil Barrier', type: 'line', priority: 4,
            color: C.CHBLK, lineWidth: 1.5, dash: [4, 2],
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        82: { // MARCUL — Marine farm/culture
            name: 'MARCUL', description: 'Marine Farm', type: 'area', priority: 4,
            fill: [0.85, 0.00, 0.55, 0.08], outline: C.CHMGF, outlineWidth: 1.0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        55: { // FSHFAC — Fishing facility
            name: 'FSHFAC', description: 'Fishing Facility', type: 'point', priority: 4,
            color: C.CHMGD, pointSize: 6, symbol: 'circle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        56: { // FSHGRD — Fishing ground
            name: 'FSHGRD', description: 'Fishing Ground', type: 'area', priority: 2,
            fill: C.CLEAR, outline: C.CHMGF, outlineWidth: 0.7,
            dash: [5, 3],
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        97: { // PRDARE — Production/storage area
            name: 'PRDARE', description: 'Production Area', type: 'area', priority: 3,
            fill: [0.85, 0.80, 0.65, 0.3], outline: C.CHGRD, outlineWidth: 0.7,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  RADIO & RADAR
        // ═══════════════════════════════════════════════════════

        99: { // RADLNE — Radar line
            name: 'RADLNE', description: 'Radar Line', type: 'line', priority: 5,
            color: [0.10, 0.50, 0.10, 0.7], lineWidth: 1.0, dash: [6, 3],
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        100: { // RADRNG — Radar range
            name: 'RADRNG', description: 'Radar Range', type: 'area', priority: 3,
            fill: [0.10, 0.50, 0.10, 0.05], outline: [0.10, 0.50, 0.10, 0.4], outlineWidth: 0.7,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        101: { // RADRFL — Radar reflector
            name: 'RADRFL', description: 'Radar Reflector', type: 'point', priority: 5,
            color: C.CHGRN, pointSize: 5, symbol: 'circle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        102: { // RADSTA — Radar station
            name: 'RADSTA', description: 'Radar Station', type: 'point', priority: 6,
            color: C.CHMGD, pointSize: 7, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        103: { // RTPBCN — Radar transponder beacon
            name: 'RTPBCN', description: 'Radar Transponder', type: 'point', priority: 6,
            color: C.CHMGD, pointSize: 7, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        105: { // RDOSTA — Radio station
            name: 'RDOSTA', description: 'Radio Station', type: 'point', priority: 5,
            color: C.CHMGD, pointSize: 7, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        78: { // LOCMAG — Local magnetic anomaly
            name: 'LOCMAG', description: 'Local Magnetic Anomaly', type: 'point', priority: 3,
            color: C.CHMGD, pointSize: 5, symbol: 'circle',
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        81: { // MAGVAR — Magnetic variation
            name: 'MAGVAR', description: 'Magnetic Variation', type: 'point', priority: 2,
            color: C.CHMGF, pointSize: 4, symbol: 'circle',
            labelAttr: 'VALMAG', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  LANDMARKS & LAND INFRASTRUCTURE
        // ═══════════════════════════════════════════════════════

        74: { // LNDMRK — Landmark
            name: 'LNDMRK', description: 'Landmark', type: 'point', priority: 6,
            color: C.CHBLK, pointSize: 7, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 11,
            conditional: null
        },

        2: { // AIRARE — Airport / airfield
            name: 'AIRARE', description: 'Airport', type: 'area', priority: 3,
            fill: [0.88, 0.85, 0.72, 0.5], outline: C.CHGRD, outlineWidth: 0.7,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 11,
            conditional: null
        },

        106: { // RAILWY — Railway
            name: 'RAILWY', description: 'Railway', type: 'line', priority: 3,
            color: C.CHGRF, lineWidth: 1.5, dash: [6, 2],
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        116: { // ROADWY — Road
            name: 'ROADWY', description: 'Road', type: 'line', priority: 3,
            color: [0.55, 0.45, 0.35, 1.0], lineWidth: 1.5, dash: null,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        117: { // RUNWAY — Runway
            name: 'RUNWAY', description: 'Runway', type: 'area', priority: 3,
            fill: [0.82, 0.80, 0.70, 0.6], outline: C.CHGRD, outlineWidth: 0.7,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        131: { // SQUARE — Square
            name: 'SQUARE', description: 'Square', type: 'area', priority: 2,
            fill: [0.85, 0.82, 0.72, 0.5], outline: C.CHGRD, outlineWidth: 0.5,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        130: { // SPRING — Spring
            name: 'SPRING', description: 'Spring', type: 'point', priority: 3,
            color: [0.30, 0.60, 0.80, 1.0], pointSize: 5, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        107: { // RAPIDS — Rapids
            name: 'RAPIDS', description: 'Rapids', type: 'point', priority: 4,
            color: [0.30, 0.60, 0.80, 1.0], pointSize: 5, symbol: 'circle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        157: { // WATFAL — Waterfall
            name: 'WATFAL', description: 'Waterfall', type: 'point', priority: 4,
            color: [0.30, 0.60, 0.80, 1.0], pointSize: 5, symbol: 'circle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  ADMINISTRATIVE & MARITIME BOUNDARIES
        // ═══════════════════════════════════════════════════════

        1: { // ADMARE — Administration area
            name: 'ADMARE', description: 'Administration Area', type: 'area', priority: 1,
            fill: C.CLEAR, outline: C.CHNAV, outlineWidth: 0.7,
            dash: [8, 4],
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 12,
            conditional: null
        },

        31: { // CONZNE — Contiguous zone
            name: 'CONZNE', description: 'Contiguous Zone', type: 'area', priority: 1,
            fill: C.CLEAR, outline: C.CHNAV, outlineWidth: 0.5,
            dash: [10, 5],
            labelAttr: null, labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        32: { // COSARE — Continental shelf
            name: 'COSARE', description: 'Continental Shelf', type: 'area', priority: 1,
            fill: C.CLEAR, outline: C.CHNAV, outlineWidth: 0.5,
            dash: [10, 5],
            labelAttr: null, labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        37: { // CUSZNE — Custom zone
            name: 'CUSZNE', description: 'Custom Zone', type: 'area', priority: 1,
            fill: C.CLEAR, outline: C.CHNAV, outlineWidth: 0.5,
            dash: [8, 4],
            labelAttr: null, labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        50: { // EXEZNE — Exclusive Economic Zone
            name: 'EXEZNE', description: 'EEZ', type: 'area', priority: 1,
            fill: C.CLEAR, outline: C.CHNAV, outlineWidth: 0.5,
            dash: [10, 5],
            labelAttr: null, labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        54: { // FSHZNE — Fishery zone
            name: 'FSHZNE', description: 'Fishery Zone', type: 'area', priority: 1,
            fill: C.CLEAR, outline: C.CHMGF, outlineWidth: 0.5,
            dash: [8, 4],
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        60: { // FRPARE — Free port area
            name: 'FRPARE', description: 'Free Port Area', type: 'area', priority: 2,
            fill: C.CLEAR, outline: C.CHNAV, outlineWidth: 0.7,
            dash: [6, 3],
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        132: { // STSLNE — Straight territorial sea baseline
            name: 'STSLNE', description: 'Territorial Sea Baseline', type: 'line', priority: 2,
            color: C.CHNAV, lineWidth: 0.7, dash: [10, 5],
            labelAttr: null, labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        135: { // TESARE — Territorial sea area
            name: 'TESARE', description: 'Territorial Sea', type: 'area', priority: 1,
            fill: C.CLEAR, outline: C.CHNAV, outlineWidth: 0.5,
            dash: [10, 5],
            labelAttr: null, labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  SERVICES & SIGNALS
        // ═══════════════════════════════════════════════════════

        29: { // CGUSTA — Coastguard station
            name: 'CGUSTA', description: 'Coastguard Station', type: 'point', priority: 6,
            color: C.CHMGD, pointSize: 7, symbol: 'square',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        28: { // CHKPNT — Checkpoint
            name: 'CHKPNT', description: 'Checkpoint', type: 'point', priority: 5,
            color: C.CHNAV, pointSize: 6, symbol: 'square',
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        33: { // CTRPNT — Control point
            name: 'CTRPNT', description: 'Control Point', type: 'point', priority: 3,
            color: C.CHBLK, pointSize: 5, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        36: { // CURENT — Current
            name: 'CURENT', description: 'Current', type: 'point', priority: 4,
            color: C.CHMGD, pointSize: 6, symbol: 'diamond',
            labelAttr: 'ORIENT', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        44: { // DISMAR — Distance mark
            name: 'DISMAR', description: 'Distance Mark', type: 'point', priority: 4,
            color: C.CHBLK, pointSize: 5, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        111: { // RSCSTA — Rescue station
            name: 'RSCSTA', description: 'Rescue Station', type: 'point', priority: 6,
            color: C.CHRED, pointSize: 7, symbol: 'cross',
            labelAttr: 'OBJNAM', labelColor: C.CHRED, labelSize: 10,
            conditional: null
        },

        123: { // SISTAT — Signal station, traffic
            name: 'SISTAT', description: 'Signal Station, Traffic', type: 'point', priority: 5,
            color: C.CHMGD, pointSize: 6, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        124: { // SISTAW — Signal station, warning
            name: 'SISTAW', description: 'Signal Station, Warning', type: 'point', priority: 5,
            color: C.CHORG, pointSize: 6, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHORG, labelSize: 10,
            conditional: null
        },

        25: { // CTSARE — Cargo transshipment area
            name: 'CTSARE', description: 'Cargo Transshipment Area', type: 'area', priority: 3,
            fill: C.CLEAR, outline: C.CHNAV, outlineWidth: 0.7,
            dash: [5, 3],
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  TIDAL & CURRENT OBJECTS
        // ═══════════════════════════════════════════════════════

        136: { // TS_PRH — Tidal stream, harmonic prediction
            name: 'TS_PRH', description: 'Tidal Stream (Harmonic)', type: 'point', priority: 3,
            color: C.CHMGD, pointSize: 5, symbol: 'diamond',
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        137: { // TS_PNH — Tidal stream, non-harmonic
            name: 'TS_PNH', description: 'Tidal Stream (Non-harmonic)', type: 'point', priority: 3,
            color: C.CHMGD, pointSize: 5, symbol: 'diamond',
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        138: { // TS_PAD — Tidal stream panel data
            name: 'TS_PAD', description: 'Tidal Stream Panel', type: 'point', priority: 3,
            color: C.CHMGD, pointSize: 5, symbol: 'diamond',
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        139: { // TS_TIS — Tidal stream, time series
            name: 'TS_TIS', description: 'Tidal Stream (Time Series)', type: 'point', priority: 3,
            color: C.CHMGD, pointSize: 5, symbol: 'diamond',
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        140: { // T_HMON — Tide, harmonic prediction
            name: 'T_HMON', description: 'Tide (Harmonic)', type: 'point', priority: 3,
            color: C.CHMGD, pointSize: 5, symbol: 'diamond',
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        141: { // T_NHMN — Tide, non-harmonic
            name: 'T_NHMN', description: 'Tide (Non-harmonic)', type: 'point', priority: 3,
            color: C.CHMGD, pointSize: 5, symbol: 'diamond',
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        142: { // T_TIMS — Tide time series
            name: 'T_TIMS', description: 'Tide Time Series', type: 'point', priority: 3,
            color: C.CHMGD, pointSize: 5, symbol: 'diamond',
            labelAttr: null, labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        160: { // TS_FEB — Tidal stream flood/ebb
            name: 'TS_FEB', description: 'Tidal Stream Flood/Ebb', type: 'point', priority: 3,
            color: C.CHMGD, pointSize: 5, symbol: 'diamond',
            labelAttr: 'ORIENT', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  META OBJECTS (M_ classes) — typically invisible
        // ═══════════════════════════════════════════════════════

        300: { // M_ACCY
            name: 'M_ACCY', description: 'Accuracy of Data', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        301: { // M_CSCL
            name: 'M_CSCL', description: 'Compilation Scale', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        302: { // M_COVR
            name: 'M_COVR', description: 'Coverage', type: 'area', priority: 1,
            fill: C.CLEAR, outline: [0.50, 0.50, 0.50, 0.3], outlineWidth: 0.5,
            dash: [10, 5],
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        303: { // M_HDAT
            name: 'M_HDAT', description: 'Horizontal Datum', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        304: { // M_HOPA
            name: 'M_HOPA', description: 'Horizontal Datum Shift', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        305: { // M_NPUB
            name: 'M_NPUB', description: 'Nautical Publication Info', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        306: { // M_NSYS
            name: 'M_NSYS', description: 'Nav System of Marks', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        307: { // M_PROD
            name: 'M_PROD', description: 'Production Information', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        308: { // M_QUAL
            name: 'M_QUAL', description: 'Quality of Data', type: 'area', priority: 1,
            fill: C.CLEAR, outline: [0.50, 0.50, 0.50, 0.15], outlineWidth: 0.5,
            dash: [4, 4],
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        309: { // M_SDAT
            name: 'M_SDAT', description: 'Sounding Datum', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        310: { // M_SREL
            name: 'M_SREL', description: 'Survey Reliability', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        311: { // M_UNIT
            name: 'M_UNIT', description: 'Units of Measurement', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        312: { // M_VDAT
            name: 'M_VDAT', description: 'Vertical Datum', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  COLLECTION OBJECTS (C_ classes)
        // ═══════════════════════════════════════════════════════

        400: { name: 'C_AGGR', description: 'Aggregation', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },
        401: { name: 'C_ASSO', description: 'Association', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },
        402: { name: 'C_STAC', description: 'Stacked on/under', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        // ═══════════════════════════════════════════════════════
        //  CARTOGRAPHIC OBJECTS ($ classes)
        // ═══════════════════════════════════════════════════════

        500: { name: '$AREAS', description: 'Cartographic Area', type: 'area', priority: 1,
            fill: C.CLEAR, outline: C.CHGRD, outlineWidth: 0.5,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },
        501: { name: '$LINES', description: 'Cartographic Line', type: 'line', priority: 1,
            color: C.CHGRD, lineWidth: 0.5, dash: null,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },
        502: { name: '$CSYMB', description: 'Cartographic Symbol', type: 'point', priority: 2,
            color: C.CHBLK, pointSize: 5, symbol: 'circle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },
        503: { name: '$COMPS', description: 'Compass', type: 'point', priority: 2,
            color: C.CHMGD, pointSize: 6, symbol: 'circle',
            labelAttr: 'VALMAG', labelColor: C.CHMGD, labelSize: 10, conditional: null },
        504: { name: '$TEXTS', description: 'Text', type: 'point', priority: 2,
            color: C.CHBLK, pointSize: 3, symbol: 'circle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        // ═══════════════════════════════════════════════════════
        //  REMAINING STANDARD OBJECTS
        // ═══════════════════════════════════════════════════════

        163: { // NEWOBJ — New object
            name: 'NEWOBJ', description: 'New Object', type: 'point', priority: 3,
            color: C.CHMGD, pointSize: 6, symbol: 'diamond',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10,
            conditional: null
        },

        // ═══════════════════════════════════════════════════════
        //  EXTENDED CODES (1000+ series — supplements)
        // ═══════════════════════════════════════════════════════

        1003: { name: 'ACHPNT', description: 'Anchor', type: 'point', priority: 5,
            color: C.CHNAV, pointSize: 7, symbol: 'anchor',
            labelAttr: null, labelColor: C.CHNAV, labelSize: 10, conditional: null },

        1012: { name: 'BUIREL', description: 'Building, Religious', type: 'point', priority: 3,
            color: C.CHBLK, pointSize: 6, symbol: 'square',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        1027: { name: 'CHNWIR', description: 'Chain/Wire', type: 'line', priority: 3,
            color: C.CHGRF, lineWidth: 1.0, dash: [3, 2],
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        1075: { name: '_extgn', description: 'Light, Extinguished', type: 'point', priority: 4,
            color: C.CHGRD, pointSize: 6, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHGRD, labelSize: 10, conditional: null },

        1083: { name: 'MONUMT', description: 'Monument', type: 'point', priority: 3,
            color: C.CHBLK, pointSize: 6, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        1144: { name: 'TOWERS', description: 'Tower', type: 'point', priority: 5,
            color: C.CHBLK, pointSize: 7, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        1159: { name: 'ZEMCNT', description: 'Zero Meter Contour', type: 'line', priority: 4,
            color: C.CSTLN, lineWidth: 1.5, dash: null,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        // ═══════════════════════════════════════════════════════
        //  INLAND ENC (IENC) — 17000+ series
        // ═══════════════════════════════════════════════════════

        17000: { name: 'achbrt', description: 'Anchor Berth (IENC)', type: 'point', priority: 5,
            color: C.CHNAV, pointSize: 7, symbol: 'anchor',
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10, conditional: null },

        17001: { name: 'achare', description: 'Anchorage Area (IENC)', type: 'area', priority: 4,
            fill: C.ANCFL, outline: C.CHNAV, outlineWidth: 1.5, dash: [6, 4],
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 11, conditional: null },

        17002: { name: 'canbnk', description: 'Canal Bank (IENC)', type: 'line', priority: 3,
            color: C.CSTLN, lineWidth: 1.0, dash: null,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17003: { name: 'depare', description: 'Depth Area (IENC)', type: 'area', priority: 1,
            fill: C.DEPIT, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10,
            conditional: function (a) {
                var d = (a && a.DRVAL1 != null) ? Number(a.DRVAL1) : null;
                if (d == null) return null;
                return { fill: getDepthColor(d) };
            }
        },

        17004: { name: 'dismar', description: 'Distance Mark (IENC)', type: 'point', priority: 4,
            color: C.CHBLK, pointSize: 5, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17005: { name: 'resare', description: 'Restricted Area (IENC)', type: 'area', priority: 5,
            fill: C.RESFL, outline: C.CHORG, outlineWidth: 1.5, dash: [6, 4],
            labelAttr: 'OBJNAM', labelColor: C.CHORG, labelSize: 11, conditional: null },

        17006: { name: 'rivbnk', description: 'River Bank (IENC)', type: 'line', priority: 3,
            color: [0.55, 0.45, 0.30, 1.0], lineWidth: 1.0, dash: null,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17007: { name: 'sistat', description: 'Signal Station Traffic (IENC)', type: 'point', priority: 5,
            color: C.CHMGD, pointSize: 6, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10, conditional: null },

        17008: { name: 'sistaw', description: 'Signal Station Warning (IENC)', type: 'point', priority: 5,
            color: C.CHORG, pointSize: 6, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHORG, labelSize: 10, conditional: null },

        17009: { name: 'topmar', description: 'Topmark (IENC)', type: 'point', priority: 6,
            color: C.CHBLK, pointSize: 6, symbol: 'triangle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17010: { name: 'berths', description: 'Berth (IENC)', type: 'area', priority: 5,
            fill: [0.60, 0.10, 0.60, 0.15], outline: C.CHNAV, outlineWidth: 1.5,
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10, conditional: null },

        17011: { name: 'bridge', description: 'Bridge (IENC)', type: 'area', priority: 6,
            fill: [0.75, 0.75, 0.75, 0.5], outline: C.CHGRF, outlineWidth: 2.0,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 11, conditional: null },

        17012: { name: 'cblohd', description: 'Cable Overhead (IENC)', type: 'line', priority: 5,
            color: C.CHGRF, lineWidth: 1.5, dash: [4, 2],
            labelAttr: 'VERCLR', labelColor: C.CHMGD, labelSize: 10, conditional: null },

        17013: { name: 'feryrt', description: 'Ferry Route (IENC)', type: 'line', priority: 5,
            color: C.CHMGD, lineWidth: 1.5, dash: [8, 4],
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10, conditional: null },

        17014: { name: 'hrbare', description: 'Harbour Area (IENC)', type: 'area', priority: 2,
            fill: C.CLEAR, outline: C.CHNAV, outlineWidth: 1.0, dash: [5, 3],
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 12, conditional: null },

        17015: { name: 'hrbfac', description: 'Harbour Facility (IENC)', type: 'point', priority: 5,
            color: C.CHNAV, pointSize: 7, symbol: 'anchor',
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10, conditional: null },

        17016: { name: 'lokbsn', description: 'Lock Basin (IENC)', type: 'area', priority: 3,
            fill: [0.72, 0.86, 0.92, 0.5], outline: C.CHGRF, outlineWidth: 1.5,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17017: { name: 'rdocal', description: 'Radio Calling-in (IENC)', type: 'point', priority: 6,
            color: C.CHMGD, pointSize: 7, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10, conditional: null },

        17018: { name: 'm_nsys', description: 'Nav Marks System (IENC)', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17019: { name: 'curent', description: 'Current (IENC)', type: 'point', priority: 4,
            color: C.CHMGD, pointSize: 6, symbol: 'diamond',
            labelAttr: 'ORIENT', labelColor: C.CHMGD, labelSize: 10, conditional: null },

        17020: { name: 'hulkes', description: 'Hulk (IENC)', type: 'area', priority: 4,
            fill: [0.80, 0.80, 0.80, 0.4], outline: C.CHGRF, outlineWidth: 1.5,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17021: { name: 'ponton', description: 'Pontoon (IENC)', type: 'area', priority: 4,
            fill: [0.75, 0.75, 0.75, 0.7], outline: C.CHGRF, outlineWidth: 1.0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17022: { name: 'm_sdat', description: 'Sounding Datum (IENC)', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17023: { name: 'm_vdat', description: 'Vertical Datum (IENC)', type: 'area', priority: 1,
            fill: C.CLEAR, outline: null, outlineWidth: 0,
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17024: { name: 'pipohd', description: 'Pipeline Overhead (IENC)', type: 'line', priority: 5,
            color: C.CHGRF, lineWidth: 1.5, dash: [4, 2],
            labelAttr: 'VERCLR', labelColor: C.CHMGD, labelSize: 10, conditional: null },

        17025: { name: 'flodoc', description: 'Floating Dock (IENC)', type: 'area', priority: 3,
            fill: [0.75, 0.75, 0.75, 0.5], outline: C.CHGRF, outlineWidth: 1.0,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17027: { name: 'chkpnt', description: 'Checkpoint (IENC)', type: 'point', priority: 5,
            color: C.CHNAV, pointSize: 6, symbol: 'square',
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10, conditional: null },

        17028: { name: 'bcnlat', description: 'Beacon Lateral (IENC)', type: 'point', priority: 7,
            color: C.CHRED, pointSize: 8, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: function (a) {
                if (!a || !a.COLOUR) return null;
                var c = Number(a.COLOUR);
                if (c === 3) return { color: C.CHRED };
                if (c === 4) return { color: C.CHGRN };
                return null;
            }
        },

        17029: { name: 'boylat', description: 'Buoy Lateral (IENC)', type: 'point', priority: 7,
            color: C.CHRED, pointSize: 8, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10,
            conditional: function (a) {
                if (!a || !a.COLOUR) return null;
                var c = Number(a.COLOUR);
                if (c === 3) return { color: C.CHRED, symbol: 'triangle' };
                if (c === 4) return { color: C.CHGRN, symbol: 'square' };
                return null;
            }
        },

        17030: { name: 'cranes', description: 'Crane (IENC)', type: 'point', priority: 4,
            color: C.CHGRF, pointSize: 6, symbol: 'square',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17031: { name: 'gatcon', description: 'Gate (IENC)', type: 'line', priority: 5,
            color: C.CHGRF, lineWidth: 2.0, dash: null,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17032: { name: 'slcons', description: 'Shoreline Construction (IENC)', type: 'line', priority: 5,
            color: C.CHGRF, lineWidth: 2.0, dash: null,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17033: { name: 'uwtroc', description: 'Underwater Rock (IENC)', type: 'point', priority: 8,
            color: C.CHBLK, pointSize: 7, symbol: 'star',
            labelAttr: 'VALSOU', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17034: { name: 'convyr', description: 'Conveyor (IENC)', type: 'line', priority: 3,
            color: C.CHGRD, lineWidth: 1.0, dash: [4, 2],
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17050: { name: 'notmrk', description: 'Notice Mark (IENC)', type: 'point', priority: 6,
            color: C.CHBLK, pointSize: 7, symbol: 'square',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17051: { name: 'wtwaxs', description: 'Waterway Axis (IENC)', type: 'line', priority: 3,
            color: [0.30, 0.55, 0.75, 0.5], lineWidth: 1.0, dash: [8, 4],
            labelAttr: 'OBJNAM', labelColor: [0.30, 0.55, 0.75, 1.0], labelSize: 10,
            conditional: null },

        17052: { name: 'wtwprf', description: 'Waterway Profile (IENC)', type: 'line', priority: 2,
            color: [0.30, 0.55, 0.75, 0.4], lineWidth: 0.7, dash: [4, 3],
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17053: { name: 'brgare', description: 'Bridge Area (IENC)', type: 'area', priority: 6,
            fill: [0.75, 0.75, 0.75, 0.5], outline: C.CHGRF, outlineWidth: 2.0,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 11, conditional: null },

        17054: { name: 'bunsta', description: 'Bunker Station (IENC)', type: 'point', priority: 4,
            color: C.CHBLK, pointSize: 6, symbol: 'square',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17055: { name: 'comare', description: 'Communication Area (IENC)', type: 'area', priority: 3,
            fill: C.CLEAR, outline: C.CHMGF, outlineWidth: 0.7, dash: [5, 3],
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10, conditional: null },

        17056: { name: 'hrbbsn', description: 'Harbour Basin (IENC)', type: 'area', priority: 2,
            fill: [0.72, 0.86, 0.92, 0.3], outline: C.CHNAV, outlineWidth: 1.0,
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10, conditional: null },

        17057: { name: 'lokare', description: 'Lock Area (IENC)', type: 'area', priority: 3,
            fill: [0.72, 0.86, 0.92, 0.4], outline: C.CHGRF, outlineWidth: 1.5,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17058: { name: 'lkbspt', description: 'Lock Basin Part (IENC)', type: 'area', priority: 3,
            fill: [0.72, 0.86, 0.92, 0.4], outline: C.CHGRF, outlineWidth: 1.0,
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17059: { name: 'prtare', description: 'Port Area (IENC)', type: 'area', priority: 2,
            fill: C.CLEAR, outline: C.CHNAV, outlineWidth: 1.0, dash: [5, 3],
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 11, conditional: null },

        17060: { name: 'bcnwtw', description: 'Beacon Waterway (IENC)', type: 'point', priority: 7,
            color: C.CHYLW, pointSize: 7, symbol: 'triangle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17061: { name: 'boywtw', description: 'Buoy Waterway (IENC)', type: 'point', priority: 7,
            color: C.CHYLW, pointSize: 7, symbol: 'diamond',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17062: { name: 'refdmp', description: 'Refuse Dump (IENC)', type: 'point', priority: 3,
            color: C.CHGRF, pointSize: 5, symbol: 'circle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17063: { name: 'rtplpt', description: 'Route Planning Point (IENC)', type: 'point', priority: 4,
            color: C.CHMGD, pointSize: 6, symbol: 'diamond',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10, conditional: null },

        17064: { name: 'termnl', description: 'Terminal (IENC)', type: 'point', priority: 5,
            color: C.CHNAV, pointSize: 7, symbol: 'square',
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10, conditional: null },

        17065: { name: 'trnbsn', description: 'Turning Basin (IENC)', type: 'area', priority: 3,
            fill: [0.72, 0.86, 0.92, 0.3], outline: C.CHNAV, outlineWidth: 1.0,
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10, conditional: null },

        17066: { name: 'wtware', description: 'Waterway Area (IENC)', type: 'area', priority: 2,
            fill: [0.65, 0.82, 0.88, 0.3], outline: null, outlineWidth: 0,
            labelAttr: 'OBJNAM', labelColor: [0.30, 0.50, 0.65, 1.0], labelSize: 11,
            conditional: null },

        17067: { name: 'wtwgag', description: 'Waterway Gauge (IENC)', type: 'point', priority: 5,
            color: C.CHMGD, pointSize: 6, symbol: 'diamond',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10, conditional: null },

        17068: { name: 'tisdge', description: 'Time Schedule (IENC)', type: 'point', priority: 2,
            color: C.CHGRD, pointSize: 4, symbol: 'circle',
            labelAttr: null, labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17069: { name: 'vehtrf', description: 'Vehicle Transfer (IENC)', type: 'point', priority: 4,
            color: C.CHBLK, pointSize: 6, symbol: 'square',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        17070: { name: 'excnst', description: 'Exceptional Nav Structure (IENC)', type: 'point', priority: 5,
            color: C.CHMGD, pointSize: 7, symbol: 'diamond',
            labelAttr: 'OBJNAM', labelColor: C.CHMGD, labelSize: 10, conditional: null },

        // ═══════════════════════════════════════════════════════
        //  EXTENDED CODES (18000+ and 22000+)
        // ═══════════════════════════════════════════════════════

        18001: { name: 'lg_sdm', description: 'Max Ship Dimensions', type: 'area', priority: 2,
            fill: C.CLEAR, outline: C.CHORG, outlineWidth: 0.7, dash: [4, 3],
            labelAttr: null, labelColor: C.CHORG, labelSize: 10, conditional: null },

        18002: { name: 'lg_vsp', description: 'Max Vessel Speed', type: 'area', priority: 2,
            fill: C.CLEAR, outline: C.CHORG, outlineWidth: 0.7, dash: [4, 3],
            labelAttr: null, labelColor: C.CHORG, labelSize: 10, conditional: null },

        22001: { name: 'ANNOTA', description: 'Annotation', type: 'point', priority: 2,
            color: C.CHBLK, pointSize: 3, symbol: 'circle',
            labelAttr: 'OBJNAM', labelColor: C.CHBLK, labelSize: 10, conditional: null },

        22009: { name: 'RESTRC', description: 'Generic Boundary', type: 'line', priority: 3,
            color: C.CHNAV, lineWidth: 1.0, dash: [6, 3],
            labelAttr: 'OBJNAM', labelColor: C.CHNAV, labelSize: 10, conditional: null },
    };

    // ────────────────────────────────────────────────────────────
    //  Default style for unknown/unmapped class codes
    // ────────────────────────────────────────────────────────────
    var DEFAULT_STYLE = {
        name: 'UNKNOWN',
        description: 'Unknown Object Class',
        type: 'area',
        priority: 1,
        fill: [0.50, 0.65, 0.85, 0.6],
        outline: [0.50, 0.50, 0.50, 0.5],
        outlineWidth: 0.5,
        color: [0.50, 0.50, 0.50, 0.8],
        lineWidth: 1.0,
        dash: null,
        pointSize: 5,
        symbol: 'circle',
        labelAttr: null,
        labelColor: [0.0, 0.0, 0.0, 1.0],
        labelSize: 10,
        conditional: null
    };

    // ────────────────────────────────────────────────────────────
    //  Reverse lookup: acronym → code
    // ────────────────────────────────────────────────────────────
    var _acronymToCode = {};
    var codes = Object.keys(S52_STYLES);
    for (var i = 0; i < codes.length; i++) {
        var code = codes[i];
        _acronymToCode[S52_STYLES[code].name] = Number(code);
    }

    // ────────────────────────────────────────────────────────────
    //  Public API
    // ────────────────────────────────────────────────────────────

    /**
     * Returns the full style object for a given S-57 class code.
     * If the code is unknown, returns DEFAULT_STYLE.
     *
     * @param {number|string} classCode  S-57 OBJL integer code
     * @param {Object} [attributes]      Optional feature attributes for
     *                                   conditional styling resolution
     * @returns {Object} Style object (may include overrides from conditional)
     */
    function getStyle(classCode, attributes) {
        var base = S52_STYLES[classCode] || DEFAULT_STYLE;
        if (base.conditional && attributes) {
            var overrides = base.conditional(attributes);
            if (overrides) {
                var merged = {};
                var keys = Object.keys(base);
                for (var i = 0; i < keys.length; i++) {
                    merged[keys[i]] = base[keys[i]];
                }
                var okeys = Object.keys(overrides);
                for (var j = 0; j < okeys.length; j++) {
                    merged[okeys[j]] = overrides[okeys[j]];
                }
                return merged;
            }
        }
        return base;
    }

    /**
     * Returns label configuration for a class code.
     *
     * @param {number|string} classCode  S-57 OBJL integer code
     * @returns {{ attr: string|null, color: number[], size: number }}
     */
    function getLabelConfig(classCode) {
        var s = S52_STYLES[classCode] || DEFAULT_STYLE;
        return {
            attr: s.labelAttr || null,
            color: s.labelColor || C.CHBLK,
            size: s.labelSize || 10
        };
    }

    /**
     * Returns the S-57 class code for a given acronym (e.g. 'DEPARE' → 42).
     *
     * @param {string} acronym  S-57 object class acronym
     * @returns {number|undefined}
     */
    function getCodeByAcronym(acronym) {
        return _acronymToCode[acronym];
    }

    // ────────────────────────────────────────────────────────────
    //  Export to window globals
    // ────────────────────────────────────────────────────────────
    window.S52_STYLES = S52_STYLES;
    window.S52_DEFAULT_STYLE = DEFAULT_STYLE;
    window.S52_COLORS = C;
    window.getS52Style = getStyle;
    window.getDepthColor = getDepthColor;
    window.getLabelConfig = getLabelConfig;
    window.getCodeByAcronym = getCodeByAcronym;

})();
