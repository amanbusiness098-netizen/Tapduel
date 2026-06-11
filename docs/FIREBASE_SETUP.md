# Firebase Setup

1. Enable Google sign-in under Firebase Authentication.
2. Add localhost and the stable Vercel domain under Authorized domains.
3. Create Firestore.
4. Generate a new Admin SDK service-account key for local use.
5. Never upload the key to GitHub or send it publicly.
6. On Render, use the full JSON in `FIREBASE_SERVICE_ACCOUNT_JSON`.
7. Add your Firebase login email to Render `ADMIN_EMAILS`.

Recommended collections: `users`, `matches`, `contactLeads`, `payments`.
The backend should be the only trusted writer for coins, inventory, wins, rank points and match results.
