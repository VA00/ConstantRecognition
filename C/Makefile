# Default compiler
CC=gcc

# Conditional flags based on the compiler
ifeq ($(CC),icx)
    # For ICX: Include specific flags needed to prevent NaN's with complex.h
    CFLAGS=-Wall -O0 -ipo
else
    # For GCC: Standard setup with math library linking
    CFLAGS=-Wall -lm
endif


DEPS = constant.c itoa.c mathematica.c math2.c utils.c
SRC = ConstantRecognition_batch.c
OBJ_REAL = RealConstantRecognition_batch.o $(DEPS:.c=.o)
OBJ_CPLX = ComplexConstantRecognition_batch.o $(DEPS:.c=.o)

all: RealConstantRecognition ComplexConstantRecognition

RealConstantRecognition_batch.o: $(SRC) $(DEPS)
	$(CC) -c -o $@ $(SRC) $(CFLAGS)

ComplexConstantRecognition_batch.o: $(SRC) $(DEPS)
	$(CC) -c -o $@ $(SRC) $(CFLAGS) -DUSE_COMPLEX

RealConstantRecognition: $(OBJ_REAL)
	$(CC) -o $@ $^ $(CFLAGS)

ComplexConstantRecognition: $(OBJ_CPLX)
	$(CC) -o $@ $^ $(CFLAGS)

.PHONY: clean all

clean:
	rm -f $(OBJ_REAL) $(OBJ_CPLX) RealConstantRecognition ComplexConstantRecognition found.txt
