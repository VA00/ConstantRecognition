#include <stdio.h>
#include <math.h>
#include <stdlib.h>
#include <complex.h>

int compute_ULP_distance(double computedX, double targetX) {

    double tempX = computedX;
    int ULP = 0;

    while ((tempX != targetX) && abs(ULP) < 4096) {
        ULP++;
        tempX = nextafter(tempX, targetX);
    }

    if(ULP<4096) 
      return ULP;
    else
      return -1;
}

double complex parseComplex(const char *str) {
    double realPart = 0.0, imagPart = 0.0;
    double complex result;
    char sign = '+';
    int count;

    // Try reading as a complex number (real part + sign + imaginary part)
    count = sscanf(str, "%lf %c %lfi", &realPart, &sign, &imagPart);
    
    if (count == 3) {
        if (sign == '-') {
            imagPart = -imagPart;
        }
        result = realPart + imagPart * I;
    }
    // Try reading as a purely real number
    else if (sscanf(str, "%lf", &realPart) == 1) {
        result = realPart + 0.0 * I;
    } else {
        // Return NAN + NAN * I to indicate error
        result = NAN + NAN * I;
    }

    return result;
}

int isnan_complex(double complex z) {
    return isnan(creal(z)) || isnan(cimag(z));
}