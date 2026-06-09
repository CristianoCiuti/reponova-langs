/**
 * Tiny greeter — used as the lang-c "simple" fixture.
 */
#include <stdio.h>
#include "greeter.h"

/**
 * Print "Hello, <name>!" to stdout.
 */
void greet(const char* name) {
  printf("Hello, %s!\n", name);
}

int main(int argc, char** argv) {
  const char* who = argc > 1 ? argv[1] : "world";
  greet(who);
  return 0;
}
