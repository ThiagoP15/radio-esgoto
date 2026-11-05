import { useEffect, useState } from 'react';
import { api } from './api.js';
import { toast } from './toast.js';
import AuthScreen from './components/AuthScreen.jsx';
import Toaster from './components/Toaster.jsx';
import Workspace from './Workspace.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  // A sessão é um cookie HttpOnly: só o servidor sabe se ela existe, então perguntamos a ele.
  useEffect(() => {
    api('/me')
      .then(setUser)
      .catch(() => {})
      .finally(() => setBooting(false));
  }, []);

  // Sessão expirada, usuário rejeitado ou removido: volta para o login.
  useEffect(() => {
    const onExpired = () => {
      setUser((current) => {
        if (current) toast('Sua sessão terminou. Entre novamente.', 'info');
        return null;
      });
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const logout = async () => {
    try {
      await api('/logout', { method: 'POST' });
    } catch {
      /* mesmo sem resposta, volta para o login */
    }
    setUser(null);
  };

  return (
    <>
      {/* Camadas de efeito (vinheta e grão): decorativas, sem interação, desligáveis */}
      <div className="fx-vignette" aria-hidden="true" />
      <div className="fx-grain" aria-hidden="true" />

      {booting ? (
        <div className="boot">Acendendo as lâmpadas…</div>
      ) : user ? (
        <Workspace user={user} onUserChange={setUser} onLogout={logout} />
      ) : (
        <AuthScreen onAuthenticated={setUser} />
      )}
      <Toaster />
    </>
  );
}
