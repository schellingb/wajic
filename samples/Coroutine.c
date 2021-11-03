/*
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org/>
*/

#include <wajic.h>
#include <stdio.h>
#define WA_CORO_IMPLEMENT_NANOSLEEP
#include <wajic_coro.h>
#include <time.h>

WaCoro coroSub;

WA_EXPORT(FuncCoro) int FuncCoro(void* data)
{
	printf("[CORO] One\n");
	WaCoroSwitch(NULL);
	printf("[CORO] Two Sleep ...\n");
	WaCoroSleep(1000);
	printf("[CORO] Two Done Sleeping\n");
	WaCoroSwitch(NULL);
	printf("[CORO] Three\n");
	WaCoroSwitch(NULL); // last switch back to main
	printf("[CORO] Should never arrive here\n");
	return 0;
}

// This function is called at startup
int main(int argc, const char* argv[])
{
	coroSub = WaCoroInitNew(FuncCoro, "FuncCoro", 0, 0);
	printf("[MAIN] One\n");
	WaCoroSwitch(coroSub);
	printf("[MAIN] Two\n");
	WaCoroSwitch(coroSub);
	printf("[MAIN] Three Sleep ...\n");
	WaCoroSleep(1000);
	printf("[MAIN] Three Done Sleeping\n");
	WaCoroSwitch(coroSub);
	printf("[MAIN] Four\n");
	printf("[MAIN] Hello - coroSub: %p\n", coroSub);
	printf("[MAIN] Free coroSub: %p\n", coroSub);
	WaCoroFree(coroSub);

	struct timespec t;
	clock_gettime( CLOCK_MONOTONIC_RAW, &t );
	printf("[MAIN] Time %d: %d %d\n", (int)CLOCK_MONOTONIC_RAW, (int)t.tv_sec, (int)t.tv_nsec);

	printf("[MAIN] Sleep 11 milliseconds...\n");
	WaCoroSleep(11);
	printf("[MAIN] Done!\n");

	clock_gettime( CLOCK_MONOTONIC_RAW, &t );
	printf("[MAIN] Time %d: %d %d\n", (int)CLOCK_MONOTONIC_RAW, (int)t.tv_sec, (int)t.tv_nsec);

	printf("[MAIN] Sleep 1 millisecond...\n");
	t.tv_sec = 0;
	t.tv_nsec = 1000000;
	nanosleep(&t, NULL);
	printf("[MAIN] Done!\n");

	clock_gettime( CLOCK_MONOTONIC_RAW, &t );
	printf("[MAIN] Time %d: %d %d\n", (int)CLOCK_MONOTONIC_RAW, (int)t.tv_sec, (int)t.tv_nsec);
}
