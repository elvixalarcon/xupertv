import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { vixApi } from '../api/vixApi';

export default function AdminView() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState({ allowRegistration: true });
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'user' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [u, s] = await Promise.all([vixApi.adminUsers(), vixApi.adminSettings()]);
    setUsers(u.items || []);
    setSettings(s);
  };

  useEffect(() => {
    if (user?.role === 'admin') load().catch((e) => setError(e.message));
  }, [user]);

  if (!user) {
    return <div className="view-error">Inicia sesión primero</div>;
  }
  if (user.role !== 'admin') {
    return <div className="view-error">Acceso solo para administradores</div>;
  }

  const createUser = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await vixApi.adminCreateUser(form);
      setForm({ username: '', email: '', password: '', role: 'user' });
      setMsg('Usuario creado');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleActive = async (u) => {
    await vixApi.adminUpdateUser(u.id, { isActive: !u.isActive });
    await load();
  };

  const toggleReg = async () => {
    await vixApi.adminPatchSettings({ allowRegistration: !settings.allowRegistration });
    await load();
  };

  return (
    <div className="home-view admin-view">
      <section className="home-hero">
        <h1>Administración</h1>
        <p className="subtitle">Usuarios de VixMusic</p>
        <Link to="/cuenta" className="btn-ghost">← Mi cuenta</Link>
      </section>

      {msg && <div className="auth-success">{msg}</div>}
      {error && <div className="auth-error">{error}</div>}

      <section className="home-section">
        <h2>Configuración</h2>
        <button type="button" className="btn-secondary" onClick={toggleReg}>
          Registro público: {settings.allowRegistration ? 'Activado' : 'Desactivado'}
        </button>
      </section>

      <section className="home-section">
        <h2>Crear usuario</h2>
        <form onSubmit={createUser} className="auth-form admin-form">
          <input placeholder="Usuario" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          <input placeholder="Correo (opcional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input placeholder="Contraseña" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="user">Usuario</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" className="btn-primary">Crear</button>
        </form>
      </section>

      <section className="home-section">
        <h2>Usuarios ({users.length})</h2>
        <div className="admin-user-list">
          {users.map((u) => (
            <div key={u.id} className="admin-user-row">
              <div>
                <strong>{u.displayName}</strong>
                <span> @{u.username}</span>
                {u.email && <span className="admin-user-email"> · {u.email}</span>}
                <span className={`admin-badge admin-badge--${u.role}`}>{u.role}</span>
                {!u.isActive && <span className="admin-badge admin-badge--off">inactivo</span>}
              </div>
              {u.id !== user.id && (
                <button type="button" className="btn-ghost" onClick={() => toggleActive(u)}>
                  {u.isActive ? 'Desactivar' : 'Activar'}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
