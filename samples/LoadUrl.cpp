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
#include <wajic.h>
#include <wajic_file.h>

// This function is called when the HTTP request finishes (or has an error)
WA_EXPORT(MyFinishCallback) void MyFinishCallback(int status, char* data, unsigned int length, void* userdata)
{
	printf("Received response - status: %d - length: %u - data: '%.3s...' - userdata: %p\n", status, length, data + 1, userdata);
}

// This function is called periodically with download progress updates until download is complete
WA_EXPORT(MyProgressCallback) void MyProgressCallback(unsigned int loaded, unsigned int total, void* userdata)
{
	printf("Progress - loaded: %u - total: %u - userdata: %p\n", loaded, total, userdata);
}

// This function is called at startup
WA_EXPORT(WajicMain) void WajicMain()
{
	const char* url = "http://zillalib.github.io/tutorials/01-project-generator.png";
	printf("Requesting url '%s' ...\n", url);
	WaFileLoadUrl("MyFinishCallback", url, (void*)0x1234, "MyProgressCallback");
	printf("Sent async request, waiting for response\n");
}
