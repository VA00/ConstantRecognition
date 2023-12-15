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


int main(int argc, char** argv)
{
  unsigned long long int j, k, k1=0, k2=0;
  
  char amino[STACKSIZE];
  
  double var, best, bestOfn[STACKSIZE], previousBest;
  double complex computedX;
  
  const double complex targetX=1.0175451652862630105139924352308;
   
  int K, test, ULP;
  const int n=INSTR_NUM;
  int omp_cancel_flag=0, cpu_id=1, ncpus=1;
  
  
  FILE  *flagfile;  

  
  pthread_t threadID;
  time_t timer;
  char buff[26];


  if(!(argv[1]==NULL))
  {
    sscanf(argv[1],"%d",&cpu_id);
    sscanf(argv[2],"%d",&ncpus);
  }

    time_t now = time (0);
    strftime (buff, 26, "%Y-%m-%d %H:%M:%S.000", localtime (&now));
    printf ("%s\n", buff);
 
  setlinebuf(stdout); //disable 4kB stdout buffer
  
//  printf("Docelowa liczba = %.32lf + %.32lf i\n\n",creal(targetX), cimag(targetX));
//  printf("cpu_id=%d\tncpus=%d\n",cpu_id,ncpus);


  best  = DBL_MAX;
  

// LOOP UNROLL  j -> K, k
  for(j=cpu_id;j<ipow(36,6);j=j+ncpus)
  {		

	k1++;
	
	if(k1%(ipow(10,6))==0){ //co 10^6 sprawdza plik, czy inne zadanie nie znalazlo wzoru
	
	  	  flagfile = fopen("found.txt","r");
          fscanf(flagfile, "%d", &omp_cancel_flag);
          fclose(flagfile);
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
		  
          printf("\nConstant recognized by thread %d:\t%le\tj=%llu\tCODE:\t%s\n",cpu_id, best/DBL_EPSILON,j,amino);
	      printf("Re=%.18lf\t",creal(computedX));
	      printf("Im=%.18lf\t",cimag(computedX));
	      
          print_code_mathematica(amino,K);
	      printf("\n\n");

          omp_cancel_flag = 1;
		  flagfile = fopen("found.txt","w");
          fprintf(flagfile, "%d", omp_cancel_flag);
          fclose(flagfile);

		  break;
     }

    
	
  }
  
  
  ULP=0;
  while( (computedX!=targetX) && abs(ULP) <1024*4 ){ ULP++; computedX=nextafter(computedX,targetX);}
    
  printf("Total codes/formulae tested:\t%llu,%llu\tULP=%d\n",k1,k2, (ULP<1024*4) ? ULP : -1 );
  strftime (buff, 26, "%Y-%m-%d %H:%M:%S.000", localtime (&now));
  printf ("%s\n", buff);


  printf("\nB.O.A.T. from %d:\t%le\tj=%llu\tCODE:\t%s\n",
  cpu_id, best/DBL_EPSILON, j,amino);
  printf("Re=%.18lf\t",creal(computedX));
  printf("Im=%.18lf\t",cimag(computedX));
  
  print_code_mathematica(amino,K);
  printf("\n\n");

  printf("END\n\n");

return 0;

}
