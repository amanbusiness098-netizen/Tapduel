# TapDuel

TapDuel is a free reaction-speed game with Solo Challenge, realtime 1v1 Quick Match, private rooms, leaderboards, virtual coins, skins and sponsor enquiries.

## Stack
HTML/CSS/JavaScript, Firebase Authentication/Firestore, Node.js, Express, Socket.io, Render and Vercel.

## Important safety model
- No player deposits
- No cash staking
- No withdrawals
- Virtual coins have no cash value
- Paid items are disabled until merchant setup is complete

## Start
Read `docs/START_HERE.md`.

## Key hardened features
- Unified frontend game-state controls
- Cancel/disconnect/forfeit handling for both players
- Room timer cleanup
- Solo/Quick Match isolation
- Non-blocking toast notifications instead of browser alerts
- Exact shop error messages and atomic coin purchase on Firestore
- Admin API authorization by Firebase email/UID
- Contact-form validation and rate limiting
- Privacy, terms, rules and refund placeholder pages
- Disabled future-payment infrastructure
