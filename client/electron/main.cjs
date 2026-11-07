'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, desktopCapturer, ipcMain, net, protocol, session, shell, systemPreferences } = require('electron');
const { autoUpdater } = require('electron-updater');


// Impede que o Electron congele a transmissão de vídeo/áudio quando a janela não está focada ou está minimizada
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Corrige o bug da tela verde (MPO / DXGI Color Space) em placas AMD/NVIDIA ao capturar o monitor
// MATA O BUG DA TELA VERDE: desativa os overlays de hardware e DirectComposition do vídeo
app.commandLine.appendSwitch('disable-DirectComposition');
app.commandLine.appendSwitch('disable-features', 'DirectComposition,UseSkiaRenderer,WebRtcAllowDxgiGmb,MediaFoundationD3D11VideoCapture');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
// Ativa cancelamento de eco nativo em nível de processo no Chromium
app.commandLine.appendSwitch('enable-features', 'WebRtcAllowInputVolumeAdjustment,ChromeWideEchoCancellation');

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
    },
  });

  win.once('ready-to-show', () => win.show());

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

      // Sem 'audio: loopback' global: evita que o Windows capture a voz dos amigos
      // que está saindo no Rádio Esgoto e gere eco infinito na sala.
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

    autoUpdater.checkForUpdatesAndNotify();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}