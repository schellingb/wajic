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

#include <string>
#include <vector>
#include <stdio.h>
#include <wajic.h>

// Create a global object with a constructor
static struct GlobalObject
{
	GlobalObject()
	{
		printf("In the global object constructor\n\n");
	}
} gGlobalObject;

// Create a JavaScript function with C++ default arguments
WAJIC(void, numbers, (int x = 10, int y = 20, int z = 30),
{
	WA.print('Got numbers - X: ' + x + ' - Y: ' + y + ' - Z: ' + z + '\n');
})

int main(int argc, char *argv[])
{
	std::string string = "Hello C++";
	string += " World";
	printf("%s\n\n", string.c_str());

	std::vector<int> vec;
	vec.push_back(1);
	vec.push_back(2);
	vec.push_back(3);
	vec.erase(vec.begin() + 1);
	for (int i : vec)
		printf("Vector element: %d\n", i);
	printf("\n");

	int* ptr = new int;
	printf("Allocated memory with new at %p\n\n", ptr);
	delete ptr;

	numbers(7);

	return 0;
}
