import { useState } from 'react';
import { api } from '../api.js';
import { brand } from '../assets/index.js';
import { toast } from '../toast.js';

export default function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [website, setWebsite] = useState(''); // honeypot: invisível para pessoas, bots costumam preencher
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isRegister) {
        await api('/register', { method: 'POST', json: { username, password, website } });
        toast('Cadastro enviado! Um administrador precisa aprovar antes do seu primeiro acesso.', 'success');
        setMode('login');
        setPassword('');
      } else {
        const { user } = await api('/login', { method: 'POST', json: { username, password } });
        onAuthenticated(user);
      }
    } catch (err) {
      if (err.status === 403 && err.code === 'PENDING') {
        toast('Seu cadastro está em análise por um administrador', 'info');
        setError('Seu cadastro está em análise por um administrador.');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <img className="login-logo" src={brand.logo} alt="Rádio Esgoto" />
        <p className="login-sub">{isRegister ? 'Peça sua entrada no esgoto.' : 'Entre no esgoto.'}</p>

        <label htmlFor="username">Nome de usuário</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={24}
          autoComplete="username"
          autoFocus
          required
        />

        <label htmlFor="password">Senha</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={isRegister ? 8 : undefined}
          maxLength={72}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          required
        />
        {isRegister && <p className="hint">Mínimo de 8 caracteres. Todo cadastro passa por aprovação manual.</p>}

        <input
          className="hp"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Aguarde…' : isRegister ? 'Pedir entrada' : 'Entrar'}
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode(isRegister ? 'login' : 'register');
            setError('');
          }}
        >
          {isRegister ? 'Já tenho conta' : 'Criar uma conta'}
        </button>
      </form>
    </main>
  );
}
