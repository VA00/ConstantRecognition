
#include <string.h>
#include <stdio.h>


void print_code_mathematica(const char * amino, const int aminoLength)
{


  
int ii;
char instr;

  for(ii=0;ii<aminoLength;ii++)
   {
	instr = amino[ii];
    switch(instr)
	 {
case '0':
printf("PI, ");
break;
case '1':
printf("EULER, ");
break;
case '2':
printf("IMG, ");
break;
case '3':
printf("LOG, ");
break;
case '4':
printf("EXP, ");
break;
case '5':
printf("PLUS, ");
break;
case '6':
printf("TIMES, ");
break;
case '7':
printf("INV, ");
break;
case '8':
printf("MINUS, ");
break;
case '9':
printf("SQRT, ");
break;
case 'a':
printf("SQR, ");
break;
case 'b':
printf("SIN, ");
break;
case 'c':
printf("ARCSIN, ");
break;
case 'd':
printf("COS, ");
break;
case 'e':
printf("ARCCOS, ");
break;
case 'f':
printf("TAN, ");
break;
case 'g':
printf("ARCTAN, ");
break;
case 'h':
printf("SINH, ");
break;
case 'i':
printf("ARCSINH, ");
break;
case 'j':
printf("COSH, ");
break;
case 'k':
printf("ARCCOSH, ");
break;
case 'l':
printf("TANH, ");
break;
case 'm':
printf("ARCTANH, ");
break;
case 'n':
printf("ONE, ");
break;
case 'o':
printf("TWO, ");
break;
case 'p':
printf("THREE, ");
break;
case 'q':
printf("FOUR, ");
break;
case 'r':
printf("FIVE, ");
break;
case 's':
printf("SIX, ");
break;
case 't':
printf("SEVEN, ");
break;
case 'u':
printf("EIGHT, ");
break;
case 'v':
printf("NINE, ");
break;
case 'w':
printf("GOLDENRATIO, ");
break;
case 'x':
printf("SUBTRACT, ");
break;
case 'y':
printf("DIVIDE, ");
break;
case 'z':
printf("POWER, ");
break;
}}
printf("\n");
}