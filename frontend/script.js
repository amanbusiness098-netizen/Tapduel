const config = window.TAPDUEL_CONFIG;
const $ = (id) => document.getElementById(id);

const els = {
  loginBtn: $('loginBtn'), usernameInput: $('usernameInput'), saveNameBtn: $('saveNameBtn'),
  quickBtn: $('quickBtn'), soloBtn: $('soloBtn'), cancelBtn: $('cancelBtn'), playAgainBtn: $('playAgainBtn'), shareScoreBtn: $('shareScoreBtn'),
  createRoomBtn: $('createRoomBtn'), joinRoomBtn: $('joinRoomBtn'), roomCodeInput: $('roomCodeInput'), privateCode: $('privateCode'),
  statusText: $('statusText'), resultBox: $('resultBox'), tapBtn: $('tapBtn'), arena: $('arena'), opponentText: $('opponentText'), reactionText: $('reactionText'),
  profileBox: $('profileBox'), leaderboardBody: $('leaderboardBody'), refreshLeaderboard: $('refreshLeaderboard'), refreshMatches: $('refreshMatches'), latestMatches: $('latestMatches'),
  shopGrid: $('shopGrid'), heroBest: $('heroBest'), contactForm: $('contactForm'), contactResult: $('contactResult'), soundToggle: $('soundToggle'), shareBtn: $('shareBtn'),
  onlineCount: $('onlineCount'), searchingCount: $('searchingCount'), toastContainer: $('toastContainer')
};

let socket = null;
let me = null;
let profile = null;
let currentRoomId = null;
let currentMatchId = null;
let gameState = 'idle';
let multiplayerSignalAt = 0;
let soloSignalAt = 0;
let lastSoloReaction = null;
let soloTimer = null;
let matchmakingFallbackTimer = null;
let booted = false;
let loginBusy = false;
let authHandling = false;
let soundOn = localStorage.getItem('tapduel_sound') !== 'off';
let lastMode = 'solo';

const STATES = new Set(['idle', 'searching', 'matched', 'countdown', 'waiting_signal', 'active', 'finished', 'solo_waiting', 'solo_active', 'disconnected']);

function setGameState(next) {
  gameState = STATES.has(next) ? next : 'idle';
  const searching = gameState === 'searching';
  const inMultiplayer = ['matched', 'countdown', 'waiting_signal', 'active'].includes(gameState);
  const inSolo = ['solo_waiting', 'solo_active'].includes(gameState);
  els.quickBtn.disabled = searching || inMultiplayer || inSolo;
  els.soloBtn.disabled = inMultiplayer || inSolo;
  els.createRoomBtn.disabled = searching || inMultiplayer || inSolo;
  els.joinRoomBtn.disabled = searching || inMultiplayer || inSolo;
  els.cancelBtn.disabled = !searching && !inMultiplayer && !inSolo;
  els.cancelBtn.textContent = gameState === 'active' ? 'Forfeit' : 'Cancel';
}
function setStatus(text) { els.statusText.textContent = text; }
function setResult(text = '', type = 'info') {
  els.resultBox.textContent = text;
  els.resultBox.className = `result-box ${type}`;
  els.resultBox.hidden = !text;
}
function showToast(message, type = 'info', duration = 3500) {
  if (!message) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  els.toastContainer?.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 250);
  }, duration);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function fmtMs(value) { return value === null || value === undefined || value === '' ? '--' : `${Math.round(Number(value))} ms`; }
function clearTimer(name) {
  if (name === 'solo' && soloTimer) { clearTimeout(soloTimer); soloTimer = null; }
  if (name === 'fallback' && matchmakingFallbackTimer) { clearTimeout(matchmakingFallbackTimer); matchmakingFallbackTimer = null; }
}
function resetArena({ keepResult = false } = {}) {
  clearTimer('solo'); clearTimer('fallback');
  currentRoomId = null; currentMatchId = null; multiplayerSignalAt = 0; soloSignalAt = 0;
  els.tapBtn.disabled = true;
  els.tapBtn.textContent = 'TAP';
  els.reactionText.textContent = 'Reaction: --';
  els.opponentText.textContent = 'Opponent: --';
  els.arena.classList.remove('live');
  els.soloBtn.textContent = 'Solo Challenge';
  els.soloBtn.classList.remove('pulse');
  els.shareScoreBtn.hidden = true;
  els.playAgainBtn.hidden = true;
  if (!keepResult) setResult('');
  setGameState('idle');
}
function requireLogin() {
  if (me) return true;
  setStatus('Login with Google to play.');
  showToast('Please login first.', 'warning');
  return false;
}
function updateSoundButton() { els.soundToggle.textContent = `Sound: ${soundOn ? 'On' : 'Off'}`; }
function playTone(kind = 'click') {
  if (!soundOn) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = kind === 'win' ? 740 : kind === 'lose' ? 220 : kind === 'start' ? 560 : 420;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.18);
    setTimeout(() => context.close(), 260);
  } catch (_) { /* autoplay/audio failures are non-fatal */ }
}

async function api(path, options = {}) {
  const token = await window.TapDuelAuth.getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 15000);
  try {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${config.API_BASE}${path}`, { ...options, headers, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.details || data.error || 'Request failed.');
      error.code = data.code || `HTTP_${response.status}`;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Server took too long. It may be waking up—try again in a moment.');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function login() {
  if (loginBusy) return;
  loginBusy = true;
  els.loginBtn.disabled = true;
  try {
    setStatus('Opening Google login…');
    const user = await window.TapDuelAuth.login();
    if (user) await handleAuthUser(user);
  } catch (error) {
    const silentCodes = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'];
    if (silentCodes.includes(error?.code)) {
      setStatus('Login cancelled. Try again whenever you are ready.');
      showToast('Login cancelled.', 'info');
    } else {
      setStatus('Login failed.');
      showToast(error.message || 'Login failed.', 'error', 5000);
    }
  } finally {
    loginBusy = false;
    els.loginBtn.disabled = false;
  }
}

async function ensureSocket() {
  if (!me) return false;
  if (socket?.connected) return true;
  if (typeof window.io !== 'function') {
    showToast('Realtime game library did not load. Refresh the page.', 'error');
    return false;
  }
  const token = await window.TapDuelAuth.getToken();
  if (!token) return false;
  if (socket) { socket.removeAllListeners(); socket.disconnect(); }
  socket = window.io(config.SOCKET_URL, {
    transports: ['websocket', 'polling'],
    auth: { token, username: localStorage.getItem('tapduel_username') || profile?.username || me.displayName || 'Player' },
    reconnection: true,
    reconnectionAttempts: 8,
    reconnectionDelay: 1000,
    timeout: 15000
  });
  registerSocketHandlers();
  return new Promise(resolve => {
    if (socket.connected) return resolve(true);
    const timer = setTimeout(() => resolve(false), 15000);
    socket.once('connect', () => { clearTimeout(timer); resolve(true); });
    socket.once('connect_error', () => { clearTimeout(timer); resolve(false); });
  });
}
function socketAck(event, payload = {}, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) return reject(new Error('Realtime connection is offline.'));
    const timer = setTimeout(() => reject(new Error('Server did not respond.')), timeout);
    socket.emit(event, payload, response => {
      clearTimeout(timer);
      if (response?.ok === false) reject(new Error(response.error || 'Action failed.'));
      else resolve(response || { ok: true });
    });
  });
}

function registerSocketHandlers() {
  socket.on('connect', () => {
    if (gameState === 'disconnected') setGameState('idle');
    setStatus('Connected. Start a match.');
  });
  socket.on('disconnect', reason => {
    if (['matched', 'countdown', 'waiting_signal', 'active'].includes(gameState)) {
      setGameState('disconnected');
      setStatus('Connection lost. Reconnecting…');
      showToast('Connection lost. Reconnecting…', 'warning');
    }
  });
  socket.on('connect_error', error => {
    setStatus('Server is unavailable or waking up.');
    showToast(error.message || 'Connection failed.', 'error');
  });
  socket.on('onlineCount', ({ online, searching }) => {
    if (els.onlineCount) els.onlineCount.textContent = String(online ?? 0);
    if (els.searchingCount) els.searchingCount.textContent = String(searching ?? 0);
  });
  socket.on('status', message => setStatus(message));
  socket.on('errorMessage', message => showToast(message, 'error'));
  socket.on('privateRoomCreated', ({ code }) => {
    els.privateCode.textContent = `Room code: ${code}`;
    setStatus('Private room ready. Share the code with a friend.');
    showToast(`Private room ${code} created.`, 'success');
  });
  socket.on('matchFound', ({ roomId, players }) => {
    if (['solo_waiting', 'solo_active'].includes(gameState)) return;
    clearTimer('fallback');
    currentRoomId = roomId;
    currentMatchId = roomId;
    const opponent = players.find(player => player.uid !== profile?.uid) || players[0];
    els.opponentText.textContent = `Opponent: ${opponent?.username || 'Player'}`;
    els.tapBtn.disabled = true;
    setGameState('matched');
    setStatus('Match found. Get ready.');
    setResult('Match found. Watch the countdown.', 'info');
  });
  socket.on('countdown', number => {
    if (['solo_waiting', 'solo_active'].includes(gameState)) return;
    setGameState('countdown');
    els.tapBtn.disabled = false; // early taps are intentionally allowed and lose the match
    els.tapBtn.textContent = String(number);
    setStatus(`Starting in ${number}… Do not tap early.`);
    playTone('click');
  });
  socket.on('waitSignal', () => {
    if (['solo_waiting', 'solo_active'].includes(gameState)) return;
    setGameState('waiting_signal');
    els.tapBtn.disabled = false;
    els.tapBtn.textContent = 'WAIT';
    setStatus('Wait for TAP NOW!');
  });
  socket.on('tapNow', ({ matchId }) => {
    if (['solo_waiting', 'solo_active'].includes(gameState)) return;
    currentMatchId = matchId || currentRoomId;
    multiplayerSignalAt = performance.now();
    setGameState('active');
    els.tapBtn.disabled = false;
    els.tapBtn.textContent = 'TAP NOW!';
    els.arena.classList.add('live');
    setStatus('TAP NOW!');
    setResult('TAP NOW!', 'success');
    playTone('start');
  });
  socket.on('tapRegistered', ({ reaction, clientReaction }) => {
    els.reactionText.textContent = `Reaction: ${fmtMs(clientReaction ?? reaction)}`;
    els.tapBtn.disabled = true;
    els.tapBtn.textContent = 'Waiting…';
  });
  socket.on('matchCancelled', ({ message }) => {
    resetArena();
    setStatus(message || 'Match cancelled.');
    setResult(message || 'Match cancelled.', 'warning');
    showToast(message || 'Match cancelled.', 'warning');
  });
  socket.on('gameResult', async ({ winner, winnerReaction, reason }) => {
    const didWin = winner?.uid === profile?.uid;
    const readableReason = ({ early_tap: 'early tap', timeout: 'opponent timeout', disconnect: 'opponent disconnected', forfeit: 'forfeit', reaction: 'reaction speed' })[reason] || reason;
    setGameState('finished');
    els.tapBtn.disabled = true;
    els.tapBtn.textContent = 'TAP';
    els.arena.classList.remove('live');
    setStatus('Match finished. Ready for another duel.');
    setResult(`${didWin ? '🏆 You won!' : 'You lost.'} Reason: ${readableReason}. Winner reaction: ${fmtMs(winnerReaction)}`, didWin ? 'success' : 'danger');
    currentRoomId = null;
    currentMatchId = null;
    

    els.opponentText.textContent = 'Opponent: --';
    els.reactionText.textContent = 'Reaction: --';


    els.playAgainBtn.hidden = false;
    lastMode = 'quick';
    playTone(didWin ? 'win' : 'lose');

    await Promise.allSettled([loadMe(), loadLeaderboard(), loadLatestMatches()]);
  });
}

async function cancelCurrentAction() {
  clearTimer('fallback'); clearTimer('solo');
  if (['solo_waiting', 'solo_active'].includes(gameState)) {
    resetArena();
    setStatus('Solo challenge cancelled.');
    return;
  }
  try {
    if (socket?.connected) await socketAck('cancelMatch', {});
  } catch (error) { showToast(error.message, 'warning'); }
  if (gameState !== 'active') {
    resetArena();
    setStatus('Matchmaking cancelled.');
  } else setStatus('Forfeit submitted.');
}
async function startQuickMatch() {
  if (!requireLogin()) return;
  const connected = await ensureSocket();
  if (!connected) return showToast('Could not connect to the game server. Try again shortly.', 'error');
  resetArena();
  setGameState('searching');
  setStatus('Searching for opponent…');
  setResult('Looking for another online player.', 'info');
  try {
    await socketAck('quickMatch', {});
    clearTimer('fallback');
    matchmakingFallbackTimer = setTimeout(() => {
      if (gameState !== 'searching') return;
      setStatus('No opponent found yet. You can keep waiting or play Solo.');
      setResult('Nobody is available right now. Solo Challenge works anytime.', 'info');
      els.soloBtn.textContent = 'Play Solo Now';
      els.soloBtn.classList.add('pulse');
    }, 12000);
  } catch (error) {
    resetArena();
    showToast(error.message, 'error');
  }
}
async function startSoloChallenge() {
  if (!requireLogin()) return;
  clearTimer('fallback');
  if (socket?.connected) {
    try { await socketAck('cancelMatch', {}); } catch (_) { /* queue may already be empty */ }
  }
  resetArena();
  lastMode = 'solo';
  setGameState('solo_waiting');
  setStatus('Solo Challenge starting…');
  setResult('Wait for the signal. Tapping early ends the attempt.', 'info');
  els.opponentText.textContent = 'Mode: Solo Challenge';
  els.reactionText.textContent = 'Reaction: --';
  els.tapBtn.disabled = false;
  els.tapBtn.textContent = 'WAIT';
  const delay = 1500 + Math.floor(Math.random() * 2500);
  soloTimer = setTimeout(() => {
    if (gameState !== 'solo_waiting') return;
    soloSignalAt = performance.now();
    setGameState('solo_active');
    els.tapBtn.disabled = false;
    els.tapBtn.textContent = 'TAP NOW!';
    els.arena.classList.add('live');
    setStatus('TAP NOW!');
    playTone('start');
  }, delay);
}
async function handleTap() {
  if (gameState === 'solo_waiting') {
    clearTimer('solo');
    setGameState('finished');
    els.tapBtn.disabled = true;
    els.tapBtn.textContent = 'WAIT';
    setStatus('Too early. Start a new Solo Challenge.');
    setResult('Too early! Wait until the button says TAP NOW.', 'danger');
    els.playAgainBtn.hidden = false;
    playTone('lose');
    return;
  }
  if (gameState === 'solo_active') {
    const reaction = Math.round(performance.now() - soloSignalAt);
    lastSoloReaction = reaction;
    setGameState('finished');
    els.tapBtn.disabled = true;
    els.tapBtn.textContent = 'WAIT';
    els.arena.classList.remove('live');
    els.reactionText.textContent = `Reaction: ${reaction} ms`;
    let rewardText = '';
    try {
      const data = await api('/api/solo/result', { method: 'POST', body: JSON.stringify({ reaction }) });
      profile = data.user;
      rewardText = data.rewardCoins ? ` +${data.rewardCoins} coins.` : ' Daily coin limit reached.';
      renderProfile();
    } catch (error) { rewardText = ' Score was not saved.'; }
    setStatus('Solo challenge finished.');
    setResult(`⚡ ${reaction} ms.${rewardText} Can your friend beat it?`, 'success');
    els.shareScoreBtn.hidden = false;
    els.playAgainBtn.hidden = false;
    playTone('win');
    return;
  }
  if (!['countdown', 'waiting_signal', 'active'].includes(gameState) || !currentRoomId || !socket?.connected) return;
  const clientReaction = gameState === 'active' ? Math.round(performance.now() - multiplayerSignalAt) : null;
  els.tapBtn.disabled = true;
  try {
    await socketAck('tap', { roomId: currentRoomId, matchId: currentMatchId || currentRoomId, clientTapAt: Date.now(), clientReaction });
  } catch (error) {
    els.tapBtn.disabled = false;
    showToast(error.message, 'warning');
  }
}

function renderProfile() {
  if (!profile) {
    els.profileBox.innerHTML = `<p>${me ? 'Loading profile…' : 'Login to load your profile.'}</p>`;
    els.heroBest.textContent = '-- ms';
    return;
  }
  els.usernameInput.value = profile.username || '';
  localStorage.setItem('tapduel_username', profile.username || '');
  els.arena.className = `arena ${profile.activeSkin || 'classic'}`;
  els.heroBest.textContent = fmtMs(profile.bestReaction ?? profile.bestSoloReaction);
  els.profileBox.innerHTML = `
    <div class="profile-name">${escapeHtml(profile.username || 'Player')}</div>
    <div class="profile-stats">
      <span>Rank <b>${escapeHtml(profile.rank || 'Bronze')}</b></span>
      <span>RP <b>${Number(profile.rankPoints || 0)}</b></span>
      <span>Wins <b>${Number(profile.wins || 0)}</b></span>
      <span>Losses <b>${Number(profile.losses || 0)}</b></span>
      <span>Coins <b>${Number(profile.coins || 0)}</b></span>
      <span>Best PvP <b>${fmtMs(profile.bestReaction)}</b></span>
      <span>Best Solo <b>${fmtMs(profile.bestSoloReaction)}</b></span>
      <span>Solo Runs <b>${Number(profile.soloAttempts || 0)}</b></span>
    </div>`;
}
async function loadMe() {
  if (!me) { profile = null; renderProfile(); return; }
  const data = await api('/api/me');
  profile = data.user;
  renderProfile();
}
async function saveProfile() {
  if (!requireLogin()) return;
  const username = els.usernameInput.value.trim();
  try {
    const data = await api('/api/me', { method: 'POST', body: JSON.stringify({ username }) });
    profile = data.user;
    localStorage.setItem('tapduel_username', profile.username);
    renderProfile();
    if (socket?.connected) await socketAck('updateProfile', { username: profile.username, activeSkin: profile.activeSkin });
    showToast('Profile saved.', 'success');
  } catch (error) { showToast(error.message, 'error'); }
}
async function loadLeaderboard() {
  try {
    const data = await api('/api/leaderboard?limit=50');
    const users = data.users || [];
    els.leaderboardBody.innerHTML = users.map((user, index) => `
      <tr><td>${index + 1}</td><td>${escapeHtml(user.username || 'Player')}</td><td>${Number(user.rankPoints || 0)}</td><td>${Number(user.wins || 0)}</td><td>${fmtMs(user.bestReaction ?? user.bestSoloReaction)}</td></tr>`).join('') || '<tr><td colspan="5">No leaderboard data yet.</td></tr>';
  } catch (error) { els.leaderboardBody.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`; }
}
async function loadLatestMatches() {
  try {
    const data = await api('/api/matches/latest?limit=12');
    els.latestMatches.innerHTML = (data.matches || []).map(match => `
      <div class="match-card"><b>${escapeHtml(match.winner?.username || 'Winner')}</b> beat ${escapeHtml(match.loser?.username || 'Loser')}<span> • ${fmtMs(match.winnerReaction)} • ${escapeHtml(match.reason || 'reaction')}</span><small>${new Date(match.createdAt).toLocaleString()}</small></div>`).join('') || 'No matches yet.';
  } catch (error) { els.latestMatches.textContent = error.message; }
}
async function loadShop() {
  try {
    const data = await api('/api/shop');
    const paymentsEnabled = Boolean(data.paymentsEnabled);
    els.shopGrid.innerHTML = (data.items || []).map(item => {
      const owned = profile?.inventory?.includes(item.id);
      const equipped = profile?.activeSkin === item.id;
      let button;
      if (owned) button = `<button class="btn small" data-equip="${item.id}" ${equipped ? 'disabled' : ''}>${equipped ? 'Equipped' : 'Equip'}</button>`;
      else if (Number(item.coins || item.priceCoins) > 0) button = `<button class="btn small" data-buy="${item.id}">Unlock ${Number(item.coins || item.priceCoins)} coins</button>`;
      else if (paymentsEnabled && Number(item.priceInr) > 0) button = `<button class="btn small" data-buy="${item.id}">Buy ₹${Number(item.priceInr)}</button>`;
      else button = '<button class="btn small" disabled>Coming Soon</button>';
      return `<div class="shop-item"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.type)}</p>${button}</div>`;
    }).join('');
  } catch (error) { els.shopGrid.innerHTML = `<p>${escapeHtml(error.message)}</p>`; }
}
async function buyItem(itemId) {
  if (!requireLogin()) return;
  const button = document.querySelector(`[data-buy="${CSS.escape(itemId)}"]`);
  if (button) button.disabled = true;
  try {
    const data = await api('/api/shop/buy-coins', { method: 'POST', body: JSON.stringify({ itemId }) });
    profile = data.user;
    renderProfile();
    await loadShop();
    showToast(`${data.unlocked.name} unlocked.`, 'success');
  } catch (error) {
    showToast(error.message, error.code === 'NOT_ENOUGH_COINS' ? 'warning' : 'error', 4500);
  } finally { if (button?.isConnected) button.disabled = false; }
}
async function equipItem(itemId) {
  if (!requireLogin()) return;
  try {
    const data = await api('/api/me', { method: 'POST', body: JSON.stringify({ activeSkin: itemId }) });
    profile = data.user;
    renderProfile();
    await loadShop();
    if (socket?.connected) await socketAck('updateProfile', { username: profile.username, activeSkin: itemId });
    showToast('Skin equipped.', 'success');
  } catch (error) { showToast(error.message, 'error'); }
}
async function shareGame() {
  const url = `${location.origin}${location.pathname}`;
  const text = 'Play TapDuel — Solo Challenge, quick matches and private rooms.';
  try {
    if (navigator.share) await navigator.share({ title: 'TapDuel', text, url });
    else { await navigator.clipboard.writeText(`${text}\n${url}`); showToast('Game link copied.', 'success'); }
  } catch (_) { /* share cancelled */ }
}
async function shareScore() {
  const score = lastSoloReaction || profile?.bestSoloReaction || profile?.bestReaction;
  if (!score) return showToast('Complete a challenge first.', 'warning');
  const url = `${location.origin}${location.pathname}`;
  const text = `I got ${score}ms on TapDuel ⚡ Can you beat me?`;
  try {
    if (navigator.share) await navigator.share({ title: 'TapDuel Challenge', text, url });
    else { await navigator.clipboard.writeText(`${text}\n${url}`); showToast('Challenge copied.', 'success'); }
  } catch (_) { /* share cancelled */ }
}

async function handleAuthUser(user) {
  if (authHandling) return;
  authHandling = true;
  try {
    me = user || null;
    els.loginBtn.textContent = me ? 'Logout' : 'Login';
    if (!me) {
      if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
      profile = null; resetArena(); renderProfile();
      await Promise.allSettled([loadLeaderboard(), loadLatestMatches(), loadShop()]);
      setStatus('Login with Google, enter username, then start.');
      return;
    }
    setStatus('Loading your profile…');
    await Promise.all([loadMe(), ensureSocket()]);
    await Promise.allSettled([loadLeaderboard(), loadLatestMatches(), loadShop()]);
    setStatus('Connected. Start a match or play Solo.');
  } catch (error) {
    showToast(error.message || 'Could not load your account.', 'error');
  } finally { authHandling = false; }
}
window.addEventListener('tapduel-auth-changed', event => handleAuthUser(event.detail.user || null));

els.loginBtn.addEventListener('click', async () => {
  els.loginBtn.disabled = true;
  try {
    if (me) {
      await window.TapDuelAuth.logout();
    } else {
      await login();
    }
  } catch (error) {
    if (error.code !== 'auth/popup-closed-by-user') {
      showToast(error.message || 'Login failed.', 'error');
    }
  } finally {
    els.loginBtn.disabled = false;
  }
});
els.saveNameBtn.addEventListener('click', saveProfile);
els.quickBtn.addEventListener('click', startQuickMatch);
els.soloBtn.addEventListener('click', startSoloChallenge);
els.cancelBtn.addEventListener('click', cancelCurrentAction);
els.playAgainBtn.addEventListener('click', () => lastMode === 'solo' ? startSoloChallenge() : startQuickMatch());
els.shareScoreBtn.addEventListener('click', shareScore);
els.createRoomBtn.addEventListener('click', async () => {
  if (!requireLogin()) return;
  if (!(await ensureSocket())) return showToast('Game server unavailable.', 'error');
  try { resetArena(); await socketAck('createPrivateRoom', {}); } catch (error) { showToast(error.message, 'error'); }
});
els.joinRoomBtn.addEventListener('click', async () => {
  if (!requireLogin()) return;
  const code = els.roomCodeInput.value.trim();
  if (!code) return showToast('Enter a room code.', 'warning');
  if (!(await ensureSocket())) return showToast('Game server unavailable.', 'error');
  try { resetArena(); setStatus('Joining private room…'); await socketAck('joinPrivateRoom', { code }); } catch (error) { showToast(error.message, 'error'); }
});
els.tapBtn.addEventListener('pointerdown', event => { event.preventDefault(); handleTap(); }, { passive: false });
els.refreshLeaderboard.addEventListener('click', loadLeaderboard);
els.refreshMatches.addEventListener('click', loadLatestMatches);
els.soundToggle.addEventListener('click', () => { soundOn = !soundOn; localStorage.setItem('tapduel_sound', soundOn ? 'on' : 'off'); updateSoundButton(); if (soundOn) playTone('click'); });
els.shareBtn.addEventListener('click', shareGame);
els.shopGrid.addEventListener('click', event => {
  const buy = event.target.closest('[data-buy]')?.dataset.buy;
  const equip = event.target.closest('[data-equip]')?.dataset.equip;
  if (buy) buyItem(buy);
  if (equip) equipItem(equip);
});
els.contactForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  const body = Object.fromEntries(new FormData(event.target).entries());
  try {
    const response = await fetch(`${config.API_BASE}/api/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not send your message.');
    els.contactResult.textContent = 'Thanks — your message was received.';
    event.target.reset();
    showToast('Sponsor message sent.', 'success');
  } catch (error) {
    els.contactResult.textContent = error.message;
    showToast(error.message, 'error');
  } finally { if (button) button.disabled = false; }
});

window.addEventListener('unhandledrejection', event => console.error('Unhandled promise:', event.reason));
window.addEventListener('error', event => console.error('Client error:', event.error || event.message));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && ['solo_active', 'active'].includes(gameState)) showToast('Keep TapDuel visible for a fair reaction result.', 'warning');
});

(async function boot() {
  if (booted) return;
  booted = true;
  updateSoundButton();
  resetArena();
  renderProfile();
  setStatus('Loading TapDuel…');
  const user = await window.TapDuelAuth.init();
  await handleAuthUser(user);
})();
