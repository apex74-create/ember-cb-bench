/* EMBER CB test bench — page logic. Vanilla JS, no build step. */
"use strict";
var C = window.CBCore;

/* Bench licence issuer public key (the private half never leaves the
   issuer's desk; this page can only CHECK licences, never mint them). */
var BENCH_PUBLIC_JWK = { x: "wD-4fWuJTladnFCxvbS5DjbX9iKGvkkOx-3McQyADGE", y: "3XDNkYwuBo5-ngyZ6PPOmMFfOxG5U-IFwhNcghFdIrA" };

function $(id) { return document.getElementById(id); }
async function sha256hex(data) {
  var buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
function handsetId() {
  var id = localStorage.getItem("embercb.handset");
  if (!id) {
    id = "HS-" + Array.from(crypto.getRandomValues(new Uint8Array(3)))
      .map(function (b) { return b.toString(16).padStart(2, "0"); }).join("").toUpperCase();
    localStorage.setItem("embercb.handset", id);
  }
  return id;
}

var entitlement = { tier: "none", scanTotal: 0, privacyPoints: 0, recognized: false };
var licencePayload = null;

function renderTiers() {
  var rows = ["<tr><th>Licence</th><th>Channels</th><th>Addresses</th><th>What it means</th></tr>"];
  ["tier1", "tier10", "enterprise", "operator"].forEach(function (k) {
    var t = C.TIERS[k];
    var addr = k === "tier1" ? "2 privacy points — like 12.34"
             : k === "tier10" ? "4 privacy points — like 12.3456"
             : "4–5 privacy points, shaped like phone numbers";
    rows.push("<tr" + (entitlement.tier === k ? ' class="current"' : "") + "><td><b>" + t.label +
      "</b></td><td>" + t.channels + "</td><td>" + addr + "</td><td>" + t.note + "</td></tr>");
  });
  $("tier-table").innerHTML = rows.join("");
  $("reserve-strip").innerHTML =
    "HOUSE RESERVE · channels 261–270 are held for house use. The MTOF test pipe rides channel " +
    C.MTOF_PIPE_CHANNEL + " — house traffic stays on house channels, apart from user channels.";
}

async function applyLicence(token, source) {
  var state = $("licence-state");
  try {
    var res = await C.verifyLicence(token, BENCH_PUBLIC_JWK);
    if (!res.valid) {
      entitlement = { tier: "none", scanTotal: 0, privacyPoints: 0, recognized: false };
      licencePayload = null;
      state.className = "state bad";
      state.textContent = "That licence did not check out — the signature does not match. Nothing was opened.";
      renderTiers(); renderScanHead(); return;
    }
    licencePayload = res.payload;
    entitlement = C.planFromLicence(res.payload);
    localStorage.setItem("embercb.licence", token);
    state.className = "state ok";
    state.textContent = "LICENCE RECOGNIZED — " + res.payload.holder + " · " +
      C.TIERS[entitlement.tier].label + " · scan opens to channel " + entitlement.scanTotal + ".";
    $("handset-line").textContent =
      "Licensed to user " + (res.payload.userId || res.payload.holder) + ", per handset. " +
      "This handset is recorded in this bench as " + handsetId() + " (" + source + "). " +
      "The same licence pasted on another handset or browser is recognized there too — the licence travels with you, not with one browser's memory.";
  } catch (e) {
    state.className = "state bad";
    state.textContent = "That paste is not a licence token (" + e.message + ").";
  }
  renderTiers(); renderScanHead();
}

$("licence-apply").addEventListener("click", function () {
  var v = $("licence-input").value.trim();
  if (v) applyLicence(v, "pasted on this handset");
});
$("licence-clear").addEventListener("click", function () {
  localStorage.removeItem("embercb.licence");
  entitlement = { tier: "none", scanTotal: 0, privacyPoints: 0, recognized: false };
  licencePayload = null;
  $("licence-state").className = "state bad";
  $("licence-state").textContent = "Licence forgotten on this handset.";
  $("handset-line").textContent = "";
  renderTiers(); renderScanHead();
});

/* ---- Scan ---- */
var sweepTimer = null;
function effectiveScanTotal() {
  return entitlement.recognized ? entitlement.scanTotal : C.BENCH_PREVIEW_CHANNELS;
}
function renderScanHead() {
  var total = effectiveScanTotal();
  var ranges = C.scanRangesFor(total).map(function (r) { return r.start + "–" + r.end; }).join(" · ");
  $("scan-ranges").innerHTML =
    (entitlement.recognized
      ? "Your licence opens <b>" + total + " channels</b>, swept in blocks: " + ranges + "."
      : "No licence: bench preview only, channels 1–" + total + ". License a tier to open the band.") +
    " Blocks past 20, 40 and 80 unlock with the licence tiers shown above.";
}
$("scan-start").addEventListener("click", function () {
  if (sweepTimer) return;
  var total = effectiveScanTotal();
  var channels = C.enumerateChannels(total);
  var marks = { 20: false, 40: false, 80: false };
  var i = 0;
  sweepTimer = setInterval(function () {
    if (i >= channels.length) { stopSweep(); $("scan-readout").innerHTML = "DONE<div class='addr'>swept 1–" + total + "</div>"; return; }
    var ch = channels[i++];
    var addr = C.formatAddress(ch, entitlement.privacyPoints, ch * 7 % 100000);
    var flag = C.isHouseReserve(ch) ? " · HOUSE RESERVE" : (ch === C.MTOF_PIPE_CHANNEL ? " · MTOF TEST PIPE" : "");
    $("scan-readout").innerHTML = ch + "<span class='addr'>address " + addr + flag + "</span>";
    [20, 40, 80].forEach(function (m) {
      if (ch > m && !marks[m]) { marks[m] = true; $("scan-ranges").innerHTML += " ✓ past " + m; }
    });
  }, 28);
});
function stopSweep() { if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; } }
$("scan-stop").addEventListener("click", stopSweep);

/* ---- MTOF message path ---- */
var lastEnvelope = null;
function log(line) { $("mtof-log").textContent += ($("mtof-log").textContent ? "\n" : "") + line; }
async function sealEnvelope(bytes, name) {
  var env = C.mtofEncode(bytes, name);
  env.payload.sha256 = await sha256hex(bytes);
  for (var p = 0; p < env.plexes.length; p++) {
    env.plexes[p].tokenStreamSha256 = await sha256hex(new TextEncoder().encode(C.plexStreamString(env.plexes[p])));
  }
  return env;
}
async function openEnvelope(env) {
  for (var p = 0; p < env.plexes.length; p++) {
    var h = await sha256hex(new TextEncoder().encode(C.plexStreamString(env.plexes[p])));
    if (h !== env.plexes[p].tokenStreamSha256) return { ok: false, why: "plex " + p + " stream hash mismatch" };
  }
  var bytes = C.mtofDecode(env);
  var h2 = await sha256hex(bytes);
  if (h2 !== env.payload.sha256 || bytes.length !== env.payload.sizeBytes) return { ok: false, why: "payload hash mismatch" };
  return { ok: true, text: new TextDecoder().decode(bytes), sha256: h2 };
}
$("msg-send").addEventListener("click", async function () {
  var text = $("msg-input").value;
  if (!text) return;
  $("mtof-log").textContent = "";
  var bytes = new TextEncoder().encode(text);
  var env = await sealEnvelope(bytes, "ember-cb-message.txt");
  lastEnvelope = env;
  var totalTokens = env.plexes.reduce(function (n, p) { return n + p.tokenCount; }, 0);
  log("sealed on house channel " + C.MTOF_PIPE_CHANNEL + " (house reserve)");
  log("payload sha256  " + env.payload.sha256);
  log(totalTokens + " tokens over " + env.plexCount + " plex routes · envelope " +
      new TextEncoder().encode(JSON.stringify(env)).length + " bytes");
  var opened = await openEnvelope(env);
  var out = $("msg-out");
  out.hidden = false;
  if (opened.ok) {
    out.className = "state ok";
    out.textContent = "FAR END OPENED IT · hash MATCH ✓ · message: “" + opened.text + "”";
  } else {
    out.className = "state bad";
    out.textContent = "FAR END REFUSED IT — " + opened.why;
  }
});
$("msg-download").addEventListener("click", function () {
  if (!lastEnvelope) { log("nothing sealed yet — send a message first."); return; }
  var blob = new Blob([JSON.stringify(lastEnvelope)], { type: "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "ember-cb-envelope.mtof.json"; a.click();
  URL.revokeObjectURL(a.href);
});
$("msg-open").addEventListener("change", async function (ev) {
  var f = ev.target.files[0]; if (!f) return;
  try {
    var env = JSON.parse(await f.text());
    var opened = await openEnvelope(env);
    var out = $("msg-out");
    out.hidden = false;
    out.className = opened.ok ? "state ok" : "state bad";
    out.textContent = opened.ok
      ? "ENVELOPE FROM ANOTHER SEAT OPENED · hash MATCH ✓ · message: “" + opened.text + "”"
      : "ENVELOPE REFUSED — " + opened.why;
  } catch (e) { log("could not open that file: " + e.message); }
});

/* ---- Boot: licence from URL (?licence=) or this handset's memory ---- */
(function boot() {
  renderTiers(); renderScanHead();
  var fromUrl = new URLSearchParams(location.search).get("licence");
  var saved = localStorage.getItem("embercb.licence");
  if (fromUrl) applyLicence(fromUrl, "arrived by link");
  else if (saved) applyLicence(saved, "remembered on this handset");
})();
