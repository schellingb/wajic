/*
  WAjicUp - WebAssembly JavaScript Interface Creator Utility Program
  Copyright (C) 2020 Bernhard Schelling

  Uses Terser JavaScript compressor (https://github.com/terser/terser)
  Terser is based on UglifyJS (https://github.com/mishoo/UglifyJS2)
  UglifyJS Copyright 2012-2018 (c) Mihai Bazon <mihai.bazon@gmail.com>
  UglifyJS parser is based on parse-js (http://marijn.haverbeke.nl/parse-js/).
  License for Terser can be found at the bottom of this file.

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

'use strict';

var terser, verbose = false;

var VERBOSE = function(msg)
{
	if (verbose) console.log(msg);
};

var WARN = function(msg)
{
	console.warn('[WARNING] ' + msg);
};

function ABORT(msg, e, code)
{
	if (e && typeof e == 'string') msg += "\n" + e;
	if (e && typeof e == 'object') msg += "\n" + (e.name||'') + (e.message ? ' - ' + e.message : '') + (e.line ? ' - Line: ' + e.line : '') + (e.col ? ' - Col: ' + e.col : '');
	if (code && e && e.line)
	{
		msg += "\n";
		var lines = code.split(/\n/), errcol = e.col||0;;
		for (var i = (e.line < 4 ? 1 : e.line - 3), iMax = (e.line + 3); i != iMax && i <= lines.length; i++)
		{
			var line = lines[i-1], col = (i == e.line ? Math.max(0, Math.min(line.length - 80, errcol - 40)) : 0);
			msg += "\n" + ('     '+i).slice(-5) + ': ' + (col ? '...' : '') + line.substr(col, 80) + (line.length - col > 80 ? '...' : '');
			if (i == e.line && e.col) msg += "\n" + ' '.repeat(errcol + (col ? 10 - col : 7)) + '^';
		}
	}
	if (typeof process !== 'object') throw msg; //throw if not CLI with node
	console.error('');
	console.error('[ERROR]');
	console.error(msg)
	console.error('');
	console.error('aborting');
	console.error('');
	throw process.exit(1);
}

// Execute CLI if running with node
if (typeof process === 'object') (function()
{
	var args = process.argv.slice(2);

	function ArgErr(err)
	{
		console.error('');
		console.error('WAjicUp - WebAssembly JavaScript Interface Creator Utility Program');
		console.error('');
		console.error('Error:');
		console.error(err);
		console.error('');
		console.error('For help, run: ' + process.argv[0] + ' ' + process.argv[1] + ' -h');
		console.error('');
		throw process.exit(1);
	}

	function ShowHelp()
	{
		console.error('');
		console.error('WAjicUp - WebAssembly JavaScript Interface Creator Utility Program');
		console.error('');
		console.error('Usage wajicup.js [<switches>...] <input_file> [<output_files>...]');
		console.error('');
		console.error('<input_file> must be an unprocessed .wasm file');
		console.error('');
		console.error('<output_files> can be up to 3 files of different types');
		console.error('  .wasm: Minified/reduced wasm module');
		console.error('  .js:   JavaScript loader with interface embedded');
		console.error('  .html: HTML frontend');
		console.error('');
		console.error('  Possible file combinations:');
		console.error('   [WASM]             Minify functions inside WASM');
		console.error('   [WASM] [JS]        Move functions from WASM to JS');
		console.error('   [WASM] [JS] [HTML] Move functions from WASM to JS and generate HTML');
		console.error('   [WASM] [HTML]      Minify in WASM and create HTML with embedded loader');
		console.error('   [JS]               Embed and merge WASM into JS');
		console.error('   [JS] [HTML]        Embed WASM into JS and generate HTML');
		console.error('   [HTML]             Embed WASM into single file HTML');
		console.error('');
		console.error('<switches>');
		console.error('  -no_minify:  Don\'t minify JavaScript code');
		console.error('  -no_log:     Remove all output logging');
		console.error('  -streaming:  Enable WASM streaming (needs web server support, new browser)');
		console.error('  -rle:        Use RLE compression when embedding the WASM file');
		console.error('  -loadbar:    Add a loading progress bar to the generated HTML');
		console.error('  -node:       Output JavaScript that runs in Node.js (CLI)');
		console.error('  -embed N P:  Embed data file at path P with name N');
		console.error('  -gzipreport: Report the output size after gzip compression');
		console.error('  -v:          Be verbose about processed functions');
		console.error('  -h:          Show this help');
		console.error('');
		throw process.exit(0);
	}

	var fs = require('fs'), saveCount = 0, saveTotal = 0, gzipTotal = 0, gzipReport = false;

	function Load(path)
	{
		if (!path) return ABORT('Missing file path argument');
		try { var buf = fs.readFileSync(path); } catch (e) { return ABORT('Failed to load file: ' + path, e); }
		console.log('  [LOADED] ' + path + ' (' + buf.length + ' bytes)');
		return new Uint8Array(buf);
	}

	function GZipReport(buf)
	{
		var gzip = require('zlib').gzipSync(buf).length;
		gzipTotal += gzip;
		return ' (' + gzip + ' gzipped)';
	}

	function Save(path, buf)
	{
		try { fs.writeFileSync(path, buf); } catch (e) { return ABORT('Failed to save file: ' + path, e); }
		saveCount++;
		saveTotal += buf.length;
		console.log('  [SAVED] ' + path + ' (' + buf.length + ' bytes)' + (gzipReport ? GZipReport(buf) : ''));
	}

	function PathRelatedTo(srcPath, trgPath, isDirectory)
	{
		var path = require('path');
		var dir = path.relative(path.dirname(srcPath + (isDirectory ? '/X' : '')), path.dirname(trgPath + (isDirectory ? '/X' : '')));
		return (dir ? dir.replace(/\\/g, '/') + '/' : '') + (isDirectory ? (dir ? '' : './') : (path.basename(trgPath)));
	}

	var p = { minify: true, log: true, embeds: {} }, inBytes, cfiles = [], cc = '', ld = '', outWasmPath, outJsPath, outHtmlPath;
	for (var i = 0; i != args.length;)
	{
		var arg = args[i++];
		if (arg.match(/^-?\/?(help|h|\?)$/i))  { return ShowHelp(); }
		if (arg.match(/^-?\/?no_?-?minify$/i)) { p.minify    = false; continue; }
		if (arg.match(/^-?\/?no_?-?log$/i))    { p.log       = false; continue; }
		if (arg.match(/^-?\/?streaming$/i))    { p.streaming = true;  continue; }
		if (arg.match(/^-?\/?rle$/i))          { p.rle       = true;  continue; }
		if (arg.match(/^-?\/?loadbar$/i))      { p.loadbar   = true;  continue; }
		if (arg.match(/^-?\/?node$/i))         { p.node      = true;  continue; }
		if (arg.match(/^-?\/?gzipreport$/i))   { gzipReport  = true;  continue; }
		if (arg.match(/^-?\/?(v|verbose)$/i))  { verbose     = true;  continue; }
		if (arg.match(/^-?\/?embed$/i))        { p.embeds[args[i]] = Load(args[i+1]); i += 2; continue; }
		if (arg.match(/^-?\/?cc$/i))           { cc += ' '+args[i++]; continue; }
		if (arg.match(/^-?\/?ld$/i))           { ld += ' '+args[i++]; continue; }
		if (arg.match(/^-/)) return ArgErr('Invalid argument: ' + arg);

		var path = arg.match(/^.*\.(wasm|js|html|c|cpp|cc|cxx?)$/i), ext = (path && path[1][0].toUpperCase());
		if (ext == 'C')
		{
			cfiles.push(arg);
		}
		else if (!inBytes && cfiles.length == 0)
		{
			if (ext == 'W' || ext == 'J') inBytes = Load(arg);
			else return ArgErr('Invalid input file: ' + arg + "\n" + 'Must be a file ending with .wasm');
		}
		else
		{
			if      (ext == 'W') { if (!outWasmPath) outWasmPath = arg; else return ArgErr('Invalid output file: ' + arg + "\n" + 'Cannot output multiple .wasm files'); }
			else if (ext == 'J') { if (!outJsPath  ) outJsPath   = arg; else return ArgErr('Invalid output file: ' + arg + "\n" + 'Cannot output multiple .js files');   }
			else if (ext == 'H') { if (!outHtmlPath) outHtmlPath = arg; else return ArgErr('Invalid output file: ' + arg + "\n" + 'Cannot output multiple .html files'); }
			else return ArgErr('Invalid output file: ' + arg + "\n" + 'Must be a file ending with .wasm/.js/.html');
		}
	}

	// Validate options
	if (!inBytes && !cfiles.length) return ArgErr('Missing input file and output file(s)');
	if (!outWasmPath && !outJsPath && !outHtmlPath) return ArgErr('Missing output file(s)');
	if (cfiles.length || IsWasmFile(inBytes))
	{
		if ( outWasmPath && p.streaming) return ArgErr('When outputting just a .wasm file, option -streaming is invalid');
		if ( outWasmPath && p.node)      return ArgErr('When outputting just a .wasm file, option -node is invalid');
		if ( outWasmPath && p.rle)       return ArgErr('When outputting a .wasm file, option -rle is invalid');
		if (!outWasmPath && p.streaming) return ArgErr('When embedding the .wasm file, option -streaming is invalid');
		if ( outHtmlPath && p.node)      return ArgErr('When generating the .html file, option -node is invalid');
		if (!outHtmlPath && p.loadbar)   return ArgErr('When not generating the .html file, option -loadbar is invalid');
		if (!outJsPath && !outWasmPath && p.loadbar) return ArgErr('With just a single output file, option -loadbar is invalid');
	}
	else
	{
		if (!outJsPath || outWasmPath || outHtmlPath) return ArgErr('When minifying a JS file, only one output file ending with .js is supported');
		if (!p.minify)   return ArgErr('When processing a .js file, minify must be enabled');
		if (p.streaming) return ArgErr('When processing a .js file, option -streaming is invalid');
		if (p.rle)       return ArgErr('When processing a .js file, option -rle is invalid');
		if (p.embeds && Object.keys(p.embeds).length) return ArgErr('When processing a .js file, option -embed is invalid');
	}

	// Experimental compile C files to WASM directly
	if (cfiles.length)
	{
		const pathToWajic = PathRelatedTo(process.cwd(), __dirname, true), pathToSystem = pathToWajic + 'system/';
		inBytes = ExperimentalCompileWasm(p, outWasmPath, cfiles, cc, ld, pathToWajic, pathToSystem);
	}

	// Calculate relative paths (HTML -> JS -> WASM)
	p.wasmPath = (outWasmPath ? (outHtmlPath || outJsPath ? PathRelatedTo(outHtmlPath || outJsPath, outWasmPath) : outWasmPath) : undefined);
	p.jsPath   = (outJsPath   ? (outHtmlPath              ? PathRelatedTo(outHtmlPath,                outJsPath) :   outJsPath) : undefined);
	p.htmlPath = outHtmlPath;

	var [wasmOut, jsOut, htmlOut] = ProcessFile(inBytes, p);
	if (wasmOut) Save(outWasmPath, wasmOut);
	if (jsOut)   Save(outJsPath,   jsOut);
	if (htmlOut) Save(outHtmlPath, htmlOut);
	console.log('  [SAVED] ' + saveCount + ' file' + (saveCount != 1 ? 's' : '') + ' (' + saveTotal+ ' bytes)' + (gzipTotal ? ' (' +  gzipTotal + ' gzipped)' : ''));
})();

function ProcessFile(inBytes, p)
{
	var minify_compress = { ecma: 2015, passes: 5, unsafe: true, unsafe_arrows: true, unsafe_math: true, drop_console: !p.log, pure_funcs:['document.getElementById'] };
	var minify_reserved = ['abort', 'MU8', 'MU16', 'MU32', 'MI32', 'MF32', 'STOP', 'TEMP', 'MStrPut', 'MStrGet', 'MArrPut', 'ASM', 'WM', 'J', 'N' ];
	p.terser = require_terser();
	p.terser_options_toplevel = { compress: minify_compress, mangle: { eval: 1, reserved: minify_reserved }, toplevel: true };
	p.terser_options_reserve = { compress: minify_compress, mangle: { eval: 1, reserved: minify_reserved } };
	p.terser_options_merge = { compress: minify_compress };

	if (IsWasmFile(inBytes))
	{
		p.wasm = inBytes;
		if (p.jsPath || p.htmlPath)
		{
			GenerateJsAndWasm(p);
			FinalizeJs(p);
			return [ (p.wasmPath && p.wasm), (p.jsPath && WriteUTF8String(p.js)), (p.htmlPath && WriteUTF8String(GenerateHtml(p))) ];
		}
		else if (p.wasmPath)
		{
			return [ WasmEmbedFiles(GenerateWasm(p), p.embeds), null, null ]
		}
	}
	else
	{
		return [ null, MinifyJs(inBytes, p), null ];
	}
}

function IsWasmFile(inBytes)
{
	return (inBytes && inBytes.length > 4 && inBytes[0] == 0 && inBytes[1] == 0x61 && inBytes[2] == 0x73 && inBytes[3] == 0x6d); //wasm magic header
}

function GenerateHtml(p)
{
	VERBOSE('    [HTML] Generate - Log: ' + p.log + ' - Canvas: ' + p.use_canvas + (p.jsPath ? ' - JS: ' + p.jsPath : '') + (p.wasmPath ? ' - WASM: ' + p.wasmPath : ''));
	var both = (p.jsPath && p.wasmPath);
	return '<!doctype html>' + "\n"
		+ '<html lang="en-us">' + "\n"
		+ (p.loadbar ? ''
			+ '<head>' + "\n"
			+	'	<meta charset="utf-8">' + "\n"
			+	'	<meta http-equiv="Content-Type" content="text/html; charset=utf-8">' + "\n"
			+	'	<title>WAjicUp WebAssembly JavaScript Interface Creator Utility Program</title>' + "\n"
			+	'	<style type="text/css">' + "\n"
			+	'	body { background:#CCC }' + "\n"
			+	'	#wa_progress { position:absolute;top:'+(p.use_canvas?'250':'50')+'px;left:calc(50% - 200px);width:400px;height:24px;background-color:#FFF;border:2px solid #19D;filter:drop-shadow(0 0 1px #5AD) }' + "\n"
			+	'	#wa_progress div { width:0;height:100%;background:linear-gradient(to right,#7DF,#ADE) }' + "\n"
			+	'	#wa_progress p { color:#589;font-size:130%;text-align:center;margin:8px }' + "\n"
			+	'	</style>' + "\n"
			+ '</head>' + "\n"
			+ '<body>' + "\n"
			+ (p.use_canvas ? '<canvas id="wa_canvas" style="display:block;margin:0 auto;background:#000" oncontextmenu="event.preventDefault()" width="960" height="540"></canvas>' + "\n" : '')
			+ '<div id="wa_progress"><div></div><p>Loading ...</p></div>' + "\n"
			+ (p.log ? '<div id="wa_log"></div>' + "\n" : '')
			+ '<script>"use strict";' + "\n"
			+ "var WA = {" + "\n"
				+ (p.use_canvas ? "	canvas: document.getElementById('wa_canvas')," + "\n" : '')
				+ "	error: function(code, msg)" + "\n"
				+ "	{" + "\n"
				+ "		document.getElementById('wa_progress').outerHTML = '<div id=\"wa_progress\" style=\"border:0;text-align:center;height:auto;padding:1.5em;color:#000\">' + {" + "\n"
				+ "				BOOT: 'Error during startup. Your browser might not support WebAssembly. Please update it to the latest version.'," + "\n"
				+ "				WEBGL: 'Your browser or graphics card does not seem to support <a href=\"http://khronos.org/webgl/wiki/Getting_a_WebGL_Implementation\" style=\"color:#000\">WebGL</a>.<br>Find out how to get it <a href=\"http://get.webgl.org/\" style=\"color:#000\">here</a>.'," + "\n"
				+ "				CRASH: 'The program crashed.'," + "\n"
				+ "				MEM: 'The program ran out of memory.'," + "\n"
				+ "				DL: 'Error during program loading.'," + "\n"
				+ "			}[code] + '<br><br>(' + msg + ')</div>';" + "\n"
				+ "	}," + "\n"
				+ (p.log ? "	print: text => document.getElementById('wa_log').innerHTML += text.replace(/\\n/g, '<br>')," + "\n"
				         + "	started: () => WA.print('started\\n')," + "\n" : '')
			+ '};' + "\n"
			+ "(()=>{" + "\n"
			+ "var progress = document.getElementById('wa_progress'), progressbar = progress.firstElementChild;" + "\n"
			+ "var " + (p.jsPath?"xhrj":'')+(both?",":"")+(p.wasmPath?"xhrw":"") + ";" + "\n"
			+ "var UpdateProgress = function()" + "\n"
			+ "{" + "\n"
				+ "	if (!progress) return;" + "\n"
				+ "	progressbar.style.width = Math.min(("+(p.jsPath?"xhrj.loaded":'')+(both?"+":"")+(p.wasmPath?"xhrw.loaded":"")+")/("+(p.jsPath?"xhrj.total":'')+(both?"+":"")+(p.wasmPath?"xhrw.total":"")+"),1)*100+'%';" + "\n"
			+ "};" + "\n"
			+ "var OnLoaded = function()" + "\n"
			+ "{" + "\n"
				+ "	if (" + (p.jsPath?"xhrj.readyState != 4":'')+(both?" || ":"")+(p.wasmPath?"xhrw.readyState != 4":"") + ") return;" + "\n"
				+ "	progress.style.display = 'none';" + "\n"
				+ (p.jsPath ? ''
					+ "	var s = document.createElement('script'), d = document.documentElement;" + "\n"
					+ "	s.textContent = xhrj.response;" + "\n"
					+ "	d.appendChild(s);" + "\n"
					+ "	d.removeChild(s);" + "\n" : '')
				+ (p.wasmPath ? "	WA.loaded(xhrw.response);" + "\n" : '')
				+ "	" + (p.jsPath?"xhrj = s = s.textContent = ":'')+(p.wasmPath?"xhrw = ":"") + "null;" + "\n"
			+ "};" + "\n"
			+ "var Load = function(url, rt)" + "\n"
			+ "{" + "\n"
				+ "	var xhr = new XMLHttpRequest();" + "\n"
				+ "	xhr.loaded = xhr.total = 0;" + "\n"
				+ "	xhr.open('GET', url);" + "\n"
				+ "	xhr.responseType = rt;" + "\n"
				+ "	xhr.onprogress = function(e) { if (e.lengthComputable) { xhr.loaded = e.loaded; xhr.total = e.total; UpdateProgress(); } };" + "\n"
				+ "	xhr.onerror = xhr.onabort = function() { WA.error('DL', 'Aborted - URL: ' + url); };" + "\n"
				+ "	xhr.onload = function() { if (xhr.status != 200) WA.error('DL', 'Error - URL: ' + url + ' - Status: ' + xhr.statusText); else OnLoaded(); };" + "\n"
				+ "	return xhr;" + "\n"
			+ "};" + "\n"
			+ (p.jsPath ? "(xhrj = Load('" + p.jsPath + "', 'text')).send();" + "\n" : '')
			+ (p.wasmPath ? "(xhrw = Load('" + p.wasmPath + "', 'arraybuffer')).send();" + "\n" : '')
			+ "})();" + "\n"
			+ (p.jsPath ? '' : p.js)
			+ '</'+'script>' + "\n"
		: '' // default without loadbar
			+ '<head><meta charset="utf-8"></head>' + "\n"
			+ '<body style="background:#CCC">' + "\n"
			+ (p.use_canvas ? '<canvas id="wa_canvas" style="display:block;margin:0 auto" oncontextmenu="event.preventDefault()" height="0"></canvas>' + "\n" : '')
			+ (p.log ? '<div id="wa_log">Loading...<br><br></div>' + "\n" : '')
			+ '<script>"use strict";' + "\n"
			+ (p.meta ? p.meta : '')
			+ (p.jsPath ? '' : p.js)
			+ '</'+'script>' + "\n"
			+ (p.jsPath ? '<script defer src="' + p.jsPath + '"' + (p.wasmPath ? ' data-wasm="' + p.wasmPath + '"' : '') + '></'+'script>' + "\n" : '')
		)
		+ '</body>' + "\n"
		+ '</html>' + "\n";
}

function FinalizeJs(p)
{
	VERBOSE('    [JS] Finalize - EmbedJS: ' + !p.jsPath + ' - Minify: ' + p.minify + ' - EmbedWASM: ' + !p.wasmPath);
	var res = (p.jsPath ? '"use strict";' : '');
	if (p.loadbar && p.wasmPath) res += 'WA.loaded = function(wasm){';
	else res += (p.jsPath ? 'var WA = WA||{' + (p.wasmPath ? 'module:\'' + p.wasmPath + '\'' : '') + '};' : '') + '(function(){';
	res += "\n\n";
	if (p.minify && !p.jsPath && !p.loadbar)
	{
		// pre-declare all variables for minification
		res += 'var WA_'+[ 'maxmem', 'asm', 'wm', 'abort' ].join(',WA_')+';' + "\n"
				+ 'var WA_module' + (p.wasmPath ? ' = \'' + p.wasmPath + '\'' : '') + ';' + "\n"
				+ 'var WA_canvas' + (p.use_canvas ? ' = document.getElementById(\'wa_canvas\')' : '') + ';' + "\n"
				+ 'var WA_print'   + (p.log ? ' = text => document.getElementById(\'wa_log\').innerHTML += text.replace(/\\n/g, \'<br>\')' : ' = t=>{}') + ';' + "\n"
				+ 'var WA_error'   + (p.log ? ' = (code, msg) => WA_print(\'ERROR: \' + code + \' - \' + msg + \'\\n\')'                   : ' = m=>{}') + ';' + "\n"
				+ 'var WA_started' + (p.log ? ' = () => WA_print(\'started\\n\')' : '') + ';' + "\n\n";
		res += 'var print = WA_print, error = WA_error;' + "\n\n";
	}
	else
	{
		p.meta = 'var WA = {' + "\n"
				+ (p.wasmPath && !p.jsPath && !p.loadbar ? '	module: \'' + p.wasmPath + '\',' + "\n" : '')
				+ (p.use_canvas ? '	canvas: document.getElementById(\'wa_canvas\'),' + "\n" : '')
				+ (p.log ? '	print: text => document.getElementById(\'wa_log\').innerHTML += text.replace(/\\n/g, \'<br>\'),' + "\n"
				         + '	error: (code, msg) => WA.print(\'ERROR: \' + code + \' - \' + msg + \'\\n\'),' + "\n"
				         + '	started: () => WA.print(\'started\\n\'),' + "\n"
				    : '')
				+ '};' + "\n";

		res += '// Define print and error functions if not yet defined by the outer html file' + "\n";
		res += 'var print = WA.print || (WA.print = msg => console.log(msg.replace(/\\n$/, \'\')));' + "\n";
		res += 'var error = WA.error || (WA.error = (code, msg) => print(\'[ERROR] \' + code + \': \' + msg + \'\\n\'));' + "\n";
	}
	res += p.js;
	res += (p.loadbar && p.wasmPath ? '};' : '})();') + "\n";

	if (!p.minify)
	{
		p.js = res;
	}
	else
	{
		var src = res;
		if (!p.jsPath && !p.loadbar)
		{
			// Convert all WA.xyz object property access to local variable WA_xyz access
			try { res = p.terser.parse(res); }
			catch(e) { ABORT('Parse error in generated JS code', e, src); }
			res.transform(new p.terser.TreeTransformer(null, function(node)
			{
				if (node instanceof p.terser.AST_Dot || node instanceof p.terser.AST_Sub)
				{
					while (node.expression.expression) node = node.expression;
					if (!(node.expression instanceof p.terser.AST_SymbolRef) || node.expression.name != 'WA') return;
					var prop = (node.property instanceof p.terser.AST_String ? node.property.value : node.property);
					if (typeof prop != 'string') ABORT('Unable to modify global WA object with non-simple string property access (WA[complex expresion])', node.start, src);
					return new p.terser.AST_SymbolRef({ start : node.start, end: node.end, name: "WA_" + prop });
				}
			}));
		}
		res = p.terser.minify(res, p.terser_options_merge);
		if (res.error) ABORT('Error during minification of generated JS code', res.error, src);
		p.js = (!p.jsPath ? res.code + "\n" : res.code);
	}
}

function GenerateJsAndWasm(p)
{
	VERBOSE('    [JS] Generate - Minify: ' + p.minify + ' - EmbedWASM: ' + !p.wasmPath);
	VERBOSE('    [WASM] Read #WAJIC functions and imports');

	var mods = {env:{}}, libs = {}, libNewNames = {}, funcCount = 0, import_memory_pages = 0;
	WasmProcessImports(p.wasm, true,
		function(mod, fld, isMemory, memInitialPages)
		{
			mod = (mods[mod] || (mods[mod] = {}));
			mod[fld] = (isMemory ? 'MEMORY' : 'FUNCTION');
			if (isMemory)
			{
				if (memInitialPages < 1) memInitialPages = 1;
				mod[fld + '__INITIAL_PAGES'] = memInitialPages;
				import_memory_pages = memInitialPages;
			}
		},
		function(JSLib, JSName, JSArgs, JSCode, JSInit)
		{
			if (!libs[JSLib]) { libs[JSLib] = {["INIT\x11"]:[]}; libNewNames[JSLib] = {}; }
			if (JSInit) libs[JSLib]["INIT\x11"].push(JSInit);

			var newName = (p.minify ? NumberToAlphabet(funcCount++) : JSName);
			libs[JSLib][newName] = '(' + JSArgs + ') => ' + JSCode;
			libNewNames[JSLib][JSName] = newName;
		});

	VERBOSE('    [WASM] WAJIC functions embedded in JS, remove code from WASM');
	p.wasm = WasmEmbedFiles(WasmReplaceLibImportNames(p.wasm, libNewNames), p.embeds);
	p.js = GenerateJsBody(mods, libs, import_memory_pages, p);
	p.use_canvas = p.js.includes('canvas');
}

function GenerateJsBody(mods, libs, import_memory_pages, p)
{
	VERBOSE('    [JS] Generate - Querying WASM exports and memory layout');
	const [exports, export_memory_name, export_memory_pages] = WasmGetExports(p.wasm);
	const use_memory = (import_memory_pages || export_memory_name);
	const memory_pages = Math.max(import_memory_pages, export_memory_pages);

	var imports = GenerateJsImports(mods, libs);
	const [has_main, has_WajicMain, has_malloc, use_sbrk, use_MStrPut, use_MStrGet, use_MArrPut, use_WM, use_ASM, use_MU8, use_MU16, use_MU32, use_MI32, use_MF32, use_MSetViews, use_MEM, use_TEMP]
		= VerifyWasmLayout(exports, mods, imports, use_memory, p);

	// Fix up some special cases in the generated imports code
	if (import_memory_pages && !use_MEM)
	{
		// remove the 'MEM = ' from the import where the memory object is created
		imports = imports.replace(/MEM = new WebAssembly\.Memory/, 'new WebAssembly.Memory');
	}
	if (use_sbrk && !use_MSetViews)
	{
		// remove the call to MSetViews in sbrk if it's not needed
		imports = imports.replace(/ MSetViews\(\);/, '');
	}
	if (use_sbrk && use_MU8)
	{
		// simplify memory length lookup in sbrk
		imports = imports.replace(/MEM\.buffer\.byteLength/, 'MU8.length');
	}

	var body = '';

	if (use_MEM || use_ASM || use_TEMP || use_WM)
	{
		var vars = '';
		if (use_TEMP) vars +=                      'TEMP';
		if (use_WM)   vars += (vars ? ', ' : '') + 'WM';
		if (use_ASM)  vars += (vars ? ', ' : '') + 'ASM';
		if (use_MEM)  vars += (vars ? ', ' : '') + 'MEM';
		if (use_MU8)  vars += (vars ? ', ' : '') + 'MU8';
		if (use_MU16) vars += (vars ? ', ' : '') + 'MU16';
		if (use_MU32) vars += (vars ? ', ' : '') + 'MU32';
		if (use_MI32) vars += (vars ? ', ' : '') + 'MI32';
		if (use_MF32) vars += (vars ? ', ' : '') + 'MF32';
		if (use_sbrk) vars += (vars ? ', ' : '') + 'WASM_HEAP = ' + WasmFindHeapBase(p.wasm, memory_pages);
		if (use_sbrk) vars += (vars ? ', ' : '') + 'WASM_HEAP_MAX = (WA.maxmem||256*1024*1024)';
		body += '// Some global memory variables/definition' + "\n";
		body += 'var ' + vars + ';' + (use_sbrk ? ' //default max 256MB' : '') + "\n\n";
	}

	body += '// A generic abort function that if called stops the execution of the program and shows an error' + "\n";
	body += 'var STOP, abort = WA.abort = function(code, msg)' + "\n";
	body += '{' + "\n";
	body += '	STOP = true;' + "\n";
	body += '	error(code, msg);' + "\n";
	body += '	throw \'abort\';' + "\n";
	body += '};' + "\n\n";

	if (use_MStrPut)
	{
		body += '// Puts a string from JavaScript onto the wasm memory heap (encoded as UTF8)' + "\n";
		body += 'var MStrPut = function(str, ptr, buf_size)' + "\n";
		body += '{' + "\n";
		body += '	if (buf_size === 0) return 0;' + "\n";
		body += '	var buf = new TextEncoder().encode(str), bufLen = buf.length, out = (ptr||ASM.malloc(bufLen+1));' + "\n";
		body += '	if (buf_size && bufLen >= buf_size)' + "\n";
		body += '		for (bufLen = buf_size - 1; (buf[bufLen] & 0xC0) == 0x80; bufLen--);' + "\n";
		body += '	MU8.set(buf.subarray(0, bufLen), out);' + "\n";
		body += '	MU8[out + bufLen] = 0;' + "\n";
		body += '	return (ptr ? bufLen : out);' + "\n";
		body += '};' + "\n\n";
	}

	if (use_MStrGet)
	{
		body += '// Reads a string from the wasm memory heap to JavaScript (decoded as UTF8)' + "\n";
		body += 'var MStrGet = function(ptr, length)' + "\n";
		body += '{' + "\n";
		body += '	if (length === 0 || !ptr) return \'\';' + "\n";
		body += '	if (!length) { for (length = 0; length != ptr+MU8.length && MU8[ptr+length]; length++); }' + "\n";
		body += '	return new TextDecoder().decode(MU8.subarray(ptr, ptr+length));' + "\n";
		body += '};' + "\n\n";
	}

	if (use_MArrPut)
	{
		body += '// Copy a JavaScript array to the wasm memory heap' + "\n";
		body += 'var MArrPut = function(a)' + "\n";
		body += '{' + "\n";
		body += '	var len = a.byteLength || a.length, ptr = len && ASM.malloc(len);' + "\n";
		body += '	MU8.set(a, ptr);' + "\n";
		body += '	return ptr;' + "\n";
		body += '}' + "\n\n";
	}

	if (use_MSetViews)
	{
		body += '// Set the array views of various data types used to read/write to the wasm memory from JavaScript' + "\n";
		body += 'var MSetViews = function()' + "\n";
		body += '{' + "\n";
		body += '	var buf = MEM.buffer;' + "\n";
		if (use_MU8)  body += '	MU8 = new Uint8Array(buf);' + "\n";
		if (use_MU16) body += '	MU16 = new Uint16Array(buf);' + "\n";
		if (use_MU32) body += '	MU32 = new Uint32Array(buf);' + "\n";
		if (use_MI32) body += '	MI32 = new Int32Array(buf);' + "\n";
		if (use_MF32) body += '	MF32 = new Float32Array(buf);' + "\n";
		body += '};' + "\n\n";
	}

	if (!p.wasmPath)
	{
		if (p.rle)
		{
			body += '// Function to decode an RLE compressed string' + "\n";
			body += 'var DecodeRLE85 = function(str)' + "\n";
			body += '{' + "\n";
			body += '	for(var r,e,n,o=0,i=0,t=r=>h.copyWithin(o,o-y,(o+=r)-y),a=r=>(r=str.charCodeAt(i++))<92?r-41:r-41-1,c=e=>(d||(r=a()+85*(a()+85*(a()+85*(a()+85*a()))),d=4),r>>24-8*--d&255),f=c()|r,d=0,h=new Uint8Array(f);o<f;n<<=1,e--)' + "\n";
			body += '		if(e||(n=c(),e=8),128&n)h[o++]=c();else{for(var u=c()<<8|c(),v=u>>12?2+(u>>12):c()+18,y=1+(4095&u);v>y;)t(y),v-=y,y<<=1;t(v)}' + "\n";
			body += '	return h;' + "\n";
			body += '};' + "\n\n";

			body += '// Decompress and decode the embedded .wasm file' + "\n";
			body += 'var wasm = DecodeRLE85("' + EncodeRLE85(p.wasm) + '");' + "\n\n";
		}
		else
		{
			body += '// Function to decode a W64 encoded string to a byte array' + "\n";
			body += 'var DecodeW64 = function(str)' + "\n";
			body += '{' + "\n";
			body += '	var e,n=str.length,r=str[n-1],t=0,o=0,c=Uint8Array,d=new c(128).map((e,n)=>n<92?n-58:n-59);' + "\n";
			body += '	var a=new c(n/4*3-(r<3&&r)),f=e=>d[str.charCodeAt(t++)]<<e,h=n=>a[o++]=e>>n;' + "\n";
			body += '	while (t<n) e=f(0)|f(6)|f(12)|f(18),h(0),h(8),h(16);' + "\n";
			body += '	return a;' + "\n";
			body += '};' + "\n\n";

			body += '// Decode the embedded .wasm file' + "\n";
			body += 'var wasm = DecodeW64("' + EncodeW64(p.wasm) + '");' + "\n\n";
		}
	}

	body += imports;

	if (!p.wasmPath || p.loadbar)
	{
		body += '// Instantiate the wasm module by passing the prepared import functions for the wasm module' + "\n";
		body += 'WebAssembly.instantiate(wasm, imports).then(output =>' + "\n";
	}
	else if (p.node)
	{
		body += '// Instantiate the wasm module by passing the prepared import functions for the wasm module' + "\n";
		body += 'WebAssembly.instantiate(require(\'fs\').readFileSync(WA.module), imports).then(output =>' + "\n";
	}
	else
	{
		var src = (p.jsPath ? "document.currentScript.getAttribute('data-wasm')" : 'WA.module');
		if (p.streaming)
		{
			body += '// Stream and instantiate the wasm module by passing the prepared import functions for the wasm module' + "\n";
			body += 'WebAssembly.instantiateStreaming(fetch(' + src + '), imports).then(output =>' + "\n";
		}
		else
		{
			body += '// Fetch and instantiate the wasm module by passing the prepared import functions for the wasm module' + "\n";
			body += 'fetch(' + src + ').then(r => r.arrayBuffer()).then(r => WebAssembly.instantiate(r, imports)).then(output =>' + "\n";
		}
	}

	body += '{' + "\n";
	body += '	// Store the module reference in WA.wm' + "\n";
	body += '	WA.wm' + (use_WM ? ' = WM' : '') + ' = output.module;' + "\n\n";

	body += '	// Store the list of the functions exported by the wasm module in WA.asm' + "\n";
	body += '	' + (use_ASM ? 'WA.asm = ASM' : 'var ASM = WA.asm') + ' = output.instance.exports;' + "\n\n";

	body += '	var started = WA.started;' + "\n\n";

	if (use_MEM && export_memory_name)
	{
		body += '	// Get the wasm memory object from the module' + (use_sbrk ? ' (can be grown with sbrk)' : '') + "\n";
		body += '	MEM = ASM.' + export_memory_name + ';' + "\n\n";
	}
	if (use_MSetViews)
	{
		body += '	// Set the array views of various data types used to read/write to the wasm memory from JavaScript' + "\n";
		body += '	MSetViews();' + "\n\n";
	}
	if (exports.__wasm_call_ctors)
	{
		body += '	// Call global constructors' + "\n";
		body += '	ASM.__wasm_call_ctors();' + "\n\n";
	}
	if (has_main && has_malloc)
	{
		body += '	// Allocate 10 bytes of memory to store the argument list with 1 entry to pass to main' + "\n";
		body += '	var ptr = ASM.malloc(10);' + "\n\n";

		body += '	// Place executable name string "W" after the argv list' + "\n";
		body += '	MU8[ptr+8] = 87;' + "\n";
		body += '	MU8[ptr+9] = 0;' + "\n\n";

		body += '	// argv[0] contains the pointer to the executable name string, argv[1] has a list terminating null pointer' + "\n";
		body += '	MU32[(ptr    )>>2] = (ptr + 8)' + "\n";
		body += '	MU32[(ptr + 4)>>2] = 0;' + "\n\n";

		body += '	ASM.main(1, ptr);' + "\n\n";
	}
	if (has_main && !has_malloc)
	{
		body += '	// Call the main function with zero arguments' + "\n";
		body += '	ASM.main(0, 0);' + "\n\n";
	}
	if (has_WajicMain)
	{
		body += '	// Call the WajicMain function' + "\n";
		body += '	ASM.WajicMain();' + "\n\n";
	}
	body += '	// If the outer HTML file supplied a \'started\' callback, call it' + "\n";
	body += '	if (started) started();' + "\n";
	body += '})' + "\n";
	body += '.catch(function (err)' + "\n";
	body += '{' + "\n";
	body += '	// On an exception, if the err is \'abort\' the error was already processed in the abort function above' + "\n";
	body += '	if (err !== \'abort\') abort(\'BOOT\', \'WASM instiantate error: \' + err + (err.stack ? "\\n" + err.stack : \'\'));' + "\n";
	body += '});' + "\n\n";

	return body;
}

function GenerateJsImports(mods, libs)
{
	const has_libs = (Object.keys(libs).length != 0);
	var imports = '';

	if (has_libs)
	{
		imports += '// J is for JavaScript functions requested by the WASM module' + "\n";
		imports += 'var J =';
		let added_one = false;
		for (let JSLib in libs)
		{
			// List functions that don't have an INIT block directly
			if (libs[JSLib]["INIT\x11"].length) continue;
			imports += (added_one ? '' : "\n{") + "\n\t" + '// JavaScript functions' + (JSLib ? ' for ' + JSLib : '') + ' requested by the WASM module' + "\n";
			for (let JSName in libs[JSLib])
				if (JSName != "INIT\x11")
					imports += "\t" + JSName + ': ' + libs[JSLib][JSName] + ',' + "\n";
			added_one = true;
		}
		imports += (added_one ? '' : '{') + '};' + "\n\n";
	}

	imports += 'var imports =' + "\n";
	imports += '{' + "\n";
	if (has_libs) imports += '	J: J,' + "\n";

	Object.keys(mods).sort().forEach(mod =>
	{
		imports += '	' + mod + ':' + "\n";
		imports += '	{' + "\n";
		Object.keys(mods[mod]).sort().forEach(fld =>
		{
			var kind = mods[mod][fld];
			if (kind == 'MEMORY')
			{
				imports += '\n		// Set the initial wasm memory' + (mods.env.sbrk ? ' (can be grown with sbrk)' : '') + "\n";
				imports += '		' + fld + ': MEM = new WebAssembly.Memory({initial: ' + mods[mod][fld + '__INITIAL_PAGES'] + '}),' + "\n";
			}
			else if (mod == 'env')
			{
				var mathfunc;
				if (fld == 'sbrk')
				{
					imports += '		// sbrk gets called to increase the size of the memory heap by an increment' + "\n";
					imports += '		sbrk: function(increment)' + "\n";
					imports += '		{' + "\n";
					imports += '			var heapOld = WASM_HEAP, heapNew = heapOld + increment, heapGrow = heapNew - MEM.buffer.byteLength;' + "\n";
					imports += '			//console.log(\'[SBRK] Increment: \' + increment + \' - HEAP: \' + heapOld + \' -> \' + heapNew + (heapGrow > 0 ? \' - GROW BY \' + heapGrow + \' (\' + ((heapGrow+65535)>>16) + \' pages)\' : \'\'));' + "\n";
					imports += '			if (heapNew > WASM_HEAP_MAX) abort(\'MEM\', \'Out of memory\');' + "\n";
					imports += '			if (heapGrow > 0) { MEM.grow((heapGrow+65535)>>16); MSetViews(); }' + "\n";
					imports += '			WASM_HEAP = heapNew;' + "\n";
					imports += '			return heapOld;' + "\n";
					imports += '		},' + "\n";
				}
				else if (fld == 'time')
				{
					imports += '\n		// Function querying the system time' + "\n";
					imports += '		time: function(ptr) { var ret = (Date.now()/1000)|0; if (ptr) MU32[ptr>>2] = ret; return ret; },' + "\n";
				}
				else if (fld == 'gettimeofday')
				{
					imports += '\n		// Function querying the system time' + "\n";
					imports += '		gettimeofday: function(ptr) { var now = Date.now(); MU32[ptr>>2]=(now/1000)|0; MU32[(ptr+4)>>2]=((now % 1000)*1000)|0; },' + "\n";
				}
				else if (fld == '__assert_fail')
				{
					imports += '\n		// Failed assert will abort the program' + "\n";
					if (use_MStrGet)
					{
						imports += '		__assert_fail: (condition, filename, line, func) => crashFunction(\'assert \' + MStrGet(condition) + \' at: \' + (filename ? MStrGet(filename) : \'?\'), line, (func ? MStrGet(func) : \'?\')),' + "\n";
					}
					else
					{
						imports += '		__assert_fail: (condition, filename, line, func) => crashFunction(\'assert fail\'),' + "\n";
					}
				}
				else if (fld == '__cxa_uncaught_exception')
				{
					imports += '		__cxa_uncaught_exception: function() { abort(\'CRASH\', \'Uncaught exception\'); },' + "\n";
				}
				else if (fld == '__cxa_pure_virtual')
				{
					imports += '		__cxa_pure_virtual: function() { abort(\'CRASH\', \'pure virtual\'); },' + "\n";
				}
				else if (fld == 'abort')
				{
					imports += '		abort: function() { abort(\'CRASH\', \'Abort called\'); },' + "\n";
				}
				else if (fld == 'longjmp')
				{
					imports += '		longjmp: function() { abort(\'CRASH\', \'Unsupported longjmp called\'); },' + "\n";
				}
				else if (Math[mathfunc = fld.replace(/^f?([^l].*?)f?$/, '$1').replace(/^rint$/,'round')])
				{
					// Function matched an existing math function (like sin or sqrt)
					imports += '		' + fld + ': Math.' + mathfunc + ',' + "\n";
				}
				else if (fld == 'setjmp' || fld == '__cxa_atexit' || fld == '__lock' || fld == '__unlock')
				{
					// Field name matched an aborting call, pass a crash function
					imports += '		' + fld + ': () => 0, // does nothing in this wasm context' + "\n";
				}
				else if (fld == 'getTempRet0' || fld == 'setTempRet0')
				{
					//The function is related to 64bit passing as generated by the legalize-js-interface pass of Binaryen
					if (fld[0] == 'g') imports += '		getTempRet0: () => TEMP,' + "\n";
					if (fld[0] == 's') imports += '		setTempRet0: i => TEMP = i,' + "\n";
				}
				else
				{
					WARN('Unknown import function ' + mod + '.' + fld + ' - supplying dummy function with perhaps unexpected result');
					imports += '		' + fld + ': () => 0, // does nothing in this wasm context' + "\n";
				}
			}
			else if (mod.includes('wasi'))
			{
				// WASI (WebAssembly System Interface) can have varying module names (wasi_unstable/wasi_snapshot_preview1/wasi)
				if (fld == 'fd_write')
				{
					imports += '\n		// The fd_write function can only be used to write strings to stdout in this wasm context' + "\n";
					imports += '		fd_write: function(fd, iov, iovcnt, pOutResult)' + "\n";
					imports += '		{' + "\n";
					imports += '			iov >>= 2;' + "\n";
					imports += '			for (var ret = 0, str = \'\', i = 0; i < iovcnt; i++)' + "\n";
					imports += '			{' + "\n";
					imports += '				// Process list of IO commands, read passed strings from heap' + "\n";
					imports += '				var ptr = MU32[iov++], len = MU32[iov++];' + "\n";
					imports += '				if (len < 0) return -1;' + "\n";
					imports += '				ret += len;' + "\n";
					imports += '				str += MStrGet(ptr, len);' + "\n";
					imports += '				//console.log(\'fd_write - fd: \' + fd + \' - [\'+i+\'][len:\'+len+\']: \' + MStrGet(ptr, len).replace(/\\n/g, \'\\\\n\'));' + "\n";
					imports += '			}' + "\n";
					imports += '' + "\n";
					imports += '			// Print the passed string and write the number of bytes read to the result pointer' + "\n";
					imports += '			print(str);' + "\n";
					imports += '			MU32[pOutResult>>2] = ret;' + "\n";
					imports += '			return 0; // no error' + "\n";
					imports += '		}' + "\n";
				}
				else
				{
					imports += '		' + fld + ': () => 0, // IO function not emulated' + "\n";
				}
			}
			else
			{
				WARN('Unknown import function ' + mod + '.' + fld + ' - supplying dummy function with probably unexpected result');
				imports += '		' + fld + ': () => 0, // does nothing in this wasm context' + "\n";
			}
		});
		imports += '	},' + "\n";
	});

	imports += '};' + "\n\n";

	for (var JSLib in libs)
	{
		// Functions that have an INIT block get their own function scope (local vars)
		if (!libs[JSLib]["INIT\x11"].length) continue;
		imports += '// JavaScript functions' + (JSLib ? ' for ' + JSLib : '') + ' requested by the WASM module' + "\n";
		imports += '(function()\n{\n';
		for (let JSInit in libs[JSLib]["INIT\x11"])
			imports += "\t" + libs[JSLib]["INIT\x11"][JSInit] + "\n";
		for (let JSName in libs[JSLib])
			if (JSName != "INIT\x11")
				imports += "\t" + 'J.' + JSName + ' = ' + libs[JSLib][JSName] + ";\n";
		imports += '})();' + "\n\n";
	}

	return imports;
}

function GenerateWasm(p)
{
	VERBOSE('    [WASM] Process - Read #WAJIC functions - File Size: ' + p.wasm.length);

	var mods = {env:{}}, import_memory, libEvals = {};
	var splitTag = '"!{>}<~"', libREx = new RegExp('(?:;|,|)JSFUNC\\("~(\\w+)~",([^=]+)=>({?.*?}?),'+splitTag+'\\)', 'g'), imports = '';
	WasmProcessImports(p.wasm, true, 
		function(mod, fld, isMemory, memInitialPages)
		{
			mod = (mods[mod] || (mods[mod] = {}));
			mod[fld] = 1;
			if (isMemory) import_memory = 1;
		},
		function(JSLib, JSName, JSArgs, JSCode, JSInit)
		{
			if (!libEvals[JSLib]) libEvals[JSLib] = '';
			if (JSInit) libEvals[JSLib] = JSInit + libEvals[JSLib];
			libEvals[JSLib] += 'JSFUNC("~' + JSName + '~",((' + JSArgs + ')=>' + JSCode + '),'+splitTag+');';
			imports += (JSInit ? JSInit + ';' : '') + JSCode + ';';
		});

	if (p.minify)
	{
		VERBOSE('    [WASM] Minifying function code');
		var libs = {}, funcCount = 0;
		for (let JSLib in libEvals)
		{
			let libLog = (JSLib ? "Lib " + JSLib + " " : "");
			let libId = NumberToAlphabet(Object.keys(libs).length);

			// use terser minification to make the JavaScript code small
			let res = p.terser.minify(libEvals[JSLib], p.terser_options_toplevel);
			if (res.error) ABORT('Error during minification of WAJIC ' + libLog + 'JS code', res.error, libEvals[JSLib]);

			// terser can leave our splitter character raw in strings we need to escape it
			if (res.code.includes("\x11")) res.code = res.code.replace("\x11", "\\x11");

			let libFuncs = {}, libFirstFunc;
			let libInitCode = res.code.replace(libREx, function(all, JSName, JSArgs, JSCode)
			{
				if (JSCode.includes(splitTag)) ABORT('Parse error field code (contains other JSFUNC):' + JSCode);
				if (libFirstFunc === undefined) libFirstFunc = JSName;
				var funcId = NumberToAlphabet(funcCount++);
				var fld = funcId + "\x11" + JSArgs + "\x11" + JSCode + (JSLib ? "\x11" + libId : "");
				libFuncs[JSName] = fld;
				VERBOSE("      [WASM WAJIC] Out: " + libLog + JSName + (JSArgs[0] == '(' ? JSArgs : '(' + JSArgs + ')') + " => " + funcId + " - Code size: " + JSCode.length);
				return '';
			});

			if (libInitCode && libInitCode != ';')
			{
				if (libInitCode.includes(splitTag)) ABORT('Parse error init code (JSFUNC remains): ' + libInitCode);
				libFuncs[libFirstFunc] += (JSLib ? "" : "\x11") + "\x11(" + libInitCode + ")";
				VERBOSE("      [WASM WAJIC] Out: " + libLog + "Init - Code size: " + libInitCode.length);
			}

			libs[JSLib] = libFuncs;
		}

		VERBOSE('    [WASM] Update WAJIC import code with minified version');
		p.wasm = WasmReplaceLibImportNames(p.wasm, libs);
	}

	const [exports, export_memory] = WasmGetExports(p.wasm);
	VerifyWasmLayout(exports, mods, imports, (import_memory || export_memory), p);

	return p.wasm;
}

function VerifyWasmLayout(exports, mods, imports, use_memory, p)
{
	var has_main = !!exports.main;
	var has_WajicMain = !!exports.WajicMain;
	var has_malloc = !!exports.malloc;
	var has_free = !!exports.free;
	var use_sbrk = !!mods.env.sbrk;
	var use_wasi = (Object.keys(mods).join('|')).includes('wasi');
	var use_MStrPut = imports.match(/\bMStrPut\b/);
	var use_MStrAlloc = (use_MStrPut && imports.match(/\bMStrPut\([^,\)]+\)/));
	var use_MStrGet = imports.match(/\bMStrGet\b/) || use_wasi;
	var use_MArrPut = imports.match(/\bMArrPut\b/);
	var use_WM = imports.match(/\bWM\b/);
	var use_ASM = imports.match(/\bASM\b/) || use_MStrPut || use_MArrPut;
	var use_MU8 = imports.match(/\bMU8\b/) || use_MStrPut || use_MStrGet || use_MArrPut || (has_main && has_malloc);
	var use_MU16 = imports.match(/\bMU16\b/);
	var use_MU32 = imports.match(/\bMU32\b/) || (has_main && has_malloc) || use_wasi;
	var use_MI32 = imports.match(/\bMI32\b/);
	var use_MF32 = imports.match(/\bMF32\b/);
	var use_MSetViews = use_MU8 || use_MU16 || use_MU32 || use_MI32 || use_MF32;
	var use_MEM = use_sbrk || use_MSetViews;
	var use_TEMP = mods.env.getTempRet0 || mods.env.setTempRet0;
	var use_malloc = imports.match(/\bASM.malloc\b/i) || use_MArrPut || use_MStrAlloc;
	var use_free = imports.match(/\bASM.free\b/i);

	VERBOSE('    [JS] Uses: ' + ([ use_memory?'Memory':0, use_sbrk?'sbrk':0, has_main?'main':0, has_WajicMain?'WajicMain':0, use_wasi?'wasi':0 ].filter(m=>m).join('|')));
	if (!use_memory && use_MEM)       ABORT('WASM module does not import or export memory object but requires memory manipulation');
	if (!has_malloc && use_MArrPut)   ABORT('WASM module does not export malloc but its usage of MArrPut requires it');
	if (!has_malloc && use_MStrAlloc) ABORT('WASM module does not export malloc but its usage of MStrPut requires it');
	if (!has_malloc && use_malloc)    ABORT('WASM module does not export malloc but it requires it');
	if (!has_free   && use_free)      ABORT('WASM module does not export free but it requires it');

	var unused_malloc = (has_malloc && !use_malloc), unused_free = (has_free && !use_free);
	if (p.RunWasmOpt)
	{
		p.RunWasmOpt(unused_malloc, unused_free);
		if (unused_malloc) has_malloc = false;
		if (unused_free)   has_free   = false;
	}
	else
	{
		if (unused_malloc) WARN('WASM module exports malloc but does not use it, it should be compiled without the export');
		if (unused_free)   WARN('WASM module exports free but does not use it, it should be compiled without the export');
	}

	return [has_main, has_WajicMain, has_malloc, use_sbrk, use_MStrPut, use_MStrGet, use_MArrPut, use_WM, use_ASM, use_MU8, use_MU16, use_MU32, use_MI32, use_MF32, use_MSetViews, use_MEM, use_TEMP]
}

function MinifyJs(jsBytes, p)
{
	var src = ReadUTF8String(jsBytes).replace(/\r/, '');
	var res = p.terser.minify(src, p.terser_options_reserve);
	if (res.error) ABORT('Error during minification of JS code', res.error, src);
	return WriteUTF8String(res.code);
}

function ReadUTF8String(buf, idx, length)
{
	if (!buf || length === 0) return '';
	if (!length) length = buf.length;
	if (!idx) idx = 0;
	for (var hasUtf = 0, t, i = 0; i != length; i++)
	{
		t = buf[idx+i];
		if (t == 0 && !length) break;
		hasUtf |= t;
	}
	if (i < length) length = i;
	if (hasUtf & 128)
	{
		for(var r=buf,o=idx,p=idx+length,F=String.fromCharCode,e,f,i,n,C,t,a,g='';;)
		{
			if(o==p||(e=r[o++],!e)) return g;
			128&e?(f=63&r[o++],192!=(224&e)?(i=63&r[o++],224==(240&e)?e=(15&e)<<12|f<<6|i:(n=63&r[o++],240==(248&e)?
			e=(7&e)<<18|f<<12|i<<6|n:(C=63&r[o++],248==(252&e)?e=(3&e)<<24|f<<18|i<<12|n<<6|C:(t=63&r[o++],
			e=(1&e)<<30|f<<24|i<<18|n<<12|C<<6|t))),65536>e?g+=F(e):(a=e-65536,g+=F(55296|a>>10,56320|1023&a))):g+=F((31&e)<<6|f)):g+=F(e);
		}
	}
	// split up into chunks, because .apply on a huge string can overflow the stack
	for (var ret = '', curr; length > 0; idx += 1024, length -= 1024)
		ret += String.fromCharCode.apply(String, buf.subarray(idx, idx + Math.min(length, 1024)));
	return ret;
}

function WriteUTF8String(str)
{
	var utf8len = 0;
	for (var e = str, i = 0; i < str.length;)
	{
		var k = str.charCodeAt(i++);
		utf8len += ((55296<=k&&k<=57343&&(k=65536+((1023&k)<<10)|1023&str.charCodeAt(i++)),k<=127)?1:(k<=2047?2:(k<=65535?3:(k<=2097151?4:(k<=67108863?5:6)))));
	}
	var r = new Uint8Array(utf8len);
	for (var f = 0, b = 0; b < str.length;)
	{
		var k=str.charCodeAt(b++);
		if (55296<=k&&k<=57343&&(k=65536+((1023&k)<<10)|1023&str.charCodeAt(b++)),k<=127){r[f++]=k;}
		else if (k<=2047){r[f++]=192|k>>6,r[f++]=128|63&k;}
		else if (k<=65535){r[f++]=224|k>>12,r[f++]=128|k>>6&63,r[f++]=128|63&k;}
		else if (k<=2097151){r[f++]=240|k>>18,r[f++]=128|k>>12&63,r[f++]=128|k>>6&63,r[f++]=128|63&k;}
		else if (k<=67108863){r[f++]=248|k>>24,r[f++]=128|k>>18&63,r[f++]=128|k>>12&63,r[f++]=128|k>>6&63,r[f++]=128|63&k;}
		else {r[f++]=252|k>>30,r[f++]=128|k>>24&63,r[f++]=128|k>>18&63,r[f++]=128|k>>12&63,r[f++]=128|k>>6&63,r[f++]=128|63&k;}
	}
	return r;
}

// Fit len more bytes into out buffer (which gets increased in 64kb steps)
function FitBuf(out, len)
{
	if (out.len + len <= out.arr.length) return;
	var newOut = new Uint8Array((out.len + len + (64 * 1024))>>16<<16);
	newOut.set(out.arr);
	out.arr = newOut;
}

function AppendBuf(out, buf)
{
	if (out.len + buf.length > out.arr.length) FitBuf(out, buf.length);
	out.arr.set(buf, out.len);
	out.len += buf.length;
}

// Calculate byte length of/write/append a LEB128 variable-length number
function LengthLEB(n) { return (n < (1<<7) ? 1 : (n < (1<<14) ? 2 : (n < (1<<21) ? 3 : (n < (1<<28) ? 4 : 5)))); }
function WriteLEB(arr, i, n) { do { arr[i++] = (n>127 ? n&127|128 : n); } while (n>>=7); }
function AppendLEB(out, n) { FitBuf(out, 5); do { out.arr[out.len++] = (n>127 ? n&127|128 : n); } while (n>>=7); }

function WasmReplaceLibImportNames(wasm, libs)
{
	var wasmOut   = { arr: new Uint8Array(64 * 1024), len: 0 };
	var importOut = { arr: new Uint8Array(64 * 1024), len: 0 };
	var wasmDone = 0;
	WasmProcessImports(wasm, false, null,
		function(JSLib, JSName, JSArgs, JSCode, JSInit, iModEnd, iFldEnd)
		{
			var fldOut = WriteUTF8String(libs[JSLib][JSName]);
			AppendBuf(importOut, wasm.subarray(wasmDone, iModEnd));
			AppendLEB(importOut, fldOut.length);
			AppendBuf(importOut, fldOut);
			wasmDone = iFldEnd;
		},
		function(iSectionBeforeLength, iSectionAfterLength)
		{
			AppendBuf(wasmOut, wasm.subarray(0, iSectionBeforeLength));
			wasmDone = iSectionAfterLength;
		},
		function (iSectionEnd)
		{
			AppendBuf(importOut, wasm.subarray(wasmDone, iSectionEnd));
			AppendLEB(wasmOut, importOut.len);
			AppendBuf(wasmOut, importOut.arr.subarray(0, importOut.len));
			wasmDone = iSectionEnd;
		}
	);
	AppendBuf(wasmOut, wasm.subarray(wasmDone, wasm.length));
	return wasmOut.arr.subarray(0, wasmOut.len);
}

function WasmGetExports(wasm)
{
	var exports = {}, export_memory_name, export_memory_pages = 0;
	WasmProcessSections(wasm, {
		's7': function(Get) //Section 7 'Exports' contains the list of functions provided by the wasm module
		{
			var fld = Get('string'), knd = Get(), index = Get();
			if (knd == 0) //Function export
			{
				exports[fld] = 1;
				VERBOSE("      [WASM] Export function " + fld);
			}
			if (knd == 2 && !export_memory_name) //Memory export
			{
				export_memory_name = fld;
				VERBOSE("      [WASM] Export memory: " + fld);
			}
		},
		's5': function(Get) //Section 5 'Memory' contains initial size of the exported memory
		{
			var memFlags = Get();
			export_memory_pages = Get();
			return false; //don't continue processing section items
		}});
	return [exports, export_memory_name, export_memory_pages];
}

function WasmFindHeapBase(wasm, memory_pages)
{
	var findMax = (memory_pages||1)<<16, findMin = findMax - 65535, found = 0;
	WasmProcessSections(wasm, {
		's6': function(Get) //Section 6 'Globals', llvm places the stack pointer here (which is at heap base initially)
		{
			var type = Get(), mutable = Get(), initial = Get('initexpr');
			//Make sure the initial value designates the heap end by verifying if it is in range
			if (initial >= findMin && initial <= findMax && initial > found) found = initial;
		}});
	return (found ? found : findMax);
}

function WasmEmbedFiles(wasm, embeds)
{
	if (!embeds || !Object.keys(embeds).length) return wasm;

	wasm = WasmFilterCustomSections(wasm, (name, size) =>
	{
		if (name[0] != '|' || !embeds[name.substr(1)]) return;
		WARN('Replacing already existing file "' + name.substr(1) + '" (' + size + ')');
		return true;
	});

	var wasmNew = { arr: new Uint8Array(wasm.buffer, wasm.byteOffset), len: wasm.length };
	for (var name in embeds)
	{
		VERBOSE('    [FILE] Embedding file "' + name + '" (' + embeds[name].length + ' bytes)');
		var nameBuf = WriteUTF8String('|' + name);
		var payloadLen = (LengthLEB(nameBuf.length) + nameBuf.length + embeds[name].length);
		AppendLEB(wasmNew, 0);
		AppendLEB(wasmNew, payloadLen);
		AppendLEB(wasmNew, nameBuf.length);
		AppendBuf(wasmNew, nameBuf);
		AppendBuf(wasmNew, embeds[name]);
	}
	return wasmNew.arr.subarray(0, wasmNew.len);
}

// The functions below go through the wasm file sections according the binary encoding description
//     https://webassembly.org/docs/binary-encoding/

function WasmProcessImports(wasm, logImports, callbackImportMod, callbackImportJ, callbackImportsStart, callbackImportsEnd)
{
	// Get() gets a LEB128 variable-length number
	function Get() { for (var b, r, x = 0; r |= ((b = wasm[i++])&127)<<x, b>>7; x += 7); return r; }
	for (var i = 8, iSectionEnd, type, iSectionBeforeLength, len; i < wasm.length; i = iSectionEnd)
	{
		type = Get(), iSectionBeforeLength = i, len = Get(), iSectionEnd = i + len;
		if (type < 0 || type > 11 || len <= 0 || iSectionEnd > wasm.length) break;
		if (type != 2) continue;

		//Section 2 'Imports' contains the list of JavaScript functions imported by the wasm module
		function CharEscape(m) { return "\\"+(m=='\0'?'0':m=='\t'?'t':m=='\n'?'n':m=='\v'?'v':m=='\f'?'f':m=='\r'?'r':"x"+escape(m).slice(1)); }
		if (callbackImportsStart) callbackImportsStart(iSectionBeforeLength, i);
		for (let count = Get(), j = 0, mod, fld, iModEnd, iFldEnd, knd; j != count && i < iSectionEnd; j++)
		{
			len = Get(), mod = ReadUTF8String(wasm, i, len), iModEnd = (i += len);
			len = Get(), fld = ReadUTF8String(wasm, i, len), iFldEnd = (i += len);
			knd = Get(); Get(); // Skip over extra data
			if (knd == 0) //Function import
			{
				if (mod == 'J')
				{
					// JavaScript functions can be generated by the compiled code (with #WAJIC), their code is embedded in the field name
					let [JSName, JSArgs, JSCode, JSLib, JSInit] = fld.split('\x11');
					if (JSCode === undefined) ABORT('This WASM module contains no body for the WAJIC function "' + fld + '". It was probably already processed with this tool.');
					if (!JSLib) JSLib = '';

					// strip C types out of params list (change '(float* p1, unsigned int p2[4], WAu64 i)' to 'p1,p2,i1,i2' (function pointers not supported)
					JSArgs = JSArgs
						.replace(/^\(\s*void\s*\)$|^\(|\[.*?\]|(=|WA_ARG\()[^,]+|\)$/g, '') // remove a single void, opening/closing brackets, array and default argument suffixes
						.replace(/(.*?)(\w+)\s*(,|$)/g, // get the arguments in triplets (type, name, following comma if available)
							(a,b,c,d)=>(b.match(/WA.64[^\*\&]*$/)?c+1+','+c+2:c)+d); // replace with two variables if 64-bit type, otherwise just the name

					// Character sequences in regular expression can contain some that need to be escaped (regex with \ is better coded in string form)
					JSCode = JSCode.replace(/[\0-\37]/g, CharEscape);
					if (JSInit) JSInit = JSInit.replace(/[\0-\37]/g, CharEscape);

					// Remove ( ) brackets around init code which are left in there by #WAJIC
					if (JSInit) JSInit = JSInit.replace(/^\(?\s*|\s*\)$/g, '');

					callbackImportJ(JSLib, JSName, JSArgs, JSCode, JSInit, iModEnd, iFldEnd);

					if (logImports)
					{
						let libLog = (JSLib ? "Lib " + JSLib + " " : "");
						if (JSInit) VERBOSE("      [WASM WAJIC] In: " + libLog + "Init (" + (JSInit.length + 5) + " chars)");
						VERBOSE("      [WASM WAJIC] In: " + libLog + JSName + '(' + JSArgs + ") - Code size: " + JSCode.length);
						if (JSInit && JSInit.includes('WA.asm')) WARN(libLog + "Init uses WA.asm which could be optimized to ASM");
						if (JSInit && JSInit.includes('WA.wm')) WARN(libLog + "Init uses WA.wm which could be optimized to WM");
						if (JSCode.includes('WA.asm')) WARN(libLog + JSName + " uses WA.asm which could be optimized to ASM");
						if (JSCode.includes('WA.wm')) WARN(libLog + JSName + " uses WA.wm which could be optimized to WM");
					}
				}
				else if (callbackImportMod)
				{
					callbackImportMod(mod, fld);
					if (logImports) VERBOSE("      [WASM] Import function: " + mod + '.' + fld);
				}
			}
			if (knd == 2) //Memory import
			{
				let memFlags = Get(), memInitial = Get(), memMaximum = (memFlags ? Get() : 0);
				if (callbackImportMod)
				{
					callbackImportMod(mod, fld, true, memInitial);
					if (logImports) VERBOSE("      [WASM] Import memory: " + mod + '.' + fld);
				}
			}
			if (knd == 1) //Table import
			{
				Get();Get()&&Get();Get(); // Skip over extra data
			}
			if (knd == 3) //Global
			{
				Get();Get(); // Skip over extra data
			}
		}
		if (callbackImportsEnd) callbackImportsEnd(iSectionEnd);
	}
}

function WasmProcessSections(wasm, callbacks)
{
	function Get() { for (var b, r, x = 0; r |= ((b = wasm[i++])&127)<<x, b>>7; x += 7); return r; }
	function MultiGet(what)
	{
		if (!what) return Get();
		if (what == 'string'  ) { var n = Get(), r = ReadUTF8String(wasm, i, n); i += n; return r; }
		if (what == 'initexpr') { var opcode = Get(), val = Get(), endcode = Get(); if (opcode != 65 || endcode != 11) ABORT('Unsupported initializer expression (only i32.const supported)'); return val; }
	}
	for (var i = 8, iSectionEnd, type, len; i < wasm.length; i = iSectionEnd)
	{
		type = Get(), len = Get(), iSectionEnd = i + len;
		if (type < 0 || type > 11 || len <= 0 || iSectionEnd > wasm.length) break;
		var callback = callbacks['s'+type];
		if (!callback || type == 0) continue;
		for (let count = Get(), j = 0; j != count && i < iSectionEnd; j++)
			if (callback(MultiGet) === false) break; //false ends element loop
	}
}

function WasmFilterCustomSections(wasm, removeCheck)
{
	function Get() { for (var b, r, x = 0; r |= ((b = wasm[i++])&127)<<x, b>>7; x += 7); return r; };
	for (var i = 8, iSectionStart, iSectionEnd, type, len; i < wasm.length; i = iSectionEnd)
	{
		iSectionStart = i, type = Get(), len = Get(), iSectionEnd = i + len;
		if (type < 0 || type > 11 || len <= 0 || iSectionEnd > wasm.length) break;
		if (type != 0) continue;
		var len = Get(), name = ReadUTF8String(wasm, i, len);
		if (!removeCheck(name, iSectionEnd - i -len)) continue;
		wasm = wasm.copyWithin(iSectionStart, iSectionEnd).subarray(0, iSectionStart - iSectionEnd);
		iSectionEnd = iSectionStart;
	}
	return wasm;
}

function WasmFilterExports(wasm, removeExports)
{
	if (!removeExports || !Object.keys(removeExports).length) return wasm;
	function Get() { for (var b, r, x = 0; r |= ((b = wasm[i++])&127)<<x, b>>7; x += 7); return r; };
	function ReduceLEB(i, oldval, amount)
	{
		var oldlen = LengthLEB(oldval), newval = oldval - amount, newlen = LengthLEB(newval);
		if (oldlen != newlen) wasm = wasm.copyWithin(i, i+1).subarray(0, -1);
		WriteLEB(wasm, i, newval);
		return oldlen - newlen;
	}
	for (var i = 8, iLen, iSectionEnd, type, len, iCount, count, j, removed = 0; i < wasm.length; i = iSectionEnd)
	{
		type = Get(), iLen = i, len = Get(), iSectionEnd = i + len;
		if (type < 0 || type > 11 || len <= 0 || iSectionEnd > wasm.length) break;
		if (type != 7) continue; //Section 7 'Exports'
		for (iCount = i, count = Get(), j = 0; j != count; j++)
		{
			var iEntry = i, fldlen = Get(), fld = ReadUTF8String(wasm, i, fldlen), fldend = (i += fldlen), knd = Get(), index = Get();
			if (!removeExports[fld]) continue;
			wasm = wasm.copyWithin(iEntry, i).subarray(0, iEntry - i);
			i = iEntry;
			removed++;
		}
		i -= ReduceLEB(iCount, count, removed);
		i -= ReduceLEB(iLen, len, iSectionEnd - i);
		break;
	}
	return wasm;
}

function NumberToAlphabet(num)
{
	// Convert num starting at 0 to 'a','b','c'...'z','A','B'...'Z','aa','ab','ac'...
	for (var res = '', i = (num < 0 ? 0 : num); i >= 0; i = ((i / 52)|0)-1)
	{
		var n = ((i) % 52);
		res = String.fromCharCode((n < 26 ? 97 : 39) + n) + res;
	}
	return res;
}

function EncodeW64(buf)
{
	var bufLen = buf.length, res = '', i = 0, n;
	var Get = (x => buf[i++]<<x);
	var Add = (x => res += String.fromCharCode(x < (92 - 58) ? x + 58 : x + 58 + 1));
	while (i < bufLen)
	{
		n = Get(0)|Get(8)|Get(16);
		Add(n&63), Add((n>>6)&63), Add((n>>12)&63), Add((n>>18)&63)
	}
	return ((bufLen%3) ? res.slice(0,-1)+(3-(bufLen%3)) : res);
}

function DecodeW64(str)
{
	//Unused by this program, but left here unminified as reference
	var strLen = str.length, pad = str[strLen-1], i = 0, o = 0, n, U8 = Uint8Array;
	var T = new U8(128).map((x,y) => (y < 92 ? y - 58 : y - 59));
	var a = new U8(strLen/4*3-(pad<3&&pad));
	var Get = (x => T[str.charCodeAt(i++)]<<x);
	var Add = (x => a[o++] = n>>x);
	while (i < strLen)
	{
		n = Get(0)|Get(6)|Get(12)|Get(18);
		Add(0),Add(8),Add(16)
	}
	return a;
}

function EncodeRLE85(src, compressionLevel = 10)
{
	var res = '';
	function WriteOut(buf, bufLen, isLast)
	{
		// Encode groups of 4 bytes into 5 ascii bytes
		var tmp = '', i = 0, iMax = ((bufLen + (isLast ? 3 : 0)) & ~3);
		var Get = (x => buf[i++]|0);
		var Add = (x => tmp += String.fromCharCode(x < (92 - 41) ? x + 41 : x + 41 + 1));
		while (i < iMax)
		{
			var n = Get()+(Get()*256)+(Get()*65536)+(Get()*16777216);
			//var n = Get()+(Get()+(Get()+Get()*256)*256)*256; probablb
			Add(n%85), Add((n/85|0)%85), Add((n/7225|0)%85), Add((n/614125|0)%85), Add(n/52200625|0)
		}
		res += tmp;
		if (iMax >= bufLen) return 0;
		buf.copyWithin(0, iMax, bufLen);
		return bufLen - iMax;
	}

	// encode the total file length into the first group
	WriteOut(new Uint8Array([src.length,src.length>>8,src.length>>16,src.length>>24]), 4);

	var RLEFindMatch = function(matchRange, buf, bufsize, pos)
	{
		var numBytes = 1, matchPos = 0;
		for (var j, i = (pos > matchRange ? pos - matchRange : 0); i < pos; i++)
		{
			for (j = 0; j < bufsize - pos; j++) if (buf[i+j] != buf[j+pos]) break;
			if (j <= numBytes) continue;
			matchPos = i;
			if (j > 0xFF+0x12) { numBytes = 0xFF+0x12; break; }
			numBytes = j; 
		}
		if (numBytes == 2) numBytes = 1;
		return [matchPos, numBytes];
	};

	var rleMatchRange = (4 << (compressionLevel < 1 ? 1 : (compressionLevel > 10 ? 10 : compressionLevel)));
	var rleMatchPos = 0, rleNumBytes = 0, rleNextNumBytes = 0, rleNextMatchPos = 0
	var srcPos = 0, srcSize = src.length, bitCount = 0, dst = new Uint8Array(8192), dstLen = 1, bitPos = 0;
	while (srcPos < srcSize)
	{
		//RLE look ahead for matches
		if (rleNextNumBytes)
		{
			rleNumBytes = rleNextNumBytes;
			rleNextNumBytes = 0;
		}
		else if (compressionLevel)
		{
			[rleMatchPos, rleNumBytes] = RLEFindMatch(rleMatchRange, src, srcSize, srcPos);
			if (rleNumBytes >= 3 && rleNumBytes != 0xFF+0x12)
			{
				//Look one byte ahead if there's a better match coming up
				[rleNextMatchPos, rleNextNumBytes] = RLEFindMatch(rleMatchRange, src, srcSize, srcPos+1);
				if (rleNextNumBytes >= rleNumBytes+2) { rleNumBytes = 1; rleMatchPos = rleNextMatchPos; }
				else rleNextNumBytes = 0;
			}
		}

		if (rleNumBytes < 3)
		{
			//COPY byte
			dst[dstLen++] = src[srcPos++];
			dst[bitPos] |= (0x80 >> bitCount);
		}
		else
		{
			//RLE part
			var dist = srcPos - rleMatchPos - 1; 
			if (rleNumBytes >= 0x12)
			{
				//Encode in 3 bytes (0x12 ~ 0xFF+0x12 bytes repeat)
				dst[dstLen++] = (dist >> 8);
				dst[dstLen++] = (dist & 0xFF);
				dst[dstLen++] = (rleNumBytes - 0x12);
			}
			else
			{
				//Encode in 2 bytes (0x3 ~ 0x12 bytes repeat)
				dst[dstLen++] = (((rleNumBytes - 2) << 4) | (dist >> 8));
				dst[dstLen++] = (dist & 0xFF);
			}
			srcPos += rleNumBytes;
		}

		if (++bitCount == 8)
		{
			if (dstLen > dst.length-32) dstLen = WriteOut(dst, dstLen);
			dst[bitPos = dstLen++] = 0;
			bitCount = 0;
		}
	}	
	WriteOut(dst, dstLen, true);
	return res;
}

function DecodeRLE85(str)
{
	//Unused by this program, but left here unminified as reference
	var o = 0, i = 0, n, RLEOffset, bits, code;
	var Cpy = (x => trg.copyWithin(o, o - RLEOffset, (o += x) - RLEOffset));
	var Get = (x => ((x = str.charCodeAt(i++)) < 92 ? x - 41 : x - 41 - 1));
	var Src = (x =>
	{
		if (!nrem) { n = Get()+85*(Get()+85*(Get()+85*(Get()+85*Get()))); nrem = 4; }
		return (n>>(24-8*--nrem))&255;
	});
	for (var size = Src()|n, nrem = 0, trg = new Uint8Array(size); o < size; code <<= 1, bits--)
	{
		if (!bits) { code = Src(); bits = 8; }
		if (code & 0x80) { trg[o++] = Src(); continue; }
		var RLE = (Src()<<8|Src()), RLESize = ((RLE >> 12) ? (RLE >> 12) + 2 : (Src() + 0x12)), RLEOffset = ((RLE & 0xFFF) + 1);
		while (RLESize > RLEOffset) { Cpy(RLEOffset); RLESize -= RLEOffset; RLEOffset <<= 1; }
		Cpy(RLESize);
	}
	return trg;
}

function ExperimentalCompileWasm(p, wasmPath, cfiles, ccAdd, ldAdd, pathToWajic, pathToSystem)
{
	const fs = require('fs'), child_process = require('child_process');

	function Run(cmd, args, step)
	{
		VERBOSE('  [' + step +'] Running: ' + cmd + ' ' + args.join(' '));
		const proc = child_process.spawnSync(cmd, args, {stdio:[0,1,2]});
		if (proc.status === null) ABORT('Error while starting ' + cmd + '. Executable not found at path or no access.\nCompile command:\n\n' + cmd + ' ' + args.join(' '));
		if (proc.status !== 0)    ABORT('Error while running ' + cmd + '. An error should have been printed above.\nCompile command:\n\n' + cmd + ' ' + args.join(' '));
	}
	function RunAsync(cmd, args, step, outPath, procs, maxProcs)
	{
		WaitProcs(procs, maxProcs);
		VERBOSE('  [' + step +'] Running: ' + cmd + ' ' + args.join(' '));
		var pid = child_process.spawn(cmd, args, {stdio:[0,1,2]}).pid;
		if (pid === undefined) ABORT('Error while starting ' + cmd + '. Executable not found at path or no access.\nCompile command:\n\n' + cmd + ' ' + args.join(' '));
		procs.push(() => // false if still running, true if done without error
		{
			try { process.kill(pid, 0); return false; } catch (e) { }
			if (!fs.existsSync(outPath)) ABORT('Error while running ' + cmd + '. An error should have been printed above.\nCompile command:\n\n' + cmd + ' ' + args.join(' '));
			return true;
		});
	}
	function WaitProcs(procs, maxProcs)
	{
		for (;;) // clear finished processes and wait while there are more than maxProcs running at the same 
		{
			for (var i = procs.length; i--;) { if (procs[i]()) procs.splice(i, 1); }
			if (procs.length <= (maxProcs|0)) return;
			child_process.spawnSync(process.execPath,['-e','setTimeout(function(){},100)']); //sleep 100 ms
		}
	}
	function GetTempPath(base, ext)
	{
		do { var path = 'tmp-wajic-' + base + '-' + ((Math.random()*1000000)|0) + '.' + ext; } while (fs.existsSync(path));
		process.on('exit', function() { try { fs.unlinkSync(path); } catch (e) {} });
		return path;
	}

	var clangCmd   = pathToWajic + 'clang';
	var ldCmd      = pathToWajic + 'wasm-ld';
	var wasmOptCmd = pathToWajic + 'wasm-opt';

	var wantDebug = ccAdd.match(/(^| )-g($| )/), wantRtti = ccAdd.match(/(^| )-frtti($| )/), hasO = ccAdd.match(/(^| )-O.($| )/), hasX = ccAdd.match(/(^| )-x($| )/), hasStd = ccAdd.match(/(^| )-std=/);
	if (wantDebug) ccAdd = ccAdd.replace(/-g($| )/, ''); //actually not a real clang option
	if (wantRtti) ccAdd = ccAdd.replace(/-frtti($| )/, ''); //actually not a real clang option

	var ccArgs = [ '-cc1', '-triple', 'wasm32', '-emit-obj', '-fcolor-diagnostics', '-I'+pathToWajic, '-D__WAJIC__',
		'-isystem'+pathToSystem+'include/libcxx', '-isystem'+pathToSystem+'include/compat', '-isystem'+pathToSystem+'include', '-isystem'+pathToSystem+'include/libc', '-isystem'+pathToSystem+'lib/libc/musl/arch/emscripten',
		'-mconstructor-aliases', '-fvisibility', 'hidden', '-fno-threadsafe-statics', //reduce output size
		'-fno-common', '-fgnuc-version=4.2.1', '-D__EMSCRIPTEN__', '-D_LIBCPP_ABI_VERSION=2' ]; //required for musl-libc
	if (wantDebug) ccArgs.push('-DDEBUG', '-debug-info-kind=limited');
	else if (hasO) ccArgs.push('-DNDEBUG');
	else ccArgs.push('-DNDEBUG', '-Os'); //default optimizations
	ccArgs = ccArgs.concat(ccAdd.trim().split(/\s+/));

	var ldArgs = (wantDebug ? [] : ['-strip-all']);
	ldArgs.push('-gc-sections', '-no-entry', '-allow-undefined', '-export=__wasm_call_ctors', '-export=main', '-export=malloc', '-export=free', pathToSystem+'system.bc');
	ldArgs = ldArgs.concat(ldAdd.trim().split(/\s+/));

	var procs = [];
	cfiles.forEach((f,i) =>
	{
		var isC = (f.match(/\.c$/i)), outPath = GetTempPath(f.match(/([^\/\\]*?)\.[^\.\/\\]+$/)[1], 'o');
		var args = ccArgs.concat(hasX ? [] : ['-x', (isC ? 'c' : 'c++')]).concat(hasStd ? [] : ['-std=' + (isC ? 'c99' : 'c++11')]);
		if (!wantRtti && !isC) args.push('-fno-rtti');
		args.push('-o', outPath, f);
		console.log('  [COMPILE] Compiling file: ' + f + ' ...');
		(i == cfiles.length - 1 ? Run : RunAsync)(clangCmd, args, "COMPILE", outPath, procs, 4);
		ldArgs.push(outPath);
	});
	WaitProcs(procs);

	console.log('  [LINKING] Linking files: ' + cfiles.join(', ') + ' ...');
	if (!wasmPath) wasmPath = GetTempPath('out', 'wasm');
	ldArgs.push('-o', wasmPath);
	Run(ldCmd, ldArgs, "LINKING");

	p.RunWasmOpt = function(unused_malloc, unused_free)
	{
		if (unused_malloc || unused_free) p.wasm = WasmFilterExports(p.wasm, {malloc:unused_malloc,free:unused_free});
		if (wantDebug) return;
		fs.writeFileSync(wasmPath, p.wasm);
		// adding '--ignore-implicit-traps' would be nice but it can break programs with '-Os'(see issue binaryen-2824)
		var wasmOptArgs = ['--legalize-js-interface', '--low-memory-unused', '--converge', '-Os', wasmPath, '-o', wasmPath ];
		Run(wasmOptCmd, wasmOptArgs, "WASMOPT");
		p.wasm = new Uint8Array(fs.readFileSync(wasmPath));
	};

	try { var buf = fs.readFileSync(wasmPath); } catch (e) { return ABORT('Failed to load file: ' + wasmPath, e); }
	console.log('  [LOADED] ' + wasmPath + ' (' + buf.length + ' bytes)');
	return new Uint8Array(buf);
}

function require_terser()
{
	/***********************************************************************

	  A JavaScript tokenizer / parser / beautifier / compressor.
	  https://github.com/mishoo/UglifyJS2

	  -------------------------------- (C) ---------------------------------

	                           Author: Mihai Bazon
	                         <mihai.bazon@gmail.com>
	                       http://mihai.bazon.net/blog

	  Distributed under the BSD license:

	    Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>
	    Parser based on parse-js (http://marijn.haverbeke.nl/parse-js/).

	    Redistribution and use in source and binary forms, with or without
	    modification, are permitted provided that the following conditions
	    are met:

	        * Redistributions of source code must retain the above
	          copyright notice, this list of conditions and the following
	          disclaimer.

	        * Redistributions in binary form must reproduce the above
	          copyright notice, this list of conditions and the following
	          disclaimer in the documentation and/or other materials
	          provided with the distribution.

	    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
	    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
	    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
	    PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
	    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
	    OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
	    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
	    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
	    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
	    TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
	    THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
	    SUCH DAMAGE.

	 ***********************************************************************/

	// Generated from Terser ver. 4.6.13
	// Source: https://github.com/terser/terser/tree/056623c20dbbc42d2f5a34926c07133981519326
	// Date: 2020-05-05

	function e(e){return e.split("")}function t(e,t){return t.includes(e)}function n(e,t,n){!0===e&&(e={});const i=e||{};if(n)for(const e in i)if(_(i,e)&&!_(t,e))throw new Pi("`"+e+"` is not a supported option",t);for(const n in t)if(_(t,n))if(e&&_(e,n))if("ecma"===n){let t=0|e[n];t>5&&t<2015&&(t+=2009),i[n]=t}else i[n]=e&&_(e,n)?e[n]:t[n];else i[n]=t[n];return i}function i(){}function o(){return!1}function r(){return!0}function s(){return this}function a(){return null}function u(e,t,n){return n||(n={}),t&&(n.start||(n.start=t.start),n.end||(n.end=t.end)),new e(n)}function c(e,t){e.includes(t)||e.push(t)}function f(e,t){return e.replace(/{(.+?)}/g,(e,n)=>t&&t[n])}function l(e,t){for(var n=e.length;--n>=0;)e[n]===t&&e.splice(n,1)}function p(e,t){return e.length<2?e.slice():function e(n){if(n.length<=1)return n;var i=Math.floor(n.length/2),o=n.slice(0,i),r=n.slice(i);return((e,n)=>{for(var i=[],o=0,r=0,s=0;o<e.length&&r<n.length;)t(e[o],n[r])<=0?i[s++]=e[o++]:i[s++]=n[r++];return o<e.length&&i.push.apply(i,e.slice(o)),r<n.length&&i.push.apply(i,n.slice(r)),i})(o=e(o),r=e(r))}(e)}function h(e){return Array.isArray(e)||(e=e.split(" ")),new Set(e)}function d(e,t,n){e.has(t)?e.get(t).push(n):e.set(t,[n])}function _(e,t){return Object.prototype.hasOwnProperty.call(e,t)}function m(e,t){return!0===e||e instanceof RegExp&&e.test(t)}function g(e){return e.replace(/[\n\r\u2028\u2029]/g,(t,n)=>("\\"!=e[n-1]||"\\"==e[n-2]&&!/(?:^|[^\\])(?:\\{2})*$/.test(e.slice(0,n-1))?"\\":"")+He[t])}function D(e,t){return e._annotations&t}function v(e,t){e._annotations|=t}function y(e,t,n,i=je){var o,r,s,a;for(o=t=t?t.split(/\s+/):[],i&&i.PROPS&&(t=t.concat(i.PROPS)),r="return function AST_"+e+"(props){ if (props) { ",s=t.length;--s>=0;)r+="this."+t[s]+" = props."+t[s]+";";const u=i&&Object.create(i.prototype);if((u&&u.initialize||n&&n.initialize)&&(r+="this.initialize();"),r+="}",r+="this.flags = 0;",a=Function(r+="}")(),u&&(a.prototype=u,a.BASE=i),i&&i.SUBCLASSES.push(a),a.prototype.CTOR=a,a.prototype.constructor=a,a.PROPS=t||null,a.SELF_PROPS=o,a.SUBCLASSES=[],e&&(a.prototype.TYPE=a.TYPE=e),n)for(s in n)_(n,s)&&("$"===s[0]?a[s.substr(1)]=n[s]:a.prototype[s]=n[s]);return a.DEFMETHOD=function(e,t){this.prototype[e]=t},a}function b(e,t){const n=e.body;for(var i=0,o=n.length;i<o;i++)n[i]._walk(t)}function E(e){var t=this._clone(e);return this.block_scope&&(t.block_scope=this.block_scope.clone()),t}function w(e,t,n=[e]){const i=n.push.bind(n);for(;n.length;){const e=n.pop(),o=t(e,n);if(o){if(o===Ri)return!0}else e._children_backwards(i)}return!1}function x(e,t,n){const i=[e],o=i.push.bind(i),r=n?n.slice():[],s=[];let a;const u={parent:(e=0)=>-1===e?a:n&&e>=r.length?(e-=r.length,n[n.length-(e+1)]):r[r.length-(1+e)]};for(;i.length;){for(a=i.pop();s.length&&i.length==s[s.length-1];)r.pop(),s.pop();const e=t(a,u);if(e){if(e===Ri)return!0;continue}const n=i.length;a._children_backwards(o),i.length>n&&(r.push(a),s.push(n-1))}return!1}function A(e,t){if(F(e.charCodeAt(t))){if(k(e.charCodeAt(t+1)))return e.charAt(t)+e.charAt(t+1)}else if(k(e.charCodeAt(t))&&F(e.charCodeAt(t-1)))return e.charAt(t-1)+e.charAt(t);return e.charAt(t)}function F(e){return e>=55296&&e<=56319}function k(e){return e>=56320&&e<=57343}function C(e){return e>=48&&e<=57}function B(e){return di.ID_Start.test(e)}function S(e){return di.ID_Continue.test(e)}function T(e){return/^[a-z_$][a-z0-9_$]*$/i.test(e)}function $(e,t){if(/^[a-z_$][a-z0-9_$]*$/i.test(e))return!0;if(!t&&/[\ud800-\udfff]/.test(e))return!1;var n=di.ID_Start.exec(e);return!(!n||0!==n.index||(e=e.slice(n[0].length))&&(!(n=di.ID_Continue.exec(e))||n[0].length!==e.length))}function z(e,t=!0){if(!t&&e.includes("e"))return NaN;if(ni.test(e))return parseInt(e.substr(2),16);if(ii.test(e))return parseInt(e.substr(1),8);if(oi.test(e))return parseInt(e.substr(2),8);if(ri.test(e))return parseInt(e.substr(2),2);if(si.test(e))return parseFloat(e);var n=parseFloat(e);return n==e?n:void 0}function q(e,t,n,i,o){throw new Vi(e,t,n,i,o)}function O(e,t,n){return e.type==t&&(null==n||e.value==n)}function M(e,t,n,i){function o(){return A(E.text,E.pos)}function r(e,t){var n=A(E.text,E.pos++);if(e&&!n)throw _i;return fi.has(n)?(E.newline_before=E.newline_before||!t,++E.line,E.col=0,"\r"==n&&"\n"==o()&&(++E.pos,n="\n")):(n.length>1&&(++E.pos,++E.col),++E.col),n}function s(e){for(;e--;)r()}function a(e){return E.text.substr(E.pos,e.length)==e}function u(e,t){var n=E.text.indexOf(e,E.pos);if(t&&-1==n)throw _i;return n}function c(){E.tokline=E.line,E.tokcol=E.col,E.tokpos=E.pos}function f(n,i,o){E.regex_allowed="operator"==n&&!gi.has(i)||"keyword"==n&&Qn.has(i)||"punc"==n&&pi.has(i)||"arrow"==n,"punc"==n&&"."==i?w=!0:o||(w=!1);var r={type:n,value:i,line:E.tokline,col:E.tokcol,pos:E.tokpos,endline:E.line,endcol:E.col,endpos:E.pos,nlb:E.newline_before,file:t};return/^(?:num|string|regexp)$/i.test(n)&&(r.raw=e.substring(r.pos,r.endpos)),o||(r.comments_before=E.comments_before,r.comments_after=E.comments_before=[]),E.newline_before=!1,r=new Ie(r),o||(x=r),r}function l(){for(;ci.has(o());)r()}function p(e){q(e,t,E.tokline,E.tokcol,E.tokpos)}function h(e){var t,n=!1,i=!1,s=!1,a="."==e,u=!1,c=(e=>{for(var t,n="",i=0;(t=o())&&e(t,i++);)n+=r();return n})((t,o)=>{if(u)return!1;switch(t.charCodeAt(0)){case 98:case 66:return s=!0;case 111:case 79:case 120:case 88:return!s&&(s=!0);case 101:case 69:return!!s||!n&&(n=i=!0);case 45:return i||0==o&&!e;case 43:return i;case i=!1,46:return!(a||s||n)&&(a=!0)}return"n"===t?(u=!0,!0):ti.test(t)});if(e&&(c=e+c),ii.test(c)&&b.has_directive("use strict")&&p("Legacy octal literals are not allowed in strict mode"),c.endsWith("n")){const e=c.slice(0,-1),t=z(e,ni.test(e));if(!a&&ai.test(c)&&!isNaN(t))return f("big_int",e);p("Invalid or unexpected token")}if(t=z(c),!isNaN(t))return f("num",t);p("Invalid syntax: "+c)}function d(e){return e>="0"&&e<="7"}function _(e,t,n){var i,s,a,c=r(!0,e);switch(c.charCodeAt(0)){case 110:return"\n";case 114:return"\r";case 116:return"\t";case 98:return"\b";case 118:return"\v";case 102:return"\f";case 120:return String.fromCharCode(m(2,t));case 117:if("{"==o()){for(r(!0),"}"===o()&&p("Expecting hex-character between {}");"0"==o();)r(!0);return((s=u("}",!0)-E.pos)>6||(i=m(s,t))>1114111)&&p("Unicode reference out of bounds"),r(!0),(a=i)>65535?String.fromCharCode(55296+((a-=65536)>>10))+String.fromCharCode(a%1024+56320):String.fromCharCode(a)}return String.fromCharCode(m(4,t));case 10:return"";case 13:if("\n"==o())return r(!0,e),""}return d(c)?(n&&t&&("0"===c&&!d(o())||p("Octal escape sequences are not allowed in template strings")),((e,t)=>{var n=o();return n>="0"&&n<="7"&&(e+=r(!0))[0]<="3"&&(n=o())>="0"&&n<="7"&&(e+=r(!0)),"0"===e?"\0":(e.length>0&&b.has_directive("use strict")&&t&&p("Legacy octal escape sequences are not allowed in strict mode"),String.fromCharCode(parseInt(e,8)))})(c,t)):c}function m(e,t){for(var n,i=0;e>0;--e){if(!t&&isNaN(parseInt(o(),16)))return parseInt(i,16)||"";n=r(!0),isNaN(parseInt(n,16))&&p("Invalid hex-character pattern in string"),i+=n}return parseInt(i,16)}function g(e){var t,n=E.regex_allowed,i=(()=>{var e,t,n,i=E.text;for(e=E.pos,t=E.text.length;e<t;++e)if(n=i[e],fi.has(n))return e;return-1})();return-1==i?(t=E.text.substr(E.pos),E.pos=E.text.length):(t=E.text.substring(E.pos,i),E.pos=i),E.col=E.tokcol+(E.pos-E.tokpos),E.comments_before.push(f(e,t,!0)),E.regex_allowed=n,b}function D(e){return f("operator",function e(t){if(!o())return t;var n=t+o();return ui.has(n)?(r(),e(n)):t}(e||r()))}function v(){switch(r(),o()){case"/":return r(),g("comment1");case"*":return r(),O()}return E.regex_allowed?N(""):D("/")}function y(e,t){return n=>{try{return t(n)}catch(t){if(t!==_i)throw t;p(e)}}}function b(e){var t,u,d,_;if(null!=e)return N(e);for(i&&0==E.pos&&a("#!")&&(c(),s(2),g("comment5"));;){if(l(),c(),n){if(a("\x3c!--")){s(4),g("comment3");continue}if(a("--\x3e")&&E.newline_before){s(3),g("comment4");continue}}if(!(t=o()))return f("eof");switch(u=t.charCodeAt(0)){case 34:case 39:return T();case 46:return r(),C(o().charCodeAt(0))?h("."):"."===o()?(r(),r(),f("expand","...")):f("punc",".");case 47:if((d=v())===b)continue;return d;case 61:return r(),">"===o()?(r(),f("arrow","=>")):D("=");case 96:return $(!0);case 123:E.brace_counter++;break;case 125:if(E.brace_counter--,E.template_braces.length>0&&E.template_braces[E.template_braces.length-1]===E.brace_counter)return $(!1)}if(C(u))return h();if(hi.has(t))return f("punc",r());if(ei.has(t))return D();if(92==u||B(t))return _=M(),w?f("name",_):Jn.has(_)?f("atom",_):Zn.has(_)?ui.has(_)?f("operator",_):f("keyword",_):f("name",_);break}p("Unexpected character '"+t+"'")}var E={text:e,filename:t,pos:0,tokpos:0,line:1,tokline:0,col:0,tokcol:0,newline_before:!1,regex_allowed:!1,brace_counter:0,template_braces:[],comments_before:[],directives:{},directive_stack:[]},w=!1,x=null,T=y("Unterminated string constant",()=>{for(var e,t,n=r(),i="";;){if("\\"==(e=r(!0,!0)))e=_(!0,!0);else if("\r"==e||"\n"==e)p("Unterminated string constant");else if(e==n)break;i+=e}return(t=f("string",i)).quote=n,t}),$=y("Unterminated template",e=>{var t,n,i,s,a;for(e&&E.template_braces.push(E.brace_counter),t="",n="",r(!0,!0);"`"!=(i=r(!0,!0));){if("\r"==i)"\n"==o()&&++E.pos,i="\n";else if("$"==i&&"{"==o())return r(!0,!0),E.brace_counter++,(s=f(e?"template_head":"template_substitution",t)).raw=n,s;n+=i,"\\"==i&&(a=E.pos,i=_(!0,!(x&&("name"===x.type||"punc"===x.type&&(")"===x.value||"]"===x.value))),!0),n+=E.text.substr(a,E.pos-a)),t+=i}return E.template_braces.pop(),(s=f(e?"template_head":"template_substitution",t)).raw=n,s.end=!0,s}),O=y("Unterminated multiline comment",()=>{var e=E.regex_allowed,t=u("*/",!0),n=E.text.substring(E.pos,t).replace(/\r\n|\r|\u2028|\u2029/g,"\n");return s((e=>{var t,n=0;for(t=0;t<e.length;t++)F(e.charCodeAt(t))&&k(e.charCodeAt(t+1))&&(n++,t++);return e.length-n})(n)+2),E.comments_before.push(f("comment2",n,!0)),E.newline_before=E.newline_before||n.includes("\n"),E.regex_allowed=e,b}),M=y("Unterminated identifier name",()=>{var e,t,n=!1,i=()=>(n=!0,r(),"u"!==o()&&p("Expecting UnicodeEscapeSequence -- uXXXX or u{XXXX}"),_(!1,!0));if("\\"===(e=o()))B(e=i())||p("First identifier char is an invalid identifier char");else{if(!B(e))return"";r()}for(;null!=(t=o());){if("\\"===(t=o()))S(t=i())||p("Invalid escaped identifier char");else{if(!S(t))break;r()}e+=t}return Kn.has(e)&&n&&p("Escaped characters are not allowed in keywords"),e}),N=y("Unterminated regular expression",e=>{for(var t,n=!1,i=!1;t=r(!0);)if(fi.has(t))p("Unexpected line terminator");else if(n)e+="\\"+t,n=!1;else if("["==t)i=!0,e+=t;else if("]"==t&&i)i=!1,e+=t;else{if("/"==t&&!i)break;"\\"==t?n=!0:e+=t}return f("regexp",{source:e,flags:M()})});return b.next=r,b.peek=o,b.context=e=>(e&&(E=e),E),b.add_directive=e=>{E.directive_stack[E.directive_stack.length-1].push(e),void 0===E.directives[e]?E.directives[e]=1:E.directives[e]++},b.push_directives_stack=()=>{E.directive_stack.push([])},b.pop_directives_stack=()=>{var e,t=E.directive_stack[E.directive_stack.length-1];for(e=0;e<t.length;e++)E.directives[t[e]]--;E.directive_stack.pop()},b.has_directive=e=>E.directives[e]>0,b}function N(e,t){function i(e,t){return O(K.token,e,t)}function o(){return K.peeked||(K.peeked=K.input())}function r(){return K.prev=K.token,K.peeked||o(),K.token=K.peeked,K.peeked=null,K.in_directives=K.in_directives&&("string"==K.token.type||i("punc",";")),K.token}function s(){return K.prev}function a(e,t,n,i){var o=K.input.context();q(e,o.filename,null!=t?t:o.tokline,null!=n?n:o.tokcol,null!=i?i:o.tokpos)}function u(e,t){a(t,e.line,e.col)}function c(e){null==e&&(e=K.token),u(e,"Unexpected token: "+e.type+" ("+e.value+")")}function f(e,t){if(i(e,t))return r();u(K.token,"Unexpected token "+K.token.type+" «"+K.token.value+"», expected "+e+" «"+t+"»")}function l(e){return f("punc",e)}function p(e){return e.nlb||!e.comments_before.every(e=>!e.nlb)}function h(){return!t.strict&&(i("eof")||i("punc","}")||p(K.token))}function d(){return K.in_generator===K.in_function}function _(){return K.in_async===K.in_function}function m(e){i("punc",";")?r():e||h()||c()}function g(){l("(");var e=_e(!0);return l(")"),e}function D(e){return(...t)=>{const n=K.token,i=e(...t);return i.start=n,i.end=s(),i}}function y(){(i("operator","/")||i("operator","/="))&&(K.peeked=null,K.token=K.input(K.token.value.substr(1)))}function b(e){return new Le({body:(e=_e(!0),m(),e)})}function E(e){var t,n,i=null;return h()||(i=V(zn,!0)),null!=i?((t=K.labels.find(e=>e.name===i.name))||a("Undefined label "+i.name),i.thedef=t):0==K.in_loop&&a(e.TYPE+" not inside a loop or switch"),m(),n=new e({label:i}),t&&t.references.push(n),n}function w(e,t){var n=new Set,i=!1,o=!1,r=!1,s=!!t,a={add_parameter:t=>{if(n.has(t.value))!1===i&&(i=t),a.check_strict();else if(n.add(t.value),e)switch(t.value){case"arguments":case"eval":case"yield":s&&u(t,"Unexpected "+t.value+" identifier as parameter inside strict mode");break;default:Kn.has(t.value)&&c()}},mark_default_assignment:e=>{!1===o&&(o=e)},mark_spread:e=>{!1===r&&(r=e)},mark_strict_mode:()=>{s=!0},is_strict:()=>!1!==o||!1!==r||s,check_strict:()=>{a.is_strict()&&!1!==i&&u(i,"Parameter "+i.value+" was used already")}};return a}function x(e,t){var n,o=!1;return void 0===e&&(e=w(!0,K.input.has_directive("use strict"))),i("expand","...")&&(o=K.token,e.mark_spread(K.token),r()),n=A(e,t),i("operator","=")&&!1===o&&(e.mark_default_assignment(K.token),r(),n=new Qt({start:n.start,left:n,operator:"=",right:_e(!1),end:K.token})),!1!==o&&(i("punc",")")||c(),n=new st({start:o,expression:n,end:o})),e.check_strict(),n}function A(e,t){var n,u,f,p,h,d=[],_=!0,m=!1,g=K.token;if(void 0===e&&(e=w(!1,K.input.has_directive("use strict"))),t=void 0===t?vn:t,i("punc","[")){for(r();!i("punc","]");){if(_?_=!1:l(","),i("expand","...")&&(m=!0,n=K.token,e.mark_spread(K.token),r()),i("punc"))switch(K.token.value){case",":d.push(new Vn({start:K.token,end:K.token}));continue;case"]":break;case"[":case"{":d.push(A(e,t));break;default:c()}else i("name")?(e.add_parameter(K.token),d.push(V(t))):a("Invalid function parameter");i("operator","=")&&!1===m&&(e.mark_default_assignment(K.token),r(),d[d.length-1]=new Qt({start:d[d.length-1].start,left:d[d.length-1],operator:"=",right:_e(!1),end:K.token})),m&&(i("punc","]")||a("Rest element must be last element"),d[d.length-1]=new st({start:n,expression:d[d.length-1],end:n}))}return l("]"),e.check_strict(),new pt({start:g,names:d,is_array:!0,end:s()})}if(i("punc","{")){for(r();!i("punc","}");){if(_?_=!1:l(","),i("expand","...")&&(m=!0,n=K.token,e.mark_spread(K.token),r()),i("name")&&(O(o(),"punc")||O(o(),"operator"))&&[",","}","="].includes(o().value))e.add_parameter(K.token),u=s(),f=V(t),m?d.push(new st({start:n,expression:f,end:f.end})):d.push(new on({start:u,key:f.name,value:f,end:f.end}));else{if(i("punc","}"))continue;p=K.token,null===(h=R())?c(s()):"name"!==s().type||i("punc",":")?(l(":"),d.push(new on({start:p,quote:p.quote,key:h,value:A(e,t),end:s()}))):d.push(new on({start:s(),key:h,value:new t({start:s(),name:h,end:s()}),end:s()}))}m?i("punc","}")||a("Rest element must be last element"):i("operator","=")&&(e.mark_default_assignment(K.token),r(),d[d.length-1].value=new Qt({start:d[d.length-1].value.start,left:d[d.length-1].value,operator:"=",right:_e(!1),end:K.token}))}return l("}"),e.check_strict(),new pt({start:g,names:d,is_array:!1,end:s()})}if(i("name"))return e.add_parameter(K.token),V(t);a("Invalid function parameter")}function F(e,n,o,s,a){var u,f=K.in_loop,p=K.labels,h=K.in_generator,d=K.in_async;return++K.in_function,n&&(K.in_generator=K.in_function),o&&(K.in_async=K.in_function),a&&(e=>{var n,o=w(!0,K.input.has_directive("use strict"));for(l("(");!(i("punc",")")||(n=x(o),e.push(n),i("punc",")")||(l(","),i("punc",")")&&t.ecma<2017&&c()),n instanceof st)););r()})(a),e&&(K.in_directives=!0),K.in_loop=0,K.labels=[],e?(K.input.push_directives_stack(),u=k(),s&&L(s),a&&a.forEach(L),K.input.pop_directives_stack()):u=[new Dt({start:K.token,value:_e(!1),end:K.token})],--K.in_function,K.in_loop=f,K.labels=p,K.in_generator=h,K.in_async=d,u}function k(){l("{");for(var e=[];!i("punc","}");)i("eof")&&c(),e.push(Q());return r(),e}function C(){l("{");for(var e,t=[],n=null,o=null;!i("punc","}");)i("eof")&&c(),i("keyword","case")?(o&&(o.end=s()),n=[],o=new Bt({start:(e=K.token,r(),e),expression:_e(!0),body:n}),t.push(o),l(":")):i("keyword","default")?(o&&(o.end=s()),n=[],o=new Ct({start:(e=K.token,r(),l(":"),e),body:n}),t.push(o)):(n||c(),n.push(Q()));return o&&(o.end=s()),r(),t}function B(e,t){for(var n,o,u=[];o="var"===t?_n:"const"===t?gn:"let"===t?Dn:null,i("punc","{")||i("punc","[")?n=new Nt({start:K.token,name:A(void 0,o),value:i("operator","=")?(f("operator","="),_e(!1,e)):null,end:s()}):"import"==(n=new Nt({start:K.token,name:V(o),value:i("operator","=")?(r(),_e(!1,e)):e||"const"!==t?null:a("Missing initializer in const declaration"),end:s()})).name.name&&a("Unexpected token: import"),u.push(n),i("punc",",");)r();return u}function S(){var e,t=K.token;switch(t.type){case"name":e=U(Sn);break;case"num":e=new Hn({start:t,end:t,value:t.value});break;case"big_int":e=new In({start:t,end:t,value:t.value});break;case"string":e=new Nn({start:t,end:t,value:t.value,quote:t.quote});break;case"regexp":e=new jn({start:t,end:t,value:t.value});break;case"atom":switch(t.value){case"false":e=new Xn({start:t,end:t});break;case"true":e=new Gn({start:t,end:t});break;case"null":e=new Rn({start:t,end:t})}}return r(),e}function T(e,t,n,i){var o=(e,t)=>t?new Qt({start:e.start,left:e,operator:"=",right:t,end:t.end}):e;return e instanceof tn?o(new pt({start:e.start,end:e.end,is_array:!1,names:e.properties.map(T)}),i):e instanceof on?(e.value=T(e.value,0,e.key),o(e,i)):e instanceof Vn?e:e instanceof pt?(e.names=e.names.map(T),o(e,i)):e instanceof Sn?o(new vn({name:e.name,start:e.start,end:e.end}),i):e instanceof st?(e.expression=T(e.expression),o(e,i)):e instanceof en?o(new pt({start:e.start,end:e.end,is_array:!0,names:e.elements.map(T)}),i):e instanceof Kt?o(T(e.left,0,0,e.right),i):e instanceof Qt?(e.left=T(e.left,0,e.left),e):void a("Invalid function parameter",e.start.line,e.start.col)}function $(){var e=[],t=K.token;for(e.push(new _t({start:K.token,raw:K.token.raw,value:K.token.value,end:K.token}));!K.token.end;)r(),y(),e.push(_e(!0)),O("template_substitution")||c(),e.push(new _t({start:K.token,raw:K.token.raw,value:K.token.value,end:K.token}));return r(),new dt({start:t,segments:e,end:K.token})}function z(e,t,n){for(var o=!0,a=[];!i("punc",e)&&(o?o=!1:l(","),!t||!i("punc",e));)i("punc",",")&&n?a.push(new Vn({start:K.token,end:K.token})):i("expand","...")?(r(),a.push(new st({start:s(),expression:_e(),end:K.token}))):a.push(_e(!1));return r(),a}function N(e){var t,n,o,a,u=[];for(K.input.push_directives_stack(),K.input.add_directive("use strict"),"name"==K.token.type&&"extends"!=K.token.value&&(o=V(e===fn?xn:An)),e!==fn||o||c(),"extends"==K.token.value&&(r(),a=_e(!0)),l("{");i("punc",";");)r();for(;!i("punc","}");)for(t=K.token,(n=H(R(),t,!0))||c(),u.push(n);i("punc",";");)r();return K.input.pop_directives_stack(),r(),new e({start:t,name:o,extends:a,properties:u,end:s()})}function H(e,t,n){var o,a,u,f,l=(e,t)=>"string"==typeof e||"number"==typeof e?new bn({start:t,name:""+e,end:s()}):(null===e&&c(),e);if(o=!1,a=!1,u=!1,f=t,n&&"static"===e&&!i("punc","(")&&(a=!0,f=K.token,e=R()),"async"!==e||i("punc","(")||i("punc",",")||i("punc","}")||i("operator","=")||(o=!0,f=K.token,e=R()),null===e&&(u=!0,f=K.token,null===(e=R())&&c()),i("punc","("))return e=l(e,t),new an({start:t,static:a,is_generator:u,async:o,key:e,quote:e instanceof bn?f.quote:void 0,value:ue(u,o),end:s()});const p=K.token;if("get"==e){if(!i("punc")||i("punc","["))return e=l(R(),t),new sn({start:t,static:a,key:e,quote:e instanceof bn?p.quote:void 0,value:ue(),end:s()})}else if("set"==e&&(!i("punc")||i("punc","[")))return e=l(R(),t),new rn({start:t,static:a,key:e,quote:e instanceof bn?p.quote:void 0,value:ue(),end:s()});if(n){const n=(e=>"string"==typeof e||"number"==typeof e?new En({start:f,end:f,name:""+e}):(null===e&&c(),e))(e),o=n instanceof En?f.quote:void 0;if(i("operator","="))return r(),new cn({start:t,static:a,quote:o,key:n,value:_e(!1),end:s()});if(i("name")||i("punc",";")||i("punc","}"))return new cn({start:t,static:a,quote:o,key:n,end:s()})}}function I(e){function t(e){return new e({name:R(),start:s(),end:s()})}var n,o,a=e?Cn:$n,u=e?kn:Tn,c=K.token;return e?n=t(a):o=t(u),i("name","as")?(r(),e?o=t(u):n=t(a)):e?o=new u(n):n=new a(o),new Ht({start:c,foreign_name:n,name:o,end:s()})}function j(e,t){var n,i=e?Cn:$n,o=e?kn:Tn,r=K.token,a=s();return t=t||new o({name:"*",start:r,end:a}),n=new i({name:"*",start:r,end:a}),new Ht({start:r,foreign_name:n,name:t,end:a})}function P(e){var t,n;if(i("punc","{")){for(r(),t=[];!i("punc","}");)t.push(I(e)),i("punc",",")&&r();r()}else i("operator","*")&&(r(),e&&i("name","as")&&(r(),n=V(e?kn:$n)),t=[j(e,n)]);return t}function R(){var e,t=K.token;switch(t.type){case"punc":if("["===t.value)return r(),e=_e(!1),l("]"),e;c(t);case"operator":if("*"===t.value)return r(),null;["delete","in","instanceof","new","typeof","void"].includes(t.value)||c(t);case"name":"yield"==t.value&&(d()?u(t,"Yield cannot be used as identifier inside generators"):O(o(),"punc",":")||O(o(),"punc","(")||!K.input.has_directive("use strict")||u(t,"Unexpected yield identifier inside strict mode"));case"string":case"num":case"big_int":case"keyword":case"atom":return r(),t.value;default:c(t)}}function U(e){var t=K.token.value;return new("this"==t?qn:"super"==t?On:e)({name:t+"",start:K.token,end:K.token})}function L(e){var t=e.name;d()&&"yield"==t&&u(e.start,"Yield cannot be used as identifier inside generators"),K.input.has_directive("use strict")&&("yield"==t&&u(e.start,"Unexpected yield identifier inside strict mode"),e instanceof dn&&("arguments"==t||"eval"==t)&&u(e.start,"Unexpected "+t+" in strict mode"))}function V(e,t){if(!i("name"))return t||a("Name expected"),null;var n=U(e);return L(n),r(),n}function Y(e){var t,n,i=e.start,o=i.comments_before;const r=me.get(i);for(t=null!=r?r:o.length;--t>=0;)if(n=o[t],/[@#]__/.test(n.value)){if(/[@#]__PURE__/.test(n.value)){v(e,1);break}if(/[@#]__INLINE__/.test(n.value)){v(e,2);break}if(/[@#]__NOINLINE__/.test(n.value)){v(e,4);break}}}function W(){for(var e=[];!i("punc",")");)i("expand","...")?(r(),e.push(new st({start:s(),expression:_e(!1),end:s()}))):e.push(_e(!1)),i("punc",")")||(l(","),i("punc",")")&&t.ecma<2017&&c());return r(),e}function X(e,t,n){var i=t.value;switch(i){case"++":case"--":G(n)||a("Invalid use of "+i+" operator",t.line,t.col,t.pos);break;case"delete":n instanceof Sn&&K.input.has_directive("use strict")&&a("Calling delete on expression not allowed in strict mode",n.start.line,n.start.col,n.start.pos)}return new e({operator:i,expression:n})}function G(e){return e instanceof Lt||e instanceof Sn}function Z(e){var t,n;if(e instanceof tn)e=new pt({start:e.start,names:e.properties.map(Z),is_array:!1,end:e.end});else if(e instanceof en){for(t=[],n=0;n<e.elements.length;n++)e.elements[n]instanceof st&&(n+1!==e.elements.length&&u(e.elements[n].start,"Spread must the be last element in destructuring array"),e.elements[n].expression=Z(e.elements[n].expression)),t.push(Z(e.elements[n]));e=new pt({start:e.start,names:t,is_array:!0,end:e.end})}else e instanceof nn?e.value=Z(e.value):e instanceof Kt&&(e=new Qt({start:e.start,left:e.left,operator:"=",right:e.right,end:e.end}));return e}function J(e){++K.in_loop;var t=e();return--K.in_loop,t}var K,Q,ee,te,ne,ie,oe,re,se,ae,ue,ce,fe,le,pe,he,de,_e;const me=new Map;return t=n(t,{bare_returns:!1,ecma:2017,expression:!1,filename:null,html5_comments:!0,module:!1,shebang:!0,strict:!1,toplevel:null},!0),(K={input:"string"==typeof e?M(e,t.filename,t.html5_comments,t.shebang):e,token:null,prev:null,peeked:null,in_function:0,in_async:-1,in_generator:-1,in_directives:!0,in_loop:0,labels:[]}).token=r(),Q=D((e,n,d)=>{var D,v,w,A,F,B,S,T,$,z,q;switch(y(),K.token.type){case"string":return K.in_directives&&(D=o(),!K.token.raw.includes("\\")&&(O(D,"punc",";")||O(D,"punc","}")||p(D)||O(D,"eof"))?K.input.add_directive(K.token.value):K.in_directives=!1),v=K.in_directives,w=b(),v&&w.body instanceof Nn?new Ue(w.body):w;case"template_head":case"num":case"big_int":case"regexp":case"operator":case"atom":return b();case"name":return"async"==K.token.value&&O(o(),"keyword","function")?(r(),r(),n&&a("functions are not allowed as the body of a loop"),te(lt,!1,!0,e)):"import"!=K.token.value||O(o(),"punc","(")?O(o(),"punc",":")?(()=>{var e,t=V(Bn);return"await"===t.name&&_()&&u(K.prev,"await cannot be used as label inside async function"),K.labels.some(e=>e.name===t.name)&&a("Label "+t.name+" defined twice"),l(":"),K.labels.push(t),e=Q(),K.labels.pop(),e instanceof Ze||t.references.forEach(e=>{e instanceof Et&&(e=e.label.start,a("Continue label `"+t.name+"` refers to non-IterationStatement.",e.line,e.col,e.pos))}),new Ge({body:e,label:t})})():b():(r(),q=s(),i("name")&&(T=V(kn)),i("punc",",")&&r(),(($=P(!0))||T)&&f("name","from"),"string"!==(z=K.token).type&&c(),r(),A=new It({start:q,imported_name:T,imported_names:$,module_name:new Nn({start:z,value:z.value,quote:z.quote,end:z}),end:K.token}),m(),A);case"punc":switch(K.token.value){case"{":return new Ye({start:K.token,body:k(),end:s()});case"[":case"(":return b();case";":return K.in_directives=!1,r(),new We;default:c()}case"keyword":switch(K.token.value){case"break":return r(),E(bt);case"continue":return r(),E(Et);case"debugger":return r(),m(),new Re;case"do":return r(),F=J(Q),f("keyword","while"),B=g(),m(!0),new Ke({body:F,condition:B});case"while":return r(),new Qe({condition:g(),body:J(()=>Q(!1,!0))});case"for":return r(),(()=>{var e,t,n,o="`for await` invalid in this context",s=K.token;if("name"==s.type&&"await"==s.value?(_()||u(s,o),r()):s=!1,l("("),e=null,i("punc",";"))s&&u(s,o);else if(e=i("keyword","var")?(r(),ne(!0)):i("keyword","let")?(r(),ie(!0)):i("keyword","const")?(r(),oe(!0)):_e(!0,!0),t=i("operator","in"),n=i("name","of"),s&&!n&&u(s,o),t||n)return e instanceof zt?e.definitions.length>1&&u(e.start,"Only one variable declaration allowed in for..in loop"):G(e)||(e=Z(e))instanceof pt||u(e.start,"Invalid left-hand side in for..in loop"),r(),t?(e=>{var t=_e(!0);return l(")"),new tt({init:e,object:t,body:J(()=>Q(!1,!0))})})(e):((e,t)=>{var n=e instanceof zt?e.definitions[0].name:null,i=_e(!0);return l(")"),new nt({await:t,init:e,name:n,object:i,body:J(()=>Q(!1,!0))})})(e,!!s);return(e=>{var t,n;return l(";"),t=i("punc",";")?null:_e(!0),l(";"),n=i("punc",")")?null:_e(!0),l(")"),new et({init:e,condition:t,step:n,body:J(()=>Q(!1,!0))})})(e)})();case"class":return r(),n&&a("classes are not allowed as the body of a loop"),d&&a("classes are not allowed as the body of an if"),N(fn);case"function":return r(),n&&a("functions are not allowed as the body of a loop"),te(lt,!1,!1,e);case"if":return r(),(()=>{var e=g(),t=Q(!1,!1,!0),n=null;return i("keyword","else")&&(r(),n=Q(!1,!1,!0)),new At({condition:e,body:t,alternative:n})})();case"return":return 0!=K.in_function||t.bare_returns||a("'return' outside of function"),r(),S=null,i("punc",";")?r():h()||(S=_e(!0),m()),new Dt({value:S});case"switch":return r(),new Ft({expression:g(),body:J(C)});case"throw":return r(),p(K.token)&&a("Illegal newline after 'throw'"),S=_e(!0),m(),new vt({value:S});case"try":return r(),(()=>{var e,t,n=k(),o=null,u=null;return i("keyword","catch")&&(e=K.token,r(),i("punc","{")?t=null:(l("("),t=x(void 0,Fn),l(")")),o=new Tt({start:e,argname:t,body:k(),end:s()})),i("keyword","finally")&&(e=K.token,r(),u=new $t({start:e,body:k(),end:s()})),o||u||a("Missing catch/finally blocks"),new St({body:n,bcatch:o,bfinally:u})})();case"var":return r(),A=ne(),m(),A;case"let":return r(),A=ie(),m(),A;case"const":return r(),A=oe(),m(),A;case"with":return K.input.has_directive("use strict")&&a("Strict mode may not include a with statement"),r(),new it({expression:g(),body:Q()});case"export":if(!O(o(),"punc","("))return r(),A=(()=>{var e,t,n,a,u,f,l=K.token;if(i("keyword","default"))e=!0,r();else if(t=P(!1))return i("name","from")?(r(),"string"!==(n=K.token).type&&c(),r(),new jt({start:l,is_default:e,exported_names:t,module_name:new Nn({start:n,value:n.value,quote:n.quote,end:n}),end:s()})):new jt({start:l,is_default:e,exported_names:t,end:s()});return i("punc","{")||e&&(i("keyword","class")||i("keyword","function"))&&O(o(),"punc")?(u=_e(!1),m()):(a=Q(e))instanceof zt&&e?c(a.start):a instanceof zt||a instanceof at||a instanceof fn?f=a:a instanceof Le?u=a.body:c(a.start),new jt({start:l,is_default:e,exported_value:u,exported_definition:f,end:s()})})(),i("punc",";")&&m(),A}}c()}),ee=(e,t,n)=>{var o,r;return p(K.token)&&a("Unexpected newline before arrow (=>)"),f("arrow","=>"),r=(o=F(i("punc","{"),!1,n))instanceof Array&&o.length?o[o.length-1].end:o instanceof Array?e:o.end,new ft({start:e,end:r,async:n,argnames:t,body:o})},te=(e,t,n,o)=>{var a,u,f,l=e===lt,p=i("operator","*");return p&&r(),a=i("name")?V(l?yn:wn):null,l&&!a&&(o?e=ct:c()),!a||e===ut||a instanceof dn||c(s()),f=F(!0,p||t,n,a,u=[]),new e({start:u.start,end:f.end,is_generator:p,async:n,name:a,argnames:u,body:f})},ne=e=>new qt({start:s(),definitions:B(e,"var"),end:s()}),ie=e=>new Ot({start:s(),definitions:B(e,"let"),end:s()}),oe=e=>new Mt({start:s(),definitions:B(e,"const"),end:s()}),re=e=>{var n,o,a,u=K.token;return f("operator","new"),i("punc",".")?(r(),f("name","target"),fe(new hn({start:u,end:s()}),e)):(n=se(!1),i("punc","(")?(r(),o=z(")",t.ecma>=2017)):o=[],Y(a=new Rt({start:u,expression:n,args:o,end:s()})),fe(a,e))},se=(e,n)=>{var a,u,f,p,h,d,_,m,g,D;if(i("operator","new"))return re(e);if(a=K.token,f=i("name","async")&&"["!=(u=o()).value&&"arrow"!=u.type&&S(),i("punc")){switch(K.token.value){case"(":if(f&&!e)break;if(p=((e,n)=>{var o,a,u,f=[];for(l("(");!i("punc",")");)o&&c(o),i("expand","...")?(o=K.token,n&&(a=K.token),r(),f.push(new st({start:s(),expression:_e(),end:K.token}))):f.push(_e()),i("punc",")")||(l(","),i("punc",")")&&(t.ecma<2017&&c(),u=s(),n&&(a=u)));return l(")"),e&&i("arrow","=>")?o&&u&&c(u):a&&c(a),f})(n,!f),n&&i("arrow","=>"))return ee(a,p.map(T),!!f);if((h=f?new Pt({expression:f,args:p}):1==p.length?p[0]:new Ut({expressions:p})).start){const e=a.comments_before.length;me.set(a,e),h.start.comments_before.unshift(...a.comments_before),a.comments_before=h.start.comments_before,0==e&&a.comments_before.length>0&&((d=a.comments_before[0]).nlb||(d.nlb=a.nlb,a.nlb=!1)),a.comments_after=h.start.comments_after}return h.start=a,_=s(),h.end&&(_.comments_before=h.end.comments_before,h.end.comments_after.push(..._.comments_after),_.comments_after=h.end.comments_after),h.end=_,h instanceof Pt&&Y(h),fe(h,e);case"[":return fe(ae(),e);case"{":return fe(ce(),e)}f||c()}return n&&i("name")&&O(o(),"arrow")?(m=new vn({name:K.token.value,start:a,end:a}),r(),ee(a,[m],!!f)):i("keyword","function")?(r(),(g=te(ct,!1,!!f)).start=a,g.end=s(),fe(g,e)):f?fe(f,e):i("keyword","class")?(r(),(D=N(ln)).start=a,D.end=s(),fe(D,e)):i("template_head")?fe($(),e):yi.has(K.token.type)?fe(S(),e):void c()},ae=D(()=>(l("["),new en({elements:z("]",!t.strict,!0)}))),ue=D((e,t)=>te(ut,e,t)),ce=D(()=>{var e,n,o,a=K.token,u=!0,f=[];for(l("{");!i("punc","}")&&(u?u=!1:l(","),t.strict||!i("punc","}"));)if("expand"!=(a=K.token).type){if(e=R(),i("punc",":"))null===e?c(s()):(r(),n=_e(!1));else{if(o=H(e,a)){f.push(o);continue}n=new Sn({start:s(),name:e,end:s()})}i("operator","=")&&(r(),n=new Kt({start:a,left:n,operator:"=",right:_e(!1),end:s()})),f.push(new on({start:a,quote:a.quote,key:e instanceof je?e:""+e,value:n,end:s()}))}else r(),f.push(new st({start:a,expression:_e(!1),end:s()}));return r(),new tn({properties:f})}),fe=(e,t)=>{var n,o,a,u=e.start;return i("punc",".")?(r(),fe(new Vt({start:u,expression:e,property:(a=K.token,"name"!=a.type&&c(),r(),a.value),end:s()}),t)):i("punc","[")?(r(),n=_e(!0),l("]"),fe(new Yt({start:u,expression:e,property:n,end:s()}),t)):t&&i("punc","(")?(r(),Y(o=new Pt({start:u,expression:e,args:W(),end:s()})),fe(o,!0)):i("template_head")?fe(new ht({start:u,prefix:e,template_string:$(),end:s()}),t):e},le=(e,t)=>{var n,o,f=K.token;if("name"==f.type&&"await"==f.value){if(_())return r(),_()||a("Unexpected await expression outside async function",K.prev.line,K.prev.col,K.prev.pos),new wt({start:s(),end:K.token,expression:le(!0)});K.input.has_directive("use strict")&&u(K.token,"Unexpected await identifier inside strict mode")}if(i("operator")&&mi.has(f.value))return r(),y(),(n=X(Xt,f,le(e))).start=f,n.end=s(),n;for(o=se(e,t);i("operator")&&gi.has(K.token.value)&&!p(K.token);)o instanceof ft&&c(),(o=X(Gt,K.token,o)).start=f,o.end=K.token,r();return o},pe=(e,t,n)=>{var o,s,a=i("operator")?K.token.value:null;return"in"==a&&n&&(a=null),
	"**"==a&&e instanceof Xt&&!O(e.start,"punc","(")&&"--"!==e.operator&&"++"!==e.operator&&c(e.start),null!=(o=null!=a?vi[a]:null)&&(o>t||"**"===a&&t===o)?(r(),s=pe(le(!0),o,n),pe(new Zt({start:e.start,left:e,operator:a,right:s,end:s.end}),t,n)):e},he=e=>{var t,n=K.token,o=(e=>pe(le(!0,!0),0,e))(e);return i("operator","?")?(r(),t=_e(!1),l(":"),new Jt({start:n,condition:o,consequent:t,alternative:_e(!1,e),end:s()})):o},de=e=>{var t,n,o;if(y(),"name"==(t=K.token).type&&"yield"==t.value){if(d())return r(),(()=>{var e,t,n;return d()||a("Unexpected yield expression outside generator function",K.prev.line,K.prev.col,K.prev.pos),e=K.token,t=!1,n=!0,h()||i("punc")&&li.has(K.token.value)?n=!1:i("operator","*")&&(t=!0,r()),new xt({start:e,is_star:t,expression:n?_e():null,end:s()})})();K.input.has_directive("use strict")&&u(K.token,"Unexpected yield identifier inside strict mode")}if(n=he(e),o=K.token.value,i("operator")&&Di.has(o)){if(G(n)||(n=Z(n))instanceof pt)return r(),new Kt({start:t,left:n,operator:o,right:de(e),end:s()});a("Invalid assignment")}return n},_e=(e,t)=>{for(var n=K.token,s=[];s.push(de(t)),e&&i("punc",",");)r(),e=!0;return 1==s.length?s[0]:new Ut({start:n,expressions:s,end:o()})},t.expression?_e(!0):(()=>{var e,n,o=K.token,r=[];for(K.input.push_directives_stack(),t.module&&K.input.add_directive("use strict");!i("eof");)r.push(Q());return K.input.pop_directives_stack(),e=s(),(n=t.toplevel)?(n.body=n.body.concat(r),n.end=e):n=new rt({start:o,body:r,end:e}),n})()}function H(e,t){e.DEFMETHOD("transform",(function(e,n){let i=void 0;if(e.push(this),e.before&&(i=e.before(this,t,n)),void 0===i&&(i=this,t(i,e),e.after)){const t=e.after(i,n);void 0!==t&&(i=t)}return e.pop(),i}))}function I(e,t){return Ne(e,e=>e.transform(t,!0))}function j(e){if(e.orig[0]instanceof Fn&&e.scope.is_block_scope())return e.scope.get_defun_scope().variables.get(e.name)}function P(e,t){var n,i=e.enclosed;e:for(;;)if(n=Gi(++e.cname),!Kn.has(n)&&!(t.reserved.has(n)||Wi&&Wi.has(n))){for(let e=i.length;--e>=0;){const o=i[e];if(n==(o.mangled_name||o.unmangleable(t)&&o.name))continue e}return n}}function R(e){let t=e.parent(-1);for(let n,i=0;n=e.parent(i);i++){if(n instanceof Pe&&n.body===t)return!0;if(!(n instanceof Ut&&n.expressions[0]===t||"Call"===n.TYPE&&n.expression===t||n instanceof ht&&n.prefix===t||n instanceof Vt&&n.expression===t||n instanceof Yt&&n.expression===t||n instanceof Jt&&n.condition===t||n instanceof Zt&&n.left===t||n instanceof Gt&&n.expression===t))return!1;t=n}}function U(e){return("comment2"===e.type||"comment1"===e.type)&&/@preserve|@lic|@cc_on|^\**!/i.test(e.value)}function L(e){function t(t,n){var i=((t,n)=>{function i(){return"'"+t.replace(/\x27/g,"\\'")+"'"}function o(){return'"'+t.replace(/\x22/g,'\\"')+'"'}var r=0,s=0;if(t=t.replace(/[\\\b\f\n\r\v\t\x22\x27\u2028\u2029\0\ufeff]/g,(n,i)=>{switch(n){case'"':return++r,'"';case"'":return++s,"'";case"\\":return"\\\\";case"\n":return"\\n";case"\r":return"\\r";case"\t":return"\\t";case"\b":return"\\b";case"\f":return"\\f";case"\v":return e.ie8?"\\x0B":"\\v";case"\u2028":return"\\u2028";case"\u2029":return"\\u2029";case"\ufeff":return"\\ufeff";case"\0":return/[0-9]/.test(A(t,i+1))?"\\x00":"\\0"}return n}),t=y(t),"`"===n)return"`"+t.replace(/`/g,"\\`")+"`";switch(e.quote_style){case 1:return i();case 2:return o();case 3:return"'"==n?i():o();default:return r>s?i():o()}})(t,n);return e.inline_script&&(i=(i=(i=i.replace(/<\x2f(script)([>\/\t\n\f\r ])/gi,"<\\/$1$2")).replace(/\x3c!--/g,"\\x3c!--")).replace(/--\x3e/g,"--\\x3e")),i}function s(t){var n,i,o,r;n=A(t+="",0),k&&n&&(k=!1,"\n"!==n&&(s("\n"),j())),C&&n&&(C=!1,/[\s;})]/.test(n)||I()),B=-1,i=T.charAt(T.length-1),w&&(w=!1,(":"!==i||"}"!==n)&&(n&&";}".includes(n)||";"===i)||(e.semicolons||N.has(n)?(v+=";",m++,D++):(M(),m>0&&(v+="\n",D++,g++,m=0),/^\s+$/.test(t)&&(w=!0)),e.beautify||(E=!1))),E&&((S(i)&&(S(n)||"\\"==n)||"/"==n&&n==i||("+"==n||"-"==n)&&n==T)&&(v+=" ",m++,D++),E=!1),$&&(q.push({token:$,name:z,line:g,col:m}),$=!1,x||O()),v+=t,b="("==t[t.length-1],D+=t.length,r=(o=t.split(/\r?\n/)).length-1,g+=r,m+=o[0].length,r>0&&(M(),m=o[r].length),T=t}function a(){w=!1,s(";")}function u(){return _+e.indent_level}function c(){return x&&M(),v}function f(){let e=v.length-1;for(;e>=0;){const t=v.charCodeAt(e);if(10===t)return!0;if(32!==t)return!1;e--}return!0}function l(t){return e.preserve_annotations||(t=t.replace(eo," ")),/^\s*$/.test(t)?"":t.replace(/(<\s*\/\s*)(script)/i,"<\\/$2")}var p,d,_,m,g,D,v,y,b,E,w,x,k,C,B,T,$,z,q,O,M,N,H,I,j,P,R,L,V,Y=!e;if(void 0===(e=n(e,{ascii_only:!1,beautify:!1,braces:!1,comments:"some",ecma:5,ie8:!1,indent_level:4,indent_start:0,inline_script:!0,keep_numbers:!1,keep_quoted_props:!1,max_line_len:!1,preamble:null,preserve_annotations:!1,quote_keys:!1,quote_style:0,safari10:!1,semicolons:!0,shebang:!0,shorthand:void 0,source_map:null,webkit:!1,width:80,wrap_iife:!1,wrap_func_args:!0},!0)).shorthand&&(e.shorthand=e.ecma>5),p=o,e.comments){let t=e.comments;"string"==typeof e.comments&&/^\/.*\/[a-zA-Z]*$/.test(e.comments)&&(d=e.comments.lastIndexOf("/"),t=RegExp(e.comments.substr(1,d-1),e.comments.substr(d+1))),p=t instanceof RegExp?e=>"comment5"!=e.type&&t.test(e.value):"function"==typeof t?function(e){return"comment5"!=e.type&&t(this,e)}:"some"===t?U:r}_=0,m=0,g=1,D=0,v="";let W=new Set;return y=e.ascii_only?(t,n)=>(e.ecma>=2015&&(t=t.replace(/[\ud800-\udbff][\udc00-\udfff]/g,e=>"\\u{"+((e,t)=>F(e.charCodeAt(0))?65536+(e.charCodeAt(0)-55296<<10)+e.charCodeAt(1)-56320:e.charCodeAt(0))(e).toString(16)+"}")),t.replace(/[\u0000-\u001f\u007f-\uffff]/g,e=>{var t=e.charCodeAt(0).toString(16);if(t.length<=2&&!n){for(;t.length<2;)t="0"+t;return"\\x"+t}for(;t.length<4;)t="0"+t;return"\\u"+t})):e=>e.replace(/[\ud800-\udbff][\udc00-\udfff]|([\ud800-\udbff]|[\udc00-\udfff])/g,(e,t)=>t?"\\u"+t.charCodeAt(0).toString(16):e),b=!1,E=!1,w=!1,x=0,k=!1,C=!1,B=-1,T="",q=e.source_map&&[],O=q?()=>{q.forEach(t=>{try{e.source_map.add(t.token.file,t.line,t.col,t.token.line,t.token.col,t.name||"name"!=t.token.type?t.name:t.token.value)}catch(e){null!=t.token.file&&je.warn("Couldn't figure out mapping for {file}:{line},{col} → {cline},{ccol} [{name}]",{file:t.token.file,line:t.token.line,col:t.token.col,cline:t.line,ccol:t.col,name:t.name||""})}}),q=[]}:i,M=e.max_line_len?()=>{var t,n,i;m>e.max_line_len&&(x&&(t=v.slice(0,x),n=v.slice(x),q&&(i=n.length-m,q.forEach(e=>{e.line++,e.col+=i})),v=t+"\n"+n,g++,D++,m=n.length),m>e.max_line_len&&je.warn("Output exceeds {max_line_len} characters",e)),x&&(x=0,O())}:i,N=h("( [ + * / - , . `"),H=()=>{s("*")},I=e.beautify?()=>{s(" ")}:()=>{E=!0},j=e.beautify?t=>{var n;e.beautify&&s((n=t?.5:0," ".repeat(e.indent_start+_-n*e.indent_level)))}:i,P=e.beautify?(e,t)=>{var n,i;return!0===e&&(e=u()),n=_,_=e,i=t(),_=n,i}:(e,t)=>t(),R=e.beautify?()=>{if(B<0)return s("\n");"\n"!=v[B]&&(v=v.slice(0,B)+"\n"+v.slice(B),D++,g++),B++}:e.max_line_len?()=>{M(),x=v.length}:i,L=e.beautify?()=>{s(";")}:()=>{w=!0},V=[],{get:c,toString:c,indent:j,in_directive:!1,use_asm:null,active_scope:null,indentation:()=>_,current_width:()=>m-_,should_break:function(){return e.width&&this.current_width()>=e.width},has_parens:()=>b,newline:R,print:s,star:H,space:I,comma:()=>{s(","),I()},colon:()=>{s(":"),I()},last:()=>T,semicolon:L,force_semicolon:a,to_utf8:y,print_name:e=>{s((e=>(e=e.toString(),y(e,!0)))(e))},print_string:(e,n,i)=>{var o=t(e,n);!0!==i||o.includes("\\")||(Qi.test(v)||a(),a()),s(o)},print_template_string_chars:e=>{var n=t(e,"`").replace(/\${/g,"\\${");return s(n.substr(1,n.length-2))},encode_string:t,next_indent:u,with_indent:P,with_block:e=>{var t;return s("{"),R(),P(u(),()=>{t=e()}),j(),s("}"),t},with_parens:e=>{s("(");var t=e();return s(")"),t},with_square:e=>{s("[");var t=e();return s("]"),t},add_mapping:q?(e,t)=>{$=e,z=t}:i,option:t=>e[t],printed_comments:W,prepend_comments:Y?i:function(t){var n,i,o,r,a,u=t.start;if(!u)return;n=this.printed_comments;const c=t instanceof gt&&t.value;if(u.comments_before&&n.has(u.comments_before)){if(!c)return;u.comments_before=[]}(i=u.comments_before)||(i=u.comments_before=[]),n.add(i),c&&((o=new Ui(e=>{var t,r=o.parent();if(!(r instanceof gt||r instanceof Zt&&r.left===e||"Call"==r.TYPE&&r.expression===e||r instanceof Jt&&r.condition===e||r instanceof Vt&&r.expression===e||r instanceof Ut&&r.expressions[0]===e||r instanceof Yt&&r.expression===e||r instanceof Gt))return!0;e.start&&(t=e.start.comments_before)&&!n.has(t)&&(n.add(t),i=i.concat(t))})).push(t),t.value.walk(o)),0==D&&(i.length>0&&e.shebang&&"comment5"===i[0].type&&!n.has(i[0])&&(s("#!"+i.shift().value+"\n"),j()),(r=e.preamble)&&s(r.replace(/\r\n?|[\n\u2028\u2029]|\s*$/g,"\n"))),0!=(i=i.filter(p,t).filter(e=>!n.has(e))).length&&(a=f(),i.forEach((e,t)=>{var i;n.add(e),a||(e.nlb?(s("\n"),j(),a=!0):t>0&&I()),/comment[134]/.test(e.type)?((i=l(e.value))&&(s("//"+i+"\n"),j()),a=!0):"comment2"==e.type&&((i=l(e.value))&&s("/*"+i+"*/"),a=!1)}),a||(u.nlb?(s("\n"),j()):I()))},append_comments:Y||p===o?i:function(e,t){var n,i,o,r=e.end;r&&(n=this.printed_comments,(i=r[t?"comments_before":"comments_after"])&&!n.has(i)&&(e instanceof Pe||i.every(e=>!/comment[134]/.test(e.type)))&&(n.add(i),o=v.length,i.filter(p,e).forEach((e,i)=>{if(!n.has(e))if(n.add(e),C=!1,k?(s("\n"),j(),k=!1):e.nlb&&(i>0||!f())?(s("\n"),j()):(i>0||!t)&&I(),/comment[134]/.test(e.type)){const t=l(e.value);t&&s("//"+t),k=!0}else if("comment2"==e.type){const t=l(e.value);t&&s("/*"+t+"*/"),C=!0}}),v.length>o&&(B=o)))},line:()=>g,col:()=>m,pos:()=>D,push_node:e=>{V.push(e)},pop_node:()=>V.pop(),parent:e=>V[V.length-2-(e||0)]}}function V(e,t,n){t[e]&&n.forEach(n=>{t[n]&&("object"!=typeof t[n]&&(t[n]={}),e in t[n]||(t[n][e]=t[e]))})}function Y(e){e&&("props"in e?e.props instanceof Map||(e.props=(e=>{var t,n=new Map;for(t in e)_(e,t)&&"$"===t.charAt(0)&&n.set(t.substr(1),e[t]);return n})(e.props)):e.props=new Map)}function W(e,t){var i,o,r,s,a,u,c,f,l=je.warn_function;try{if(i=(t=n(t,{compress:{},ecma:void 0,enclose:!1,ie8:!1,keep_classnames:void 0,keep_fnames:!1,mangle:{},module:!1,nameCache:null,output:{},parse:{},rename:void 0,safari10:!1,sourceMap:!1,timings:!1,toplevel:!1,warnings:!1,wrap:!1},!0)).timings&&{start:Date.now()},void 0===t.keep_classnames&&(t.keep_classnames=t.keep_fnames),void 0===t.rename&&(t.rename=t.compress&&t.mangle),V("ecma",t,["parse","compress","output"]),V("ie8",t,["compress","mangle","output"]),V("keep_classnames",t,["compress","mangle"]),V("keep_fnames",t,["compress","mangle"]),V("module",t,["parse","compress","mangle"]),V("safari10",t,["mangle","output"]),V("toplevel",t,["compress","mangle"]),V("warnings",t,["compress"]),t.mangle&&(t.mangle=n(t.mangle,{cache:t.nameCache&&(t.nameCache.vars||{}),eval:!1,ie8:!1,keep_classnames:!1,keep_fnames:!1,module:!1,properties:!1,reserved:[],safari10:!1,toplevel:!1},!0),Y(t.mangle.cache),Y(t.mangle.properties.cache)),o=[],t.warnings&&!je.warn_function&&(je.warn_function=e=>{o.push(e)}),i&&(i.parse=Date.now()),e instanceof rt)r=e;else{for(s in"string"==typeof e&&(e=[e]),t.parse=t.parse||{},t.parse.toplevel=null,e)_(e,s)&&(t.parse.filename=s,t.parse.toplevel=N(e[s],t.parse));r=t.parse.toplevel}return t.wrap&&(r=r.wrap_commonjs(t.wrap)),t.enclose&&(r=r.wrap_enclose(t.enclose)),i&&(i.rename=Date.now()),i&&(i.compress=Date.now()),t.compress&&(r=new fo(t.compress).compress(r)),i&&(i.scope=Date.now()),t.mangle&&r.figure_out_scope(t.mangle),i&&(i.mangle=Date.now()),t.mangle&&(Gi.reset(),r.compute_char_frequency(t.mangle),r.mangle_names(t.mangle)),i&&(i.properties=Date.now()),t.mangle,i&&(i.output=Date.now()),a={},t.output.ast&&(a.ast=r),_(t.output,"code")&&!t.output.code||(delete t.output.ast,delete t.output.code,u=L(t.output),r.print(u),a.code=u.get()),t.nameCache&&t.mangle&&t.mangle.cache&&(t.nameCache.vars={props:(c=t.mangle.cache.props,f=Object.create(null),c.forEach((e,t)=>{f["$"+t]=e}),f)}),i&&(i.end=Date.now(),a.timings={parse:.001*(i.rename-i.parse),rename:.001*(i.compress-i.rename),compress:.001*(i.scope-i.compress),scope:.001*(i.mangle-i.scope),mangle:.001*(i.properties-i.mangle),properties:.001*(i.output-i.properties),output:.001*(i.end-i.output),total:.001*(i.end-i.start)}),o.length&&(a.warnings=o),a}catch(e){return{error:e}}finally{je.warn_function=l}}function X(){const e={};return Object.keys(G({0:0})).forEach(t=>{const n=G({[t]:{0:0}});n&&(e[t]=n)}),e}function G(e){var t=W("",e);return t.error&&t.error.defs}function Z(e,t){e.DEFMETHOD("optimize",(function(e){var n;return ao(this,512)||e.has_directive("use asm")?this:(n=t(this,e),uo(n,512),n)}))}function J(e,t){var n,i,o,r;if(!((t=ge(t))instanceof je)){if(e instanceof en){if(i=e.elements,"length"==t)return re(i.length,e);"number"==typeof t&&t in i&&(n=i[t])}else if(e instanceof tn)for(t=""+t,r=(o=e.properties).length;--r>=0;){if(!(o[r]instanceof on))return;n||o[r].key!==t||(n=o[r].value)}return n instanceof Sn&&n.fixed_value()||n}}function K(e,t,n,i,o,r){var s,a,u=t.parent(o);return ve(n,u)||!(r||!(u instanceof Pt)||u.expression!==n||i instanceof ft||i instanceof un||u.is_expr_pure(e)||i instanceof ct&&(u instanceof Rt||!i.contains_this()))||(u instanceof en?K(e,t,u,u,o+1):u instanceof on&&n===u.value?(s=t.parent(o+1),K(e,t,s,s,o+2)):u instanceof Lt&&u.expression===n?(a=J(i,u.property),!r&&K(e,t,u,a,o+1)):void 0)}function Q(e){return e instanceof ft||e instanceof ct}function ee(e){if(e instanceof qn)return!0;if(e instanceof Sn)return e.definition().orig[0]instanceof wn;if(e instanceof Lt){if((e=e.expression)instanceof Sn){if(e.is_immutable())return!1;e=e.fixed_value()}return!e||!(e instanceof jn)&&(e instanceof Mn||ee(e))}return!1}function te(e,t){var n,i;if(!(e instanceof Sn))return!1;for(i=(n=e.definition().orig).length;--i>=0;)if(n[i]instanceof t)return!0}function ne(e){for(let t=0;;t++){const n=e.parent(t);if(n instanceof rt)return n;if(n instanceof at)return n;if(n.block_scope)return n.block_scope}}function ie(e,t){for(var n,i=0;(n=e.parent(i++))&&!(n instanceof ot);)if(n instanceof Tt&&n.argname){n=n.argname.definition().scope;break}return n.find_variable(t)}function oe(e,t){if(1==t.length)return t[0];if(0==t.length)throw Error("trying to create a sequence with length zero!");return u(Ut,e,{expressions:t.reduce(ae,[])})}function re(e,t){switch(typeof e){case"string":return u(Nn,t,{value:e});case"number":return isNaN(e)?u(Un,t):isFinite(e)?1/e<0?u(Xt,t,{operator:"-",expression:u(Hn,t,{value:-e})}):u(Hn,t,{value:e}):e<0?u(Xt,t,{operator:"-",expression:u(Yn,t)}):u(Yn,t);case"boolean":return u(e?Gn:Xn,t);case"undefined":return u(Ln,t);default:if(null===e)return u(Rn,t,{value:null});if(e instanceof RegExp)return u(jn,t,{value:{source:g(e.source),flags:e.flags}});throw Error(f("Can't handle constant of type: {type}",{type:typeof e}))}}function se(e,t,n){return e instanceof Xt&&"delete"==e.operator||e instanceof Pt&&e.expression===t&&(n instanceof Lt||n instanceof Sn&&"eval"==n.name)?oe(t,[u(Hn,t,{value:0}),n]):n}function ae(e,t){return t instanceof Ut?e.push(...t.expressions):e.push(t),e}function ue(e){if(null===e)return[];if(e instanceof Ye)return e.body;if(e instanceof We)return[];if(e instanceof Pe)return[e];throw Error("Can't convert thing to statement array")}function ce(e){return null===e||e instanceof We||e instanceof Ye&&0==e.body.length}function fe(e){return!(e instanceof fn||e instanceof lt||e instanceof Ot||e instanceof Mt||e instanceof jt||e instanceof It)}function le(e){return e instanceof Ze&&e.body instanceof Ye?e.body:e}function pe(e){return"Call"==e.TYPE&&(e.expression instanceof ct||pe(e.expression))}function he(e){return e instanceof Sn&&e.definition().undeclared}function de(e){return e instanceof Yn||e instanceof Un||e instanceof Ln}function _e(e,n){function i(e,n){function i(e){var t,n,i;if(e instanceof ot)return e;if(e instanceof Ft){for(e.expression=e.expression.transform(w),t=0,n=e.body.length;!I&&t<n;t++)if((i=e.body[t])instanceof Bt){if(!H){if(i!==A[F])continue;F++}if(i.expression=i.expression.transform(w),!O)break}return I=!0,e}}function o(e,t,n){var i=!1,o=!(e instanceof ft);return t.walk(new Ui((t,r)=>{var s,a;if(i)return!0;if(t instanceof Sn&&(e.variables.has(t.name)||((e,t)=>{if(e.global)return!1;let n=e.scope;for(;n&&n!==t;){if(n.variables.has(e.name))return!0;n=n.parent_scope}return!1})(t.definition(),e))){if((s=t.definition().scope)!==y)for(;s=s.parent_scope;)if(s===y)return!0;return i=!0}return(n||o)&&t instanceof qn?i=!0:t instanceof ot&&!(t instanceof ft)?(a=o,o=!1,r(),o=a,!0):void 0})),i}function r(){var e,i,r,s,a,c,f,l,p=n.self();if(Q(p)&&!p.name&&!p.uses_arguments&&!p.pinned()&&(e=n.parent())instanceof Pt&&e.expression===p&&e.args.every(e=>!(e instanceof st)))for((i=n.has_directive("use strict"))&&!t(i,p.body)&&(i=!1),r=p.argnames.length,v=e.args.slice(r),s=new Set,a=r;--a>=0;){c=p.argnames[a],f=e.args[a];const t=c.definition&&c.definition();t&&t.orig.length>1||(v.unshift(u(Nt,c,{name:c,value:f})),s.has(c.name)||(s.add(c.name),c instanceof st?(l=e.args.slice(a)).every(e=>!o(p,e,i))&&b.unshift([u(Nt,c,{name:c.expression,value:u(en,e,{elements:l})})]):(f?(f instanceof at&&f.pinned()||o(p,f,i))&&(f=null):f=u(Ln,c).transform(n),f&&b.unshift([u(Nt,c,{name:c,value:f})]))))}}function s(e){var t,i;if(A.push(e),e instanceof Kt)e.left.has_side_effects(n)||b.push(A.slice()),s(e.right);else if(e instanceof Zt)s(e.left),s(e.right);else if(e instanceof Pt&&!D(e,4))s(e.expression),e.args.forEach(s);else if(e instanceof Bt)s(e.expression);else if(e instanceof Jt)s(e.condition),s(e.consequent),s(e.alternative);else if(!(e instanceof zt)||!n.option("unused")&&e instanceof Mt)e instanceof Je?(s(e.condition),e.body instanceof Ve||s(e.body)):e instanceof gt?e.value&&s(e.value):e instanceof et?(e.init&&s(e.init),e.condition&&s(e.condition),e.step&&s(e.step),e.body instanceof Ve||s(e.body)):e instanceof tt?(s(e.object),e.body instanceof Ve||s(e.body)):e instanceof At?(s(e.condition),e.body instanceof Ve||s(e.body),!e.alternative||e.alternative instanceof Ve||s(e.alternative)):e instanceof Ut?e.expressions.forEach(s):e instanceof Le?s(e.body):e instanceof Ft?(s(e.expression),e.body.forEach(s)):e instanceof Wt?"++"!=e.operator&&"--"!=e.operator||b.push(A.slice()):e instanceof Nt&&e.value&&(b.push(A.slice()),s(e.value));else for((i=(t=e.definitions.length)-200)<0&&(i=0);i<t;i++)s(e.definitions[i]);A.pop()}function a(e){var i,o;if(!(e instanceof Nt&&e.name instanceof dn)){const t=e[e instanceof Kt?"left":"expression"];return!te(t,gn)&&!te(t,Dn)&&t}if(i=e.name.definition(),t(e.name,i.orig)&&(o=i.references.length-i.replaced))return i.orig.length-i.eliminated>1&&!(e.name instanceof vn)||(o>1?(e=>{var t,n=e.value;if(n instanceof Sn&&"arguments"!=n.name&&!(t=n.definition()).undeclared)return C=t})(e):!n.exposed(i))?u(Sn,e.name,e.name):void 0}function c(e){return e[e instanceof Kt?"right":"value"]}function f(e){var t,i=new Map;return e instanceof Wt||(t=new Ui(e=>{for(var o=e;o instanceof Lt;)o=o.expression;(o instanceof Sn||o instanceof qn)&&i.set(o.name,i.get(o.name)||K(n,t,e,e,0))}),c(e).walk(t)),i}function l(t){var i,o,r,s,a;return t.name instanceof vn?(i=n.parent(),(r=(o=n.self().argnames).indexOf(t.name))<0?i.args.length=Math.min(i.args.length,o.length-1):(s=i.args)[r]&&(s[r]=u(Hn,s[r],{value:0})),!0):(a=!1,e[E].transform(new Li((e,n,i)=>a?e:e===t||e.body===t?(a=!0,e instanceof Nt?(e.value=null,e):i?Ne.skip:null):void 0,e=>{if(e instanceof Ut)switch(e.expressions.length){case 0:return null;case 1:return e.expressions[0]}})))}function p(e){for(;e instanceof Lt;)e=e.expression;return e instanceof Sn&&e.definition().scope===y&&!(_&&($.has(e.name)||k instanceof Wt||k instanceof Kt&&"="!=k.operator))}function h(){if(q)return!1;if(C)return!0;if(T instanceof Sn){var e=T.definition();if(e.references.length-e.replaced==(k instanceof Nt?1:2))return!0}return!1}function d(e){if(!e.definition)return!0;var t=e.definition();return!(1==t.orig.length&&t.orig[0]instanceof yn||t.scope.get_defun_scope()===y&&t.references.every(e=>{var t=e.scope.get_defun_scope();return"Scope"==t.TYPE&&(t=t.parent_scope),t===y}))}var v,b,E,w,x,A,F,k,C,B,S,T,$,z,q,O,M,N,H,I,j,P,R,U,L,V;if(y.pinned())return e;for(b=[],E=e.length,w=new Li(e=>{var t,o,r,s;return I?e:H?(t=w.parent(),e instanceof Kt&&"="!=e.operator&&T.equivalent_to(e.left)||e instanceof wt||e instanceof Pt&&T instanceof Lt&&T.equivalent_to(e.expression)||e instanceof Re||e instanceof pt||e instanceof st&&e.expression instanceof pn&&e.expression.definition().references.length>1||e instanceof Ze&&!(e instanceof et)||e instanceof yt||e instanceof St||e instanceof it||e instanceof xt||e instanceof jt||e instanceof un||t instanceof et&&e!==t.init||!O&&e instanceof Sn&&!e.is_declared(n)&&!lo.has(e)||e instanceof Sn&&t instanceof Pt&&D(t,4)?(I=!0,e):(S||z&&O||!(t instanceof Zt&&wi.has(t.operator)&&t.left!==e||t instanceof Jt&&t.condition!==e||t instanceof At&&t.condition!==e)||(S=t),!P||e instanceof dn||!T.equivalent_to(e)?((e instanceof Pt||e instanceof gt&&(q||T instanceof Lt||d(T))||e instanceof Lt&&(q||e.expression.may_throw_on_access(n))||e instanceof Sn&&($.get(e.name)||q&&d(e))||e instanceof Nt&&e.value&&($.has(e.name.name)||q&&d(e.name))||(s=ve(e.left,e))&&(s instanceof Lt||$.has(s.name))||M&&(m?e.has_side_effects(n):function e(t,n){if(t instanceof Kt)return e(t.left,!0);if(t instanceof Wt)return e(t.expression,!0);if(t instanceof Nt)return t.value&&e(t.value);if(n){if(t instanceof Vt)return e(t.expression,!0);if(t instanceof Yt)return e(t.expression,!0);if(t instanceof Sn)return t.definition().scope!==y}return!1}(e)))&&(B=e,e instanceof ot&&(I=!0)),i(e)):S?(I=!0,e):ve(e,t)?(C&&j++,e):(j++,C&&k instanceof Nt?e:(g=I=!0,n.info("Collapsing {name} [{file}:{line},{col}]",{name:e.print_to_string(),file:e.start.file,line:e.start.line,col:e.start.col}),k instanceof Gt?u(Xt,k,k):k instanceof Nt?(o=k.name.definition(),r=k.value,o.references.length-o.replaced!=1||n.exposed(o)?u(Kt,k,{operator:"=",left:u(Sn,k.name,k.name),right:r}):(o.replaced++,N&&de(r)?r.transform(n):se(t,e,r))):(co(k,32),k))))):e!==A[F]?e:++F<A.length?i(e):(H=!0,(B=function e(t,n,i){var o=w.parent(n);return o instanceof Kt?i&&!(o.left instanceof Lt||$.has(o.left.name))?e(o,n+1,i):t:o instanceof Zt?!i||wi.has(o.operator)&&o.left!==t?t:e(o,n+1,i):o instanceof Pt||o instanceof Bt?t:o instanceof Jt?i&&o.condition===t?e(o,n+1,i):t:o instanceof zt?e(o,n+1,!0):o instanceof gt?i?e(o,n+1,i):t:o instanceof At?i&&o.condition===t?e(o,n+1,i):t:o instanceof Ze?t:o instanceof Ut?e(o,n+1,o.tail_node()!==t):o instanceof Le?e(o,n+1,!0):o instanceof Ft||o instanceof Nt?t:null}(e,0))===e&&(I=!0),e)},e=>{I||(B===e&&(I=!0),S===e&&(S=null))}),x=new Li(e=>{if(I)return e;if(!H){if(e!==A[F])return e;if(++F<A.length)return;return H=!0,e}return e instanceof Sn&&e.name==L.name?(--j||(I=!0),ve(e,x.parent())?e:(L.replaced++,C.replaced--,k.value)):e instanceof Ct||e instanceof ot?e:void 0});--E>=0;)for(0==E&&n.option("unused")&&r(),A=[],s(e[E]);b.length>0;)if(A=b.pop(),F=0,k=A[A.length-1],C=null,B=null,S=null,(T=a(k))&&!ee(T)&&!T.has_side_effects(n)){if($=f(k),z=p(T),T instanceof Sn&&$.set(T.name,!1),q=(V=k)instanceof Wt?xi.has(V.operator):c(V).has_side_effects(n),O=h(),M=k.may_throw(n),N=k.name instanceof vn,H=N,I=!1,j=0,!(P=!v||!H)){for(R=n.self().argnames.lastIndexOf(k.name)+1;!I&&R<v.length;R++)v[R].transform(w);P=!0}for(U=E;!I&&U<e.length;U++)e[U].transform(w);if(C)if(L=k.name.definition(),I&&L.references.length-L.replaced>j)j=!1;else{for(I=!1,F=0,H=N,U=E;!I&&U<e.length;U++)e[U].transform(x);C.single_use=!1}j&&!l(k)&&e.splice(E,1)}}function o(e){var t,n,i=[];for(t=0;t<e.length;)(n=e[t])instanceof Ye&&n.body.every(fe)?(g=!0,o(n.body),e.splice(t,1,...n.body),t+=n.body.length):n instanceof We?(g=!0,e.splice(t,1)):n instanceof Ue?i.indexOf(n.value)<0?(t++,i.push(n.value)):(g=!0,e.splice(t,1)):t++}function r(e,t){function n(n){var i,o,r,s;if(!n)return!1;for(i=c+1,o=e.length;i<o;i++)if((r=e[i])instanceof Mt||r instanceof Ot)return!1;return s=n instanceof yt?t.loopcontrol_target(n):null,n instanceof Dt&&b&&(e=>!e||e instanceof Xt&&"void"==e.operator)(n.value)||n instanceof Et&&v===le(s)||n instanceof bt&&s instanceof Ye&&v===s}function i(){var t=e.slice(c+1);return e.length=c+1,t.filter(t=>!(t instanceof lt&&(e.push(t),1)))}function o(e,t){var n=ue(e).slice(0,-1);return t.value&&n.push(u(Le,t.value,{body:t.value.expression})),n}function r(t){var n,i,o;for(n=t+1,i=e.length;n<i&&(o=e[n])instanceof qt&&a(o);n++);return n}function s(t){var n,i;for(n=t;--n>=0&&(i=e[n])instanceof qt&&a(i););return n}var c,f,p,h,d,_,m,D,v=t.self(),y=(e=>{var t,n,i=0;for(t=e.length;--t>=0;)if((n=e[t])instanceof At&&n.body instanceof Dt&&++i>1)return!0;return!1})(e),b=v instanceof at;for(c=e.length;--c>=0;){if(f=e[c],p=r(c),h=e[p],b&&!h&&f instanceof Dt){if(!f.value){g=!0,e.splice(c,1);continue}if(f.value instanceof Xt&&"void"==f.value.operator){g=!0,e[c]=u(Le,f,{body:f.value.expression});continue}}if(f instanceof At){if(n(d=xe(f.body))){d.label&&l(d.label.thedef.references,d),g=!0,(f=f.clone()).condition=f.condition.negate(t),_=o(f.body,d),f.body=u(Ye,f,{body:ue(f.alternative).concat(i())}),f.alternative=u(Ye,f,{body:_}),e[c]=f.transform(t);continue}if(n(d=xe(f.alternative))){d.label&&l(d.label.thedef.references,d),g=!0,(f=f.clone()).body=u(Ye,f.body,{body:ue(f.body).concat(i())}),_=o(f.alternative,d),f.alternative=u(Ye,f.alternative,{body:_}),e[c]=f.transform(t);continue}}if(f instanceof At&&f.body instanceof Dt){if(!(m=f.body.value)&&!f.alternative&&(b&&!h||h instanceof Dt&&!h.value)){g=!0,e[c]=u(Le,f.condition,{body:f.condition});continue}if(m&&!f.alternative&&h instanceof Dt&&h.value){g=!0,(f=f.clone()).alternative=h,e[c]=f.transform(t),e.splice(p,1);continue}if(m&&!f.alternative&&(!h&&b&&y||h instanceof Dt)){g=!0,(f=f.clone()).alternative=h||u(Dt,f,{value:null}),e[c]=f.transform(t),h&&e.splice(p,1);continue}if(D=e[s(c)],t.option("sequences")&&b&&!f.alternative&&D instanceof At&&D.body instanceof Dt&&r(p)==e.length&&h instanceof Le){g=!0,(f=f.clone()).alternative=u(Ye,h,{body:[h,u(Dt,h,{value:null})]}),e[c]=f.transform(t),e.splice(p,1);continue}}}}function s(e,t){var n,i,o,r,s,a,u=t.self();for(i=0,o=0,r=e.length;i<r;i++)if((s=e[i])instanceof yt?(a=t.loopcontrol_target(s),s instanceof bt&&!(a instanceof Ze)&&le(a)===u||s instanceof Et&&le(a)===u?s.label&&l(s.label.thedef.references,s):e[o++]=s):e[o++]=s,xe(s)){n=e.slice(i+1);break}e.length=o,g=o!=r,n&&n.forEach(n=>{me(t,n,e)})}function a(e){return e.definitions.every(e=>!e.value)}function c(e,t){function n(){if(i.length){var t=oe(i[0],i);e[o++]=u(Le,t,{body:t}),i=[]}}var i,o,r,s,c,f;if(!(e.length<2)){for(i=[],o=0,r=0,s=e.length;r<s;r++)(c=e[r])instanceof Le?(i.length>=t.sequences_limit&&n(),f=c.body,i.length>0&&(f=f.drop_side_effect_free(t)),f&&ae(i,f)):(c instanceof zt&&a(c)||c instanceof lt||n(),e[o++]=c);n(),e.length=o,o!=s&&(g=!0)}}function f(e,t){var n,i,o,r;if(!(e instanceof Ye))return e;for(n=null,i=0,o=e.body.length;i<o;i++)if((r=e.body[i])instanceof qt&&a(r))t.push(r);else{if(n)return!1;n=r}return n}function p(e,t){function n(e){p--,g=!0;var n=i.body;return oe(n,[n,e]).transform(t)}var i,o,r,s,a,c,l,p=0;for(o=0;o<e.length;o++)r=e[o],i&&(r instanceof gt?r.value=n(r.value||u(Ln,r).transform(t)):r instanceof et?r.init instanceof zt||w(i.body,e=>e instanceof ot||(e instanceof Zt&&"in"===e.operator?Ri:void 0))||(r.init?r.init=n(r.init):(r.init=i.body,p--,g=!0)):r instanceof tt?r.init instanceof Mt||r.init instanceof Ot||(r.object=n(r.object)):r instanceof At?r.condition=n(r.condition):(r instanceof Ft||r instanceof it)&&(r.expression=n(r.expression))),t.option("conditionals")&&r instanceof At&&(s=[],a=f(r.body,s),c=f(r.alternative,s),!1!==a&&!1!==c&&s.length>0)?(l=s.length,s.push(u(At,r,{condition:r.condition,body:a||u(We,r.body),alternative:c})),s.unshift(p,1),[].splice.apply(e,s),o+=l,p+=l+1,i=null,g=!0):(e[p++]=r,i=r instanceof Le?r:null);e.length=p}function h(e,t){var i,o,r,s,a,c,f,l;if(e instanceof zt&&(i=e.definitions[e.definitions.length-1]).value instanceof tn&&(t instanceof Kt?o=[t]:t instanceof Ut&&(o=t.expressions.slice()),o)){r=!1;do{if(!((s=o[0])instanceof Kt))break;if("="!=s.operator)break;if(!(s.left instanceof Lt))break;if(!((a=s.left.expression)instanceof Sn))break;if(i.name.name!=a.name)break;if(!s.right.is_constant_expression(y))break;if((c=s.left.property)instanceof je&&(c=c.evaluate(n)),c instanceof je)break;if(c=""+c,f=n.option("ecma")<2015&&n.has_directive("use strict")?e=>e.key!=c&&e.key&&e.key.name!=c:e=>e.key&&e.key.name!=c,!i.value.properties.every(f))break;(l=i.value.properties.filter(e=>e.key===c)[0])?l.value=new Ut({start:l.start,expressions:[l.value.clone(),s.right.clone()],end:l.end}):i.value.properties.push(u(on,s,{key:c,value:s.right})),o.shift(),r=!0}while(o.length);return r&&o}}function d(e){function t(t){e[++o]=s;var n=h(u,t);return n?(g=!0,n.length?oe(t,n):t instanceof Ut?t.tail_node().left:t.left):t}var n,i,o,r,s,u,c;for(i=0,o=-1,r=e.length;i<r;i++)if(s=e[i],u=e[o],s instanceof zt)u&&u.TYPE==s.TYPE?(u.definitions=u.definitions.concat(s.definitions),g=!0):n&&n.TYPE==s.TYPE&&a(s)?(n.definitions=n.definitions.concat(s.definitions),g=!0):(e[++o]=s,n=s);else if(s instanceof gt)s.value=t(s.value);else if(s instanceof et)(c=h(u,s.init))?(g=!0,s.init=c.length?oe(s.init,c):null,e[++o]=s):u instanceof qt&&(!s.init||s.init.TYPE==u.TYPE)?(s.init&&(u.definitions=u.definitions.concat(s.init.definitions)),s.init=u,e[o]=s,g=!0):n&&s.init&&n.TYPE==s.init.TYPE&&a(s.init)?(n.definitions=n.definitions.concat(s.init.definitions),s.init=null,e[++o]=s,g=!0):e[++o]=s;else if(s instanceof tt)s.object=t(s.object);else if(s instanceof At)s.condition=t(s.condition);else if(s instanceof Le){if(c=h(u,s.body)){if(g=!0,!c.length)continue;s.body=oe(s.body,c)}e[++o]=s}else s instanceof Ft||s instanceof it?s.expression=t(s.expression):e[++o]=s;e.length=o+1}var _,m,g,v,y=n.find_parent(ot).get_defun_scope();(()=>{var e=n.self(),t=0;do{if(e instanceof Tt||e instanceof $t)t++;else if(e instanceof Ze)_=!0;else{if(e instanceof ot){y=e;break}e instanceof St&&(m=!0)}}while(e=n.parent(t++))})(),v=10;do{g=!1,o(e),n.option("dead_code")&&s(e,n),n.option("if_return")&&r(e,n),n.sequences_limit>0&&(c(e,n),p(e,n)),n.option("join_vars")&&d(e),n.option("collapse_vars")&&i(e,n)}while(g&&v-- >0)}function me(e,t,n){t instanceof lt||e.warn("Dropping unreachable code [{file}:{line},{col}]",t.start),w(t,i=>i instanceof qt?(e.warn("Declarations in unreachable code! [{file}:{line},{col}]",i.start),i.remove_initializers(),n.push(i),!0):i instanceof lt&&(i===t||!e.has_directive("use strict"))?(n.push(i===t?i:u(qt,i,{definitions:[u(Nt,i,{name:u(_n,i.name,i.name),value:null})]})),!0):i instanceof ot||void 0)}function ge(e){return e instanceof Mn?e.getValue():e instanceof Xt&&"void"==e.operator&&e.expression instanceof Mn?void 0:e}function De(e,t){return ao(e,8)||e instanceof Ln||e instanceof Xt&&"void"==e.operator&&!e.expression.has_side_effects(t)}function ve(e,t){return t instanceof Wt&&xi.has(t.operator)?t.expression:t instanceof Kt&&t.left===e?e:void 0}function ye(e,t){return e.size()>t.size()?t:e}function be(e,t){return ye(u(Le,e,{body:e}),u(Le,t,{body:t})).body}function Ee(e,t,n){return(R(e)?be:ye)(t,n)}function we(e){const t=new Map;for(var n of Object.keys(e))t.set(n,h(e[n]));return t}function xe(e){return e&&e.aborts()}function Ae(e,t){return _e(e.body,t),t.option("side_effects")&&1==e.body.length&&e.body[0]===t.has_directive("use strict")&&(e.body.length=0),e}function Fe(e,t){var n=!1,i=new Ui(t=>!!(n||t instanceof ot)||(t instanceof yt&&i.loopcontrol_target(t)===e?n=!0:void 0));return t instanceof Ge&&i.push(t),i.push(e),e.body.walk(i),n}function ke(e,t){return t.top_retain&&e instanceof lt&&ao(e,1024)&&e.name&&t.top_retain(e.name)}function Ce(e,t){var n,i,o;for(i=0;(n=e.parent(i))&&(!(n instanceof at||n instanceof un)||!(o=n.name)||o.definition()!==t);i++);return n}function Be(e,t){for(const n of t.enclosed){if(t.variables.has(n.name))continue;const i=e.find_variable(n.name);if(i){if(i===n)continue;return!0}}return!1}function Se(e,t){return e instanceof Sn||e.TYPE===t.TYPE}function Te(e,n){const i=e=>{if(e instanceof Sn&&t(e.definition(),n))return Ri};return x(e,(t,n)=>{if(t instanceof ot&&t!==e){var o=n.parent();if(o instanceof Pt&&o.expression===t)return;return!w(t,i)||Ri}})}function $e(e){let t;return e instanceof Rn||De(e)||e instanceof Sn&&(t=e.definition().fixed)instanceof je&&$e(t)}function ze(e,t){return e instanceof Sn&&(e=e.fixed_value()),!!e&&(!(e instanceof at||e instanceof un)||!(e instanceof at&&e.contains_this())||t.parent()instanceof Rt)}function qe(e,t){return t.in_boolean_context()?Ee(t,e,oe(e,[e,u(Gn,e)]).optimize(t)):e}function Oe(e,t,n){var i,o,r;for(i=0;i<n.length;i++)(o=n[i])instanceof st&&(r=o.expression)instanceof en&&(n.splice(i,1,...r.elements),i--);return e}function Me(e,t){if(!t.option("computed_props"))return e
	;if(!(e.key instanceof Mn))return e;if(e.key instanceof Nn||e.key instanceof Hn){if("__proto__"===e.key.value)return e;if("constructor"==e.key.value&&t.parent()instanceof un)return e;e.key=e instanceof on?e.key.value:u(e instanceof cn?En:bn,e.key,{name:e.key.value})}return e}var Ne,He,Ie,je,Pe,Re,Ue,Le,Ve,Ye,We,Xe,Ge,Ze,Je,Ke,Qe,et,tt,nt,it,ot,rt,st,at,ut,ct,ft,lt,pt,ht,dt,_t,mt,gt,Dt,vt,yt,bt,Et,wt,xt,At,Ft,kt,Ct,Bt,St,Tt,$t,zt,qt,Ot,Mt,Nt,Ht,It,jt,Pt,Rt,Ut,Lt,Vt,Yt,Wt,Xt,Gt,Zt,Jt,Kt,Qt,en,tn,nn,on,rn,sn,an,un,cn,fn,ln,pn,hn,dn,_n,mn,gn,Dn,vn,yn,bn,En,wn,xn,An,Fn,kn,Cn,Bn,Sn,Tn,$n,zn,qn,On,Mn,Nn,Hn,In,jn,Pn,Rn,Un,Ln,Vn,Yn,Wn,Xn,Gn,Zn,Jn,Kn,Qn,ei,ti,ni,ii,oi,ri,si,ai,ui,ci,fi,li,pi,hi,di,_i,mi,gi,Di,vi,yi,bi,Ei,wi,xi,Ai,Fi,ki,Ci,Bi,Si,Ti,$i,zi,qi,Oi,Mi,Ni,Hi,Ii,ji;class Pi extends Error{constructor(e,t){super(),this.name="DefaultsError",this.message=e,this.defs=t}}Ne=function(){function e(e,r,s){function a(){var a=r(e[u],u),l=a instanceof i;return l&&(a=a.v),a instanceof t?(a=a.v)instanceof n?f.push.apply(f,s?a.v.slice().reverse():a.v):f.push(a):a!==o&&(a instanceof n?c.push.apply(c,s?a.v.slice().reverse():a.v):c.push(a)),l}var u,c=[],f=[];if(Array.isArray(e))if(s){for(u=e.length;--u>=0&&!a(););c.reverse(),f.reverse()}else for(u=0;u<e.length&&!a();++u);else for(u in e)if(_(e,u)&&a())break;return f.concat(c)}function t(e){this.v=e}function n(e){this.v=e}function i(e){this.v=e}e.at_top=e=>new t(e),e.splice=e=>new n(e),e.last=e=>new i(e);var o=e.skip={};return e}(),He={"\n":"n","\r":"r","\u2028":"u2028","\u2029":"u2029"},Ie=y("Token","type value line col pos endline endcol endpos nlb comments_before comments_after file raw quote end",{},null),(je=y("Node","start end",{_clone:function(e){if(e){var t=this.clone();return t.transform(new Li(e=>{if(e!==t)return e.clone(!0)}))}return new this.CTOR(this)},clone:function(e){return this._clone(e)},$documentation:"Base class of all AST nodes",$propdoc:{start:"[AST_Token] The first token of this node",end:"[AST_Token] The last token of this node"},_walk:function(e){return e._visit(this)},walk:function(e){return this._walk(e)},_children_backwards:()=>{}},null)).warn_function=null,je.warn=(e,t)=>{je.warn_function&&je.warn_function(f(e,t))},Pe=y("Statement",null,{$documentation:"Base class of all statements"}),Re=y("Debugger",null,{$documentation:"Represents a debugger statement"},Pe),Ue=y("Directive","value quote",{$documentation:'Represents a directive, like "use strict";',$propdoc:{value:"[string] The value of this directive as a plain string (it's not an AST_String!)",quote:"[string] the original quote character"}},Pe),Le=y("SimpleStatement","body",{$documentation:"A statement consisting of an expression, i.e. a = 1 + 2",$propdoc:{body:"[AST_Node] an expression node (should not be instanceof AST_Statement)"},_walk:function(e){return e._visit(this,(function(){this.body._walk(e)}))},_children_backwards(e){e(this.body)}},Pe),Ve=y("Block","body block_scope",{$documentation:"A body of statements (usually braced)",$propdoc:{body:"[AST_Statement*] an array of statements",block_scope:"[AST_Scope] the block scope"},_walk:function(e){return e._visit(this,(function(){b(this,e)}))},_children_backwards(e){let t=this.body.length;for(;t--;)e(this.body[t])},clone:E},Pe),Ye=y("BlockStatement",null,{$documentation:"A block statement"},Ve),We=y("EmptyStatement",null,{$documentation:"The empty statement (empty block or simply a semicolon)"},Pe),Xe=y("StatementWithBody","body",{$documentation:"Base class for all statements that contain one nested body: `For`, `ForIn`, `Do`, `While`, `With`",$propdoc:{body:"[AST_Statement] the body; this should always be present, even if it's an AST_EmptyStatement"}},Pe),Ge=y("LabeledStatement","label",{$documentation:"Statement with a label",$propdoc:{label:"[AST_Label] a label definition"},_walk:function(e){return e._visit(this,(function(){this.label._walk(e),this.body._walk(e)}))},_children_backwards(e){e(this.body),e(this.label)},clone:function(e){var t,n,i=this._clone(e);return e&&(t=i.label,n=this.label,i.walk(new Ui(e=>{e instanceof yt&&e.label&&e.label.thedef===n&&(e.label.thedef=t,t.references.push(e))}))),i}},Xe),Ze=y("IterationStatement","block_scope",{$documentation:"Internal class.  All loops inherit from it.",$propdoc:{block_scope:"[AST_Scope] the block scope for this iteration statement."},clone:E},Xe),Je=y("DWLoop","condition",{$documentation:"Base class for do/while statements",$propdoc:{condition:"[AST_Node] the loop condition.  Should not be instanceof AST_Statement"}},Ze),Ke=y("Do",null,{$documentation:"A `do` statement",_walk:function(e){return e._visit(this,(function(){this.body._walk(e),this.condition._walk(e)}))},_children_backwards(e){e(this.condition),e(this.body)}},Je),Qe=y("While",null,{$documentation:"A `while` statement",_walk:function(e){return e._visit(this,(function(){this.condition._walk(e),this.body._walk(e)}))},_children_backwards(e){e(this.body),e(this.condition)}},Je),et=y("For","init condition step",{$documentation:"A `for` statement",$propdoc:{init:"[AST_Node?] the `for` initialization code, or null if empty",condition:"[AST_Node?] the `for` termination clause, or null if empty",step:"[AST_Node?] the `for` update clause, or null if empty"},_walk:function(e){return e._visit(this,(function(){this.init&&this.init._walk(e),this.condition&&this.condition._walk(e),this.step&&this.step._walk(e),this.body._walk(e)}))},_children_backwards(e){e(this.body),this.step&&e(this.step),this.condition&&e(this.condition),this.init&&e(this.init)}},Ze),tt=y("ForIn","init object",{$documentation:"A `for ... in` statement",$propdoc:{init:"[AST_Node] the `for/in` initialization code",object:"[AST_Node] the object that we're looping through"},_walk:function(e){return e._visit(this,(function(){this.init._walk(e),this.object._walk(e),this.body._walk(e)}))},_children_backwards(e){e(this.body),this.object&&e(this.object),this.init&&e(this.init)}},Ze),nt=y("ForOf","await",{$documentation:"A `for ... of` statement"},tt),it=y("With","expression",{$documentation:"A `with` statement",$propdoc:{expression:"[AST_Node] the `with` expression"},_walk:function(e){return e._visit(this,(function(){this.expression._walk(e),this.body._walk(e)}))},_children_backwards(e){e(this.body),e(this.expression)}},Xe),ot=y("Scope","variables functions uses_with uses_eval parent_scope enclosed cname _var_name_cache",{$documentation:"Base class for all statements introducing a lexical scope",$propdoc:{variables:"[Map/S] a map of name -> SymbolDef for all variables/functions defined in this scope",functions:"[Map/S] like `variables`, but only lists function declarations",uses_with:"[boolean/S] tells whether this scope uses the `with` statement",uses_eval:"[boolean/S] tells whether this scope contains a direct call to the global `eval`",parent_scope:"[AST_Scope?/S] link to the parent scope",enclosed:"[SymbolDef*/S] a list of all symbol definitions that are accessed from this scope or any subscopes",cname:"[integer/S] current index for mangling variables (used internally by the mangler)"},get_defun_scope:function(){for(var e=this;e.is_block_scope();)e=e.parent_scope;return e},clone:function(e){var t=this._clone(e);return this.variables&&(t.variables=new Map(this.variables)),this.functions&&(t.functions=new Map(this.functions)),this.enclosed&&(t.enclosed=this.enclosed.slice()),this._block_scope&&(t._block_scope=this._block_scope),t},pinned:function(){return this.uses_eval||this.uses_with}},Ve),rt=y("Toplevel","globals",{$documentation:"The toplevel scope",$propdoc:{globals:"[Map/S] a map of name -> SymbolDef for all undeclared names"},wrap_commonjs:function(e){var t=this.body,n="(function(exports){'$ORIG';})(typeof "+e+"=='undefined'?("+e+"={}):"+e+");";return(n=N(n)).transform(new Li(e=>{if(e instanceof Ue&&"$ORIG"==e.value)return Ne.splice(t)}))},wrap_enclose:function(e){var t,n;return"string"!=typeof e&&(e=""),(t=e.indexOf(":"))<0&&(t=e.length),n=this.body,N("(function("+e.slice(0,t)+'){"$ORIG"})('+e.slice(t+1)+")").transform(new Li(e=>{if(e instanceof Ue&&"$ORIG"==e.value)return Ne.splice(n)}))}},ot),st=y("Expansion","expression",{$documentation:"An expandible argument, such as ...rest, a splat, such as [1,2,...all], or an expansion in a variable declaration, such as var [first, ...rest] = list",$propdoc:{expression:"[AST_Node] the thing to be expanded"},_walk:function(e){return e._visit(this,(function(){this.expression.walk(e)}))},_children_backwards(e){e(this.expression)}}),at=y("Lambda","name argnames uses_arguments is_generator async",{$documentation:"Base class for functions",$propdoc:{name:"[AST_SymbolDeclaration?] the name of this function",argnames:"[AST_SymbolFunarg|AST_Destructuring|AST_Expansion|AST_DefaultAssign*] array of function arguments, destructurings, or expanding arguments",uses_arguments:"[boolean/S] tells whether this function accesses the arguments array",is_generator:"[boolean] is this a generator method",async:"[boolean] is this method async"},args_as_names:function(){var e,t=[];for(e=0;e<this.argnames.length;e++)this.argnames[e]instanceof pt?t.push(...this.argnames[e].all_symbols()):t.push(this.argnames[e]);return t},_walk:function(e){return e._visit(this,(function(){var t,n,i;for(this.name&&this.name._walk(e),n=0,i=(t=this.argnames).length;n<i;n++)t[n]._walk(e);b(this,e)}))},_children_backwards(e){let t=this.body.length;for(;t--;)e(this.body[t]);for(t=this.argnames.length;t--;)e(this.argnames[t]);this.name&&e(this.name)}},ot),ut=y("Accessor",null,{$documentation:"A setter/getter function.  The `name` property is always null."},at),ct=y("Function",null,{$documentation:"A function expression"},at),ft=y("Arrow",null,{$documentation:"An ES6 Arrow function ((a) => b)"},at),lt=y("Defun",null,{$documentation:"A function definition"},at),pt=y("Destructuring","names is_array",{$documentation:"A destructuring of several names. Used in destructuring assignment and with destructuring function argument names",$propdoc:{names:"[AST_Node*] Array of properties or elements",is_array:"[Boolean] Whether the destructuring represents an object or array"},_walk:function(e){return e._visit(this,(function(){this.names.forEach(t=>{t._walk(e)})}))},_children_backwards(e){let t=this.names.length;for(;t--;)e(this.names[t])},all_symbols:function(){var e=[];return this.walk(new Ui(t=>{t instanceof pn&&e.push(t)})),e}}),ht=y("PrefixedTemplateString","template_string prefix",{$documentation:"A templatestring with a prefix, such as String.raw`foobarbaz`",$propdoc:{template_string:"[AST_TemplateString] The template string",prefix:"[AST_SymbolRef|AST_PropAccess] The prefix, which can be a symbol such as `foo` or a dotted expression such as `String.raw`."},_walk:function(e){return e._visit(this,(function(){this.prefix._walk(e),this.template_string._walk(e)}))},_children_backwards(e){e(this.template_string),e(this.prefix)}}),dt=y("TemplateString","segments",{$documentation:"A template string literal",$propdoc:{segments:"[AST_Node*] One or more segments, starting with AST_TemplateSegment. AST_Node may follow AST_TemplateSegment, but each AST_Node must be followed by AST_TemplateSegment."},_walk:function(e){return e._visit(this,(function(){this.segments.forEach(t=>{t._walk(e)})}))},_children_backwards(e){let t=this.segments.length;for(;t--;)e(this.segments[t])}}),_t=y("TemplateSegment","value raw",{$documentation:"A segment of a template string literal",$propdoc:{value:"Content of the segment",raw:"Raw content of the segment"}}),mt=y("Jump",null,{$documentation:"Base class for “jumps” (for now that's `return`, `throw`, `break` and `continue`)"},Pe),gt=y("Exit","value",{$documentation:"Base class for “exits” (`return` and `throw`)",$propdoc:{value:"[AST_Node?] the value returned or thrown by this statement; could be null for AST_Return"},_walk:function(e){return e._visit(this,this.value&&function(){this.value._walk(e)})},_children_backwards(e){this.value&&e(this.value)}},mt),Dt=y("Return",null,{$documentation:"A `return` statement"},gt),vt=y("Throw",null,{$documentation:"A `throw` statement"},gt),yt=y("LoopControl","label",{$documentation:"Base class for loop control statements (`break` and `continue`)",$propdoc:{label:"[AST_LabelRef?] the label, or null if none"},_walk:function(e){return e._visit(this,this.label&&function(){this.label._walk(e)})},_children_backwards(e){this.label&&e(this.label)}},mt),bt=y("Break",null,{$documentation:"A `break` statement"},yt),Et=y("Continue",null,{$documentation:"A `continue` statement"},yt),wt=y("Await","expression",{$documentation:"An `await` statement",$propdoc:{expression:"[AST_Node] the mandatory expression being awaited"},_walk:function(e){return e._visit(this,(function(){this.expression._walk(e)}))},_children_backwards(e){e(this.expression)}}),xt=y("Yield","expression is_star",{$documentation:"A `yield` statement",$propdoc:{expression:"[AST_Node?] the value returned or thrown by this statement; could be null (representing undefined) but only when is_star is set to false",is_star:"[Boolean] Whether this is a yield or yield* statement"},_walk:function(e){return e._visit(this,this.expression&&function(){this.expression._walk(e)})},_children_backwards(e){this.expression&&e(this.expression)}}),At=y("If","condition alternative",{$documentation:"A `if` statement",$propdoc:{condition:"[AST_Node] the `if` condition",alternative:"[AST_Statement?] the `else` part, or null if not present"},_walk:function(e){return e._visit(this,(function(){this.condition._walk(e),this.body._walk(e),this.alternative&&this.alternative._walk(e)}))},_children_backwards(e){this.alternative&&e(this.alternative),e(this.body),e(this.condition)}},Xe),Ft=y("Switch","expression",{$documentation:"A `switch` statement",$propdoc:{expression:"[AST_Node] the `switch` “discriminant”"},_walk:function(e){return e._visit(this,(function(){this.expression._walk(e),b(this,e)}))},_children_backwards(e){let t=this.body.length;for(;t--;)e(this.body[t]);e(this.expression)}},Ve),kt=y("SwitchBranch",null,{$documentation:"Base class for `switch` branches"},Ve),Ct=y("Default",null,{$documentation:"A `default` switch branch"},kt),Bt=y("Case","expression",{$documentation:"A `case` switch branch",$propdoc:{expression:"[AST_Node] the `case` expression"},_walk:function(e){return e._visit(this,(function(){this.expression._walk(e),b(this,e)}))},_children_backwards(e){let t=this.body.length;for(;t--;)e(this.body[t]);e(this.expression)}},kt),St=y("Try","bcatch bfinally",{$documentation:"A `try` statement",$propdoc:{bcatch:"[AST_Catch?] the catch block, or null if not present",bfinally:"[AST_Finally?] the finally block, or null if not present"},_walk:function(e){return e._visit(this,(function(){b(this,e),this.bcatch&&this.bcatch._walk(e),this.bfinally&&this.bfinally._walk(e)}))},_children_backwards(e){this.bfinally&&e(this.bfinally),this.bcatch&&e(this.bcatch);let t=this.body.length;for(;t--;)e(this.body[t])}},Ve),Tt=y("Catch","argname",{$documentation:"A `catch` node; only makes sense as part of a `try` statement",$propdoc:{argname:"[AST_SymbolCatch|AST_Destructuring|AST_Expansion|AST_DefaultAssign] symbol for the exception"},_walk:function(e){return e._visit(this,(function(){this.argname&&this.argname._walk(e),b(this,e)}))},_children_backwards(e){let t=this.body.length;for(;t--;)e(this.body[t]);this.argname&&e(this.argname)}},Ve),$t=y("Finally",null,{$documentation:"A `finally` node; only makes sense as part of a `try` statement"},Ve),zt=y("Definitions","definitions",{$documentation:"Base class for `var` or `const` nodes (variable declarations/initializations)",$propdoc:{definitions:"[AST_VarDef*] array of variable definitions"},_walk:function(e){return e._visit(this,(function(){var t,n,i=this.definitions;for(t=0,n=i.length;t<n;t++)i[t]._walk(e)}))},_children_backwards(e){let t=this.definitions.length;for(;t--;)e(this.definitions[t])}},Pe),qt=y("Var",null,{$documentation:"A `var` statement"},zt),Ot=y("Let",null,{$documentation:"A `let` statement"},zt),Mt=y("Const",null,{$documentation:"A `const` statement"},zt),Nt=y("VarDef","name value",{$documentation:"A variable declaration; only appears in a AST_Definitions node",$propdoc:{name:"[AST_Destructuring|AST_SymbolConst|AST_SymbolLet|AST_SymbolVar] name of the variable",value:"[AST_Node?] initializer, or null of there's no initializer"},_walk:function(e){return e._visit(this,(function(){this.name._walk(e),this.value&&this.value._walk(e)}))},_children_backwards(e){this.value&&e(this.value),e(this.name)}}),Ht=y("NameMapping","foreign_name name",{$documentation:"The part of the export/import statement that declare names from a module.",$propdoc:{foreign_name:"[AST_SymbolExportForeign|AST_SymbolImportForeign] The name being exported/imported (as specified in the module)",name:"[AST_SymbolExport|AST_SymbolImport] The name as it is visible to this module."},_walk:function(e){return e._visit(this,(function(){this.foreign_name._walk(e),this.name._walk(e)}))},_children_backwards(e){e(this.name),e(this.foreign_name)}}),It=y("Import","imported_name imported_names module_name",{$documentation:"An `import` statement",$propdoc:{imported_name:"[AST_SymbolImport] The name of the variable holding the module's default export.",imported_names:"[AST_NameMapping*] The names of non-default imported variables",module_name:"[AST_String] String literal describing where this module came from"},_walk:function(e){return e._visit(this,(function(){this.imported_name&&this.imported_name._walk(e),this.imported_names&&this.imported_names.forEach(t=>{t._walk(e)}),this.module_name._walk(e)}))},_children_backwards(e){if(e(this.module_name),this.imported_names){let t=this.imported_names.length;for(;t--;)e(this.imported_names[t])}this.imported_name&&e(this.imported_name)}}),jt=y("Export","exported_definition exported_value is_default exported_names module_name",{$documentation:"An `export` statement",$propdoc:{exported_definition:"[AST_Defun|AST_Definitions|AST_DefClass?] An exported definition",exported_value:"[AST_Node?] An exported value",exported_names:"[AST_NameMapping*?] List of exported names",module_name:"[AST_String?] Name of the file to load exports from",is_default:"[Boolean] Whether this is the default exported value of this module"},_walk:function(e){return e._visit(this,(function(){this.exported_definition&&this.exported_definition._walk(e),this.exported_value&&this.exported_value._walk(e),this.exported_names&&this.exported_names.forEach(t=>{t._walk(e)}),this.module_name&&this.module_name._walk(e)}))},_children_backwards(e){if(this.module_name&&e(this.module_name),this.exported_names){let t=this.exported_names.length;for(;t--;)e(this.exported_names[t])}this.exported_value&&e(this.exported_value),this.exported_definition&&e(this.exported_definition)}},Pe),Pt=y("Call","expression args _annotations",{$documentation:"A function call expression",$propdoc:{expression:"[AST_Node] expression to invoke as function",args:"[AST_Node*] array of arguments",_annotations:"[number] bitfield containing information about the call"},initialize(){null==this._annotations&&(this._annotations=0)},_walk(e){return e._visit(this,(function(){var t,n,i=this.args;for(t=0,n=i.length;t<n;t++)i[t]._walk(e);this.expression._walk(e)}))},_children_backwards(e){let t=this.args.length;for(;t--;)e(this.args[t]);e(this.expression)}}),Rt=y("New",null,{$documentation:"An object instantiation.  Derives from a function call since it has exactly the same properties"},Pt),Ut=y("Sequence","expressions",{$documentation:"A sequence expression (comma-separated expressions)",$propdoc:{expressions:"[AST_Node*] array of expressions (at least two)"},_walk:function(e){return e._visit(this,(function(){this.expressions.forEach(t=>{t._walk(e)})}))},_children_backwards(e){let t=this.expressions.length;for(;t--;)e(this.expressions[t])}}),Lt=y("PropAccess","expression property",{$documentation:'Base class for property access expressions, i.e. `a.foo` or `a["foo"]`',$propdoc:{expression:"[AST_Node] the “container” expression",property:"[AST_Node|string] the property to access.  For AST_Dot this is always a plain string, while for AST_Sub it's an arbitrary AST_Node"}}),Vt=y("Dot","quote",{$documentation:"A dotted property access expression",$propdoc:{quote:"[string] the original quote character when transformed from AST_Sub"},_walk:function(e){return e._visit(this,(function(){this.expression._walk(e)}))},_children_backwards(e){e(this.expression)}},Lt),Yt=y("Sub",null,{$documentation:'Index-style property access, i.e. `a["foo"]`',_walk:function(e){return e._visit(this,(function(){this.expression._walk(e),this.property._walk(e)}))},_children_backwards(e){e(this.property),e(this.expression)}},Lt),Wt=y("Unary","operator expression",{$documentation:"Base class for unary expressions",$propdoc:{operator:"[string] the operator",expression:"[AST_Node] expression that this unary operator applies to"},_walk:function(e){return e._visit(this,(function(){this.expression._walk(e)}))},_children_backwards(e){e(this.expression)}}),Xt=y("UnaryPrefix",null,{$documentation:"Unary prefix expression, i.e. `typeof i` or `++i`"},Wt),Gt=y("UnaryPostfix",null,{$documentation:"Unary postfix expression, i.e. `i++`"},Wt),Zt=y("Binary","operator left right",{$documentation:"Binary expression, i.e. `a + b`",$propdoc:{left:"[AST_Node] left-hand side expression",operator:"[string] the operator",right:"[AST_Node] right-hand side expression"},_walk:function(e){return e._visit(this,(function(){this.left._walk(e),this.right._walk(e)}))},_children_backwards(e){e(this.right),e(this.left)}}),Jt=y("Conditional","condition consequent alternative",{$documentation:"Conditional expression using the ternary operator, i.e. `a ? b : c`",$propdoc:{condition:"[AST_Node]",consequent:"[AST_Node]",alternative:"[AST_Node]"},_walk:function(e){return e._visit(this,(function(){this.condition._walk(e),this.consequent._walk(e),this.alternative._walk(e)}))},_children_backwards(e){e(this.alternative),e(this.consequent),e(this.condition)}}),Kt=y("Assign",null,{$documentation:"An assignment expression — `a = b + 5`"},Zt),Qt=y("DefaultAssign",null,{$documentation:"A default assignment expression like in `(a = 3) => a`"},Zt),en=y("Array","elements",{$documentation:"An array literal",$propdoc:{elements:"[AST_Node*] array of elements"},_walk:function(e){return e._visit(this,(function(){var t,n,i=this.elements;for(t=0,n=i.length;t<n;t++)i[t]._walk(e)}))},_children_backwards(e){let t=this.elements.length;for(;t--;)e(this.elements[t])}}),tn=y("Object","properties",{$documentation:"An object literal",$propdoc:{properties:"[AST_ObjectProperty*] array of properties"},_walk:function(e){return e._visit(this,(function(){var t,n,i=this.properties;for(t=0,n=i.length;t<n;t++)i[t]._walk(e)}))},_children_backwards(e){let t=this.properties.length;for(;t--;)e(this.properties[t])}}),nn=y("ObjectProperty","key value",{$documentation:"Base class for literal object properties",$propdoc:{key:"[string|AST_Node] property name. For ObjectKeyVal this is a string. For getters, setters and computed property this is an AST_Node.",value:"[AST_Node] property value.  For getters and setters this is an AST_Accessor."},_walk:function(e){return e._visit(this,(function(){this.key instanceof je&&this.key._walk(e),this.value._walk(e)}))},_children_backwards(e){e(this.value),this.key instanceof je&&e(this.key)}}),on=y("ObjectKeyVal","quote",{$documentation:"A key: value object property",$propdoc:{quote:"[string] the original quote character"},computed_key(){return this.key instanceof je}},nn),rn=y("ObjectSetter","quote static",{$propdoc:{quote:"[string|undefined] the original quote character, if any",static:"[boolean] whether this is a static setter (classes only)"},$documentation:"An object setter property",computed_key(){return!(this.key instanceof bn)}},nn),sn=y("ObjectGetter","quote static",{$propdoc:{quote:"[string|undefined] the original quote character, if any",static:"[boolean] whether this is a static getter (classes only)"},$documentation:"An object getter property",computed_key(){return!(this.key instanceof bn)}},nn),an=y("ConciseMethod","quote static is_generator async",{$propdoc:{quote:"[string|undefined] the original quote character, if any",static:"[boolean] is this method static (classes only)",is_generator:"[boolean] is this a generator method",async:"[boolean] is this method async"},$documentation:"An ES6 concise method inside an object or class",computed_key(){return!(this.key instanceof bn)}},nn),un=y("Class","name extends properties",{$propdoc:{name:"[AST_SymbolClass|AST_SymbolDefClass?] optional class name.",extends:"[AST_Node]? optional parent class",properties:"[AST_ObjectProperty*] array of properties"},$documentation:"An ES6 class",_walk:function(e){return e._visit(this,(function(){this.name&&this.name._walk(e),this.extends&&this.extends._walk(e),this.properties.forEach(t=>t._walk(e))}))},_children_backwards(e){let t=this.properties.length;for(;t--;)e(this.properties[t]);this.extends&&e(this.extends),this.name&&e(this.name)}},ot),cn=y("ClassProperty","static quote",{$documentation:"A class property",$propdoc:{static:"[boolean] whether this is a static key",quote:"[string] which quote is being used"},_walk:function(e){return e._visit(this,(function(){this.key instanceof je&&this.key._walk(e),this.value instanceof je&&this.value._walk(e)}))},_children_backwards(e){this.value instanceof je&&e(this.value),this.key instanceof je&&e(this.key)},computed_key(){return!(this.key instanceof En)}},nn),fn=y("DefClass",null,{$documentation:"A class definition"},un),ln=y("ClassExpression",null,{$documentation:"A class expression."},un),pn=y("Symbol","scope name thedef",{$propdoc:{name:"[string] name of this symbol",scope:"[AST_Scope/S] the current scope (not necessarily the definition scope)",thedef:"[SymbolDef/S] the definition of this symbol"},$documentation:"Base class for all symbols"}),hn=y("NewTarget",null,{$documentation:"A reference to new.target"}),dn=y("SymbolDeclaration","init",{$documentation:"A declaration symbol (symbol in var/const, function name or argument, symbol in catch)"},pn),_n=y("SymbolVar",null,{$documentation:"Symbol defining a variable"},dn),mn=y("SymbolBlockDeclaration",null,{$documentation:"Base class for block-scoped declaration symbols"},dn),gn=y("SymbolConst",null,{$documentation:"A constant declaration"},mn),Dn=y("SymbolLet",null,{$documentation:"A block-scoped `let` declaration"},mn),vn=y("SymbolFunarg",null,{$documentation:"Symbol naming a function argument"},_n),yn=y("SymbolDefun",null,{$documentation:"Symbol defining a function"},dn),bn=y("SymbolMethod",null,{$documentation:"Symbol in an object defining a method"},pn),En=y("SymbolClassProperty",null,{$documentation:"Symbol for a class property"},pn),wn=y("SymbolLambda",null,{$documentation:"Symbol naming a function expression"},dn),xn=y("SymbolDefClass",null,{$documentation:"Symbol naming a class's name in a class declaration. Lexically scoped to its containing scope, and accessible within the class."},mn),An=y("SymbolClass",null,{$documentation:"Symbol naming a class's name. Lexically scoped to the class."},dn),Fn=y("SymbolCatch",null,{$documentation:"Symbol naming the exception in catch"},mn),kn=y("SymbolImport",null,{$documentation:"Symbol referring to an imported name"},mn),Cn=y("SymbolImportForeign",null,{$documentation:"A symbol imported from a module, but it is defined in the other module, and its real name is irrelevant for this module's purposes"},pn),Bn=y("Label","references",{$documentation:"Symbol naming a label (declaration)",$propdoc:{references:"[AST_LoopControl*] a list of nodes referring to this label"},initialize:function(){this.references=[],this.thedef=this}},pn),Sn=y("SymbolRef",null,{$documentation:"Reference to some symbol (not definition/declaration)"},pn),Tn=y("SymbolExport",null,{$documentation:"Symbol referring to a name to export"},Sn),$n=y("SymbolExportForeign",null,{$documentation:"A symbol exported from this module, but it is used in the other module, and its real name is irrelevant for this module's purposes"},pn),zn=y("LabelRef",null,{$documentation:"Reference to a label symbol"},pn),qn=y("This",null,{$documentation:"The `this` symbol"},pn),On=y("Super",null,{$documentation:"The `super` symbol"},qn),Mn=y("Constant",null,{$documentation:"Base class for all constants",getValue:function(){return this.value}}),Nn=y("String","value quote",{$documentation:"A string literal",$propdoc:{value:"[string] the contents of this string",quote:"[string] the original quote character"}},Mn),Hn=y("Number","value literal",{$documentation:"A number literal",$propdoc:{value:"[number] the numeric value",literal:"[string] numeric value as string (optional)"}},Mn),In=y("BigInt","value",{$documentation:"A big int literal",$propdoc:{value:"[string] big int value"}},Mn),jn=y("RegExp","value",{$documentation:"A regexp literal",$propdoc:{value:"[RegExp] the actual regexp"}},Mn),Pn=y("Atom",null,{$documentation:"Base class for atoms"},Mn),Rn=y("Null",null,{$documentation:"The `null` atom",value:null},Pn),Un=y("NaN",null,{$documentation:"The impossible value",value:NaN},Pn),Ln=y("Undefined",null,{$documentation:"The `undefined` value",value:void 0},Pn),Vn=y("Hole",null,{$documentation:"A hole in an array",value:void 0},Pn),Yn=y("Infinity",null,{$documentation:"The `Infinity` value",value:1/0},Pn),Wn=y("Boolean",null,{$documentation:"Base class for booleans"},Pn),Xn=y("False",null,{$documentation:"The `false` atom",value:!1},Wn),Gn=y("True",null,{$documentation:"The `true` atom",value:!0},Wn);const Ri=Symbol("abort walk");class Ui{constructor(e){this.visit=e,this.stack=[],this.directives=Object.create(null)}_visit(e,t){this.push(e);var n=this.visit(e,t?()=>{t.call(e)}:i);return!n&&t&&t.call(e),this.pop(),n}parent(e){return this.stack[this.stack.length-2-(e||0)]}push(e){e instanceof at?this.directives=Object.create(this.directives):e instanceof Ue&&!this.directives[e.value]?this.directives[e.value]=e:e instanceof un&&(this.directives=Object.create(this.directives),this.directives["use strict"]||(this.directives["use strict"]=e)),this.stack.push(e)}pop(){var e=this.stack.pop();(e instanceof at||e instanceof un)&&(this.directives=Object.getPrototypeOf(this.directives))}self(){return this.stack[this.stack.length-1]}find_parent(e){var t,n,i=this.stack;for(t=i.length;--t>=0;)if((n=i[t])instanceof e)return n}has_directive(e){var t,n,i,o=this.directives[e];if(o)return o;if((t=this.stack[this.stack.length-1])instanceof ot&&t.body)for(n=0;n<t.body.length&&(i=t.body[n])instanceof Ue;++n)if(i.value==e)return i}loopcontrol_target(e){var t,n,i=this.stack;if(e.label){for(t=i.length;--t>=0;)if((n=i[t])instanceof Ge&&n.label.name==e.label.name)return n.body}else for(t=i.length;--t>=0;)if((n=i[t])instanceof Ze||e instanceof bt&&n instanceof Ft)return n}}class Li extends Ui{constructor(e,t){super(),this.before=e,this.after=t}}Kn="enum implements import interface package private protected public static super this "+(Jn="false null true")+" "+(Zn="break case catch class const continue debugger default delete do else export extends finally for function if in instanceof let new return switch throw try typeof var void while with"),Qn="return new delete throw else case yield await",Zn=h(Zn),Kn=h(Kn),Qn=h(Qn),Jn=h(Jn),ei=h(e("+-*&%=<>!?|~^")),ti=/[0-9a-f]/i,ni=/^0x[0-9a-f]+$/i,ii=/^0[0-7]+$/,oi=/^0o[0-7]+$/i,ri=/^0b[01]+$/i,si=/^\d*\.?\d*(?:e[+-]?\d*(?:\d\.?|\.?\d)\d*)?$/i,ai=/^(0[xob])?[0-9a-f]+n$/i,ui=h(["in","instanceof","typeof","new","void","delete","++","--","+","-","!","~","&","|","^","*","**","/","%",">>","<<",">>>","<",">","<=",">=","==","===","!=","!==","?","=","+=","-=","/=","*=","**=","%=",">>=","<<=",">>>=","|=","^=","&=","&&","??","||"]),ci=h(e("  \n\r\t\f\v​           \u2028\u2029  　\ufeff")),fi=h(e("\n\r\u2028\u2029")),li=h(e(";]),:")),pi=h(e("[{(,;:")),hi=h(e("[]{}(),;:")),di={
	ID_Start:/[$A-Z_a-z\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0-\u08B4\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0AF9\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58-\u0C5A\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D5F-\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309B-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FD5\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA7AD\uA7B0-\uA7B7\uA7F7-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA8FD\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB65\uAB70-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]|\uD800[\uDC00-\uDC0B\uDC0D-\uDC26\uDC28-\uDC3A\uDC3C\uDC3D\uDC3F-\uDC4D\uDC50-\uDC5D\uDC80-\uDCFA\uDD40-\uDD74\uDE80-\uDE9C\uDEA0-\uDED0\uDF00-\uDF1F\uDF30-\uDF4A\uDF50-\uDF75\uDF80-\uDF9D\uDFA0-\uDFC3\uDFC8-\uDFCF\uDFD1-\uDFD5]|\uD801[\uDC00-\uDC9D\uDD00-\uDD27\uDD30-\uDD63\uDE00-\uDF36\uDF40-\uDF55\uDF60-\uDF67]|\uD802[\uDC00-\uDC05\uDC08\uDC0A-\uDC35\uDC37\uDC38\uDC3C\uDC3F-\uDC55\uDC60-\uDC76\uDC80-\uDC9E\uDCE0-\uDCF2\uDCF4\uDCF5\uDD00-\uDD15\uDD20-\uDD39\uDD80-\uDDB7\uDDBE\uDDBF\uDE00\uDE10-\uDE13\uDE15-\uDE17\uDE19-\uDE33\uDE60-\uDE7C\uDE80-\uDE9C\uDEC0-\uDEC7\uDEC9-\uDEE4\uDF00-\uDF35\uDF40-\uDF55\uDF60-\uDF72\uDF80-\uDF91]|\uD803[\uDC00-\uDC48\uDC80-\uDCB2\uDCC0-\uDCF2]|\uD804[\uDC03-\uDC37\uDC83-\uDCAF\uDCD0-\uDCE8\uDD03-\uDD26\uDD50-\uDD72\uDD76\uDD83-\uDDB2\uDDC1-\uDDC4\uDDDA\uDDDC\uDE00-\uDE11\uDE13-\uDE2B\uDE80-\uDE86\uDE88\uDE8A-\uDE8D\uDE8F-\uDE9D\uDE9F-\uDEA8\uDEB0-\uDEDE\uDF05-\uDF0C\uDF0F\uDF10\uDF13-\uDF28\uDF2A-\uDF30\uDF32\uDF33\uDF35-\uDF39\uDF3D\uDF50\uDF5D-\uDF61]|\uD805[\uDC80-\uDCAF\uDCC4\uDCC5\uDCC7\uDD80-\uDDAE\uDDD8-\uDDDB\uDE00-\uDE2F\uDE44\uDE80-\uDEAA\uDF00-\uDF19]|\uD806[\uDCA0-\uDCDF\uDCFF\uDEC0-\uDEF8]|\uD808[\uDC00-\uDF99]|\uD809[\uDC00-\uDC6E\uDC80-\uDD43]|[\uD80C\uD840-\uD868\uD86A-\uD86C\uD86F-\uD872][\uDC00-\uDFFF]|\uD80D[\uDC00-\uDC2E]|\uD811[\uDC00-\uDE46]|\uD81A[\uDC00-\uDE38\uDE40-\uDE5E\uDED0-\uDEED\uDF00-\uDF2F\uDF40-\uDF43\uDF63-\uDF77\uDF7D-\uDF8F]|\uD81B[\uDF00-\uDF44\uDF50\uDF93-\uDF9F]|\uD82C[\uDC00\uDC01]|\uD82F[\uDC00-\uDC6A\uDC70-\uDC7C\uDC80-\uDC88\uDC90-\uDC99]|\uD835[\uDC00-\uDC54\uDC56-\uDC9C\uDC9E\uDC9F\uDCA2\uDCA5\uDCA6\uDCA9-\uDCAC\uDCAE-\uDCB9\uDCBB\uDCBD-\uDCC3\uDCC5-\uDD05\uDD07-\uDD0A\uDD0D-\uDD14\uDD16-\uDD1C\uDD1E-\uDD39\uDD3B-\uDD3E\uDD40-\uDD44\uDD46\uDD4A-\uDD50\uDD52-\uDEA5\uDEA8-\uDEC0\uDEC2-\uDEDA\uDEDC-\uDEFA\uDEFC-\uDF14\uDF16-\uDF34\uDF36-\uDF4E\uDF50-\uDF6E\uDF70-\uDF88\uDF8A-\uDFA8\uDFAA-\uDFC2\uDFC4-\uDFCB]|\uD83A[\uDC00-\uDCC4]|\uD83B[\uDE00-\uDE03\uDE05-\uDE1F\uDE21\uDE22\uDE24\uDE27\uDE29-\uDE32\uDE34-\uDE37\uDE39\uDE3B\uDE42\uDE47\uDE49\uDE4B\uDE4D-\uDE4F\uDE51\uDE52\uDE54\uDE57\uDE59\uDE5B\uDE5D\uDE5F\uDE61\uDE62\uDE64\uDE67-\uDE6A\uDE6C-\uDE72\uDE74-\uDE77\uDE79-\uDE7C\uDE7E\uDE80-\uDE89\uDE8B-\uDE9B\uDEA1-\uDEA3\uDEA5-\uDEA9\uDEAB-\uDEBB]|\uD869[\uDC00-\uDED6\uDF00-\uDFFF]|\uD86D[\uDC00-\uDF34\uDF40-\uDFFF]|\uD86E[\uDC00-\uDC1D\uDC20-\uDFFF]|\uD873[\uDC00-\uDEA1]|\uD87E[\uDC00-\uDE1D]/,ID_Continue:/(?:[$0-9A-Z_a-z\xAA\xB5\xB7\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0-\u08B4\u08E3-\u0963\u0966-\u096F\u0971-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0AF9\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C00-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58-\u0C5A\u0C60-\u0C63\u0C66-\u0C6F\u0C81-\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D01-\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D5F-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1369-\u1371\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191E\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19DA\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1AB0-\u1ABD\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1CF8\u1CF9\u1D00-\u1DF5\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FD5\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA7AD\uA7B0-\uA7B7\uA7F7-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA8FD\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uA9E0-\uA9FE\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB65\uAB70-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE2F\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]|\uD800[\uDC00-\uDC0B\uDC0D-\uDC26\uDC28-\uDC3A\uDC3C\uDC3D\uDC3F-\uDC4D\uDC50-\uDC5D\uDC80-\uDCFA\uDD40-\uDD74\uDDFD\uDE80-\uDE9C\uDEA0-\uDED0\uDEE0\uDF00-\uDF1F\uDF30-\uDF4A\uDF50-\uDF7A\uDF80-\uDF9D\uDFA0-\uDFC3\uDFC8-\uDFCF\uDFD1-\uDFD5]|\uD801[\uDC00-\uDC9D\uDCA0-\uDCA9\uDD00-\uDD27\uDD30-\uDD63\uDE00-\uDF36\uDF40-\uDF55\uDF60-\uDF67]|\uD802[\uDC00-\uDC05\uDC08\uDC0A-\uDC35\uDC37\uDC38\uDC3C\uDC3F-\uDC55\uDC60-\uDC76\uDC80-\uDC9E\uDCE0-\uDCF2\uDCF4\uDCF5\uDD00-\uDD15\uDD20-\uDD39\uDD80-\uDDB7\uDDBE\uDDBF\uDE00-\uDE03\uDE05\uDE06\uDE0C-\uDE13\uDE15-\uDE17\uDE19-\uDE33\uDE38-\uDE3A\uDE3F\uDE60-\uDE7C\uDE80-\uDE9C\uDEC0-\uDEC7\uDEC9-\uDEE6\uDF00-\uDF35\uDF40-\uDF55\uDF60-\uDF72\uDF80-\uDF91]|\uD803[\uDC00-\uDC48\uDC80-\uDCB2\uDCC0-\uDCF2]|\uD804[\uDC00-\uDC46\uDC66-\uDC6F\uDC7F-\uDCBA\uDCD0-\uDCE8\uDCF0-\uDCF9\uDD00-\uDD34\uDD36-\uDD3F\uDD50-\uDD73\uDD76\uDD80-\uDDC4\uDDCA-\uDDCC\uDDD0-\uDDDA\uDDDC\uDE00-\uDE11\uDE13-\uDE37\uDE80-\uDE86\uDE88\uDE8A-\uDE8D\uDE8F-\uDE9D\uDE9F-\uDEA8\uDEB0-\uDEEA\uDEF0-\uDEF9\uDF00-\uDF03\uDF05-\uDF0C\uDF0F\uDF10\uDF13-\uDF28\uDF2A-\uDF30\uDF32\uDF33\uDF35-\uDF39\uDF3C-\uDF44\uDF47\uDF48\uDF4B-\uDF4D\uDF50\uDF57\uDF5D-\uDF63\uDF66-\uDF6C\uDF70-\uDF74]|\uD805[\uDC80-\uDCC5\uDCC7\uDCD0-\uDCD9\uDD80-\uDDB5\uDDB8-\uDDC0\uDDD8-\uDDDD\uDE00-\uDE40\uDE44\uDE50-\uDE59\uDE80-\uDEB7\uDEC0-\uDEC9\uDF00-\uDF19\uDF1D-\uDF2B\uDF30-\uDF39]|\uD806[\uDCA0-\uDCE9\uDCFF\uDEC0-\uDEF8]|\uD808[\uDC00-\uDF99]|\uD809[\uDC00-\uDC6E\uDC80-\uDD43]|[\uD80C\uD840-\uD868\uD86A-\uD86C\uD86F-\uD872][\uDC00-\uDFFF]|\uD80D[\uDC00-\uDC2E]|\uD811[\uDC00-\uDE46]|\uD81A[\uDC00-\uDE38\uDE40-\uDE5E\uDE60-\uDE69\uDED0-\uDEED\uDEF0-\uDEF4\uDF00-\uDF36\uDF40-\uDF43\uDF50-\uDF59\uDF63-\uDF77\uDF7D-\uDF8F]|\uD81B[\uDF00-\uDF44\uDF50-\uDF7E\uDF8F-\uDF9F]|\uD82C[\uDC00\uDC01]|\uD82F[\uDC00-\uDC6A\uDC70-\uDC7C\uDC80-\uDC88\uDC90-\uDC99\uDC9D\uDC9E]|\uD834[\uDD65-\uDD69\uDD6D-\uDD72\uDD7B-\uDD82\uDD85-\uDD8B\uDDAA-\uDDAD\uDE42-\uDE44]|\uD835[\uDC00-\uDC54\uDC56-\uDC9C\uDC9E\uDC9F\uDCA2\uDCA5\uDCA6\uDCA9-\uDCAC\uDCAE-\uDCB9\uDCBB\uDCBD-\uDCC3\uDCC5-\uDD05\uDD07-\uDD0A\uDD0D-\uDD14\uDD16-\uDD1C\uDD1E-\uDD39\uDD3B-\uDD3E\uDD40-\uDD44\uDD46\uDD4A-\uDD50\uDD52-\uDEA5\uDEA8-\uDEC0\uDEC2-\uDEDA\uDEDC-\uDEFA\uDEFC-\uDF14\uDF16-\uDF34\uDF36-\uDF4E\uDF50-\uDF6E\uDF70-\uDF88\uDF8A-\uDFA8\uDFAA-\uDFC2\uDFC4-\uDFCB\uDFCE-\uDFFF]|\uD836[\uDE00-\uDE36\uDE3B-\uDE6C\uDE75\uDE84\uDE9B-\uDE9F\uDEA1-\uDEAF]|\uD83A[\uDC00-\uDCC4\uDCD0-\uDCD6]|\uD83B[\uDE00-\uDE03\uDE05-\uDE1F\uDE21\uDE22\uDE24\uDE27\uDE29-\uDE32\uDE34-\uDE37\uDE39\uDE3B\uDE42\uDE47\uDE49\uDE4B\uDE4D-\uDE4F\uDE51\uDE52\uDE54\uDE57\uDE59\uDE5B\uDE5D\uDE5F\uDE61\uDE62\uDE64\uDE67-\uDE6A\uDE6C-\uDE72\uDE74-\uDE77\uDE79-\uDE7C\uDE7E\uDE80-\uDE89\uDE8B-\uDE9B\uDEA1-\uDEA3\uDEA5-\uDEA9\uDEAB-\uDEBB]|\uD869[\uDC00-\uDED6\uDF00-\uDFFF]|\uD86D[\uDC00-\uDF34\uDF40-\uDFFF]|\uD86E[\uDC00-\uDC1D\uDC20-\uDFFF]|\uD873[\uDC00-\uDEA1]|\uD87E[\uDC00-\uDE1D]|\uDB40[\uDD00-\uDDEF])+/};class Vi extends Error{constructor(e,t,n,i,o){super(),this.name="SyntaxError",this.message=e,this.filename=t,this.line=n,this.col=i,this.pos=o}}_i={},mi=h(["typeof","void","delete","--","++","!","~","-","+"]),gi=h(["--","++"]),Di=h(["=","+=","-=","/=","*=","**=","%=",">>=","<<=",">>>=","|=","^=","&="]),vi=((e,t)=>{var n,i,o;for(n=0;n<e.length;++n)for(i=e[n],o=0;o<i.length;++o)t[i[o]]=n+1;return t})([["||"],["??"],["&&"],["|"],["^"],["&"],["==","===","!=","!=="],["<",">","<=",">=","in","instanceof"],[">>","<<",">>>"],["+","-"],["*","/","%"],["**"]],{}),yi=h(["atom","num","big_int","string","regexp","name"]),H(je,i),H(Ge,(e,t)=>{e.label=e.label.transform(t),e.body=e.body.transform(t)}),H(Le,(e,t)=>{e.body=e.body.transform(t)}),H(Ve,(e,t)=>{e.body=I(e.body,t)}),H(Ke,(e,t)=>{e.body=e.body.transform(t),e.condition=e.condition.transform(t)}),H(Qe,(e,t)=>{e.condition=e.condition.transform(t),e.body=e.body.transform(t)}),H(et,(e,t)=>{e.init&&(e.init=e.init.transform(t)),e.condition&&(e.condition=e.condition.transform(t)),e.step&&(e.step=e.step.transform(t)),e.body=e.body.transform(t)}),H(tt,(e,t)=>{e.init=e.init.transform(t),e.object=e.object.transform(t),e.body=e.body.transform(t)}),H(it,(e,t)=>{e.expression=e.expression.transform(t),e.body=e.body.transform(t)}),H(gt,(e,t)=>{e.value&&(e.value=e.value.transform(t))}),H(yt,(e,t)=>{e.label&&(e.label=e.label.transform(t))}),H(At,(e,t)=>{e.condition=e.condition.transform(t),e.body=e.body.transform(t),e.alternative&&(e.alternative=e.alternative.transform(t))}),H(Ft,(e,t)=>{e.expression=e.expression.transform(t),e.body=I(e.body,t)}),H(Bt,(e,t)=>{e.expression=e.expression.transform(t),e.body=I(e.body,t)}),H(St,(e,t)=>{e.body=I(e.body,t),e.bcatch&&(e.bcatch=e.bcatch.transform(t)),e.bfinally&&(e.bfinally=e.bfinally.transform(t))}),H(Tt,(e,t)=>{e.argname&&(e.argname=e.argname.transform(t)),e.body=I(e.body,t)}),H(zt,(e,t)=>{e.definitions=I(e.definitions,t)}),H(Nt,(e,t)=>{e.name=e.name.transform(t),e.value&&(e.value=e.value.transform(t))}),H(pt,(e,t)=>{e.names=I(e.names,t)}),H(at,(e,t)=>{e.name&&(e.name=e.name.transform(t)),e.argnames=I(e.argnames,t),e.body instanceof je?e.body=e.body.transform(t):e.body=I(e.body,t)}),H(Pt,(e,t)=>{e.expression=e.expression.transform(t),e.args=I(e.args,t)}),H(Ut,(e,t)=>{const n=I(e.expressions,t);e.expressions=n.length?n:[new Hn({value:0})]}),H(Vt,(e,t)=>{e.expression=e.expression.transform(t)}),H(Yt,(e,t)=>{e.expression=e.expression.transform(t),e.property=e.property.transform(t)}),H(xt,(e,t)=>{e.expression&&(e.expression=e.expression.transform(t))}),H(wt,(e,t)=>{e.expression=e.expression.transform(t)}),H(Wt,(e,t)=>{e.expression=e.expression.transform(t)}),H(Zt,(e,t)=>{e.left=e.left.transform(t),e.right=e.right.transform(t)}),H(Jt,(e,t)=>{e.condition=e.condition.transform(t),e.consequent=e.consequent.transform(t),e.alternative=e.alternative.transform(t)}),H(en,(e,t)=>{e.elements=I(e.elements,t)}),H(tn,(e,t)=>{e.properties=I(e.properties,t)}),H(nn,(e,t)=>{e.key instanceof je&&(e.key=e.key.transform(t)),e.value&&(e.value=e.value.transform(t))}),H(un,(e,t)=>{e.name&&(e.name=e.name.transform(t)),e.extends&&(e.extends=e.extends.transform(t)),e.properties=I(e.properties,t)}),H(st,(e,t)=>{e.expression=e.expression.transform(t)}),H(Ht,(e,t)=>{e.foreign_name=e.foreign_name.transform(t),e.name=e.name.transform(t)}),H(It,(e,t)=>{e.imported_name&&(e.imported_name=e.imported_name.transform(t)),e.imported_names&&I(e.imported_names,t),e.module_name=e.module_name.transform(t)}),H(jt,(e,t)=>{e.exported_definition&&(e.exported_definition=e.exported_definition.transform(t)),e.exported_value&&(e.exported_value=e.exported_value.transform(t)),e.exported_names&&I(e.exported_names,t),e.module_name&&(e.module_name=e.module_name.transform(t))}),H(dt,(e,t)=>{e.segments=I(e.segments,t)}),H(ht,(e,t)=>{e.prefix=e.prefix.transform(t),e.template_string=e.template_string.transform(t)});let Yi=null,Wi=null;class Xi{constructor(e,t,n){this.name=t.name,this.orig=[t],this.init=n,this.eliminated=0,this.assignments=0,this.scope=e,this.replaced=0,this.global=!1,this.export=0,this.mangled_name=null,this.undeclared=!1,this.id=Xi.next_id++,this.chained=!1,this.direct_access=!1,this.escaped=0,this.recursive_refs=0,this.references=[],this.should_replace=void 0,this.single_use=!1,this.fixed=!1,Object.seal(this)}fixed_value(){return!this.fixed||this.fixed instanceof je?this.fixed:this.fixed()}unmangleable(e){return e||(e={}),!!(Yi&&Yi.has(this.id)&&m(e.keep_fnames,this.orig[0].name))||this.global&&!e.toplevel||1&this.export||this.undeclared||!e.eval&&this.scope.pinned()||(this.orig[0]instanceof wn||this.orig[0]instanceof yn)&&m(e.keep_fnames,this.orig[0].name)||this.orig[0]instanceof bn||(this.orig[0]instanceof An||this.orig[0]instanceof xn)&&m(e.keep_classnames,this.orig[0].name)}mangle(e){var t,n;const i=e.cache&&e.cache.props;if(this.global&&i&&i.has(this.name))this.mangled_name=i.get(this.name);else if(!this.mangled_name&&!this.unmangleable(e)){t=this.scope,n=this.orig[0],e.ie8&&n instanceof wn&&(t=t.parent_scope);const o=j(this);this.mangled_name=o?o.mangled_name||o.name:t.next_mangled(e,this),this.global&&i&&i.set(this.name,this.mangled_name)}}}Xi.next_id=1,ot.DEFMETHOD("figure_out_scope",(function(e,{parent_scope:t=null,toplevel:i=this}={}){function o(e,t){var n,i,o;if(u){n=0;do{t++}while(p.parent(n++)!==u)}i=p.parent(t),(e.export=i instanceof jt?1:0)&&((o=i.exported_definition)instanceof lt||o instanceof fn)&&i.is_default&&(e.export=2)}var r,s,a,u,l,p;if(e=n(e,{cache:null,ie8:!1,safari10:!1}),!(i instanceof rt))throw Error("Invalid toplevel scope");if(r=this.parent_scope=t,s=new Map,a=null,u=null,l=[],p=new Ui((t,n)=>{var i,c,h,d,_,m,g;if(t.is_block_scope()){const i=r;t.block_scope=r=new ot(t),r._block_scope=!0;const o=t instanceof Tt?i.parent_scope:i;if(r.init_scope_vars(o),r.uses_with=i.uses_with,r.uses_eval=i.uses_eval,e.safari10&&(t instanceof et||t instanceof tt)&&l.push(r),t instanceof Ft){const e=r;r=i,t.expression.walk(p),r=e;for(let e=0;e<t.body.length;e++)t.body[e].walk(p)}else n();return r=i,!0}if(t instanceof pt){const e=u;return u=t,n(),u=e,!0}if(t instanceof ot)return t.init_scope_vars(r),i=r,c=a,h=s,a=r=t,s=new Map,n(),r=i,a=c,s=h,!0;if(t instanceof Ge){if(d=t.label,s.has(d.name))throw Error(f("Label {name} defined twice",d));return s.set(d.name,d),n(),s.delete(d.name),!0}if(t instanceof it)for(_=r;_;_=_.parent_scope)_.uses_with=!0;else{if(t instanceof pn&&(t.scope=r),t instanceof Bn&&(t.thedef=t,t.references=[]),t instanceof wn)a.def_function(t,"arguments"==t.name?void 0:a);else if(t instanceof yn)o((t.scope=a.parent_scope.get_defun_scope()).def_function(t,a),1);else if(t instanceof An)o(a.def_variable(t,a),1);else if(t instanceof kn)r.def_variable(t);else if(t instanceof xn)o((t.scope=a.parent_scope).def_function(t,a),1);else if(t instanceof _n||t instanceof Dn||t instanceof gn||t instanceof Fn)(m=t instanceof mn?r.def_variable(t,null):a.def_variable(t,"SymbolVar"==t.TYPE?null:void 0)).orig.every(e=>e===t||(t instanceof mn?e instanceof wn:!(e instanceof Dn||e instanceof gn)))||q(`"${t.name}" is redeclared`,t.start.file,t.start.line,t.start.col,t.start.pos),t instanceof vn||o(m,2),a!==r&&(t.mark_enclosed(),m=r.find_variable(t),t.thedef!==m&&(t.thedef=m,t.reference()));else if(t instanceof zn){if(!(g=s.get(t.name)))throw Error(f("Undefined label {name} [{line},{col}]",{name:t.name,line:t.start.line,col:t.start.col}));t.thedef=g}r instanceof rt||!(t instanceof jt||t instanceof It)||q(`"${t.TYPE}" statement may only appear at the top level`,t.start.file,t.start.line,t.start.col,t.start.pos)}}),this.walk(p),this instanceof rt&&(this.globals=new Map),p=new Ui(e=>{var t,n,o,r;if(e instanceof yt&&e.label)return e.label.thedef.references.push(e),!0;if(e instanceof Sn){if("eval"==(t=e.name)&&p.parent()instanceof Pt)for(n=e.scope;n&&!n.uses_eval;n=n.parent_scope)n.uses_eval=!0;return p.parent()instanceof Ht&&p.parent(1).module_name||!(o=e.scope.find_variable(t))?(o=i.def_global(e),e instanceof Tn&&(o.export=1)):o.scope instanceof at&&"arguments"==t&&(o.scope.uses_arguments=!0),e.thedef=o,e.reference(),!e.scope.is_block_scope()||o.orig[0]instanceof mn||(e.scope=e.scope.get_defun_scope()),!0}if(e instanceof Fn&&(r=j(e.definition())))for(n=e.scope;n&&(c(n.enclosed,r),n!==r.scope);)n=n.parent_scope}),this.walk(p),(e.ie8||e.safari10)&&w(this,e=>{var t,n,o,r;if(e instanceof Fn)return t=e.name,n=e.thedef.references,o=e.scope.get_defun_scope(),r=o.find_variable(t)||i.globals.get(t)||o.def_variable(e),n.forEach(e=>{e.thedef=r,e.reference()}),e.thedef=r,e.reference(),!0}),e.safari10)for(const e of l)e.parent_scope.variables.forEach(t=>{c(e.enclosed,t)})})),rt.DEFMETHOD("def_global",(function(e){var t,n=this.globals,i=e.name;return n.has(i)?n.get(i):((t=new Xi(this,e)).undeclared=!0,t.global=!0,n.set(i,t),t)})),ot.DEFMETHOD("init_scope_vars",(function(e){this.variables=new Map,this.functions=new Map,this.uses_with=!1,this.uses_eval=!1,this.parent_scope=e,this.enclosed=[],this.cname=-1,this._var_name_cache=null})),ot.DEFMETHOD("var_names",(function e(){var t=this._var_name_cache;return t||(this._var_name_cache=t=new Set(this.parent_scope?e.call(this.parent_scope):null),this._added_var_names&&this._added_var_names.forEach(e=>{t.add(e)}),this.enclosed.forEach(e=>{t.add(e.name)}),this.variables.forEach((e,n)=>{t.add(n)})),t})),ot.DEFMETHOD("add_var_name",(function(e){this._added_var_names||(this._added_var_names=new Set),this._added_var_names.add(e),this._var_name_cache||this.var_names(),this._var_name_cache.add(e)})),ot.DEFMETHOD("add_child_scope",(function(e){if(e.parent_scope===this)return;e.parent_scope=this,e._var_name_cache=null,e._added_var_names&&e._added_var_names.forEach(t=>e.add_var_name(t));const t=new Set(e.enclosed),n=(()=>{const e=[];let t=this;do{e.push(t)}while(t=t.parent_scope);return e.reverse(),e})(),i=[];for(const e of n){i.forEach(t=>c(e.enclosed,t));for(const n of e.variables.values())t.has(n)&&(c(i,n),c(e.enclosed,n))}})),je.DEFMETHOD("is_block_scope",o),un.DEFMETHOD("is_block_scope",o),at.DEFMETHOD("is_block_scope",o),rt.DEFMETHOD("is_block_scope",o),kt.DEFMETHOD("is_block_scope",o),Ve.DEFMETHOD("is_block_scope",r),ot.DEFMETHOD("is_block_scope",(function(){return this._block_scope||!1})),Ze.DEFMETHOD("is_block_scope",r),at.DEFMETHOD("init_scope_vars",(function(){ot.prototype.init_scope_vars.apply(this,arguments),this.uses_arguments=!1,this.def_variable(new vn({name:"arguments",start:this.start,end:this.end}))})),ft.DEFMETHOD("init_scope_vars",(function(){ot.prototype.init_scope_vars.apply(this,arguments),this.uses_arguments=!1})),pn.DEFMETHOD("mark_enclosed",(function(){for(var e=this.definition(),t=this.scope;t&&(c(t.enclosed,e),t!==e.scope);)t=t.parent_scope})),pn.DEFMETHOD("reference",(function(){this.definition().references.push(this),this.mark_enclosed()})),ot.DEFMETHOD("find_variable",(function(e){return e instanceof pn&&(e=e.name),this.variables.get(e)||this.parent_scope&&this.parent_scope.find_variable(e)})),ot.DEFMETHOD("def_function",(function(e,t){var n=this.def_variable(e,t);return(!n.init||n.init instanceof lt)&&(n.init=t),this.functions.set(e.name,n),n})),ot.DEFMETHOD("def_variable",(function(e,t){var n=this.variables.get(e.name);return n?(n.orig.push(e),n.init&&(n.scope!==e.scope||n.init instanceof ct)&&(n.init=t)):(n=new Xi(this,e,t),this.variables.set(e.name,n),n.global=!this.parent_scope),e.thedef=n})),ot.DEFMETHOD("next_mangled",(function(e){return P(this,e)})),rt.DEFMETHOD("next_mangled",(function(e){let t;const n=this.mangled_names;do{t=P(this,e)}while(n.has(t));return t})),ct.DEFMETHOD("next_mangled",(function(e,t){for(var n,i=t.orig[0]instanceof vn&&this.name&&this.name.definition(),o=i?i.mangled_name||i.name:null;;)if(n=P(this,e),!o||o!=n)return n})),pn.DEFMETHOD("unmangleable",(function(e){var t=this.definition();return!t||t.unmangleable(e)})),Bn.DEFMETHOD("unmangleable",o),pn.DEFMETHOD("unreferenced",(function(){return!this.definition().references.length&&!this.scope.pinned()})),pn.DEFMETHOD("definition",(function(){return this.thedef})),pn.DEFMETHOD("global",(function(){return this.thedef.global})),rt.DEFMETHOD("_default_mangler_options",e=>((e=n(e,{eval:!1,ie8:!1,keep_classnames:!1,keep_fnames:!1,module:!1,reserved:[],toplevel:!1})).module&&(e.toplevel=!0),Array.isArray(e.reserved)||e.reserved instanceof Set||(e.reserved=[]),e.reserved=new Set(e.reserved),e.reserved.add("arguments"),e)),rt.DEFMETHOD("mangle_names",(function(e){function t(t){!(e.reserved.has(t.name)||1&t.export)&&i.push(t)}var n,i,o;e=this._default_mangler_options(e),n=-1,i=[],e.keep_fnames&&(Yi=new Set);const r=this.mangled_names=new Set;e.cache&&(this.globals.forEach(t),e.cache.props&&e.cache.props.forEach(e=>{r.add(e)})),o=new Ui((o,r)=>{if(o instanceof Ge){var s=n;return r(),n=s,!0}if(o instanceof ot)o.variables.forEach(t);else if(o.is_block_scope())o.block_scope.variables.forEach(t);else if(Yi&&o instanceof Nt&&o.value instanceof at&&!o.value.name&&m(e.keep_fnames,o.name.name))Yi.add(o.name.definition().id);else{if(o instanceof Bn){let e;do{e=Gi(++n)}while(Kn.has(e));return o.mangled_name=e,!0}!e.ie8&&!e.safari10&&o instanceof Fn&&i.push(o.definition())}}),this.walk(o),(e.keep_fnames||e.keep_classnames)&&(Wi=new Set,i.forEach(t=>{t.name.length<6&&t.unmangleable(e)&&Wi.add(t.name)})),i.forEach(t=>{t.mangle(e)}),Yi=null,Wi=null})),rt.DEFMETHOD("find_colliding_names",(function(e){function t(e){o.add(e)}function n(n){var o=n.name;if(n.global&&i&&i.has(o))o=i.get(o);else if(!n.unmangleable(e))return;t(o)}const i=e.cache&&e.cache.props,o=new Set;return e.reserved.forEach(t),this.globals.forEach(n),this.walk(new Ui(e=>{e instanceof ot&&e.variables.forEach(n),e instanceof Fn&&n(e.definition())})),o})),rt.DEFMETHOD("expand_names",(function(e){function t(t){if(t.global&&e.cache)return;if(t.unmangleable(e))return;if(e.reserved.has(t.name))return;const o=j(t),r=t.name=o?o.name:(()=>{var e;do{e=Gi(i++)}while(n.has(e)||Kn.has(e));return e})();t.orig.forEach(e=>{e.name=r}),t.references.forEach(e=>{e.name=r})}var n,i;Gi.reset(),Gi.sort(),e=this._default_mangler_options(e),n=this.find_colliding_names(e),i=0,this.globals.forEach(t),this.walk(new Ui(e=>{e instanceof ot&&e.variables.forEach(t),e instanceof Fn&&t(e.definition())}))})),je.DEFMETHOD("tail_node",s),Ut.DEFMETHOD("tail_node",(function(){return this.expressions[this.expressions.length-1]})),rt.DEFMETHOD("compute_char_frequency",(function(e){e=this._default_mangler_options(e);try{je.prototype.print=function(t,n){this._print(t,n),this instanceof pn&&!this.unmangleable(e)?Gi.consider(this.name,-1):e.properties&&(this instanceof Vt?Gi.consider(this.property,-1):this instanceof Yt&&function e(t){t instanceof Nn?Gi.consider(t.value,-1):t instanceof Jt?(e(t.consequent),e(t.alternative)):t instanceof Ut&&e(t.tail_node())}(this.property))},Gi.consider(this.print_to_string(),1)}finally{je.prototype.print=je.prototype._print}Gi.sort()}));const Gi=(()=>{function e(){s=new Map,i.forEach(e=>{s.set(e,0)}),o.forEach(e=>{s.set(e,0)})}function t(e,t){return s.get(t)-s.get(e)}function n(e){var t="",n=54;e++;do{e--,t+=r[e%n],e=Math.floor(e/n),n=64}while(e>0);return t}const i="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_".split(""),o="0123456789".split("");let r,s;return n.consider=(e,t)=>{for(var n=e.length;--n>=0;)s.set(e[n],s.get(e[n])+t)},n.sort=()=>{r=p(i,t).concat(p(o,t))},n.reset=e,e(),n})(),Zi=(e,t)=>null===e&&null===t||e.TYPE===t.TYPE&&e.shallow_cmp(t),Ji=e=>{const t=Object.keys(e).map(t=>{if("eq"===e[t])return`this.${t} === other.${t}`;if("exist"===e[t])return`(this.${t} == null ? other.${t} == null : this.${t} === other.${t})`;throw Error("mkshallow: Unexpected instruction: "+e[t])}).join(" && ");return Function("other","return "+t)},Ki=()=>!0;je.prototype.shallow_cmp=function(){throw Error("did not find a shallow_cmp function for "+this.constructor.name)},Re.prototype.shallow_cmp=Ki,Ue.prototype.shallow_cmp=Ji({value:"eq"}),Le.prototype.shallow_cmp=Ki,Ve.prototype.shallow_cmp=Ki,We.prototype.shallow_cmp=Ki,Ge.prototype.shallow_cmp=Ji({"label.name":"eq"}),Ke.prototype.shallow_cmp=Ki,Qe.prototype.shallow_cmp=Ki,et.prototype.shallow_cmp=Ji({init:"exist",condition:"exist",step:"exist"}),tt.prototype.shallow_cmp=Ki,nt.prototype.shallow_cmp=Ki,it.prototype.shallow_cmp=Ki,rt.prototype.shallow_cmp=Ki,st.prototype.shallow_cmp=Ki,at.prototype.shallow_cmp=Ji({is_generator:"eq",async:"eq"}),pt.prototype.shallow_cmp=Ji({is_array:"eq"}),ht.prototype.shallow_cmp=Ki,dt.prototype.shallow_cmp=Ki,_t.prototype.shallow_cmp=Ji({value:"eq"}),mt.prototype.shallow_cmp=Ki,yt.prototype.shallow_cmp=Ki,wt.prototype.shallow_cmp=Ki,xt.prototype.shallow_cmp=Ji({is_star:"eq"}),At.prototype.shallow_cmp=Ji({alternative:"exist"}),Ft.prototype.shallow_cmp=Ki,kt.prototype.shallow_cmp=Ki,St.prototype.shallow_cmp=Ji({bcatch:"exist",bfinally:"exist"}),Tt.prototype.shallow_cmp=Ji({argname:"exist"}),$t.prototype.shallow_cmp=Ki,zt.prototype.shallow_cmp=Ki,Nt.prototype.shallow_cmp=Ji({value:"exist"}),Ht.prototype.shallow_cmp=Ki,It.prototype.shallow_cmp=Ji({imported_name:"exist",imported_names:"exist"}),jt.prototype.shallow_cmp=Ji({exported_definition:"exist",exported_value:"exist",exported_names:"exist",module_name:"eq",is_default:"eq"}),Pt.prototype.shallow_cmp=Ki,Ut.prototype.shallow_cmp=Ki,Lt.prototype.shallow_cmp=Ki,Vt.prototype.shallow_cmp=Ji({property:"eq"}),Wt.prototype.shallow_cmp=Ji({operator:"eq"}),Zt.prototype.shallow_cmp=Ji({operator:"eq"}),Jt.prototype.shallow_cmp=Ki,en.prototype.shallow_cmp=Ki,tn.prototype.shallow_cmp=Ki,nn.prototype.shallow_cmp=Ki,on.prototype.shallow_cmp=Ji({key:"eq"}),rn.prototype.shallow_cmp=Ji({static:"eq"}),sn.prototype.shallow_cmp=Ji({static:"eq"}),an.prototype.shallow_cmp=Ji({static:"eq",is_generator:"eq",async:"eq"}),un.prototype.shallow_cmp=Ji({name:"exist",extends:"exist"}),cn.prototype.shallow_cmp=Ji({static:"eq"}),pn.prototype.shallow_cmp=Ji({name:"eq"}),hn.prototype.shallow_cmp=Ki,qn.prototype.shallow_cmp=Ki,On.prototype.shallow_cmp=Ki,Nn.prototype.shallow_cmp=Ji({value:"eq"}),Hn.prototype.shallow_cmp=Ji({value:"eq"}),In.prototype.shallow_cmp=Ji({value:"eq"
	}),jn.prototype.shallow_cmp=function(e){return this.value.flags===e.value.flags&&this.value.source===e.value.source},Pn.prototype.shallow_cmp=Ki;const Qi=/^$|[;{][\s\n]*$/,eo=/[@#]__(PURE|INLINE|NOINLINE)__/g;!function(){function e(e,t){e.DEFMETHOD("_codegen",t)}function t(e,n){Array.isArray(e)?e.forEach(e=>{t(e,n)}):e.DEFMETHOD("needs_parens",n)}function n(e,t,n,i){var o=e.length-1;n.in_directive=i,e.forEach((e,i)=>{!0!==n.in_directive||e instanceof Ue||e instanceof We||e instanceof Le&&e.body instanceof Nn||(n.in_directive=!1),e instanceof We||(n.indent(),e.print(n),i==o&&t||(n.newline(),t&&n.newline())),!0===n.in_directive&&e instanceof Le&&e.body instanceof Nn&&(n.in_directive=!1)}),n.in_directive=!1}function r(e,t){t.print("{"),t.with_indent(t.next_indent(),()=>{t.append_comments(e,!0)}),t.print("}")}function s(e,t,i){e.body.length>0?t.with_block(()=>{n(e.body,!1,t,i)}):r(e,t)}function a(e,t,n){var i=!1;n&&(i=w(e,e=>e instanceof ot||(e instanceof Zt&&"in"==e.operator?Ri:void 0))),e.print(t,i)}function u(e,t,n){return n.option("quote_keys")?n.print_string(e):""+ +e==e&&e>=0?n.option("keep_numbers")?n.print(e):n.print(f(e)):(Kn.has(e)?n.option("ie8"):n.option("ecma")<2015?!T(e):!$(e,!0))||t&&n.option("keep_quoted_props")?n.print_string(e,t):n.print_name(e)}function c(e,t){t.option("braces")?l(e,t):!e||e instanceof We?t.force_semicolon():e.print(t)}function f(e){var t,n,i,o=e.toString(10).replace(/^0\./,".").replace("e+","e"),r=[o];return Math.floor(e)===e&&(e<0?r.push("-0x"+(-e).toString(16).toLowerCase()):r.push("0x"+e.toString(16).toLowerCase())),(t=/^\.0+/.exec(o))?(n=t[0].length,i=o.slice(n),r.push(i+"e-"+(i.length+n-1))):(t=/0+$/.exec(o))?(n=t[0].length,r.push(o.slice(0,-n)+"e"+n)):(t=/^(\d)\.(\d+)e(-?\d+)$/.exec(o))&&r.push(t[1]+t[2]+"e"+(t[3]-t[2].length)),(e=>{var t,n=e[0],i=n.length;for(t=1;t<e.length;++t)e[t].length<i&&(i=(n=e[t]).length);return n})(r)}function l(e,t){!e||e instanceof We?t.print("{}"):e instanceof Ye?e.print(t):t.with_block(()=>{t.indent(),e.print(t),t.newline()})}function p(e,t){e.forEach(e=>{e.DEFMETHOD("add_source_map",t)})}je.DEFMETHOD("print",(function(e,t){function n(){e.prepend_comments(i),i.add_source_map(e),o(i,e),e.append_comments(i)}var i=this,o=i._codegen;i instanceof ot?e.active_scope=i:!e.use_asm&&i instanceof Ue&&"use asm"==i.value&&(e.use_asm=e.active_scope),e.push_node(i),t||i.needs_parens(e)?e.with_parens(n):n(),e.pop_node(),i===e.use_asm&&(e.use_asm=null)})),je.DEFMETHOD("_print",je.prototype.print),je.DEFMETHOD("print_to_string",(function(e){var t=L(e);return this.print(t),t.get()})),t(je,o),t(ct,(function(e){var t;return!((e.has_parens()||!R(e))&&!(e.option("webkit")&&(t=e.parent())instanceof Lt&&t.expression===this)&&!(e.option("wrap_iife")&&(t=e.parent())instanceof Pt&&t.expression===this)&&!(e.option("wrap_func_args")&&(t=e.parent())instanceof Pt&&t.args.includes(this)))})),t(ft,(function(e){var t=e.parent();return t instanceof Lt&&t.expression===this})),t(tn,e=>!e.has_parens()&&R(e)),t(ln,R),t(Wt,(function(e){var t=e.parent();return t instanceof Lt&&t.expression===this||t instanceof Pt&&t.expression===this||t instanceof Zt&&"**"===t.operator&&this instanceof Xt&&t.left===this&&"++"!==this.operator&&"--"!==this.operator})),t(wt,(function(e){var t=e.parent();return t instanceof Lt&&t.expression===this||t instanceof Pt&&t.expression===this||e.option("safari10")&&t instanceof Xt})),t(Ut,(function(e){var t=e.parent();return t instanceof Pt||t instanceof Wt||t instanceof Zt||t instanceof Nt||t instanceof Lt||t instanceof en||t instanceof nn||t instanceof Jt||t instanceof ft||t instanceof Qt||t instanceof st||t instanceof nt&&this===t.object||t instanceof xt||t instanceof jt})),t(Zt,(function(e){var t=e.parent();if(t instanceof Pt&&t.expression===this)return!0;if(t instanceof Wt)return!0;if(t instanceof Lt&&t.expression===this)return!0;if(t instanceof Zt){const e=t.operator,n=this.operator;if("??"===n&&("||"===e||"&&"===e))return!0;const i=vi[e],o=vi[n];if(i>o||i==o&&(this===t.right||"**"==e))return!0}})),t(xt,(function(e){var t=e.parent();return t instanceof Zt&&"="!==t.operator||t instanceof Pt&&t.expression===this||t instanceof Jt&&t.condition===this||t instanceof Wt||t instanceof Lt&&t.expression===this||void 0})),t(Lt,(function(e){var t=e.parent();if(t instanceof Rt&&t.expression===this)return w(this,e=>e instanceof ot||(e instanceof Pt?Ri:void 0))})),t(Pt,(function(e){var t,n=e.parent();return!!(n instanceof Rt&&n.expression===this||n instanceof jt&&n.is_default&&this.expression instanceof ct)||this.expression instanceof ct&&n instanceof Lt&&n.expression===this&&(t=e.parent(1))instanceof Kt&&t.left===n})),t(Rt,(function(e){var t=e.parent();if(0===this.args.length&&(t instanceof Lt||t instanceof Pt&&t.expression===this))return!0})),t(Hn,(function(e){var t,n=e.parent();if(n instanceof Lt&&n.expression===this&&((t=this.getValue())<0||/^0/.test(f(t))))return!0})),t(In,(function(e){var t=e.parent();if(t instanceof Lt&&t.expression===this&&this.getValue().startsWith("-"))return!0})),t([Kt,Jt],(function(e){var t=e.parent();return t instanceof Wt||t instanceof Zt&&!(t instanceof Kt)||t instanceof Pt&&t.expression===this||t instanceof Jt&&t.condition===this||t instanceof Lt&&t.expression===this||this instanceof Kt&&this.left instanceof pt&&!1===this.left.is_array||void 0})),e(Ue,(e,t)=>{t.print_string(e.value,e.quote),t.semicolon()}),e(st,(e,t)=>{t.print("..."),e.expression.print(t)}),e(pt,(e,t)=>{t.print(e.is_array?"[":"{");var n=e.names.length;e.names.forEach((e,i)=>{i>0&&t.comma(),e.print(t),i==n-1&&e instanceof Vn&&t.comma()}),t.print(e.is_array?"]":"}")}),e(Re,(e,t)=>{t.print("debugger"),t.semicolon()}),Xe.DEFMETHOD("_do_print_body",(function(e){c(this.body,e)})),e(Pe,(e,t)=>{e.body.print(t),t.semicolon()}),e(rt,(e,t)=>{n(e.body,!0,t,!0),t.print("")}),e(Ge,(e,t)=>{e.label.print(t),t.colon(),e.body.print(t)}),e(Le,(e,t)=>{e.body.print(t),t.semicolon()}),e(Ye,(e,t)=>{s(e,t)}),e(We,(e,t)=>{t.semicolon()}),e(Ke,(e,t)=>{t.print("do"),t.space(),l(e.body,t),t.space(),t.print("while"),t.space(),t.with_parens(()=>{e.condition.print(t)}),t.semicolon()}),e(Qe,(e,t)=>{t.print("while"),t.space(),t.with_parens(()=>{e.condition.print(t)}),t.space(),e._do_print_body(t)}),e(et,(e,t)=>{t.print("for"),t.space(),t.with_parens(()=>{e.init?(e.init instanceof zt?e.init.print(t):a(e.init,t,!0),t.print(";"),t.space()):t.print(";"),e.condition?(e.condition.print(t),t.print(";"),t.space()):t.print(";"),e.step&&e.step.print(t)}),t.space(),e._do_print_body(t)}),e(tt,(e,t)=>{t.print("for"),e.await&&(t.space(),t.print("await")),t.space(),t.with_parens(()=>{e.init.print(t),t.space(),t.print(e instanceof nt?"of":"in"),t.space(),e.object.print(t)}),t.space(),e._do_print_body(t)}),e(it,(e,t)=>{t.print("with"),t.space(),t.with_parens(()=>{e.expression.print(t)}),t.space(),e._do_print_body(t)}),at.DEFMETHOD("_do_print",(function(e,t){var n=this;t||(n.async&&(e.print("async"),e.space()),e.print("function"),n.is_generator&&e.star(),n.name&&e.space()),n.name instanceof pn?n.name.print(e):t&&n.name instanceof je&&e.with_square(()=>{n.name.print(e)}),e.with_parens(()=>{n.argnames.forEach((t,n)=>{n&&e.comma(),t.print(e)})}),e.space(),s(n,e,!0)})),e(at,(e,t)=>{e._do_print(t)}),e(ht,(e,t)=>{var n=e.prefix,i=n instanceof at||n instanceof Zt||n instanceof Jt||n instanceof Ut||n instanceof Wt||n instanceof Vt&&n.expression instanceof tn;i&&t.print("("),e.prefix.print(t),i&&t.print(")"),e.template_string.print(t)}),e(dt,(e,t)=>{var n,i=t.parent()instanceof ht;for(t.print("`"),n=0;n<e.segments.length;n++)e.segments[n]instanceof _t?i?t.print(e.segments[n].raw):t.print_template_string_chars(e.segments[n].value):(t.print("${"),e.segments[n].print(t),t.print("}"));t.print("`")}),ft.DEFMETHOD("_do_print",(function(e){var t=this,n=e.parent(),i=n instanceof Zt&&!(n instanceof Kt)||n instanceof Wt||n instanceof Pt&&t===n.expression;i&&e.print("("),t.async&&(e.print("async"),e.space()),1===t.argnames.length&&t.argnames[0]instanceof pn?t.argnames[0].print(e):e.with_parens(()=>{t.argnames.forEach((t,n)=>{n&&e.comma(),t.print(e)})}),e.space(),e.print("=>"),e.space();const o=t.body[0];if(1===t.body.length&&o instanceof Dt){const t=o.value;t?function e(t){return t instanceof tn||(t instanceof Ut?e(t.expressions[0]):"Call"===t.TYPE?e(t.expression):t instanceof ht?e(t.prefix):t instanceof Vt||t instanceof Yt?e(t.expression):t instanceof Jt?e(t.condition):t instanceof Zt?e(t.left):t instanceof Gt&&e(t.expression))}(t)?(e.print("("),t.print(e),e.print(")")):t.print(e):e.print("{}")}else s(t,e);i&&e.print(")")})),gt.DEFMETHOD("_do_print",(function(e,t){if(e.print(t),this.value){e.space();const t=this.value.start.comments_before;t&&t.length&&!e.printed_comments.has(t)?(e.print("("),this.value.print(e),e.print(")")):this.value.print(e)}e.semicolon()})),e(Dt,(e,t)=>{e._do_print(t,"return")}),e(vt,(e,t)=>{e._do_print(t,"throw")}),e(xt,(e,t)=>{var n=e.is_star?"*":"";t.print("yield"+n),e.expression&&(t.space(),e.expression.print(t))}),e(wt,(e,t)=>{var n,i;t.print("await"),t.space(),(i=!((n=e.expression)instanceof Pt||n instanceof Sn||n instanceof Lt||n instanceof Wt||n instanceof Mn))&&t.print("("),e.expression.print(t),i&&t.print(")")}),yt.DEFMETHOD("_do_print",(function(e,t){e.print(t),this.label&&(e.space(),this.label.print(e)),e.semicolon()})),e(bt,(e,t)=>{e._do_print(t,"break")}),e(Et,(e,t)=>{e._do_print(t,"continue")}),e(At,(e,t)=>{t.print("if"),t.space(),t.with_parens(()=>{e.condition.print(t)}),t.space(),e.alternative?(((e,t)=>{var n=e.body;if(t.option("braces")||t.option("ie8")&&n instanceof Ke)return l(n,t);if(!n)return t.force_semicolon();for(;;)if(n instanceof At){if(!n.alternative)return void l(e.body,t);n=n.alternative}else{if(!(n instanceof Xe))break;n=n.body}c(e.body,t)})(e,t),t.space(),t.print("else"),t.space(),e.alternative instanceof At?e.alternative.print(t):c(e.alternative,t)):e._do_print_body(t)}),e(Ft,(e,t)=>{t.print("switch"),t.space(),t.with_parens(()=>{e.expression.print(t)}),t.space();var n=e.body.length-1;n<0?r(e,t):t.with_block(()=>{e.body.forEach((e,i)=>{t.indent(!0),e.print(t),i<n&&e.body.length>0&&t.newline()})})}),kt.DEFMETHOD("_do_print_body",(function(e){e.newline(),this.body.forEach(t=>{e.indent(),t.print(e),e.newline()})})),e(Ct,(e,t)=>{t.print("default:"),e._do_print_body(t)}),e(Bt,(e,t)=>{t.print("case"),t.space(),e.expression.print(t),t.print(":"),e._do_print_body(t)}),e(St,(e,t)=>{t.print("try"),t.space(),s(e,t),e.bcatch&&(t.space(),e.bcatch.print(t)),e.bfinally&&(t.space(),e.bfinally.print(t))}),e(Tt,(e,t)=>{t.print("catch"),e.argname&&(t.space(),t.with_parens(()=>{e.argname.print(t)})),t.space(),s(e,t)}),e($t,(e,t)=>{t.print("finally"),t.space(),s(e,t)}),zt.DEFMETHOD("_do_print",(function(e,t){var n;e.print(t),e.space(),this.definitions.forEach((t,n)=>{n&&e.comma(),t.print(e)}),(!((n=e.parent())instanceof et||n instanceof tt)||n&&n.init!==this)&&e.semicolon()})),e(Ot,(e,t)=>{e._do_print(t,"let")}),e(qt,(e,t)=>{e._do_print(t,"var")}),e(Mt,(e,t)=>{e._do_print(t,"const")}),e(It,(e,t)=>{t.print("import"),t.space(),e.imported_name&&e.imported_name.print(t),e.imported_name&&e.imported_names&&(t.print(","),t.space()),e.imported_names&&(1===e.imported_names.length&&"*"===e.imported_names[0].foreign_name.name?e.imported_names[0].print(t):(t.print("{"),e.imported_names.forEach((n,i)=>{t.space(),n.print(t),i<e.imported_names.length-1&&t.print(",")}),t.space(),t.print("}"))),(e.imported_name||e.imported_names)&&(t.space(),t.print("from"),t.space()),e.module_name.print(t),t.semicolon()}),e(Ht,(e,t)=>{var n=t.parent()instanceof It,i=e.name.definition();(i&&i.mangled_name||e.name.name)!==e.foreign_name.name?(n?t.print(e.foreign_name.name):e.name.print(t),t.space(),t.print("as"),t.space(),n?e.name.print(t):t.print(e.foreign_name.name)):e.name.print(t)}),e(jt,(e,t)=>{if(t.print("export"),t.space(),e.is_default&&(t.print("default"),t.space()),e.exported_names)1===e.exported_names.length&&"*"===e.exported_names[0].name.name?e.exported_names[0].print(t):(t.print("{"),e.exported_names.forEach((n,i)=>{t.space(),n.print(t),i<e.exported_names.length-1&&t.print(",")}),t.space(),t.print("}"));else if(e.exported_value)e.exported_value.print(t);else if(e.exported_definition&&(e.exported_definition.print(t),e.exported_definition instanceof zt))return;e.module_name&&(t.space(),t.print("from"),t.space(),e.module_name.print(t)),(e.exported_value&&!(e.exported_value instanceof lt||e.exported_value instanceof ct||e.exported_value instanceof un)||e.module_name||e.exported_names)&&t.semicolon()}),e(Nt,(e,t)=>{var n,i;e.name.print(t),e.value&&(t.space(),t.print("="),t.space(),i=(n=t.parent(1))instanceof et||n instanceof tt,a(e.value,t,i))}),e(Pt,(e,t)=>{e.expression.print(t),e instanceof Rt&&0===e.args.length||((e.expression instanceof Pt||e.expression instanceof at)&&t.add_mapping(e.start),t.with_parens(()=>{e.args.forEach((e,n)=>{n&&t.comma(),e.print(t)})}))}),e(Rt,(e,t)=>{t.print("new"),t.space(),Pt.prototype._codegen(e,t)}),Ut.DEFMETHOD("_do_print",(function(e){this.expressions.forEach((t,n)=>{n>0&&(e.comma(),e.should_break()&&(e.newline(),e.indent())),t.print(e)})})),e(Ut,(e,t)=>{e._do_print(t)}),e(Vt,(e,t)=>{var n,i=e.expression;i.print(t),n=e.property,(Kn.has(n)?t.option("ie8"):!$(n,t.option("ecma")>=2015))?(t.print("["),t.add_mapping(e.end),t.print_string(n),t.print("]")):(i instanceof Hn&&i.getValue()>=0&&(/[xa-f.)]/i.test(t.last())||t.print(".")),t.print("."),t.add_mapping(e.end),t.print_name(n))}),e(Yt,(e,t)=>{e.expression.print(t),t.print("["),e.property.print(t),t.print("]")}),e(Xt,(e,t)=>{var n=e.operator;t.print(n),(/^[a-z]/i.test(n)||/[+-]$/.test(n)&&e.expression instanceof Xt&&/^[+-]/.test(e.expression.operator))&&t.space(),e.expression.print(t)}),e(Gt,(e,t)=>{e.expression.print(t),t.print(e.operator)}),e(Zt,(e,t)=>{var n=e.operator;e.left.print(t),">"==n[0]&&e.left instanceof Gt&&"--"==e.left.operator?t.print(" "):t.space(),t.print(n),("<"==n||"<<"==n)&&e.right instanceof Xt&&"!"==e.right.operator&&e.right.expression instanceof Xt&&"--"==e.right.expression.operator?t.print(" "):t.space(),e.right.print(t)}),e(Jt,(e,t)=>{e.condition.print(t),t.space(),t.print("?"),t.space(),e.consequent.print(t),t.space(),t.colon(),e.alternative.print(t)}),e(en,(e,t)=>{t.with_square(()=>{var n=e.elements,i=n.length;i>0&&t.space(),n.forEach((e,n)=>{n&&t.comma(),e.print(t),n===i-1&&e instanceof Vn&&t.comma()}),i>0&&t.space()})}),e(tn,(e,t)=>{e.properties.length>0?t.with_block(()=>{e.properties.forEach((e,n)=>{n&&(t.print(","),t.newline()),t.indent(),e.print(t)}),t.newline()}):r(e,t)}),e(un,(e,t)=>{if(t.print("class"),t.space(),e.name&&(e.name.print(t),t.space()),e.extends){var n=!(e.extends instanceof Sn||e.extends instanceof Lt||e.extends instanceof ln||e.extends instanceof ct);t.print("extends"),n?t.print("("):t.space(),e.extends.print(t),n?t.print(")"):t.space()}e.properties.length>0?t.with_block(()=>{e.properties.forEach((e,n)=>{n&&t.newline(),t.indent(),e.print(t)}),t.newline()}):t.print("{}")}),e(hn,(e,t)=>{t.print("new.target")}),e(on,(e,t)=>{function n(e){var t=e.definition();return t?t.mangled_name||t.name:e.name}var i=t.option("shorthand");i&&e.value instanceof pn&&$(e.key,t.option("ecma")>=2015)&&n(e.value)===e.key&&!Kn.has(e.key)?u(e.key,e.quote,t):i&&e.value instanceof Qt&&e.value.left instanceof pn&&$(e.key,t.option("ecma")>=2015)&&n(e.value.left)===e.key?(u(e.key,e.quote,t),t.space(),t.print("="),t.space(),e.value.right.print(t)):(e.key instanceof je?t.with_square(()=>{e.key.print(t)}):u(e.key,e.quote,t),t.colon(),e.value.print(t))}),e(cn,(e,t)=>{e.static&&(t.print("static"),t.space()),e.key instanceof En?u(e.key.name,e.quote,t):(t.print("["),e.key.print(t),t.print("]")),e.value&&(t.print("="),e.value.print(t)),t.semicolon()}),nn.DEFMETHOD("_print_getter_setter",(function(e,t){var n=this;n.static&&(t.print("static"),t.space()),e&&(t.print(e),t.space()),n.key instanceof bn?u(n.key.name,n.quote,t):t.with_square(()=>{n.key.print(t)}),n.value._do_print(t,!0)})),e(rn,(e,t)=>{e._print_getter_setter("set",t)}),e(sn,(e,t)=>{e._print_getter_setter("get",t)}),e(an,(e,t)=>{var n;e.is_generator&&e.async?n="async*":e.is_generator?n="*":e.async&&(n="async"),e._print_getter_setter(n,t)}),pn.DEFMETHOD("_do_print",(function(e){var t=this.definition();e.print_name(t?t.mangled_name||t.name:this.name)})),e(pn,(e,t)=>{e._do_print(t)}),e(Vn,i),e(qn,(e,t)=>{t.print("this")}),e(On,(e,t)=>{t.print("super")}),e(Mn,(e,t)=>{t.print(e.getValue())}),e(Nn,(e,t)=>{t.print_string(e.getValue(),e.quote,t.in_directive)}),e(Hn,(e,t)=>{(t.option("keep_numbers")||t.use_asm)&&e.start&&null!=e.start.raw?t.print(e.start.raw):t.print(f(e.getValue()))}),e(In,(e,t)=>{t.print(e.getValue()+"n")});const h=/(<\s*\/\s*script)/i,d=(e,t)=>t.replace("/","\\/");e(jn,(e,t)=>{let{source:n,flags:i}=e.getValue();n=g(n),i=i?(e=>{const t=new Set(e.split(""));let n="";for(const e of"gimuy")t.has(e)&&(n+=e,t.delete(e));return t.size&&t.forEach(e=>{n+=e}),n})(i):"",n=n.replace(h,d),t.print(t.to_utf8(`/${n}/${i}`));const o=t.parent();o instanceof Zt&&/^\w/.test(o.operator)&&o.left===e&&t.print(" ")}),p([je,Ge,rt],i),p([en,Ye,Tt,un,Mn,Re,zt,Ue,$t,mt,at,Rt,tn,Xe,pn,Ft,kt,dt,_t,St],(function(e){e.add_mapping(this.start)})),p([sn,rn],(function(e){e.add_mapping(this.start,this.key.name)})),p([nn],(function(e){e.add_mapping(this.start,this.key)}))}(),"undefined"==typeof atob||atob,"undefined"==typeof btoa||btoa;let to=void 0;je.prototype.size=function(e,t){to=X.mangle;let n=0;return x(this,(e,t)=>{n+=e._size(t)},t||e&&e.stack),to=void 0,n},je.prototype._size=()=>0,Re.prototype._size=()=>8,Ue.prototype._size=function(){return 2+this.value.length};const no=e=>e.length&&e.length-1;Ve.prototype._size=function(){return 2+no(this.body)},rt.prototype._size=function(){return no(this.body)},We.prototype._size=()=>1,Ge.prototype._size=()=>2,Ke.prototype._size=()=>9,Qe.prototype._size=()=>7,et.prototype._size=()=>8,tt.prototype._size=()=>8,it.prototype._size=()=>6,st.prototype._size=()=>3;const io=e=>(e.is_generator?1:0)+(e.async?6:0);ut.prototype._size=function(){return io(this)+4+no(this.argnames)+no(this.body)},ct.prototype._size=function(e){return 2*!!R(e)+io(this)+12+no(this.argnames)+no(this.body)},lt.prototype._size=function(){return io(this)+13+no(this.argnames)+no(this.body)},ft.prototype._size=function(){let e=2+no(this.argnames);return 1===this.argnames.length&&this.argnames[0]instanceof pn||(e+=2),io(this)+e+Array.isArray(this.body)?no(this.body):this.body._size()},pt.prototype._size=()=>2,dt.prototype._size=function(){return 2+3*Math.floor(this.segments.length/2)},_t.prototype._size=function(){return this.value.length},Dt.prototype._size=function(){return this.value?7:6},vt.prototype._size=()=>6,bt.prototype._size=function(){return this.label?6:5},Et.prototype._size=function(){return this.label?9:8},At.prototype._size=()=>4,Ft.prototype._size=function(){return 8+no(this.body)},Bt.prototype._size=function(){return 5+no(this.body)},Ct.prototype._size=function(){return 8+no(this.body)},St.prototype._size=function(){return 3+no(this.body)},Tt.prototype._size=function(){let e=7+no(this.body);return this.argname&&(e+=2),e},$t.prototype._size=function(){return 7+no(this.body)};const oo=(e,t)=>e+no(t.definitions);qt.prototype._size=function(){return oo(4,this)},Ot.prototype._size=function(){return oo(4,this)},Mt.prototype._size=function(){return oo(6,this)},Nt.prototype._size=function(){return this.value?1:0},Ht.prototype._size=function(){return this.name?4:0},It.prototype._size=function(){let e=6;return this.imported_name&&(e+=1),(this.imported_name||this.imported_names)&&(e+=5),this.imported_names&&(e+=2+no(this.imported_names)),e},jt.prototype._size=function(){let e=7+(this.is_default?8:0);return this.exported_value&&(e+=this.exported_value._size()),this.exported_names&&(e+=2+no(this.exported_names)),this.module_name&&(e+=5),e},Pt.prototype._size=function(){return 2+no(this.args)},Rt.prototype._size=function(){return 6+no(this.args)},Ut.prototype._size=function(){return no(this.expressions)},Vt.prototype._size=function(){return this.property.length+1},Yt.prototype._size=()=>2,Wt.prototype._size=function(){return"typeof"===this.operator?7:"void"===this.operator?5:this.operator.length},Zt.prototype._size=function(e){if("in"===this.operator)return 4;let t=this.operator.length;return("+"===this.operator||"-"===this.operator)&&this.right instanceof Wt&&this.right.operator===this.operator&&(t+=1),this.needs_parens(e)&&(t+=2),t},Jt.prototype._size=()=>3,en.prototype._size=function(){return 2+no(this.elements)},tn.prototype._size=function(e){let t=2;return R(e)&&(t+=2),t+no(this.properties)};const ro=e=>"string"==typeof e?e.length:0;on.prototype._size=function(){return ro(this.key)+1};const so=e=>e?7:0;sn.prototype._size=function(){return 5+so(this.static)+ro(this.key)},rn.prototype._size=function(){return 5+so(this.static)+ro(this.key)},an.prototype._size=function(){return so(this.static)+ro(this.key)+io(this)},un.prototype._size=function(){return(this.name?8:7)+(this.extends?8:0)},cn.prototype._size=function(){return so(this.static)+("string"==typeof this.key?this.key.length+2:0)+(this.value?1:0)},pn.prototype._size=function(){return!to||this.definition().unmangleable(to)?this.name.length:2},En.prototype._size=function(){return this.name.length},Sn.prototype._size=function(){const{name:e,thedef:t}=this;return t&&t.global?e.length:"arguments"===e?9:2},hn.prototype._size=()=>10,Cn.prototype._size=function(){return this.name.length},$n.prototype._size=function(){return this.name.length},qn.prototype._size=()=>4,On.prototype._size=()=>5,Nn.prototype._size=function(){return this.value.length+2},Hn.prototype._size=function(){const{value:e}=this;return 0===e?1:e>0&&Math.floor(e)===e?Math.floor(Math.log10(e)+1):e.toString().length},In.prototype._size=function(){return this.value.length},jn.prototype._size=function(){return this.value.toString().length},Rn.prototype._size=()=>4,Un.prototype._size=()=>3,Ln.prototype._size=()=>6,Vn.prototype._size=()=>0,Yn.prototype._size=()=>8,Gn.prototype._size=()=>4,Xn.prototype._size=()=>5,wt.prototype._size=()=>6,xt.prototype._size=()=>6;const ao=(e,t)=>e.flags&t,uo=(e,t)=>{e.flags|=t},co=(e,t)=>{e.flags&=~t};class fo extends Ui{constructor(e,t){var i,o,s,a,u,c;if(super(),void 0===e.defaults||e.defaults||(t=!0),this.options=n(e,{arguments:!1,arrows:!t,booleans:!t,booleans_as_integers:!1,collapse_vars:!t,comparisons:!t,computed_props:!t,conditionals:!t,dead_code:!t,defaults:!0,directives:!t,drop_console:!1,drop_debugger:!t,ecma:5,evaluate:!t,expression:!1,global_defs:!1,hoist_funs:!1,hoist_props:!t,hoist_vars:!1,ie8:!1,if_return:!t,inline:!t,join_vars:!t,keep_classnames:!1,keep_fargs:!0,keep_fnames:!1,keep_infinity:!1,loops:!t,module:!1,negate_iife:!t,passes:1,properties:!t,pure_getters:!t&&"strict",pure_funcs:null,reduce_funcs:null,reduce_vars:!t,sequences:!t,side_effects:!t,switches:!t,top_retain:null,toplevel:!(!e||!e.top_retain),typeofs:!t,unsafe:!1,unsafe_arrows:!1,unsafe_comps:!1,unsafe_Function:!1,unsafe_math:!1,unsafe_symbols:!1,unsafe_methods:!1,unsafe_proto:!1,unsafe_regexp:!1,unsafe_undefined:!1,unused:!t,warnings:!1},!0),"object"==typeof(i=this.options.global_defs))for(o in i)"@"===o[0]&&_(i,o)&&(i[o.slice(1)]=N(i[o],{expression:!0}));!0===this.options.inline&&(this.options.inline=3),s=this.options.pure_funcs,this.pure_funcs="function"==typeof s?s:s?e=>!s.includes(e.expression.print_to_string()):r,(a=this.options.top_retain)instanceof RegExp?this.top_retain=e=>a.test(e.name):"function"==typeof a?this.top_retain=a:a&&("string"==typeof a&&(a=a.split(/,/)),this.top_retain=e=>a.includes(e.name)),this.options.module&&(this.directives["use strict"]=!0,this.options.toplevel=!0),u=this.options.toplevel,this.toplevel="string"==typeof u?{funcs:/funcs/.test(u),vars:/vars/.test(u)}:{funcs:u,vars:u},c=this.options.sequences,this.sequences_limit=1==c?800:0|c,this.warnings_produced={},this.evaluated_regexps=new Map}option(e){return this.options[e]}exposed(e){if(e.export)return!0;if(e.global)for(var t=0,n=e.orig.length;t<n;t++)if(!this.toplevel[e.orig[t]instanceof yn?"funcs":"vars"])return!0;return!1}in_boolean_context(){var e,t,n;if(!this.option("booleans"))return!1;for(e=this.self(),t=0;n=this.parent(t);t++){if(n instanceof Le||n instanceof Jt&&n.condition===e||n instanceof Je&&n.condition===e||n instanceof et&&n.condition===e||n instanceof At&&n.condition===e||n instanceof Xt&&"!"==n.operator&&n.expression===e)return!0;if(!(n instanceof Zt&&("&&"==n.operator||"||"==n.operator||"??"==n.operator)||n instanceof Jt||n.tail_node()===e))return!1;e=n}}compress(e){var t,n,i,o,r;for(e=e.resolve_defines(this),this.option("expression")&&e.process_expression(!0),t=+this.options.passes||1,n=1/0,i=!1,o={ie8:this.option("ie8")},r=0;r<t;r++)if(e.figure_out_scope(o),0===r&&this.option("drop_console")&&(e=e.drop_console()),(r>0||this.option("reduce_vars"))&&e.reset_opt_flags(this),e=e.transform(this),t>1){let t=0;if(w(e,()=>{t++}),this.info("pass "+r+": last_count: "+n+", count: "+t),t<n)n=t,i=!1;else{if(i)break;i=!0}}return this.option("expression")&&e.process_expression(!1),e}info(...e){"verbose"==this.options.warnings&&je.warn(...e)}warn(e,t){if(this.options.warnings){var n=f(e,t);n in this.warnings_produced||(this.warnings_produced[n]=!0,je.warn.apply(je,arguments))}}clear_warnings(){this.warnings_produced={}}before(e,t){var n,i;return ao(e,256)?e:(n=!1,e instanceof ot&&(e=(e=e.hoist_properties(this)).hoist_declarations(this),n=!0),t(e,this),t(e,this),i=e.optimize(this),n&&i instanceof ot&&(i.drop_unused(this),t(i,this)),i===e&&uo(i,256),i)}}Z(je,e=>e),rt.DEFMETHOD("drop_console",(function(){return this.transform(new Li(e=>{var t,n;if("Call"==e.TYPE&&(t=e.expression)instanceof Lt){for(n=t.expression;n.expression;)n=n.expression;if(he(n)&&"console"==n.name)return u(Ln,e)}}))})),je.DEFMETHOD("equivalent_to",(function(e){return((e,t)=>{if(!Zi(e,t))return!1;const n=[e],i=[t],o=n.push.bind(n),r=i.push.bind(i);for(;n.length&&i.length;){const e=n.pop(),t=i.pop();if(!Zi(e,t))return!1;if(e._children_backwards(o),t._children_backwards(r),n.length!==i.length)return!1}return 0==n.length&&0==i.length})(this,e)})),ot.DEFMETHOD("process_expression",(function(e,t){var n=this,i=new Li(o=>{var r,s;return e&&o instanceof Le?u(Dt,o,{value:o.body}):!e&&o instanceof Dt?t?(r=o.value&&o.value.drop_side_effect_free(t,!0))?u(Le,o,{body:r}):u(We,o):u(Le,o,{body:o.value||u(Xt,o,{operator:"void",expression:u(Hn,o,{value:0})})}):(o instanceof un||o instanceof at&&o!==n||(o instanceof Ve?(s=o.body.length-1)>=0&&(o.body[s]=o.body[s].transform(i)):o instanceof At?(o.body=o.body.transform(i),o.alternative&&(o.alternative=o.alternative.transform(i))):o instanceof it&&(o.body=o.body.transform(i))),o)});n.transform(i)})),function(e){function t(e,t){t.assignments=0,t.chained=!1,t.direct_access=!1,t.escaped=0,t.recursive_refs=0,t.references=[],t.should_replace=void 0,t.single_use=void 0,t.scope.pinned()?t.fixed=!1:t.orig[0]instanceof gn||!e.exposed(t)?t.fixed=t.init:t.fixed=!1}function n(e,n,i){i.variables.forEach(i=>{t(n,i),null===i.fixed?(e.defs_to_safe_ids.set(i.id,e.safe_ids),a(e,i,!0)):i.fixed&&(e.loop_ids.set(i.id,e.in_loop),a(e,i,!0))})}function o(e,n){n.block_scope&&n.block_scope.variables.forEach(n=>{t(e,n)})}function r(e){e.safe_ids=Object.create(e.safe_ids)}function s(e){e.safe_ids=Object.getPrototypeOf(e.safe_ids)}function a(e,t,n){e.safe_ids[t.id]=n}function c(e,t){if("m"==t.single_use)return!1;if(e.safe_ids[t.id]){if(null==t.fixed){var n=t.orig[0];if(n instanceof vn||"arguments"==n.name)return!1;t.fixed=u(Ln,n)}return!0}return t.fixed instanceof lt}function f(e,t,n,i){if(void 0===t.fixed)return!0;let o;return null===t.fixed&&(o=e.defs_to_safe_ids.get(t.id))?(o[t.id]=!1,e.defs_to_safe_ids.delete(t.id),!0):!!_(e.safe_ids,t.id)&&!!c(e,t)&&!1!==t.fixed&&!(null!=t.fixed&&(!i||t.references.length>t.assignments))&&(t.fixed instanceof lt?i instanceof je&&t.fixed.parent_scope===n:t.orig.every(e=>!(e instanceof gn||e instanceof yn||e instanceof wn)))}function l(e,t,n,i,o,r,s){var a,u=e.parent(r);if(o){if(o.is_constant())return;if(o instanceof ln)return}if(u instanceof Kt&&"="==u.operator&&i===u.right||u instanceof Pt&&(i!==u.expression||u instanceof Rt)||u instanceof gt&&i===u.value&&i.scope!==t.scope||u instanceof Nt&&i===u.value||u instanceof xt&&i===u.value&&i.scope!==t.scope)return!(s>1)||o&&o.is_constant_expression(n)||(s=1),void((!t.escaped||t.escaped>s)&&(t.escaped=s));if(u instanceof en||u instanceof wt||u instanceof Zt&&wi.has(u.operator)||u instanceof Jt&&i!==u.condition||u instanceof st||u instanceof Ut&&i===u.tail_node())l(e,t,n,u,u,r+1,s);else if(u instanceof on&&i===u.value)a=e.parent(r+1),l(e,t,n,a,a,r+2,s);else if(u instanceof Lt&&i===u.expression&&(l(e,t,n,u,o=J(o,u.property),r+1,s+1),o))return;r>0||u instanceof Ut&&i!==u.tail_node()||u instanceof Le||(t.direct_access=!0)}e(je,i);const p=e=>w(e,e=>{if(e instanceof pn){var t=e.definition();t&&(e instanceof Sn&&t.references.push(e),t.fixed=!1)}});e(ut,(function(e,t,i){return r(e),n(e,i,this),t(),s(e),!0})),e(Kt,(function(e,t,n){var i,o,r,s,c,h,d=this;if(d.left instanceof pt)p(d.left);else if((i=d.left)instanceof Sn&&(r=f(e,o=i.definition(),i.scope,d.right),o.assignments++,r&&((s=o.fixed)||"="==d.operator)&&(h=(c="="==d.operator)?d.right:d,!K(n,e,d,h,0))))return o.references.push(i),c||(o.chained=!0),o.fixed=c?()=>d.right:()=>u(Zt,d,{operator:d.operator.slice(0,-1),left:s instanceof je?s:s(),right:d.right}),a(e,o,!1),d.right.walk(e),a(e,o,!0),l(e,o,i.scope,d,h,0,1),!0})),e(Zt,(function(e){if(wi.has(this.operator))return this.left.walk(e),r(e),this.right.walk(e),s(e),!0})),e(Ve,(function(e,t,n){o(n,this)})),e(Bt,(function(e){return r(e),this.expression.walk(e),s(e),r(e),b(this,e),s(e),!0})),e(un,(function(e,t){return co(this,16),r(e),t(),s(e),!0})),e(Jt,(function(e){return this.condition.walk(e),r(e),this.consequent.walk(e),s(e),r(e),this.alternative.walk(e),s(e),!0})),e(Ct,(e,t)=>(r(e),t(),s(e),!0)),e(at,(function(e,t,i){return co(this,16),r(e),n(e,i,this),this.uses_arguments?(t(),void s(e)):(!this.name&&(o=e.parent())instanceof Pt&&o.expression===this&&!o.args.some(e=>e instanceof st)&&this.argnames.every(e=>e instanceof pn)&&this.argnames.forEach((t,n)=>{if(t.definition){var i=t.definition();i.orig.length>1||(void 0!==i.fixed||this.uses_arguments&&!e.has_directive("use strict")?i.fixed=!1:(i.fixed=()=>o.args[n]||u(Ln,o),e.loop_ids.set(i.id,e.in_loop),a(e,i,!0)))}}),t(),s(e),!0);var o})),e(Ke,(function(e,t,n){o(n,this);const i=e.in_loop;return e.in_loop=this,r(e),this.body.walk(e),Fe(this)&&(s(e),r(e)),this.condition.walk(e),s(e),e.in_loop=i,!0})),e(et,(function(e,t,n){o(n,this),this.init&&this.init.walk(e);const i=e.in_loop;return e.in_loop=this,r(e),this.condition&&this.condition.walk(e),this.body.walk(e),this.step&&(Fe(this)&&(s(e),r(e)),this.step.walk(e)),s(e),e.in_loop=i,!0})),e(tt,(function(e,t,n){o(n,this),p(this.init),this.object.walk(e);const i=e.in_loop;return e.in_loop=this,r(e),this.body.walk(e),s(e),e.in_loop=i,!0})),e(At,(function(e){return this.condition.walk(e),r(e),this.body.walk(e),s(e),this.alternative&&(r(e),this.alternative.walk(e),s(e)),!0})),e(Ge,(function(e){return r(e),this.body.walk(e),s(e),!0})),e(Fn,(function(){this.definition().fixed=!1})),e(Sn,(function(e,t,n){var i,o,r=this.definition();r.references.push(this),1==r.references.length&&!r.fixed&&r.orig[0]instanceof yn&&e.loop_ids.set(r.id,e.in_loop),void 0!==r.fixed&&c(e,r)?r.fixed&&((i=this.fixed_value())instanceof at&&Ce(e,r)?r.recursive_refs++:i&&!n.exposed(r)&&((e,t,n)=>t.option("unused")&&!n.scope.pinned()&&n.references.length-n.recursive_refs==1&&e.loop_ids.get(n.id)===e.in_loop)(e,n,r)?r.single_use=i instanceof at&&!i.pinned()||i instanceof un||r.scope===this.scope&&i.is_constant_expression():r.single_use=!1,K(n,e,this,i,0,!!(o=i)&&(o.is_constant()||o instanceof at||o instanceof qn))&&(r.single_use?r.single_use="m":r.fixed=!1)):r.fixed=!1,l(e,r,this.scope,this,i,0,1)})),e(rt,(function(e,i,o){this.globals.forEach(e=>{t(o,e)}),n(e,o,this)})),e(St,(function(e,t,n){return o(n,this),r(e),b(this,e),s(e),this.bcatch&&(r(e),this.bcatch.walk(e),s(e)),this.bfinally&&this.bfinally.walk(e),!0})),e(Wt,(function(e){var t,n,i,o,r=this;if(("++"===r.operator||"--"===r.operator)&&(t=r.expression)instanceof Sn&&(i=f(e,n=t.definition(),t.scope,!0),n.assignments++,i&&(o=n.fixed)))return n.references.push(t),n.chained=!0,n.fixed=()=>u(Zt,r,{operator:r.operator.slice(0,-1),left:u(Xt,r,{operator:"+",expression:o instanceof je?o:o()}),right:u(Hn,r,{value:1})}),a(e,n,!0),!0})),e(Nt,(function(e,t){var n,i=this;if(i.name instanceof pt)p(i.name);else if(n=i.name.definition(),i.value){if(f(e,n,i.name.scope,i.value))return n.fixed=()=>i.value,e.loop_ids.set(n.id,e.in_loop),a(e,n,!1),t(),a(e,n,!0),!0;n.fixed=!1
	}})),e(Qe,(function(e,t,n){o(n,this);const i=e.in_loop;return e.in_loop=this,r(e),t(),s(e),e.in_loop=i,!0}))}((e,t)=>{e.DEFMETHOD("reduce_vars",t)}),rt.DEFMETHOD("reset_opt_flags",(function(e){const t=this,n=e.option("reduce_vars"),i=new Ui((o,r)=>{if(co(o,1792),n)return e.top_retain&&o instanceof lt&&i.parent()===t&&uo(o,1024),o.reduce_vars(i,r,e)});i.safe_ids=Object.create(null),i.in_loop=null,i.loop_ids=new Map,i.defs_to_safe_ids=new Map,t.walk(i)})),pn.DEFMETHOD("fixed_value",(function(){var e=this.thedef.fixed;return!e||e instanceof je?e:e()})),Sn.DEFMETHOD("is_immutable",(function(){var e=this.definition().orig;return 1==e.length&&e[0]instanceof wn})),bi=h("Array Boolean clearInterval clearTimeout console Date decodeURI decodeURIComponent encodeURI encodeURIComponent Error escape eval EvalError Function isFinite isNaN JSON Math Number parseFloat parseInt RangeError ReferenceError RegExp Object setInterval setTimeout String SyntaxError TypeError unescape URIError"),Sn.DEFMETHOD("is_declared",(function(e){return!this.definition().undeclared||e.option("unsafe")&&bi.has(this.name)})),Ei=h("Infinity NaN undefined"),function(e){function t(e){return/strict/.test(e.option("pure_getters"))}je.DEFMETHOD("may_throw_on_access",(function(e){return!e.option("pure_getters")||this._dot_throw(e)})),e(je,t),e(Rn,r),e(Ln,r),e(Mn,o),e(en,o),e(tn,(function(e){if(!t(e))return!1;for(var n=this.properties.length;--n>=0;)if(this.properties[n]._dot_throw(e))return!0;return!1})),e(nn,o),e(sn,r),e(st,(function(e){return this.expression._dot_throw(e)})),e(ct,o),e(ft,o),e(Gt,o),e(Xt,(function(){return"void"==this.operator})),e(Zt,(function(e){return("&&"==this.operator||"||"==this.operator||"??"==this.operator)&&(this.left._dot_throw(e)||this.right._dot_throw(e))})),e(Kt,(function(e){return"="==this.operator&&this.right._dot_throw(e)})),e(Jt,(function(e){return this.consequent._dot_throw(e)||this.alternative._dot_throw(e)})),e(Vt,(function(e){return!(!t(e)||this.expression instanceof ct&&"prototype"==this.property)})),e(Ut,(function(e){return this.tail_node()._dot_throw(e)})),e(Sn,(function(e){if(ao(this,8))return!0;if(!t(e))return!1;if(he(this)&&this.is_declared(e))return!1;if(this.is_immutable())return!1;var n=this.fixed_value();return!n||n._dot_throw(e)}))}((e,t)=>{e.DEFMETHOD("_dot_throw",t)}),function(e){const t=h("! delete"),n=h("in instanceof == != === !== < <= >= >");e(je,o),e(Xt,(function(){return t.has(this.operator)})),e(Zt,(function(){return n.has(this.operator)||wi.has(this.operator)&&this.left.is_boolean()&&this.right.is_boolean()})),e(Jt,(function(){return this.consequent.is_boolean()&&this.alternative.is_boolean()})),e(Kt,(function(){return"="==this.operator&&this.right.is_boolean()})),e(Ut,(function(){return this.tail_node().is_boolean()})),e(Gn,r),e(Xn,r)}((e,t)=>{e.DEFMETHOD("is_boolean",t)}),(Ti=(e,t)=>{e.DEFMETHOD("is_number",t)})(je,o),Ti(Hn,r),$i=h("+ - ~ ++ --"),Ti(Wt,(function(){return $i.has(this.operator)})),zi=h("- * / % & | ^ << >> >>>"),Ti(Zt,(function(e){return zi.has(this.operator)||"+"==this.operator&&this.left.is_number(e)&&this.right.is_number(e)})),Ti(Kt,(function(e){return zi.has(this.operator.slice(0,-1))||"="==this.operator&&this.right.is_number(e)})),Ti(Ut,(function(e){return this.tail_node().is_number(e)})),Ti(Jt,(function(e){return this.consequent.is_number(e)&&this.alternative.is_number(e)})),(qi=(e,t)=>{e.DEFMETHOD("is_string",t)})(je,o),qi(Nn,r),qi(dt,r),qi(Xt,(function(){return"typeof"==this.operator})),qi(Zt,(function(e){return"+"==this.operator&&(this.left.is_string(e)||this.right.is_string(e))})),qi(Kt,(function(e){return("="==this.operator||"+="==this.operator)&&this.right.is_string(e)})),qi(Ut,(function(e){return this.tail_node().is_string(e)})),qi(Jt,(function(e){return this.consequent.is_string(e)&&this.alternative.is_string(e)})),wi=h("&& || ??"),xi=h("delete ++ --"),function(e){function t(e,t){e.warn("global_defs "+t.print_to_string()+" redefined [{file}:{line},{col}]",t.start)}rt.DEFMETHOD("resolve_defines",(function(e){return e.option("global_defs")?(this.figure_out_scope({ie8:e.option("ie8")}),this.transform(new Li((function(n){var i,o,r,s=n._find_defs(e,"");if(s){for(i=0,o=n;(r=this.parent(i++))&&r instanceof Lt&&r.expression===o;)o=r;if(!ve(o,r))return s;t(e,n)}})))):this})),e(je,i),e(Vt,(function(e,t){return this.expression._find_defs(e,"."+this.property+t)})),e(dn,(function(e){this.global()&&_(e.option("global_defs"),this.name)&&t(e,this)})),e(Sn,(function(e,t){var n,i;if(this.global())return _(n=e.option("global_defs"),i=this.name+t)?function e(t,n){var i,o;if(t instanceof je)return u(t.CTOR,n,t);if(Array.isArray(t))return u(en,n,{elements:t.map(t=>e(t,n))});if(t&&"object"==typeof t){for(o in i=[],t)_(t,o)&&i.push(u(on,n,{key:o,value:e(t[o],n)}));return u(tn,n,{properties:i})}return re(t,n)}(n[i],this):void 0}))}((e,t)=>{e.DEFMETHOD("_find_defs",t)}),Fi=we({Array:["indexOf","join","lastIndexOf","slice"].concat(Ai=["constructor","toString","valueOf"]),Boolean:Ai,Function:Ai,Number:["toExponential","toFixed","toPrecision"].concat(Ai),Object:Ai,RegExp:["test"].concat(Ai),String:["charAt","charCodeAt","concat","indexOf","italics","lastIndexOf","match","replace","search","slice","split","substr","substring","toLowerCase","toUpperCase","trim"].concat(Ai)}),ki=we({Array:["isArray"],Math:["abs","acos","asin","atan","ceil","cos","exp","floor","log","round","sin","sqrt","tan","atan2","pow","max","min"],Number:["isFinite","isNaN"],Object:["create","getOwnPropertyDescriptor","getOwnPropertyNames","getPrototypeOf","isExtensible","isFrozen","isSealed","keys"],String:["fromCharCode"]}),Oi=(e,t)=>{e.DEFMETHOD("_eval",t)},je.DEFMETHOD("evaluate",(function(e){if(!e.option("evaluate"))return this;var t=this._eval(e,1);return!t||t instanceof RegExp?t:"function"==typeof t||"object"==typeof t?this:t})),Mi=h("! ~ - + void"),je.DEFMETHOD("is_constant",(function(){return this instanceof Mn?!(this instanceof jn):this instanceof Xt&&this.expression instanceof Mn&&Mi.has(this.operator)})),Oi(Pe,(function(){throw Error(f("Cannot evaluate a statement [{file}:{line},{col}]",this.start))})),Oi(at,s),Oi(un,s),Oi(je,s),Oi(Mn,(function(){return this.getValue()})),Oi(In,s),Oi(jn,(function(e){let t=e.evaluated_regexps.get(this);if(void 0===t){try{t=(0,eval)(this.print_to_string())}catch(e){t=null}e.evaluated_regexps.set(this,t)}return t||this})),Oi(dt,(function(){return 1!==this.segments.length?this:this.segments[0].value})),Oi(ct,(function(e){if(e.option("unsafe")){var t=()=>{};return t.node=this,t.toString=function(){return this.node.print_to_string()},t}return this})),Oi(en,(function(e,t){var n,i,o,r,s;if(e.option("unsafe")){for(n=[],i=0,o=this.elements.length;i<o;i++){if(s=(r=this.elements[i])._eval(e,t),r===s)return this;n.push(s)}return n}return this})),Oi(tn,(function(e,t){var n,i,o,r,s;if(e.option("unsafe")){for(n={},i=0,o=this.properties.length;i<o;i++){if((r=this.properties[i])instanceof st)return this;if((s=r.key)instanceof pn)s=s.name;else if(s instanceof je&&(s=s._eval(e,t))===r.key)return this;if("function"==typeof Object.prototype[s])return this;if(!(r.value instanceof ct)&&(n[s]=r.value._eval(e,t),n[s]===r.value))return this}return n}return this})),Ni=h("! typeof void"),Oi(Xt,(function(e,t){var n=this.expression;if(e.option("typeofs")&&"typeof"==this.operator&&(n instanceof at||n instanceof Sn&&n.fixed_value()instanceof at))return typeof(()=>{});if(Ni.has(this.operator)||t++,(n=n._eval(e,t))===this.expression)return this;switch(this.operator){case"!":return!n;case"typeof":return n instanceof RegExp?this:typeof n;case"void":return;case"~":return~n;case"-":return-n;case"+":return+n}return this})),Hi=h("&& || ?? === !=="),Oi(Zt,(function(e,t){var n,i,o;if(Hi.has(this.operator)||t++,(n=this.left._eval(e,t))===this.left)return this;if((i=this.right._eval(e,t))===this.right)return this;switch(this.operator){case"&&":o=n&&i;break;case"||":o=n||i;break;case"??":o=null!=n?n:i;break;case"|":o=n|i;break;case"&":o=n&i;break;case"^":o=n^i;break;case"+":o=n+i;break;case"*":o=n*i;break;case"**":o=Math.pow(n,i);break;case"/":o=n/i;break;case"%":o=n%i;break;case"-":o=n-i;break;case"<<":o=n<<i;break;case">>":o=n>>i;break;case">>>":o=n>>>i;break;case"==":o=n==i;break;case"===":o=n===i;break;case"!=":o=n!=i;break;case"!==":o=n!==i;break;case"<":o=n<i;break;case"<=":o=n<=i;break;case">":o=n>i;break;case">=":o=n>=i;break;default:return this}return isNaN(o)&&e.find_parent(it)?this:o})),Oi(Jt,(function(e,t){var n,i,o=this.condition._eval(e,t);return o===this.condition||(i=(n=o?this.consequent:this.alternative)._eval(e,t))===n?this:i})),Oi(Sn,(function(e,t){var n,i,o=this.fixed_value();if(!o)return this;if(_(o,"_eval"))n=o._eval();else{if(this._eval=s,n=o._eval(e,t),delete this._eval,n===o)return this;o._eval=()=>n}return n&&"object"==typeof n&&(i=this.definition().escaped)&&t>i?this:n})),Ii={Array:Array,Math:Math,Number:Number,Object:Object,String:String},ji=we({Math:["E","LN10","LN2","LOG2E","LOG10E","PI","SQRT1_2","SQRT2"],Number:["MAX_VALUE","MIN_VALUE","NaN","NEGATIVE_INFINITY","POSITIVE_INFINITY"]}),Oi(Lt,(function(e,t){var n,i,o,r,s,a;if(e.option("unsafe")){if((n=this.property)instanceof je&&(n=n._eval(e,t))===this.property)return this;if(he(i=this.expression)){if(null==(s=(s="hasOwnProperty"===i.name&&"call"===n&&(r=e.parent()&&e.parent().args)&&r&&r[0]&&r[0].evaluate(e))instanceof Vt?s.expression:s)||s.thedef&&s.thedef.undeclared)return this.clone();if(!(a=ji.get(i.name))||!a.has(n))return this;o=Ii[i.name]}else{if(!(o=i._eval(e,t+1))||o===i||!_(o,n))return this;if("function"==typeof o)switch(n){case"name":return o.node.name?o.node.name.name:"";case"length":return o.node.argnames.length;default:return this}}return o[n]}return this})),Oi(Pt,(function(e,t){var n,i,o,r,s,a,u,c,f,l,p,h=this.expression;if(e.option("unsafe")&&h instanceof Lt){if((n=h.property)instanceof je&&(n=n._eval(e,t))===h.property)return this;if(he(o=h.expression)){if(null==(r=(r="hasOwnProperty"===o.name&&"call"===n&&this.args[0]&&this.args[0].evaluate(e))instanceof Vt?r.expression:r)||r.thedef&&r.thedef.undeclared)return this.clone();if(!(s=ki.get(o.name))||!s.has(n))return this;i=Ii[o.name]}else{if((i=o._eval(e,t+1))===o||!i)return this;if(!(a=Fi.get(i.constructor.name))||!a.has(n))return this}for(u=[],c=0,f=this.args.length;c<f;c++){if(p=(l=this.args[c])._eval(e,t),l===p)return this;u.push(p)}try{return i[n].apply(i,u)}catch(t){e.warn("Error evaluating {code} [{file}:{line},{col}]",{code:this.print_to_string(),file:this.start.file,line:this.start.line,col:this.start.col})}}return this})),Oi(Rt,s),function(e){function t(e){return u(Xt,e,{operator:"!",expression:e})}function n(e,n,i){var o,r=t(e);return i?ye(r,o=u(Le,n,{body:n}))===o?n:r:ye(r,n)}e(je,(function(){return t(this)})),e(Pe,()=>{throw Error("Cannot negate a statement")}),e(ct,(function(){return t(this)})),e(ft,(function(){return t(this)})),e(Xt,(function(){return"!"==this.operator?this.expression:t(this)})),e(Ut,(function(e){var t=this.expressions.slice();return t.push(t.pop().negate(e)),oe(this,t)})),e(Jt,(function(e,t){var i=this.clone();return i.consequent=i.consequent.negate(e),i.alternative=i.alternative.negate(e),n(this,i,t)})),e(Zt,(function(e,i){var o=this.clone(),r=this.operator;if(e.option("unsafe_comps"))switch(r){case"<=":return o.operator=">",o;case"<":return o.operator=">=",o;case">=":return o.operator="<",o;case">":return o.operator="<=",o}switch(r){case"==":return o.operator="!=",o;case"!=":return o.operator="==",o;case"===":return o.operator="!==",o;case"!==":return o.operator="===",o;case"&&":return o.operator="||",o.left=o.left.negate(e,i),o.right=o.right.negate(e),n(this,o,i);case"||":return o.operator="&&",o.left=o.left.negate(e,i),o.right=o.right.negate(e),n(this,o,i);case"??":return o.right=o.right.negate(e),n(this,o,i)}return t(this)}))}((function(e,t){e.DEFMETHOD("negate",(function(e,n){return t.call(this,e,n)}))})),Ci=h("Boolean decodeURI decodeURIComponent Date encodeURI encodeURIComponent Error escape EvalError isFinite isNaN Number Object parseFloat parseInt RangeError ReferenceError String SyntaxError TypeError unescape URIError"),Pt.DEFMETHOD("is_expr_pure",(function(e){var t,n;if(e.option("unsafe")){if(t=this.expression,n=this.args&&this.args[0]&&this.args[0].evaluate(e),t.expression&&"hasOwnProperty"===t.expression.name&&(null==n||n.thedef&&n.thedef.undeclared))return!1;if(he(t)&&Ci.has(t.name))return!0;let i;if(t instanceof Vt&&he(t.expression)&&(i=ki.get(t.expression.name))&&i.has(t.property))return!0}return!!D(this,1)||!e.pure_funcs(this)})),je.DEFMETHOD("is_call_pure",o),Vt.DEFMETHOD("is_call_pure",(function(e){if(!e.option("unsafe"))return;const t=this.expression;let n;return t instanceof en?n=Fi.get("Array"):t.is_boolean()?n=Fi.get("Boolean"):t.is_number(e)?n=Fi.get("Number"):t instanceof jn?n=Fi.get("RegExp"):t.is_string(e)?n=Fi.get("String"):this.may_throw_on_access(e)||(n=Fi.get("Object")),n&&n.has(this.property)}));const lo=new Set(["Number","String","Array","Object","Function","Promise"]);!function(e){function t(e,t){for(var n=e.length;--n>=0;)if(e[n].has_side_effects(t))return!0;return!1}e(je,r),e(We,o),e(Mn,o),e(qn,o),e(Ve,(function(e){return t(this.body,e)})),e(Pt,(function(e){return!(this.is_expr_pure(e)||this.expression.is_call_pure(e)&&!this.expression.has_side_effects(e))||t(this.args,e)})),e(Ft,(function(e){return this.expression.has_side_effects(e)||t(this.body,e)})),e(Bt,(function(e){return this.expression.has_side_effects(e)||t(this.body,e)})),e(St,(function(e){return t(this.body,e)||this.bcatch&&this.bcatch.has_side_effects(e)||this.bfinally&&this.bfinally.has_side_effects(e)})),e(At,(function(e){return this.condition.has_side_effects(e)||this.body&&this.body.has_side_effects(e)||this.alternative&&this.alternative.has_side_effects(e)})),e(Ge,(function(e){return this.body.has_side_effects(e)})),e(Le,(function(e){return this.body.has_side_effects(e)})),e(at,o),e(un,(function(e){return!(!this.extends||!this.extends.has_side_effects(e))||t(this.properties,e)})),e(Zt,(function(e){return this.left.has_side_effects(e)||this.right.has_side_effects(e)})),e(Kt,r),e(Jt,(function(e){return this.condition.has_side_effects(e)||this.consequent.has_side_effects(e)||this.alternative.has_side_effects(e)})),e(Wt,(function(e){return xi.has(this.operator)||this.expression.has_side_effects(e)})),e(Sn,(function(e){return!this.is_declared(e)&&!lo.has(this.name)})),e(En,o),e(dn,o),e(tn,(function(e){return t(this.properties,e)})),e(nn,(function(e){return this.computed_key()&&this.key.has_side_effects(e)||this.value.has_side_effects(e)})),e(cn,(function(e){return this.computed_key()&&this.key.has_side_effects(e)||this.static&&this.value&&this.value.has_side_effects(e)})),e(an,(function(e){return this.computed_key()&&this.key.has_side_effects(e)})),e(sn,(function(e){return this.computed_key()&&this.key.has_side_effects(e)})),e(rn,(function(e){return this.computed_key()&&this.key.has_side_effects(e)})),e(en,(function(e){return t(this.elements,e)})),e(Vt,(function(e){return this.expression.may_throw_on_access(e)||this.expression.has_side_effects(e)})),e(Yt,(function(e){return this.expression.may_throw_on_access(e)||this.expression.has_side_effects(e)||this.property.has_side_effects(e)})),e(Ut,(function(e){return t(this.expressions,e)})),e(zt,(function(e){return t(this.definitions,e)})),e(Nt,(function(){return this.value})),e(_t,o),e(dt,(function(e){return t(this.segments,e)}))}((e,t)=>{e.DEFMETHOD("has_side_effects",t)}),function(e){function t(e,t){for(var n=e.length;--n>=0;)if(e[n].may_throw(t))return!0;return!1}e(je,r),e(Mn,o),e(We,o),e(at,o),e(dn,o),e(qn,o),e(un,(function(e){return!(!this.extends||!this.extends.may_throw(e))||t(this.properties,e)})),e(en,(function(e){return t(this.elements,e)})),e(Kt,(function(e){return!!this.right.may_throw(e)||!(!e.has_directive("use strict")&&"="==this.operator&&this.left instanceof Sn)&&this.left.may_throw(e)})),e(Zt,(function(e){return this.left.may_throw(e)||this.right.may_throw(e)})),e(Ve,(function(e){return t(this.body,e)})),e(Pt,(function(e){return!!t(this.args,e)||!this.is_expr_pure(e)&&(!!this.expression.may_throw(e)||!(this.expression instanceof at)||t(this.expression.body,e))})),e(Bt,(function(e){return this.expression.may_throw(e)||t(this.body,e)})),e(Jt,(function(e){return this.condition.may_throw(e)||this.consequent.may_throw(e)||this.alternative.may_throw(e)})),e(zt,(function(e){return t(this.definitions,e)})),e(Vt,(function(e){return this.expression.may_throw_on_access(e)||this.expression.may_throw(e)})),e(At,(function(e){return this.condition.may_throw(e)||this.body&&this.body.may_throw(e)||this.alternative&&this.alternative.may_throw(e)})),e(Ge,(function(e){return this.body.may_throw(e)})),e(tn,(function(e){return t(this.properties,e)})),e(nn,(function(e){return this.value.may_throw(e)})),e(cn,(function(e){return this.computed_key()&&this.key.may_throw(e)||this.static&&this.value&&this.value.may_throw(e)})),e(an,(function(e){return this.computed_key()&&this.key.may_throw(e)})),e(sn,(function(e){return this.computed_key()&&this.key.may_throw(e)})),e(rn,(function(e){return this.computed_key()&&this.key.may_throw(e)})),e(Dt,(function(e){return this.value&&this.value.may_throw(e)})),e(Ut,(function(e){return t(this.expressions,e)})),e(Le,(function(e){return this.body.may_throw(e)})),e(Yt,(function(e){return this.expression.may_throw_on_access(e)||this.expression.may_throw(e)||this.property.may_throw(e)})),e(Ft,(function(e){return this.expression.may_throw(e)||t(this.body,e)})),e(Sn,(function(e){return!this.is_declared(e)&&!lo.has(this.name)})),e(En,o),e(St,(function(e){return this.bcatch?this.bcatch.may_throw(e):t(this.body,e)||this.bfinally&&this.bfinally.may_throw(e)})),e(Wt,(function(e){return!("typeof"==this.operator&&this.expression instanceof Sn)&&this.expression.may_throw(e)})),e(Nt,(function(e){return!!this.value&&this.value.may_throw(e)}))}((e,t)=>{e.DEFMETHOD("may_throw",t)}),function(e){function n(e){let n=!0;return w(this,i=>{var o,r;return i instanceof Sn?ao(this,16)?(n=!1,Ri):!(t(o=i.definition(),this.enclosed)&&!this.variables.has(o.name))||(e&&(r=e.find_variable(i),o.undeclared?!r:r===o)?(n="f",!0):(n=!1,Ri)):i instanceof qn&&this instanceof ft?(n=!1,Ri):void 0}),n}e(je,o),e(Mn,r),e(un,(function(e){if(this.extends&&!this.extends.is_constant_expression(e))return!1;for(const t of this.properties){if(t.computed_key()&&!t.key.is_constant_expression(e))return!1;if(t.static&&t.value&&!t.value.is_constant_expression(e))return!1}return n.call(this,e)})),e(at,n),e(Wt,(function(){return this.expression.is_constant_expression()})),e(Zt,(function(){return this.left.is_constant_expression()&&this.right.is_constant_expression()})),e(en,(function(){return this.elements.every(e=>e.is_constant_expression())})),e(tn,(function(){return this.properties.every(e=>e.is_constant_expression())})),e(nn,(function(){return!(this.key instanceof je)&&this.value.is_constant_expression()}))}((e,t)=>{e.DEFMETHOD("is_constant_expression",t)}),function(e){function t(){for(var e=0;e<this.body.length;e++)if(xe(this.body[e]))return this.body[e];return null}e(Pe,a),e(mt,s),e(It,()=>null),e(Ye,t),e(kt,t),e(At,(function(){return this.alternative&&xe(this.body)&&xe(this.alternative)&&this}))}((e,t)=>{e.DEFMETHOD("aborts",t)}),Bi=new Set(["use asm","use strict"]),Z(Ue,(e,t)=>!t.option("directives")||Bi.has(e.value)&&t.has_directive(e.value)===e?e:u(We,e)),Z(Re,(e,t)=>t.option("drop_debugger")?u(We,e):e),Z(Ge,(e,t)=>e.body instanceof bt&&t.loopcontrol_target(e.body)===e.body?u(We,e):0==e.label.references.length?e.body:e),Z(Ve,(e,t)=>(_e(e.body,t),e)),Z(Ye,(e,t)=>{switch(_e(e.body,t),e.body.length){case 1:if(!t.has_directive("use strict")&&t.parent()instanceof At&&!((n=e.body[0])instanceof Mt||n instanceof Ot||n instanceof un)||fe(e.body[0]))return e.body[0];break;case 0:return u(We,e)}var n;return e}),Z(at,Ae);const po=/keep_assign/;ot.DEFMETHOD("drop_unused",(function(e){function t(e,t){var i,o;const r=g(e);if(r instanceof Sn&&!te(e.left,mn)&&n.variables.get(r.name)===(i=r.definition()))return e instanceof Kt&&(e.right.walk(h),i.chained||e.left.fixed_value()!==e.right||a.set(i.id,e)),!0;if(e instanceof Sn){if(i=e.definition(),!s.has(i.id)&&(s.set(i.id,i),i.orig[0]instanceof Fn)){const e=i.scope.is_block_scope()&&i.scope.get_defun_scope().variables.get(i.name);e&&s.set(e.id,e)}return!0}return e instanceof ot?(o=p,p=e,t(),p=o,!0):void 0}var n,i,r,s,a,c,f,p,h,_;if(!e.option("unused"))return;if(e.has_directive("use asm"))return;if((n=this).pinned())return;i=!(n instanceof rt)||e.toplevel.funcs,r=!(n instanceof rt)||e.toplevel.vars;const g=po.test(e.option("unused"))?o:e=>e instanceof Kt&&(ao(e,32)||"="==e.operator)?e.left:e instanceof Wt&&ao(e,32)?e.expression:void 0;s=new Map,a=new Map,n instanceof rt&&e.top_retain&&n.variables.forEach(t=>{e.top_retain(t)&&!s.has(t.id)&&s.set(t.id,t)}),c=new Map,f=new Map,p=this,h=new Ui((o,u)=>{if(o instanceof at&&o.uses_arguments&&!h.has_directive("use strict")&&o.argnames.forEach(e=>{if(e instanceof dn){var t=e.definition();s.has(t.id)||s.set(t.id,t)}}),o!==n){if(o instanceof lt||o instanceof fn){var l=o.name.definition();if((h.parent()instanceof jt||!i&&p===n)&&l.global&&!s.has(l.id)&&s.set(l.id,l),o instanceof fn){o.extends&&(o.extends.has_side_effects(e)||o.extends.may_throw(e))&&o.extends.walk(h);for(const t of o.properties)(t.has_side_effects(e)||t.may_throw(e))&&t.walk(h)}return d(f,l.id,o),!0}if(o instanceof vn&&p===n&&d(c,o.definition().id,o),o instanceof zt&&p===n){const t=h.parent()instanceof jt;return o.definitions.forEach(n=>{if(n.name instanceof _n&&d(c,n.name.definition().id,n),!t&&r||w(n.name,e=>{if(e instanceof dn){const n=e.definition();!t&&!n.global||s.has(n.id)||s.set(n.id,n)}}),n.value){if(n.name instanceof pt)n.walk(h);else{var i=n.name.definition();d(f,i.id,n.value),i.chained||n.name.fixed_value()!==n.value||a.set(i.id,n)}n.value.has_side_effects(e)&&n.value.walk(h)}}),!0}return t(o,u)}}),n.walk(h),h=new Ui(t),s.forEach(e=>{var t=f.get(e.id);t&&t.forEach(e=>{e.walk(h)})}),_=new Li((function(t,o,f){function h(e){return{name:e.name,file:e.start.file,line:e.start.line,col:e.start.col}}var d,D,v,y,b,E,w,x,A,F,k,C,B=_.parent();if(r){const e=g(t);if(e instanceof Sn)if(d=e.definition(),D=s.has(d.id),t instanceof Kt){if(!D||a.has(d.id)&&a.get(d.id)!==t)return se(B,t,t.right.transform(_))}else if(!D)return f?Ne.skip:u(Hn,t,{value:0})}if(p===n){if(t.name&&(t instanceof ln&&!m(e.option("keep_classnames"),(d=t.name.definition()).name)||t instanceof ct&&!m(e.option("keep_fnames"),(d=t.name.definition()).name))&&(!s.has(d.id)||d.orig.length>1)&&(t.name=null),t instanceof at&&!(t instanceof ut))for(v=!e.option("keep_fargs"),b=(y=t.argnames).length;--b>=0;)(E=y[b])instanceof st&&(E=E.expression),E instanceof Qt&&(E=E.left),E instanceof pt||s.has(E.definition().id)?v=!1:(uo(E,1),v&&(y.pop(),e[E.unreferenced()?"warn":"info"]("Dropping unused function argument {name} [{file}:{line},{col}]",h(E))));if((t instanceof lt||t instanceof fn)&&t!==n){const n=t.name.definition();if(!(n.global&&!i||s.has(n.id))){if(e[t.name.unreferenced()?"warn":"info"]("Dropping unused function {name} [{file}:{line},{col}]",h(t.name)),n.eliminated++,t instanceof fn){const n=t.drop_side_effect_free(e);if(n)return u(Le,t,{body:n})}return f?Ne.skip:u(We,t)}}if(t instanceof zt&&!(B instanceof tt&&B.init===t))switch(w=!(B instanceof rt||t instanceof qt),x=[],A=[],F=[],k=[],t.definitions.forEach(n=>{var i,o,f,p,d,m;if(n.value&&(n.value=n.value.transform(_)),o=(i=n.name instanceof pt)?new Xi(null,{name:"<destructure>"}):n.name.definition(),w&&o.global)return F.push(n);if(!r&&!w||i&&(n.name.names.length||n.name.is_array||1!=e.option("pure_getters"))||s.has(o.id)){if(n.value&&a.has(o.id)&&a.get(o.id)!==n&&(n.value=n.value.drop_side_effect_free(e)),n.name instanceof _n&&(f=c.get(o.id)).length>1&&(!n.value||o.orig.indexOf(n.name)>o.eliminated))return e.warn("Dropping duplicated definition of variable {name} [{file}:{line},{col}]",h(n.name)),n.value&&(p=u(Sn,n.name,n.name),o.references.push(p),d=u(Kt,n,{operator:"=",left:p,right:n.value}),a.get(o.id)===n&&a.set(o.id,d),k.push(d.transform(_))),l(f,n),void o.eliminated++;n.value?(k.length>0&&(F.length>0?(k.push(n.value),n.value=oe(n.value,k)):x.push(u(Le,t,{body:oe(t,k)})),k=[]),F.push(n)):A.push(n)}else o.orig[0]instanceof Fn?((m=n.value&&n.value.drop_side_effect_free(e))&&k.push(m),n.value=null,A.push(n)):((m=n.value&&n.value.drop_side_effect_free(e))?(i||e.warn("Side effects in initialization of unused variable {name} [{file}:{line},{col}]",h(n.name)),k.push(m)):i||e[n.name.unreferenced()?"warn":"info"]("Dropping unused variable {name} [{file}:{line},{col}]",h(n.name)),o.eliminated++)}),(A.length>0||F.length>0)&&(t.definitions=A.concat(F),x.push(t)),k.length>0&&x.push(u(Le,t,{body:oe(t,k)})),x.length){case 0:return f?Ne.skip:u(We,t);case 1:return x[0];default:return f?Ne.splice(x):u(Ye,t,{body:x})}if(t instanceof et)return o(t,this),t.init instanceof Ye&&(C=t.init,t.init=C.body.pop(),C.body.push(t)),t.init instanceof Le?t.init=t.init.body:ce(t.init)&&(t.init=null),C?f?Ne.splice(C.body):C:t;if(t instanceof Ge&&t.body instanceof et)return o(t,this),t.body instanceof Ye?(C=t.body,t.body=C.body.pop(),C.body.push(t),f?Ne.splice(C.body):C):t;if(t instanceof Ye)return o(t,this),f&&t.body.every(fe)?Ne.splice(t.body):t;if(t instanceof ot){const e=p;return p=t,o(t,this),p=e,t}}})),n.transform(_)})),ot.DEFMETHOD("hoist_declarations",(function(e){var t,n,i,o,r,s,a,c,f,p,h,d,_,m,g,D=this;if(e.has_directive("use asm"))return D;if(!Array.isArray(D.body))return D;if(t=e.option("hoist_funs"),n=e.option("hoist_vars"),t||n){if(i=[],o=[],r=new Map,s=0,a=0,w(D,e=>e instanceof ot&&e!==D||(e instanceof qt?(++a,!0):void 0)),n=n&&a>1,c=new Li(a=>{var f,l,p;if(a!==D){if(a instanceof Ue)return i.push(a),u(We,a);if(t&&a instanceof lt&&!(c.parent()instanceof jt)&&c.parent()===D)return o.push(a),u(We,a);if(n&&a instanceof qt)return a.definitions.forEach(e=>{e.name instanceof pt||(r.set(e.name.name,e),++s)}),f=a.to_assignments(e),(l=c.parent())instanceof tt&&l.init===a?null==f?(p=a.definitions[0].name,u(Sn,p,p)):f:l instanceof et&&l.init===a?f:f?u(Le,a,{body:f}):u(We,a);if(a instanceof ot)return a}}),D=D.transform(c),s>0){f=[];const e=D instanceof at,t=e?D.args_as_names():null;if(r.forEach((n,i)=>{e&&t.some(e=>e.name===n.name.name)?r.delete(i):((n=n.clone()).value=null,f.push(n),r.set(i,n))}),f.length>0){for(p=0;p<D.body.length;){if(D.body[p]instanceof Le){if((h=D.body[p].body)instanceof Kt&&"="==h.operator&&(d=h.left)instanceof pn&&r.has(d.name)){if((m=r.get(d.name)).value)break;m.value=h.right,l(f,m),f.push(m),D.body.splice(p,1);continue}if(h instanceof Ut&&(_=h.expressions[0])instanceof Kt&&"="==_.operator&&(d=_.left)instanceof pn&&r.has(d.name)){if((m=r.get(d.name)).value)break;m.value=_.right,l(f,m),f.push(m),D.body[p].body=oe(h,h.expressions.slice(1));continue}}if(D.body[p]instanceof We)D.body.splice(p,1);else{if(!(D.body[p]instanceof Ye))break;g=[p,1].concat(D.body[p].body),D.body.splice.apply(D.body,g)}}f=u(qt,D,{definitions:f}),o.push(f)}}D.body=i.concat(o,D.body)}return D})),ot.DEFMETHOD("make_var_name",(function(e){var t,n,i=this.var_names();for(t=e=e.replace(/(?:^[^a-z_$]|[^a-z0-9_$])/gi,"_"),n=0;i.has(t);n++)t=e+"$"+n;return this.add_var_name(t),t})),ot.DEFMETHOD("hoist_properties",(function(e){var t,n,i,r=this;return!e.option("hoist_props")||e.has_directive("use asm")?r:(t=r instanceof rt&&e.top_retain||o,n=new Map,i=new Li((function(o,s){function a(e,t,n){const i=u(e.CTOR,e,{name:r.make_var_name(e.name+"_"+t),scope:r}),o=r.def_variable(i);return n.set(t+"",o),r.enclosed.push(o),i}if(o instanceof zt&&i.parent()instanceof jt)return o;if(o instanceof Nt){const i=o.name;let c,f;if(i.scope===r&&1!=(c=i.definition()).escaped&&!c.assignments&&!c.direct_access&&!c.single_use&&!e.exposed(c)&&!t(c)&&(f=i.fixed_value())===o.value&&f instanceof tn&&f.properties.every(e=>"string"==typeof e.key)){s(o,this);const e=new Map,t=[];return f.properties.forEach(n=>{t.push(u(Nt,o,{name:a(i,n.key,e),value:n.value}))}),n.set(c.id,e),Ne.splice(t)}}else if(o instanceof Lt&&o.expression instanceof Sn){const e=n.get(o.expression.definition().id);if(e){const t=e.get(ge(o.property)+""),n=u(Sn,o,{name:t.name,scope:o.expression.scope,thedef:t});return n.reference({}),n}}})),r.transform(i))})),function(e){function t(e,t,n){var i,o,r,s,a=e.length;if(!a)return null;for(i=[],o=!1,r=0;r<a;r++)o|=(s=e[r].drop_side_effect_free(t,n))!==e[r],s&&(i.push(s),n=!1);return o?i.length?i:null:e}e(je,s),e(Mn,a),e(qn,a),e(Pt,(function(e,n){var i,o,r;return this.is_expr_pure(e)?(D(this,1)&&e.warn("Dropping __PURE__ call [{file}:{line},{col}]",this.start),(r=t(this.args,e,n))&&oe(this,r)):this.expression.is_call_pure(e)?((i=this.args.slice()).unshift(this.expression.expression),(i=t(i,e,n))&&oe(this,i)):!Q(this.expression)||this.expression.name&&this.expression.name.definition().references.length?this:((o=this.clone()).expression.process_expression(!1,e),o)})),e(ut,a),e(ct,a),e(ft,a),e(un,(function(e){const t=[],n=this.extends&&this.extends.drop_side_effect_free(e);n&&t.push(n);for(const n of this.properties){const i=n.drop_side_effect_free(e);i&&t.push(i)}return t.length?oe(this,t):null})),e(Zt,(function(e,t){var n,i,o=this.right.drop_side_effect_free(e);return o?wi.has(this.operator)?o===this.right?this:((n=this.clone()).right=o,n):(i=this.left.drop_side_effect_free(e,t))?oe(this,[i,o]):this.right.drop_side_effect_free(e,t):this.left.drop_side_effect_free(e,t)})),e(Kt,(function(e){var t=this.left;if(t.has_side_effects(e)||e.has_directive("use strict")&&t instanceof Lt&&t.expression.is_constant())return this;for(uo(this,32);t instanceof Lt;)t=t.expression;return t.is_constant_expression(e.find_parent(ot))?this.right.drop_side_effect_free(e):this})),e(Jt,(function(e){var t,n=this.consequent.drop_side_effect_free(e),i=this.alternative.drop_side_effect_free(e);return n===this.consequent&&i===this.alternative?this:n?i?((t=this.clone()).consequent=n,t.alternative=i,t):u(Zt,this,{operator:"&&",left:this.condition,right:n}):i?u(Zt,this,{operator:"||",left:this.condition,right:i}):this.condition.drop_side_effect_free(e)})),e(Wt,(function(e,t){if(xi.has(this.operator))return this.expression.has_side_effects(e)?co(this,32):uo(this,32),this;if("typeof"==this.operator&&this.expression instanceof Sn)return null;var n=this.expression.drop_side_effect_free(e,t);return t&&n&&pe(n)?n===this.expression&&"!"==this.operator?this:n.negate(e,t):n})),e(Sn,(function(e){return this.is_declared(e)||lo.has(this.name)?null:this})),e(tn,(function(e,n){var i=t(this.properties,e,n);return i&&oe(this,i)})),e(nn,(function(e,t){const n=this instanceof on&&this.key instanceof je&&this.key.drop_side_effect_free(e,t),i=this.value.drop_side_effect_free(e,t);return n&&i?oe(this,[n,i]):n||i})),e(cn,(function(e){const t=this.computed_key()&&this.key.drop_side_effect_free(e),n=this.static&&this.value&&this.value.drop_side_effect_free(e);return t&&n?oe(this,[t,n]):t||n||null})),e(an,(function(){return this.computed_key()?this.key:null})),e(sn,(function(){return this.computed_key()?this.key:null})),e(rn,(function(){return this.computed_key()?this.key:null})),e(en,(function(e,n){var i=t(this.elements,e,n);return i&&oe(this,i)})),e(Vt,(function(e,t){return this.expression.may_throw_on_access(e)?this:this.expression.drop_side_effect_free(e,t)})),e(Yt,(function(e,t){var n,i;return this.expression.may_throw_on_access(e)?this:(n=this.expression.drop_side_effect_free(e,t))?(i=this.property.drop_side_effect_free(e))?oe(this,[n,i]):n:this.property.drop_side_effect_free(e,t)})),e(Ut,(function(e){var t,n=this.tail_node(),i=n.drop_side_effect_free(e);return i===n?this:(t=this.expressions.slice(0,-1),i&&t.push(i),t.length?oe(this,t):u(Hn,this,{value:0}))})),e(st,(function(e,t){return this.expression.drop_side_effect_free(e,t)})),e(_t,a),e(dt,(function(e){var n=t(this.segments,e,R);return n&&oe(this,n)}))}((e,t)=>{e.DEFMETHOD("drop_side_effect_free",t)}),Z(Le,(e,t)=>{var n,i;if(t.option("side_effects")){if(!(i=(n=e.body).drop_side_effect_free(t,!0)))return t.warn("Dropping side-effect-free statement [{file}:{line},{col}]",e.start),u(We,e);if(i!==n)return u(Le,e,{body:i})}return e}),Z(Qe,(e,t)=>t.option("loops")?u(et,e,e).optimize(t):e),Z(Ke,(e,t)=>{if(!t.option("loops"))return e;var n=e.condition.tail_node().evaluate(t);if(!(n instanceof je)){if(n)return u(et,e,{body:u(Ye,e.body,{body:[e.body,u(Le,e.condition,{body:e.condition})]})}).optimize(t);if(!Fe(e,t.parent()))return u(Ye,e.body,{body:[e.body,u(Le,e.condition,{body:e.condition})]}).optimize(t)}return e}),Z(et,(e,t)=>{var n,i,o;return t.option("loops")?(t.option("side_effects")&&e.init&&(e.init=e.init.drop_side_effect_free(t)),
	e.condition&&((n=e.condition.evaluate(t))instanceof je||(n?e.condition=null:t.option("dead_code")||(i=e.condition,e.condition=re(n,e.condition),e.condition=ye(e.condition.transform(t),i))),t.option("dead_code")&&(n instanceof je&&(n=e.condition.tail_node().evaluate(t)),!n))?(o=[],me(t,e.body,o),e.init instanceof Pe?o.push(e.init):e.init&&o.push(u(Le,e.init,{body:e.init})),o.push(u(Le,e.condition,{body:e.condition})),u(Ye,e,{body:o}).optimize(t)):function e(t,n){function i(e){return e instanceof bt&&n.loopcontrol_target(e)===n.self()}function o(i){i=ue(i),t.body instanceof Ye?(t.body=t.body.clone(),t.body.body=i.concat(t.body.body.slice(1)),t.body=t.body.transform(n)):t.body=u(Ye,t.body,{body:i}).transform(n),t=e(t,n)}var r,s=t.body instanceof Ye?t.body.body[0]:t.body;return n.option("dead_code")&&i(s)?(r=[],t.init instanceof Pe?r.push(t.init):t.init&&r.push(u(Le,t.init,{body:t.init})),t.condition&&r.push(u(Le,t.condition,{body:t.condition})),me(n,t.body,r),u(Ye,t,{body:r})):(s instanceof At&&(i(s.body)?(t.condition?t.condition=u(Zt,t.condition,{left:t.condition,operator:"&&",right:s.condition.negate(n)}):t.condition=s.condition.negate(n),o(s.alternative)):i(s.alternative)&&(t.condition?t.condition=u(Zt,t.condition,{left:t.condition,operator:"&&",right:s.condition}):t.condition=s.condition,o(s.body))),t)}(e,t)):e}),Z(At,(e,t)=>{var n,i,o,r,s,a,c,f,l;if(ce(e.alternative)&&(e.alternative=null),!t.option("conditionals"))return e;if(n=e.condition.evaluate(t),t.option("dead_code")||n instanceof je||(i=e.condition,e.condition=re(n,i),e.condition=ye(e.condition.transform(t),i)),t.option("dead_code")){if(n instanceof je&&(n=e.condition.tail_node().evaluate(t)),!n)return t.warn("Condition always false [{file}:{line},{col}]",e.condition.start),o=[],me(t,e.body,o),o.push(u(Le,e.condition,{body:e.condition})),e.alternative&&o.push(e.alternative),u(Ye,e,{body:o}).optimize(t);if(!(n instanceof je))return t.warn("Condition always true [{file}:{line},{col}]",e.condition.start),(o=[]).push(u(Le,e.condition,{body:e.condition})),o.push(e.body),e.alternative&&me(t,e.alternative,o),u(Ye,e,{body:o}).optimize(t)}return r=e.condition.negate(t),s=e.condition.size(),c=(a=r.size())<s,e.alternative&&c&&(c=!1,e.condition=r,f=e.body,e.body=e.alternative||u(We,e),e.alternative=f),ce(e.body)&&ce(e.alternative)?u(Le,e.condition,{body:e.condition.clone()}).optimize(t):e.body instanceof Le&&e.alternative instanceof Le?u(Le,e,{body:u(Jt,e,{condition:e.condition,consequent:e.body.body,alternative:e.alternative.body})}).optimize(t):ce(e.alternative)&&e.body instanceof Le?(s===a&&!c&&e.condition instanceof Zt&&"||"==e.condition.operator&&(c=!0),c?u(Le,e,{body:u(Zt,e,{operator:"||",left:r,right:e.body.body})}).optimize(t):u(Le,e,{body:u(Zt,e,{operator:"&&",left:e.condition,right:e.body.body})}).optimize(t)):e.body instanceof We&&e.alternative instanceof Le?u(Le,e,{body:u(Zt,e,{operator:"||",left:e.condition,right:e.alternative.body})}).optimize(t):e.body instanceof gt&&e.alternative instanceof gt&&e.body.TYPE==e.alternative.TYPE?u(e.body.CTOR,e,{value:u(Jt,e,{condition:e.condition,consequent:e.body.value||u(Ln,e.body),alternative:e.alternative.value||u(Ln,e.alternative)}).transform(t)}).optimize(t):(e.body instanceof At&&!e.body.alternative&&!e.alternative&&(e=u(At,e,{condition:u(Zt,e.condition,{operator:"&&",left:e.condition,right:e.body.condition}),body:e.body.body,alternative:null})),xe(e.body)&&e.alternative?(l=e.alternative,e.alternative=null,u(Ye,e,{body:[e,l]}).optimize(t)):xe(e.alternative)?(o=e.body,e.body=e.alternative,e.condition=c?r:e.condition.negate(t),e.alternative=null,u(Ye,e,{body:[e,o]}).optimize(t)):e)}),Z(Ft,(e,t)=>{function n(e,n){n&&!xe(n)?n.body=n.body.concat(e.body):me(t,e,s)}var i,o,r,s,a,c,f,l,p,h,d,_,m,g,D,v;if(!t.option("switches"))return e;if((o=e.expression.evaluate(t))instanceof je||(r=e.expression,e.expression=re(o,r),e.expression=ye(e.expression.transform(t),r)),!t.option("dead_code"))return e;for(o instanceof je&&(o=e.expression.tail_node().evaluate(t)),s=[],a=[],l=0,p=e.body.length;l<p&&!f;l++){if((i=e.body[l])instanceof Ct)c?n(i,a[a.length-1]):c=i;else if(!(o instanceof je)){if(!((h=i.expression.evaluate(t))instanceof je)&&h!==o){n(i,a[a.length-1]);continue}h instanceof je&&(h=i.expression.tail_node().evaluate(t)),h===o&&(f=i,c&&(d=a.indexOf(c),a.splice(d,1),n(c,a[d-1]),c=null))}xe(i)&&xe(_=a[a.length-1])&&_.body.length==i.body.length&&u(Ye,_,_).equivalent_to(u(Ye,i,i))&&(_.body=[]),a.push(i)}for(;l<p;)n(e.body[l++],a[a.length-1]);for(a.length>0&&(a[0].body=s.concat(a[0].body)),e.body=a;(i=a[a.length-1])&&((m=i.body[i.body.length-1])instanceof bt&&t.loopcontrol_target(m)===e&&i.body.pop(),!(i.body.length||i instanceof Bt&&(c||i.expression.has_side_effects(t))));)a.pop()===c&&(c=null);return 0==a.length?u(Ye,e,{body:s.concat(u(Le,e.expression,{body:e.expression}))}).optimize(t):1!=a.length||a[0]!==f&&a[0]!==c||(g=!1,D=new Ui(t=>{if(g||t instanceof at||t instanceof Le)return!0;t instanceof bt&&D.loopcontrol_target(t)===e&&(g=!0)}),e.walk(D),g)?e:(v=a[0].body.slice(),(h=a[0].expression)&&v.unshift(u(Le,h,{body:h})),v.unshift(u(Le,e.expression,{body:e.expression})),u(Ye,e,{body:v}).optimize(t))}),Z(St,(e,t)=>{if(_e(e.body,t),e.bcatch&&e.bfinally&&e.bfinally.body.every(ce)&&(e.bfinally=null),t.option("dead_code")&&e.body.every(ce)){var n=[];return e.bcatch&&me(t,e.bcatch,n),e.bfinally&&n.push(...e.bfinally.body),u(Ye,e,{body:n}).optimize(t)}return e}),zt.DEFMETHOD("remove_initializers",(function(){var e=[];this.definitions.forEach(t=>{t.name instanceof dn?(t.value=null,e.push(t)):w(t.name,n=>{n instanceof dn&&e.push(u(Nt,t,{name:n,value:null}))})}),this.definitions=e})),zt.DEFMETHOD("to_assignments",(function(e){var t=e.option("reduce_vars"),n=this.definitions.reduce((e,n)=>{var i,o,r;return!n.value||n.name instanceof pt?n.value&&(o=u(Nt,n,{name:n.name,value:n.value}),r=u(qt,n,{definitions:[o]}),e.push(r)):(i=u(Sn,n.name,n.name),e.push(u(Kt,n,{operator:"=",left:i,right:n.value})),t&&(i.definition().fixed=!1)),(n=n.name.definition()).eliminated++,n.replaced--,e},[]);return 0==n.length?null:oe(this,n)})),Z(zt,e=>0==e.definitions.length?u(We,e):e),Z(It,e=>e),Z(Pt,(function(e,t){function n(t){return t?t instanceof Dt?t.value?t.value.clone(!0):u(Ln,e):t instanceof Le?u(Xt,t,{operator:"void",expression:t.body.clone(!0)}):void 0:u(Ln,e)}function i(t,n,i,o){var r,s=i.definition();O.variables.set(i.name,s),O.enclosed.push(s),O.var_names().has(i.name)||(O.add_var_name(i.name),t.push(u(Nt,i,{name:i,value:null}))),r=u(Sn,i,i),s.references.push(r),o&&n.push(u(Kt,e,{operator:"=",left:r,right:o.clone()}))}var o,r,s,a,c,f,l,p,h,d,_,m,v,y,b,E,x,A,F,k,C,B,S,T,$,z,q,O,M,H,I,j=e.expression,P=j;if(Oe(e,0,e.args),o=e.args.every(e=>!(e instanceof st)),t.option("reduce_vars")&&P instanceof Sn&&!D(e,4)){const e=P.fixed_value();ke(e,t)||(P=e)}if(r=P instanceof at,t.option("unused")&&o&&r&&!P.uses_arguments&&!P.pinned()){for(s=0,a=0,c=0,f=e.args.length;c<f;c++){if(P.argnames[c]instanceof st){if(ao(P.argnames[c].expression,1))for(;c<f;)(l=e.args[c++].drop_side_effect_free(t))&&(e.args[s++]=l);else for(;c<f;)e.args[s++]=e.args[c++];a=s;break}if((p=c>=P.argnames.length)||ao(P.argnames[c],1)){if(l=e.args[c].drop_side_effect_free(t))e.args[s++]=l;else if(!p){e.args[s++]=u(Hn,e.args[c],{value:0});continue}}else e.args[s++]=e.args[c];a=s}e.args.length=a}if(t.option("unsafe"))if(he(j))switch(j.name){case"Array":if(1!=e.args.length)return u(en,e,{elements:e.args}).optimize(t);if(e.args[0]instanceof Hn&&e.args[0].value<=11){const t=[];for(let n=0;n<e.args[0].value;n++)t.push(new Vn);return new en({elements:t})}break;case"Object":if(0==e.args.length)return u(tn,e,{properties:[]});break;case"String":if(0==e.args.length)return u(Nn,e,{value:""});if(e.args.length<=1)return u(Zt,e,{left:e.args[0],operator:"+",right:u(Nn,e,{value:""})}).optimize(t);break;case"Number":if(0==e.args.length)return u(Hn,e,{value:0});if(1==e.args.length&&t.option("unsafe_math"))return u(Xt,e,{expression:e.args[0],operator:"+"}).optimize(t);break;case"Symbol":1==e.args.length&&e.args[0]instanceof Nn&&t.option("unsafe_symbols")&&(e.args.length=0);break;case"Boolean":if(0==e.args.length)return u(Xn,e);if(1==e.args.length)return u(Xt,e,{expression:u(Xt,e,{expression:e.args[0],operator:"!"}),operator:"!"}).optimize(t);break;case"RegExp":if(h=[],e.args.length>=1&&e.args.length<=2&&e.args.every(e=>{var n=e.evaluate(t);return h.push(n),e!==n})){let[n,i]=h;n=g(RegExp(n).source);const o=u(jn,e,{value:{source:n,flags:i}});if(o._eval(t)!==o)return o;t.warn("Error converting {expr} [{file}:{line},{col}]",{expr:e.print_to_string(),file:e.start.file,line:e.start.line,col:e.start.col})}}else if(j instanceof Vt)switch(j.property){case"toString":if(0==e.args.length&&!j.expression.may_throw_on_access(t))return u(Zt,e,{left:u(Nn,e,{value:""}),operator:"+",right:j.expression}).optimize(t);break;case"join":if(j.expression instanceof en)e:if(!(e.args.length>0&&(d=e.args[0].evaluate(t))===e.args[0])){for(_=[],m=[],c=0,f=j.expression.elements.length;c<f;c++){if((v=j.expression.elements[c])instanceof st)break e;(y=v.evaluate(t))!==v?m.push(y):(m.length>0&&(_.push(u(Nn,e,{value:m.join(d)})),m.length=0),_.push(v))}return m.length>0&&_.push(u(Nn,e,{value:m.join(d)})),0==_.length?u(Nn,e,{value:""}):1==_.length?_[0].is_string(t)?_[0]:u(Zt,_[0],{operator:"+",left:u(Nn,e,{value:""}),right:_[0]}):""==d?(b=_[0].is_string(t)||_[1].is_string(t)?_.shift():u(Nn,e,{value:""}),_.reduce((e,t)=>u(Zt,t,{operator:"+",left:e,right:t}),b).optimize(t)):((l=e.clone()).expression=l.expression.clone(),l.expression.expression=l.expression.expression.clone(),l.expression.expression.elements=_,Ee(t,e,l))}break;case"charAt":if(j.expression.is_string(t)&&(x=(E=e.args[0])?E.evaluate(t):0)!==E)return u(Yt,j,{expression:j.expression,property:re(0|x,E||j)}).optimize(t);break;case"apply":if(2==e.args.length&&e.args[1]instanceof en)return(A=e.args[1].elements.slice()).unshift(e.args[0]),u(Pt,e,{expression:u(Vt,j,{expression:j.expression,property:"call"}),args:A}).optimize(t);break;case"call":if((F=j.expression)instanceof Sn&&(F=F.fixed_value()),F instanceof at&&!F.contains_this())return(e.args.length?oe(this,[e.args[0],u(Pt,e,{expression:j.expression,args:e.args.slice(1)})]):u(Pt,e,{expression:j.expression,args:[]})).optimize(t)}if(t.option("unsafe_Function")&&he(j)&&"Function"==j.name){if(0==e.args.length)return u(ct,e,{argnames:[],body:[]}).optimize(t);if(e.args.every(e=>e instanceof Nn))try{return C=N(k="n(function("+e.args.slice(0,-1).map(e=>e.value).join(",")+"){"+e.args[e.args.length-1].value+"})"),B={ie8:t.option("ie8")},C.figure_out_scope(B),S=new fo(t.options),(C=C.transform(S)).figure_out_scope(B),Gi.reset(),C.compute_char_frequency(B),C.mangle_names(B),w(C,e=>{if(Q(e))return T=e,Ri}),k=L(),Ye.prototype._codegen.call(T,T,k),e.args=[u(Nn,e,{value:T.argnames.map(e=>e.print_to_string()).join(",")}),u(Nn,e.args[e.args.length-1],{value:k.get().replace(/^{|}$/g,"")})],e}catch(n){if(!(n instanceof Vi))throw n;t.warn("Error parsing code passed to new Function [{file}:{line},{col}]",e.args[e.args.length-1].start),t.warn(n.toString())}}if($=r&&P.body[0],(q=(z=r&&!P.is_generator&&!P.async)&&t.option("inline")&&!e.is_expr_pure(t))&&$ instanceof Dt){let n=$.value;if(!n||n.is_constant_expression()){n=n?n.clone(!0):u(Ln,e);const i=e.args.concat(n);return oe(e,i).optimize(t)}if(1===P.argnames.length&&P.argnames[0]instanceof vn&&e.args.length<2&&n instanceof Sn&&n.name===P.argnames[0].name){let n;return e.args[0]instanceof Lt&&(n=t.parent())instanceof Pt&&n.expression===e?oe(e,[u(Hn,e,{value:0}),e.args[0].optimize(t)]):(e.args[0]||u(Ln)).optimize(t)}}if(q){let r,s,a;if(H=-1,o&&!P.uses_arguments&&!P.pinned()&&!(t.parent()instanceof un)&&!(P.name&&P instanceof ct)&&(s=(e=>{var i,o,r=P.body,s=r.length;if(t.option("inline")<3)return 1==s&&n(e);for(e=null,i=0;i<s;i++)if((o=r[i])instanceof qt){if(e&&!o.definitions.every(e=>!e.value))return!1}else{if(e)return!1;o instanceof We||(e=o)}return n(e)})($))&&(j===P||D(e,2)||t.option("unused")&&1==(r=j.definition()).references.length&&!Ce(t,r)&&P.is_constant_expression(j.scope))&&!D(e,5)&&!P.contains_this()&&(()=>{var n,i,o=new Set;do{if((O=t.parent(++H)).is_block_scope()&&O.block_scope&&O.block_scope.variables.forEach(e=>{o.add(e.name)}),O instanceof Tt)O.argname&&o.add(O.argname.name);else if(O instanceof Ze)M=[];else if(O instanceof Sn&&O.fixed_value()instanceof ot)return!1}while(!(O instanceof ot));return n=!(O instanceof rt)||t.toplevel.vars,i=t.option("inline"),!(!((e,t)=>{var n,i,o,r,s=P.body.length;for(n=0;n<s;n++)if((i=P.body[n])instanceof qt){if(!t)return!1;for(o=i.definitions.length;--o>=0;){if((r=i.definitions[o].name)instanceof pt||e.has(r.name)||Ei.has(r.name)||O.var_names().has(r.name))return!1;M&&M.push(r.definition())}}return!0})(o,i>=3&&n)||!((e,t)=>{var n,i,o;for(n=0,i=P.argnames.length;n<i;n++){if((o=P.argnames[n])instanceof Qt){if(ao(o.left,1))continue;return!1}if(o instanceof pt)return!1;if(o instanceof st){if(ao(o.expression,1))continue;return!1}if(!ao(o,1)){if(!t||e.has(o.name)||Ei.has(o.name)||O.var_names().has(o.name))return!1;M&&M.push(o.definition())}}return!0})(o,i>=2&&n)||!(()=>{var t,n,i,o,r=new Set;const s=e=>{if(e instanceof ot){var t=new Set;return e.enclosed.forEach(e=>{t.add(e.name)}),e.variables.forEach(e=>{t.delete(e)}),t.forEach(e=>{r.add(e)}),!0}};for(let t=0;t<e.args.length;t++)w(e.args[t],s);if(0==r.size)return!0;for(let e=0,n=P.argnames.length;e<n;e++)if(!((t=P.argnames[e])instanceof Qt&&ao(t.left,1))&&!(t instanceof st&&ao(t.expression,1))&&!ao(t,1)&&r.has(t.name))return!1;for(let e=0,t=P.body.length;e<t;e++)if((n=P.body[e])instanceof qt)for(i=n.definitions.length;--i>=0;)if((o=n.definitions[i].name)instanceof pt||r.has(o.name))return!1;return!0})()||M&&0!=M.length&&Te(P,M))})()&&(a=ne(t))&&!Be(a,P)&&!(()=>{let e,n=0;for(;e=t.parent(n++);){if(e instanceof Qt)return!0;if(e instanceof Ve)break}return!1})()&&!(O instanceof un))return uo(P,256),a.add_child_scope(P),oe(e,(n=>{var o=[],r=[];if(((t,n)=>{var o,r,s,a,c=P.argnames.length;for(o=e.args.length;--o>=c;)n.push(e.args[o]);for(o=c;--o>=0;)r=P.argnames[o],s=e.args[o],ao(r,1)||!r.name||O.var_names().has(r.name)?s&&n.push(s):(a=u(_n,r,r),r.definition().orig.push(a),!s&&M&&(s=u(Ln,e)),i(t,n,a,s));t.reverse(),n.reverse()})(o,r),((e,t)=>{var n,o,r,s,a,c,f,l,p,h=t.length;for(n=0,o=P.body.length;n<o;n++)if((r=P.body[n])instanceof qt)for(s=0,a=r.definitions.length;s<a;s++)c=r.definitions[s],i(e,t,f=c.name,c.value),M&&P.argnames.every(e=>e.name!=f.name)&&(l=P.variables.get(f.name),p=u(Sn,f,f),l.references.push(p),t.splice(h++,0,u(Kt,c,{operator:"=",left:p,right:u(Ln,f)})))})(o,r),r.push(n),o.length){const e=O.body.indexOf(t.parent(H-1))+1;O.body.splice(e,0,u(qt,P,{definitions:o}))}return r.map(e=>e.clone(!0))})(s)).optimize(t)}return z&&t.option("side_effects")&&P.body.every(ce)?(A=e.args.concat(u(Ln,e)),oe(e,A).optimize(t)):t.option("negate_iife")&&t.parent()instanceof Le&&pe(e)?e.negate(t,!0):(I=e.evaluate(t))!==e?(I=re(I,e).optimize(t),Ee(t,I,e)):e})),Z(Rt,(e,t)=>t.option("unsafe")&&he(e.expression)&&["Object","RegExp","Function","Error","Array"].includes(e.expression.name)?u(Pt,e,e).transform(t):e),Z(Ut,(e,t)=>{var n,i,o,r;return t.option("side_effects")?(n=[],o=R(t),r=e.expressions.length-1,e.expressions.forEach((e,i)=>{i<r&&(e=e.drop_side_effect_free(t,o)),e&&(ae(n,e),o=!1)}),i=n.length-1,(()=>{for(;i>0&&De(n[i],t);)i--;i<n.length-1&&(n[i]=u(Xt,e,{operator:"void",expression:n[i]}),n.length=i+1)})(),0==i?((e=se(t.parent(),t.self(),n[0]))instanceof Ut||(e=e.optimize(t)),e):(e.expressions=n,e)):e}),Wt.DEFMETHOD("lift_sequences",(function(e){var t,n;return e.option("sequences")&&this.expression instanceof Ut?(t=this.expression.expressions.slice(),(n=this.clone()).expression=t.pop(),t.push(n),oe(this,t).optimize(e)):this})),Z(Gt,(e,t)=>e.lift_sequences(t)),Z(Xt,(e,t)=>{var n,i,o=e.expression;if("delete"==e.operator&&!(o instanceof Sn||o instanceof Lt||de(o))){if(o instanceof Ut){const n=o.expressions.slice();return n.push(u(Gn,e)),oe(e,n).optimize(t)}return oe(e,[o,u(Gn,e)]).optimize(t)}if((n=e.lift_sequences(t))!==e)return n;if(t.option("side_effects")&&"void"==e.operator)return(o=o.drop_side_effect_free(t))?(e.expression=o,e):u(Ln,e).optimize(t);if(t.in_boolean_context())switch(e.operator){case"!":if(o instanceof Xt&&"!"==o.operator)return o.expression;o instanceof Zt&&(e=Ee(t,e,o.negate(t,R(t))));break;case"typeof":return t.warn("Boolean expression always true [{file}:{line},{col}]",e.start),(o instanceof Sn?u(Gn,e):oe(e,[o,u(Gn,e)])).optimize(t)}return"-"==e.operator&&o instanceof Yn&&(o=o.transform(t)),!(o instanceof Zt)||"+"!=e.operator&&"-"!=e.operator||"*"!=o.operator&&"/"!=o.operator&&"%"!=o.operator?"-"==e.operator&&(o instanceof Hn||o instanceof Yn||o instanceof In)||(i=e.evaluate(t))===e?e:Ee(t,i=re(i,e).optimize(t),e):u(Zt,e,{operator:o.operator,left:u(Xt,o.left,{operator:e.operator,expression:o.left}),right:o.right})}),Zt.DEFMETHOD("lift_sequences",(function(e){var t,n,i,o,r;if(e.option("sequences")){if(this.left instanceof Ut)return t=this.left.expressions.slice(),(n=this.clone()).left=t.pop(),t.push(n),oe(this,t).optimize(e);if(this.right instanceof Ut&&!this.left.has_side_effects(e)){for(i="="==this.operator&&this.left instanceof Sn,o=(t=this.right.expressions).length-1,r=0;r<o&&(i||!t[r].has_side_effects(e));r++);if(r==o)return t=t.slice(),(n=this.clone()).right=t.pop(),t.push(n),oe(this,t).optimize(e);if(r>0)return(n=this.clone()).right=oe(this.right,t.slice(r)),(t=t.slice(0,r)).push(n),oe(this,t).optimize(e)}}return this})),Si=h("== === != !== * & | ^"),Z(Zt,(e,t)=>{function n(){return e.left.is_constant()||e.right.is_constant()||!e.left.has_side_effects(t)&&!e.right.has_side_effects(t)}function i(t){if(n()){t&&(e.operator=t);var i=e.left;e.left=e.right,e.right=i}}var o,r,s,a,c,f,l,p,h,d,_,m,g,D,v,y,b,E,w;if(Si.has(e.operator)&&e.right.is_constant()&&!e.left.is_constant()&&(e.left instanceof Zt&&vi[e.left.operator]>=vi[e.operator]||i()),e=e.lift_sequences(t),t.option("comparisons"))switch(e.operator){case"===":case"!==":o=!0,(e.left.is_string(t)&&e.right.is_string(t)||e.left.is_number(t)&&e.right.is_number(t)||e.left.is_boolean()&&e.right.is_boolean()||e.left.equivalent_to(e.right))&&(e.operator=e.operator.substr(0,2));case"==":case"!=":if(!o&&De(e.left,t))e.left=u(Rn,e.left);else if(t.option("typeofs")&&e.left instanceof Nn&&"undefined"==e.left.value&&e.right instanceof Xt&&"typeof"==e.right.operator)((r=e.right.expression)instanceof Sn?!r.is_declared(t):r instanceof Lt&&t.option("ie8"))||(e.right=r,e.left=u(Ln,e.left).optimize(t),2==e.operator.length&&(e.operator+="="));else if(e.left instanceof Sn&&e.right instanceof Sn&&e.left.definition()===e.right.definition()&&((w=e.left.fixed_value())instanceof en||w instanceof at||w instanceof tn||w instanceof un))return u("="==e.operator[0]?Gn:Xn,e);break;case"&&":case"||":if((s=e.left).operator==e.operator&&(s=s.right),s instanceof Zt&&s.operator==("&&"==e.operator?"!==":"===")&&e.right instanceof Zt&&s.operator==e.right.operator&&(De(s.left,t)&&e.right.left instanceof Rn||s.left instanceof Rn&&De(e.right.left,t))&&!s.right.has_side_effects(t)&&s.right.equivalent_to(e.right.right))return a=u(Zt,e,{operator:s.operator.slice(0,-1),left:u(Rn,e),right:s.right}),s!==e.left&&(a=u(Zt,e,{operator:e.operator,left:e.left.left,right:a})),a}if("+"==e.operator&&t.in_boolean_context()){if(c=e.left.evaluate(t),f=e.right.evaluate(t),c&&"string"==typeof c)return t.warn("+ in boolean context always true [{file}:{line},{col}]",e.start),oe(e,[e.right,u(Gn,e)]).optimize(t);if(f&&"string"==typeof f)return t.warn("+ in boolean context always true [{file}:{line},{col}]",e.start),oe(e,[e.left,u(Gn,e)]).optimize(t)}if(t.option("comparisons")&&e.is_boolean()&&(t.parent()instanceof Zt&&!(t.parent()instanceof Kt)||(l=u(Xt,e,{operator:"!",expression:e.negate(t,R(t))}),e=Ee(t,e,l)),t.option("unsafe_comps")))switch(e.operator){case"<":i(">");break;case"<=":i(">=")}if("+"==e.operator){if(e.right instanceof Nn&&""==e.right.getValue()&&e.left.is_string(t))return e.left;if(e.left instanceof Nn&&""==e.left.getValue()&&e.right.is_string(t))return e.right;if(e.left instanceof Zt&&"+"==e.left.operator&&e.left.left instanceof Nn&&""==e.left.left.getValue()&&e.right.is_string(t))return e.left=e.left.right,e.transform(t)}if(t.option("evaluate")){switch(e.operator){case"&&":if(!(c=!!ao(e.left,2)||!ao(e.left,4)&&e.left.evaluate(t)))return t.warn("Condition left of && always false [{file}:{line},{col}]",e.start),se(t.parent(),t.self(),e.left).optimize(t);if(!(c instanceof je))return t.warn("Condition left of && always true [{file}:{line},{col}]",e.start),oe(e,[e.left,e.right]).optimize(t);if(f=e.right.evaluate(t)){if(!(f instanceof je)&&("&&"==(p=t.parent()).operator&&p.left===t.self()||t.in_boolean_context()))return t.warn("Dropping side-effect-free && [{file}:{line},{col}]",e.start),e.left.optimize(t)}else{if(t.in_boolean_context())return t.warn("Boolean && always false [{file}:{line},{col}]",e.start),oe(e,[e.left,u(Xn,e)]).optimize(t);uo(e,4)}if("||"==e.left.operator&&!(h=e.left.right.evaluate(t)))return u(Jt,e,{condition:e.left.left,consequent:e.right,alternative:e.left.right}).optimize(t);break;case"||":if(!(c=!!ao(e.left,2)||!ao(e.left,4)&&e.left.evaluate(t)))return t.warn("Condition left of || always false [{file}:{line},{col}]",e.start),oe(e,[e.left,e.right]).optimize(t);if(!(c instanceof je))return t.warn("Condition left of || always true [{file}:{line},{col}]",e.start),se(t.parent(),t.self(),e.left).optimize(t);if(f=e.right.evaluate(t)){if(!(f instanceof je)){if(t.in_boolean_context())return t.warn("Boolean || always true [{file}:{line},{col}]",e.start),oe(e,[e.left,u(Gn,e)]).optimize(t);uo(e,2)}}else if("||"==(p=t.parent()).operator&&p.left===t.self()||t.in_boolean_context())return t.warn("Dropping side-effect-free || [{file}:{line},{col}]",e.start),e.left.optimize(t);if("&&"==e.left.operator&&(h=e.left.right.evaluate(t))&&!(h instanceof je))return u(Jt,e,{condition:e.left.left,consequent:e.left.right,alternative:e.right}).optimize(t);break;case"??":if($e(e.left))return e.right;if(!((c=e.left.evaluate(t))instanceof je))return null==c?e.right:e.left;if(t.in_boolean_context()){const n=e.right.evaluate(t);if(!(n instanceof je||n))return e.left}}switch(d=!0,e.operator){case"+":if(e.left instanceof Mn&&e.right instanceof Zt&&"+"==e.right.operator&&e.right.is_string(t)&&(m=(_=u(Zt,e,{operator:"+",left:e.left,right:e.right.left})).optimize(t),_!==m&&(e=u(Zt,e,{operator:"+",left:m,right:e.right.right}))),e.right instanceof Mn&&e.left instanceof Zt&&"+"==e.left.operator&&e.left.is_string(t)&&(g=(_=u(Zt,e,{operator:"+",left:e.left.right,right:e.right})).optimize(t),_!==g&&(e=u(Zt,e,{operator:"+",left:e.left.left,right:g}))),e.left instanceof Zt&&"+"==e.left.operator&&e.left.is_string(t)&&e.right instanceof Zt&&"+"==e.right.operator&&e.right.is_string(t)&&(D=(_=u(Zt,e,{operator:"+",left:e.left.right,right:e.right.left})).optimize(t),_!==D&&(e=u(Zt,e,{operator:"+",left:u(Zt,e.left,{operator:"+",left:e.left.left,right:D}),right:e.right.right}))),e.right instanceof Xt&&"-"==e.right.operator&&e.left.is_number(t)){e=u(Zt,e,{operator:"-",left:e.left,right:e.right.expression});break}if(e.left instanceof Xt&&"-"==e.left.operator&&n()&&e.right.is_number(t)){e=u(Zt,e,{operator:"-",left:e.right,right:e.left.expression});break}if(e.left instanceof dt&&(m=e.left,(g=e.right.evaluate(t))!=e.right))return m.segments[m.segments.length-1].value+=g.toString(),m;if(e.right instanceof dt&&(g=e.right,(m=e.left.evaluate(t))!=e.left))return g.segments[0].value=m.toString()+g.segments[0].value,g;if(e.left instanceof dt&&e.right instanceof dt){for(v=(m=e.left).segments,g=e.right,v[v.length-1].value+=g.segments[0].value,y=1;y<g.segments.length;y++)v.push(g.segments[y]);return m}case"*":d=t.option("unsafe_math");case"&":case"|":case"^":e.left.is_number(t)&&e.right.is_number(t)&&n()&&!(e.left instanceof Zt&&e.left.operator!=e.operator&&vi[e.left.operator]>=vi[e.operator])&&(b=u(Zt,e,{operator:e.operator,left:e.right,right:e.left}),e=e.right instanceof Mn&&!(e.left instanceof Mn)?Ee(t,b,e):Ee(t,e,b)),d&&e.is_number(t)&&(e.right instanceof Zt&&e.right.operator==e.operator&&(e=u(Zt,e,{operator:e.operator,left:u(Zt,e.left,{operator:e.operator,left:e.left,right:e.right.left,start:e.left.start,end:e.right.left.end}),right:e.right.right})),e.right instanceof Mn&&e.left instanceof Zt&&e.left.operator==e.operator&&(e.left.left instanceof Mn?e=u(Zt,e,{operator:e.operator,left:u(Zt,e.left,{operator:e.operator,left:e.left.left,right:e.right,start:e.left.left.start,end:e.right.end}),right:e.left.right}):e.left.right instanceof Mn&&(e=u(Zt,e,{operator:e.operator,left:u(Zt,e.left,{operator:e.operator,left:e.left.right,right:e.right,start:e.left.right.start,end:e.right.end}),right:e.left.left}))),e.left instanceof Zt&&e.left.operator==e.operator&&e.left.right instanceof Mn&&e.right instanceof Zt&&e.right.operator==e.operator&&e.right.left instanceof Mn&&(e=u(Zt,e,{operator:e.operator,left:u(Zt,e.left,{operator:e.operator,left:u(Zt,e.left.left,{operator:e.operator,left:e.left.right,right:e.right.left,start:e.left.right.start,end:e.right.left.end}),right:e.left.left}),right:e.right.right})))}}return e.right instanceof Zt&&e.right.operator==e.operator&&(wi.has(e.operator)||"+"==e.operator&&(e.right.left.is_string(t)||e.left.is_string(t)&&e.right.right.is_string(t)))?(e.left=u(Zt,e.left,{operator:e.operator,left:e.left,right:e.right.left}),e.right=e.right.right,e.transform(t)):(E=e.evaluate(t))!==e?(E=re(E,e).optimize(t),Ee(t,E,e)):e}),Z(Tn,e=>e),Z(Sn,(e,t)=>{var n,i,o,r,s,a,c,f,l;if(!t.option("ie8")&&he(e)&&(!e.scope.uses_with||!t.find_parent(it)))switch(e.name){case"undefined":return u(Ln,e).optimize(t);case"NaN":return u(Un,e).optimize(t);case"Infinity":return u(Yn,e).optimize(t)}if(n=t.parent(),t.option("reduce_vars")&&ve(e,n)!==e){const p=e.definition();if(t.top_retain&&p.global&&t.top_retain(p))return p.fixed=!1,p.should_replace=!1,p.single_use=!1,e;if(i=e.fixed_value(),(o=p.single_use&&!(n instanceof Pt&&n.is_expr_pure(t)||D(n,4)))&&(i instanceof at||i instanceof un))if(ke(i,t))o=!1;else if(p.scope!==e.scope&&(1==p.escaped||ao(i,16)||(e=>{for(var t,n=0;t=e.parent(n++);){if(t instanceof Pe)return!1;if(t instanceof en||t instanceof on||t instanceof tn)return!0}return!1})(t)))o=!1;else if(Ce(t,p))o=!1;else if((p.scope!==e.scope||p.orig[0]instanceof vn)&&"f"==(o=i.is_constant_expression(e.scope))){r=e.scope;do{(r instanceof lt||Q(r))&&uo(r,16)}while(r=r.parent_scope)}if(o&&i instanceof at){const r=ne(t);o=p.scope===e.scope&&!Be(r,i)||n instanceof Pt&&n.expression===e&&!Be(r,i)}if(o&&i instanceof un&&(o=!(i.extends&&(i.extends.may_throw(t)||i.extends.has_side_effects(t))||i.properties.some(e=>e.may_throw(t)||e.has_side_effects(t)))),o&&i){if(i instanceof fn&&(uo(i,256),i=u(ln,i,i)),i instanceof lt&&(uo(i,256),i=u(ct,i,i)),p.recursive_refs>0&&i.name instanceof yn){const e=i.name.definition();let t=i.variables.get(i.name.name),n=t&&t.orig[0];n instanceof wn||(n=u(wn,i.name,i.name),n.scope=i,i.name=n,t=i.def_function(n)),w(i,n=>{n instanceof Sn&&n.definition()===e&&(n.thedef=t,t.references.push(n))})}return(i instanceof at||i instanceof un)&&ne(t).add_child_scope(i),i.optimize(t)}if(i&&void 0===p.should_replace){let e;i instanceof qn?p.orig[0]instanceof vn||!p.references.every(e=>p.scope===e.scope)||(e=i):(s=i.evaluate(t))===i||!t.option("unsafe_regexp")&&s instanceof RegExp||(e=re(s,i)),e?(a=e.optimize(t).size(),w(i,e=>{if(e instanceof Sn)return Ri})?c=()=>{var n=e.optimize(t);return n===e?n.clone(!0):n}:(a=Math.min(a,i.size()),c=()=>{var n=ye(e.optimize(t),i);return n===e||n===i?n.clone(!0):n}),f=p.name.length,l=0,t.option("unused")&&!t.exposed(p)&&(l=(f+2+a)/(p.references.length-p.assignments)),p.should_replace=a<=f+l&&c):p.should_replace=!1}if(p.should_replace)return p.should_replace()}return e}),Z(Ln,(e,t)=>{var n,i,o;return t.option("unsafe_undefined")&&(n=ie(t,"undefined"))?(i=u(Sn,e,{name:"undefined",scope:n.scope,thedef:n}),uo(i,8),i):(o=ve(t.self(),t.parent()))&&Se(o,e)?e:u(Xt,e,{operator:"void",expression:u(Hn,e,{value:0})})}),Z(Yn,(e,t)=>{var n=ve(t.self(),t.parent());return n&&Se(n,e)?e:!t.option("keep_infinity")||n&&!Se(n,e)||ie(t,"Infinity")?u(Zt,e,{operator:"/",left:u(Hn,e,{value:1}),right:u(Hn,e,{value:0})}):e}),Z(Un,(e,t)=>{var n=ve(t.self(),t.parent());return n&&!Se(n,e)||ie(t,"NaN")?u(Zt,e,{operator:"/",left:u(Hn,e,{value:0}),right:u(Hn,e,{value:0})}):e});const ho=h("+ - / * % >> << >>> | ^ &"),_o=h("* | ^ &");Z(Kt,(e,t)=>{function n(n,i){var o,r,s,a=e.right;for(e.right=u(Rn,a),o=i.may_throw(t),e.right=a,r=e.left.definition().scope;(s=t.parent(n++))!==r;)if(s instanceof St){if(s.bfinally)return!0;if(o&&s.bcatch)return!0}}var i,o,r,s;if(t.option("dead_code")&&e.left instanceof Sn&&(i=e.left.definition()).scope===t.find_parent(at)){o=0,s=e;do{if(r=s,(s=t.parent(o++))instanceof gt){if(n(o,s))break;if(Te(i.scope,[i]))break;return"="==e.operator?e.right:(i.fixed=!1,u(Zt,e,{operator:e.operator.slice(0,-1),left:e.left,right:e.right}).optimize(t))}}while(s instanceof Zt&&s.right===r||s instanceof Ut&&s.tail_node()===r)}return"="==(e=e.lift_sequences(t)).operator&&e.left instanceof Sn&&e.right instanceof Zt&&(e.right.left instanceof Sn&&e.right.left.name==e.left.name&&ho.has(e.right.operator)?(e.operator=e.right.operator+"=",e.right=e.right.right):e.right.right instanceof Sn&&e.right.right.name==e.left.name&&_o.has(e.right.operator)&&!e.right.left.has_side_effects(t)&&(e.operator=e.right.operator+"=",e.right=e.right.left)),e}),Z(Qt,(e,t)=>{if(!t.option("evaluate"))return e;var n=e.right.evaluate(t);return void 0===n?e=e.left:n!==e.right&&(n=re(n,e.right),e.right=ye(n,e.right)),e}),Z(Jt,(e,t)=>{function n(e){return e.is_boolean()?e:u(Xt,e,{operator:"!",expression:e.negate(t)})}function i(e){return e instanceof Gn||d&&e instanceof Mn&&e.getValue()||e instanceof Xt&&"!"==e.operator&&e.expression instanceof Mn&&!e.expression.getValue()}function o(e){return e instanceof Xn||d&&e instanceof Mn&&!e.getValue()||e instanceof Xt&&"!"==e.operator&&e.expression instanceof Mn&&e.expression.getValue()}var r,s,a,c,f,l,p,h,d;return t.option("conditionals")?e.condition instanceof Ut?(r=e.condition.expressions.slice(),e.condition=r.pop(),r.push(e),oe(e,r)):(s=e.condition.evaluate(t))!==e.condition?s?(t.warn("Condition always true [{file}:{line},{col}]",e.start),se(t.parent(),t.self(),e.consequent)):(t.warn("Condition always false [{file}:{line},{col}]",e.start),se(t.parent(),t.self(),e.alternative)):(a=s.negate(t,R(t)),Ee(t,s,a)===a&&(e=u(Jt,e,{condition:a,consequent:e.alternative,alternative:e.consequent})),c=e.condition,f=e.consequent,l=e.alternative,c instanceof Sn&&f instanceof Sn&&c.definition()===f.definition()?u(Zt,e,{operator:"||",left:c,right:l}):f instanceof Kt&&l instanceof Kt&&f.operator==l.operator&&f.left.equivalent_to(l.left)&&(!e.condition.has_side_effects(t)||"="==f.operator&&!f.left.has_side_effects(t))?u(Kt,e,{operator:f.operator,left:f.left,right:u(Jt,e,{condition:e.condition,consequent:f.right,alternative:l.right})}):f instanceof Pt&&l.TYPE===f.TYPE&&f.args.length>0&&f.args.length==l.args.length&&f.expression.equivalent_to(l.expression)&&!e.condition.has_side_effects(t)&&!f.expression.has_side_effects(t)&&"number"==typeof(p=(()=>{var e,t,n,i=f.args,o=l.args;for(e=0,t=i.length;e<t;e++){if(i[e]instanceof st)return;if(!i[e].equivalent_to(o[e])){if(o[e]instanceof st)return;for(n=e+1;n<t;n++){if(i[n]instanceof st)return;if(!i[n].equivalent_to(o[n]))return}return e}}})())?((h=f.clone()).args[p]=u(Jt,e,{condition:e.condition,consequent:f.args[p],alternative:l.args[p]}),h):l instanceof Jt&&f.equivalent_to(l.consequent)?u(Jt,e,{condition:u(Zt,e,{operator:"||",left:c,right:l.condition}),consequent:f,alternative:l.alternative}).optimize(t):t.option("ecma")>=2020&&((e,t,n)=>{if(t.may_throw(n))return!1;let i;if(e instanceof Zt&&"=="===e.operator&&((i=$e(e.left)&&e.left)||(i=$e(e.right)&&e.right))&&(i===e.left?e.right:e.left).equivalent_to(t))return!0;if(e instanceof Zt&&"||"===e.operator){let n,i;const o=e=>{if(!(e instanceof Zt)||"==="!==e.operator&&"=="!==e.operator)return!1;let o,r=0;return e.left instanceof Rn&&(r++,n=e,o=e.right),e.right instanceof Rn&&(r++,n=e,o=e.left),De(e.left)&&(r++,i=e,o=e.right),De(e.right)&&(r++,i=e,o=e.left),1===r&&!!o.equivalent_to(t)};if(!o(e.left))return!1;if(!o(e.right))return!1;if(n&&i&&n!==i)return!0}return!1})(c,l,t)?u(Zt,e,{operator:"??",left:l,right:f}).optimize(t):l instanceof Ut&&f.equivalent_to(l.expressions[l.expressions.length-1])?oe(e,[u(Zt,e,{operator:"||",left:c,right:oe(e,l.expressions.slice(0,-1))}),f]).optimize(t):l instanceof Zt&&"&&"==l.operator&&f.equivalent_to(l.right)?u(Zt,e,{operator:"&&",left:u(Zt,e,{operator:"||",
	left:c,right:l.left}),right:f}).optimize(t):f instanceof Jt&&f.alternative.equivalent_to(l)?u(Jt,e,{condition:u(Zt,e,{left:e.condition,operator:"&&",right:f.condition}),consequent:f.consequent,alternative:l}):f.equivalent_to(l)?oe(e,[e.condition,f]).optimize(t):f instanceof Zt&&"||"==f.operator&&f.right.equivalent_to(l)?u(Zt,e,{operator:"||",left:u(Zt,e,{operator:"&&",left:e.condition,right:f.left}),right:l}).optimize(t):(d=t.in_boolean_context(),i(e.consequent)?o(e.alternative)?n(e.condition):u(Zt,e,{operator:"||",left:n(e.condition),right:e.alternative}):o(e.consequent)?i(e.alternative)?n(e.condition.negate(t)):u(Zt,e,{operator:"&&",left:n(e.condition.negate(t)),right:e.alternative}):i(e.alternative)?u(Zt,e,{operator:"||",left:n(e.condition.negate(t)),right:e.consequent}):o(e.alternative)?u(Zt,e,{operator:"&&",left:n(e.condition),right:e.consequent}):e)):e}),Z(Wn,(e,t)=>{if(t.in_boolean_context())return u(Hn,e,{value:+e.value});var n=t.parent();return t.option("booleans_as_integers")?(n instanceof Zt&&("==="==n.operator||"!=="==n.operator)&&(n.operator=n.operator.replace(/=$/,"")),u(Hn,e,{value:+e.value})):t.option("booleans")?n instanceof Zt&&("=="==n.operator||"!="==n.operator)?(t.warn("Non-strict equality against boolean: {operator} {value} [{file}:{line},{col}]",{operator:n.operator,value:e.value,file:n.start.file,line:n.start.line,col:n.start.col}),u(Hn,e,{value:+e.value})):u(Xt,e,{operator:"!",expression:u(Hn,e,{value:1-e.value})}):e}),Z(Yt,(e,t)=>{var n,i,o,r,s,a,c,f,l,p,h,d,_,m,g,D,v,y,b,E=e.expression,w=e.property;if(t.option("properties")&&(n=w.evaluate(t))!==w&&("string"==typeof n&&("undefined"==n?n=void 0:(i=parseFloat(n)).toString()==n&&(n=i)),w=e.property=ye(w,re(n,w).transform(t)),T(o=""+n)&&o.length<=w.size()+1))return u(Vt,e,{expression:E,property:o,quote:w.quote}).optimize(t);e:if(t.option("arguments")&&E instanceof Sn&&"arguments"==E.name&&1==E.definition().orig.length&&(r=E.scope)instanceof at&&r.uses_arguments&&!(r instanceof ft)&&w instanceof Hn){for(s=w.getValue(),a=new Set,c=r.argnames,f=0;f<c.length;f++){if(!(c[f]instanceof vn))break e;if(l=c[f].name,a.has(l))break e;a.add(l)}if((p=r.argnames[s])&&t.has_directive("use strict"))h=p.definition(),(!t.option("reduce_vars")||h.assignments||h.orig.length>1)&&(p=null);else if(!p&&!t.option("keep_fargs")&&s<r.argnames.length+5)for(;s>=r.argnames.length;)p=u(vn,r,{name:r.make_var_name("argument_"+r.argnames.length),scope:r}),r.argnames.push(p),r.enclosed.push(r.def_variable(p));if(p)return(d=u(Sn,e,p)).reference({}),co(p,1),d}if(ve(e,t.parent()))return e;if(n!==w&&(_=e.flatten_object(o,t))&&(E=e.expression=_.expression,w=e.property=_.property),t.option("properties")&&t.option("side_effects")&&w instanceof Hn&&E instanceof en){s=w.getValue();e:if(ze(g=(m=E.elements)[s],t)){for(D=!0,v=[],y=m.length;--y>s;)(i=m[y].drop_side_effect_free(t))&&(v.unshift(i),D&&i.has_side_effects(t)&&(D=!1));if(g instanceof st)break e;for(g=g instanceof Vn?u(Ln,g):g,D||v.unshift(g);--y>=0;){if((i=m[y])instanceof st)break e;(i=i.drop_side_effect_free(t))?v.unshift(i):s--}return D?(v.push(g),oe(e,v).optimize(t)):u(Yt,e,{expression:u(en,E,{elements:v}),property:u(Hn,w,{value:s})})}}return(b=e.evaluate(t))!==e?Ee(t,b=re(b,e).optimize(t),e):e}),at.DEFMETHOD("contains_this",(function(){return w(this,e=>e instanceof qn?Ri:e!==this&&e instanceof ot&&!(e instanceof ft)||void 0)})),Lt.DEFMETHOD("flatten_object",(function(e,t){var n,i,o,r,s;if(t.option("properties")&&(n=t.option("unsafe_arrows")&&t.option("ecma")>=2015,(i=this.expression)instanceof tn))for(r=(o=i.properties).length;--r>=0;)if(""+((s=o[r])instanceof an?s.key.name:s.key)==e){if(!o.every(e=>e instanceof on||n&&e instanceof an&&!e.is_generator))break;if(!ze(s.value,t))break;return u(Yt,this,{expression:u(en,i,{elements:o.map(e=>{var t,n=e.value;return n instanceof ut&&(n=u(ct,n,n)),(t=e.key)instanceof je&&!(t instanceof bn)?oe(e,[t,n]):n})}),property:u(Hn,this,{value:r})})}})),Z(Vt,(e,t)=>{"arguments"!=e.property&&"caller"!=e.property||t.warn("Function.prototype.{prop} not supported [{file}:{line},{col}]",{prop:e.property,file:e.start.file,line:e.start.line,col:e.start.col});const n=t.parent();if(ve(e,n))return e;if(t.option("unsafe_proto")&&e.expression instanceof Vt&&"prototype"==e.expression.property){var i=e.expression.expression;if(he(i))switch(i.name){case"Array":e.expression=u(en,e.expression,{elements:[]});break;case"Function":e.expression=u(ct,e.expression,{argnames:[],body:[]});break;case"Number":e.expression=u(Hn,e.expression,{value:0});break;case"Object":e.expression=u(tn,e.expression,{properties:[]});break;case"RegExp":e.expression=u(jn,e.expression,{value:{source:"t",flags:""}});break;case"String":e.expression=u(Nn,e.expression,{value:""})}}if(!(n instanceof Pt&&D(n,4))){const n=e.flatten_object(e.property,t);if(n)return n.optimize(t)}let o=e.evaluate(t);return o!==e?(o=re(o,e).optimize(t),Ee(t,o,e)):e}),Z(en,(e,t)=>{var n=qe(e,t);return n!==e?n:Oe(e,0,e.elements)}),Z(tn,(e,t)=>{var n,i,o,r,s=qe(e,t);if(s!==e)return s;for(n=e.properties,i=0;i<n.length;i++)(o=n[i])instanceof st&&((r=o.expression)instanceof tn?(n.splice.apply(n,[i,1].concat(o.expression.properties)),i--):r instanceof Mn&&!(r instanceof Nn)&&n.splice(i,1));return e}),Z(jn,qe),Z(Dt,(e,t)=>(e.value&&De(e.value,t)&&(e.value=null),e)),Z(ft,Ae),Z(ct,(e,t)=>(e=Ae(e,t),!(t.option("unsafe_arrows")&&t.option("ecma")>=2015)||e.name||e.is_generator||e.uses_arguments||e.pinned()||w(e,e=>{if(e instanceof qn)return Ri})?e:u(ft,e,e).optimize(t))),Z(un,e=>e),Z(xt,(e,t)=>(e.expression&&!e.is_star&&De(e.expression,t)&&(e.expression=null),e)),Z(dt,(e,t)=>{var n,i,o,r,s,a;if(!t.option("evaluate")||t.parent()instanceof ht)return e;for(n=[],i=0;i<e.segments.length;i++){if((o=e.segments[i])instanceof je){if((r=o.evaluate(t))!==o&&(r+"").length<=o.size()+3){n[n.length-1].value=n[n.length-1].value+r+e.segments[++i].value;continue}if(o instanceof dt){for(s=o.segments,n[n.length-1].value+=s[0].value,a=1;a<s.length;a++)o=s[a],n.push(o);continue}}n.push(o)}if(e.segments=n,1==n.length)return u(Nn,e,n[0]);if(3===n.length&&n[1]instanceof je){if(""===n[2].value)return u(Zt,e,{operator:"+",left:u(Nn,e,{value:n[0].value}),right:n[1]});if(""===n[0].value)return u(Zt,e,{operator:"+",left:n[1],right:u(Nn,e,{value:n[2].value})})}return e}),Z(ht,e=>e),Z(nn,Me),Z(an,(e,t)=>{if(Me(e,t),t.option("arrows")&&t.parent()instanceof tn&&!e.is_generator&&!e.value.uses_arguments&&!e.value.pinned()&&1==e.value.body.length&&e.value.body[0]instanceof Dt&&e.value.body[0].value&&!e.value.contains_this()){var n=u(ft,e.value,e.value);return n.async=e.async,n.is_generator=e.is_generator,u(on,e,{key:e.key instanceof bn?e.key.name:e.key,value:n,quote:e.quote})}return e}),Z(on,(e,t)=>{var n,i,o;return Me(e,t),!((n=t.option("unsafe_methods"))&&t.option("ecma")>=2015)||n instanceof RegExp&&!n.test(e.key+"")||(i=e.key,!((o=e.value)instanceof ft&&Array.isArray(o.body)&&!o.contains_this()||o instanceof ct)||o.name)?e:u(an,e,{async:o.async,is_generator:o.is_generator,key:i instanceof je?i:u(bn,e,{name:i}),value:u(ut,o,o),quote:e.quote})}),Z(pt,(e,t)=>{function n(e,t){return!!t.references.length||!!t.global&&(!e.toplevel.vars||!!e.top_retain&&e.top_retain(t))}var i,o,r;if(1==t.option("pure_getters")&&t.option("unused")&&!e.is_array&&Array.isArray(e.names)&&!(e=>{var t,n,i,o,r=[/^VarDef$/,/^(Const|Let|Var)$/,/^Export$/];for(t=0,n=0,i=r.length;t<i;n++){if(!(o=e.parent(n)))return!1;if(0!==t||"Destructuring"!=o.TYPE){if(!r[t].test(o.TYPE))return!1;t++}}return!0})(t)){for(i=[],o=0;o<e.names.length;o++)(r=e.names[o])instanceof on&&"string"==typeof r.key&&r.value instanceof dn&&!n(t,r.value.definition())||i.push(r);i.length!=e.names.length&&(e.names=i)}return e});
	return {minify:W,parse:N,TreeTransformer:Li,AST_SymbolRef:Sn,AST_Dot:Vt,AST_Sub:Yt,AST_String:Nn};
}
