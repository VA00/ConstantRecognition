/* Andrzej Odrzywolek, 15.12.2024, andrzej.odrzywolek@uj.edu.pl */
#include <stdio.h>
#include <math.h>
#include <string.h>
#include <stdlib.h>
#include <complex.h>
#include <fenv.h>
#include <omp.h>
#include <float.h>
#include "constant.h"
#include "itoa.h"
#include "mathematica.h"
#include "math2.h"
#include <time.h>

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

int main(int argc, char** argv)
{
  unsigned long long int j, k, k1=0, k2=0;
  
  char amino[STACKSIZE];
  
  double var, best;
  double complex computedX;
  
  //const double complex targetX=1.0+1.4634181403788164189078391170022I;

   
  int K, test, ULP;
  const int n=INSTR_NUM;
  int omp_cancel_flag=0, cpu_id=1, ncpus=1;
  
  FILE  *flagfile, *search_log_file;  
  char str[137], output_filename[137], timestamp[26], RPN_full_Code[1024];


  if(!(argv[1]==NULL))
  {
    sscanf(argv[1],"%s", str);
    sscanf(argv[2],"%d",&cpu_id);
    sscanf(argv[3],"%d",&ncpus);
  }

  //printf("%*.*lf\n", 18, 6, M_PI);

  double complex targetX = parseComplex(str);

  //printf("%lf + %lf*I\n",creal(casin(2.0)), cimag(casin(2.0)));

  if(cpu_id==1) printf("Search target:%.18lf%+.18lfI\n", creal(targetX), cimag(targetX));

  time_t now = time (0);
  strftime (timestamp, 13, "%Y-%m-%d", localtime (&now));
  snprintf(output_filename, sizeof(output_filename), "search_log_%d_%s.txt", cpu_id,timestamp);
  search_log_file = fopen(output_filename, "w");
    if (search_log_file == NULL) {
        perror("Error opening search_log_file!");
        exit(EXIT_FAILURE);
    }

  fprintf(search_log_file,"%-20s\t%-20s\t%-20s\t%s\t%22s\t%-24s\t%-24s\t%s\t%-27s\t%-26s\t%s\n","Counter","Code number","Formula number",
"ULP", "Error/DBL_EPS", "Re(X)","Im(X)","cpu_id","Short code","Timestamp", "Full RPN code");

  setlinebuf(stdout); //disable 4kB stdout buffer

  best  = DBL_MAX;
  

// LOOP UNROLL  j -> K, k
  for(j=cpu_id;j<ipow(36,6);j=j+ncpus)
  {		

	k1++;
	
	if(k1%(ipow(10,6))==0){ //co 10^6 sprawdza plik, czy inne zadanie nie znalazlo wzoru
	

          flagfile = fopen("found.txt","r");
          if (flagfile != NULL) {
              if (fscanf(flagfile, "%d", &omp_cancel_flag) != 1) {
                  printf("Unable to read found.txt Thread %d exit.\n",cpu_id); exit(0);// Handle error if fscanf fails to read an integer
              }
              fclose(flagfile);
          } else {
              printf("File found.txt do not exist. Thread %d exit.\n",cpu_id); exit(0);// Handle the case where the file doesn't exist or couldn't be opened
          }



		  if(omp_cancel_flag==1){ printf("EXIT JOB %d\n",cpu_id);  fclose(search_log_file); exit(0); }
	}
	
	K = 1;
    while(j > (-n + ipow(n,1+K) - K + n*K)/(-1 + n) ) K++;
    
	
	k = ipow(n,K)-( (-n + ipow(n,1 + K) - K + n*K)/(-1 + n)) + j;
  

    itoa(k, amino, n, K);
        
    test = checkSyntax (amino, K);
    if (!test) continue;
        
    computedX = cconstant(amino, K);
		  
    if(computedX!=computedX) continue;  // skip NaN
	
	k2++;
	
    var = cabs( computedX/targetX - 1.0 );			
					  
    
    if(var<best) 
     {
      best = var;

      ULP = compute_ULP_distance(computedX, targetX);
       
      fprintf(search_log_file,"%20llu\t%20llu\t%20llu\t%d\t%22.17lf\t%24.18lf\t%24.18lf\t%-6d\t%-28s\t",j,k1,k2,ULP, best, creal(computedX),cimag(computedX),cpu_id,amino);

      
      time_t now = time (0);
      strftime (timestamp, 26, "%Y-%m-%d %H:%M:%S.000", localtime (&now));
      fprintf(search_log_file, "%s\t", timestamp);
      print_code_mathematica(amino,K,RPN_full_Code);
      fprintf(search_log_file,"{%s}\n",RPN_full_Code);



	 }
  
	 if(best<=16*DBL_EPSILON) //jezeli znalazl, wychodzi z petli i zapisuje plik dla innych procesow
	 {
		  
          printf("\nConstant recognized by thread %d:\tError in $MachineEps=%le\tCode number=%llu\tSHORT CODE:\t%s\n",cpu_id, best/DBL_EPSILON,j,amino);

          ULP = compute_ULP_distance(computedX, targetX);

          printf("Total valid formulae [all codes] tested by thread %d:\t%llu [%llu]\n",cpu_id,k2,k1);
          printf("Minimal error in ULP=%d\n", ULP );

	      printf("Re=%.18lf\n",creal(computedX));
	      printf("Im=%.18lf\n",cimag(computedX));
	      
          
          print_code_mathematica(amino,K,RPN_full_Code);
          printf("RPN CODE:\t{%s}\t",RPN_full_Code);
	      printf("\n\n");

          omp_cancel_flag = 1;
		  flagfile = fopen("found.txt","w");
          fprintf(flagfile, "%d", omp_cancel_flag);
          fclose(flagfile);
          fclose(search_log_file);

		  exit(0);//break;
     }

    
	
  }
  
  
  printf("END of search for thread %d\n\n", cpu_id);
  fclose(search_log_file);

return 0;

}