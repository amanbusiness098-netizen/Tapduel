# Known Limits

- Render free instances can sleep and make the first request slow.
- Multiplayer reaction results vary with device/browser/network conditions and are not laboratory measurements.
- The in-memory rate limiter is suitable for one backend instance only. Use Redis before horizontal scaling.
- Admin is protected by Firebase token plus configured email/UID, but management actions such as ban/edit/export are future work.
- Paid items remain disabled until merchant setup and test-mode verification are complete.
- Load capacity is not guaranteed until tested with real concurrent users.
