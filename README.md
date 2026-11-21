# EMBER CB — Test Bench

A separate test rig for the next Encrypted CB build. **Production Encrypted
CB (encryptedcb.com) is not touched by anything in this repo.**

Live bench: https://ember.apex-airsolutions.com

## What it carries

1. **MTOF transport** — messages are sealed into MTOF (Multiplex TOken
   Format) envelopes and opened at the far end only after per-plex stream
   hashes and the payload SHA-256 verify. The JS dictionary in
   `cb-core.js` is byte-identical to the proven Python format
   (`mtof-proof` sender/receiver, Nov 21 2026). Test traffic rides the
   house reserve, channel 269.
2. **Portable licence recognition** — a licence is an ECDSA P-256 signed
   token the holder carries. Recognition lives in the token, so it
   survives arriving from another app or browser (the production
   Defect B break: session + device key + round-trip all had to live in
   one browser). The bench page can verify licences; it cannot mint them.
3. **The owner's tier schema** (Nov 21, 2026) — licensing is per handset,
   licensed to the user ID, as many handsets as wanted, each separately:
   - $1 per handset: 40 channels + 2 privacy points (e.g. 12.34)
   - $10 per handset: 80 channels + 4 privacy points (e.g. 12.3456)
   - Past 80 to 270: enterprise/commercial reserve, private addressing at
     4–5 points shaped like phone numbers, up to 9,999 employee numbers
   - House reserve: channels 261–270 held for house use + test pipes
   - Owner operator licence: top entitlement, full scan, all channels

## Proof

`proof.cjs` (run with node) checks, end to end: dictionary equality with
the Python format; owner licence verifies and resolves to the top
entitlement; a tampered licence is refused; the licensed seat enumerates
past 20, past 40, into the 80s, to 270 in three 90-blocks; $1/$10 tier
seats resolve to 40/80; and an envelope sealed by this bench's JS core is
published to pipe.apex-airsolutions.com and opened by the **original
Python receiver** over plain HTTP with a hash MATCH. All 20 checks passed
Nov 21, 2026.

## Files

- `index.html`, `style.css`, `app.js`, `cb-core.js` — the bench page
- `owner-licence.txt` — the owner's bench licence token (bench scope only)
- `proof.cjs` — the scripted proof
