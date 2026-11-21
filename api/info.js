const { parseVideoId, looksLikeUrl, fetchOembed, cors } = require("./_lib");

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = (req.query?.url || "").toString();
  const videoId = parseVideoId(url);
  if (!videoId) {
    return res.status(200).json({
      info: null,
      error: looksLikeUrl(url)
        ? "Link YouTube-nya tidak valid. Cek lagi link-nya ya."
        : "Itu bukan link YouTube. Tempel link video, atau ketik judul lagu untuk mencari."
    });
  }

  try {
    const oembed = await fetchOembed(videoId);
    return res.status(200).json({
      info: {
        videoId,
        title: oembed?.title || videoId,
        author: oembed?.author || "",
        durationSeconds: 0,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        hasMp4: true,
        audioTracks: []
      },
      error: null
    });
  } catch (e) {
    return res.status(200).json({
      info: null,
      error: e.message || "Video tidak bisa dibaca. Coba lagi sebentar."
    });
  }
};
