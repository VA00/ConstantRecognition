/* Andrzej Odrzywolek, 03.01.2024, andrzej.odrzywolek@uj.edu.pl */
#include "ConstantRecognition_function_for_WASM.c"



int main(int argc, char** argv)
{


  double z;
  int depth;

  if(!(argv[1]==NULL))
  {
    sscanf(argv[1],"%lf", &z);
    sscanf(argv[2],"%d" , &depth);
  }

  printf("%s\n",search_RPN(z,depth));
}
