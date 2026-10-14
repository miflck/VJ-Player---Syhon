{
  "targets": [
    {
      "target_name": "syphon_addon",
      "sources": [ "native/syphon_addon.mm" ],
      "include_dirs": [
        "node_modules/node-addon-api",
        "./frameworks/Syphon.framework/Headers"
      ],
      "libraries": [
        "-F../frameworks",
        "-framework Syphon",
        "-framework Cocoa",
        "-framework OpenGL"
      ],
      "xcode_settings": {
        "OTHER_CPLUSPLUSFLAGS": [ "-std=c++17", "-stdlib=libc++" ],
        "MACOSX_DEPLOYMENT_TARGET": "10.13",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "ARCHS": [ "arm64" ],
        "ONLY_ACTIVE_ARCH": "NO",
        "FRAMEWORK_SEARCH_PATHS": [ "./frameworks" ],
        "OTHER_LDFLAGS": [
          "-Wl,-rpath,@loader_path/../../frameworks",
          "-Wl,-rpath,@executable_path/../Frameworks"
        ]
      },
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "defines": [ "NAPI_VERSION=8" ]
    }
  ]
}
