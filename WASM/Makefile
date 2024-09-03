# Define variables for directories and files
SRC_DIR := ../C
TARGET := rpn_function.js

# Source files
SOURCES := ConstantRecognition_function2_for_WASM.c \
           $(SRC_DIR)/constant.c \
           $(SRC_DIR)/mathematica.c \
           $(SRC_DIR)/math2.c \
           #$(SRC_DIR)/itoa.c 

# Compiler and flags
EMCC := emcc
CFLAGS := -Wall -O2
EMFLAGS := -s WASM=1 \
           -s EXPORTED_FUNCTIONS='["_search_RPN", "_free"]' \
           -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]'

# Default target
all: $(TARGET)

# Rule to compile the source files
$(TARGET): $(SOURCES)
	$(EMCC) $(CFLAGS) $(SOURCES) $(EMFLAGS) -o $@

# Clean up
clean:
	rm -f $(TARGET) $(TARGET:.js=.wasm)
