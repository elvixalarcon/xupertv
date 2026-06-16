<?php
declare(strict_types=1);

function load_config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    $paths = [
        dirname(__DIR__, 2) . '/private/config.php',
        '/var/www/html/vixmusic/private/config.php',
    ];
    foreach ($paths as $path) {
        if (is_file($path)) {
            $cfg = require $path;
            return $cfg;
        }
    }
    throw new RuntimeException('Config no encontrada');
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $cfg = load_config()['db'];
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $cfg['host'], $cfg['name']);
    $pdo = new PDO($dsn, $cfg['user'], $cfg['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

function setting(string $key, ?string $default = null): ?string
{
    $st = db()->prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?');
    $st->execute([$key]);
    $row = $st->fetch();
    return $row ? (string) $row['setting_value'] : $default;
}

function user_row_to_public(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'username' => $row['username'],
        'email' => $row['email'],
        'displayName' => $row['display_name'] ?: $row['username'],
        'role' => $row['role'],
        'createdAt' => $row['created_at'],
    ];
}

function find_user_by_login(string $login): ?array
{
    $st = db()->prepare('SELECT * FROM users WHERE (username = ? OR email = ?) AND is_active = 1 LIMIT 1');
    $st->execute([$login, $login]);
    $row = $st->fetch();
    return $row ?: null;
}

function find_user_by_id(int $id): ?array
{
    $st = db()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
    $st->execute([$id]);
    $row = $st->fetch();
    return $row ?: null;
}

function require_auth(): array
{
    $cfg = load_config();
    $token = bearer_token();
    if (!$token) {
        json_error('No autenticado', 401);
    }
    $payload = jwt_decode($token, $cfg['jwt_secret']);
    if (!$payload || empty($payload['sub'])) {
        json_error('Sesión inválida', 401);
    }
    $user = find_user_by_id((int) $payload['sub']);
    if (!$user || !(int) $user['is_active']) {
        json_error('Usuario no encontrado', 401);
    }
    return $user;
}

function require_admin(): array
{
    $user = require_auth();
    if ($user['role'] !== 'admin') {
        json_error('Acceso denegado', 403);
    }
    return $user;
}
