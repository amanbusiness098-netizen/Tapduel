# Payments Later

Payments are intentionally disabled with `PAYMENTS_ENABLED=false`.

Before enabling:
1. Activate bank online services and complete Razorpay KYC/account activation.
2. Finalize merchant identity, support email, Terms, Privacy and Refund Policy.
3. Use Razorpay test mode first.
4. Add test keys and webhook secret only as environment variables.
5. Verify order creation, signature verification, webhook delivery, duplicate webhook handling and item delivery.
6. Confirm order history and refund status in admin.
7. Only then set `PAYMENTS_ENABLED=true`.

Do not add player deposits, cash wallets, withdrawals, staking or player-funded prize pools.
