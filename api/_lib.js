// Shared Innertube logic — ported from the original server actions.
//
// Includes:
//  - 2026-11-22 anti bot-check fix: 9 client versions, merged formats,
//    10-minute cache, and 3 passes with escalating pauses.
//  - 2026-11-22 download-via-server fix: every format keeps the name of
//    the Innertube client that served it, the merge keeps per-client
//    variants of the same itag separate, and candidate lists are ordered
//    for the server download step (see api/download.js). Signed
//    googlevideo URLs are bound to the resolving server's egress IP, so
//    handing them straight to the visitor's browser made downloads fail
//    even when conversion succeeded — the server now fetches the bytes
//    itself first (yt-dlp style: fetch the file, then serve the file).
//
// Public Innertube client key (same key YouTube's own web client uses,
// embedded in youtube.com pages). Override with YT_INNERTUBE_KEY env.
const INNERTUBE_KEY = process.env.YT_INNERTUBE_KEY || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const VR_UA = "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1)";
const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const MAX_FILE_BYTES = 256 * 1024 * 1024;

function parseVideoId(input) {
  const text = (input || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const pats = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/shorts\/([A-Za-z0-9_-]{11})/,
    /\/live\/([A-Za-z0-9_-]{11})/,
    /\/embed\/([A-Za-z0-9_-]{11})/,
    /\/v\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of pats) { const m = text.match(re); if (m && m[1]) return m[1]; }
  return null;
}
function looksLikeUrl(t) {
  return /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test((t || "").trim());
}

// Anti bot-check chain: YouTube judges every client VERSION
// independently, so the chain carries several versions of the same
// families as independent chances — ANDROID_VR 1.65.10 / 1.60.19 /
// 1.50.23, ANDROID 20.10.38 / 20.30.36 / 20.14.38, IOS 20.10.4 /
// 20.14.38, plus VISIONOS. Only 20.x+ ANDROID/IOS versions are used
// (older ones are rejected by YouTube with HTTP 400).
const PLAYER_CLIENTS = [
  { ua: VR_UA, client: { clientName: "ANDROID_VR", clientVersion: "1.65.10", deviceModel: "Oculus Quest 3", androidSdkVersion: 32, hl: "en" } },
  { ua: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1)", client: { clientName: "ANDROID_VR", clientVersion: "1.60.19", deviceModel: "Oculus Quest 3", androidSdkVersion: 32, hl: "en" } },
  { ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip", client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, osName: "Android", osVersion: "11", hl: "en", gl: "US" } },
  { ua: "com.google.android.youtube/20.30.36 (Linux; U; Android 11) gzip", client: { clientName: "ANDROID", clientVersion: "20.30.36", androidSdkVersion: 30, osName: "Android", osVersion: "11", hl: "en", gl: "US" } },
  { ua: "com.google.android.youtube/20.14.38 (Linux; U; Android 11) gzip", client: { clientName: "ANDROID", clientVersion: "20.14.38", androidSdkVersion: 30, osName: "Android", osVersion: "11", hl: "en", gl: "US" } },
  { ua: "com.google.android.apps.youtube.vr.oculus/1.50.23 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1)", client: { clientName: "ANDROID_VR", clientVersion: "1.50.23", deviceModel: "Oculus Quest 3", androidSdkVersion: 32, hl: "en" } },
  { ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)", client: { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iOS", osVersion: "18.3.2.22D82", hl: "en", gl: "US" } },
  { ua: "com.google.ios.youtube/20.14.38 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)", client: { clientName: "IOS", clientVersion: "20.14.38", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iOS", osVersion: "18.3.2.22D82", hl: "en", gl: "US" } },
  { ua: "com.google.ios.youtube/20.10.4 (RealityFamily12,2; U; CPU visionOS 2_3 like Mac OS X;)", client: { clientName: "VISIONOS", clientVersion: "1.02", deviceMake: "Apple", deviceModel: "RealityFamily12,2", osName: "visionOS", osVersion: "2.3.23M1003", hl: "en", gl: "US" } },
];

async function fetchPlayerOnce(spec, videoId) {
  let res;
  try {
    res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": spec.ua },
      body: JSON.stringify({ context: { client: spec.client }, videoId, racyCheckOk: true, contentCheckOk: true }),
    });
  } catch { return { ok: false, kind: "other", reason: "" }; }
  if (!res.ok) return { ok: false, kind: "other", reason: "" };
  const j = await res.json();
  const status = j.playabilityStatus?.status, reason = j.playabilityStatus?.reason || "";
  const formats = j.streamingData?.formats || [], adaptiveFormats = j.streamingData?.adaptiveFormats || [];
  if (status === "OK" && [...formats, ...adaptiveFormats].some((f) => f.url)) {
    // Tag every format with the client that served it: the same itag
    // from a different client is a different signed URL with different
    // download behaviour (ANDROID_VR's muxed itag-18 URL answers 403
    // even from its bound IP while ANDROID's identical itag downloads
    // fine), so variants must survive the merge separately.
    const clientName = spec.client.clientName || "";
    return {
      ok: true,
      data: {
        title: j.videoDetails?.title || "",
        author: j.videoDetails?.author || "",
        durationSeconds: Number(j.videoDetails?.lengthSeconds || 0) || 0,
        formats: formats.map((f) => ({ ...f, client: clientName })),
        adaptiveFormats: adaptiveFormats.map((f) => ({ ...f, client: clientName })),
      },
    };
  }
  if (/private/i.test(reason)) return { ok: false, kind: "private", reason };
  if (/live stream|live/i.test(reason)) return { ok: false, kind: "live", reason };
  if (/age/i.test(reason)) return { ok: false, kind: "age", reason };
  if (status === "LOGIN_REQUIRED" || /sign in|login|not a bot/i.test(reason)) return { ok: false, kind: "bot", reason };
  return { ok: false, kind: "other", reason };
}

const cache = new Map(); const TTL = 10 * 60 * 1000;
function hasMuxed(d) { return d.formats.some((f) => f.url && (f.mimeType || "").startsWith("video/mp4")); }
function hasAudio(d) { return d.adaptiveFormats.some((f) => f.url && (f.mimeType || "").startsWith("audio/")); }

// Unions two OK player responses. Deduped by itag + mime/track +
// CLIENT, so per-client variants of the same itag all survive: the
// download step may need to fall through from a client whose URL
// refuses to one whose URL works.
function merge(base, next) {
  if (!base) return next;
  const sf = new Set(base.formats.map((f) => `${f.itag}|${f.mimeType || ""}|${f.client || ""}`));
  const formats = [...base.formats];
  for (const f of next.formats) {
    const k = `${f.itag}|${f.mimeType || ""}|${f.client || ""}`;
    if (!sf.has(k)) { sf.add(k); formats.push(f); }
  }
  const sa = new Set(base.adaptiveFormats.map((f) => `${f.itag}|${f.audioTrack?.displayName || ""}|${f.client || ""}`));
  const adaptiveFormats = [...base.adaptiveFormats];
  for (const f of next.adaptiveFormats) {
    const k = `${f.itag}|${f.audioTrack?.displayName || ""}|${f.client || ""}`;
    if (!sa.has(k)) { sa.add(k); adaptiveFormats.push(f); }
  }
  return {
    title: base.title || next.title,
    author: base.author || next.author,
    durationSeconds: base.durationSeconds || next.durationSeconds,
    formats, adaptiveFormats,
  };
}

async function fetchPlayer(videoId, opts) {
  if (!opts?.skipCache) {
    const c = cache.get(videoId);
    if (c && Date.now() - c.at < TTL) return c.data;
  }
  // fullWalk: one pass over EVERY client without the early stop, so
  // the merged set carries every client's variant of every format.
  // The download step uses this for its second round: freshly signed
  // URLs of clients the first walk never reached (IOS, VISIONOS, the
  // other ANDROID versions) are independent sessions that may still
  // serve their bytes when the first ones are clamped.
  const fullWalk = opts?.fullWalk === true;
  let otherReason = "", merged = null;
  // Three passes with escalating pauses (1500ms, 4000ms): the bot
  // check is intermittent per client/IP, so re-walking the 9-client
  // chain rescues videos refused on the first attempt.
  const PASS_PAUSES_MS = [1500, 4000];
  const maxPasses = fullWalk ? 1 : 3;
  for (let pass = 0; pass < maxPasses; pass++) {
    let sawBot = false;
    for (const spec of PLAYER_CLIENTS) {
      const r = await fetchPlayerOnce(spec, videoId);
      if (r.ok) {
        merged = merge(merged, r.data);
        if (!fullWalk && hasMuxed(merged) && hasAudio(merged)) {
          cache.set(videoId, { data: merged, at: Date.now() });
          return merged;
        }
        continue;
      }
      if (r.kind === "bot") { sawBot = true; continue; }
      if (!merged) {
        if (r.kind === "private") throw new Error("Video ini privat dan tidak bisa dikonversi.");
        if (r.kind === "live") throw new Error("Siaran langsung tidak bisa dikonversi.");
        if (r.kind === "age") throw new Error("Video ini dibatasi usia oleh YouTube, jadi belum bisa dikonversi. Coba video lain ya.");
      }
      if (r.reason) otherReason = r.reason;
    }
    if (merged && hasMuxed(merged) && hasAudio(merged)) break;
    if (!merged && !sawBot) break;
    if (pass + 1 >= maxPasses) break;
    const pause = PASS_PAUSES_MS[pass];
    if (pause) await new Promise((r) => setTimeout(r, pause));
  }
  if (merged) { cache.set(videoId, { data: merged, at: Date.now() }); return merged; }
  if (/unavailable|not available/i.test(otherReason)) throw new Error("Video ini tidak tersedia di YouTube (mungkin sudah dihapus atau dibatasi). Coba video lain ya.");
  if (otherReason) throw new Error(`Video tidak bisa diputar: ${otherReason}`);
  throw new Error("YouTube sedang membatasi akses ke video ini (cek bot / perlu login), jadi belum bisa dikonversi. Coba lagi sebentar, atau coba video lain ya.");
}

async function fetchOembed(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`);
    if (!res.ok) return null;
    const j = await res.json();
    return { title: j.title || "", author: j.author_name || "" };
  } catch { return null; }
}
function audioTracksOf(p) {
  const seen = new Map();
  for (const f of p.adaptiveFormats) {
    const n = f.audioTrack?.displayName;
    if (n && !seen.has(n)) seen.set(n, n);
  }
  return [...seen.entries()].map(([id, label]) => ({ id, label }));
}

// Audio candidates in download preference order: the requested track
// (or all tracks for "Asli"), MP4/AAC first, then by bitrate. Every
// per-client variant is kept — the download step walks this list
// until one client's URL actually serves its bytes.
function audioCandidates(p, track) {
  let a = p.adaptiveFormats.filter((f) => f.url && (f.mimeType || "").startsWith("audio/"));
  if (track && track !== "Asli") {
    const d = a.filter((f) => f.audioTrack?.displayName === track);
    if (d.length) a = d;
  }
  const mp4 = a.filter((f) => (f.mimeType || "").startsWith("audio/mp4")).sort((x, y) => (y.bitrate || 0) - (x.bitrate || 0));
  const rest = a.filter((f) => !(f.mimeType || "").startsWith("audio/mp4")).sort((x, y) => (y.bitrate || 0) - (x.bitrate || 0));
  return [...mp4, ...rest];
}
function pickAudio(p, track) { return audioCandidates(p, track)[0] || null; }

// Muxed MP4 candidates, best quality first. At equal quality the
// ANDROID_VR variant goes last: its muxed itag-18 URL answers 403
// even from the IP it was issued to, while the ANDROID client's
// identical itag downloads fine — trying the working family first
// saves a refused request, and the download loop still falls through
// to every variant if needed.
function muxedCandidates(p) {
  const m = p.formats.filter((f) => f.url && (f.mimeType || "").startsWith("video/mp4"));
  return m.sort((a, b) => {
    const q = parseInt(b.qualityLabel || "0", 10) - parseInt(a.qualityLabel || "0", 10);
    if (q !== 0) return q;
    const av = a.client === "ANDROID_VR" ? 1 : 0;
    const bv = b.client === "ANDROID_VR" ? 1 : 0;
    return av - bv;
  });
}
function pickMuxed(p) { return muxedCandidates(p)[0] || null; }

function extAndLabel(fmt, mode) {
  const mime = fmt.mimeType || "", kbps = Math.round((fmt.bitrate || 0) / 1000);
  if (mode === "mp3") {
    if (mime.startsWith("audio/mp4")) return { ext: "m4a", container: "M4A", label: `Audio ${kbps} kbps` };
    if (mime.startsWith("audio/webm")) return { ext: "webm", container: "WebM", label: `Audio ${kbps} kbps` };
    return { ext: "mp3", container: "MP3", label: `Audio ${kbps} kbps` };
  }
  return { ext: "mp4", container: "MP4", label: fmt.qualityLabel ? `Video ${fmt.qualityLabel}` : "Video MP4" };
}
function safeFilename(title, ext) {
  const c = (title || "").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${c || "video"}.${ext}`;
}
async function buildInfo(videoId) {
  const [player, oembed] = await Promise.all([fetchPlayer(videoId), fetchOembed(videoId)]);
  const audio = pickAudio(player, "Asli"), muxed = pickMuxed(player);
  return {
    player,
    info: {
      videoId,
      title: oembed?.title || player.title || videoId,
      author: oembed?.author || player.author || "",
      durationSeconds: player.durationSeconds,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      hasMp4: !!muxed,
      mp4Label: muxed?.qualityLabel ? `MP4 ${muxed.qualityLabel}` : "",
      audioLabel: audio ? `Audio ${Math.round((audio.bitrate || 0) / 1000)} kbps` : "",
      audioTracks: audioTracksOf(player),
    },
  };
}
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
async function readBody(req) {
  if (req.body) {
    if (typeof req.body === "string") { try { return JSON.parse(req.body || "{}"); } catch { return {}; } }
    return req.body;
  }
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } });
  });
}
module.exports = {
  parseVideoId, looksLikeUrl, fetchPlayer, fetchOembed, buildInfo,
  pickAudio, pickMuxed, audioCandidates, muxedCandidates,
  extAndLabel, safeFilename, INNERTUBE_KEY, WEB_UA, MAX_FILE_BYTES,
  cors, readBody,
};
