CC=icx
CFLAGS=-Wall
DEPS = constant.c itoa.c mathematica.c math2.c
OBJ_REAL = RealConstantRecognition_batch.o $(DEPS:.c=.o)
OBJ_CPLX = ComplexConstantRecognition_batch.o $(DEPS:.c=.o)

all: RealConstantRecognition ComplexConstantRecognition

%.o: %.c $(DEPS)
	$(CC) -c -o $@ $< $(CFLAGS)

RealConstantRecognition: $(OBJ_REAL)
	$(CC) -o $@ $^ $(CFLAGS)

ComplexConstantRecognition: $(OBJ_CPLX)
	$(CC) -o $@ $^ $(CFLAGS)

.PHONY: clean all

clean:
	rm -f $(OBJ_REAL) $(OBJ_CPLX) RealConstantRecognition ComplexConstantRecognition found.txt
