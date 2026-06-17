<?php
declare(strict_types=1);

/** Resuelve URL(s) de audio con yt-dlp. */
function ytdlp_binary(): string
{
    $ytdlp = '/usr/local/bin/yt-dlp';
    if (!is_executable($ytdlp)) {
        $ytdlp = trim((string) shell_exec('command -v yt-dlp 2>/dev/null') ?: '');
    }
    return ($ytdlp !== '' && is_executable($ytdlp)) ? $ytdlp : '';
}

function resolve_audio_cache_file(string $id): string
{
    $cacheDir = sys_get_temp_dir() . '/vixmusic-resolve-cache';
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0755, true);
    }
    return $cacheDir . '/' . $id . '.json';
}

function mime_from_url(string $url): string
{
    if (str_contains($url, 'mime=audio%2Fwebm') || str_contains($url, '.webm')) {
        return 'audio/webm';
    }
    return 'audio/mp4';
}

function ytdlp_audio_url(string $id, string $format): ?string
{
    $ytdlp = ytdlp_binary();
    if ($ytdlp === '') {
        return null;
    }
    $watch = 'https://www.youtube.com/watch?v=' . $id;
    $cmd = sprintf(
        '%s -f %s -g --no-playlist --no-warnings --socket-timeout 18 %s 2>/dev/null',
        escapeshellcmd($ytdlp),
        escapeshellarg($format),
        escapeshellarg($watch)
    );
    $url = trim((string) shell_exec($cmd));
    if ($url === '' || !filter_var($url, FILTER_VALIDATE_URL)) {
        return null;
    }
    return $url;
}

function format_selector_for_itag(?string $itag): string
{
    return match ($itag) {
        '140' => '140',
        '251' => '251',
        '250' => '250',
        default => '140/ba[ext=m4a]/ba[ext=webm]/ba/b',
    };
}

function detect_itag(string $url, string $fallback = 'ba'): string
{
    if (preg_match('/[?&]itag=(\d+)/', $url, $m)) {
        return $m[1];
    }
    return $fallback;
}

/** @return array<string, mixed>|null */
function resolve_audio_payload(string $id, ?string $itag = null): ?array
{
    if (!preg_match('/^[a-zA-Z0-9_-]{11}$/', $id)) {
        return null;
    }

    $cacheFile = resolve_audio_cache_file($id);
    if ($itag === null && is_readable($cacheFile) && (time() - (int) filemtime($cacheFile)) < 1800) {
        $cached = json_decode((string) file_get_contents($cacheFile), true);
        if (is_array($cached) && !empty($cached['url'])) {
            return $cached;
        }
    }

    if (ytdlp_binary() === '') {
        return null;
    }

    $selector = format_selector_for_itag($itag);
    $url = ytdlp_audio_url($id, $selector);
    if ($url === null) {
        return null;
    }

    $detectedItag = detect_itag($url, $itag ?? 'ba');
    $payload = [
        'ok' => true,
        'url' => $url,
        'videoId' => $id,
        'mimeType' => mime_from_url($url),
        'itag' => $detectedItag,
    ];

    if ($itag === null) {
        @file_put_contents($cacheFile, json_encode($payload, JSON_UNESCAPED_SLASHES));
    }

    return $payload;
}

function handle_resolve_audio(): void
{
    $id = trim((string) ($_GET['id'] ?? ''));
    $payload = resolve_audio_payload($id);
    if ($payload === null) {
        if (!preg_match('/^[a-zA-Z0-9_-]{11}$/', $id)) {
            json_error('ID de vídeo no válido', 400);
        }
        if (ytdlp_binary() === '') {
            json_error('Extractor de audio no disponible en el servidor', 503);
        }
        json_error('No se pudo extraer el audio de YouTube', 502);
    }
    json_response($payload);
}

/** Reproduce audio por ID de vídeo (proxy integrado para apps móviles). */
function handle_play(): void
{
    $id = trim((string) ($_GET['id'] ?? ''));
    $itag = trim((string) ($_GET['itag'] ?? ''));
    $itag = $itag !== '' ? $itag : null;

    $payload = resolve_audio_payload($id, $itag);
    if ($payload === null) {
        if (!preg_match('/^[a-zA-Z0-9_-]{11}$/', $id)) {
            json_error('ID de vídeo no válido', 400);
        }
        json_error('No se pudo obtener el audio', 502);
    }

    $_GET['url'] = (string) $payload['url'];
    handle_audio_stream();
}
