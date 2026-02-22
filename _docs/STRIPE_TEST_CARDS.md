# Stripe test cards for testers

Use these **only** when the app is in **Stripe Test mode** (test keys). No real money is charged.

---

## Successful payment (use this for normal testing)

| Field | Use this |
|-------|----------|
| **Card number** | `4242 4242 4242 4242` |
| **Expiry** | Any future date (e.g. `12/34` or `01/30`) |
| **CVC** | Any 3 digits (e.g. `123` or `424`) |
| **Name** | Anything (e.g. `Test User`) |
| **ZIP** | Any valid format if asked (e.g. `12345`) |

This card always succeeds. Use it to subscribe to Founder and complete checkout.

---

## Other cards that succeed (by brand)

| Brand | Card number | CVC | Expiry |
|-------|-------------|-----|--------|
| Visa | 4242 4242 4242 4242 | Any 3 digits | Any future date |
| Visa (debit) | 4000 0566 5566 5556 | Any 3 digits | Any future date |
| Mastercard | 5555 5555 5555 4444 | Any 3 digits | Any future date |
| Mastercard (2-series) | 2223 0031 2200 3222 | Any 3 digits | Any future date |
| Mastercard (debit) | 5200 8282 8282 8210 | Any 3 digits | Any future date |
| American Express | 3782 822463 10005 | Any 4 digits | Any future date |
| Discover | 6011 1111 1111 1117 | Any 3 digits | Any future date |
| JCB | 3566 0020 2036 0505 | Any 3 digits | Any future date |
| Diners Club | 3056 9300 0902 0004 | Any 3 digits | Any future date |

Same rules: any future expiry, any valid CVC (3 digits, or 4 for Amex), any name.

---

## 3D Secure (SCA) cards

Use these when testing Strong Customer Authentication / 3D Secure flows. A challenge (bank auth step) may appear.

| Scenario | Card number | What happens |
|----------|-------------|---------------|
| 3DS required, succeeds after auth | 4000 0025 0000 3155 | Payment triggers 3DS; complete the challenge to succeed. |
| 3DS required every time (e.g. recurring) | 4000 0027 6000 3184 | Always requires 3DS authentication. |

Use any future expiry, any valid CVC, any name. Complete the authentication step when the test challenge appears.

---

## Cards that simulate failures (for error handling)

| Scenario | Card number | What happens |
|----------|-------------|---------------|
| Card declined (generic) | 4000 0000 0000 0002 | Payment is declined |
| Insufficient funds | 4000 0000 0000 9995 | Declined (insufficient funds) |
| Lost card | 4000 0000 0000 9987 | Declined (lost card) |
| Stolen card | 4000 0000 0000 9979 | Declined (stolen card) |
| Expired card | 4000 0000 0000 0069 | Declined (expired card) |
| Incorrect CVC | 4000 0000 0000 0127 | Declined (wrong CVC) |
| Processing error | 4000 0000 0000 0119 | Declined (processing error) |
| Invalid card number | 4242 4242 4242 4241 | Declined (invalid number) |
| Decline after attaching | 4000 0000 0000 0341 | Card can be saved to customer, but later charges fail |

Use these to test that your app shows a sensible error when payment fails. For “Incorrect CVC” you must enter a CVC (any 3 digits).

---

## Testing in code (PaymentMethods)

For automated tests or server-side code, use Stripe **PaymentMethod** IDs instead of card numbers (PCI-friendly):

| Use case | PaymentMethod ID |
|----------|-------------------|
| Successful payment | `pm_card_visa` |
| Generic decline | `pm_card_visa_chargeDeclined` |
| Insufficient funds | `pm_card_visa_chargeDeclinedInsufficientFunds` |
| Expired card | `pm_card_chargeDeclinedExpiredCard` |
| Incorrect CVC | `pm_card_chargeDeclinedIncorrectCvc` |

See [Stripe: Testing](https://docs.stripe.com/testing#cards) for the full list.

---

## Rules

- **Test mode only** — These numbers work only with Stripe test API keys. Real cards are rejected in test mode.
- **No real cards** — Do not enter real card details in test mode; they will be declined.
- **Expiry** — Must be a future date (e.g. 12/34).
- **CVC** — 3 digits for Visa/Mastercard/Discover/JCB/Diners, 4 digits for American Express.
- **Source** — [Stripe: Testing](https://docs.stripe.com/testing#cards)

---

You can share this file (or a copy) with anyone testing subscriptions in your test environment.
