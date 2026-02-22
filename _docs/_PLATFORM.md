# Parascene — Platform & Business Model Notes

*A working design memo distilled from exploratory discussion.*

---

## Core Idea

Parascene is an app that lets people explore and share **novel poem-images** shaped by themselves and others. AI is an enabling technology, not the product.

The system is **peer-to-peer in the way that matters most**:
- not B2C
- not B2B
- but socially and economically peer-driven

Central coordination exists, but value creation, hosting, and culture are distributed.

---

## Roles

### Consumers
- Motivated by novelty, attention, and play
- Start free with limited daily credits
- Can pay, but payment is framed as *supporting a place*, not paying a platform
- Sharing is framed as gifting or inviting, not marketing

**Ethical constraint:**  
No pay-to-win, no guaranteed attention, no punishment for stopping.

---

### Creators / Prosumers
Two types:
1. **Whales** – pay to explore deeply, don’t need kickbacks
2. **Near-expert F2P prosumers** – need credits to refine templates

They:
- create generation templates
- refine prompts and styles
- supply cultural value to providers

**Ethical constraint:**  
Creators should never feel forced to pay to remain relevant.

---

### Providers (Servers)
Providers are users who:
- run generation infrastructure
- optionally assist with distribution (media, read paths)
- host culture and community (Discord-like servers)

Motivations include:
- social identity
- stewardship
- power-without-ownership
- altruism
- optional profit (if ever enabled)

Providers:
- earn credits for serving generations
- may earn fractional credits for content distribution
- hold **credit pools** for events, competitions, and giveaways

Providers do *not* own users or override system rules.

---

### System
The system:
- handles auth, identity, moderation
- owns the credit ledger
- defines scarcity and legitimacy
- coordinates providers and users
- takes a thin, boring cut per transaction

The system does **not**:
- sell desire
- compete with providers for user payments
- sell attention

**Design goal:**  
System is authoritative but not busy.

---

## Credits & Pricing

- Credits are the unit of scarcity.
- Credits disappear when used.
- Providers buy credits from the system.
- Providers may resell or distribute credits to users.

### Target economics
- System margin: ~3–5¢ per credit
- System price: ~$5 per 100 credits
- Provider resale: ~$8–12 per 100 credits

This supports a ~$200k/year income with ~20–30 healthy providers.

---

## Boosts (Discord-Inspired)

Boosts are **server-scoped** and fund capacity, not power.

When a user boosts a provider:
- The provider gets a higher credit yield (capped)
- The system may immediately grant some credits to the booster
- Credits buy *usage*, not influence

Boosts:
- improve generosity
- improve efficiency
- never guarantee visibility or authority

**Invariant:**  
Money buys possibility, not power.

---

## Events, Competitions, Giveaways

- Providers can run events using pre-funded credit pools
- Pools are finite and system-enforced
- Users “buy in” socially or financially to support events
- Credits are prizes, not guarantees

This turns money into **culture**, not extraction.

---

## Virality & Sharing

Growth must feel like **helping a friend**, not marketing a platform.

### Sharing principles
- Share artifacts, not signup links
- Share prompts, themes, and challenges
- Share invites as hospitality
- Gifting credits = giving room to play

Avoid:
- referral codes
- share-to-unlock
- growth hacks

---

## Invites & Onboarding

### Invite-first (not invite-only forever)

- Initial access via invites or invite requests
- Soft registration = email only
- No account until invite is accepted

Invites:
- are issued by people or servers
- carry context (who invited you, where)
- may grant small hospitality credits

**Framing:**  
An invite is an act of hosting.

---

## Email (Invites)

- Use transactional email (Resend or Postmark)
- Email says “You were invited”, not “Sign up”
- Link redeems a token → enters a place

Postmark:
- ~$15/month for 10k emails
- Strong deliverability, multiple domains

Resend:
- Free tier (~3k emails/month)
- Easy dev ergonomics
- Domains can be swapped later

---

## Scaling Strategy (Cost Alignment)

Primary risk:  
Vercel / Supabase bills scaling faster than revenue.

### Mitigation
- Providers handle compute
- Providers assist with distribution
- Providers may serve large portions of read-heavy public data
- System retains authoritative write path

**Rule:**  
Peers move bytes; the system decides what they mean.

---

## P2P Clarification

The platform is:
- P2P socially and economically
- centrally coordinated technically

This is acceptable and honest.

Most P2P systems have trackers.

---

## Guiding Principles (Non-Negotiable)

- The system must remain boring
- Money must never buy attention or authority
- Providers compete on culture, not pricing tricks
- Users must never feel used as marketers
- Indirection protects trust

---

## One-Sentence Summary

> Consumers indulge, creators refine, providers host, and the system takes a thin cut for keeping the game fair.

