#include <napi.h>
#import <Syphon/Syphon.h>
#import <Cocoa/Cocoa.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl.h>

// Publishes RGBA frames to Syphon.
//
// Electron renders in a separate GPU process, so there is no current CGL
// context in the renderer to share. We create our own offscreen context and
// upload each frame into a texture on it.
class SyphonServerWrapper : public Napi::ObjectWrap<SyphonServerWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    SyphonServerWrapper(const Napi::CallbackInfo& info);
    ~SyphonServerWrapper();

private:
    Napi::Value PublishFrame(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
    Napi::Value HasClients(const Napi::CallbackInfo& info);

    SyphonOpenGLServer* server = nil;
    CGLContextObj cglContext = nullptr;
    GLuint texture = 0;
    uint32_t texWidth = 0;
    uint32_t texHeight = 0;
};

SyphonServerWrapper::SyphonServerWrapper(const Napi::CallbackInfo& info) : Napi::ObjectWrap<SyphonServerWrapper>(info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Server name expected").ThrowAsJavaScriptException();
        return;
    }
    NSString* serverName = [NSString stringWithUTF8String:info[0].As<Napi::String>().Utf8Value().c_str()];

    CGLPixelFormatAttribute attrs[] = {
        kCGLPFAAccelerated,
        kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_Legacy,
        (CGLPixelFormatAttribute)0
    };
    CGLPixelFormatObj pixelFormat = nullptr;
    GLint numFormats = 0;
    if (CGLChoosePixelFormat(attrs, &pixelFormat, &numFormats) != kCGLNoError || pixelFormat == nullptr) {
        Napi::Error::New(env, "Failed to choose CGL pixel format").ThrowAsJavaScriptException();
        return;
    }
    CGLError err = CGLCreateContext(pixelFormat, nullptr, &cglContext);
    CGLDestroyPixelFormat(pixelFormat);
    if (err != kCGLNoError || cglContext == nullptr) {
        Napi::Error::New(env, "Failed to create CGL context").ThrowAsJavaScriptException();
        return;
    }

    server = [[SyphonOpenGLServer alloc] initWithName:serverName context:cglContext options:nil];
    if (server == nil) {
        CGLDestroyContext(cglContext);
        cglContext = nullptr;
        Napi::Error::New(env, "Failed to create Syphon server").ThrowAsJavaScriptException();
    }
}

SyphonServerWrapper::~SyphonServerWrapper() {
    if (server) { [server stop]; server = nil; }
    if (cglContext) {
        CGLSetCurrentContext(cglContext);
        if (texture) glDeleteTextures(1, &texture);
        CGLSetCurrentContext(nullptr);
        CGLDestroyContext(cglContext);
        cglContext = nullptr;
    }
}

// publishFrame(data: Uint8Array | Uint8ClampedArray, width: number, height: number)
// publishFrame(data, width, height, flipped = false)
// data is tightly packed RGBA. By default rows are bottom-up (as returned by
// gl.readPixels). Pass flipped = true for top-down rows (as returned by
// CanvasRenderingContext2D.getImageData).
Napi::Value SyphonServerWrapper::PublishFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!server) {
        Napi::Error::New(env, "Syphon server is not running").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (info.Length() < 3 || !info[0].IsTypedArray() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "publishFrame(data, width, height) expected").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::TypedArray array = info[0].As<Napi::TypedArray>();
    uint32_t width = info[1].As<Napi::Number>().Uint32Value();
    uint32_t height = info[2].As<Napi::Number>().Uint32Value();
    if (width == 0 || height == 0 || array.ByteLength() < (size_t)width * height * 4) {
        Napi::RangeError::New(env, "data is smaller than width * height * 4 bytes").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool flipped = info.Length() > 3 && info[3].ToBoolean().Value();

    // Nobody is listening, skip the upload
    if (!server.hasClients) return env.Undefined();

    const uint8_t* bytes = static_cast<const uint8_t*>(array.ArrayBuffer().Data()) + array.ByteOffset();

    CGLSetCurrentContext(cglContext);

    if (texture == 0) glGenTextures(1, &texture);
    glBindTexture(GL_TEXTURE_2D, texture);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    if (width != texWidth || height != texHeight) {
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, bytes);
        texWidth = width;
        texHeight = height;
    } else {
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, bytes);
    }

    // Syphon copies the texture from its own shared context, so our writes
    // must be flushed first or clients see an empty (black) frame
    glFlush();

    [server publishFrameTexture:texture
                  textureTarget:GL_TEXTURE_2D
                    imageRegion:NSMakeRect(0, 0, width, height)
              textureDimensions:NSMakeSize(width, height)
                        flipped:flipped];

    glBindTexture(GL_TEXTURE_2D, 0);
    glFlush();
    return env.Undefined();
}

Napi::Value SyphonServerWrapper::Stop(const Napi::CallbackInfo& info) {
    if (server) { [server stop]; server = nil; }
    return info.Env().Undefined();
}

// hasClients(): true if at least one Syphon client is connected. Lets JS skip
// the (expensive) canvas readback while nobody is listening.
Napi::Value SyphonServerWrapper::HasClients(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), server != nil && server.hasClients);
}

Napi::Object SyphonServerWrapper::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "SyphonServerWrapper", {
        InstanceMethod("publishFrame", &SyphonServerWrapper::PublishFrame),
        InstanceMethod("stop", &SyphonServerWrapper::Stop),
        InstanceMethod("hasClients", &SyphonServerWrapper::HasClients)
    });
    exports.Set("SyphonServerWrapper", func);
    return exports;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return SyphonServerWrapper::Init(env, exports);
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init)
