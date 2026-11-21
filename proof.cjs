/* proof.cjs — scripted licensed-seat + MTOF-interop proof for EMBER CB.
   Run: node proof.cjs   (exit 0 = all proofs pass) */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const C = require("./site/cb-core.js");

const HERE = __dirname;
const GH = "/home/hatch/workspace/custom-connectors/custom.github/bin/gh_api.py";
let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? "PASS" : "FAIL") + " · " + name + (detail ? " · " + detail : ""));
  if (!cond) failures++;
}
const sha256hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
const b64u = (b) => Buffer.from(b).toString("base64url");

async function main() {
  /* 1 — MTOF dictionary: JS core vs the Python format derivation */
  const dict = JSON.parse(fs.readFileSync(path.join(HERE, "mtof-dict.json"), "utf8"));
  check("MTOF dictionary identical to sender.py/receiver.py derivation",
    JSON.stringify(C.TOKEN_OF_BYTE) === JSON.stringify(dict.tokenOfByte),
    "256 tokens compared");

  /* 2 — Owner operator licence: recognized */
  const pub = JSON.parse(fs.readFileSync(path.join(HERE, "bench-issuer-public.json"), "utf8"));
  const token = fs.readFileSync(path.join(HERE, "owner-licence-token.txt"), "utf8").trim();
  const res = await C.verifyLicence(token, pub);
  check("owner licence signature verifies", res.valid === true);
  check("licence holder is the owner", res.payload.holder === "Anthony Walton Bentley", res.payload.holder);
  const ent = C.planFromLicence(res.payload);
  check("owner licence resolves to top entitlement", ent.recognized && ent.tier === "operator",
    "tier=" + ent.tier + " scanTotal=" + ent.scanTotal + " privacyPoints=" + ent.privacyPoints);

  /* 2b — a tampered licence is refused */
  const parts = token.split(".");
  const badSig = parts[1].slice(0, -2) + (parts[1].endsWith("AA") ? "BB" : "AA");
  const tampered = await C.verifyLicence(parts[0] + "." + badSig, pub);
  check("tampered licence refused", tampered.valid === false);

  /* 3 — Licensed-seat scan: past 20, past 40, into the 80s and beyond */
  const chans = C.enumerateChannels(ent.scanTotal);
  check("operator enumeration covers 270 channels", chans.length === 270, "1.." + chans[chans.length - 1]);
  check("enumeration goes past 20", chans.includes(21));
  check("enumeration goes past 40", chans.includes(41));
  check("enumeration goes into the 80s", chans.includes(80) && chans.includes(90));
  const ranges = C.scanRangesFor(ent.scanTotal);
  check("scan ranges are the three 90-blocks",
    JSON.stringify(ranges) === JSON.stringify([
      { start: 1, end: 90 }, { start: 91, end: 180 }, { start: 181, end: 270 }]),
    JSON.stringify(ranges));
  check("house reserve carved out at 261-270",
    C.isHouseReserve(261) && C.isHouseReserve(270) && !C.isHouseReserve(260));
  check("MTOF test pipe rides house reserve ch 269",
    C.MTOF_PIPE_CHANNEL === 269 && C.isHouseReserve(C.MTOF_PIPE_CHANNEL));

  /* 3b — consumer tiers resolve per the owner's schema */
  const priv = crypto.createPrivateKey({ key: JSON.parse(fs.readFileSync(path.join(HERE, "bench-issuer-private.json"), "utf8")), format: "jwk" });
  async function tierSeat(tier) {
    const payload = { format: "APEX-LICENCE/1", holder: "Bench Seat", userId: "bench", tier, grants: [], issued: "2026-11-21", expires: null };
    const s = JSON.stringify(payload);
    const sig = crypto.sign("sha256", Buffer.from(s), { key: priv, dsaEncoding: "ieee-p1363" });
    const t = b64u(s) + "." + b64u(sig);
    const v = await C.verifyLicence(t, pub);
    return C.planFromLicence(v.payload);
  }
  const t1 = await tierSeat("tier1");
  check("$1 tier: 40 channels + 2 privacy points", t1.scanTotal === 40 && t1.privacyPoints === 2,
    "scanTotal=" + t1.scanTotal);
  check("$1 tier enumerates past 20", C.enumerateChannels(t1.scanTotal).includes(21) &&
    !C.enumerateChannels(t1.scanTotal).includes(41));
  const t10 = await tierSeat("tier10");
  check("$10 tier: 80 channels + 4 privacy points", t10.scanTotal === 80 && t10.privacyPoints === 4,
    "scanTotal=" + t10.scanTotal);
  check("$10 tier enumerates past 40 and up to 80, not past it",
    C.enumerateChannels(t10.scanTotal).includes(80) && !C.enumerateChannels(t10.scanTotal).includes(81));

  /* 4 — MTOF interop: this bench seals, the ORIGINAL python receiver opens */
  const msg = "EMBER CB bench check — MTOF pipe test, Nov 21 2026. House channel 269.";
  const bytes = new TextEncoder().encode(msg);
  const env = C.mtofEncode(bytes, "ember-cb-message.txt");
  env.payload.sha256 = sha256hex(bytes);
  env.plexes.forEach((p) => { p.tokenStreamSha256 = sha256hex(Buffer.from(C.plexStreamString(p), "utf8")); });
  const envJson = JSON.stringify(env);
  const body = { message: "EMBER CB bench: MTOF interop envelope (JS core -> python receiver proof)", content: Buffer.from(envJson).toString("base64") };
  try {
    const existing = JSON.parse(execFileSync("python3", [GH, "GET", "/repos/apex74-create/mtof-pipe/contents/bench-message.mtof.json"], { encoding: "utf8" }));
    if (existing.sha) body.sha = existing.sha;
  } catch (e) { /* new file */ }
  execFileSync("python3", [GH, "PUT", "/repos/apex74-create/mtof-pipe/contents/bench-message.mtof.json", JSON.stringify(body)], { encoding: "utf8" });
  console.log("published envelope to pipe.apex-airsolutions.com/bench-message.mtof.json — waiting for the pipe to serve it");
  const url = "http://pipe.apex-airsolutions.com/bench-message.mtof.json";
  let served = false;
  for (let i = 0; i < 24 && !served; i++) {
    try {
      const got = execFileSync("curl", ["-s", url], { encoding: "utf8" });
      served = got.includes(env.payload.sha256);
    } catch (e) { /* retry */ }
    if (!served) await new Promise((r) => setTimeout(r, 5000));
  }
  check("pipe serves the bench envelope over plain http", served, url);
  if (served) {
    const out = execFileSync("python3", [
      "/home/hatch/workspace/mtof-proof/receiver.py", url,
      path.join(HERE, "proof-received.txt"), path.join(HERE, "proof-receiver-log.json")
    ], { encoding: "utf8" });
    console.log(out.trim());
    const log = JSON.parse(fs.readFileSync(path.join(HERE, "proof-receiver-log.json"), "utf8"));
    check("original receiver.py: far-end hash MATCH over http",
      log.match === true && log.scheme === "http",
      "origin " + log.originSha256FromEnvelope.slice(0, 16) + "… far " + log.farEndSha256.slice(0, 16) + "…");
    check("message round-tripped word for word",
      fs.readFileSync(path.join(HERE, "proof-received.txt"), "utf8") === msg);
  }

  console.log(failures === 0 ? "\nALL PROOFS PASS" : "\n" + failures + " PROOF(S) FAILED");
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("PROOF ERROR", e); process.exit(2); });
