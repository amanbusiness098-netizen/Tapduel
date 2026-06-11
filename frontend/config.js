// TapDuel frontend config
const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

const backendUrl = isLocal
  ? 'http://localhost:3000'
  : 'https://tapduel.onrender.com';

window.TAPDUEL_CONFIG = {
  API_BASE: backendUrl,
  SOCKET_URL: backendUrl,

  firebaseConfig: {
    apiKey: "AIzaSyCBQakzaEjRpJkxIMgsjlPfT3SjZ6p5o-A", authDomain: "tapduel-4670c.firebaseapp.com",
    projectId: "tapduel-4670c",
    storageBucket: "tapduel-4670c.firebasestorage.app",
    messagingSenderId: "47914048068",
    appId: "1:947914048068:web:21786db89407f23d377211", measurementId: "G-78VCW4SQ3L"
  },

  demoMode: false
};