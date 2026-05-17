cmake_minimum_required(VERSION 3.13)
project(opencpn-wasm-poc LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Mini-GDAL (CPL + OGR core) ─────────────────────────
file(GLOB GDAL_SRC "${CMAKE_CURRENT_SOURCE_DIR}/src/gdal/*.cpp")
add_library(gdal_mini STATIC ${GDAL_SRC})
target_include_directories(gdal_mini PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/include/gdal
)
target_compile_definitions(gdal_mini PRIVATE
    CPL_DISABLE_DLL=1
)

# ── ISO 8211 ────────────────────────────────────────────
file(GLOB ISO8211_SRC "${CMAKE_CURRENT_SOURCE_DIR}/src/iso8211/*.cpp")
add_library(iso8211 STATIC ${ISO8211_SRC})
target_include_directories(iso8211 PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include/iso8211
)
target_link_libraries(iso8211 PRIVATE gdal_mini)

# ── S-57 Charts ─────────────────────────────────────────
file(GLOB S57_SRC "${CMAKE_CURRENT_SOURCE_DIR}/src/s57/*.cpp")
add_library(s57_charts STATIC ${S57_SRC})
target_include_directories(s57_charts PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include/s57
)
target_link_libraries(s57_charts PRIVATE gdal_mini iso8211)

# ── Chart Bridge (WASM entry point) ─────────────────────
add_executable(opencpn_chart
    ${CMAKE_CURRENT_SOURCE_DIR}/src/chart_bridge.cpp
)
target_include_directories(opencpn_chart PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/include/s57
    ${CMAKE_CURRENT_SOURCE_DIR}/include/iso8211
)
target_link_libraries(opencpn_chart PRIVATE s57_charts iso8211 gdal_mini)

# ── Emscripten-specific settings ────────────────────────
if(EMSCRIPTEN)
    set_target_properties(opencpn_chart PROPERTIES
        SUFFIX ".js"
    )
    target_link_options(opencpn_chart PRIVATE
        --bind
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=67108864
        -sMAXIMUM_MEMORY=536870912
        -sMODULARIZE=1
        -sEXPORT_NAME=OpenCPNChart
        -sEXPORT_ES6=0
        -sENVIRONMENT=web
        -sNO_EXIT_RUNTIME=1
        "-sEXPORTED_RUNTIME_METHODS=['FS']"
        -sASSERTIONS=1
        -sFORCE_FILESYSTEM=1
        -O2
    )
endif()
