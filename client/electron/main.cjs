'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, net, protocol, session, shell, systemPreferences } = require('electron');
const { autoUpdater } = require('electron-updater');

// Captura de áudio por processo (WASAPI Process Loopback). Só Windows 10 build 20348+ / 11.
let procAudio = null;
try {
  if (process.platform === 'win32') {
    const addonPath = path
      .join(__dirname, '..', 'native', 'proc-loopback', 'build', 'Release', 'proc_loopback.node')
      .replace('app.asar', 'app.asar.unpacked');
    procAudio = require(addonPath);
  }
} catch (err) {
  console.warn('[áudio] módulo nativo indisponível:', err.message);
}

// Impede que o Electron congele a transmissão de vídeo/áudio quando a janela não está focada ou está minimizada
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Corrige o bug da tela verde (MPO / DXGI Color Space) em placas AMD/NVIDIA ao capturar o monitor
// MATA O BUG DA TELA VERDE: desativa os overlays de hardware e DirectComposition do vídeo
app.commandLine.appendSwitch('disable-DirectComposition');
app.commandLine.appendSwitch('disable-features', 'DirectComposition,UseSkiaRenderer,WebRtcAllowDxgiGmb,MediaFoundationD3D11VideoCapture');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
// Ativa cancelamento de eco nativo em nível de processo no Chromium e libera autoplay de áudio
app.commandLine.appendSwitch('enable-features', 'WebRtcAllowInputVolumeAdjustment,ChromeWideEchoCancellation');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// `npm run dev` passa --dev (carrega o Vite). Sem a flag (npm run start / app empacotado) carrega o build.
const isDev = !app.isPackaged && process.argv.includes('--dev');
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const APP_ORIGIN = 'app://radio-esgoto';
const DIST_DIR = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function isTrustedUrl(raw) {
  try {
    const url = new URL(raw);
    if (isDev) return url.origin === new URL(DEV_URL).origin;
    return url.protocol === 'app:' && url.hostname === 'radio-esgoto';
  } catch {
    return false;
  }
}
const isTrustedSender = (event) => isTrustedUrl(event.senderFrame?.url ?? '');

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 480,
    minHeight: 520,
    title: 'Rádio Esgoto',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#0b0d0c',
    show: false,
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false, // Impede travamento da live fora do modo janela
      autoplayPolicy: 'no-user-gesture-required', // o som das transmissões remotas toca sem exigir clique
    },
  });

  win.once('ready-to-show', () => win.show());

  // DevTools: automático no `npm run dev`; no app empacotado só com RADIO_DEVTOOLS=1.
  // Atalhos (nesses casos): F12 ou Ctrl+Shift+I.
  if (isDev || process.env.RADIO_DEVTOOLS === '1') {
    win.webContents.once('did-finish-load', () => win.webContents.openDevTools({ mode: 'detach' }));
    win.webContents.on('before-input-event', (_event, input) => {
      const isToggle = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
      if (input.type === 'keyDown' && isToggle) win.webContents.toggleDevTools();
    });
  }

  // Quando o usuário sai da tela cheia pelo ESC nativo ou F11, garante sincronia
  win.on('leave-full-screen', () => {
    win.webContents.send('window:fullscreen-changed', false);
  });
  win.on('enter-full-screen', () => {
    win.webContents.send('window:fullscreen-changed', true);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });

  if (isDev) win.loadURL(DEV_URL);
  else win.loadURL(`${APP_ORIGIN}/index.html`);
}

// --- Controle de Tela Cheia via IPC ------------------------------------------
ipcMain.handle('window:set-fullscreen', (event, flag) => {
  if (!isTrustedSender(event)) throw new Error('Remetente não autorizado.');
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  win.setFullScreen(Boolean(flag));
  return win.isFullScreen();
});

ipcMain.handle('window:toggle-fullscreen', (event) => {
  if (!isTrustedSender(event)) throw new Error('Remetente não autorizado.');
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  const next = !win.isFullScreen();
  win.setFullScreen(next);
  return next;
});

// --- Compartilhamento de tela ------------------------------------------------
let selectedSourceId = null;

ipcMain.handle('screen:get-sources', async (event) => {
  if (!isTrustedSender(event)) throw new Error('Remetente não autorizado.');
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
});

ipcMain.handle('screen:select-source', (event, id) => {
  if (!isTrustedSender(event)) throw new Error('Remetente não autorizado.');
  selectedSourceId = typeof id === 'string' ? id : null;
});

// --- Áudio do compartilhamento, sem eco ---------------------------------------
// Janela -> captura SÓ o áudio daquele app (INCLUDE). Tela -> todo o áudio do sistema
// MENOS o do próprio Rádio Esgoto (EXCLUDE process.pid), ou seja, sem a voz da chamada.
ipcMain.handle('screen:audio-start', (event, sourceId) => {
  if (!isTrustedSender(event)) throw new Error('Remetente não autorizado.');
  if (!procAudio?.isSupported()) return { ok: false, reason: 'unsupported' };

  let pid = 0;
  let include = false;
  const win = /^window:(\d+):/.exec(typeof sourceId === 'string' ? sourceId : '');
  if (win) {
    pid = procAudio.getWindowPid(Number(win[1]));
    include = true;
    if (!pid || pid === process.pid) return { ok: false, reason: 'no-target' };
  } else if (typeof sourceId === 'string' && sourceId.startsWith('screen:')) {
    pid = process.pid;
    include = false;
  } else {
    return { ok: false, reason: 'bad-source' };
  }

  console.log(`[áudio] iniciando captura: modo=${include ? 'INCLUDE (só o app)' : 'EXCLUDE (sistema menos o Rádio Esgoto)'} pid=${pid} fonte=${sourceId}`);
  const sender = event.sender;
  const started = procAudio.start(pid, include, (err, buf) => {
    if (err) {
      console.warn('[áudio] captura falhou:', err);
      return;
    }
    if (!sender.isDestroyed()) sender.send('screen:audio-chunk', buf);
  });
  return { ok: started, mode: include ? 'app' : 'system-minus-app', pid };
});

ipcMain.handle('screen:audio-stop', (event) => {
  if (!isTrustedSender(event)) throw new Error('Remetente não autorizado.');
  procAudio?.stop();
});

app.on('before-quit', () => procAudio?.stop());

function configureSession(ses) {
  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const origin = request.frame?.url || request.securityOrigin || '';
      const wanted = selectedSourceId;
      selectedSourceId = null; // a escolha vale para um único pedido
      if (!wanted || !isTrustedUrl(origin)) return callback();

      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = sources.find((s) => s.id === wanted);
      if (!source) return callback();

      // O áudio NÃO vem do getDisplayMedia ('loopback' captura o sistema inteiro, voz da call incluída).
      // Ele vem do módulo nativo (screen:audio-start), que filtra por processo.
      return callback({ video: source });
    },
    { useSystemPicker: false },
  );

  // Libera notificações, microfone/tela (media) e TELA CHEIA (fullscreen).
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!isTrustedUrl(details.requestingUrl ?? webContents.getURL())) return callback(false);
    if (permission === 'notifications' || permission === 'media' || permission === 'fullscreen') {
      return callback(true);
    }
    return callback(false);
  });

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (!isTrustedUrl(requestingOrigin)) return false;
    return permission === 'notifications' || permission === 'media' || permission === 'fullscreen';
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('app', (request) => {
      const { pathname } = new URL(request.url);
      const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
      const file = path.normalize(path.join(DIST_DIR, relative));
      if (!file.startsWith(DIST_DIR + path.sep)) return new Response('Proibido', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });

    configureSession(session.defaultSession);
    if (process.platform === 'darwin') systemPreferences.askForMediaAccess('microphone').catch(() => {});

    createWindow();

    if (app.isPackaged) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('update-downloaded', (info) => {
        dialog
          .showMessageBox({
            type: 'info',
            title: 'Atualização do Esgoto Pronta',
            message: `A versão ${info.version} foi baixada. Reiniciar agora para aplicar?`,
            buttons: ['Reiniciar e Atualizar', 'Depois'],
            defaultId: 0,
          })
          .then(({ response }) => {
            if (response === 0) autoUpdater.quitAndInstall(false, true);
          });
      });
      autoUpdater.checkForUpdates();
      setInterval(() => autoUpdater.checkForUpdates(), 10 * 60 * 1000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}