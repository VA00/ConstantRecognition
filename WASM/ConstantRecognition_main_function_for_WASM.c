/* Andrzej Odrzywolek, 03.01.2024, andrzej.odrzywolek@uj.edu.pl */
#include "ConstantRecognition_function2_for_WASM.c"



int main(int argc, char** argv)
{


  double z;
  int depth,cpu_id,ncpus;

  if(!(argv[1]==NULL))
  {
    sscanf(argv[1],"%lf", &z);
    sscanf(argv[2],"%d" , &depth);
    sscanf(argv[3],"%d",&cpu_id);
    sscanf(argv[4],"%d",&ncpus);
  }

  printf("%s\n",search_RPN(z, 0.0, 1, depth,cpu_id,ncpus));
}
