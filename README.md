<div align="center">

# 🐀 Rádio Esgoto

**Comunicação de voz, texto e transmissão de tela em baixa latência com estética industrial subterrânea.**

[![GitHub Release](https://img.shields.io/github/v/release/ThiagoP15/radio-esgoto?color=b59449&label=Vers%C3%A3o&style=for-the-badge)](https://github.com/ThiagoP15/radio-esgoto/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-33.x-2b2e3a?style=for-the-badge&logo=electron&logoColor=9feaf9)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-20232a?style=for-the-badge&logo=react&logoColor=61dafb)](https://react.dev/)
[![C++ WASAPI](https://img.shields.io/badge/C%2B%2B-WASAPI_Loopback-00599C?style=for-the-badge&logo=cplusplus&logoColor=white)](https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P_Mesh-333333?style=for-the-badge&logo=webrtc&logoColor=white)](https://webrtc.org/)

[Baixar Última Versão (.exe)](https://github.com/ThiagoP15/radio-esgoto/releases/latest) • [Recursos](#-principais-recursos) • [Arquitetura](#%EF%B8%8F-arquitetura-do-áudio-sem-eco) • [Como Compilar](#-como-rodar-e-compilar-localmente)

</div>

---

## 📖 Sobre o Projeto

O **Rádio Esgoto** é uma aplicação desktop auto-hospedada desenvolvida para comunicação rápida entre amigos, combinando salas de texto, canais de voz P2P e transmissão de tela em alta taxa de quadros.

Construído com **Electron**, **React** e um **módulo nativo em C++**, o projeto resolve um dos maiores desafios de aplicativos baseados em Chromium: capturar o áudio de jogos e janelas no Windows **sem gerar eco** da própria chamada de voz.

---

## ✨ Principais Recursos

* **🎙️ Chamadas de Voz em Malha P2P (WebRTC Mesh):** Conexão direta entre os participantes da sala com baixa latência, supressão de ruído dinâmica e amplificação individual de volume de **0% a 200%** via `Web Audio API` (`GainNode`).
* **🔇 Transmissão de Tela com Áudio Isolado (Zero Eco):**
  * **Modo Janela:** Captura exclusivamente o áudio do processo do jogo ou aplicativo selecionado (e seus processos filhos).
  * **Modo Tela Inteira:** Captura todo o áudio do sistema, excluindo ativamente a árvore de processos do Rádio Esgoto para que a voz dos participantes nunca volte na transmissão.
* **🎮 Qualidade de Vídeo Desbloqueada (Até 1080p @ 120 FPS):**
  * Seletor integrado com perfis **720p 60 FPS (Leve)**, **1080p 60 FPS (Alta)** e **1080p 120 FPS (Ultra)**.
  * Manipulação direta de parâmetros SDP e `RTCRtpSender` para liberar bitrates de até **8.5 Mbps** no vídeo (priorizando fluidez com `contentHint = 'motion'`) e **256 kbps estéreo** no codec Opus.
* **🧱 Interface Temática Animada:** Visual inspirado em galerias subterrâneas com molduras em latão, tubulações de cobre oxidado, drenagem animada e ratos ambientes com ciclos independentes e suporte a `prefers-reduced-motion`.
* **🔄 Atualizações Automáticas:** Integração nativa com `electron-updater` conectada ao GitHub Releases para baixar e aplicar novas versões automaticamente.

---

## ⚙️ Arquitetura do Áudio sem Eco

Em vez de utilizar o `loopback` padrão do Chromium (que captura a saída global da placa de som e causa microfonia na chamada), o Rádio Esgoto utiliza um pipeline híbrido:


flowchart LR
    A[Jogo / Janela no Windows] -->|WASAPI Process Loopback| B[proc_loopback.node<br/>Addon C++ N-API]
    B -->|Buffer PCM Float32 via IPC| C[preload.cjs]
    C -->|Transferable ArrayBuffer| D[AudioWorklet<br/>screen-audio-worklet.js]
    D -->|MediaStreamAudioDestination| E[Faixa de Áudio Limpa]
    F[getDisplayMedia<br/>1080p / 120 FPS] -->|Faixa de Vídeo| G[MediaStream Unificado]
    E --> G
    G -->|WebRTC P2P| H[Peers na Sala]

🛠️ Stack Tecnológica
Cliente Desktop & UI: Electron 33, React 18, Vite, Tailwind CSS, Web Audio API (AudioWorklet / GainNode).

Módulo Nativo (Windows): C++17/20, Node-API (node-addon-api), node-gyp, Windows Audio Session API (WASAPI).

Sinalização & Backend: Node.js, Socket.io, SQLite.

Empacotamento & CI/CD: electron-builder (NSIS x64 com asarUnpack para binários nativos) e electron-updater.

🚀 Como Rodar e Compilar Localmente
Pré-requisitos (Windows)
Para compilar o módulo nativo de captura de áudio (proc_loopback.node), são necessários:

Windows 10 (Build 20348+) ou Windows 11.

Node.js (v18 ou superior) e Python 3.

Visual Studio Build Tools 2022 com a carga "Desenvolvimento para desktop com C++" e Windows SDK 10.0.19041+:
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

Instalação e Desenvolvimento

# Clone o repositório
git clone [https://github.com/ThiagoP15/radio-esgoto.git](https://github.com/ThiagoP15/radio-esgoto.git)
cd radio-esgoto/client

# Instale as dependências do cliente
npm install

# Compile o módulo nativo C++ (WASAPI)
npm run build:native

# Inicie o ambiente de desenvolvimento (Vite + Electron)
npm run dev

Gerar Instalador de Produção
# Gera o executável NSIS na pasta client/dist/
npm run dist

📁 Estrutura do Projeto

radio-esgoto/
├── client/
│   ├── electron/
│   │   ├── main.cjs                  # Processo principal, IPC, flags de GPU e auto-updater
│   │   └── preload.cjs               # Ponte segura (contextBridge) para tela e áudio nativo
│   ├── native/
│   │   └── proc-loopback/
│   │       ├── binding.gyp           # Configuração de compilação node-gyp
│   │       └── src/addon.cc          # Implementação WASAPI Process Loopback em C++
│   ├── src/
│   │   ├── components/               # VoiceChannel, VideoGrid, MembersPanel, AmbientRats
│   │   ├── voice/
│   │   │   ├── VoiceSession.js       # Gerenciador WebRTC Mesh, presets e SDP tuning
│   │   │   └── screen-audio-worklet.js # Processador PCM em tempo real
│   │   └── assets/                   # Sprites, texturas e elementos visuais
│   └── vite.config.js                # Configuração de build e injeção de CSP
└── server/                           # Servidor de sinalização Socket.io e persistência
