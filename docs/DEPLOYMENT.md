# Deployment

## Render backend
- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`
- Environment variables: copy names from `backend/.env.example`
- `FRONTEND_URL` must contain the exact public frontend origin. Multiple origins can be comma-separated.
- Set `VERIFY_AUTH=true` and `NODE_ENV=production`.
- Add full Firebase service-account JSON to `FIREBASE_SERVICE_ACCOUNT_JSON`.
- Add your email to `ADMIN_EMAILS`.
- Keep `PAYMENTS_ENABLED=false`.

## Vercel frontend
- Root directory: `frontend`
- Framework: Other
- No build command required
- Confirm `frontend/config.js` points to the Render URL.
- Add the stable Vercel domain to Firebase Authentication authorized domains.

## After deployment
Test `/health`, `/api/version`, `/api/shop` and `/api/leaderboard?limit=5`.
Then test Google login, Solo, Quick Match, Private Room, cancel, disconnect, shop, lead form and admin authorization.
