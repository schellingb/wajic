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

// Function that starts the audio output
WAJIC(void, JSStartAudio, (const char* exported_renderfunc),
{
	// Try to initialize WebAudio context with stereo channels and 44100 hz frequency
	var audioCtx;
	try { audioCtx = new AudioContext(); } catch (e) { }
	if (!audioCtx) { WA.print('Warning: WebAudio not supported\n'); return; }
	var encTime = 0, audioSamples = 882, audioSecs = audioSamples/44100;
	var ptrTempBuf = 0, f32TempBuf = 0, audioBufs = [{'length':0}], audioBufIdx = 0;
	var renderFunc = ASM[MStrGet(exported_renderfunc)];

	// Call a function every few milliseconds to fill the audio buffer if required
	var handle = setInterval(function()
	{
		// if program was aborted, end audio output
		if (STOP) { audioCtx.close(); clearInterval(handle); return; }

		// Try to start the audio playback if suspended/blocked by the browser
		if (audioCtx.state == 'suspended') { audioCtx.resume(); if (audioCtx.state == 'suspended') return; }

		// Check if enough time has passed for the next audio block to be generated (or return if not)
		var ctxTime = audioCtx.currentTime;
		if (ctxTime == 0) encTime = 0;
		if (encTime - ctxTime > audioSecs) return;

		// Check if the audio buffer size was increased (due to starvation) or if this is the first call
		if (audioBufs[0].length != audioSamples)
		{
			// Allocate memory on the wasm heap where it will place the float encoded stereo audio data
			ASM.free(ptrTempBuf);
			f32TempBuf = ((ptrTempBuf = ASM.malloc(audioSamples<<3))>>2); //2 channels, 4 byte per float sized sample

			// Prepare 4 matching audio buffers that get cycled through
			for (var i = 0; i != 4; i++) audioBufs[i] = audioCtx.createBuffer(2, audioSamples, 44100);
		}

		// Call the wasm module function WAFNAudio to generate audio data
		if (renderFunc(ptrTempBuf, audioSamples))
		{
			// Copy the generated data for both channels into the next cycled audio buffer
			var soundBuffer = audioBufs[audioBufIdx = ((audioBufIdx + 1) % 4)];
			soundBuffer.getChannelData(0).set(MF32.subarray(f32TempBuf, f32TempBuf + audioSamples));
			soundBuffer.getChannelData(1).set(MF32.subarray(f32TempBuf + audioSamples, f32TempBuf + (audioSamples<<1)));

			// Send the buffer off to be played back
			var source = audioCtx.createBufferSource();
			source.connect(audioCtx.destination);
			source.buffer = soundBuffer;
			source[source.start ? 'start' : 'noteOn'](0.005+encTime);
		}

		// Check if this call is too late (and audio data generation is behind audio playback)
		if (ctxTime > encTime && ctxTime > .5)
		{
			// Depending on if the site/tab is focused extend the audio buffer length (up to a maximum of .25 second duration)
			if (ctxTime - encTime < audioSecs * 10 && audioSamples < 11025 && document.hasFocus())
			{
				//only increase buffer when at least some time has passed (not directly after loading) and it's not a giant hickup
				audioSecs = (audioSamples += 441)/44100;
				WA.print('Warning: Audio callback had starved sending audio by ' + (ctxTime - encTime) + ' seconds. (extending samples to: ' + audioSamples + ')\n');
			}
			// Reset the encode time cursor (if the site/tab is not focused intentionally delay the playback to be more relaxed)
			encTime = ctxTime + (document.hasFocus() ? 0 : 1.5);
		}

		// Advance the encode time cursor by the amount played back
		encTime += audioSecs;
	}, 10);
	WA.print('Playing 220 HZ sine wave\n');
	WA.print('This document might need to be clicked to actually start audio output\n');
})

// This function is called at startup
WA_EXPORT(WajicMain) void WajicMain()
{
	JSStartAudio("RenderAudio");
}

// This function is called by loader.js to feed audio
WA_EXPORT(RenderAudio) bool RenderAudio(float* sample_buffer, unsigned int samples)
{
	float *pLeft = sample_buffer, *pRight = sample_buffer + samples;
	for(unsigned int i = 0; i < samples; i++)
	{
		// Render 220 HZ sine wave at 25% volume into both channels
		static size_t waveCount;
		float wave = (((waveCount++) % 44100) / 44100.0f);
		pLeft[i] = pRight[i] = sinf(2.0f * 3.14159f * 220.0f * wave) * 0.25f;
	}
	return true;
}
