/**
 * chart_bridge.cpp — Embind bridge between S-57 parser and JavaScript.
 *
 * Parses an S-57 .000 file and exports geometry as flat arrays
 * for efficient transfer to the JS/WebGL renderer.
 */

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "gdal/cpl_conv.h"
#include "gdal/cpl_string.h"
#include "gdal/ogr_api.h"
#include "gdal/ogr_geometry.h"
#include "gdal/ogr_feature.h"
#include "s57.h"
#include "ogr_s57.h"
#include "s57class_registrar.h"
#include "s57registrar_mgr.h"

using namespace emscripten;

// Defined in s57classregistrar.cpp
extern S57ClassRegistrar* g_poRegistrar;

// Key S-57 attribute names we extract for rendering/display
static const char* ATTR_KEYS[] = {
    "OBJNAM", "DRVAL1", "DRVAL2", "VALDCO", "VALSOU",
    "LITCHR", "SIGPER", "SIGGRP", "COLOUR", "COLPAT",
    "BOYSHP", "BCNSHP", "CATLIT", "CATCAM", "CATLAM",
    "ORIENT", "SECTR1", "SECTR2", "HEIGHT", "INFORM",
    "NATSUR", "WATLEV", "CATOBS", "CATSLC", "CONDTN",
    "STATUS", "EXCLIT", "MARSYS", "TOPSHP", "CATBRG",
    nullptr
};

struct FeatureAttrs {
    std::string objnam;
    double drval1 = -999;
    double drval2 = -999;
    double valsou = -999;
    double orient = -999;
    double sectr1 = -999;
    double sectr2 = -999;
    double height = -999;
    double sigper = -999;
    int colour = -1;
    int boyshp = -1;
    int bcnshp = -1;
    int catlit = -1;
    int catcam = -1;
    int catlam = -1;
    int litchr = -1;
    int topshp = -1;
    int watlev = -1;
    int catobs = -1;
    int marsys = -1;
};

static FeatureAttrs extractAttrs(OGRFeature* feat) {
    FeatureAttrs a;
    int idx;
    idx = feat->GetFieldIndex("OBJNAM");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.objnam = feat->GetFieldAsString(idx);
    idx = feat->GetFieldIndex("DRVAL1");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.drval1 = feat->GetFieldAsDouble(idx);
    idx = feat->GetFieldIndex("DRVAL2");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.drval2 = feat->GetFieldAsDouble(idx);
    idx = feat->GetFieldIndex("VALSOU");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.valsou = feat->GetFieldAsDouble(idx);
    idx = feat->GetFieldIndex("ORIENT");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.orient = feat->GetFieldAsDouble(idx);
    idx = feat->GetFieldIndex("SECTR1");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.sectr1 = feat->GetFieldAsDouble(idx);
    idx = feat->GetFieldIndex("SECTR2");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.sectr2 = feat->GetFieldAsDouble(idx);
    idx = feat->GetFieldIndex("HEIGHT");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.height = feat->GetFieldAsDouble(idx);
    idx = feat->GetFieldIndex("SIGPER");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.sigper = feat->GetFieldAsDouble(idx);
    idx = feat->GetFieldIndex("COLOUR");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.colour = feat->GetFieldAsInteger(idx);
    idx = feat->GetFieldIndex("BOYSHP");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.boyshp = feat->GetFieldAsInteger(idx);
    idx = feat->GetFieldIndex("BCNSHP");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.bcnshp = feat->GetFieldAsInteger(idx);
    idx = feat->GetFieldIndex("CATLIT");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.catlit = feat->GetFieldAsInteger(idx);
    idx = feat->GetFieldIndex("CATCAM");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.catcam = feat->GetFieldAsInteger(idx);
    idx = feat->GetFieldIndex("CATLAM");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.catlam = feat->GetFieldAsInteger(idx);
    idx = feat->GetFieldIndex("LITCHR");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.litchr = feat->GetFieldAsInteger(idx);
    idx = feat->GetFieldIndex("TOPSHP");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.topshp = feat->GetFieldAsInteger(idx);
    idx = feat->GetFieldIndex("WATLEV");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.watlev = feat->GetFieldAsInteger(idx);
    idx = feat->GetFieldIndex("CATOBS");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.catobs = feat->GetFieldAsInteger(idx);
    idx = feat->GetFieldIndex("MARSYS");
    if (idx >= 0 && feat->IsFieldSet(idx)) a.marsys = feat->GetFieldAsInteger(idx);
    return a;
}

struct FeatureBuffers {
    // Polygon features
    std::vector<double> polyCoords;      // x,y pairs (lon,lat)
    std::vector<int32_t> polyRingCounts; // rings per feature
    std::vector<int32_t> polyRingSizes;  // points per ring
    std::vector<int32_t> polyCodes;      // OBJL class code per feature
    std::vector<double> polyDrval1;      // DRVAL1 per polygon (depth areas)
    std::vector<double> polyDrval2;      // DRVAL2 per polygon
    std::vector<std::string> polyNames;  // OBJNAM per polygon

    // Line features
    std::vector<double> lineCoords;
    std::vector<int32_t> lineSizes;  // points per linestring
    std::vector<int32_t> lineCodes;
    std::vector<double> lineValdco;     // VALDCO per line (depth contour value)
    std::vector<std::string> lineNames;

    // Point features
    std::vector<double> pointCoords; // x,y pairs
    std::vector<double> pointDepths; // depth values for SOUNDG
    std::vector<int32_t> pointCodes;
    std::vector<std::string> pointNames;
    // Point attribute arrays (per point)
    std::vector<int32_t> pointColour;
    std::vector<int32_t> pointBoyshp;
    std::vector<int32_t> pointBcnshp;
    std::vector<int32_t> pointCatlit;
    std::vector<int32_t> pointCatcam;
    std::vector<int32_t> pointCatlam;
    std::vector<int32_t> pointLitchr;
    std::vector<int32_t> pointTopshp;
    std::vector<double> pointOrient;
    std::vector<double> pointSectr1;
    std::vector<double> pointSectr2;
    std::vector<double> pointHeight;
    std::vector<double> pointSigper;

    // Extent
    double minLon, maxLon, minLat, maxLat;
    int scale;
};

static void extractPolygon(OGRPolygon* poly, FeatureBuffers& buf) {
    int ringCount = 0;
    OGRLinearRing* ext = poly->getExteriorRing();
    if (ext) {
        int n = ext->getNumPoints();
        buf.polyRingSizes.push_back(n);
        for (int i = 0; i < n; i++) {
            buf.polyCoords.push_back(ext->getX(i));
            buf.polyCoords.push_back(ext->getY(i));
        }
        ringCount++;
    }
    for (int r = 0; r < poly->getNumInteriorRings(); r++) {
        OGRLinearRing* ring = poly->getInteriorRing(r);
        int n = ring->getNumPoints();
        buf.polyRingSizes.push_back(n);
        for (int i = 0; i < n; i++) {
            buf.polyCoords.push_back(ring->getX(i));
            buf.polyCoords.push_back(ring->getY(i));
        }
        ringCount++;
    }
    buf.polyRingCounts.push_back(ringCount);
}

static void extractLineString(OGRLineString* ls, FeatureBuffers& buf) {
    int n = ls->getNumPoints();
    buf.lineSizes.push_back(n);
    for (int i = 0; i < n; i++) {
        buf.lineCoords.push_back(ls->getX(i));
        buf.lineCoords.push_back(ls->getY(i));
    }
}

static int getOBJL(OGRFeature* feat) {
    int idx = feat->GetFieldIndex("OBJL");
    if (idx >= 0) return feat->GetFieldAsInteger(idx);
    return -1;
}

val parseChart(std::string filePath, std::string csvDir) {
    // Initialize registrar if needed
    if (!g_poRegistrar) {
        g_poRegistrar = new S57ClassRegistrar();
        if (!g_poRegistrar->LoadInfo(csvDir.c_str(), 0)) {
            return val::object();
        }
    }

    S57Reader reader(filePath.c_str());
    reader.SetClassBased(g_poRegistrar);

    char* opts[] = {
        (char*)"RETURN_PRIMITIVES=ON",
        (char*)"RETURN_LINKAGES=ON",
        (char*)"LNAM_REFS=ON",
        nullptr
    };
    reader.SetOptions(opts);

    if (!reader.Open(0)) {
        return val::object();
    }

    if (reader.Ingest() != 0) {
        return val::object();
    }

    FeatureBuffers buf;
    OGREnvelope env;
    if (reader.GetExtent(&env, 1) == OGRERR_NONE) {
        buf.minLon = env.MinX;
        buf.maxLon = env.MaxX;
        buf.minLat = env.MinY;
        buf.maxLat = env.MaxY;
    }
    buf.scale = reader.GetCSCL();

    reader.Rewind();
    OGRFeature* feat;
    while ((feat = reader.ReadNextFeature()) != nullptr) {
        OGRGeometry* geom = feat->GetGeometryRef();
        int objl = getOBJL(feat);

        if (geom && objl >= 0) {
            FeatureAttrs attrs = extractAttrs(feat);
            OGRwkbGeometryType gtype = geom->getGeometryType();

            switch (gtype) {
            case wkbPoint: {
                OGRPoint* pt = (OGRPoint*)geom;
                buf.pointCoords.push_back(pt->getX());
                buf.pointCoords.push_back(pt->getY());
                buf.pointDepths.push_back(pt->getZ());
                buf.pointCodes.push_back(objl);
                buf.pointNames.push_back(attrs.objnam);
                buf.pointColour.push_back(attrs.colour);
                buf.pointBoyshp.push_back(attrs.boyshp);
                buf.pointBcnshp.push_back(attrs.bcnshp);
                buf.pointCatlit.push_back(attrs.catlit);
                buf.pointCatcam.push_back(attrs.catcam);
                buf.pointCatlam.push_back(attrs.catlam);
                buf.pointLitchr.push_back(attrs.litchr);
                buf.pointTopshp.push_back(attrs.topshp);
                buf.pointOrient.push_back(attrs.orient);
                buf.pointSectr1.push_back(attrs.sectr1);
                buf.pointSectr2.push_back(attrs.sectr2);
                buf.pointHeight.push_back(attrs.height);
                buf.pointSigper.push_back(attrs.sigper);
                break;
            }
            case wkbMultiPoint:
            case wkbMultiPoint25D: {
                OGRMultiPoint* mp = (OGRMultiPoint*)geom;
                for (int i = 0; i < mp->getNumGeometries(); i++) {
                    OGRPoint* pt = (OGRPoint*)mp->getGeometryRef(i);
                    buf.pointCoords.push_back(pt->getX());
                    buf.pointCoords.push_back(pt->getY());
                    buf.pointDepths.push_back(pt->getZ());
                    buf.pointCodes.push_back(objl);
                    buf.pointNames.push_back(attrs.objnam);
                    buf.pointColour.push_back(attrs.colour);
                    buf.pointBoyshp.push_back(attrs.boyshp);
                    buf.pointBcnshp.push_back(attrs.bcnshp);
                    buf.pointCatlit.push_back(attrs.catlit);
                    buf.pointCatcam.push_back(attrs.catcam);
                    buf.pointCatlam.push_back(attrs.catlam);
                    buf.pointLitchr.push_back(attrs.litchr);
                    buf.pointTopshp.push_back(attrs.topshp);
                    buf.pointOrient.push_back(attrs.orient);
                    buf.pointSectr1.push_back(attrs.sectr1);
                    buf.pointSectr2.push_back(attrs.sectr2);
                    buf.pointHeight.push_back(attrs.height);
                    buf.pointSigper.push_back(attrs.sigper);
                }
                break;
            }
            case wkbLineString:
            case wkbLineString25D:
                extractLineString((OGRLineString*)geom, buf);
                buf.lineCodes.push_back(objl);
                buf.lineNames.push_back(attrs.objnam);
                buf.lineValdco.push_back(attrs.drval1 > -900 ? attrs.drval1 : (attrs.valsou > -900 ? attrs.valsou : -999));
                break;

            case wkbMultiLineString: {
                OGRMultiLineString* mls = (OGRMultiLineString*)geom;
                for (int i = 0; i < mls->getNumGeometries(); i++) {
                    extractLineString((OGRLineString*)mls->getGeometryRef(i), buf);
                    buf.lineCodes.push_back(objl);
                    buf.lineNames.push_back(attrs.objnam);
                    buf.lineValdco.push_back(attrs.drval1 > -900 ? attrs.drval1 : -999);
                }
                break;
            }
            case wkbPolygon:
            case wkbPolygon25D:
                extractPolygon((OGRPolygon*)geom, buf);
                buf.polyCodes.push_back(objl);
                buf.polyDrval1.push_back(attrs.drval1);
                buf.polyDrval2.push_back(attrs.drval2);
                buf.polyNames.push_back(attrs.objnam);
                break;

            case wkbMultiPolygon: {
                OGRMultiPolygon* mpoly = (OGRMultiPolygon*)geom;
                for (int i = 0; i < mpoly->getNumGeometries(); i++) {
                    extractPolygon((OGRPolygon*)mpoly->getGeometryRef(i), buf);
                    buf.polyCodes.push_back(objl);
                    buf.polyDrval1.push_back(attrs.drval1);
                    buf.polyDrval2.push_back(attrs.drval2);
                    buf.polyNames.push_back(attrs.objnam);
                }
                break;
            }
            default:
                break;
            }
        }
        delete feat;
    }

    reader.Close();

    // Build result object with typed arrays
    val result = val::object();
    result.set("scale", buf.scale);

    val extent = val::object();
    extent.set("minLon", buf.minLon);
    extent.set("maxLon", buf.maxLon);
    extent.set("minLat", buf.minLat);
    extent.set("maxLat", buf.maxLat);
    result.set("extent", extent);

    // Helper: copy C++ vector to JS typed array
    auto toFloat64Array = [](const std::vector<double>& v) -> val {
        if (v.empty()) return val::global("Float64Array").new_(0);
        val mem = val(typed_memory_view(v.size(), v.data()));
        return val::global("Float64Array").new_(mem);
    };
    auto toInt32Array = [](const std::vector<int32_t>& v) -> val {
        if (v.empty()) return val::global("Int32Array").new_(0);
        val mem = val(typed_memory_view(v.size(), v.data()));
        return val::global("Int32Array").new_(mem);
    };
    auto toStringArray = [](const std::vector<std::string>& v) -> val {
        val arr = val::array();
        for (size_t i = 0; i < v.size(); i++) {
            arr.call<void>("push", v[i]);
        }
        return arr;
    };

    val polygons = val::object();
    polygons.set("coords", toFloat64Array(buf.polyCoords));
    polygons.set("ringCounts", toInt32Array(buf.polyRingCounts));
    polygons.set("ringSizes", toInt32Array(buf.polyRingSizes));
    polygons.set("classCodes", toInt32Array(buf.polyCodes));
    polygons.set("drval1", toFloat64Array(buf.polyDrval1));
    polygons.set("drval2", toFloat64Array(buf.polyDrval2));
    polygons.set("names", toStringArray(buf.polyNames));
    result.set("polygons", polygons);

    val lines = val::object();
    lines.set("coords", toFloat64Array(buf.lineCoords));
    lines.set("lineSizes", toInt32Array(buf.lineSizes));
    lines.set("classCodes", toInt32Array(buf.lineCodes));
    lines.set("valdco", toFloat64Array(buf.lineValdco));
    lines.set("names", toStringArray(buf.lineNames));
    result.set("lines", lines);

    val points = val::object();
    points.set("coords", toFloat64Array(buf.pointCoords));
    points.set("depths", toFloat64Array(buf.pointDepths));
    points.set("classCodes", toInt32Array(buf.pointCodes));
    points.set("names", toStringArray(buf.pointNames));
    points.set("colour", toInt32Array(buf.pointColour));
    points.set("boyshp", toInt32Array(buf.pointBoyshp));
    points.set("bcnshp", toInt32Array(buf.pointBcnshp));
    points.set("catlit", toInt32Array(buf.pointCatlit));
    points.set("catcam", toInt32Array(buf.pointCatcam));
    points.set("catlam", toInt32Array(buf.pointCatlam));
    points.set("litchr", toInt32Array(buf.pointLitchr));
    points.set("topshp", toInt32Array(buf.pointTopshp));
    points.set("orient", toFloat64Array(buf.pointOrient));
    points.set("sectr1", toFloat64Array(buf.pointSectr1));
    points.set("sectr2", toFloat64Array(buf.pointSectr2));
    points.set("height", toFloat64Array(buf.pointHeight));
    points.set("sigper", toFloat64Array(buf.pointSigper));
    result.set("points", points);

    val stats = val::object();
    stats.set("polygonCount", (int)buf.polyCodes.size());
    stats.set("lineCount", (int)buf.lineCodes.size());
    stats.set("pointCount", (int)buf.pointCodes.size());
    result.set("stats", stats);

    return result;
}

EMSCRIPTEN_BINDINGS(chart_module) {
    function("parseChart", &parseChart);
}
