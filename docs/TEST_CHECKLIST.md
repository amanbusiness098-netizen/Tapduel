# Final Test Checklist

## Authentication
- Login works
- Closing popup shows no browser alert
- Login can be retried immediately
- Refresh keeps session
- Logout works

## Solo
- Normal run saves reaction
- Early tap ends attempt
- Play Again works
- Share Score works
- First five valid daily attempts award coins; later attempts do not

## Quick Match
- Duplicate clicks do not duplicate queue entry
- 12-second Solo fallback appears
- Choosing Solo removes player from queue
- Two users match
- Early tap loses
- First valid tap wins after opponent timeout
- Cancel before TAP cancels both players and clears timers
- Cancel after TAP becomes forfeit
- Disconnect before TAP cancels room
- Disconnect after TAP awards opponent
- No delayed TAP after cancel

## Private Room
- Create code
- Wrong/expired code handled
- Same account blocked
- Two different accounts play

## Shop/admin/forms
- Exact coin shortage shown in toast
- Owned item cannot be bought twice
- Equip only owned skin
- Sponsor form validates and rate-limits
- Admin denies non-admin users
- Admin works for configured email/UID

## Devices
Test Chrome/Edge, normal/incognito, Android, Wi-Fi/mobile data and a narrow 320px layout.
