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

// Define your type options
#define REAL_FLT  1
#define REAL_DBL  2
#define REAL_LDBL 3
#define CPLX_FLT  4
#define CPLX_DBL  5
#define CPLX_LDBL 6

#define SEARCH_TYPE REAL_DBL

#if   SEARCH_TYPE == REAL_FLT
  #define NUM_TYPE float
  #define ERR_TYPE float
  #define MAX_NUMBER FLT_MAX
  #define ABS fabsf
  #define CONSTANT constantf
  #define EPSILON FLT_EPSILON
  #define ONE 1.0f
  #define IS_NAN isnanf
#elif SEARCH_TYPE == REAL_DBL
  #define NUM_TYPE double
  #define ERR_TYPE double
  #define MAX_NUMBER DBL_MAX
  #define ABS fabs
  #define CONSTANT constant 
  #define EPSILON DBL_EPSILON
  #define ONE 1.0
  #define IS_NAN isnan
#elif SEARCH_TYPE == REAL_LDBL
  #define NUM_TYPE long double
  #define ERR_TYPE long double
  #define MAX_NUMBER LDBL_MAX
  #define ABS fabsl
  #define CONSTANT constantl
  #define EPSILON LDBL_EPSILON
  #define ONE 1.0l
  #define IS_NAN isnanl
#elif SEARCH_TYPE == CPLX_FLT
  #define NUM_TYPE complex float
  #define ERR_TYPE float
  #define MAX_NUMBER FLT_MAX
  #define ABS cabsf
  #define CONSTANT cconstantf
  #define EPSILON FLT_EPSILON
  #define ONE 1.0f
  #define IS_NAN isnanf
#elif SEARCH_TYPE == CPLX_DBL
  #define NUM_TYPE complex double
  #define ERR_TYPE double
  #define MAX_NUMBER DBL_MAX
  #define ABS cabs
  #define CONSTANT cconstantf
  #define EPSILON DBL_EPSILON
  #define ONE 1.0
  #define IS_NAN isnan
#elif SEARCH_TYPE == CPLX_LDBL
  #define NUM_TYPE complex long double
  #define ERR_TYPE long double
  #define MAX_NUMBER LDBL_MAX
  #define ABS cabsl
  #define CONSTANT cconstantl
  #define EPSILON LDBL_EPSILON
  #define ONE 1.0l
  #define IS_NAN isnanl
#endif


#define EPS_MAX 16 //Maximum error considered to be equality, use 0 or 1 to be "paranoid"

char* search_RPN(double z, int MaxCodeLength) {


  // Allocate memory for the output string
  char* RPN_full_Code = (char*)malloc(32*16 * sizeof(char));
  if (RPN_full_Code == NULL) return "Error allocating memory";
  
  unsigned long long int j, k, k_best, k1=0, k2=0;
  
  char amino[STACKSIZE];
  
  ERR_TYPE var, best;
  NUM_TYPE computedX, targetX;
  

   
  int K, K_best, test;
  const int n=INSTR_NUM;
  int omp_cancel_flag=0, cpu_id=1, ncpus=1;
  
  //FILE  *flagfile, *search_log_file;  
  //char str[137], output_filename[137], timestamp[26], RPN_full_Code[1024];

  targetX = ( NUM_TYPE ) z;
  


  best  = MAX_NUMBER;
  
  j=cpu_id;
  for(K=1;K<=MaxCodeLength;K++)
  for(k=cpu_id;k<=ipow(INSTR_NUM,K);k=k+ncpus)
// LOOP UNROLL  j -> K, k
  //for(j=cpu_id;j<ipow(INSTR_NUM,MaxCodeLength);j=j+ncpus)
  {		
    j=j+ncpus;

	
	
	/* Loop unrolling j->(k,K) */
    /*
	K = 1;
    while(j > (-n + ipow(n,1+K) - K + n*K)/(-1 + n) ) K++;
    
	
	k = ipow(n,K)-( (-n + ipow(n,1 + K) - K + n*K)/(-1 + n)) + j;
    */
    /* Convert number 'k' into string 'amino' in base-n number of length 'K' including leading zeros */
    itoa(k, amino, n, K);
        
    test = checkSyntax (amino, K); //check if RPN code is valid 
    if (!test) continue;
	k1++;

    computedX = CONSTANT(amino, K);
	if (IS_NAN(computedX)) continue;  // Skip NaN
    k2++;
    var = ABS( computedX/targetX - ONE );	  
		
					  
    
    if(var<best) 
     {
      best = var;
      K_best=K;
      k_best=k;

	 }
  
	 if(best<=EPS_MAX*EPSILON) //jezeli znalazl, wychodzi z petli i funkcji !
	 {
	  itoa(k_best, amino, n, K_best);
      print_code_mathematica(amino,K_best,RPN_full_Code);
      return RPN_full_Code;
     }
    
	
  }

  itoa(k_best, amino, n, K_best);
  print_code_mathematica(amino,K_best,RPN_full_Code);

  return RPN_full_Code;

}
