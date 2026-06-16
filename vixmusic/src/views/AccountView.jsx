import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { vixApi } from '../api/vixApi';

export default function AccountView() {
  const { user, logout, bootstrap } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  if (!user) {
    return (
      <div className="auth-view">
        <div className="auth-card">
          <h1>Mi cuenta</h1>
          <p>Inicia sesión para ver tu perfil y sincronizar favoritos.</p>
          <Link to="/login" className="btn-primary">Iniciar sesión</Link>
        </div>
      </div>
    );
  }

  const saveProfile = async (e) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    try {
      await vixApi.updateProfile({ displayName, email });
      await bootstrap();
      setMsg('Perfil actualizado');
    } catch (error) {
      setErr(error.message);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    try {
      await vixApi.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setMsg('Contraseña cambiada');
    } catch (error) {
      setErr(error.message);
    }
  };

  return (
    <div className="home-view account-view">
      <section className="home-hero">
        <h1>Mi cuenta</h1>
        <p className="subtitle">@{user.username} · {user.role === 'admin' ? 'Administrador' : 'Usuario'}</p>
      </section>

      {msg && <div className="auth-success">{msg}</div>}
      {err && <div className="auth-error">{err}</div>}

      <section className="home-section account-section">
        <h2>Perfil</h2>
        <form onSubmit={saveProfile} className="auth-form auth-form--inline">
          <label>
            Nombre visible
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            Correo
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="submit" className="btn-secondary">Guardar perfil</button>
        </form>
      </section>

      <section className="home-section account-section">
        <h2>Cambiar contraseña</h2>
        <form onSubmit={savePassword} className="auth-form auth-form--inline">
          <label>
            Contraseña actual
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </label>
          <label>
            Nueva contraseña
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} />
          </label>
          <button type="submit" className="btn-secondary">Cambiar contraseña</button>
        </form>
      </section>

      <section className="home-section account-actions">
        {user.role === 'admin' && (
          <Link to="/admin" className="btn-secondary">Panel de administración</Link>
        )}
        <button type="button" className="btn-ghost" onClick={logout}>Cerrar sesión</button>
      </section>
    </div>
  );
}
