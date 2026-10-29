# Nucleo do Mamulengo: biblioteca de pose (sem E/S) e as ferramentas de teste nucleo-pose e nucleo-estado.
cmake_minimum_required(VERSION 3.16)
project(mamulengo_nucleo CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# a biblioteca: so contas, sem arquivo nem console (vira wasm e modulo do Godot)
add_library(mamulengo_nucleo STATIC
  src/json.cpp
  src/leitor.cpp
  src/curva.cpp
  src/pose.cpp
  src/restricoes.cpp
  src/estado.cpp
  src/desenho.cpp
)
target_include_directories(mamulengo_nucleo PUBLIC include)
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(mamulengo_nucleo PRIVATE -Wall -Wextra -Wno-unused-parameter)
endif()

# a ferramenta de teste (le o arquivo, escreve o JSON do contrato)
add_executable(nucleo-pose ferramentas/nucleo-pose.cpp)
target_link_libraries(nucleo-pose PRIVATE mamulengo_nucleo)
add_executable(nucleo-estado ferramentas/nucleo-estado.cpp)
target_link_libraries(nucleo-estado PRIVATE mamulengo_nucleo)

# o nucleo no navegador (so com emscripten): build-web/nucleo.mjs + nucleo.wasm
#   emcmake cmake -S nucleo -B nucleo/build-web -G Ninja && cmake --build nucleo/build-web
if(EMSCRIPTEN)
  add_executable(nucleo web/nucleo_web.cpp)
  target_link_libraries(nucleo PRIVATE mamulengo_nucleo)
  set_target_properties(nucleo PROPERTIES SUFFIX ".mjs")
  target_link_options(nucleo PRIVATE
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,node -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=0
    "-sEXPORTED_RUNTIME_METHODS=['HEAPF32','HEAPF64','HEAPU32','HEAP32','HEAPU8','UTF8ToString','stringToNewUTF8']"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']")
endif()
