CXX = emcc

LAMMPS_SOURCE := $(wildcard lammps/src/*.cpp)
LAMMPS_SOURCE := $(filter-out lammps/src/main.cpp, $(LAMMPS_SOURCE))
LAMMPS_SOURCE += lammps/src/STUBS/mpi.cpp
LAMMPS_OBJ_FILES := $(addprefix obj/,$(notdir $(LAMMPS_SOURCE:.cpp=.o)))

#LD_FLAGS := -O1 --pre-js locateFile.js --no-entry -gsource-map --source-map-base="http://localhost:3000/atomify/" -lembind
#CC_FLAGS := -O0 -DLAMMPS_EXCEPTIONS -DLAMMPS_SMALLSMALL -gsource-map # -DNDEBUG
OUT_DIR ?= .
LOCATE_FILE ?= locateFile.js

LD_FLAGS := -Oz --pre-js $(LOCATE_FILE) --no-entry -lembind
CC_FLAGS := -Oz -DLAMMPS_EXCEPTIONS -s NO_DISABLE_EXCEPTION_CATCHING=1 -DCOLVARS_LAMMPS
INCLUDE_FLAGS := -Ilammps/src -Ilammps/src/STUBS
SYMBOLS := \
  -s ENVIRONMENT='web,worker,node' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s ASYNCIFY \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME='createModule' \
  -s EXPORTED_RUNTIME_METHODS="['getValue','FS', 'HEAPF32', 'HEAP32', 'HEAPF64', 'HEAP64']" \
  -s FORCE_FILESYSTEM=1 \
  -s SINGLE_FILE=1 \
  -s ASSERTIONS=2 \
  -s INITIAL_MEMORY=2048MB \
  -s TOTAL_STACK=1024MB \
  -s SINGLE_FILE=1 \
  -s DISABLE_EXCEPTION_CATCHING=0 \

OUTPUT := $(OUT_DIR)/lammps.js

default: wasm
wasm: obj $(OUTPUT)

$(OUTPUT): $(LAMMPS_OBJ_FILES)
	mkdir -p $(OUT_DIR)
	$(CXX) $(SYMBOLS) $(LD_FLAGS) -o $@ $^
	
obj:
	mkdir -p obj

obj/%.o: lammps/src/%.cpp
	$(CXX) $(CC_FLAGS) $(INCLUDE_FLAGS) -c -o $@ $<

obj/%.o: lammps/src/STUBS/%.cpp
	$(CXX) $(CC_FLAGS) $(INCLUDE_FLAGS) -c -o $@ $<

clean:
	rm -f $(OUTPUT); rm obj/*
