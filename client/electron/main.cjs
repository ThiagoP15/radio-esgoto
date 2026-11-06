'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, desktopCapturer, ipcMain, net, protocol, session, shell, systemPreferences } = require('electron');
const { autoUpdater } = require('electron-updater');

// `npm run dev` passa --dev (carrega o Vite). Sem a flag (npm run start / app empacotado) carrega o build.
const isDev = !app.isPackaged && process.argv.includes('--dev');
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const APP_ORIGIN = 'app://radio-esgoto';
const DIST_DIR = path.join(__dirname, '..', 'dist');

// O app empacotado é servido por um esquema próprio (app://radio-esgoto) em vez de file://:
// assim ele tem uma origem de verdade (não "null"), que o servidor pode autorizar no CORS/WebSocket
// e que permite cookies de sessão. Precisa ser registrado antes do app ficar pronto.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Só a nossa própria interface é confiável (compara a origem, não o prefixo do texto).
function isTrustedUrl(raw) {
  try {
    const url = new URL(raw);
    if (isDev) return url.origin === new URL(DEV_URL).origin;
    // Verifica o protocolo e o domínio em vez de usar o .origin que falha no Node
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

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

// --- Compartilhamento de tela ------------------------------------------------
// O Electron não tem seletor nativo para getDisplayMedia(): o React pede a lista
// de fontes por IPC, a pessoa escolhe, e o handler abaixo entrega a fonte escolhida.
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

      // Áudio do sistema ("loopback") só está disponível no Windows.
      return callback({ video: source, ...(process.platform === 'win32' ? { audio: 'loopback' } : {}) });
    },
    { useSystemPicker: false },
  );

  // Nega tudo por padrão; libera notificações e microfone (nunca câmera).
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!isTrustedUrl(details.requestingUrl ?? webContents.getURL())) return callback(false);
    if (permission === 'notifications') return callback(true);
    if (permission === 'media') {
      return callback(true); // Permite microfone e partilha de ecrã
    }
    return callback(false);
  });

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (!isTrustedUrl(requestingOrigin)) return false;
    return permission === 'notifications' || permission === 'media';
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
    // Serve client/dist em app://radio-esgoto/..., sem sair da pasta dist (bloqueia ../).
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
    
    // Inicia a verificação de atualizações em segundo plano
    autoUpdater.checkForUpdatesAndNotify();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}