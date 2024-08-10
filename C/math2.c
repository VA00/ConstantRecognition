#include <math.h>
#include <complex.h>

/* sqr computes x squared, x*x */

float sqrf(float x)
{
  return x*x;
}

double sqr(double x)
{
  return x*x;
}

long double sqrl(long double x)
{
  return x*x;
}

complex float csqrf(complex float x)
{
  return x*x;
}


complex double csqr(complex double x)
{
  return x*x;
}

complex long double csqrl(complex long double x)
{
  return x*x;
}


/* double, i.e. multiply by two: 2.0*x, or x+x */

float dblf(float x)
{
  return x+x;
}

double dbl(double x)
{
  return x+x;
}

long double dbll(long double x)
{
  return x+x;
}

complex float cdblf(complex float x)
{
  return x+x;
}


complex double cdbl(complex double x)
{
  return x+x;
}

complex long double cdbll(complex long double x)
{
  return x+x;
}


float halff(float x)
{
  return 0.5f*x;
}

double half(double x)
{
  return 0.5*x;
}

long double halfl(long double x)
{
  return 0.5l*x;
}

complex float chalff(complex float x)
{
  return 0.5f*x;
}


complex double chalf(complex double x)
{
  return 0.5*x;
}

complex long double chalfl(complex long double x)
{
  return 0.5l*x;
}


/* successor x+1 */

float sucf(float x)
{
  return x+1.0f;
}

double suc(double x)
{
  return x+1.0;
}

long double sucl(long double x)
{
  return x+1.0l;
}

complex float csucf(complex float x)
{
  return x+1.0f;
}


complex double csuc(complex double x)
{
  return x+1.0;
}

complex long double csucl(complex long double x)
{
  return x+1.0l;
}




/* precedesor x-1 */

float pref(float x)
{
  return x-1.0f;
}

double pre(double x)
{
  return x-1.0;
}

long double prel(long double x)
{
  return x-1.0l;
}

complex float cpref(complex float x)
{
  return x-1.0f;
}


complex double cpre(complex double x)
{
  return x-1.0;
}

complex long double cprel(complex long double x)
{
  return x-1.0l;
}

/* reciprocal 1/x*/

float invf(float x)
{
  return 1.0f/x;
}

double inv(double x)
{
  return 1.0/x;
}

long double invl(long double x)
{
  return 1.0l/x;
}

complex float cinvf(complex float x)
{
  return 1.0f/x;
}


complex double cinv(complex double x)
{
  return 1.0/x;
}

complex long double cinvl(complex long double x)
{
  return 1.0l/x;
}


/* variants of complex tetration */

float tetf(float x)
{
  return powf(x,x);
}

double tet(double x)
{
  return pow(x,x);
}

long double tetl(long double x)
{
  return powl(x,x);
}

complex float ctetf(complex float x)
{
  return cpowf(x,x);
}


complex double ctet(complex double x)
{
  return cpow(x,x);
}

complex long double ctetl(complex long double x)
{
  return cpowl(x,x);
}


/* arbitrary base Logarithm LN */

float lnf(float x, float y)
{
	return logf(y)/logf(x);
}
double ln(double x, double y)
{
	return log(y)/log(x);
}


long double lnl(long double x, long double y)
{
	return logl(y)/logl(x);
}


complex float clnf(complex float x, complex float y)
{
	return clogf(y)/clogf(x);
}

complex double cln(complex double x, complex double y)
{
	return clog(y)/clog(x);
}


complex long double clnl(complex long double x, complex long double y)
{
	return clogl(y)/clogl(x);
}


complex float ctgammaf(complex float x)
{
  return tgammaf(crealf(x))+0.0f*I;
}

complex double ctgamma(complex double x)
{
  return tgamma(creal(x))+0.0*I;
}

complex long double ctgammal(complex long double x)
{
  return tgammal(creall(x))+0.0l*I;
}

