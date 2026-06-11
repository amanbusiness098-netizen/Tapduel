# Changes in Hardened Final Pack

- Rebuilt multiplayer room lifecycle with explicit states.
- Cancel before signal now cancels both clients and clears all timers.
- Cancel during an active match is a forfeit.
- Disconnect before signal cancels; disconnect during active match awards opponent.
- Solo mode cleanly exits matchmaking and ignores multiplayer events.
- Added Solo score saving, personal best and limited daily coin rewards.
- Added Play Again and Share Score flow.
- Added one frontend state controller for button behaviour.
- Removed browser `alert()` usage and added non-blocking toast messages.
- Improved login popup cancellation/retry behaviour.
- Added request timeouts and better server-waking messages.
- Added exact shop shortage errors, duplicate ownership checks and Firestore transaction purchase.
- Added `PAYMENTS_ENABLED` feature flag and safer future Razorpay structure.
- Protected admin APIs with Firebase login plus `ADMIN_EMAILS`/`ADMIN_UIDS`.
- Added sponsor-form validation and rate limiting.
- Added health/version endpoints, online/searching counts and responsive polish.
- Added Privacy, Terms, Game Rules and Refund placeholder pages.
- Added setup, deployment, Firebase, testing, known-limits and future-change documentation.
