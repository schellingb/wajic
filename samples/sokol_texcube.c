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
//  sokol_texcube.c (based on texcube-emsc.c)
//------------------------------------------------------------------------------
#include <wajic_gl.h>
#define HANDMADE_MATH_IMPLEMENTATION
#define HANDMADE_MATH_NO_SSE
#include "HandmadeMath.h"
#define SOKOL_IMPL
#define SOKOL_GLES2
#include "sokol_gfx.h"

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
        canvas.width = 1280;
        canvas.height = 720;
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

static sg_pass_action pass_action = {
    .colors[0] = { .action = SG_ACTION_CLEAR, .val = { 0.0f, 0.0f, 0.0f, 1.0f } }
};
static sg_pipeline pip;
static sg_bindings bind;
static float rx, ry;

typedef struct {
    hmm_mat4 mvp;
} params_t;

static void draw();

int main() {
    /* setup WebGL context */
    wa_init("#canvas", WA_ANTIALIAS);

    /* setup sokol_gfx */
    sg_setup(&(sg_desc){0});
    assert(sg_isvalid());
    
    /* cube vertex buffer */
    float vertices[] = {
        /* pos                  color                       uvs */
        -1.0f, -1.0f, -1.0f,    1.0f, 0.0f, 0.0f, 1.0f,     0.0f, 0.0f,
         1.0f, -1.0f, -1.0f,    1.0f, 0.0f, 0.0f, 1.0f,     1.0f, 0.0f,
         1.0f,  1.0f, -1.0f,    1.0f, 0.0f, 0.0f, 1.0f,     1.0f, 1.0f,
        -1.0f,  1.0f, -1.0f,    1.0f, 0.0f, 0.0f, 1.0f,     0.0f, 1.0f,

        -1.0f, -1.0f,  1.0f,    0.0f, 1.0f, 0.0f, 1.0f,     0.0f, 0.0f, 
         1.0f, -1.0f,  1.0f,    0.0f, 1.0f, 0.0f, 1.0f,     1.0f, 0.0f,
         1.0f,  1.0f,  1.0f,    0.0f, 1.0f, 0.0f, 1.0f,     1.0f, 1.0f,
        -1.0f,  1.0f,  1.0f,    0.0f, 1.0f, 0.0f, 1.0f,     0.0f, 1.0f,

        -1.0f, -1.0f, -1.0f,    0.0f, 0.0f, 1.0f, 1.0f,     0.0f, 0.0f,
        -1.0f,  1.0f, -1.0f,    0.0f, 0.0f, 1.0f, 1.0f,     1.0f, 0.0f,
        -1.0f,  1.0f,  1.0f,    0.0f, 0.0f, 1.0f, 1.0f,     1.0f, 1.0f,
        -1.0f, -1.0f,  1.0f,    0.0f, 0.0f, 1.0f, 1.0f,     0.0f, 1.0f,

         1.0f, -1.0f, -1.0f,    1.0f, 0.5f, 0.0f, 1.0f,     0.0f, 0.0f,
         1.0f,  1.0f, -1.0f,    1.0f, 0.5f, 0.0f, 1.0f,     1.0f, 0.0f,
         1.0f,  1.0f,  1.0f,    1.0f, 0.5f, 0.0f, 1.0f,     1.0f, 1.0f,
         1.0f, -1.0f,  1.0f,    1.0f, 0.5f, 0.0f, 1.0f,     0.0f, 1.0f,

        -1.0f, -1.0f, -1.0f,    0.0f, 0.5f, 1.0f, 1.0f,     0.0f, 0.0f,
        -1.0f, -1.0f,  1.0f,    0.0f, 0.5f, 1.0f, 1.0f,     1.0f, 0.0f,
         1.0f, -1.0f,  1.0f,    0.0f, 0.5f, 1.0f, 1.0f,     1.0f, 1.0f,
         1.0f, -1.0f, -1.0f,    0.0f, 0.5f, 1.0f, 1.0f,     0.0f, 1.0f,

        -1.0f,  1.0f, -1.0f,    1.0f, 0.0f, 0.5f, 1.0f,     0.0f, 0.0f,
        -1.0f,  1.0f,  1.0f,    1.0f, 0.0f, 0.5f, 1.0f,     1.0f, 0.0f,
         1.0f,  1.0f,  1.0f,    1.0f, 0.0f, 0.5f, 1.0f,     1.0f, 1.0f,
         1.0f,  1.0f, -1.0f,    1.0f, 0.0f, 0.5f, 1.0f,     0.0f, 1.0f
    };
    bind.vertex_buffers[0] = sg_make_buffer(&(sg_buffer_desc){
        .size = sizeof(vertices),
        .content = vertices,
    });

    /* create an index buffer for the cube */
    uint16_t indices[] = {
        0, 1, 2,  0, 2, 3,
        6, 5, 4,  7, 6, 4,
        8, 9, 10,  8, 10, 11,
        14, 13, 12,  15, 14, 12,
        16, 17, 18,  16, 18, 19,
        22, 21, 20,  23, 22, 20
    };
    bind.index_buffer = sg_make_buffer(&(sg_buffer_desc){
        .type = SG_BUFFERTYPE_INDEXBUFFER,
        .size = sizeof(indices),
        .content = indices,
    });

    /* create a checkerboard texture */
    uint32_t pixels[4*4] = {
        0xFFFFFFFF, 0xFF000000, 0xFFFFFFFF, 0xFF000000,
        0xFF000000, 0xFFFFFFFF, 0xFF000000, 0xFFFFFFFF,
        0xFFFFFFFF, 0xFF000000, 0xFFFFFFFF, 0xFF000000,
        0xFF000000, 0xFFFFFFFF, 0xFF000000, 0xFFFFFFFF,
    };
    bind.fs_images[0] = sg_make_image(&(sg_image_desc){
        .width = 4,
        .height = 4,
        .content.subimage[0][0] = {
            .ptr = pixels,
            .size = sizeof(pixels)
        }
    });

    /* create shader */
    sg_shader shd = sg_make_shader(&(sg_shader_desc){
        .attrs = {
            [0].name = "position",
            [1].name = "color0",
            [2].name = "texcoord0"
        },
        .vs.uniform_blocks[0] = {
            .size = sizeof(params_t),
            .uniforms = {
                [0] = { .name="mvp", .type=SG_UNIFORMTYPE_MAT4 }
            }
        },
        .fs.images[0] = { .name="tex", .type=SG_IMAGETYPE_2D },
        .vs.source =
            "uniform mat4 mvp;\n"
            "attribute vec4 position;\n"
            "attribute vec4 color0;\n"
            "attribute vec2 texcoord0;\n"
            "varying vec4 color;\n"
            "varying vec2 uv;"
            "void main() {\n"
            "  gl_Position = mvp * position;\n"
            "  color = color0;\n"
            "  uv = texcoord0 * 5.0;\n"
            "}\n",
        .fs.source =
            "precision mediump float;\n"
            "uniform sampler2D tex;\n"
            "varying vec4 color;\n"
            "varying vec2 uv;\n"
            "void main() {\n"
            "  gl_FragColor = texture2D(tex, uv) * color;\n"
            "}\n"
    });

    /* create pipeline object */
    pip = sg_make_pipeline(&(sg_pipeline_desc){
        .layout = {
            .attrs = {
                [0].format=SG_VERTEXFORMAT_FLOAT3,
                [1].format=SG_VERTEXFORMAT_FLOAT4,
                [2].format=SG_VERTEXFORMAT_FLOAT2
            }
        },
        .shader = shd,
        .index_type = SG_INDEXTYPE_UINT16,
        .depth_stencil = {
            .depth_compare_func = SG_COMPAREFUNC_LESS_EQUAL,
            .depth_write_enabled = true
        },
        .rasterizer.cull_mode = SG_CULLMODE_BACK
    });
    
    /* hand off control to browser loop */
    wa_set_main_loop(draw, 0, 1);
    return 0;
}

void draw() {
    /* compute model-view-projection matrix for vertex shader */
    params_t vs_params;
    rx += 1.0f; ry += 2.0f;
    hmm_mat4 proj = HMM_Perspective(60.0f, (float)wa_width()/(float)wa_height(), 0.01f, 10.0f);
    hmm_mat4 view = HMM_LookAt(HMM_Vec3(0.0f, 1.5f, 6.0f), HMM_Vec3(0.0f, 0.0f, 0.0f), HMM_Vec3(0.0f, 1.0f, 0.0f));
    hmm_mat4 view_proj = HMM_MultiplyMat4(proj, view);
    
    hmm_mat4 model = HMM_MultiplyMat4(
        HMM_Rotate(rx, HMM_Vec3(1.0f, 0.0f, 0.0f)),
        HMM_Rotate(ry, HMM_Vec3(0.0f, 1.0f, 0.0f)));
    vs_params.mvp = HMM_MultiplyMat4(view_proj, model);

    /* ...and draw */
    sg_begin_default_pass(&pass_action, wa_width(), wa_height());
    sg_apply_pipeline(pip);
    sg_apply_bindings(&bind);
    sg_apply_uniforms(SG_SHADERSTAGE_VS, 0, &vs_params, sizeof(vs_params));
    sg_draw(0, 36, 1);
    sg_end_pass();
    sg_commit();
}
