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

#include <math.h>
#include <wajic.h>
#include <wajic_gl.h>

WAJIC(void, JSSetupCanvas, (int width, int height),
{
	var canvas = WA.canvas;
	canvas.width = width;
	canvas.height = height;

	var getDateNow = () => Date.now(), startTime = getDateNow();
	var wafnDraw = ASM.WAFNDraw;
	var drawFunc = function() { if (STOP) return; window.requestAnimationFrame(drawFunc); wafnDraw(getDateNow() - startTime); };
	window.requestAnimationFrame(drawFunc);
})

static const char* vertex_shader_text =
	"precision lowp float;"
	"uniform mat4 uMVP;"
	"attribute vec4 aPos;"
	"attribute vec3 aCol;"
	"varying vec3 vCol;"
	"void main()"
	"{"
		"vCol = aCol;"
		"gl_Position = uMVP * aPos;"
	"}";

static const char* fragment_shader_text =
	"precision lowp float;"
	"varying vec3 vCol;"
	"void main()"
	"{"
		"gl_FragColor = vec4(vCol, 1.0);"
	"}";

typedef struct Vertex { float x, y, r, g, b; } Vertex;
static GLuint program, vertex_buffer;
static GLint uMVP_location, aPos_location, aCol_location;

// This function is called at startup
int main(int argc, char *argv[])
{
	JSSetupCanvas(1280, 720);
	glSetupCanvasContext(1, 0, 0, 0);
	glViewport(0, 0, 1280, 720);

	GLuint vertex_shader = glCreateShader(GL_VERTEX_SHADER);
	glShaderSource(vertex_shader, 1, &vertex_shader_text, NULL);
	glCompileShader(vertex_shader);

	GLuint fragment_shader = glCreateShader(GL_FRAGMENT_SHADER);
	glShaderSource(fragment_shader, 1, &fragment_shader_text, NULL);
	glCompileShader(fragment_shader);

	program = glCreateProgram();
	glAttachShader(program, vertex_shader);
	glAttachShader(program, fragment_shader);
	glLinkProgram(program);

	uMVP_location = glGetUniformLocation(program, "uMVP");
	aPos_location = glGetAttribLocation(program, "aPos");
	aCol_location = glGetAttribLocation(program, "aCol");

	glGenBuffers(1, &vertex_buffer);
	glBindBuffer(GL_ARRAY_BUFFER, vertex_buffer);

	glEnableVertexAttribArray(aPos_location);
	glVertexAttribPointer(aPos_location, 2, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)0);
	glEnableVertexAttribArray(aCol_location);
	glVertexAttribPointer(aCol_location, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)(sizeof(float) * 2));

	return 0;
}

// This function is called every frame (set up in JSSetupCanvas)
WA_EXPORT(WAFNDraw) void WAFNDraw(int t)
{
	float f = ((t % 1000) / 1000.0f);

	glClear(GL_COLOR_BUFFER_BIT);

	Vertex vertices[3] =
	{
		{ -0.6f, -0.4f, 1.f, 0.f, 0.f },
		{  0.6f, -0.4f, 0.f, 0.f, 1.f },
		{   0.f,  0.6f, 1.f, 1.f, 1.f },
	};
	vertices[0].r = 0.5f + sinf(f * 3.14159f * 2.0f) * 0.5f;
	vertices[1].b = 0.5f + cosf(f * 3.14159f * 2.0f) * 0.5f;
	glBindBuffer(GL_ARRAY_BUFFER, vertex_buffer);
	glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);

	GLfloat mvp[4*4] = { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1 };
	glUseProgram(program);
	glUniformMatrix4fv(uMVP_location, 1, GL_FALSE, mvp);
	glDrawArrays(GL_TRIANGLES, 0, 3);
}
