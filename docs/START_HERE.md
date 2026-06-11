# TapDuel — Start Here

This is the hardened TapDuel beta package.

## Main folders
- `frontend/` public game website
- `backend/` Express + Socket.io + Firebase server
- `admin/` private Firebase-authenticated admin dashboard
- `docs/` setup, deployment, testing and future-payment instructions

## Local start
1. Copy `backend/.env.example` to `backend/.env`.
2. Put your Firebase Admin file at `backend/firebase-key.json`.
3. Set `FIREBASE_SERVICE_ACCOUNT_JSON=./firebase-key.json`.
4. Add your own email to `ADMIN_EMAILS`.
5. Run `npm run install:backend` once from the project root.
6. Run `npm run dev`.
7. Open `frontend/index.html` using Live Server.

Never commit `.env`, `firebase-key.json` or `node_modules`.
