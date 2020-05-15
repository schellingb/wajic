/*
  WAjic - WebAssembly JavaScript Interface Creator
  Copyright (C) 2020 Bernhard Schelling

  This software is provided 'as-is', without any express or implied
  warranty.  In no event will the authors be held liable for any damages
  arising from the use of this software.

  Permission is granted to anyone to use this software for any purpose,
  including commercial applications, and to alter it and redistribute it
  freely, subject to the following restrictions:

  1. The origin of this software must not be misrepresented; you must not
     claim that you wrote the original software. If you use this software
     in a product, an acknowledgment in the product documentation would be
     appreciated but is not required.
  2. Altered source versions must be plainly marked as such, and must not be
     misrepresented as being the original software.
  3. This notice may not be removed or altered from any source distribution.
*/

"use strict";var WA = WA||{};(function(){

// Define print and error functions if not yet defined by the outer html file
var print = WA.print || (WA.print = msg => console.log(msg.replace(/\n$/, '')));
var error = WA.error || (WA.error = (code, msg) => print('[ERROR] ' + code + ': ' + msg + '\n'));

// Some global state variables and max heap definition
var WM, ASM, MEM, MU8, MU16, MU32, MI32, MF32;
var WASM_HEAP, WASM_HEAP_MAX = (WA.maxmem||256*1024*1024); //default max 256MB

// A generic abort function that if called stops the execution of the program and shows an error
var STOP, abort = WA.abort = function(code, msg)
{
	STOP = true;
	error(code, msg);
	throw 'abort';
};

// Puts a string from JavaScript onto the wasm memory heap (encoded as UTF8)
var MStrPut = function(str, ptr, buf_size)
{
	if (buf_size === 0) return 0;
	var buf = new TextEncoder().encode(str), bufLen = buf.length, out = (ptr||ASM.malloc(bufLen+1));
	if (buf_size && bufLen >= buf_size)
		for (bufLen = buf_size - 1; (buf[bufLen] & 0xC0) == 0x80; bufLen--);
	MU8.set(buf.subarray(0, bufLen), out);
	MU8[out + bufLen] = 0;
	return (ptr ? bufLen : out);
};

// Reads a string from the wasm memory heap to JavaScript (decoded as UTF8)
var MStrGet = function(ptr, length)
{
	if (length === 0 || !ptr) return '';
	if (!length) { for (length = 0; length != ptr+MU8.length && MU8[ptr+length]; length++); }
	return new TextDecoder().decode(MU8.subarray(ptr, ptr+length));
};

// Copy a JavaScript array to the wasm memory heap
var MArrPut = function(a)
{
	var len = a.byteLength || a.length, ptr = len && ASM.malloc(len);
	MU8.set(a, ptr);
	return ptr;
}

// Set the array views of various data types used to read/write to the wasm memory from JavaScript
var MSetViews = function()
{
	var buf = MEM.buffer;
	MU8 = new Uint8Array(buf);
	MU16 = new Uint16Array(buf);
	MU32 = new Uint32Array(buf);
	MI32 = new Int32Array(buf);
	MF32 = new Float32Array(buf);
};

// If WA.module has not been defined, try to load a file (if running with node) or use a data attribute on the script tag
var load = WA.module;
if (!load)
{
	if ((typeof process)[0]=='o') load = require('fs').readFileSync(process.argv[2]);
	else load = document.currentScript.getAttribute('data-wasm')
}

// Fetch the .wasm file (or use a byte buffer in WA.module directly) and compile the wasm module
((typeof load)[0]=='s' ? fetch(load).then(r => r.arrayBuffer()) : new Promise(r => r(load))).then(wasmBuf => WebAssembly.compile(wasmBuf).then(module =>
{
	var emptyFunction = () => 0;
	var crashFunction = (msg) => abort('CRASH', msg);

	// Set up the import objects that contains the functions passed to the wasm module
	var J = {}, env =
	{
		// sbrk gets called to increase the size of the memory heap by an increment
		sbrk: function(increment)
		{
			var heapOld = WASM_HEAP, heapNew = heapOld + increment, heapGrow = heapNew - MEM.buffer.byteLength;
			//console.log('[SBRK] Increment: ' + increment + ' - HEAP: ' + heapOld + ' -> ' + heapNew + (heapGrow > 0 ? ' - GROW BY ' + heapGrow + ' (' + (heapGrow>>16) + ' pages)' : ''));
			if (heapNew > WASM_HEAP_MAX) abort('MEM', 'Out of memory');
			if (heapGrow > 0) { MEM.grow((heapGrow+65535)>>16); MSetViews(); }
			WASM_HEAP = heapNew;
			return heapOld;
		},

		// Functions querying the system time
		time: function(ptr) { var ret = (Date.now()/1000)|0; if (ptr) MU32[ptr>>2] = ret; return ret; },
		gettimeofday: function(ptr) { var now = Date.now(); MU32[ptr>>2]=(now/1000)|0; MU32[(ptr+4)>>2]=((now % 1000)*1000)|0; },

		// Failed assert will abort the program
		__assert_fail: (condition, filename, line, func) => crashFunction('assert ' + MStrGet(condition) + ' at: ' + (filename ? MStrGet(filename) : '?'), line, (func ? MStrGet(func) : '?')),
	};
	var imports = { env:env, J:J };

	// Go through all the imports to fill out the list of functions
	var evals = {}, N = {};
	WebAssembly.Module.imports(module).forEach(i =>
	{
		var mod = i.module, fld = i.name, knd = i.kind[0], obj = (imports[mod] || (imports[mod] = {}));
		if (knd == 'm')
		{
			// This WASM module wants to import memory from JavaScript
			// The only way to find out how much it wants initially is to parse the module binary stream
			// This code goes through the wasm file sections according the binary encoding description
			//     https://webassembly.org/docs/binary-encoding/
			for (let wasm = new Uint8Array(wasmBuf), i = 8, iMax = wasm.length, iSectionEnd, type, len, j, Get; i < iMax; i = iSectionEnd)
			{
				// Get() gets a LEB128 variable-length number optionally skipping some bytes before
				Get = s=>{i+=s|0;for(var b,r,x=0;r|=((b=wasm[i++])&127)<<x,b>>7;x+=7);return r};
				type = Get(), len = Get(), iSectionEnd = i + len;
				if (type < 0 || type > 11 || len <= 0 || iSectionEnd > iMax) break;
				//Section 2 'Imports' contains the memory import which describes the initial memory size
				if (type == 2)
					for (len = Get(), j = 0; j != len && i < iSectionEnd; j++,(1==type&&Get(1)&&Get()),(2>type&&Get()),(3==type&&Get(1)))
						if ((type = Get(Get(Get()))) == 2)
						{
							// Set the initial heap size and allocate the wasm memory (can be grown with sbrk)
							MEM = obj[fld] = new WebAssembly.Memory({initial: Get(1)});
							i = iSectionEnd = iMax;
						}
			}
		}
		if (knd == 'f')
		{
			//only parse functions below
			if (obj == J)
			{
				// JavaScript functions can be generated by the compiled code (with #WAJIC), their code is embedded in the field name
				let [JSName, JSArgs, JSCode, JSLib, JSInit] = fld.split('\x11');
				if (!JSCode && !JSInit) return;
				if (!JSLib) JSLib = '';
				if (!evals[JSLib]) evals[JSLib] = '';

				// strip C types out of params list (change '(float p1[20], unsigned int* p2[])' to 'p1,p2' (function pointers not supported)
				JSArgs = JSArgs.replace(/^\(\s*void\s*\)$|^\(|\[.*?\]|(=|WA_ARG\()[^,]+|\)$/g, '').replace(/.*?(\w+)\s*(,|$)/g, '$1$2');

				// Prepare functions for wasm module (and remove brackets around init code)
				evals[JSLib] += 
					(JSInit||'').replace(/^\(?\s*|\s*\)$/g, '') +
					"J[N." + JSName + "]=(" + JSArgs + ")=>" + JSCode + ";";
				N[JSName] = fld;
			}
			if (obj == env && !env[fld])
			{
				// First try to find a matching math function, then if the field name matches an aborting call pass a crash function
				// Otherwise pass empty function for things that do nothing in this wasm context (setjmp, __cxa_atexit, __lock, __unlock)
				obj[fld] = (Math[fld.replace(/^f?([^l].*?)f?$/, '$1').replace(/^rint$/,'round')]
					|| (fld.match(/uncaught_excep|pure_virt|^abort$|^longjmp$/) && (() => crashFunction(fld)))
					|| emptyFunction);
				if (env[fld] == emptyFunction) console.log("[WASM] Importing empty function for env." + fld);
			}
			if (mod.includes('wasi'))
			{
				// WASI (WebAssembly System Interface) can have varying module names (wasi_unstable/wasi_snapshot_preview1/wasi)
				obj[fld] = (fld.includes('write') ?
					function(fd, iov, iovcnt, pOutResult)
					{
						// The fd_write function can only be used to write strings to stdout in this wasm context
						iov >>= 2;
						for (var ret = 0, str = '', i = 0; i < iovcnt; i++)
						{
							// Process list of IO commands, read passed strings from heap
							var ptr = MU32[iov++], len = MI32[iov++];
							if (len < 0) return -1;
							ret += len;
							str += MStrGet(ptr, len);
							//console.log('fd_write - fd: ' + fd + ' - ['+i+'][len:'+len+']: ' + MStrGet(ptr, len).replace(/\n/g, '\\n'));
						}

						// Print the passed string and write the number of bytes read to the result pointer
						print(str);
						MU32[pOutResult>>2] = ret;
						return 0; // no error
					}
					// All other IO functions are not emulated so pass empty dummies (fd_read, fd_seek, fd_close)
					: emptyFunction);
			}
		}
	});

	// Expose functions generated by the compiled code (with #WAJIC) to wasm
	for (var JSLib in evals)
	{
		// Character sequences in regular expression can contain some that need to be escaped (regex with \ is better coded in string form)
		try { (() => eval(evals[JSLib].replace(/[\0-\37]/g, m=>"\\x"+escape(m).slice(1))))(); }
		catch (err) { abort('BOOT', 'Error in #WAJIC function: ' + err + '(' + evals[JSLib] + ')'); }
	}

	// Store the module reference in WA.wm
	WA.wm = WM = module;

	// Instantiate the wasm module by passing the prepared import functions for the wasm module
	return WebAssembly.instantiate(module, imports);
}))
.then(function (instance)
{
	// Store the list of the functions exported by the wasm module in WA.asm
	WA.asm = ASM = instance.exports;

	var memory = ASM.memory, wasm_call_ctors = ASM.__wasm_call_ctors, main = ASM.main || ASM.__main_argc_argv, mainvoid = ASM.__original_main || ASM.__main_void, malloc = ASM.malloc, WajicMain = ASM.WajicMain, started = WA.started;

	if (memory)
	{
		// Get the wasm memory object from the module (can be grown with sbrk)
		MEM = memory;
	}

	if (MEM)
	{
		// Setup the array memory views and get the initial memory size
		MSetViews();
		WASM_HEAP = MU8.length;
	}

	// If function '__wasm_call_ctors' (global C++ constructors) exists, call it
	if (wasm_call_ctors) wasm_call_ctors();

	// If function 'main' exists, call it
	if (main && malloc)
	{
		// Allocate 10 bytes of memory to store the argument list with 1 entry to pass to main
		var ptr = malloc(10);

		// Place executable name string "W" after the argv list
		MU8[ptr+8] = 87;
		MU8[ptr+9] = 0;

		// argv[0] contains the pointer to the executable name string, argv[1] has a list terminating null pointer
		MU32[(ptr    )>>2] = (ptr + 8)
		MU32[(ptr + 4)>>2] = 0;

		main(1, ptr);
	}
	else if (main)
	{
		// Call the main function with zero arguments
		main(0, 0);
	}
	if (mainvoid)
	{
		// Call the main function without arguments
		mainvoid();
	}

	// If function 'WajicMain' exists, call it
	if (WajicMain) WajicMain();

	// If the outer HTML file supplied a 'started' callback, call it
	if (started) started();
})
.catch(err =>
{
	// On an exception, if the err is 'abort' the error was already processed in the abort function above
	if (err !== 'abort') WA.error('BOOT', 'WASM instiantate error: ' + err + (err.stack ? "\n" + err.stack : ''));
})})();
