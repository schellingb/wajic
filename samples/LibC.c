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

#include <stdio.h>
#include <stdlib.h>
#include <wajic.h>

// Create a JavaScript function that writes to the wa_log div
WAJIC(void, direct_print, (const char* pstr),
{
	document.getElementById('wa_log').innerHTML += MStrGet(pstr).replace(/\n/g, '<br>');
})

// Create a JavaScript function that writes the content of document.location.href into the wasm memory
WAJIC(int, get_document_location, (const char* pstr, int len),
{
	return MStrPut(document.location.href, pstr, len)
})

// Create a JavaScript function that allocates memory with a string
WAJIC(char*, malloc_document_title, (),
{
	return MStrPut(document.title)
})

int main(int argc, char *argv[])
{
	char buf[256];
	int bufret;
	char* title;

	printf("main - arg count: %d - first arg: '%s'\n\n", argc, argv[0]);

	printf("Printing through printf\n\n");

	direct_print("Printing directly through WAJIC\n\n");

	printf("Requesting string document.location from JavaScript...\n");
	bufret = get_document_location(buf, sizeof(buf));
	printf("Got document.location: %s (len: %d)\n\n", buf, bufret);

	printf("Requesting string document.title from JavaScript...\n");
	title = malloc_document_title();
	printf("Got document.title: %s\n", title);
	free(title);

	return 0;
}
