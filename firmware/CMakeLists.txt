
cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(wm1110-asset-tracker)

FILE(GLOB app_sources
    src/*.c
    src/uplink/*.c
    src/peripherals/*.c
)

target_sources(app PRIVATE ${app_sources})

zephyr_include_directories(
    include
)