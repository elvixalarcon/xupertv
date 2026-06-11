const API = '/api';
let token = localStorage.getItem('vixtv_token') || localStorage.getItem('xupertv_token');
let currentUser = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { adminLogout(); throw new Error('Sesión expirada'); }
  if (res.status === 403) throw new Error('Acceso denegado — solo administradores');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

function toast(msg, isError) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.style.borderColor = isError ? '#e74c3c' : '#d4a017';
  t.style.color = isError ? '#e74c3c' : '#d4a017';
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

function showAdminScreen(id) {
  $$('.admin-screen').forEach((s) => s.classList.remove('active'));
  $(`#${id}`)?.classList.add('active');
}

function adminLogout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('vixtv_token');
  localStorage.removeItem('xupertv_token');
  showAdminScreen('admin-login-screen');
}

async function initAdminPortal() {
  if (!token) {
    showAdminScreen('admin-login-screen');
    return;
  }
  try {
    currentUser = await api('/auth/me');
    if (currentUser.role !== 'admin') {
      adminLogout();
      $('#admin-login-error').textContent = 'Esta área es solo para administradores';
      return;
    }
    $('#admin-user-name').textContent = currentUser.username;
    showAdminScreen('admin-app');
    AdminPanel.init();
    AdminPanel.load();
  } catch {
    adminLogout();
  }
}

$('#admin-login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#admin-login-user').value.trim();
  const password = $('#admin-login-pass').value;
  try {
    const data = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then((r) => r.json());
    if (data.error) throw new Error(data.error);
    if (data.user?.role !== 'admin') throw new Error('Usuario sin permisos de administrador');
    token = data.token;
    localStorage.setItem('vixtv_token', token);
    localStorage.removeItem('xupertv_token');
    await initAdminPortal();
  } catch (err) {
    $('#admin-login-error').textContent = err.message;
  }
});

$('#admin-logout-btn')?.addEventListener('click', adminLogout);

initAdminPortal();
