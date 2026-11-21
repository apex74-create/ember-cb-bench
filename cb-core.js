/* cb-core.js — EMBER CB test bench core. Shared by the bench page and the
 * scripted proof (node). No production code is imported or touched.
 *
 * Carries three things:
 *  1. The owner's tier schema + scan geometry (Nov 21, 2026; the 270
 *     ceiling and 90-channel block come from the Nov 20 root-cause
 *     report: channels.ts / cb-scan.ts at tinyradr main).
 *  2. MTOF (Multiplex TOken Format) encode/decode — the house format of
 *     Nov 15, 2026, dictionary derived from the "MTOF/1" seed exactly as
 *     sender.py/receiver.py derive it (the derived table is embedded and
 *     the proof asserts byte-equality against the Python derivation).
 *  3. Portable licence tokens: an ECDSA P-256 signed grant the holder
 *     carries. Recognition lives in the token, not in a per-browser
 *     session or device key — the Defect B fix.
 */
(function (root) {
  "use strict";

  /* ---- MTOF dictionary (derived from seed "MTOF/1"; proof-verified) ---- */
  var PERM = [185, 64, 30, 68, 15, 96, 229, 234, 157, 92, 90, 103, 228, 226, 161, 213, 178, 155, 162, 111, 235, 208, 211, 172, 40, 140, 46, 29, 45, 163, 13, 186, 144, 190, 182, 54, 106, 254, 171, 204, 120, 70, 84, 63, 109, 59, 142, 146, 166, 102, 38, 65, 143, 105, 181, 25, 95, 238, 164, 129, 23, 169, 212, 152, 167, 132, 153, 3, 6, 19, 118, 253, 134, 176, 223, 60, 160, 93, 17, 145, 170, 43, 231, 41, 202, 55, 194, 218, 35, 73, 67, 154, 241, 42, 78, 88, 147, 199, 48, 76, 89, 50, 139, 20, 107, 224, 250, 219, 215, 179, 125, 7, 244, 91, 174, 61, 183, 71, 69, 115, 52, 124, 51, 75, 1, 81, 28, 196, 24, 104, 187, 126, 180, 149, 101, 74, 184, 62, 5, 221, 239, 150, 112, 159, 97, 34, 236, 79, 39, 72, 255, 32, 94, 113, 127, 57, 11, 16, 197, 98, 220, 192, 130, 10, 56, 222, 66, 121, 47, 44, 122, 27, 188, 33, 58, 138, 18, 86, 210, 156, 14, 240, 141, 12, 8, 237, 80, 9, 216, 83, 158, 114, 2, 207, 189, 230, 247, 217, 191, 37, 227, 131, 193, 117, 168, 148, 209, 100, 246, 165, 195, 119, 214, 85, 175, 137, 173, 135, 248, 206, 4, 49, 252, 205, 136, 26, 245, 242, 21, 233, 200, 22, 225, 201, 110, 53, 36, 123, 203, 116, 87, 99, 0, 133, 243, 177, 198, 151, 251, 31, 82, 232, 128, 108, 249, 77];
  // TOKEN_OF_BYTE[b] is the token for byte b: the token names the permuted value.
  var TOKEN_OF_BYTE = [];
  for (var _b = 0; _b < 256; _b++) TOKEN_OF_BYTE[_b] = "T" + String(PERM[_b]).padStart(3, "0");
  var BYTE_OF_TOKEN = {};
  for (var _i = 0; _i < 256; _i++) BYTE_OF_TOKEN[TOKEN_OF_BYTE[_i]] = _i;

  /* ---- Tier schema (owner, Nov 21, 2026 — replaces the old cap logic) ----
   * Licensing unit: per HANDSET, licensed per handset to the user ID.
   * A user may license as many handsets as they want, each separately.
   *   $1 tier:  40 channels + 2 privacy points (decimal points in the address)
   *   $10 tier: 80 channels (the 40 regular plus up to 80) + 4 privacy points
   *   Above 80 to 270: enterprise/commercial reserve — private addressing at
   *     4-5 decimal points, telephone-number-shaped addresses, 9,999
   *     potential employee numbers (owner's figure). Not a consumer tier.
   * House reserve: channels 261-270 held for house use; the transport
   *   layer's test pipes ride there (MTOF test pipe = channel 269),
   *   visibly separate from user channels.
   * Owner operator licence: top entitlement — full scan, all channels.
   */
  var TIERS = {
    none:       { label: "No licence", price: null, channels: 0,  privacyPoints: 0,
                  note: "This handset carries no licence yet." },
    tier1:      { label: "$1 licence (per handset)", price: 1, channels: 40, privacyPoints: 2,
                  note: "40 channels, addresses with 2 privacy points — like 12.34." },
    tier10:     { label: "$10 licence (per handset)", price: 10, channels: 80, privacyPoints: 4,
                  note: "All 80 channels, addresses with 4 privacy points — like 12.3456." },
    enterprise: { label: "Enterprise / commercial reserve", price: null, channels: 270, privacyPoints: 5,
                  note: "Channels past 80 up to 270. Private addresses shaped like phone numbers, 4-5 privacy points, up to 9,999 employee numbers. Not sold as a consumer tier." },
    operator:   { label: "Operator licence (owner)", price: null, channels: 270, privacyPoints: 5,
                  note: "Top entitlement: full scan, all channels, house reserve visible." }
  };
  var CB_BUS_MAX = 270;
  var BLOCK = 90;
  var SCAN_CEILING = 270;
  var HOUSE_RESERVE = [{ start: 261, end: 270, label: "House reserve — house use + transport test pipes" }];
  var MTOF_PIPE_CHANNEL = 269;
  var BENCH_PREVIEW_CHANNELS = 20; /* unlicensed bench preview window only — not a tier */

  function isHouseReserve(ch) {
    return HOUSE_RESERVE.some(function (r) { return ch >= r.start && ch <= r.end; });
  }
  function scanRangesFor(total) {
    var ranges = [];
    for (var start = 1; start <= total; start += BLOCK) {
      ranges.push({ start: start, end: Math.min(start + BLOCK - 1, total) });
    }
    return ranges;
  }
  function formatAddress(channel, privacyPoints, pointDigits) {
    if (!privacyPoints) return String(channel);
    var digits = String(pointDigits || 0).padStart(privacyPoints, "0").slice(0, privacyPoints);
    return channel + "." + digits;
  }
  function enumerateChannels(total) {
    var out = [];
    for (var c = 1; c <= total; c++) out.push(c);
    return out;
  }

  /* ---- MTOF encode/decode (mirrors sender.py / receiver.py) ---- */
  var CHUNK_BYTES = 8192, PLEX_COUNT = 4;
  function mtofEncode(bytes, name) {
    var chunks = [];
    if (bytes.length === 0) chunks.push(new Uint8Array(0));
    for (var i = 0; i < bytes.length; i += CHUNK_BYTES) chunks.push(bytes.slice(i, i + CHUNK_BYTES));
    var plexes = [];
    for (var r = 0; r < PLEX_COUNT; r++) plexes.push({ route: "plex-" + r, chunks: [] });
    chunks.forEach(function (chunk, seq) {
      var tokens = [];
      for (var j = 0; j < chunk.length; j++) tokens.push(TOKEN_OF_BYTE[chunk[j]]);
      plexes[seq % PLEX_COUNT].chunks.push({ seq: seq, tokens: tokens });
    });
    plexes.forEach(function (plex) {
      plex.tokenCount = plex.chunks.reduce(function (n, c) { return n + c.tokens.length; }, 0);
    });
    return {
      format: "MTOF",
      carrier: "ember-cb-bench/1 — Encrypted CB test bench, Nov 21 2026",
      payload: { name: name, sizeBytes: bytes.length, sha256: null },
      chunkBytes: CHUNK_BYTES,
      plexCount: PLEX_COUNT,
      plexes: plexes
    };
  }
  function plexStreamString(plex) {
    var toks = [];
    plex.chunks.forEach(function (c) { toks = toks.concat(c.tokens); });
    return toks.join(" ");
  }
  function mtofDecode(envelope) {
    if (!envelope || envelope.format !== "MTOF") throw new Error("not an MTOF envelope");
    var bySeq = {};
    envelope.plexes.forEach(function (plex) {
      plex.chunks.forEach(function (c) {
        var bytes = new Uint8Array(c.tokens.length);
        c.tokens.forEach(function (tok, k) {
          if (!(tok in BYTE_OF_TOKEN)) throw new Error("unknown token " + tok);
          bytes[k] = BYTE_OF_TOKEN[tok];
        });
        bySeq[c.seq] = bytes;
      });
    });
    var seqs = Object.keys(bySeq).map(Number).sort(function (a, b) { return a - b; });
    var total = seqs.reduce(function (n, s) { return n + bySeq[s].length; }, 0);
    var out = new Uint8Array(total), off = 0;
    seqs.forEach(function (s) { out.set(bySeq[s], off); off += bySeq[s].length; });
    return out;
  }

  /* ---- Portable licence tokens (ECDSA P-256, WebCrypto both sides) ---- */
  function b64uToBytes(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function parseLicenceToken(token) {
    var parts = String(token).trim().split(".");
    if (parts.length !== 2) throw new Error("licence token shape wrong");
    var payloadBytes = b64uToBytes(parts[0]);
    var payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    return { payload: payload, payloadBytes: payloadBytes, signature: b64uToBytes(parts[1]) };
  }
  async function verifyLicence(token, publicJwk) {
    var parsed = parseLicenceToken(token);
    var key = await crypto.subtle.importKey(
      "jwk", { kty: "EC", crv: "P-256", x: publicJwk.x, y: publicJwk.y },
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    var ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, key, parsed.signature, parsed.payloadBytes);
    return { valid: ok, payload: parsed.payload };
  }
  function planFromLicence(payload) {
    if (!payload) return { tier: "none", scanTotal: 0, privacyPoints: 0, recognized: false };
    var grants = payload.grants || [];
    var top = grants.indexOf("apex-full-stack") >= 0 || grants.indexOf("operator-field") >= 0 ||
              payload.tier === "operator" || payload.tier === "enterprise";
    if (top) {
      var t = payload.tier === "enterprise" ? TIERS.enterprise : TIERS.operator;
      return { tier: payload.tier === "enterprise" ? "enterprise" : "operator",
               scanTotal: t.channels, privacyPoints: t.privacyPoints, recognized: true };
    }
    if (payload.tier === "tier10") return { tier: "tier10", scanTotal: TIERS.tier10.channels, privacyPoints: TIERS.tier10.privacyPoints, recognized: true };
    if (payload.tier === "tier1")  return { tier: "tier1",  scanTotal: TIERS.tier1.channels,  privacyPoints: TIERS.tier1.privacyPoints,  recognized: true };
    return { tier: "none", scanTotal: 0, privacyPoints: 0, recognized: false };
  }

  var api = {
    PERM: PERM, TOKEN_OF_BYTE: TOKEN_OF_BYTE, BYTE_OF_TOKEN: BYTE_OF_TOKEN,
    TIERS: TIERS, CB_BUS_MAX: CB_BUS_MAX, BLOCK: BLOCK, SCAN_CEILING: SCAN_CEILING,
    HOUSE_RESERVE: HOUSE_RESERVE, MTOF_PIPE_CHANNEL: MTOF_PIPE_CHANNEL,
    BENCH_PREVIEW_CHANNELS: BENCH_PREVIEW_CHANNELS,
    isHouseReserve: isHouseReserve, formatAddress: formatAddress,
    scanRangesFor: scanRangesFor, enumerateChannels: enumerateChannels,
    mtofEncode: mtofEncode, mtofDecode: mtofDecode, plexStreamString: plexStreamString,
    parseLicenceToken: parseLicenceToken, verifyLicence: verifyLicence, planFromLicence: planFromLicence
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CBCore = api;
})(typeof window !== "undefined" ? window : globalThis);
