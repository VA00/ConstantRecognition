CC=gcc
CFLAGS=-Wall -fopenmp -lm
DEPS = constant4.c itoa.c mathematica4.c math2.c
OBJ = constantRecognition_batch.o $(DEPS:.c=.o)

%.o: %.c $(DEPS)
	$(CC) -c -o $@ $< $(CFLAGS)

constantRecognition: $(OBJ)
	$(CC) -o $@ $^ $(CFLAGS)

.PHONY: clean

clean:
	rm -f $(OBJ) constantRecognition found.txt
