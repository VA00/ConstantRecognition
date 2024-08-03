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
#include "../C/itoa.c"
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

char* search_RPN(double z, int MaxCodeLength, int cpu_id, int ncpus) {


  // Allocate memory for the output string
  char* RPN_full_Code = (char*)malloc(32*16 * sizeof(char));
  char* JSON_output =  (char*)malloc(2048 * sizeof(char));

  if( (RPN_full_Code == NULL) || (JSON_output == NULL) ) return "Error allocating memory";
  
  unsigned long long int j, k, k_best=0, k1=0, k2=0,kMAX,chunk_size,start,end;
  
  char amino[STACKSIZE];
  
  ERR_TYPE var, best;
  NUM_TYPE computedX, targetX;
  

   
  int K, K_best=1, test;
  const int n=INSTR_NUM;
  //int omp_cancel_flag=0, cpu_id=0, ncpus=1;
  
  //FILE  *flagfile, *search_log_file;  
  //char str[137], output_filename[137], timestamp[26], RPN_full_Code[1024];

  targetX = ( NUM_TYPE ) z;
  


  best  = MAX_NUMBER;
  
  j=cpu_id;
  for(K=1;K<=MaxCodeLength;K++)
  {
    kMAX=ipow(INSTR_NUM,K);
    chunk_size = (kMAX/ncpus)+0ULL;
    start=cpu_id*chunk_size;
    end = (cpu_id == ncpus-1) ? kMAX : start+chunk_size-1;

    //printf("K=%d,\tkMAX=%llu,\tchunk_size=%llu, start=%llu, end=%llu\n",K,kMAX,chunk_size, start,end);

    for(k=start;k<end;k++)
    //for(k=cpu_id;k<kMAX;k=k+ncpus)
    {		
      if(k==start) itoa(start, amino, n, K); else itoa_update(amino, n, K);
      //j=j+ncpus;
      j=j+1;
      /* Convert number 'k' into string 'amino' in base-n number of length 'K' including leading zeros */
      //itoa(k, amino, n, K);
          
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
        //strcat(RPN_full_Code, ", SUCCESS");
        sprintf(JSON_output, "{\"result\":\"SUCCESS\", \"RPN\":\"%s\"}",RPN_full_Code);

        return JSON_output;
       }
       

    }
    if((k1<=12ULL) && (j>1000000ULL) && (K>4) ) //Early exit if basically NOTHING was found so far; Further search seems pointless. Used values are for 36-button CALC4
    {
      itoa(k_best, amino, n, K_best);
      print_code_mathematica(amino,K_best,RPN_full_Code);
      //strcat(RPN_full_Code, ", FAILURE");
      //printf("\nk1=%llu\tj=%llu\n",k1,j);
      sprintf(JSON_output, "{\"result\":\"ABORTED\", \"RPN\":\"%s\"}",RPN_full_Code);
      return JSON_output;
    }

  }

  /* WARNING: it is possible for search to find NOTHING! 
     Returning k=0, K=1 in this cases as fallback.
  */
  
  itoa(k_best, amino, n, K_best);
  print_code_mathematica(amino,K_best,RPN_full_Code);
  //strcat(RPN_full_Code, ", FAILURE");
  //printf("\nk1=%llu\tj=%llu\n",k1,j);

  char ABS_ERR_string[128];
  sprintf(ABS_ERR_string, "%.17e",best);

  sprintf(JSON_output, "{\"result\":\"FAILURE\", \"RPN\":\"%s\", \"ABS_ERR\":\"%s\"}",RPN_full_Code,ABS_ERR_string);

  return JSON_output;

}
