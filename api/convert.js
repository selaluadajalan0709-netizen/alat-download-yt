const { parseVideoId, resolveConversion, cors, readBody } = require("./_lib");

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const body = await readBody(req);
  const url = body.url || req.query?.url || "";
  const format = body.format || req.query?.format || "mp3";
  const audioTrack = body.audioTrack || "Asli";
  const customCobaltUrl = body.customCobaltUrl || "";
  const skipCache = Boolean(body.skipCache);

  const videoId = parseVideoId(url);
  if (!videoId) {
    return res.status(200).json({
      conversion: null,
      info: null,
      error: "Link YouTube-nya tidak valid. Cek lagi link-nya ya."
    });
  }

  try {
    const result = await resolveConversion(videoId, {
      format,
      audioTrack,
      customCobaltUrl,
      skipCache
    });
    return res.status(200).json({
      conversion: result.conversion,
      info: result.info,
      error: null,
      code: null
    });
  } catch (e) {
    return res.status(200).json({
      conversion: null,
      info: e.oembed ? {
        videoId,
        title: e.oembed.title || videoId,
        author: e.oembed.author || "",
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      } : null,
      error: e.message || "Konversi gagal. Coba lagi sebentar.",
      code: e.code || "ERROR"
    });
  }
};
