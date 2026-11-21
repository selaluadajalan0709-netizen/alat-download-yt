// Shared YouTube extraction logic — Multi-Engine Anti Bot-Check v2
// Engines:
//   1. Custom Cobalt API (env COBALT_API_URL or user-supplied)
//   2. Innertube API with fresh visitorData + embedded clients (parallel batches) + optional YT_COOKIES
//   3. Public Cobalt API instances (auto-discovered & raced)
//   4. Public Piped API instances (auto-discovered & raced)
//   5. Public Invidious API instances (auto-discovered & raced)

const INNERTUBE_KEY = process.env.YT_INNERTUBE_KEY || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
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
    /\/v\/([A-Za-z0-9_-]{11})/
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function looksLikeUrl(t) {
  return /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test((t || "").trim());
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 6500) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// 1. Metadata via YouTube oEmbed (rarely bot-blocked)
// ---------------------------------------------------------------------------
async function fetchOembed(videoId) {
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      { headers: { "User-Agent": WEB_UA } },
      4000
    );
    if (!res.ok) return null;
    const j = await res.json();
    return { title: j.title || "", author: j.author_name || "" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. Dynamic visitorData for Innertube (reduces bot-check false positives)
// ---------------------------------------------------------------------------
let visitorCache = { value: "", at: 0 };
const VISITOR_TTL = 20 * 60 * 1000;

async function getVisitorData() {
  if (visitorCache.value && Date.now() - visitorCache.at < VISITOR_TTL) {
    return visitorCache.value;
  }
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/youtubei/v1/visitor_id?key=${INNERTUBE_KEY}&prettyPrint=false`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": WEB_UA },
        body: JSON.stringify({
          context: { client: { clientName: "WEB", clientVersion: "2.20250115.01.00", hl: "en", gl: "US" } }
        })
      },
      3500
    );
    if (res.ok) {
      const j = await res.json();
      const vd = j?.responseContext?.visitorData || "";
      if (vd) {
        visitorCache = { value: vd, at: Date.now() };
        return vd;
      }
    }
  } catch {}
  return "";
}

// ---------------------------------------------------------------------------
// 3. Innertube Client Batches (Embedded + VR + Mobile)
// ---------------------------------------------------------------------------
const INNERTUBE_BATCHES = [
  // Batch 1: Embedded & VR clients (most resilient against datacenter bot checks)
  [
    {
      id: "56",
      ua: WEB_UA,
      embed: true,
      client: { clientName: "WEB_EMBEDDED_PLAYER", clientVersion: "1.20250115.01.00", hl: "en", gl: "US" }
    },
    {
      id: "85",
      ua: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version",
      embed: true,
      client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0", hl: "en", gl: "US" }
    },
    {
      id: "28",
      ua: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1)",
      client: { clientName: "ANDROID_VR", clientVersion: "1.65.10", deviceModel: "Oculus Quest 3", androidSdkVersion: 32, hl: "en", gl: "US" }
    },
    {
      id: "5",
      ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
      client: { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iOS", osVersion: "18.3.2.22D82", hl: "en", gl: "US" }
    }
  ],
  // Batch 2: Android, MWeb, older VR & VisionOS
  [
    {
      id: "3",
      ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
      client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, osName: "Android", osVersion: "11", hl: "en", gl: "US" }
    },
    {
      id: "2",
      ua: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      client: { clientName: "MWEB", clientVersion: "2.20250115.01.00", hl: "en", gl: "US" }
    },
    {
      id: "28",
      ua: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1)",
      client: { clientName: "ANDROID_VR", clientVersion: "1.60.19", deviceModel: "Oculus Quest 3", androidSdkVersion: 32, hl: "en", gl: "US" }
    },
    {
      id: "5",
      ua: "com.google.ios.youtube/20.10.4 (RealityFamily12,2; U; CPU visionOS 2_3 like Mac OS X;)",
      client: { clientName: "VISIONOS", clientVersion: "1.02", deviceMake: "Apple", deviceModel: "RealityFamily12,2", osName: "visionOS", osVersion: "2.3.23M1003", hl: "en", gl: "US" }
    }
  ]
];

async function fetchInnertubeClient(spec, videoId, visitorData) {
  const cookies = (process.env.YT_COOKIES || process.env.YT_COOKIE || "").trim();
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": spec.ua,
    "X-YouTube-Client-Name": spec.id,
    "X-YouTube-Client-Version": spec.client.clientVersion,
    "Origin": "https://www.youtube.com",
    "Referer": `https://www.youtube.com/watch?v=${videoId}`
  };
  if (visitorData) headers["X-Goog-Visitor-Id"] = visitorData;
  if (cookies) headers["Cookie"] = cookies;

  const clientObj = visitorData ? { ...spec.client, visitorData } : { ...spec.client };
  const payload = {
    context: {
      client: clientObj,
      ...(spec.embed ? { thirdParty: { embedUrl: "https://www.youtube.com/" } } : {})
    },
    videoId,
    racyCheckOk: true,
    contentCheckOk: true
  };

  let res;
  try {
    res = await fetchWithTimeout(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`,
      { method: "POST", headers, body: JSON.stringify(payload) },
      5500
    );
  } catch {
    return { ok: false, kind: "other", reason: "" };
  }
  if (!res.ok) return { ok: false, kind: "other", reason: `HTTP ${res.status}` };

  let j;
  try { j = await res.json(); } catch { return { ok: false, kind: "other", reason: "" }; }

  const status = j.playabilityStatus?.status;
  const reason = j.playabilityStatus?.reason || "";
  const formats = (j.streamingData?.formats || []).filter(f => f.url);
  const adaptiveFormats = (j.streamingData?.adaptiveFormats || []).filter(f => f.url);

  if (status === "OK" && (formats.length || adaptiveFormats.length)) {
    return {
      ok: true,
      data: {
        source: "Innertube",
        title: j.videoDetails?.title || "",
        author: j.videoDetails?.author || "",
        durationSeconds: Number(j.videoDetails?.lengthSeconds || 0) || 0,
        formats,
        adaptiveFormats
      }
    };
  }
  if (/private/i.test(reason)) return { ok: false, kind: "private", reason };
  if (/live stream|live/i.test(reason)) return { ok: false, kind: "live", reason };
  if (/age/i.test(reason)) return { ok: false, kind: "age", reason };
  if (status === "LOGIN_REQUIRED" || /sign in|login|not a bot/i.test(reason)) return { ok: false, kind: "bot", reason };
  return { ok: false, kind: "other", reason };
}

function hasMuxed(d) {
  return (d?.formats || []).some(f => f.url && (f.mimeType || "").startsWith("video/mp4"));
}

function hasAudio(d) {
  return (d?.adaptiveFormats || []).some(f => f.url && (f.mimeType || "").startsWith("audio/"));
}

function mergePlayerData(base, next) {
  if (!base) return next;
  const sf = new Set(base.formats.map(f => `${f.itag || ""}|${f.mimeType || ""}|${f.qualityLabel || ""}`));
  const formats = [...base.formats];
  for (const f of next.formats) {
    const k = `${f.itag || ""}|${f.mimeType || ""}|${f.qualityLabel || ""}`;
    if (!sf.has(k)) { sf.add(k); formats.push(f); }
  }
  const sa = new Set(base.adaptiveFormats.map(f => `${f.itag || ""}|${f.audioTrack?.displayName || ""}|${f.bitrate || ""}`));
  const adaptiveFormats = [...base.adaptiveFormats];
  for (const f of next.adaptiveFormats) {
    const k = `${f.itag || ""}|${f.audioTrack?.displayName || ""}|${f.bitrate || ""}`;
    if (!sa.has(k)) { sa.add(k); adaptiveFormats.push(f); }
  }
  return {
    source: base.source || next.source,
    title: base.title || next.title,
    author: base.author || next.author,
    durationSeconds: base.durationSeconds || next.durationSeconds,
    formats,
    adaptiveFormats
  };
}

async function tryInnertube(videoId, format) {
  const visitorData = await getVisitorData();
  let merged = null;
  let hardError = null;

  for (const batch of INNERTUBE_BATCHES) {
    const results = await Promise.all(batch.map(spec => fetchInnertubeClient(spec, videoId, visitorData)));
    for (const r of results) {
      if (r.ok) {
        merged = mergePlayerData(merged, r.data);
      } else if (!hardError && (r.kind === "private" || r.kind === "live" || r.kind === "age")) {
        hardError = r;
      }
    }
    const satisfied = format === "mp3" ? hasAudio(merged) : hasMuxed(merged);
    if (merged && satisfied) return { ok: true, data: merged };
  }

  if (merged) return { ok: true, data: merged };
  if (hardError) {
    if (hardError.kind === "private") throw new Error("Video ini privat dan tidak bisa dikonversi.");
    if (hardError.kind === "live") throw new Error("Siaran langsung tidak bisa dikonversi.");
    if (hardError.kind === "age") throw new Error("Video ini dibatasi usia oleh YouTube, jadi belum bisa dikonversi.");
  }
  return { ok: false };
}

// ---------------------------------------------------------------------------
// 4. Cobalt API Engine (Custom Env/UI URL + Public Instances)
// ---------------------------------------------------------------------------
let cobaltListCache = { urls: [], at: 0 };
const INSTANCE_LIST_TTL = 15 * 60 * 1000;

async function getPublicCobaltInstances() {
  if (cobaltListCache.urls.length && Date.now() - cobaltListCache.at < INSTANCE_LIST_TTL) {
    return cobaltListCache.urls;
  }
  const urls = [];
  try {
    const res = await fetchWithTimeout("https://instances.cobalt.best/api/instances.json", { headers: { "User-Agent": WEB_UA } }, 4000);
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        const good = list
          .filter(x => x && x.online && x.api && !x.auth && (x.services?.youtube !== false))
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 5)
          .map(x => {
            const proto = x.protocol || "https";
            const host = String(x.api).replace(/^https?:\/\//, "").replace(/\/+$/, "");
            return `${proto}://${host}`;
          });
        urls.push(...good);
      }
    }
  } catch {}
  if (urls.length) cobaltListCache = { urls, at: Date.now() };
  return urls;
}

async function queryCobaltEndpoint(baseUrl, videoId, format, apiKey) {
  const cleanBase = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(cleanBase)) return null;

  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": WEB_UA
  };
  if (apiKey) headers["Authorization"] = `Api-Key ${apiKey}`;

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const body = {
    url: ytUrl,
    downloadMode: format === "mp3" ? "audio" : "auto",
    audioFormat: "mp3",
    audioBitrate: "128",
    videoQuality: "720",
    filenameStyle: "pretty"
  };

  try {
    const res = await fetchWithTimeout(`${cleanBase}/`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }, 6500);
    if (!res.ok) return null;
    const j = await res.json();
    if ((j.status === "tunnel" || j.status === "redirect") && j.url) {
      return {
        source: "Cobalt",
        downloadUrl: j.url,
        filename: j.filename || "",
        ext: format === "mp3" ? "mp3" : "mp4",
        container: format === "mp3" ? "MP3" : "MP4",
        qualityLabel: format === "mp3" ? "Audio MP3" : "Video MP4 (720p)"
      };
    }
  } catch {}
  return null;
}

async function tryCobalt(videoId, format, customCobaltUrl) {
  // 1. User-supplied or Vercel env COBALT_API_URL gets first priority
  const priorityUrl = (customCobaltUrl || process.env.COBALT_API_URL || "").trim();
  if (priorityUrl) {
    const r = await queryCobaltEndpoint(priorityUrl, videoId, format, process.env.COBALT_API_KEY || "");
    if (r) return r;
  }
  // 2. Race top 3 public Cobalt instances
  const publics = await getPublicCobaltInstances();
  if (!publics.length) return null;
  const attempts = publics.slice(0, 3).map(u =>
    queryCobaltEndpoint(u, videoId, format, "").then(r => (r ? r : Promise.reject(new Error("miss"))))
  );
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 5. Piped API Engine (Auto-discovered public instances — proxied streams!)
// ---------------------------------------------------------------------------
let pipedListCache = { urls: [], at: 0 };
const FALLBACK_PIPED = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.private.coffee"
];

async function getPipedInstances() {
  if (pipedListCache.urls.length && Date.now() - pipedListCache.at < INSTANCE_LIST_TTL) {
    return pipedListCache.urls;
  }
  const urls = [];
  try {
    const res = await fetchWithTimeout("https://piped-instances.kavin.rocks/", { headers: { "User-Agent": WEB_UA } }, 4000);
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        const good = list
          .filter(x => x && x.api_url && (x.uptime_24h === undefined || x.uptime_24h >= 85))
          .sort((a, b) => (b.uptime_24h || 0) - (a.uptime_24h || 0))
          .slice(0, 6)
          .map(x => String(x.api_url).replace(/\/+$/, ""));
        urls.push(...good);
      }
    }
  } catch {}
  for (const fb of FALLBACK_PIPED) {
    if (!urls.includes(fb)) urls.push(fb);
  }
  pipedListCache = { urls, at: Date.now() };
  return urls;
}

async function queryPipedEndpoint(apiUrl, videoId) {
  const res = await fetchWithTimeout(`${apiUrl}/streams/${videoId}`, {
    headers: { "User-Agent": WEB_UA, "Accept": "application/json" }
  }, 6000);
  if (!res.ok) throw new Error("piped_http");
  const j = await res.json();
  if (j.error) throw new Error("piped_err");

  const formats = (j.videoStreams || [])
    .filter(s => s.url && !s.videoOnly && /mp4/i.test(s.mimeType || ""))
    .map(s => ({
      url: s.url,
      mimeType: s.mimeType || "video/mp4",
      qualityLabel: s.quality || "360p",
      bitrate: s.bitrate || 0,
      contentLength: s.contentLength || 0
    }));

  const adaptiveFormats = (j.audioStreams || [])
    .filter(s => s.url)
    .map(s => ({
      url: s.url,
      mimeType: s.mimeType || "audio/mp4",
      bitrate: s.bitrate || 0,
      contentLength: s.contentLength || 0,
      audioTrack: s.audioTrackName ? { displayName: s.audioTrackName } : undefined
    }));

  if (!formats.length && !adaptiveFormats.length) throw new Error("piped_empty");

  return {
    source: "Piped",
    title: j.title || "",
    author: j.uploader || "",
    durationSeconds: Number(j.duration || 0) || 0,
    formats,
    adaptiveFormats
  };
}

async function tryPiped(videoId) {
  const instances = await getPipedInstances();
  const attempts = instances.slice(0, 4).map(u => queryPipedEndpoint(u, videoId));
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 6. Invidious API Engine (Auto-discovered public instances)
// ---------------------------------------------------------------------------
let invidiousListCache = { urls: [], at: 0 };

async function getInvidiousInstances() {
  if (invidiousListCache.urls.length && Date.now() - invidiousListCache.at < INSTANCE_LIST_TTL) {
    return invidiousListCache.urls;
  }
  const urls = [];
  try {
    const res = await fetchWithTimeout("https://api.invidious.io/instances.json?sort_by=health", { headers: { "User-Agent": WEB_UA } }, 4000);
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        for (const item of list) {
          const meta = Array.isArray(item) ? item[1] : null;
          if (meta && meta.type === "https" && meta.api === true && meta.uri) {
            urls.push(String(meta.uri).replace(/\/+$/, ""));
          }
          if (urls.length >= 5) break;
        }
      }
    }
  } catch {}
  if (urls.length) invidiousListCache = { urls, at: Date.now() };
  return urls;
}

async function queryInvidiousEndpoint(uri, videoId) {
  const res = await fetchWithTimeout(`${uri}/api/v1/videos/${videoId}`, {
    headers: { "User-Agent": WEB_UA, "Accept": "application/json" }
  }, 6000);
  if (!res.ok) throw new Error("inv_http");
  const j = await res.json();
  if (j.error) throw new Error("inv_err");

  const formats = (j.formatStreams || [])
    .filter(s => s.url && /video\/mp4/i.test(s.type || ""))
    .map(s => ({
      url: s.url,
      mimeType: s.type || "video/mp4",
      qualityLabel: s.qualityLabel || "360p",
      bitrate: Number(s.bitrate || 0) || 0,
      contentLength: Number(s.clen || 0) || 0
    }));

  const adaptiveFormats = (j.adaptiveFormats || [])
    .filter(s => s.url && /^audio\//i.test(s.type || ""))
    .map(s => ({
      url: s.url,
      mimeType: s.type || "audio/mp4",
      bitrate: Number(s.bitrate || 0) || 0,
      contentLength: Number(s.clen || 0) || 0,
      audioTrack: s.audioTrack?.displayName ? { displayName: s.audioTrack.displayName } : undefined
    }));

  if (!formats.length && !adaptiveFormats.length) throw new Error("inv_empty");

  return {
    source: "Invidious",
    title: j.title || "",
    author: j.author || "",
    durationSeconds: Number(j.lengthSeconds || 0) || 0,
    formats,
    adaptiveFormats
  };
}

async function tryInvidious(videoId) {
  const instances = await getInvidiousInstances();
  if (!instances.length) return null;
  const attempts = instances.slice(0, 3).map(u => queryInvidiousEndpoint(u, videoId));
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 7. Format Selection & Caching
// ---------------------------------------------------------------------------
const playerCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function audioTracksOf(p) {
  const seen = new Map();
  for (const f of (p?.adaptiveFormats || [])) {
    const n = f.audioTrack?.displayName;
    if (n && !seen.has(n)) seen.set(n, n);
  }
  return [...seen.entries()].map(([id, label]) => ({ id, label }));
}

function pickAudio(p, track) {
  let a = (p?.adaptiveFormats || []).filter(f => f.url && (f.mimeType || "").startsWith("audio/"));
  if (track && track !== "Asli") {
    const d = a.filter(f => f.audioTrack?.displayName === track);
    if (d.length) a = d;
  }
  if (!a.length) return null;
  const mp4 = a.filter(f => (f.mimeType || "").startsWith("audio/mp4")).sort((x, y) => (y.bitrate || 0) - (x.bitrate || 0));
  if (mp4[0]) return mp4[0];
  return a.sort((x, y) => (y.bitrate || 0) - (x.bitrate || 0))[0] || null;
}

function pickMuxed(p) {
  const m = (p?.formats || []).filter(f => f.url && (f.mimeType || "").startsWith("video/mp4"));
  if (!m.length) return null;
  return m.sort((a, b) => parseInt(b.qualityLabel || "0", 10) - parseInt(a.qualityLabel || "0", 10))[0] || null;
}

function extAndLabel(fmt, mode) {
  const mime = fmt.mimeType || "";
  const kbps = Math.round((fmt.bitrate || 0) / 1000);
  if (mode === "mp3") {
    if (mime.startsWith("audio/mp4")) return { ext: "m4a", container: "M4A", label: kbps ? `Audio ${kbps} kbps` : "Audio M4A" };
    if (mime.startsWith("audio/webm")) return { ext: "webm", container: "WebM", label: kbps ? `Audio ${kbps} kbps` : "Audio WebM" };
    return { ext: "mp3", container: "MP3", label: kbps ? `Audio ${kbps} kbps` : "Audio MP3" };
  }
  return { ext: "mp4", container: "MP4", label: fmt.qualityLabel ? `Video ${fmt.qualityLabel}` : "Video MP4" };
}

function safeFilename(title, ext) {
  const c = (title || "").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${c || "video"}.${ext}`;
}

// Unified resolver: runs oEmbed + multi-engine fallback in optimal order
async function resolveConversion(videoId, opts = {}) {
  const format = opts.format === "mp4" ? "mp4" : "mp3";
  const audioTrack = opts.audioTrack || "Asli";
  const customCobaltUrl = (opts.customCobaltUrl || "").trim();
  const skipCache = !!opts.skipCache;

  const oembedPromise = fetchOembed(videoId);

  // Check cache first (unless customCobaltUrl or skipCache)
  if (!skipCache && !customCobaltUrl) {
    const cached = playerCache.get(videoId);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      const fmt = format === "mp3" ? pickAudio(cached.data, audioTrack) : pickMuxed(cached.data);
      if (fmt?.url) {
        const oembed = await oembedPromise;
        return buildResultFromPlayer(videoId, cached.data, fmt, format, oembed);
      }
    }
  }

  // Priority 1: If user or env configured a dedicated Cobalt URL, try it immediately
  if (customCobaltUrl || process.env.COBALT_API_URL) {
    const cob = await queryCobaltEndpoint(customCobaltUrl || process.env.COBALT_API_URL, videoId, format, process.env.COBALT_API_KEY || "");
    if (cob) {
      const oembed = await oembedPromise;
      return buildResultFromCobalt(videoId, cob, format, oembed);
    }
  }

  // Priority 2: Race Innertube (embedded+VR+mobile) AND Piped in parallel!
  // If both return data, prefer Piped (proxied, not IP-bound) or whichever has the requested format.
  let innertubeErr = null;
  const [innerRes, pipedRes] = await Promise.all([
    tryInnertube(videoId, format).catch(e => { innertubeErr = e; return { ok: false }; }),
    tryPiped(videoId).catch(() => null)
  ]);

  if (innertubeErr && !pipedRes) {
    throw innertubeErr;
  }

  // Prefer Piped if it has the requested format (its proxy URLs avoid Vercel IP-lock!)
  if (pipedRes) {
    const fmt = format === "mp3" ? pickAudio(pipedRes, audioTrack) : pickMuxed(pipedRes);
    if (fmt?.url) {
      playerCache.set(videoId, { data: pipedRes, at: Date.now() });
      const oembed = await oembedPromise;
      return buildResultFromPlayer(videoId, pipedRes, fmt, format, oembed);
    }
  }

  if (innerRes?.ok && innerRes.data) {
    const fmt = format === "mp3" ? pickAudio(innerRes.data, audioTrack) : pickMuxed(innerRes.data);
    if (fmt?.url) {
      playerCache.set(videoId, { data: innerRes.data, at: Date.now() });
      const oembed = await oembedPromise;
      return buildResultFromPlayer(videoId, innerRes.data, fmt, format, oembed);
    }
  }

  // Priority 3: Race Public Cobalt instances AND Public Invidious instances
  const [publicCobalt, invRes] = await Promise.all([
    tryCobalt(videoId, format, "").catch(() => null),
    tryInvidious(videoId).catch(() => null)
  ]);

  if (publicCobalt) {
    const oembed = await oembedPromise;
    return buildResultFromCobalt(videoId, publicCobalt, format, oembed);
  }

  if (invRes) {
    const fmt = format === "mp3" ? pickAudio(invRes, audioTrack) : pickMuxed(invRes);
    if (fmt?.url) {
      playerCache.set(videoId, { data: invRes, at: Date.now() });
      const oembed = await oembedPromise;
      return buildResultFromPlayer(videoId, invRes, fmt, format, oembed);
    }
  }

  // All engines failed — attach oembed info so UI can still show video preview + fallback options
  const oembed = await oembedPromise;
  const err = new Error("Semua server ekstraksi sedang dibatasi YouTube (cek bot / IP datacenter). Coba klik 'Coba Lagi' atau isi Server Cadangan di Pengaturan.");
  err.code = "BOT_BLOCKED";
  err.oembed = oembed;
  throw err;
}

function buildResultFromPlayer(videoId, player, fmt, format, oembed) {
  const declared = fmt.contentLength ? Number(fmt.contentLength) : 0;
  if (declared > MAX_FILE_BYTES) {
    throw new Error("File-nya terlalu besar untuk dikonversi di sini (maks sekitar 250 MB).");
  }
  const title = oembed?.title || player.title || videoId;
  const author = oembed?.author || player.author || "";
  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const { ext, container, label } = extAndLabel(fmt, format);
  const audio = pickAudio(player, "Asli");
  const muxed = pickMuxed(player);

  return {
    info: {
      videoId,
      title,
      author,
      durationSeconds: player.durationSeconds || 0,
      thumbnailUrl,
      hasMp4: !!muxed,
      mp4Label: muxed?.qualityLabel ? `MP4 ${muxed.qualityLabel}` : "",
      audioLabel: audio ? `Audio ${Math.round((audio.bitrate || 0) / 1000)} kbps` : "",
      audioTracks: audioTracksOf(player)
    },
    conversion: {
      videoId,
      title,
      author,
      format,
      qualityLabel: label,
      container,
      source: player.source || "Innertube",
      sizeBytes: declared,
      durationSeconds: player.durationSeconds || 0,
      downloadUrl: fmt.url,
      filename: safeFilename(title, ext),
      thumbnailUrl,
      createdAt: new Date().toISOString()
    }
  };
}

function buildResultFromCobalt(videoId, cob, format, oembed) {
  const title = oembed?.title || videoId;
  const author = oembed?.author || "";
  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const filename = cob.filename || safeFilename(title, cob.ext);

  return {
    info: {
      videoId,
      title,
      author,
      durationSeconds: 0,
      thumbnailUrl,
      hasMp4: true,
      mp4Label: "MP4 720p",
      audioLabel: "Audio MP3",
      audioTracks: []
    },
    conversion: {
      videoId,
      title,
      author,
      format,
      qualityLabel: cob.qualityLabel,
      container: cob.container,
      source: cob.source || "Cobalt",
      sizeBytes: 0,
      durationSeconds: 0,
      downloadUrl: cob.downloadUrl,
      filename,
      thumbnailUrl,
      createdAt: new Date().toISOString()
    }
  };
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return {}; }
  }
  return new Promise((resolve) => {
    let d = "";
    req.on("data", c => d += c);
    req.on("end", () => {
      try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); }
    });
  });
}

module.exports = {
  parseVideoId,
  looksLikeUrl,
  fetchOembed,
  resolveConversion,
  safeFilename,
  INNERTUBE_KEY,
  WEB_UA,
  MAX_FILE_BYTES,
  cors,
  readBody
};
