/* Andrzej Odrzywolek, 03.01.2024, andrzej.odrzywolek@uj.edu.pl */

/*
To compile for WASM/WWW

emcc -Wall ConstantRecognition_function_for_WASM.c ../C/constant.c ../C/itoa.c ../C/mathematica.c ../C/math2.c \
-s WASM=1 -s EXPORTED_FUNCTIONS='["_search_RPN", "_free"]' -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]' \
-o rpn_function.js

*/


#include <stdio.h>
#include <math.h>
#include <string.h>
#include <stdlib.h>
#include <complex.h>
#include <fenv.h>
#include <float.h>
#include "../C/constant.h"
#include "../C/itoa.h"
#include "../C/mathematica.h"
#include "../C/math2.h"
#include "../C/utils.h"


#ifdef USE_COMPLEX
  #define NUM_TYPE double complex
#else
  #define NUM_TYPE double
#endif

#define DBL_EPS_MAX 16 //Maximum error considered to be equality, use 0 or 1 to be "paranoid"

char* search_RPN(double z) {


  // Allocate memory for the output string
  char* RPN_full_Code = (char*)malloc(32*16 * sizeof(char));
  if (RPN_full_Code == NULL) return "Error allocating memory";
  
  unsigned long long int j, k, k_best, k1=0, k2=0;
  
  char amino[STACKSIZE];
  
  double var, best;
  NUM_TYPE computedX, targetX;
  

   
  int K, K_best, test, MaxCodeLength=5;
  const int n=INSTR_NUM;
  int omp_cancel_flag=0, cpu_id=1, ncpus=1;
  
  //FILE  *flagfile, *search_log_file;  
  //char str[137], output_filename[137], timestamp[26], RPN_full_Code[1024];

  targetX = z;
  


  best  = DBL_MAX;
  

// LOOP UNROLL  j -> K, k
  for(j=cpu_id;j<ipow(INSTR_NUM,MaxCodeLength);j=j+ncpus)
  {		

	k1++;
	
	
	/* Loop unrolling j->(k,K) */
	K = 1;
    while(j > (-n + ipow(n,1+K) - K + n*K)/(-1 + n) ) K++;
    
	
	k = ipow(n,K)-( (-n + ipow(n,1 + K) - K + n*K)/(-1 + n)) + j;
  
    /* Convert number 'k' into string 'amino' in base-n number of length 'K' including leading zeros */
    itoa(k, amino, n, K);
        
    test = checkSyntax (amino, K); //check if RPN code is valid 
    if (!test) continue;

#ifdef USE_COMPLEX         
    computedX = cconstant(amino, K);
	if (isnan(creal(computedX)) || isnan(cimag(computedX))) continue;  // Skip NaN
	k2++;
    var = cabs( computedX/targetX - 1.0 );	  
#else
    computedX = constant(amino, K);
	if (isnan(computedX)) continue;  // Skip NaN
    k2++;
    var = fabs( computedX/targetX - 1.0 );	  
#endif
		
					  
    
    if(var<best) 
     {
      best = var;
      K_best=K;
      k_best=k;

	 }
  
	 if(best<=DBL_EPS_MAX*DBL_EPSILON) //jezeli znalazl, wychodzi z petli i zapisuje plik dla innych procesow
	 {
	  break;
     }
    
	
  }

  itoa(k_best, amino, n, K_best);
  print_code_mathematica(amino,K_best,RPN_full_Code);

  return RPN_full_Code;

}
