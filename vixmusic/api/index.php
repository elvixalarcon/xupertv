<?php
declare(strict_types=1);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require __DIR__ . '/lib/helpers.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/stream.php';
require __DIR__ . '/lib/resolve_audio.php';

$method = $_SERVER['REQUEST_METHOD'];
$uri = $_SERVER['PATH_INFO'] ?? '';
if ($uri === '' || $uri === '/') {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
    if (preg_match('#/api(/.*)$#', $path, $m)) {
        $uri = $m[1];
    } else {
        $uri = $path;
    }
}

try {
    route($method, $uri);
} catch (Throwable $e) {
    json_error('Error del servidor', 500);
}

function route(string $method, string $uri): void
{
    $uri = rtrim($uri, '/') ?: '/';

    if ($uri === '/health' && $method === 'GET') {
        json_response(['ok' => true, 'service' => 'vixmusic-api']);
    }

    if ($uri === '/stream' && $method === 'GET') {
        handle_audio_stream();
    }

    if ($uri === '/resolve-audio' && $method === 'GET') {
        handle_resolve_audio();
    }

    if ($uri === '/play' && $method === 'GET') {
        handle_play();
    }

    if ($uri === '/auth/register' && $method === 'POST') {
        handle_register();
    }
    if ($uri === '/auth/login' && $method === 'POST') {
        handle_login();
    }
    if ($uri === '/auth/me' && $method === 'GET') {
        handle_me();
    }
    if ($uri === '/auth/profile' && $method === 'PATCH') {
        handle_profile();
    }
    if ($uri === '/auth/change-password' && $method === 'POST') {
        handle_change_password();
    }

    if ($uri === '/favorites' && $method === 'GET') {
        handle_list_favorites();
    }
    if ($uri === '/favorites' && $method === 'POST') {
        handle_add_favorite();
    }
    if (preg_match('#^/favorites/([^/]+)$#', $uri, $m) && $method === 'DELETE') {
        handle_remove_favorite(urldecode($m[1]));
    }
    if ($uri === '/favorites/sync' && $method === 'POST') {
        handle_sync_favorites();
    }

    if ($uri === '/playlists' && $method === 'GET') {
        handle_list_playlists();
    }
    if ($uri === '/playlists' && $method === 'POST') {
        handle_create_playlist();
    }
    if (preg_match('#^/playlists/(\d+)$#', $uri, $m)) {
        $id = (int) $m[1];
        if ($method === 'GET') {
            handle_get_playlist($id);
        }
        if ($method === 'PATCH') {
            handle_update_playlist($id);
        }
        if ($method === 'DELETE') {
            handle_delete_playlist($id);
        }
    }
    if (preg_match('#^/playlists/(\d+)/tracks$#', $uri, $m) && $method === 'POST') {
        handle_add_playlist_track((int) $m[1]);
    }
    if (preg_match('#^/playlists/(\d+)/tracks/([^/]+)$#', $uri, $m) && $method === 'DELETE') {
        handle_remove_playlist_track((int) $m[1], urldecode($m[2]));
    }

    if ($uri === '/history' && $method === 'GET') {
        handle_list_history();
    }
    if ($uri === '/history' && $method === 'POST') {
        handle_add_history();
    }
    if ($uri === '/recommendations' && $method === 'GET') {
        handle_recommendations();
    }

    if ($uri === '/admin/users' && $method === 'GET') {
        handle_admin_list_users();
    }
    if ($uri === '/admin/users' && $method === 'POST') {
        handle_admin_create_user();
    }
    if (preg_match('#^/admin/users/(\d+)$#', $uri, $m)) {
        $id = (int) $m[1];
        if ($method === 'PATCH') {
            handle_admin_update_user($id);
        }
        if ($method === 'DELETE') {
            handle_admin_delete_user($id);
        }
    }
    if ($uri === '/admin/settings' && $method === 'GET') {
        handle_admin_settings();
    }
    if ($uri === '/admin/settings' && $method === 'PATCH') {
        handle_admin_settings_patch();
    }

    json_error('Ruta no encontrada', 404);
}

function auth_response(array $user): void
{
    $cfg = load_config();
    $token = jwt_encode(['sub' => (int) $user['id'], 'role' => $user['role']], $cfg['jwt_secret']);
    json_response([
        'ok' => true,
        'token' => $token,
        'user' => user_row_to_public($user),
    ]);
}

function handle_register(): void
{
    if (setting('allow_registration', '1') !== '1') {
        json_error('El registro público está desactivado', 403);
    }
    $body = read_json_body();
    $username = trim((string) ($body['username'] ?? ''));
    $email = trim((string) ($body['email'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    $display = trim((string) ($body['displayName'] ?? $username));

    if ($err = validate_username($username)) {
        json_error($err);
    }
    if ($err = validate_password($password)) {
        json_error($err);
    }
    if ($email !== '' && ($err = validate_email($email))) {
        json_error($err);
    }

    $pdo = db();
    $st = $pdo->prepare('SELECT id FROM users WHERE username = ? OR (email IS NOT NULL AND email = ? AND ? <> "")');
    $st->execute([$username, $email, $email]);
    if ($st->fetch()) {
        json_error('Usuario o correo ya registrado', 409);
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $st = $pdo->prepare('INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)');
    $st->execute([$username, $email ?: null, $hash, $display ?: $username]);
    $user = find_user_by_id((int) $pdo->lastInsertId());
    auth_response($user);
}

function handle_login(): void
{
    $body = read_json_body();
    $login = trim((string) ($body['username'] ?? $body['login'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    if ($login === '' || $password === '') {
        json_error('Usuario y contraseña requeridos');
    }
    $user = find_user_by_login($login);
    if (!$user || !password_verify($password, $user['password_hash'])) {
        json_error('Credenciales incorrectas', 401);
    }
    auth_response($user);
}

function handle_me(): void
{
    $user = require_auth();
    json_response(['ok' => true, 'user' => user_row_to_public($user)]);
}

function handle_profile(): void
{
    $user = require_auth();
    $body = read_json_body();
    $display = trim((string) ($body['displayName'] ?? $user['display_name'] ?? $user['username']));
    $email = array_key_exists('email', $body) ? trim((string) $body['email']) : ($user['email'] ?? '');
    if ($email !== '' && ($err = validate_email($email))) {
        json_error($err);
    }
    $st = db()->prepare('UPDATE users SET display_name = ?, email = ? WHERE id = ?');
    $st->execute([$display, $email ?: null, $user['id']]);
    auth_response(find_user_by_id((int) $user['id']));
}

function handle_change_password(): void
{
    $user = require_auth();
    $body = read_json_body();
    $current = (string) ($body['currentPassword'] ?? '');
    $new = (string) ($body['newPassword'] ?? '');
    if (!password_verify($current, $user['password_hash'])) {
        json_error('Contraseña actual incorrecta', 401);
    }
    if ($err = validate_password($new)) {
        json_error($err);
    }
    $hash = password_hash($new, PASSWORD_DEFAULT);
    db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$hash, $user['id']]);
    json_response(['ok' => true]);
}

function handle_list_favorites(): void
{
    $user = require_auth();
    $st = db()->prepare('SELECT track_id, track_json, saved_at FROM favorites WHERE user_id = ? ORDER BY saved_at DESC');
    $st->execute([$user['id']]);
    $items = [];
    foreach ($st->fetchAll() as $row) {
        $track = json_decode($row['track_json'], true) ?: [];
        $track['id'] = $track['id'] ?? $row['track_id'];
        $track['savedAt'] = strtotime($row['saved_at']) * 1000;
        $items[] = $track;
    }
    json_response(['ok' => true, 'items' => $items]);
}

function handle_add_favorite(): void
{
    $user = require_auth();
    $body = read_json_body();
    $track = $body['track'] ?? null;
    if (!is_array($track) || empty($track['id'])) {
        json_error('track requerido');
    }
    $tid = (string) $track['id'];
    $st = db()->prepare('INSERT INTO favorites (user_id, track_id, track_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE track_json = VALUES(track_json), saved_at = CURRENT_TIMESTAMP');
    $st->execute([$user['id'], $tid, json_encode($track, JSON_UNESCAPED_UNICODE)]);
    json_response(['ok' => true]);
}

function handle_remove_favorite(string $trackId): void
{
    $user = require_auth();
    db()->prepare('DELETE FROM favorites WHERE user_id = ? AND track_id = ?')->execute([$user['id'], $trackId]);
    json_response(['ok' => true]);
}

function handle_sync_favorites(): void
{
    $user = require_auth();
    $body = read_json_body();
    $tracks = $body['tracks'] ?? [];
    if (!is_array($tracks)) {
        json_error('tracks debe ser un array');
    }
    $pdo = db();
    $pdo->beginTransaction();
    try {
        foreach ($tracks as $track) {
            if (!is_array($track) || empty($track['id'])) {
                continue;
            }
            $st = $pdo->prepare('INSERT IGNORE INTO favorites (user_id, track_id, track_json) VALUES (?, ?, ?)');
            $st->execute([$user['id'], (string) $track['id'], json_encode($track, JSON_UNESCAPED_UNICODE)]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    handle_list_favorites();
}

function handle_list_playlists(): void
{
    $user = require_auth();
    $st = db()->prepare('SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count FROM playlists p WHERE p.user_id = ? ORDER BY p.updated_at DESC');
    $st->execute([$user['id']]);
    $items = array_map(static function ($row) {
        return [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'description' => $row['description'],
            'image' => $row['image'],
            'trackCount' => (int) $row['track_count'],
            'updatedAt' => $row['updated_at'],
        ];
    }, $st->fetchAll());
    json_response(['ok' => true, 'items' => $items]);
}

function handle_create_playlist(): void
{
    $user = require_auth();
    $body = read_json_body();
    $name = trim((string) ($body['name'] ?? ''));
    if ($name === '') {
        json_error('Nombre requerido');
    }
    $desc = trim((string) ($body['description'] ?? ''));
    $image = trim((string) ($body['image'] ?? ''));
    $st = db()->prepare('INSERT INTO playlists (user_id, name, description, image) VALUES (?, ?, ?, ?)');
    $st->execute([$user['id'], $name, $desc ?: null, $image ?: null]);
    json_response(['ok' => true, 'id' => (int) db()->lastInsertId()]);
}

function handle_get_playlist(int $id): void
{
    $user = require_auth();
    $st = db()->prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?');
    $st->execute([$id, $user['id']]);
    $pl = $st->fetch();
    if (!$pl) {
        json_error('Playlist no encontrada', 404);
    }
    $st = db()->prepare('SELECT track_id, track_json, position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC');
    $st->execute([$id]);
    $tracks = [];
    foreach ($st->fetchAll() as $row) {
        $track = json_decode($row['track_json'], true) ?: [];
        $track['id'] = $track['id'] ?? $row['track_id'];
        $tracks[] = $track;
    }
    json_response([
        'ok' => true,
        'playlist' => [
            'id' => (int) $pl['id'],
            'name' => $pl['name'],
            'description' => $pl['description'],
            'image' => $pl['image'],
            'tracks' => $tracks,
        ],
    ]);
}

function handle_update_playlist(int $id): void
{
    $user = require_auth();
    $body = read_json_body();
    $st = db()->prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?');
    $st->execute([$id, $user['id']]);
    if (!$st->fetch()) {
        json_error('Playlist no encontrada', 404);
    }
    $name = trim((string) ($body['name'] ?? ''));
    $desc = trim((string) ($body['description'] ?? ''));
    db()->prepare('UPDATE playlists SET name = COALESCE(NULLIF(?, ""), name), description = ? WHERE id = ?')
        ->execute([$name, $desc ?: null, $id]);
    json_response(['ok' => true]);
}

function handle_delete_playlist(int $id): void
{
    $user = require_auth();
    db()->prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?')->execute([$id, $user['id']]);
    json_response(['ok' => true]);
}

function handle_add_playlist_track(int $playlistId): void
{
    $user = require_auth();
    $st = db()->prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?');
    $st->execute([$playlistId, $user['id']]);
    if (!$st->fetch()) {
        json_error('Playlist no encontrada', 404);
    }
    $body = read_json_body();
    $track = $body['track'] ?? null;
    if (!is_array($track) || empty($track['id'])) {
        json_error('track requerido');
    }
    $tid = (string) $track['id'];
    $st = db()->prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM playlist_tracks WHERE playlist_id = ?');
    $st->execute([$playlistId]);
    $pos = (int) $st->fetch()['next_pos'];
    $st = db()->prepare('INSERT INTO playlist_tracks (playlist_id, position, track_id, track_json) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE track_json = VALUES(track_json)');
    $st->execute([$playlistId, $pos, $tid, json_encode($track, JSON_UNESCAPED_UNICODE)]);
    json_response(['ok' => true]);
}

function handle_remove_playlist_track(int $playlistId, string $trackId): void
{
    $user = require_auth();
    $st = db()->prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?');
    $st->execute([$playlistId, $user['id']]);
    if (!$st->fetch()) {
        json_error('Playlist no encontrada', 404);
    }
    db()->prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?')->execute([$playlistId, $trackId]);
    json_response(['ok' => true]);
}

function handle_add_history(): void
{
    $user = require_auth();
    $body = read_json_body();
    $track = $body['track'] ?? null;
    if (!is_array($track) || empty($track['id'])) {
        json_error('track requerido');
    }
    $tid = (string) $track['id'];
    db()->prepare('INSERT INTO play_history (user_id, track_id, track_json) VALUES (?, ?, ?)')
        ->execute([$user['id'], $tid, json_encode($track, JSON_UNESCAPED_UNICODE)]);
    json_response(['ok' => true]);
}

function handle_list_history(): void
{
    $user = require_auth();
    $limit = (int) ($_GET['limit'] ?? 40);
    if ($limit < 1) {
        $limit = 1;
    }
    if ($limit > 100) {
        $limit = 100;
    }

    $st = db()->prepare(
        'SELECT track_id, track_json, played_at FROM play_history WHERE user_id = ? ORDER BY played_at DESC LIMIT 200'
    );
    $st->execute([$user['id']]);

    $items = [];
    $seen = [];
    foreach ($st->fetchAll() as $row) {
        $track = json_decode($row['track_json'], true) ?: [];
        $tid = (string) ($track['id'] ?? $row['track_id'] ?? '');
        if ($tid === '' || isset($seen[$tid])) {
            continue;
        }
        $seen[$tid] = true;
        $track['id'] = $tid;
        $track['playedAt'] = strtotime((string) $row['played_at']) * 1000;
        $items[] = $track;
        if (count($items) >= $limit) {
            break;
        }
    }

    json_response(['ok' => true, 'items' => $items]);
}

function handle_recommendations(): void
{
    $user = require_auth();
    $uid = (int) $user['id'];

    $artistCounts = [];
    $st = db()->prepare('SELECT track_json FROM favorites WHERE user_id = ? ORDER BY saved_at DESC LIMIT 50');
    $st->execute([$uid]);
    foreach ($st->fetchAll() as $row) {
        $t = json_decode($row['track_json'], true) ?: [];
        $artist = trim((string) ($t['artist'] ?? ''));
        if ($artist !== '') {
            $artistCounts[$artist] = ($artistCounts[$artist] ?? 0) + 1;
        }
    }
    arsort($artistCounts);
    $topArtists = array_slice(array_keys($artistCounts), 0, 5);

    $seen = [];
    $st = db()->prepare('SELECT track_id FROM favorites WHERE user_id = ?');
    $st->execute([$uid]);
    foreach ($st->fetchAll() as $row) {
        $seen[$row['track_id']] = true;
    }

    $candidates = [];
    $st = db()->prepare('SELECT track_json FROM play_history WHERE user_id = ? ORDER BY played_at DESC LIMIT 100');
    $st->execute([$uid]);
    foreach ($st->fetchAll() as $row) {
        $t = json_decode($row['track_json'], true) ?: [];
        $aid = (string) ($t['id'] ?? '');
        $artist = (string) ($t['artist'] ?? '');
        if ($aid && empty($seen[$aid]) && in_array($artist, $topArtists, true)) {
            $candidates[] = $t;
            $seen[$aid] = true;
        }
    }

    foreach ($topArtists as $artist) {
        $candidates[] = [
            'id' => 'rec-' . md5($artist),
            'title' => "Más de $artist",
            'artist' => $artist,
            'type' => 'artist_radio',
            'image' => '',
        ];
    }

    json_response([
        'ok' => true,
        'topArtists' => $topArtists,
        'items' => array_slice($candidates, 0, 20),
        'hint' => count($topArtists) ? 'Basado en tus favoritos' : 'Marca canciones con ♥ para personalizar',
    ]);
}

function handle_admin_list_users(): void
{
    require_admin();
    $st = db()->query('SELECT id, username, email, display_name, role, is_active, created_at FROM users ORDER BY id ASC');
    $items = array_map(static fn ($row) => array_merge(user_row_to_public($row), [
        'isActive' => (bool) $row['is_active'],
    ]), $st->fetchAll());
    json_response(['ok' => true, 'items' => $items]);
}

function handle_admin_create_user(): void
{
    require_admin();
    $body = read_json_body();
    $username = trim((string) ($body['username'] ?? ''));
    $email = trim((string) ($body['email'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    $role = ($body['role'] ?? 'user') === 'admin' ? 'admin' : 'user';
    $display = trim((string) ($body['displayName'] ?? $username));

    if ($err = validate_username($username)) {
        json_error($err);
    }
    if ($err = validate_password($password)) {
        json_error($err);
    }
    if ($email !== '' && ($err = validate_email($email))) {
        json_error($err);
    }

    $pdo = db();
    $st = $pdo->prepare('SELECT id FROM users WHERE username = ? OR (email = ? AND ? <> "")');
    $st->execute([$username, $email, $email]);
    if ($st->fetch()) {
        json_error('Usuario o correo ya existe', 409);
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $st = $pdo->prepare('INSERT INTO users (username, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)');
    $st->execute([$username, $email ?: null, $hash, $display, $role]);
    json_response(['ok' => true, 'id' => (int) $pdo->lastInsertId()]);
}

function handle_admin_update_user(int $id): void
{
    $admin = require_admin();
    if ($id === (int) $admin['id']) {
        json_error('No puedes desactivarte a ti mismo', 400);
    }
    $body = read_json_body();
    $fields = [];
    $params = [];
    if (isset($body['role'])) {
        $fields[] = 'role = ?';
        $params[] = $body['role'] === 'admin' ? 'admin' : 'user';
    }
    if (isset($body['isActive'])) {
        $fields[] = 'is_active = ?';
        $params[] = $body['isActive'] ? 1 : 0;
    }
    if (isset($body['password']) && $body['password'] !== '') {
        if ($err = validate_password((string) $body['password'])) {
            json_error($err);
        }
        $fields[] = 'password_hash = ?';
        $params[] = password_hash((string) $body['password'], PASSWORD_DEFAULT);
    }
    if (!$fields) {
        json_error('Nada que actualizar');
    }
    $params[] = $id;
    db()->prepare('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
    json_response(['ok' => true]);
}

function handle_admin_delete_user(int $id): void
{
    $admin = require_admin();
    if ($id === (int) $admin['id']) {
        json_error('No puedes eliminarte a ti mismo', 400);
    }
    db()->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    json_response(['ok' => true]);
}

function handle_admin_settings(): void
{
    require_admin();
    json_response([
        'ok' => true,
        'allowRegistration' => setting('allow_registration', '1') === '1',
    ]);
}

function handle_admin_settings_patch(): void
{
    require_admin();
    $body = read_json_body();
    if (isset($body['allowRegistration'])) {
        $val = $body['allowRegistration'] ? '1' : '0';
        db()->prepare('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)')
            ->execute(['allow_registration', $val]);
    }
    handle_admin_settings();
}
