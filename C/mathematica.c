
#include <string.h>
#include <stdio.h>


void print_code_mathematica(const char * amino, const int aminoLength, char *RPN_full_Code)
{


  
int ii;
char instr;

RPN_full_Code[0] = '\0';

  for(ii=0;ii<aminoLength;ii++)
   {
	instr = amino[ii];
    switch(instr)
	 {
case '0':
strcat(RPN_full_Code,"EULER, ");
break;
case '1':
strcat(RPN_full_Code,"POWER, ");
break;
case '2':
strcat(RPN_full_Code,"LOGARITHM, ");
break;
}}
    size_t len = strlen(RPN_full_Code);
    if (len > 2) {
        RPN_full_Code[len - 2] = '\0';
    }
}