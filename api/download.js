// GET /api/download?v=<videoId>&format=mp3|mp4&track=<label>&filename=<name>
//
// Download-via-server endpoint (the 2026-11-22 fix for "conversion
// succeeds but the download fails"). The old model handed the
// visitor's browser the raw signed googlevideo URL; those URLs are
// bound to the resolving server's egress IP (the `ip` query param),
// so the visitor's own connection was refused — and ANDROID_VR's
// muxed itag-18 URL answers 403 even from its bound IP while the
// ANDROID client's identical itag downloads fine.
//
// Following the yt-dlp model (fetch the file first, then serve the
// file), this endpoint runs on the same server that resolved the
// stream URLs, downloads the chosen format's bytes itself with
// sequential 1 MB Range chunks — a plain GET stalls under YouTube's
// SABR delivery, but Range chunks are served in full to the bound
// IP — and streams the assembled file to the visitor with
// Content-Disposition, so the file arrives under the video's title.
// Candidates are walked in preference order (per-client variants
// included) until one serves its bytes; if every candidate of the
// first resolve is clamped, the video is resolved once more with a
// full client walk for freshly signed URLs and the walk repeats.
//
// Vercel note: serverless functions stream through `res` and are
// time-limited (see maxDuration in vercel.json), so bytes are
// forwarded chunk by chunk instead of buffered whole-file. If every
// server attempt still refuses (adaptive audio is the known hard
// case: SABR sometimes serves a datacenter egress only the first
// chunk), this returns 502 and the page falls back to downloading
// the direct stream URL from the visitor's own browser, whose
// residential connection SABR treats normally.

const {
  parseVideoId, fetchPlayer, fetchOembed,
  audioCandidates, muxedCandidates,
  extAndLabel, safeFilename, MAX_FILE_BYTES, cors,
} = require("./_lib");

const CHUNK = 1024 * 1024;

// Fetches one Range chunk of a signed stream URL. Every chunk is
// retried up to three times with growing pauses: a 403 here is
// usually YouTube's intermittent clamp on this egress, not a dead
// URL, and the pauses let it lift. Requests stay sequential, yt-dlp
// style — parallel chunk requests were refused in live probes.
async function fetchChunk(url, start, end, attempts = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt === 1 ? 1000 : 2500));
    try {
      const res = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 200 || res.status === 206) {
        return {
          status: res.status,
          contentRange: res.headers.get("content-range"),
          body: Buffer.from(await res.arrayBuffer()),
        };
      }
      lastErr = new Error(`HTTP ${res.status}`);
      if (res.status !== 403 && res.status !== 429) break;
    } catch (err) { lastErr = err; }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}

// Streams one candidate URL to the visitor, sequentially, yt-dlp
// style. For adaptive audio (probe=true) chunks are additionally
// probed BEFORE any header is sent, so a refused candidate can still
// fall through to the next one: YouTube's SABR delivery sometimes
// serves a datacenter egress only the FIRST chunk of an adaptive
// stream and refuses every later chunk — so the second and the last
// chunk are probed up front, and a candidate that cannot serve them
// is rejected before the visitor's download starts instead of being
// truncated mid-file. Muxed MP4 (probe=false) is a plain progressive
// download that is served in full sequentially (verified live), so
// it is streamed straight through with no out-of-order requests.
async function streamCandidate(res, fmt, filename, probe) {
  const first = await fetchChunk(fmt.url, 0, CHUNK - 1);
  const mime = (fmt.mimeType || "").split(";")[0].trim() || "application/octet-stream";
  if (first.status === 200) {
    // The CDN ignored the Range header and sent the whole file.
    if (first.body.length > MAX_FILE_BYTES) throw new Error("too large");
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": first.body.length,
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    });
    res.end(first.body);
    return first.body.length;
  }
  const total = Number((first.contentRange || "").split("/")[1] || 0);
  if (!total) throw new Error("no total");
  if (total > MAX_FILE_BYTES) throw new Error("too large");
  if (first.body.length > total) throw new Error("overlong chunk");

  // Pre-probe the second and last chunks for adaptive streams
  // (kept and reused as the stream reaches them, so probing costs
  // no extra downloads).
  const probed = new Map();
  if (probe && total > CHUNK) {
    const probeAt = async (start) => {
      const end = Math.min(start + CHUNK - 1, total - 1);
      try {
        const part = await fetchChunk(fmt.url, start, end, 2);
        if (part.status !== 206) throw new Error(`HTTP ${part.status}`);
        if (part.body.length !== end - start + 1) throw new Error("short chunk");
        probed.set(start, part.body);
      } catch (e) {
        // First chunk served but a later one refuses: this session
        // is SABR-clamped. Tagged so the caller can stop early when
        // several candidates in a row clamp the same way.
        const err = new Error(e.message || "clamped");
        err.code = "CLAMPED";
        throw err;
      }
    };
    await probeAt(CHUNK);
    const lastStart = Math.floor((total - 1) / CHUNK) * CHUNK;
    if (lastStart > CHUNK) await probeAt(lastStart);
  }

  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": total,
    "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    "Cache-Control": "private, no-store",
  });
  res.write(first.body);
  let fetched = first.body.length;
  while (fetched < total) {
    const end = Math.min(fetched + CHUNK - 1, total - 1);
    let body = probed.get(fetched);
    if (!body) {
      const part = await fetchChunk(fmt.url, fetched, end);
      if (part.status !== 206) throw new Error(`HTTP ${part.status}`);
      if (part.body.length !== end - fetched + 1) throw new Error("short chunk");
      body = part.body;
    }
    res.write(body);
    fetched += body.length;
  }
  res.end();
  return total;
}

function candidatesFor(player, format, track) {
  return format === "mp3" ? audioCandidates(player, track) : muxedCandidates(player);
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const q = req.query || {};
  const videoId = parseVideoId(q.v || q.videoId || q.url || "");
  const format = q.format === "mp4" ? "mp4" : "mp3";
  const track = (q.track || q.audioTrack || "Asli").toString();
  if (!videoId) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Link YouTube-nya tidak valid.");
  }
  try {
    let player = await fetchPlayer(videoId);
    if (format === "mp4" && muxedCandidates(player).length === 0) {
      try { player = await fetchPlayer(videoId, { skipCache: true }); } catch { /* keep first */ }
    }
    let candidates = candidatesFor(player, format, track);
    if (!candidates[0]?.url) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(format === "mp3"
        ? "Audio untuk video ini tidak tersedia."
        : "Video MP4 dengan suara untuk video ini belum tersedia dari YouTube. Coba lagi sebentar, atau coba format MP3.");
    }
    const oembed = await fetchOembed(videoId);
    const title = oembed?.title || player.title || videoId;
    const first = candidates[0];
    const { ext } = extAndLabel(first, format);
    const filename = safeFilename((q.filename || "").toString().replace(/\.[a-z0-9]+$/i, "") || title, ext);

    // Serverless functions are time-limited, so the walk is
    // timeboxed and capped: at most 5 candidates per round, and a
    // round stops after 2 SABR-clamped candidates in a row (the
    // clamp is usually egress-wide for adaptive streams — more
    // attempts would just burn the time limit before the page's
    // browser-side fallback can start).
    const deadline = Date.now() + 50000;
    const walkCandidates = async (list) => {
      let clampedInRow = 0;
      for (const fmt of list.slice(0, 5)) {
        if (res.headersSent || Date.now() > deadline) break;
        try { await streamCandidate(res, fmt, filename, format === "mp3"); return true; }
        catch (e) {
          clampedInRow = e && e.code === "CLAMPED" ? clampedInRow + 1 : 0;
          if (clampedInRow >= 2) break;
        }
      }
      return false;
    };

    // Round 1: walk the candidates of the current resolve.
    if (await walkCandidates(candidates)) return;
    if (res.headersSent) { try { res.end(); } catch { /* already streaming */ } return; }

    // Round 2: freshly signed URLs from a FULL client walk — the
    // first round's sessions may all be clamped while another client
    // family's are not.
    try {
      const fresh = await fetchPlayer(videoId, { skipCache: true, fullWalk: true });
      candidates = candidatesFor(fresh, format, track);
      if (await walkCandidates(candidates)) return;
      if (res.headersSent) { try { res.end(); } catch { /* already streaming */ } return; }
    } catch { /* fall through to the error below */ }

    // Every server attempt refused. The page turns this 502 into the
    // browser-side fallback download of the direct stream URL.
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Download dari YouTube gagal barusan. Coba lagi sebentar ya.");
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return; }
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(e.message || "Download gagal. Coba lagi sebentar.");
  }
};
