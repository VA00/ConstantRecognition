CC=icx
CFLAGS=-Wall
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
