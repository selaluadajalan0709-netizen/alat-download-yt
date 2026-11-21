// POST /api/convert — resolves a YouTube video to MP3 (audio) or MP4
// (video + sound) and returns the conversion record.
//
// Download model (changed 2026-11-22, user report "masih gagal
// download"): the old model returned the raw signed googlevideo URL
// and the visitor's browser downloaded straight from YouTube's CDN.
// Those URLs are bound to this server's egress IP, so the visitor's
// own connection was refused even though conversion had succeeded.
// Now `downloadUrl` points at this deployment's own /api/download
// endpoint, which fetches the file's bytes on the server first
// (chunked Range requests, walking every per-client candidate) and
// streams the finished file to the visitor — the yt-dlp pattern of
// "download first, then serve the file". The raw stream URL is kept
// in `directUrl` only as the page's last-resort fallback: if the
// server download is refused (YouTube's SABR clamp on adaptive
// audio), the visitor's browser downloads it directly, where a
// residential connection is treated as a normal client.

const {
  parseVideoId, buildInfo, fetchPlayer,
  audioCandidates, muxedCandidates,
  extAndLabel, safeFilename, MAX_FILE_BYTES, cors, readBody,
} = require("./_lib");

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const body = await readBody(req);
  const url = body.url || req.query?.url || "";
  const format = body.format === "mp4" ? "mp4" : "mp3";
  const audioTrack = body.audioTrack || "Asli";
  const videoId = parseVideoId(url);
  if (!videoId) return res.status(200).json({ conversion: null, error: "Link YouTube-nya tidak valid." });
  try {
    const { player: cached, info } = await buildInfo(videoId);
    let player = cached;
    if (format === "mp4" && muxedCandidates(player).length === 0) {
      try { player = await fetchPlayer(videoId, { skipCache: true }); } catch { player = cached; }
    }
    const candidates = format === "mp3" ? audioCandidates(player, audioTrack) : muxedCandidates(player);
    const fmt = candidates[0];
    if (!fmt?.url) {
      return res.status(200).json({
        conversion: null,
        error: format === "mp3"
          ? "Audio untuk video ini tidak tersedia."
          : "Video MP4 dengan suara untuk video ini belum tersedia dari YouTube. Coba lagi sebentar, atau coba format MP3.",
      });
    }
    const declared = fmt.contentLength ? Number(fmt.contentLength) : 0;
    if (declared > MAX_FILE_BYTES) {
      return res.status(200).json({ conversion: null, error: "File-nya terlalu besar untuk dikonversi di sini (maks sekitar 250 MB)." });
    }
    const { ext, container, label } = extAndLabel(fmt, format);
    const filename = safeFilename(info.title, ext);
    const params = new URLSearchParams({ v: videoId, format, filename });
    if (format === "mp3" && audioTrack && audioTrack !== "Asli") params.set("track", audioTrack);
    return res.status(200).json({
      conversion: {
        videoId,
        title: info.title,
        author: info.author,
        format,
        qualityLabel: label,
        container,
        sizeBytes: declared,
        durationSeconds: info.durationSeconds,
        downloadUrl: `/api/download?${params.toString()}`,
        directUrl: fmt.url,
        filename,
        thumbnailUrl: info.thumbnailUrl,
        createdAt: new Date().toISOString(),
      },
      error: null,
    });
  } catch (e) {
    return res.status(200).json({ conversion: null, error: e.message || "Konversi gagal. Coba lagi sebentar." });
  }
};
