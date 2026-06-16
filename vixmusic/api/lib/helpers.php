<?php
declare(strict_types=1);

function json_response(array $data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error(string $message, int $code = 400): void
{
    json_response(['ok' => false, 'error' => $message], $code);
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function bearer_token(): ?string
{
    $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/Bearer\s+(\S+)/i', $hdr, $m)) {
        return $m[1];
    }
    return null;
}

function base64url_encode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64url_decode(string $data): string
{
    $pad = 4 - (strlen($data) % 4);
    if ($pad < 4) {
        $data .= str_repeat('=', $pad);
    }
    return base64_decode(strtr($data, '-_', '+/')) ?: '';
}

function jwt_encode(array $payload, string $secret, int $ttl = 604800): string
{
    $now = time();
    $payload['iat'] = $now;
    $payload['exp'] = $now + $ttl;
    $header = base64url_encode(json_encode(['typ' => 'JWT', 'alg' => 'HS256']));
    $body = base64url_encode(json_encode($payload));
    $sig = base64url_encode(hash_hmac('sha256', "$header.$body", $secret, true));
    return "$header.$body.$sig";
}

function jwt_decode(string $token, string $secret): ?array
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return null;
    }
    [$header, $body, $sig] = $parts;
    $check = base64url_encode(hash_hmac('sha256', "$header.$body", $secret, true));
    if (!hash_equals($check, $sig)) {
        return null;
    }
    $payload = json_decode(base64url_decode($body), true);
    if (!is_array($payload) || ($payload['exp'] ?? 0) < time()) {
        return null;
    }
    return $payload;
}

function validate_username(string $username): ?string
{
    $username = trim($username);
    if (strlen($username) < 3 || strlen($username) > 64) {
        return 'Usuario: entre 3 y 64 caracteres';
    }
    if (!preg_match('/^[a-zA-Z0-9._-]+$/', $username)) {
        return 'Usuario: solo letras, números, punto, guión y guión bajo';
    }
    return null;
}

function validate_password(string $password): ?string
{
    if (strlen($password) < 6) {
        return 'Contraseña: mínimo 6 caracteres';
    }
    return null;
}

function validate_email(?string $email): ?string
{
    if ($email === null || $email === '') {
        return null;
    }
    $email = trim($email);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return 'Correo no válido';
    }
    return null;
}
