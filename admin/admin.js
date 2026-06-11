import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';

const cfg = window.TAPDUEL_ADMIN_CONFIG;
const app = initializeApp(cfg.firebaseConfig);
const auth = getAuth(app);
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => value ? new Date(value).toLocaleString() : '--';
let currentUser = null;

async function get(path) {
  if (!currentUser) throw new Error('Admin login required.');
  const token = await currentUser.getIdToken();
  const response = await fetch(`${cfg.API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.details || 'Admin request failed.');
  return data;
}
async function load() {
  if (!currentUser) return;
  $('raw').textContent = 'Loading…';
  try {
    const [stats, users, matches, leads] = await Promise.all([
      get('/api/admin/stats'), get('/api/admin/users?limit=20'), get('/api/admin/matches?limit=20'), get('/api/admin/leads?limit=20')
    ]);
    $('users').textContent = stats.users ?? 0;
    $('rooms').textContent = stats.activeRooms ?? 0;
    $('waiting').textContent = stats.waiting ?? 0;
    $('matches').textContent = stats.matches ?? 0;
    $('leads').textContent = stats.contactLeads ?? 0;
    $('firebase').textContent = stats.firebaseReady ? 'ON' : 'Memory';
    $('userList').innerHTML = (users.users || []).map(u => `<div class="row"><b>${esc(u.username)}</b><span>RP ${u.rankPoints || 0} • W ${u.wins || 0} / L ${u.losses || 0} • ${date(u.updatedAt)}</span></div>`).join('') || '<p>No users.</p>';
    $('matchList').innerHTML = (matches.matches || []).map(m => `<div class="row"><b>${esc(m.winner?.username || 'Winner')}</b><span>beat ${esc(m.loser?.username || 'Loser')} • ${m.winnerReaction ?? '--'} ms • ${esc(m.reason || '')} • ${date(m.createdAt)}</span></div>`).join('') || '<p>No matches.</p>';
    $('leadList').innerHTML = (leads.leads || []).map(l => `<div class="row"><b>${esc(l.name)} — ${esc(l.type)}</b><span>${esc(l.email)} • ${date(l.createdAt)}<br>${esc(l.message)}</span></div>`).join('') || '<p>No leads.</p>';
    $('raw').textContent = JSON.stringify(stats, null, 2);
  } catch (error) {
    $('raw').textContent = error.message;
  }
}

$('login').addEventListener('click', async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (error) {
    if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code)) $('raw').textContent = error.message;
  }
});
$('logout').addEventListener('click', () => signOut(auth));
$('refresh').addEventListener('click', load);

onAuthStateChanged(auth, user => {
  currentUser = user;
  $('loginPanel').hidden = Boolean(user);
  $('dashboard').hidden = !user;
  $('adminUser').textContent = user?.email || '';
  if (user) load();
});
