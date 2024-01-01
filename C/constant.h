#include <math.h>
#include <string.h>
#include <complex.h>
#include <stdio.h>
#include "math2.h"
#define STACKSIZE 64
#define MAXTHREADS 128
#define True 1
#define False 0
#define INSTR_NUM 3

/*
Unary functions:
{}
Push on stack:
{{EULER, E}}
Binary operators:
{{POWER, Power}, {LOGARITHM, Log}}

{0 -> EULER, 1 -> POWER, 2 -> LOGARITHM}

*/
float constantf(const char * , const int);
double constant(const char * , const int);
long double constantl(const char * , const int);
float complex cconstantf(const char * , const int);
double complex cconstant(const char * , const int);
long double complex cconstantl(const char * , const int);

int checkSyntax(const char * , const int);
