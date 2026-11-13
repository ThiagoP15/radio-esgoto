{
  "targets": [
    {
      "target_name": "proc_loopback",
      "sources": ["src/addon.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8", "UNICODE", "_UNICODE"],
      "conditions": [
        ["OS=='win'", {
          "libraries": ["mmdevapi.lib", "ole32.lib"],
          "msvs_settings": {
            "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17"] }
          }
        }]
      ]
    }
  ]
}
