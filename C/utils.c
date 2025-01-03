#include <stdio.h>
#include <math.h>
#include <stdlib.h>
#include <stdint.h>
#include <complex.h>
#include <string.h> // For memcpy
#include "utils.h"

#if 0
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
#endif

//Proposed by o1

uint64_t compute_ULP_distance(const double ref, const double val)
{
    // Handle NaN and infinities if necessary
    if (isnan(ref) || isnan(val) || isinf(ref) || isinf(val)) {
        // Define behavior for NaN
        return UINT64_MAX;
    }

    // Map doubles to int64_t while preserving ordering
    int64_t i_ref, i_val;
    memcpy(&i_ref, &ref, sizeof(double));
    memcpy(&i_val, &val, sizeof(double));

    if (i_ref < 0)
        i_ref = INT64_MIN - i_ref;
    if (i_val < 0)
        i_val = INT64_MIN - i_val;

    uint64_t ulp_diff = (uint64_t)(llabs(i_val - i_ref));
    return ulp_diff;
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
