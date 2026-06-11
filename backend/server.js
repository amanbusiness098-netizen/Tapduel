'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const VERIFY_AUTH = String(process.env.VERIFY_AUTH || 'false').toLowerCase() === 'true';
const PAYMENTS_ENABLED = String(process.env.PAYMENTS_ENABLED || 'false').toLowerCase() === 'true';
const APP_VERSION = process.env.APP_VERSION || '2.0.0';
const ADMIN_EMAILS = new Set(String(process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean));
const ADMIN_UIDS = new Set(String(process.env.ADMIN_UIDS || '').split(',').map(v => v.trim()).filter(Boolean));
const ALLOW_LOCAL_ADMIN = String(process.env.ALLOW_LOCAL_ADMIN || 'false').toLowerCase() === 'true';

const configuredOrigins = String(process.env.FRONTEND_URL || '')
  .split(',')
  .map(v => v.trim().replace(/\/$/, ''))
  .filter(Boolean);
const localOrigins = ['http://localhost:5500', 'http://localhost:5501', 'http://127.0.0.1:5500', 'http://127.0.0.1:5501'];
const allowedOrigins = new Set([...configuredOrigins, ...(NODE_ENV !== 'production' ? localOrigins : [])]);

function corsOrigin(origin, callback) {
  if (!origin || allowedOrigins.has(origin.replace(/\/$/, '')) || configuredOrigins.includes('*')) return callback(null, true);
  return callback(new Error('Origin not allowed by TapDuel CORS'));
}

const app = express();
const server = http.createServer(app);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(morgan('tiny'));
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '250kb' }));

const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true },
  pingTimeout: 25000,
  pingInterval: 10000,
  maxHttpBufferSize: 100000
});

// ---------- Firebase ----------
let admin = null;
let db = null;
let firebaseReady = false;

function loadServiceAccount(value) {
  if (!value) return null;
  const fs = require('fs');
  const path = require('path');
  const raw = String(value).trim();
  if (raw.startsWith('{')) return JSON.parse(raw);
  const fullPath = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  if (!fs.existsSync(fullPath)) throw new Error(`Firebase service account file not found: ${fullPath}`);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

try {
  admin = require('firebase-admin');
  if (!admin.apps.length) {
    const serviceAccount = loadServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (serviceAccount) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  if (admin.apps.length) {
    db = admin.firestore();
    firebaseReady = true;
    console.log('✅ Firebase Admin connected');
  } else console.log('⚠️ Firebase Admin not configured. Using in-memory development store.');
} catch (error) {
  console.error('⚠️ Firebase Admin unavailable:', error.message);
}

const memory = {
  users: new Map(),
  payments: new Map(),
  contactLeads: new Map(),
  matches: [],
  suspicious: []
};

const DEFAULT_USER = (uid, username = 'Player') => ({
  uid,
  username,
  avatar: '',
  coins: 100,
  premium: false,
  inventory: ['classic'],
  activeSkin: 'classic',
  wins: 0,
  losses: 0,
  bestReaction: null,
  bestSoloReaction: null,
  soloAttempts: 0,
  soloRewardDate: '',
  soloRewardedAttempts: 0,
  rankPoints: 1000,
  rank: 'Bronze',
  matchesPlayed: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastActiveAt: Date.now()
});

const SHOP = [
  { id: 'neon', name: 'Neon Tap', type: 'skin', coins: 300, priceCoins: 300 },
  { id: 'fire', name: 'Fire Tap', type: 'skin', coins: 700, priceCoins: 700 },
  { id: 'gold', name: 'Gold Tap', type: 'skin', coins: 0, priceInr: 49 },
  { id: 'shadow', name: 'Shadow Tap', type: 'skin', coins: 0, priceInr: 99 },
  { id: 'premium_pass', name: 'TapDuel Premium Pass', type: 'pass', coins: 0, priceInr: 149 }
];

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function calcRank(points) {
  if (points >= 1600) return 'Platinum';
  if (points >= 1300) return 'Gold';
  if (points >= 1100) return 'Silver';
  return 'Bronze';
}
function sanitizeUsername(name, fallback = 'Player') {
  const cleaned = String(name || '')
    .replace(/[<>`{}]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 20);
  return cleaned || fallback;
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function safeSecretEqual(expected, provided) {
  const a = Buffer.from(String(expected || ''));
  const b = Buffer.from(String(provided || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

async function getUser(uid) {
  if (!uid) return null;
  if (firebaseReady) {
    const snap = await db.collection('users').doc(uid).get();
    return snap.exists ? snap.data() : null;
  }
  return memory.users.get(uid) || null;
}
async function upsertUser(uid, data = {}) {
  const existing = (await getUser(uid)) || DEFAULT_USER(uid, data.username || 'Player');
  const user = { ...existing, ...data, uid, updatedAt: Date.now(), lastActiveAt: Date.now() };
  if (firebaseReady) await db.collection('users').doc(uid).set(user, { merge: true });
  else memory.users.set(uid, user);
  return user;
}
async function updateUserAfterMatch(player, won, reaction) {
  if (!player?.uid) return null;
  const old = (await getUser(player.uid)) || DEFAULT_USER(player.uid, player.username || 'Player');
  const validReaction = Number.isFinite(Number(reaction)) && Number(reaction) >= 80 && Number(reaction) <= 10000;
  const best = validReaction ? (old.bestReaction == null ? Number(reaction) : Math.min(Number(old.bestReaction), Number(reaction))) : old.bestReaction;
  const rp = Math.max(0, safeNumber(old.rankPoints, 1000) + (won ? 18 : -8));
  return upsertUser(player.uid, {
    username: sanitizeUsername(player.username || old.username),
    activeSkin: player.skin || old.activeSkin || 'classic',
    wins: safeNumber(old.wins) + (won ? 1 : 0),
    losses: safeNumber(old.losses) + (won ? 0 : 1),
    matchesPlayed: safeNumber(old.matchesPlayed) + 1,
    coins: safeNumber(old.coins, 100) + (won ? 10 : 2),
    rankPoints: rp,
    rank: calcRank(rp),
    bestReaction: best,
    fastestReaction: best,
    lastReaction: validReaction ? Number(reaction) : old.lastReaction || null
  });
}
async function recordPayment(payment) {
  const id = payment.id || uuidv4();
  const data = { ...payment, id, createdAt: payment.createdAt || Date.now(), updatedAt: Date.now() };
  if (firebaseReady) await db.collection('payments').doc(id).set(data, { merge: true });
  else memory.payments.set(id, data);
  return data;
}
async function recordMatch(match) {
  memory.matches.push(match);
  if (memory.matches.length > 500) memory.matches.shift();
  if (firebaseReady) await db.collection('matches').doc(match.id).set(match, { merge: true });
}
function isRealUserForLeaderboard(user) {
  const uid = String(user?.uid || '').toLowerCase();
  const username = String(user?.username || '').toLowerCase();
  return Boolean(uid) && !uid.startsWith('demo_') && !uid.startsWith('guest_') && !username.includes('demo user') && username !== 'guest';
}
async function getLeaderboard(limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  if (firebaseReady) {
    const snap = await db.collection('users').orderBy('rankPoints', 'desc').limit(Math.max(safeLimit * 3, 50)).get();
    return snap.docs.map(doc => ({ uid: doc.id, ...doc.data() })).filter(isRealUserForLeaderboard).slice(0, safeLimit).map((u, i) => ({ rank: i + 1, ...u }));
  }
  return [...memory.users.values()].filter(isRealUserForLeaderboard).sort((a, b) => safeNumber(b.rankPoints) - safeNumber(a.rankPoints)).slice(0, safeLimit).map((u, i) => ({ rank: i + 1, ...u }));
}

async function verifyFirebaseToken(idToken) {
  if (!idToken) throw new Error('Missing login token');
  if (idToken.startsWith('demo:')) {
    if (VERIFY_AUTH) throw new Error('Demo tokens disabled');
    const uid = idToken.replace('demo:', '').slice(0, 64);
    return { uid, email: '', name: 'Demo Player' };
  }
  if (firebaseReady && admin?.auth) {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email || '', name: decoded.name || decoded.email || 'Player' };
  }
  if (!VERIFY_AUTH) {
    const hash = crypto.createHash('sha1').update(idToken).digest('hex').slice(0, 16);
    return { uid: `local_${hash}`, email: '', name: 'Local Player' };
  }
  throw new Error('Firebase Admin is unavailable, so login cannot be verified.');
}
async function ensureUserFromAuth(decoded, preferredName = '') {
  const existing = await getUser(decoded.uid);
  const username = existing?.username || sanitizeUsername(preferredName || decoded.name || decoded.email || 'Player');
  return upsertUser(decoded.uid, { username, email: decoded.email || existing?.email || '' });
}
async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    req.user = await verifyFirebaseToken(token);
    await ensureUserFromAuth(req.user);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Login required', code: 'AUTH_REQUIRED', details: error.message });
  }
}
function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    const localAllowed = NODE_ENV !== 'production' && ALLOW_LOCAL_ADMIN;
    const allowed = localAllowed || ADMIN_UIDS.has(req.user.uid) || ADMIN_EMAILS.has(String(req.user.email || '').toLowerCase());
    if (!allowed) return res.status(403).json({ error: 'Admin access denied', code: 'ADMIN_DENIED' });
    next();
  });
}

// Small in-memory rate limiter. Replace with Redis for multi-instance production.
const rateBuckets = new Map();
function rateLimit(name, limit, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > limit) return res.status(429).json({ error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' });
    next();
  };
}

// ---------- REST ----------
app.get('/', (req, res) => res.json({ ok: true, name: 'TapDuel Backend', version: APP_VERSION, firebaseReady, verifyAuth: VERIFY_AUTH, paymentsEnabled: PAYMENTS_ENABLED }));
app.get('/health', (req, res) => res.json({ ok: true, version: APP_VERSION, time: Date.now(), firebaseReady }));
app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));
app.get('/api/shop', (req, res) => res.json({ items: SHOP, paymentsEnabled: PAYMENTS_ENABLED }));
app.get('/api/leaderboard', async (req, res, next) => { try { res.json({ users: await getLeaderboard(req.query.limit) }); } catch (e) { next(e); } });
app.get('/api/matches/latest', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    if (firebaseReady) {
      const snap = await db.collection('matches').orderBy('createdAt', 'desc').limit(limit).get();
      return res.json({ matches: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    }
    res.json({ matches: memory.matches.slice(-limit).reverse() });
  } catch (e) { next(e); }
});
app.get('/api/me', authMiddleware, async (req, res, next) => { try { res.json({ user: (await getUser(req.user.uid)) || (await ensureUserFromAuth(req.user)) }); } catch (e) { next(e); } });
app.post('/api/me', authMiddleware, rateLimit('profile', 30, 60000), async (req, res, next) => {
  try {
    const existing = await getUser(req.user.uid);
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'username')) {
      const username = sanitizeUsername(req.body.username, '');
      if (!username || username.length < 2) return res.status(400).json({ error: 'Username must be 2–20 characters.', code: 'INVALID_USERNAME' });
      patch.username = username;
    }
    if (req.body.activeSkin) {
      const skin = String(req.body.activeSkin);
      if (!existing?.inventory?.includes(skin)) return res.status(400).json({ error: 'You do not own this skin.', code: 'SKIN_NOT_OWNED' });
      patch.activeSkin = skin;
    }
    res.json({ user: await upsertUser(req.user.uid, patch) });
  } catch (e) { next(e); }
});
app.post('/api/solo/result', authMiddleware, rateLimit('solo', 30, 60000), async (req, res, next) => {
  try {
    const reaction = Math.round(Number(req.body.reaction));
    if (!Number.isFinite(reaction) || reaction < 80 || reaction > 5000) {
      memory.suspicious.push({ uid: req.user.uid, reaction, type: 'solo', at: Date.now() });
      return res.status(400).json({ error: 'Invalid reaction result.', code: 'INVALID_REACTION' });
    }
    const old = (await getUser(req.user.uid)) || DEFAULT_USER(req.user.uid);
    const day = todayKey();
    const rewardedToday = old.soloRewardDate === day ? safeNumber(old.soloRewardedAttempts) : 0;
    const rewardCoins = rewardedToday < 5 ? 5 : 0;
    const best = old.bestSoloReaction == null ? reaction : Math.min(Number(old.bestSoloReaction), reaction);
    const user = await upsertUser(req.user.uid, {
      bestSoloReaction: best,
      soloAttempts: safeNumber(old.soloAttempts) + 1,
      soloRewardDate: day,
      soloRewardedAttempts: rewardedToday + (rewardCoins > 0 ? 1 : 0),
      coins: safeNumber(old.coins, 100) + rewardCoins,
      lastSoloReaction: reaction
    });
    res.json({ user, reaction, rewardCoins, rewardedAttemptsRemaining: Math.max(0, 5 - (rewardedToday + (rewardCoins > 0 ? 1 : 0))) });
  } catch (e) { next(e); }
});
app.post('/api/shop/buy-coins', authMiddleware, rateLimit('shop', 20, 60000), async (req, res, next) => {
  try {
    const item = SHOP.find(x => x.id === String(req.body.itemId || '') && x.coins > 0);
    if (!item) return res.status(400).json({ error: 'Invalid coin item.', code: 'INVALID_ITEM' });

    if (firebaseReady) {
      const ref = db.collection('users').doc(req.user.uid);
      let result;
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const user = snap.exists ? snap.data() : DEFAULT_USER(req.user.uid);
        if ((user.inventory || []).includes(item.id)) {
          const error = new Error('You already own this item.'); error.code = 'ALREADY_OWNED'; throw error;
        }
        const balance = safeNumber(user.coins, 100);
        if (balance < item.coins) {
          const error = new Error(`You need ${item.coins - balance} more coins.`); error.code = 'NOT_ENOUGH_COINS'; throw error;
        }
        result = { ...user, uid: req.user.uid, coins: balance - item.coins, inventory: [...new Set([...(user.inventory || ['classic']), item.id])], updatedAt: Date.now() };
        tx.set(ref, result, { merge: true });
      });
      return res.json({ user: result, unlocked: item });
    }

    const user = (await getUser(req.user.uid)) || DEFAULT_USER(req.user.uid);
    if ((user.inventory || []).includes(item.id)) return res.status(409).json({ error: 'You already own this item.', code: 'ALREADY_OWNED' });
    if (safeNumber(user.coins, 100) < item.coins) return res.status(400).json({ error: `You need ${item.coins - safeNumber(user.coins, 100)} more coins.`, code: 'NOT_ENOUGH_COINS' });
    const updated = await upsertUser(req.user.uid, { coins: safeNumber(user.coins, 100) - item.coins, inventory: [...new Set([...(user.inventory || ['classic']), item.id])] });
    res.json({ user: updated, unlocked: item });
  } catch (e) {
    if (e.code === 'ALREADY_OWNED') return res.status(409).json({ error: e.message, code: e.code });
    if (e.code === 'NOT_ENOUGH_COINS') return res.status(400).json({ error: e.message, code: e.code });
    next(e);
  }
});

const razorpay = PAYMENTS_ENABLED && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

app.post('/api/payments/create-order', authMiddleware, rateLimit('payment', 10, 60000), async (req, res, next) => {
  try {
    if (!PAYMENTS_ENABLED) return res.status(503).json({ error: 'Payments are coming soon.', code: 'PAYMENTS_DISABLED' });
    const item = SHOP.find(x => x.id === String(req.body.itemId || '') && x.priceInr > 0);
    if (!item) return res.status(400).json({ error: 'Invalid paid item.', code: 'INVALID_ITEM' });
    if (!razorpay) return res.status(503).json({ error: 'Payment provider is not configured.', code: 'PAYMENT_NOT_CONFIGURED' });
    const user = await getUser(req.user.uid);
    if (user?.inventory?.includes(item.id)) return res.status(409).json({ error: 'You already own this item.', code: 'ALREADY_OWNED' });
    const order = await razorpay.orders.create({ amount: item.priceInr * 100, currency: 'INR', receipt: `tapduel_${Date.now()}`, notes: { uid: req.user.uid, itemId: item.id, itemName: item.name } });
    await recordPayment({ id: order.id, uid: req.user.uid, itemId: item.id, amount: item.priceInr, status: 'created' });
    res.json({ order, item, razorpayKeyId: process.env.RAZORPAY_KEY_ID });
  } catch (e) { next(e); }
});
app.post('/api/payments/verify-client', authMiddleware, async (req, res, next) => {
  try {
    if (!PAYMENTS_ENABLED) return res.status(503).json({ error: 'Payments are disabled.', code: 'PAYMENTS_DISABLED' });
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, itemId } = req.body;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    if (!safeSecretEqual(expected, razorpay_signature)) return res.status(400).json({ error: 'Payment signature invalid.', code: 'INVALID_SIGNATURE' });
    const item = SHOP.find(x => x.id === itemId && x.priceInr > 0);
    if (!item) return res.status(400).json({ error: 'Invalid item.', code: 'INVALID_ITEM' });
    const user = (await getUser(req.user.uid)) || DEFAULT_USER(req.user.uid);
    const patch = item.type === 'pass' ? { premium: true, inventory: [...new Set([...(user.inventory || []), item.id])] } : { inventory: [...new Set([...(user.inventory || []), item.id])] };
    const updated = await upsertUser(req.user.uid, patch);
    await recordPayment({ id: razorpay_payment_id, orderId: razorpay_order_id, uid: req.user.uid, itemId, status: 'paid_client_verified' });
    res.json({ ok: true, user: updated });
  } catch (e) { next(e); }
});
app.post('/api/payments/webhook', async (req, res, next) => {
  try {
    if (!PAYMENTS_ENABLED) return res.status(204).end();
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return res.status(503).send('Webhook secret missing');
    const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    const provided = String(req.headers['x-razorpay-signature'] || '');
    if (!safeSecretEqual(expected, provided)) return res.status(400).send('Invalid webhook signature');
    const event = JSON.parse(req.body.toString());
    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity;
      const uid = payment.notes?.uid;
      const itemId = payment.notes?.itemId;
      const item = SHOP.find(x => x.id === itemId);
      if (uid && item) {
        const user = (await getUser(uid)) || DEFAULT_USER(uid);
        const patch = item.type === 'pass' ? { premium: true, inventory: [...new Set([...(user.inventory || []), item.id])] } : { inventory: [...new Set([...(user.inventory || []), item.id])] };
        await upsertUser(uid, patch);
        await recordPayment({ id: payment.id, uid, itemId, amount: payment.amount / 100, status: 'paid_webhook' });
      }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/contact', rateLimit('contact', 5, 15 * 60000), async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
    const message = String(req.body.message || '').trim().slice(0, 1000);
    const type = String(req.body.type || 'sponsor').trim().slice(0, 40);
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || message.length < 5) return res.status(400).json({ error: 'Please enter a valid name, email and message.', code: 'INVALID_LEAD' });
    const lead = { id: uuidv4(), name, email, type, message, status: 'new', createdAt: Date.now(), updatedAt: Date.now() };
    if (firebaseReady) await db.collection('contactLeads').doc(lead.id).set(lead);
    else memory.contactLeads.set(lead.id, lead);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Admin APIs ----------
app.get('/api/admin/stats', adminMiddleware, async (req, res, next) => {
  try {
    const users = firebaseReady ? (await db.collection('users').count().get()).data().count : memory.users.size;
    const matches = firebaseReady ? (await db.collection('matches').count().get()).data().count : memory.matches.length;
    const contactLeads = firebaseReady ? (await db.collection('contactLeads').count().get()).data().count : memory.contactLeads.size;
    res.json({ users, matches, contactLeads, activeRooms: rooms.size, waiting: waitingQueue.length, online: sockets.size, firebaseReady, version: APP_VERSION, paymentsEnabled: PAYMENTS_ENABLED });
  } catch (e) { next(e); }
});
app.get('/api/admin/users', adminMiddleware, async (req, res, next) => { try { const limit = Math.min(Number(req.query.limit || 25), 100); if (firebaseReady) { const snap = await db.collection('users').orderBy('updatedAt', 'desc').limit(limit).get(); return res.json({ users: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) }); } res.json({ users: [...memory.users.values()].sort((a,b)=>safeNumber(b.updatedAt)-safeNumber(a.updatedAt)).slice(0, limit) }); } catch(e){ next(e); } });
app.get('/api/admin/matches', adminMiddleware, async (req, res, next) => { try { const limit = Math.min(Number(req.query.limit || 25), 100); if (firebaseReady) { const snap = await db.collection('matches').orderBy('createdAt', 'desc').limit(limit).get(); return res.json({ matches: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) }); } res.json({ matches: memory.matches.slice(-limit).reverse() }); } catch(e){ next(e); } });
app.get('/api/admin/leads', adminMiddleware, async (req, res, next) => { try { const limit = Math.min(Number(req.query.limit || 25), 100); if (firebaseReady) { const snap = await db.collection('contactLeads').orderBy('createdAt', 'desc').limit(limit).get(); return res.json({ leads: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) }); } res.json({ leads: [...memory.contactLeads.values()].sort((a,b)=>safeNumber(b.createdAt)-safeNumber(a.createdAt)).slice(0, limit) }); } catch(e){ next(e); } });

// ---------- Realtime game lifecycle ----------
const waitingQueue = [];
const rooms = new Map();
const sockets = new Map();
const privateRooms = new Map();

function removeFromQueue(socketId) {
  let index;
  while ((index = waitingQueue.indexOf(socketId)) !== -1) waitingQueue.splice(index, 1);
  const data = sockets.get(socketId);
  if (data && data.state === 'searching') data.state = 'idle';
}
function removePrivateRoomsForSocket(socketId) {
  for (const [code, entry] of privateRooms.entries()) if (entry.hostId === socketId) privateRooms.delete(code);
}
function socketPlayer(socketId) {
  const data = sockets.get(socketId);
  return data ? { uid: data.uid, username: data.username, skin: data.activeSkin || 'classic' } : { uid: socketId, username: 'Player', skin: 'classic' };
}
function canPlayTogether(aId, bId) {
  const a = sockets.get(aId); const b = sockets.get(bId);
  return Boolean(a?.uid && b?.uid && a.uid !== b.uid && a.state !== 'playing' && b.state !== 'playing');
}
function clearRoomTimers(room) {
  if (!room) return;
  for (const key of ['countdownInterval', 'startTimeout', 'matchTimeout', 'cleanupTimeout']) {
    if (room[key]) { clearTimeout(room[key]); clearInterval(room[key]); room[key] = null; }
  }
}
function setSocketState(socketId, state, roomId = null) {
  const data = sockets.get(socketId);
  if (!data) return;
  data.state = state;
  data.roomId = roomId;
}
function releaseRoomPlayers(room) {
  for (const socketId of room.players) {
    setSocketState(socketId, 'idle', null);
    const client = io.sockets.sockets.get(socketId);
    if (client) client.leave(room.id);
  }
}
function destroyRoom(roomId, delay = 0) {
  const room = rooms.get(roomId);
  if (!room) return;
  clearRoomTimers(room);
  releaseRoomPlayers(room);
  if (delay > 0) room.cleanupTimeout = setTimeout(() => rooms.delete(roomId), delay);
  else rooms.delete(roomId);
}
function createGameRoom(playerA, playerB, mode = 'quick', code = null) {
  removeFromQueue(playerA.id); removeFromQueue(playerB.id);
  const roomId = `room_${uuidv4().slice(0, 10)}`;
  const room = {
    id: roomId,
    mode,
    code,
    state: 'countdown',
    players: [playerA.id, playerB.id],
    playerData: { [playerA.id]: socketPlayer(playerA.id), [playerB.id]: socketPlayer(playerB.id) },
    clicks: {},
    startAt: null,
    resultSaved: false,
    createdAt: Date.now(),
    countdownInterval: null,
    startTimeout: null,
    matchTimeout: null,
    cleanupTimeout: null
  };
  rooms.set(roomId, room);
  playerA.join(roomId); playerB.join(roomId);
  setSocketState(playerA.id, 'playing', roomId); setSocketState(playerB.id, 'playing', roomId);
  io.to(roomId).emit('matchFound', { roomId, mode, code, players: room.players.map(id => room.playerData[id]) });
  startCountdown(roomId);
  return room;
}
function startCountdown(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.state !== 'countdown') return;
  let count = 3;
  io.to(roomId).emit('countdown', count);
  room.countdownInterval = setInterval(() => {
    const current = rooms.get(roomId);
    if (!current || current.state !== 'countdown') return clearRoomTimers(current);
    count -= 1;
    if (count > 0) return io.to(roomId).emit('countdown', count);
    clearInterval(current.countdownInterval); current.countdownInterval = null;
    current.state = 'waiting_signal';
    io.to(roomId).emit('waitSignal', { message: 'Wait...' });
    const randomDelay = 1200 + Math.floor(Math.random() * 2200);
    current.startTimeout = setTimeout(() => {
      const live = rooms.get(roomId);
      if (!live || live.state !== 'waiting_signal') return;
      live.state = 'active';
      live.startAt = Date.now();
      io.to(roomId).emit('tapNow', { serverStartAt: live.startAt, matchId: roomId });
    }, randomDelay);
  }, 1000);
}
async function finishRoom(roomId, winnerSocketId, loserSocketId, reason = 'reaction') {
  const room = rooms.get(roomId);
  if (!room || ['finished', 'cancelled'].includes(room.state) || room.resultSaved) return;
  room.state = 'finished'; room.resultSaved = true; clearRoomTimers(room);
  const winner = room.playerData[winnerSocketId] || socketPlayer(winnerSocketId);
  const loser = room.playerData[loserSocketId] || socketPlayer(loserSocketId);
  const winnerReaction = room.clicks[winnerSocketId]?.reaction ?? null;
  const loserReaction = room.clicks[loserSocketId]?.reaction ?? null;
  try {
    await Promise.all([updateUserAfterMatch(winner, true, winnerReaction), updateUserAfterMatch(loser, false, loserReaction)]);
    await recordMatch({ id: uuidv4(), roomId, matchType: room.mode, winner, loser, winnerReaction, loserReaction, reason, createdAt: Date.now() });
  } catch (error) { console.error('Match result persistence failed:', error); }
  io.to(roomId).emit('gameResult', { roomId, winner, loser, winnerReaction, loserReaction, reason });
  destroyRoom(roomId, 1000);
}
function cancelRoom(roomId, cancelledBy, reason = 'cancelled') {
  const room = rooms.get(roomId);
  if (!room || ['finished', 'cancelled'].includes(room.state)) return false;
  room.state = 'cancelled'; clearRoomTimers(room);
  for (const socketId of room.players) {
    const message = socketId === cancelledBy ? 'Match cancelled.' : 'Opponent cancelled the match.';
    io.to(socketId).emit('matchCancelled', { roomId, reason, message });
  }
  destroyRoom(roomId);
  return true;
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const preferredName = sanitizeUsername(socket.handshake.auth?.username || '', '');
    const decoded = await verifyFirebaseToken(token);
    const user = await ensureUserFromAuth(decoded, preferredName);
    const username = preferredName || user.username || decoded.name || 'Player';
    const saved = await upsertUser(decoded.uid, { username });
    sockets.set(socket.id, { uid: decoded.uid, username: saved.username, activeSkin: saved.activeSkin || 'classic', state: 'idle', roomId: null, lastTapAt: 0 });
    next();
  } catch (error) { next(new Error(error.message)); }
});

io.on('connection', socket => {
  socket.emit('connected', { socketId: socket.id, user: sockets.get(socket.id), online: sockets.size });
  io.emit('onlineCount', { online: sockets.size, searching: waitingQueue.length });

  socket.on('updateProfile', async ({ username, activeSkin } = {}, ack = () => {}) => {
    try {
      const current = sockets.get(socket.id);
      if (!current?.uid) throw new Error('Login session missing');
      const user = await getUser(current.uid);
      const safeName = sanitizeUsername(username || current.username);
      const skin = user?.inventory?.includes(activeSkin) ? activeSkin : user?.activeSkin || 'classic';
      sockets.set(socket.id, { ...current, username: safeName, activeSkin: skin });
      await upsertUser(current.uid, { username: safeName, activeSkin: skin });
      ack({ ok: true });
    } catch (e) { ack({ ok: false, error: e.message }); }
  });

  socket.on('quickMatch', (_, ack = () => {}) => {
    const me = sockets.get(socket.id);
    if (!me) return ack({ ok: false, error: 'Login session missing.' });
    if (me.state === 'playing') return ack({ ok: false, error: 'You are already in a match.' });
    removePrivateRoomsForSocket(socket.id);
    removeFromQueue(socket.id);

    for (let i = waitingQueue.length - 1; i >= 0; i -= 1) if (!io.sockets.sockets.has(waitingQueue[i])) waitingQueue.splice(i, 1);
    const opponentIndex = waitingQueue.findIndex(id => id !== socket.id && io.sockets.sockets.has(id) && canPlayTogether(id, socket.id));
    if (opponentIndex >= 0) {
      const opponentId = waitingQueue.splice(opponentIndex, 1)[0];
      const opponent = io.sockets.sockets.get(opponentId);
      if (opponent) createGameRoom(opponent, socket, 'quick');
      ack({ ok: true, matched: true });
    } else {
      waitingQueue.push(socket.id); setSocketState(socket.id, 'searching', null);
      socket.emit('status', 'Searching for opponent...');
      io.emit('onlineCount', { online: sockets.size, searching: waitingQueue.length });
      ack({ ok: true, matched: false });
    }
  });

  socket.on('cancelMatch', (_, ack = () => {}) => {
    const me = sockets.get(socket.id);
    removeFromQueue(socket.id);
    removePrivateRoomsForSocket(socket.id);
    if (me?.roomId) {
      const room = rooms.get(me.roomId);
      if (room?.state === 'active') {
        const opponentId = room.players.find(id => id !== socket.id);
        if (opponentId) finishRoom(room.id, opponentId, socket.id, 'forfeit');
        ack({ ok: true, type: 'forfeit' });
      } else {
        cancelRoom(me.roomId, socket.id, 'player_cancelled');
        ack({ ok: true, type: 'cancelled' });
      }
    } else {
      setSocketState(socket.id, 'idle', null);
      socket.emit('status', 'Matchmaking cancelled.');
      ack({ ok: true, type: 'queue' });
    }
    io.emit('onlineCount', { online: sockets.size, searching: waitingQueue.length });
  });

  socket.on('createPrivateRoom', (_, ack = () => {}) => {
    const me = sockets.get(socket.id);
    if (!me || me.state === 'playing') return ack({ ok: false, error: 'Finish your current match first.' });
    removeFromQueue(socket.id); removePrivateRoomsForSocket(socket.id);
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    privateRooms.set(code, { hostId: socket.id, createdAt: Date.now() });
    me.state = 'private_waiting';
    socket.emit('privateRoomCreated', { code });
    ack({ ok: true, code });
  });

  socket.on('joinPrivateRoom', ({ code } = {}, ack = () => {}) => {
    const clean = String(code || '').trim().toUpperCase();
    const entry = privateRooms.get(clean);
    if (!entry || Date.now() - entry.createdAt > 10 * 60000) { privateRooms.delete(clean); return ack({ ok: false, error: 'Private room not found or expired.' }); }
    if (entry.hostId === socket.id) return ack({ ok: false, error: 'Waiting for a different player.' });
    const host = io.sockets.sockets.get(entry.hostId);
    if (!host) { privateRooms.delete(clean); return ack({ ok: false, error: 'Host disconnected.' }); }
    if (!canPlayTogether(entry.hostId, socket.id)) return ack({ ok: false, error: 'Use a different Google account for the second player.' });
    privateRooms.delete(clean); removeFromQueue(socket.id);
    createGameRoom(host, socket, 'private', clean);
    ack({ ok: true });
  });

  socket.on('tap', ({ roomId, clientTapAt, clientReaction, matchId } = {}, ack = () => {}) => {
    const room = rooms.get(roomId);
    if (!room || matchId !== room.id || !room.players.includes(socket.id)) return ack({ ok: false, error: 'This match is no longer active.' });
    if (['finished', 'cancelled'].includes(room.state)) return ack({ ok: false, error: 'Match already finished.' });
    const opponentId = room.players.find(id => id !== socket.id);
    if (room.state !== 'active') {
      finishRoom(roomId, opponentId, socket.id, 'early_tap');
      return ack({ ok: true, early: true });
    }
    if (room.clicks[socket.id]) return ack({ ok: false, error: 'Tap already registered.' });
    const now = Date.now();
const serverReaction = Math.max(0, now - room.startAt);
const clientValue = Number(clientReaction);

const validClientReaction =
  Number.isFinite(clientValue) &&
  clientValue >= 50 &&
  clientValue <= 10000 &&
  clientValue <= serverReaction + 1500;

if (!validClientReaction && Number.isFinite(clientValue)) {
  memory.suspicious.push({
    uid: sockets.get(socket.id)?.uid,
    clientReaction: clientValue,
    serverReaction
  });
}

const effectiveReaction = validClientReaction
  ? Math.round(clientValue)
  : Math.round(serverReaction);

room.clicks[socket.id] = {
  reaction: effectiveReaction,
  serverReaction: Math.round(serverReaction),
  serverTapAt: now,
  clientTapAt: Number(clientTapAt || now),
  clientReaction: validClientReaction ? Math.round(clientValue) : null
};

socket.emit('tapRegistered', {
  reaction: effectiveReaction,
  clientReaction: validClientReaction ? Math.round(clientValue) : null
});

ack({ ok: true });
    if (room.clicks[opponentId]) {
      const [a, b] = room.players;
      const winnerId = room.clicks[a].reaction <= room.clicks[b].reaction ? a : b;
      return finishRoom(roomId, winnerId, winnerId === a ? b : a, 'reaction');
    }
    clearTimeout(room.matchTimeout);
    room.matchTimeout = setTimeout(() => {
      const live = rooms.get(roomId);
      if (live?.state === 'active' && live.clicks[socket.id] && !live.clicks[opponentId]) finishRoom(roomId, socket.id, opponentId, 'timeout');
    }, 2500);
  });

  socket.on('disconnect', () => {
    const me = sockets.get(socket.id);
    removeFromQueue(socket.id); removePrivateRoomsForSocket(socket.id);
    if (me?.roomId) {
      const room = rooms.get(me.roomId);
      if (room && !['finished', 'cancelled'].includes(room.state)) {
        const opponentId = room.players.find(id => id !== socket.id);
        if (room.state === 'active' && opponentId) finishRoom(room.id, opponentId, socket.id, 'disconnect');
        else cancelRoom(room.id, socket.id, 'disconnect');
      }
    }
    sockets.delete(socket.id);
    io.emit('onlineCount', { online: sockets.size, searching: waitingQueue.length });
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: NODE_ENV === 'production' ? 'Something went wrong. Please try again.' : error.message, code: 'SERVER_ERROR' });
});

server.listen(PORT, () => console.log(`🚀 TapDuel ${APP_VERSION} running on port ${PORT}`));
