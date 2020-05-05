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

// This JavaScript function sets up input capturing
WAJIC(void, WASetup, (),
{
	var canvas = WA.canvas;
	canvas.style.width = (canvas.width = 32) + 'px';
	canvas.style.height = (canvas.height = 24) + 'px';
	canvas.style.background = 'green';

	var cancelEvent = function(e) { if (e.preventDefault) e.preventDefault(true); else if (e.stopPropagation) e.stopPropagation(true); else e.stopped = true; };
	var windowEvent = function(t, f) { window.addEventListener(t, f, true); };
	var canvasEvent = function(t, f) { canvas.addEventListener(t, f, {capture:true,passive:false}); };
	windowEvent('keydown', function(e)
	{
		ASM.WAFNKey(true, e.keyCode);
		if (e.key.length == 1) ASM.WAFNText(e.key.charCodeAt());
		cancelEvent(e);
	});
	windowEvent('keyup', function(e)
	{
		ASM.WAFNKey(false, e.keyCode);
		cancelEvent(e);
	});
	canvasEvent('mousemove', function(e)
	{
		ASM.WAFNMouseMove(e.offsetX * canvas.width / canvas.clientWidth , e.offsetY * canvas.height / canvas.clientHeight);
		cancelEvent(e);
	});
	var buttons = 0;
	canvasEvent('mousedown', function(e)
	{
		var btn = (1<<e.button);
		if (buttons & btn) return;
		buttons |= btn;
		ASM.WAFNMouseButton(e.button, true);
		cancelEvent(e);
	});
	windowEvent('mouseup', function(e)
	{
		var btn = (1<<e.button);
		if (!(buttons & btn)) return;
		buttons &= ~btn;
		ASM.WAFNMouseButton(e.button, false);
		cancelEvent(e);
	});
	canvasEvent('wheel',          function(e) { ASM.WAFNMouseWheel(e.deltaX, e.deltaY); cancelEvent(e); });
	canvasEvent('DOMMouseScroll', function(e) { ASM.WAFNMouseWheel(-e.detail*40);       cancelEvent(e); });
	windowEvent('focus',          function(e) { ASM.WAFNFocus(1); });
	windowEvent('blur',           function(e) { ASM.WAFNFocus(0); });
})

WA_EXPORT(WajicMain) void WajicMain()
{
	printf("Setting up mouse/keyboard events\n");
	WASetup();
}

WA_EXPORT(WAFNKey) void WAFNKey(int is_down, int key_code)
{
	printf("Key Input: %d %s\n", key_code, (is_down ? "down" : "up"));
}

WA_EXPORT(WAFNText) void WAFNText(unsigned int code)
{
	printf("Text input: %c (code %u)\n", (code >= ' ' && code <= '~' ? (char)code : '?'), code);
}

WA_EXPORT(WAFNMouseButton) void WAFNMouseButton(int button, int is_down)
{
	printf("Mouse Button: %d %s\n", button, (is_down ? "down" : "up"));
}

WA_EXPORT(WAFNFocus) void WAFNFocus(int focused)
{
	printf("Focused: %s\n", (focused ? "True" : "False"));
}

WA_EXPORT(WAFNMouseMove) void WAFNMouseMove(int x, int y)
{
	printf("Mouse: %d , %d\n", x, y);
}

WA_EXPORT(WAFNMouseWheel) void WAFNMouseWheel(float deltax, float deltay)
{
	printf("Mouse Wheel: X: %f - Y: %f\n", deltax, deltay);
}
