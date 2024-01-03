/* Andrzej Odrzywolek, 03.01.2024, andrzej.odrzywolek@uj.edu.pl */
#include "ConstantRecognition_function_for_WASM.c"

#ifdef USE_COMPLEX
  #define NUM_TYPE double complex
#else
  #define NUM_TYPE double
#endif


int main(int argc, char** argv)
{


  double z;

  if(!(argv[1]==NULL))
  {
    sscanf(argv[1],"%lf", &z);
  }

  printf("%s\n",search_RPN(z));
}
