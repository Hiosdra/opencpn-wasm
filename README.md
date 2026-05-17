# OpenCPN WASM

**OpenCPN maritime navigation app ported to WebAssembly — runs entirely in the browser.**

🌐 **Live demo:** [hiosdra.github.io/opencpn-wasm](https://hiosdra.github.io/opencpn-wasm/)

## Attribution

This project is based on [OpenCPN](https://github.com/OpenCPN/OpenCPN), an open-source chart plotter and marine GPS navigation software.

Original project copyright belongs to OpenCPN contributors.

This fork/modification is distributed under the **GNU General Public License v2** (or later), consistent with the original project license. See [LICENSE](LICENSE) for the full text.

## Changes from upstream

- **WebAssembly build** — S-57 chart engine compiled to WASM via Emscripten (143KB)
- **Browser-native frontend** — replaced wxWidgets GUI with HTML5 Canvas + vanilla JS
- **Pure JS KAP/BSB parser** — raster chart support without C++ dependencies
- **S-52 symbology engine** — 248 style entries for all 129 S-57 object classes, 38 procedural nautical symbols
- **Web API I/O layer** — file input, drag & drop, IndexedDB storage (replacing filesystem access)
- **PWA offline support** — Service Worker with cache-first strategy, installable as app
- **Full navigation suite** — AIS display, active route following, safety features, tides, GRIB weather, logbook
- **No server required** — static files, hostable on GitHub Pages or any CDN

## Features

| Module | Description |
|--------|-------------|
| S-57 Engine | C++/WASM chart parser with 20+ attributes |
| KAP Parser | BSB raster charts with Mercator georeferencing |
| S-52 Styles | Depth-dependent coloring, day/dusk/night schemes |
| Symbol Renderer | Buoys, beacons, lights, wrecks, rocks, nav aids |
| AIS Display | Target rendering, CPA/TCPA alerts, target list |
| Active Navigation | Route following, XTE/CDI, track recording |
| Safety | Anchor watch, MOB, EBL, VRM, guard zones |
| Connections | WebSocket NMEA, SignalK, NMEA replay |
| Tides & GRIB | Tide predictions, weather overlay |
| Logbook | Voyage entries with CSV/HTML export |

## Usage

1. Open [hiosdra.github.io/opencpn-wasm](https://hiosdra.github.io/opencpn-wasm/)
2. Click 📂 **File** to load S-57 (`.000`) or KAP (`.kap`) chart files
3. Or drag & drop chart files onto the map area

## Building from source

```bash
# Prerequisites: Emscripten SDK
source emsdk/emsdk_env.sh

# Build WASM module
cd wasm-poc/build
emcmake cmake ..
emmake make -j$(nproc)

# Serve locally
cd ../web
node server.js
# Open http://localhost:8080
```

## Source code

Full source code is available at: https://github.com/Hiosdra/opencpn-wasm

## License

GNU General Public License v2 (or later). See [LICENSE](LICENSE).
