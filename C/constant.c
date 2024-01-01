#include <math.h>
#include <string.h>
#include <complex.h>
#include <stdio.h>
#include "math2.h"

#include "constant.h"

/*
Unary functions:
{}
Push on stack:
{{EULER, E}}
Binary operators:
{{POWER, Power}, {LOGARITHM, Log}}

{0 -> EULER, 1 -> POWER, 2 -> LOGARITHM}

*/

int checkSyntax(const char * amino, const int aminoLength)
{
  int ii,position;
  char instr;

  position = 0;
  for(ii=0;ii<aminoLength;ii++)
   {
 
	instr = amino[ii];
    switch(instr)
	 {case '0': 
	position++;
break;

	if(position<1) return False;
break;
case '1': case '2': 
	if(position<2) return False;
	position--;
break;
}
}
  if(position==1)
   	return True;
  else
   	return False;
 
}

float complex  cconstantf(const char * amino, const int aminoLength)
{
float complex stos[STACKSIZE];
int position;
int ii;
char instr;
position=0;
for(ii=0;ii<aminoLength;ii++)
{
instr=amino[ii];
switch(instr) {
case '0':
	stos[position]=2.71828182845904523536028747135266249775724709369995957496696762772406399401759425599088053544407f;
	position++;
break;
case '1':
	stos[position-2]=cpowf(stos[position-1],stos[position-2]);
	position--;
break;
case '2':
	stos[position-2]=clnf(stos[position-1],stos[position-2]);
	position--;
break;
default : return(nanf("NAN"));
}
}
return (stos[position-1]);
}
double complex  cconstant(const char * amino, const int aminoLength)
{
double complex stos[STACKSIZE];
int position;
int ii;
char instr;
position=0;
for(ii=0;ii<aminoLength;ii++)
{
instr=amino[ii];
switch(instr) {
case '0':
	stos[position]=2.71828182845904523536028747135266249775724709369995957496696762772406399401759425599088053544407;
	position++;
break;
case '1':
	stos[position-2]=cpow(stos[position-1],stos[position-2]);
	position--;
break;
case '2':
	stos[position-2]=cln(stos[position-1],stos[position-2]);
	position--;
break;
default : return(nan("NAN"));
}
}
return (stos[position-1]);
}
long double complex  cconstantl(const char * amino, const int aminoLength)
{
long double complex stos[STACKSIZE];
int position;
int ii;
char instr;
position=0;
for(ii=0;ii<aminoLength;ii++)
{
instr=amino[ii];
switch(instr) {
case '0':
	stos[position]=2.71828182845904523536028747135266249775724709369995957496696762772406399401759425599088053544407l;
	position++;
break;
case '1':
	stos[position-2]=cpowl(stos[position-1],stos[position-2]);
	position--;
break;
case '2':
	stos[position-2]=clnl(stos[position-1],stos[position-2]);
	position--;
break;
default : return(nanl("NAN"));
}
}
return (stos[position-1]);
}
float constantf(const char * amino, const int aminoLength)
{
float stos[STACKSIZE];
int position;
int ii;
char instr;
position=0;
for(ii=0;ii<aminoLength;ii++)
{
instr=amino[ii];
switch(instr) {
case '0':
	stos[position]=2.71828182845904523536028747135266249775724709369995957496696762772406399401759425599088053544407f;
	position++;
break;
case '1':
	stos[position-2]=powf(stos[position-1],stos[position-2]);
	position--;
break;
case '2':
	stos[position-2]=lnf(stos[position-1],stos[position-2]);
	position--;
break;
default : return(nanf("NAN"));
}
}
return (stos[position-1]);
}
double constant(const char * amino, const int aminoLength)
{
double stos[STACKSIZE];
int position;
int ii;
char instr;
position=0;
for(ii=0;ii<aminoLength;ii++)
{
instr=amino[ii];
switch(instr) {
case '0':
	stos[position]=2.71828182845904523536028747135266249775724709369995957496696762772406399401759425599088053544407;
	position++;
break;
case '1':
	stos[position-2]=pow(stos[position-1],stos[position-2]);
	position--;
break;
case '2':
	stos[position-2]=ln(stos[position-1],stos[position-2]);
	position--;
break;
default : return(nan("NAN"));
}
}
return (stos[position-1]);
}
long double constantl(const char * amino, const int aminoLength)
{
long double stos[STACKSIZE];
int position;
int ii;
char instr;
position=0;
for(ii=0;ii<aminoLength;ii++)
{
instr=amino[ii];
switch(instr) {
case '0':
	stos[position]=2.71828182845904523536028747135266249775724709369995957496696762772406399401759425599088053544407l;
	position++;
break;
case '1':
	stos[position-2]=powl(stos[position-1],stos[position-2]);
	position--;
break;
case '2':
	stos[position-2]=lnl(stos[position-1],stos[position-2]);
	position--;
break;
default : return(nanl("NAN"));
}
}
return (stos[position-1]);
}
