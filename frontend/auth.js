import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  signInAnonymously
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';

function looksConfigured(config) {
  return Boolean(config?.apiKey && config?.authDomain && config?.projectId && !String(config.apiKey).startsWith('YOUR_'));
}
function dispatchAuth(user) {
  window.dispatchEvent(new CustomEvent('tapduel-auth-changed', { detail: { user: user || null } }));
}

window.TapDuelAuth = {
  app: null,
  auth: null,
  user: null,
  ready: false,
  _initPromise: null,
  _loginPromise: null,

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = new Promise(resolve => {
      const config = window.TAPDUEL_CONFIG?.firebaseConfig;
      if (!looksConfigured(config)) {
        this.ready = true;
        this.user = null;
        console.warn('Firebase config is missing.');
        dispatchAuth(null);
        resolve(null);
        return;
      }
      this.app = getApps().length ? getApp() : initializeApp(config);
      this.auth = getAuth(this.app);
      let firstState = true;
      onAuthStateChanged(this.auth, user => {
        this.user = user || null;
        this.ready = true;
        dispatchAuth(this.user);
        if (firstState) {
          firstState = false;
          resolve(this.user);
        }
      });
    });
    return this._initPromise;
  },

  async login() {
    await this.init();
    if (this._loginPromise) return this._loginPromise;
    if (!this.auth) {
      if (window.TAPDUEL_CONFIG?.demoMode === true) return this.demoLogin();
      throw new Error('Firebase login is not configured.');
    }
    this._loginPromise = (async () => {
      try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const result = await signInWithPopup(this.auth, provider);
        this.user = result.user;
        dispatchAuth(this.user);
        return this.user;
      } finally {
        this._loginPromise = null;
      }
    })();
    return this._loginPromise;
  },

  async anonymousLogin() {
    await this.init();
    if (!this.auth) {
      if (window.TAPDUEL_CONFIG?.demoMode === true) return this.demoLogin();
      throw new Error('Firebase login is not configured.');
    }
    const result = await signInAnonymously(this.auth);
    this.user = result.user;
    dispatchAuth(this.user);
    return result.user;
  },

  async logout() {
    if (this.auth) await signOut(this.auth);
    this.user = null;
    localStorage.removeItem('tapduel_demo_uid');
    dispatchAuth(null);
  },

  demoLogin() {
    if (window.TAPDUEL_CONFIG?.demoMode !== true) throw new Error('Demo mode is disabled.');
    let uid = localStorage.getItem('tapduel_demo_uid');
    if (!uid) {
      uid = `demo_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('tapduel_demo_uid', uid);
    }
    this.user = {
      uid,
      displayName: localStorage.getItem('tapduel_username') || 'Demo Player',
      email: '',
      getIdToken: async () => `demo:${uid}`
    };
    dispatchAuth(this.user);
    return this.user;
  },

  async getToken(forceRefresh = false) {
    await this.init();
    if (this.user?.getIdToken) return this.user.getIdToken(forceRefresh);
    if (this.user?.uid && window.TAPDUEL_CONFIG?.demoMode === true) return `demo:${this.user.uid}`;
    return null;
  }
};
