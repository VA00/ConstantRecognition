#include <math.h>
#include <complex.h>

/* sqr computes x squared, x*x */

float sqrf(float);
double sqr(double);
long double sqrl(long double);

complex float csqrf(complex float);
complex double csqr(complex double);
complex long double csqrl(complex long double);


/* dbl doubles x,  2.0*x == x+x */

float dblf(float);
double dbl(double);
long double dbll(long double);

complex float cdblf(complex float);
complex double cdbl(complex double);
complex long double cdbll(complex long double);

float halff(float);
double half(double);
long double halfl(long double);

complex float chalff(complex float);
complex double chalf(complex double);
complex long double chalfl(complex long double);



/* suc computex integer ,,succesor'' x,  x+1 */

float sucf(float);
double suc(double);
long double sucl(long double);

complex float csucf(complex float);
complex double csuc(complex double);
complex long double csucl(complex long double);

/* pre computex integer ,,precedesor'' x,  x-1 */

float pref(float);
double pre(double);
long double prel(long double);

complex float cpref(complex float);
complex double cpre(complex double);
complex long double cprel(complex long double);

/* inv computex reciprocal 1/x*/

float invf(float);
double inv(double);
long double invl(long double);

complex float cinvf(complex float);
complex double cinv(complex double);
complex long double cinvl(complex long double);

/* tetration x^x*/

float tetf(float);
double tet(double);
long double tetl(long double);

complex float ctetf(complex float);
complex double ctet(complex double);
complex long double ctetl(complex long double);

/* arbitrary base Logarithm LN */

float lnf(float,float);
double ln(double,double);
long double lnl(long double, long double);

complex float clnf(complex float,complex float);
complex double cln(complex double,complex double);
complex long double clnl(complex long double, complex long double);

/* Complex EML operator */


float emlf(float, float);
double eml(double x, double y);
long double emll(long double x, long double y);
complex float cemlf(complex float, complex float);
complex double ceml(complex double x, complex double y);
complex long double cemll(complex long double x, complex long double y);


/* Complex Gamma function: not yet implemented */

complex float ctgammaf(complex float);
complex double ctgamma(complex double);
complex long double ctgammal(complex long double);
