// Captura de áudio POR PROCESSO via WASAPI Process Loopback.
// Requer Windows 10 build 20348+ / Windows 11 e Windows SDK 10.0.19041+.
//
//   start(pid, include, cb)  include=true  -> só o áudio da árvore de processos `pid` (jogo/app)
//                            include=false -> TODO o áudio do sistema, EXCETO a árvore `pid`
//   cb(err, ArrayBuffer)     ArrayBuffer = Float32 estéreo intercalado, 48 kHz
//   stop(), isSupported(), getWindowPid(hwnd)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <napi.h>
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>
#include <wrl/implements.h>

#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

class ActivateHandler
    : public Microsoft::WRL::RuntimeClass<
          Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
          Microsoft::WRL::FtmBase, IActivateAudioInterfaceCompletionHandler> {
 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  ComPtr<IAudioClient> client;
  HRESULT result = E_FAIL;

  ~ActivateHandler() override {
    if (done) CloseHandle(done);
  }

  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT activate = E_FAIL;
    ComPtr<IUnknown> unk;
    HRESULT hr = op->GetActivateResult(&activate, &unk);
    if (SUCCEEDED(hr) && SUCCEEDED(activate)) {
      unk.As(&client);
      result = S_OK;
    } else {
      result = FAILED(hr) ? hr : activate;
    }
    SetEvent(done);
    return S_OK;
  }
};

struct Capture {
  std::thread worker;
  HANDLE stopEvt = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  Napi::ThreadSafeFunction tsfn;
  ~Capture() {
    if (stopEvt) CloseHandle(stopEvt);
  }
};

std::unique_ptr<Capture> g_capture;

void EmitError(Capture* c, const char* step, HRESULT hr) {
  char buf[128];
  std::snprintf(buf, sizeof buf, "%s (0x%08lX)", step, static_cast<unsigned long>(hr));
  c->tsfn.NonBlockingCall(new std::string(buf), [](Napi::Env env, Napi::Function cb, std::string* msg) {
    cb.Call({Napi::String::New(env, *msg), env.Null()});
    delete msg;
  });
}

void EmitData(Capture* c, std::vector<float>* samples) {
  c->tsfn.NonBlockingCall(samples, [](Napi::Env env, Napi::Function cb, std::vector<float>* d) {
    const size_t bytes = d->size() * sizeof(float);
    auto buf = Napi::ArrayBuffer::New(env, bytes);
    std::memcpy(buf.Data(), d->data(), bytes);
    delete d;
    cb.Call({env.Null(), buf});
  });
}

void Run(DWORD pid, bool include, Capture* c) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);

  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode =
      include ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
              : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT pv = {};
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof(params);
  pv.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  auto handler = Microsoft::WRL::Make<ActivateHandler>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> op;
  HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &pv,
                                           handler.Get(), &op);
  if (FAILED(hr)) { EmitError(c, "ActivateAudioInterfaceAsync", hr); CoUninitialize(); return; }
  WaitForSingleObject(handler->done, 5000);
  if (FAILED(handler->result) || !handler->client) {
    EmitError(c, "ativacao", handler->result);
    CoUninitialize();
    return;
  }
  ComPtr<IAudioClient> client = handler->client;

  // O dispositivo virtual NÃO suporta GetMixFormat: o formato tem de ser informado.
  WAVEFORMATEX fmt = {};
  fmt.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
  fmt.nChannels = 2;
  fmt.nSamplesPerSec = 48000;
  fmt.wBitsPerSample = 32;
  fmt.nBlockAlign = fmt.nChannels * fmt.wBitsPerSample / 8;
  fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

  HANDLE evt = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                              AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                          2000000 /* 200 ms */, 0, &fmt, nullptr);
  if (FAILED(hr)) { EmitError(c, "Initialize", hr); CloseHandle(evt); CoUninitialize(); return; }

  ComPtr<IAudioCaptureClient> cap;
  if (FAILED(hr = client->SetEventHandle(evt)) || FAILED(hr = client->GetService(IID_PPV_ARGS(&cap))) ||
      FAILED(hr = client->Start())) {
    EmitError(c, "start", hr);
    CloseHandle(evt);
    CoUninitialize();
    return;
  }

  HANDLE waits[2] = {evt, c->stopEvt};
  for (;;) {
    DWORD w = WaitForMultipleObjects(2, waits, FALSE, 1000);
    if (w == WAIT_OBJECT_0 + 1 || w == WAIT_FAILED) break;
    if (w == WAIT_TIMEOUT) continue;  // loopback pode não gerar eventos durante silêncio

    UINT32 packet = 0;
    while (SUCCEEDED(cap->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(cap->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
      auto* out = new std::vector<float>(static_cast<size_t>(frames) * 2, 0.0f);
      if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT)) std::memcpy(out->data(), data, static_cast<size_t>(frames) * 8);
      cap->ReleaseBuffer(frames);
      EmitData(c, out);
    }
  }

  client->Stop();
  CloseHandle(evt);
  CoUninitialize();
}

void StopInternal() {
  if (!g_capture) return;
  SetEvent(g_capture->stopEvt);
  if (g_capture->worker.joinable()) g_capture->worker.join();
  g_capture->tsfn.Release();
  g_capture.reset();
}

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsBoolean() || !info[2].IsFunction())
    return Napi::Boolean::New(env, false);

  StopInternal();
  DWORD pid = static_cast<DWORD>(info[0].As<Napi::Number>().Uint32Value());
  bool include = info[1].As<Napi::Boolean>().Value();

  g_capture = std::make_unique<Capture>();
  g_capture->tsfn = Napi::ThreadSafeFunction::New(env, info[2].As<Napi::Function>(), "proc-loopback", 0, 1);
  g_capture->worker = std::thread(Run, pid, include, g_capture.get());
  return Napi::Boolean::New(env, true);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  StopInternal();
  return info.Env().Undefined();
}

Napi::Value IsSupported(const Napi::CallbackInfo& info) {
  using RtlGetVersionFn = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
  auto fn = reinterpret_cast<RtlGetVersionFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "RtlGetVersion"));
  RTL_OSVERSIONINFOW v = {};
  v.dwOSVersionInfoSize = sizeof(v);
  bool ok = fn && fn(&v) == 0 && v.dwBuildNumber >= 20348;
  return Napi::Boolean::New(info.Env(), ok);
}

Napi::Value GetWindowPid(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Number::New(info.Env(), 0);
  HWND hwnd = reinterpret_cast<HWND>(static_cast<intptr_t>(info[0].As<Napi::Number>().Int64Value()));
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  return Napi::Number::New(info.Env(), static_cast<double>(pid));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("isSupported", Napi::Function::New(env, IsSupported));
  exports.Set("getWindowPid", Napi::Function::New(env, GetWindowPid));
  return exports;
}

}  // namespace

NODE_API_MODULE(proc_loopback, Init)
