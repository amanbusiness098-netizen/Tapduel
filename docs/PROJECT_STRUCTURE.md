# Project Structure

## Frontend
- `index.html`: public UI and sections
- `script.js`: game state, Socket.io, Solo mode, shop, profile, lead form
- `auth.js`: Firebase Google authentication and popup-cancellation handling
- `config.js`: public Firebase web config and backend URLs
- `style.css`: responsive layout, arena, toasts and legal-page styles
- `legal/`: privacy, terms, rules and refund placeholders

## Backend
- `server.js`: REST APIs, authentication, shop, payments flag, admin authorization and complete multiplayer lifecycle
- `.env.example`: safe environment variable template

## Multiplayer states
Backend rooms use: `countdown`, `waiting_signal`, `active`, `finished`, `cancelled`.
Frontend uses: `idle`, `searching`, `matched`, `countdown`, `waiting_signal`, `active`, `finished`, `solo_waiting`, `solo_active`, `disconnected`.

All cancellation/disconnect paths clear room timers. Active-match cancellation is treated as a forfeit.
