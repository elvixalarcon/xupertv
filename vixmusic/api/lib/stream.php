<?php
declare(strict_types=1);

/** Proxy de audio para apps móviles (YouTube CDN exige Referer). */
function handle_audio_stream(): void
{
    $url = trim((string) ($_GET['url'] ?? ''));
    if ($url === '' || !filter_var($url, FILTER_VALIDATE_URL)) {
        json_error('URL no válida', 400);
    }

    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    $allowed = ['googlevideo.com', 'youtube.com', 'youtu.be', 'googleusercontent.com'];
    $okHost = false;
    foreach ($allowed as $suffix) {
        if ($host === $suffix || str_ends_with($host, '.' . $suffix)) {
            $okHost = true;
            break;
        }
    }
    if (!$okHost) {
        json_error('Origen no permitido', 403);
    }

    $reqHeaders = [
        'Referer: https://www.youtube.com/',
        'Origin: https://www.youtube.com',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ];
    if (!empty($_SERVER['HTTP_RANGE'])) {
        $reqHeaders[] = 'Range: ' . $_SERVER['HTTP_RANGE'];
    }

    $ch = curl_init($url);
    if ($ch === false) {
        json_error('No se pudo iniciar la conexión', 500);
    }

    $status = 200;
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER => $reqHeaders,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_HEADER => false,
        CURLOPT_TIMEOUT => 0,
        CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_HEADERFUNCTION => static function ($curl, string $header) use (&$status): int {
            $len = strlen($header);
            $trim = trim($header);
            if (str_starts_with($trim, 'HTTP/')) {
                if (preg_match('/\s(\d{3})\s/', $trim, $m)) {
                    $status = (int) $m[1];
                }
                return $len;
            }
            if (preg_match('/^(Content-Type|Content-Length|Content-Range|Accept-Ranges):/i', $trim)) {
                header($trim, false);
            }
            return $len;
        },
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk): int {
            echo $chunk;
            if (function_exists('flush')) {
                flush();
            }
            return strlen($chunk);
        },
    ]);

    http_response_code($status);
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges');
    header('Cache-Control: no-store');

    $ok = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($ok === false) {
        if (!headers_sent()) {
            json_error('Error al obtener audio: ' . ($err ?: 'desconocido'), 502);
        }
        exit;
    }
    exit;
}
