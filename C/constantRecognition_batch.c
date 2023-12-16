/* Andrzej Odrzywolek, 15.12.2024, andrzej.odrzywolek@uj.edu.pl */
#include <stdio.h>
#include <math.h>
#include <string.h>
#include <stdlib.h>
#include <complex.h>
#include <fenv.h>
#include <omp.h>
#include <float.h>
#include "constant4.h"
#include "itoa.h"
#include "mathematica.h"
#include "math2.h"
#include <time.h>

double complex parseComplex(const char *str) {
    double realPart, imagPart;
    double complex result;

    // Try reading as a complex number (real + imaginary)
    if (sscanf(str, "%lf + %lfI", &realPart, &imagPart) == 2 ||
        sscanf(str, "%lf - %lfI", &realPart, &imagPart) == 2) {
        result = realPart + imagPart * I;
    }
    // Try reading as a purely real number
    else if (sscanf(str, "%lf", &realPart) == 1) {
        result = realPart + 0.0 * I;
    } else {
        // Return NaN + NaN * I to indicate error
        result = NAN + NAN * I;
    }

    return result;
}

int main(int argc, char** argv)
{
  unsigned long long int j, k, k1=0, k2=0;
  
  char amino[STACKSIZE];
  
  double var, best, input_number;
  double complex computedX;
  
  //const double complex targetX=1.0+1.4634181403788164189078391170022I;

   
  int K, test, ULP;
  const int n=INSTR_NUM;
  int omp_cancel_flag=0, cpu_id=1, ncpus=1;
  
  FILE  *flagfile, *output;  
  char str[123];


  if(!(argv[1]==NULL))
  {
    sscanf(argv[1],"%s", str);
    sscanf(argv[2],"%d",&cpu_id);
    sscanf(argv[3],"%d",&ncpus);
  }

  //printf("%s\n",str);
  //exit(0);


  double complex targetX = parseComplex(str);



  setlinebuf(stdout); //disable 4kB stdout buffer

  best  = DBL_MAX;
  

// LOOP UNROLL  j -> K, k
  for(j=cpu_id;j<ipow(36,6);j=j+ncpus)
  {		

	k1++;
	
	if(k1%(ipow(10,6))==0){ //co 10^6 sprawdza plik, czy inne zadanie nie znalazlo wzoru
	
	  	  //flagfile = fopen("found.txt","r");
          //fscanf(flagfile, "%d", &omp_cancel_flag);
          //fclose(flagfile);


          flagfile = fopen("found.txt","r");
          if (flagfile != NULL) {
              if (fscanf(flagfile, "%d", &omp_cancel_flag) != 1) {
                  printf("Unable to read found.txt Thread %d exit.\n",cpu_id); exit(0);// Handle error if fscanf fails to read an integer
              }
              fclose(flagfile);
          } else {
              printf("File found.txt do not exist. Thread %d exit.\n",cpu_id); exit(0);// Handle the case where the file doesn't exist or couldn't be opened
          }



		  if(omp_cancel_flag==1){ printf("EXIT JOB %d\n",cpu_id); exit(0); }
	}
	
	K = 1;
    while(j > (-n + ipow(n,1+K) - K + n*K)/(-1 + n) ) K++;
    
	
	k = ipow(n,K)-( (-n + ipow(n,1 + K) - K + n*K)/(-1 + n)) + j;
  

    itoa(k, amino, n, K);
        
    test = checkSyntax (amino, K);
    if (!test) continue;
        
    computedX = constant(amino, K);
		  
    if(computedX!=computedX) continue;  // skip NaN
	
	k2++;
	
    var = cabs( computedX/targetX - 1.0 );			
					  
    
    if(var<best) 
     {
      best = var;
      ULP=0;
      while( (computedX!=targetX) && abs(ULP) <1024*4 ){ ULP++; computedX=nextafter(computedX,targetX);}
       
      printf("%20llu\t%20llu\t%20llu\t%d\t%e\t%lf\t%lf\t%d\t",j,k1,k2,(ULP<1024*4) ? ULP : -1, best/DBL_EPSILON, creal(computedX),cimag(computedX),cpu_id);

      char buff[26];
      time_t now = time (0);
      strftime (buff, 26, "%Y-%m-%d %H:%M:%S.000", localtime (&now));
      printf ("%s\n", buff);

      //printf("\nBest_of_the_best from %d:\t%le\tj=%llu\tCODE:\t%s\n",
	  //cpu_id, best/DBL_EPSILON, j,amino);
	  //printf("Re=  %.32lf\t",creal(computedX));
	  //printf("Im=  %.32lf\t",cimag(computedX));
	  //
      //print_code_mathematica(amino,K);
	  //printf("\n\n");
	 }
  
	 if(best<=16*DBL_EPSILON) //jezeli znalazl, wychodzi z petli i zapisuje plik dla innych procesow
	 {
		  
          printf("\nConstant recognized by thread %d:\tError in $MachineEps=%le\tCode number=%llu\tSHORT CODE:\t%s\n",cpu_id, best/DBL_EPSILON,j,amino);

          ULP=0;
          while( (computedX!=targetX) && abs(ULP) <1024*4 ){ ULP++; computedX=nextafter(computedX,targetX);}
            
          printf("Total valid formulae [all codes] tested by thread %d:\t%llu [%llu]\n",cpu_id,k2,k1);
          printf("Minimal error in ULP=%d\n", (ULP<1024*4) ? ULP : -1 );

	      printf("Re=%.18lf\t",creal(computedX));
	      printf("Im=%.18lf\t\n",cimag(computedX));
	      
          printf("RPN CODE:\t");
          print_code_mathematica(amino,K);
	      printf("\n\n");

          omp_cancel_flag = 1;
		  flagfile = fopen("found.txt","w");
          fprintf(flagfile, "%d", omp_cancel_flag);
          fclose(flagfile);

		  exit(0);//break;
     }

    
	
  }
  
  
  ULP=0;
  while( (computedX!=targetX) && abs(ULP) <1024*4 ){ ULP++; computedX=nextafter(computedX,targetX);}
    
  printf("Total valid formulae [all codes] tested by thread %d:\t%llu,%llu\n",cpu_id,k1,k2);
  printf("Minimal error in ULP=%d\n", (ULP<1024*4) ? ULP : -1 );
  //strftime (buff, 26, "%Y-%m-%d %H:%M:%S.000", localtime (&now));
  //printf ("%s\n", buff);


  printf("\nB.O.A.T. from %d:\t%le\tj=%llu\tCODE:\t%s\n",
  cpu_id, best/DBL_EPSILON, j,amino);
  printf("Re=%.18lf\t",creal(computedX));
  printf("Im=%.18lf\t",cimag(computedX));
  
  print_code_mathematica(amino,K);
  printf("\n\n");

  printf("END of search for thread %d\n\n", cpu_id);

return 0;

}
