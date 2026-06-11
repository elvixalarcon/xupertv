const express = require('express');
const {
  normalizeVideoId,
  resolveYoutubeTrailer,
  proxyUpstream
} = require('../services/trailerStream');

const router = express.Router();

router.get('/youtube/:videoId', async (req, res) => {
  try {
    const id = normalizeVideoId(req.params.videoId);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const info = await resolveYoutubeTrailer(id);
    res.json({
      videoId: info.videoId,
      title: info.title,
      playUrl: `/api/trailers/stream/${info.videoId}`,
      mime: info.mime,
      height: info.height
    });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Tráiler no disponible' });
  }
});

router.get('/stream/:videoId', async (req, res) => {
  try {
    const id = normalizeVideoId(req.params.videoId);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const info = await resolveYoutubeTrailer(id);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'bytes');
    proxyUpstream(info.upstreamUrl, req, res);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Tráiler no disponible' });
  }
});

module.exports = router;
