<?php
declare(strict_types=1);

/** Resuelve URL de audio con yt-dlp (fallback cuando Piped falla). */
function handle_resolve_audio(): void
{
    $id = trim((string) ($_GET['id'] ?? ''));
    if (!preg_match('/^[a-zA-Z0-9_-]{11}$/', $id)) {
        json_error('ID de vídeo no válido', 400);
    }

    $ytdlp = '/usr/local/bin/yt-dlp';
    if (!is_executable($ytdlp)) {
        $ytdlp = trim((string) shell_exec('command -v yt-dlp 2>/dev/null') ?: '');
    }
    if ($ytdlp === '' || !is_executable($ytdlp)) {
        json_error('Extractor de audio no disponible en el servidor', 503);
    }

    $cacheDir = sys_get_temp_dir() . '/vixmusic-resolve-cache';
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0755, true);
    }
    $cacheFile = $cacheDir . '/' . $id . '.json';
    if (is_readable($cacheFile) && (time() - (int) filemtime($cacheFile)) < 1800) {
        $cached = json_decode((string) file_get_contents($cacheFile), true);
        if (is_array($cached) && !empty($cached['url'])) {
            json_response($cached);
        }
    }

    $watch = 'https://www.youtube.com/watch?v=' . $id;
    $cmd = sprintf(
        '%s -f "ba[ext=m4a]/ba[ext=webm]/ba/b" -g --no-playlist --no-warnings --socket-timeout 20 %s 2>/dev/null',
        escapeshellcmd($ytdlp),
        escapeshellarg($watch)
    );
    $url = trim((string) shell_exec($cmd));
    if ($url === '' || !filter_var($url, FILTER_VALIDATE_URL)) {
        json_error('No se pudo extraer el audio de YouTube', 502);
    }

    $mime = 'audio/mp4';
    if (str_contains($url, 'mime=audio%2Fwebm') || str_contains($url, '.webm')) {
        $mime = 'audio/webm';
    } elseif (str_contains($url, 'mime=audio%2Fmp4') || str_contains($url, '.m4a')) {
        $mime = 'audio/mp4';
    }

    $payload = [
        'ok' => true,
        'url' => $url,
        'videoId' => $id,
        'mimeType' => $mime,
    ];
    @file_put_contents($cacheFile, json_encode($payload, JSON_UNESCAPED_SLASHES));

    json_response($payload);
}
