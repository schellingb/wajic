/*
MIT License

Copyright (c) 2017 Andre Weissflog (https://github.com/floooh/sokol-samples)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

//------------------------------------------------------------------------------
//  sokol_imgui.cpp (based on imgui-emsc.cpp)
//  Demonstrates basic integration with Dear Imgui (without custom
//  texture or custom font support).
//  Since WebAssembly is using clang exclusively, we can use designated
//  initializers even though this is C++.
//------------------------------------------------------------------------------
#include "imgui.h"
#include <wajic_gl.h>
#define SOKOL_IMPL
#define SOKOL_GLES2
#include "sokol_gfx.h"
#include "sokol_time.h"

#include <wajic.h>
static const char* _wa_canvas_name = 0;

enum {
    WA_NONE = 0,
    WA_ANTIALIAS = (1<<1),
    WA_FILL_WINDOW = (1<<2),
};

static int _wa_width = 0;
static int _wa_height = 0;

WAJIC(void, JSSetupCanvas, (int* width, int* height, bool fill_window), {
    var canvas = WA.canvas;
    if (fill_window)
    {
        canvas.style.position = "fixed";
        canvas.style.left = canvas.style.top = canvas.style.margin = 0;
        canvas.style.width = canvas.style.maxWidth = "";
        canvas.style.zIndex = 1;
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        window.addEventListener('resize', function(e)
        {
            if (window.innerWidth<32 || window.innerHeight<32) return;
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            ASM.WAFNResize(canvas.width, canvas.height);
        }, true);
    }
    else
    {
        canvas.width = 960;
        canvas.height = 540;
    }

    var getDateNow = () => Date.now(), startTime = getDateNow();
    var wafnDraw = ASM.WAFNDraw;
    var drawFunc = function() { if (STOP) return; window.requestAnimationFrame(drawFunc); wafnDraw(getDateNow() - startTime); };
    window.requestAnimationFrame(drawFunc);

    MU32[width>>2] = canvas.width;
    MU32[height>>2] = canvas.height;
})

void wa_init(const char* canvas_name, int flags) {
    _wa_canvas_name = canvas_name;

    JSSetupCanvas(&_wa_width, &_wa_height, (flags & WA_FILL_WINDOW));
    glSetupCanvasContext((flags & WA_ANTIALIAS), 0, 0, 0);
}

typedef void (*wa_callback_func)(void);
static wa_callback_func _wa_drawfunc;

WA_EXPORT(WAFNDraw) void WAFNDraw(int t) {
    if (_wa_drawfunc)
        _wa_drawfunc();
}

extern void wa_set_main_loop(wa_callback_func func, int fps, int simulate_infinite_loop) {
    _wa_drawfunc = func;
}

WA_EXPORT(WAFNResize) void WAFNResize(int w, int h) {
    _wa_width = w;
    _wa_height = h;
}

int wa_width() {
    return (int) _wa_width;
}

int wa_height() {
    return (int) _wa_height;
}

/* these are fairly recent warnings in clang */
#pragma clang diagnostic ignored "-Wc99-designator"
#pragma clang diagnostic ignored "-Wreorder-init-list"

static const int MaxVertices = (1<<16);
static const int MaxIndices = MaxVertices * 3;

static uint64_t last_time = 0;
static bool show_test_window = true;
static bool show_another_window = false;

static sg_pass_action pass_action;
static sg_pipeline pip;
static sg_bindings bind;
static bool btn_down[3];
static bool btn_up[3];

typedef struct {
    ImVec2 disp_size;
} vs_params_t;

static void draw();
static void draw_imgui(ImDrawData*);

WA_EXPORT(WAFNKey) void WAFNKey(bool is_down, int key_code) {
    if (key_code < 512)
        ImGui::GetIO().KeysDown[key_code] = is_down;
}

WA_EXPORT(WAFNText) void WAFNText(unsigned int code) {
    ImGui::GetIO().AddInputCharacter((ImWchar)code);
}

WA_EXPORT(WAFNMouseButton) void WAFNMouseButton(int button, bool is_down) {
    switch (button) {
        case 0: (is_down ? btn_down : btn_up)[0] = true; break;
        case 2: (is_down ? btn_down : btn_up)[1] = true; break;
    }
}

WA_EXPORT(WAFNFocus) void WAFNFocus(bool focused) {
    auto& io = ImGui::GetIO();
    for (int i = 0; i < 3; i++) {
        btn_down[i] = btn_up[i] = false;
        io.MouseDown[i] = false;
    }
}

WA_EXPORT(WAFNMouseMove) void WAFNMouseMove(int x, int y) {
    ImGui::GetIO().MousePos.x = (float)x;
    ImGui::GetIO().MousePos.y = (float)y;
}

WA_EXPORT(WAFNMouseWheel) void WAFNMouseWheel(float deltax, float deltay) {
    ImGui::GetIO().MouseWheelH = -0.1f * deltax;
    ImGui::GetIO().MouseWheel  = -0.1f * deltay;
}

WAJIC(void, WASetupInputEvents, (), {
    var canvas = WA.canvas;
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

int main() {
    /* setup WebGL context */
    wa_init("#canvas", WA_NONE);

    /* setup sokol_gfx and sokol_time */
    stm_setup();
    sg_desc desc = { };
    sg_setup(&desc);
    assert(sg_isvalid());

    // setup the ImGui environment
    ImGui::CreateContext();
    ImGui::StyleColorsDark();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.Fonts->AddFontDefault();
    // web has no clearly defined key code constants
    io.KeyMap[ImGuiKey_Tab] = 9;
    io.KeyMap[ImGuiKey_LeftArrow] = 37;
    io.KeyMap[ImGuiKey_RightArrow] = 39;
    io.KeyMap[ImGuiKey_UpArrow] = 38;
    io.KeyMap[ImGuiKey_DownArrow] = 40;
    io.KeyMap[ImGuiKey_Home] = 36;
    io.KeyMap[ImGuiKey_End] = 35;
    io.KeyMap[ImGuiKey_Delete] = 46;
    io.KeyMap[ImGuiKey_Backspace] = 8;
    io.KeyMap[ImGuiKey_Enter] = 13;
    io.KeyMap[ImGuiKey_Escape] = 27;
    io.KeyMap[ImGuiKey_A] = 65;
    io.KeyMap[ImGuiKey_C] = 67;
    io.KeyMap[ImGuiKey_V] = 86;
    io.KeyMap[ImGuiKey_X] = 88;
    io.KeyMap[ImGuiKey_Y] = 89;
    io.KeyMap[ImGuiKey_Z] = 90;

    WASetupInputEvents();

    // dynamic vertex- and index-buffers for imgui-generated geometry
    sg_buffer_desc vbuf_desc = {
        .usage = SG_USAGE_STREAM,
        .size = MaxVertices * sizeof(ImDrawVert)
    };
    sg_buffer_desc ibuf_desc = {
        .type = SG_BUFFERTYPE_INDEXBUFFER,
        .usage = SG_USAGE_STREAM,
        .size = MaxIndices * sizeof(ImDrawIdx)
    };
    bind.vertex_buffers[0] = sg_make_buffer(&vbuf_desc);
    bind.index_buffer = sg_make_buffer(&ibuf_desc);

    // font texture for imgui's default font
    unsigned char* font_pixels;
    int font_width, font_height;
    io.Fonts->GetTexDataAsRGBA32(&font_pixels, &font_width, &font_height);
    sg_image_desc img_desc = {
        .width = font_width,
        .height = font_height,
        .pixel_format = SG_PIXELFORMAT_RGBA8,
        .wrap_u = SG_WRAP_CLAMP_TO_EDGE,
        .wrap_v = SG_WRAP_CLAMP_TO_EDGE,
        .content.subimage[0][0] = {
            .ptr = font_pixels,
            .size = font_width * font_height * 4
        }
    };
    bind.fs_images[0] = sg_make_image(&img_desc);

    // shader object for imgui rendering
    sg_shader_desc shd_desc = {
        .attrs = {
            [0].name = "position",
            [1].name = "texcoord0",
            [2].name = "color0"
        },
        .vs.uniform_blocks[0] = {
            .size = sizeof(vs_params_t),
            .uniforms = {
                [0] = { .name="disp_size", .type=SG_UNIFORMTYPE_FLOAT2}
            }
        },
        .vs.source =
            "uniform vec2 disp_size;\n"
            "attribute vec2 position;\n"
            "attribute vec2 texcoord0;\n"
            "attribute vec4 color0;\n"
            "varying vec2 uv;\n"
            "varying vec4 color;\n"
            "void main() {\n"
            "    gl_Position = vec4(((position/disp_size)-0.5)*vec2(2.0,-2.0), 0.5, 1.0);\n"
            "    uv = texcoord0;\n"
            "    color = color0;\n"
            "}\n",
        .fs.images[0] = { .name="tex", .type=SG_IMAGETYPE_2D },
        .fs.source =
            "precision mediump float;"
            "uniform sampler2D tex;\n"
            "varying vec2 uv;\n"
            "varying vec4 color;\n"
            "void main() {\n"
            "    gl_FragColor = texture2D(tex, uv) * color;\n"
            "}\n"
    };
    sg_shader shd = sg_make_shader(&shd_desc);

    // pipeline object for imgui rendering
    sg_pipeline_desc pip_desc = {
        .layout = {
            .buffers[0].stride = sizeof(ImDrawVert),
            .attrs = {
                [0] = { .offset=offsetof(ImDrawVert,pos), .format=SG_VERTEXFORMAT_FLOAT2 },
                [1] = { .offset=offsetof(ImDrawVert,uv), .format=SG_VERTEXFORMAT_FLOAT2 },
                [2] = { .offset=offsetof(ImDrawVert,col), .format=SG_VERTEXFORMAT_UBYTE4N }
            }
        },
        .shader = shd,
        .index_type = SG_INDEXTYPE_UINT16,
        .blend = {
            .enabled = true,
            .src_factor_rgb = SG_BLENDFACTOR_SRC_ALPHA,
            .dst_factor_rgb = SG_BLENDFACTOR_ONE_MINUS_SRC_ALPHA,
            .color_write_mask = SG_COLORMASK_RGB
        }
    };
    pip = sg_make_pipeline(&pip_desc);

    // initial clear color
    pass_action = (sg_pass_action){
        .colors[0] = { .action = SG_ACTION_CLEAR, .val = { 0.0f, 0.5f, 0.7f, 1.0f } }
    };

    wa_set_main_loop(draw, 0, 1);
    return 0;
}

// the main draw loop, this draw the standard ImGui demo windows
void draw() {
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(float(wa_width()), float(wa_height()));
    io.DeltaTime = (float) stm_sec(stm_laptime(&last_time));
    // this mouse button handling fixes the problem when down- and up-events
    // happen in the same frame
    for (int i = 0; i < 3; i++) {
        if (io.MouseDown[i]) {
            if (btn_up[i]) {
                io.MouseDown[i] = false;
                btn_up[i] = false;
            }
        }
        else {
            if (btn_down[i]) {
                io.MouseDown[i] = true;
                btn_down[i] = false;
            }
        }
    }
    ImGui::NewFrame();

    // Show a simple window
    ImGui::Begin("Window");
    static float f = 0.0f;
    ImGui::Text("Hello, world!");
    ImGui::SliderFloat("float", &f, 0.0f, 1.0f);
    ImGui::ColorEdit3("clear color", &pass_action.colors[0].val[0]);
    ImGui::Text("Application average %.3f ms/frame (%.1f FPS)", 1000.0f / ImGui::GetIO().Framerate, ImGui::GetIO().Framerate);
    ImGui::End();

    // the sokol_gfx draw pass
    sg_begin_default_pass(&pass_action, wa_width(), wa_height());
    ImGui::Render();
    draw_imgui(ImGui::GetDrawData());
    sg_end_pass();
    sg_commit();
}

// imgui draw callback
void draw_imgui(ImDrawData* draw_data) {
    assert(draw_data);
    if (draw_data->CmdListsCount == 0) {
        return;
    }

    // render the command list
    vs_params_t vs_params;
    vs_params.disp_size.x = ImGui::GetIO().DisplaySize.x;
    vs_params.disp_size.y = ImGui::GetIO().DisplaySize.y;
    sg_apply_pipeline(pip);
    sg_apply_uniforms(SG_SHADERSTAGE_VS, 0, &vs_params, sizeof(vs_params));
    for (int cl_index = 0; cl_index < draw_data->CmdListsCount; cl_index++) {
        const ImDrawList* cl = draw_data->CmdLists[cl_index];

        // append vertices and indices to buffers, record start offsets in binding struct
        const int vtx_size = cl->VtxBuffer.size() * sizeof(ImDrawVert);
        const int idx_size = cl->IdxBuffer.size() * sizeof(ImDrawIdx);
        const int vb_offset = sg_append_buffer(bind.vertex_buffers[0], &cl->VtxBuffer.front(), vtx_size);
        const int ib_offset = sg_append_buffer(bind.index_buffer, &cl->IdxBuffer.front(), idx_size);
        /* don't render anything if the buffer is in overflow state (this is also
            checked internally in sokol_gfx, draw calls that attempt from
            overflowed buffers will be silently dropped)
        */
        if (sg_query_buffer_overflow(bind.vertex_buffers[0]) ||
            sg_query_buffer_overflow(bind.index_buffer))
        {
            continue;
        }

        bind.vertex_buffer_offsets[0] = vb_offset;
        bind.index_buffer_offset = ib_offset;
        sg_apply_bindings(&bind);

        int base_element = 0;
        for (const ImDrawCmd& pcmd : cl->CmdBuffer) {
            if (pcmd.UserCallback) {
                pcmd.UserCallback(cl, &pcmd);
            }
            else {
                const int scissor_x = (int) (pcmd.ClipRect.x);
                const int scissor_y = (int) (pcmd.ClipRect.y);
                const int scissor_w = (int) (pcmd.ClipRect.z - pcmd.ClipRect.x);
                const int scissor_h = (int) (pcmd.ClipRect.w - pcmd.ClipRect.y);
                sg_apply_scissor_rect(scissor_x, scissor_y, scissor_w, scissor_h, true);
                sg_draw(base_element, pcmd.ElemCount, 1);
            }
            base_element += pcmd.ElemCount;
        }
    }
}
