import Foundation
import SwiftUI
import AVKit

// MARK: - Config

enum VixConfig {
    static let defaultServer = "https://tv.vixred.com"
    static let serverKey = "vix_server_url"
    static let tokenKey = "vix_auth_token"

    static var serverURL: String {
        let s = UserDefaults.standard.string(forKey: serverKey) ?? defaultServer
        return s.hasSuffix("/") ? String(s.dropLast()) : s
    }

    static func saveServer(_ url: String) {
        UserDefaults.standard.set(url.trimmingCharacters(in: .whitespacesAndNewlines), forKey: serverKey)
    }
}

// MARK: - Models

struct LiveChannel: Identifiable, Decodable {
    let id: Int
    let name: String
    let logo: String?
    let group_title: String?
    let stream_url: String?
}

struct LiveCategory: Identifiable, Decodable {
    var id: String { name }
    let name: String
    let count: Int?
}

struct CatalogPoster: Identifiable, Decodable, Hashable {
    let id: Int
    let title: String
    let poster: String?
    let content_type: String?
    let rating: Double?

    var mediaType: String { content_type ?? "movie" }
    var isSeries: Bool { mediaType == "series" }

    enum CodingKeys: String, CodingKey {
        case id, title, poster, content_type, type, rating
    }

    init(id: Int, title: String, poster: String?, content_type: String?, rating: Double? = nil) {
        self.id = id
        self.title = title
        self.poster = poster
        self.content_type = content_type
        self.rating = rating
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        poster = try? c.decode(String.self, forKey: .poster)
        content_type = (try? c.decode(String.self, forKey: .content_type))
            ?? (try? c.decode(String.self, forKey: .type))
        if let r = try? c.decode(Double.self, forKey: .rating) {
            rating = r
        } else if let r = try? c.decode(Int.self, forKey: .rating) {
            rating = Double(r)
        } else {
            rating = nil
        }
    }
}

struct CatalogSection: Identifiable, Decodable {
    let id: String
    let title: String
    let subtitle: String?
    let items: [CatalogPoster]

    init(id: String, title: String, subtitle: String? = nil, items: [CatalogPoster]) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.items = items
    }

    enum CodingKeys: String, CodingKey {
        case id, title, subtitle, items
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        subtitle = try? c.decode(String.self, forKey: .subtitle)
        items = (try? c.decode([CatalogPoster].self, forKey: .items)) ?? []
    }
}

struct HomeCatalogItem: Hashable {
    let key: String
    let poster: CatalogPoster
    let progress: Double?
    let duration: Double?
    let watch: WatchItem?

    init(key: String, poster: CatalogPoster, progress: Double?, duration: Double?, watch: WatchItem? = nil) {
        self.key = key
        self.poster = poster
        self.progress = progress
        self.duration = duration
        self.watch = watch
    }
}

struct CatalogHome: Decodable {
    let sections: [CatalogSection]?
}

struct HeroSlide: Identifiable, Decodable {
    let id: Int
    let title: String
    let poster: String?
    let backdrop: String?
    let trailer: String?
    let content_type: String?
    let description: String?
    let rating: Double?

    var mediaType: String { content_type ?? "movie" }
    var isSeries: Bool { mediaType == "series" }
}

struct TrailerPlayInfo: Decodable {
    let playUrl: String
    let mime: String?
    let title: String?
}

struct StorefrontPage: Decodable {
    let title: String?
    let slug: String?
    let hero: [CatalogPoster]?
    let sections: [CatalogSection]?
}

struct UserProfile: Identifiable, Decodable, Hashable {
    let id: Int
    let name: String
    let avatar_color: String?
    let is_kids: Bool
}

struct LoginResponse {
    let token: String
    let needsProfilePick: Bool
    let profiles: [UserProfile]
    let profile: UserProfile?
}

struct MovieDetail: Decodable {
    let id: Int
    let title: String
    let poster: String?
    let backdrop: String?
    let video_path: String?
    let synopsis: String?
    let runtime: Int?
    let rating: Double?
    let similar: [CatalogPoster]?
}

struct SeriesEpisode: Identifiable, Decodable, Hashable {
    let id: Int
    let title: String?
    let season: Int
    let episode: Int
    let video_path: String?
    let poster: String?
}

struct SeriesDetail: Decodable {
    let id: Int
    let title: String
    let poster: String?
    let backdrop: String?
    let synopsis: String?
    let rating: Double?
    let episodes: [SeriesEpisode]
    let similar: [CatalogPoster]?

    enum CodingKeys: String, CodingKey {
        case id, title, poster, backdrop, synopsis, rating, episodes, similar
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        poster = try? c.decode(String.self, forKey: .poster)
        backdrop = try? c.decode(String.self, forKey: .backdrop)
        synopsis = try? c.decode(String.self, forKey: .synopsis)
        if let r = try? c.decode(Double.self, forKey: .rating) {
            rating = r
        } else if let r = try? c.decode(Int.self, forKey: .rating) {
            rating = Double(r)
        } else {
            rating = nil
        }
        episodes = (try? c.decode([SeriesEpisode].self, forKey: .episodes)) ?? []
        similar = try? c.decode([CatalogPoster].self, forKey: .similar)
    }
}

struct SearchItem: Identifiable, Decodable, Hashable {
    let id: Int
    let title: String
    let poster: String?
    let type: String?
    var mediaType: String { type ?? "movie" }
}

struct SearchResponse: Decodable {
    let query: String?
    let movies: [SearchItem]?
    let series: [SearchItem]?
    let live: [LiveChannel]?
    let total: Int?
}

struct LibraryItem: Identifiable, Decodable, Hashable {
    let id: Int
    let title: String
    let poster: String?
    let type: String
    let video_path: String?

    var isSeries: Bool { type == "series" }
}

struct WatchItem: Identifiable, Decodable, Hashable {
    var id: String { "\(content_type)-\(content_id)" }
    let content_type: String
    let content_id: Int
    let series_id: Int?
    let title: String?
    let series_title: String?
    let poster: String?
    let video_path: String?
    let progress: Double?
    let duration: Double?
    let progress_label: String?
    let season: Int?
    let episode: Int?

    var displayTitle: String {
        if content_type == "episode" {
            let st = series_title ?? title ?? "Serie"
            if let s = season, let e = episode { return "\(st) · T\(s)E\(e)" }
            return st
        }
        return title ?? "Sin título"
    }
}

struct LibraryStatus: Decodable {
    let in_watchlist: Bool
    let liked: Bool
}

// MARK: - Play URLs

enum PlayUrls {
    static func live(server: String, token: String, channelId: Int, hd: Bool = true) -> URL? {
        let enc = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token
        // Sin profile=mobile: el servidor elige la variante HLS de mayor calidad (Full HD).
        if hd {
            return URL(string: "\(server)/api/live/ch/\(channelId)/play.m3u8?token=\(enc)")
        }
        return URL(string: "\(server)/api/live/ch/\(channelId)/play.m3u8?token=\(enc)&profile=mobile")
    }

    static func poster(_ path: String?) -> URL? {
        guard let p = path, !p.isEmpty else { return nil }
        if p.hasPrefix("http") { return URL(string: p) }
        let base = VixConfig.serverURL
        return URL(string: p.hasPrefix("/") ? base + p : base + "/" + p)
    }

    static func normalizeMediaPath(_ path: String) -> String {
        var p = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !p.isEmpty else { return p }
        if p.hasPrefix("http://") || p.hasPrefix("https://") { return p }
        if !p.hasPrefix("/") { p = "/" + p }
        if !p.hasPrefix("/uploads/") {
            if p.hasPrefix("/movies/") || p.hasPrefix("/series/") || p.hasPrefix("/winscp/") {
                p = "/uploads" + p
            }
        }
        return p
    }

    private static func encodeStreamRel(_ rel: String) -> String {
        rel.split(separator: "/").map {
            $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0)
        }.joined(separator: "/")
    }

    static func video(server: String, token: String, path: String, startAt: Double = 0) -> URL? {
        let normalized = normalizeMediaPath(path)
        let base = normalized.split(separator: "?").first.map(String.init) ?? normalized
        if base.hasPrefix("http://") || base.hasPrefix("https://") {
            let enc = base.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? base
            let tok = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token
            return URL(string: "\(server)/api/live/stream?url=\(enc)&token=\(tok)")
        }
        let lower = base.lowercased()
        let encodedBase = base.split(separator: "/").map {
            $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0)
        }.joined(separator: "/")
        if base.hasPrefix("/uploads/"), [".mp4", ".webm", ".mov"].contains(where: { lower.hasSuffix($0) }) {
            return URL(string: server + (encodedBase.hasPrefix("/") ? encodedBase : "/" + encodedBase))
        }
        func withSeek(_ url: String) -> URL? {
            guard startAt > 5, lower.hasSuffix(".mkv") else { return URL(string: url) }
            let sep = url.contains("?") ? "&" : "?"
            return URL(string: "\(url)\(sep)t=\(Int(startAt))")
        }
        if base.hasPrefix("/uploads/movies/") {
            let rel = encodeStreamRel(String(base.dropFirst("/uploads/movies/".count)))
            return withSeek("\(server)/api/stream/movies/\(rel)")
        }
        if base.hasPrefix("/uploads/series/") {
            let rel = encodeStreamRel(String(base.dropFirst("/uploads/series/".count)))
            return withSeek("\(server)/api/stream/series/\(rel)")
        }
        if base.hasPrefix("/uploads/winscp/") {
            let rel = encodeStreamRel(String(base.dropFirst("/uploads/winscp/".count)))
            return withSeek("\(server)/api/stream/winscp/\(rel)")
        }
        if base.hasPrefix("/") { return URL(string: server + (encodedBase.hasPrefix("/") ? encodedBase : "/" + encodedBase)) }
        return URL(string: server + "/" + encodedBase)
    }
}

// MARK: - API

enum VixAPIError: LocalizedError {
    case http(Int, String)
    case needsPin(String)
    case invalid

    var errorDescription: String? {
        switch self {
        case .http(let c, let m): return m.isEmpty ? "Error \(c)" : m
        case .needsPin(let m): return m
        case .invalid: return "Respuesta inválida"
        }
    }
}

final class VixAPI {
    private let session: URLSession
    private(set) var token: String

    init(token: String = UserDefaults.standard.string(forKey: VixConfig.tokenKey) ?? "") {
        self.token = token
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 25
        session = URLSession(configuration: cfg)
    }

    func saveToken(_ t: String) {
        token = t
        UserDefaults.standard.set(t, forKey: VixConfig.tokenKey)
    }

    func clearToken() {
        token = ""
        UserDefaults.standard.removeObject(forKey: VixConfig.tokenKey)
    }

    private func parseError(_ data: Data, code: Int) -> VixAPIError {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let msg = (json["error"] as? String) ?? ""
            if (json["needs_pin"] as? Bool) == true || code == 403 {
                return .needsPin(msg.isEmpty ? "PIN requerido" : msg)
            }
            return .http(code, msg)
        }
        return .http(code, String(data: data, encoding: .utf8) ?? "")
    }

    private func request(path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        guard let url = URL(string: VixConfig.serverURL + path) else { throw VixAPIError.invalid }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if body != nil { req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        req.httpBody = body
        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw VixAPIError.invalid }
        if http.statusCode < 200 || http.statusCode >= 300 {
            throw parseError(data, code: http.statusCode)
        }
        return data
    }

    func login(username: String, password: String) async throws -> LoginResponse {
        let payload: [String: String] = ["username": username, "password": password]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await request(path: "/api/auth/login", method: "POST", body: body)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tok = json["token"] as? String, !tok.isEmpty else { throw VixAPIError.invalid }
        saveToken(tok)
        let profiles = decodeProfiles(json["profiles"])
        let profile = decodeProfile(json["profile"])
        let needsPick = (json["needsProfilePick"] as? Bool) ?? false
        return LoginResponse(token: tok, needsProfilePick: needsPick, profiles: profiles, profile: profile)
    }

    func selectProfile(profileId: Int, pin: String? = nil) async throws -> (token: String, profile: UserProfile?) {
        var payload: [String: Any] = ["profileId": profileId]
        if let pin = pin, !pin.isEmpty { payload["pin"] = pin }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await request(path: "/api/profiles/select", method: "POST", body: body)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tok = json["token"] as? String, !tok.isEmpty else { throw VixAPIError.invalid }
        saveToken(tok)
        return (tok, decodeProfile(json["profile"]))
    }

    func listProfiles() async throws -> [UserProfile] {
        let data = try await request(path: "/api/profiles")
        return try JSONDecoder().decode([UserProfile].self, from: data)
    }

    func createProfile(name: String, isKids: Bool, pin: String?) async throws -> UserProfile {
        var payload: [String: Any] = ["name": name, "is_kids": isKids]
        if let pin, !pin.isEmpty { payload["pin"] = pin }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await request(path: "/api/profiles", method: "POST", body: body)
        return try JSONDecoder().decode(UserProfile.self, from: data)
    }

    func setupProfile(name: String, isKids: Bool, pin: String?) async throws -> (token: String, profile: UserProfile?) {
        var payload: [String: Any] = ["name": name, "is_kids": isKids]
        if let pin, !pin.isEmpty { payload["pin"] = pin }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await request(path: "/api/profiles/setup", method: "POST", body: body)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tok = json["token"] as? String else { throw VixAPIError.invalid }
        saveToken(tok)
        return (tok, decodeProfile(json["profile"]))
    }

    func deleteProfile(id: Int) async throws {
        _ = try await request(path: "/api/profiles/\(id)", method: "DELETE")
    }

    private func decodeProfiles(_ raw: Any?) -> [UserProfile] {
        guard let arr = raw as? [[String: Any]] else { return [] }
        return arr.compactMap { decodeProfile($0) }
    }

    private func decodeProfile(_ raw: Any?) -> UserProfile? {
        guard let d = raw as? [String: Any],
              let id = d["id"] as? Int,
              let name = d["name"] as? String else { return nil }
        return UserProfile(
            id: id,
            name: name,
            avatar_color: d["avatar_color"] as? String,
            is_kids: (d["is_kids"] as? Bool) ?? ((d["is_kids"] as? Int) == 1)
        )
    }

    func liveChannels(group: String? = nil) async throws -> [LiveChannel] {
        var path = "/api/live/channels"
        if let g = group, !g.isEmpty, g != "all" {
            let enc = g.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? g
            path += "?group=\(enc)"
        }
        let data = try await request(path: path)
        return try JSONDecoder().decode([LiveChannel].self, from: data)
    }

    func liveCategories() async throws -> [LiveCategory] {
        let data = try await request(path: "/api/live/categories")
        return try JSONDecoder().decode([LiveCategory].self, from: data)
    }

    func catalogHome() async throws -> CatalogHome {
        let data = try await request(path: "/api/catalog/home")
        return try JSONDecoder().decode(CatalogHome.self, from: data)
    }

    func catalogHero() async throws -> [HeroSlide] {
        let data = try await request(path: "/api/catalog/hero")
        return try JSONDecoder().decode([HeroSlide].self, from: data)
    }

    func catalogMovies() async throws -> [CatalogSection] {
        let data = try await request(path: "/api/catalog/movies")
        return Self.decodeGenreRows(data, contentType: "movie", listKey: "movies")
    }

    func catalogSeries() async throws -> [CatalogSection] {
        let data = try await request(path: "/api/catalog/series")
        return Self.decodeGenreRows(data, contentType: "series", listKey: "series")
    }

    func catalogCategories() async throws -> [CatalogSection] {
        let data = try await request(path: "/api/catalog/categories")
        let home = try JSONDecoder().decode(CatalogHome.self, from: data)
        return home.sections ?? []
    }

    private static func decodeGenreRows(_ data: Data, contentType: String, listKey: String) -> [CatalogSection] {
        guard let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return arr.compactMap { row in
            let genre = (row["genre"] as? String) ?? "Otros"
            let raw = (row[listKey] as? [[String: Any]]) ?? []
            let items: [CatalogPoster] = raw.compactMap { d in
                guard let id = d["id"] as? Int, let title = d["title"] as? String else { return nil }
                let rating = (d["rating"] as? Double) ?? (d["rating"] as? Int).map(Double.init)
                return CatalogPoster(id: id, title: title, poster: d["poster"] as? String, content_type: contentType, rating: rating)
            }
            guard !items.isEmpty else { return nil }
            return CatalogSection(id: "\(contentType)-\(genre)", title: genre, items: items)
        }
    }

    func trailerPlayURL(youtubeKey: String) async throws -> URL {
        let key = Self.normalizeYoutubeKey(youtubeKey)
        guard !key.isEmpty else { throw VixAPIError.invalid }
        let enc = key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? key
        let data = try await request(path: "/api/trailers/youtube/\(enc)")
        let info = try JSONDecoder().decode(TrailerPlayInfo.self, from: data)
        if info.playUrl.hasPrefix("http") { return URL(string: info.playUrl)! }
        return URL(string: VixConfig.serverURL + info.playUrl)!
    }

    static func normalizeYoutubeKey(_ raw: String) -> String {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.count == 11, s.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil { return s }
        let pattern = #"(?:youtu\.be/|youtube\.com/(?:embed/|v/|shorts/|live/|watch\?(?:[^&]*&)*v=))([A-Za-z0-9_-]{11})"#
        guard let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
              let r = Range(m.range(at: 1), in: s) else { return "" }
        return String(s[r])
    }

    func storefront(slug: String) async throws -> StorefrontPage {
        let enc = slug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? slug
        let data = try await request(path: "/api/catalog/storefront/\(enc)")
        return try JSONDecoder().decode(StorefrontPage.self, from: data)
    }

    func search(query: String) async throws -> SearchResponse {
        let enc = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let data = try await request(path: "/api/search?q=\(enc)&limit=30")
        return try JSONDecoder().decode(SearchResponse.self, from: data)
    }

    func favorites() async throws -> [LibraryItem] {
        let data = try await request(path: "/api/library/likes")
        return try JSONDecoder().decode([LibraryItem].self, from: data)
    }

    func watchHistory() async throws -> [WatchItem] {
        let data = try await request(path: "/api/watch/history")
        return try JSONDecoder().decode([WatchItem].self, from: data)
    }

    func watchContinue() async throws -> [WatchItem] {
        let data = try await request(path: "/api/watch/continue")
        return try JSONDecoder().decode([WatchItem].self, from: data)
    }

    func libraryStatus(type: String, id: Int) async throws -> LibraryStatus {
        let data = try await request(path: "/api/library/status/\(type)/\(id)")
        return try JSONDecoder().decode(LibraryStatus.self, from: data)
    }

    func toggleLike(contentType: String, contentId: Int) async throws -> Bool {
        let payload: [String: Any] = ["content_type": contentType, "content_id": contentId, "list_type": "like"]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await request(path: "/api/library/toggle", method: "POST", body: body)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return (json["active"] as? Bool) ?? false
    }

    func movieDetail(id: Int) async throws -> MovieDetail {
        let data = try await request(path: "/api/movies/\(id)/detail")
        return try JSONDecoder().decode(MovieDetail.self, from: data)
    }

    func seriesDetail(id: Int) async throws -> SeriesDetail {
        let data = try await request(path: "/api/series/\(id)/detail")
        return try JSONDecoder().decode(SeriesDetail.self, from: data)
    }

    func saveWatchProgress(contentType: String, contentId: Int, seriesId: Int?, progress: Double, duration: Double) async throws {
        var payload: [String: Any] = [
            "content_type": contentType,
            "content_id": contentId,
            "progress": Int(progress),
            "duration": Int(duration)
        ]
        if let sid = seriesId { payload["series_id"] = sid }
        let body = try JSONSerialization.data(withJSONObject: payload)
        _ = try await request(path: "/api/watch/progress", method: "PUT", body: body)
    }
}

// MARK: - Native AVPlayer

final class VixPlayerController: ObservableObject {
    @Published var player: AVPlayer?
    private var observer: NSObjectProtocol?
    private var timeObserver: Any?
    var onProgress: ((Double, Double) -> Void)?

    func play(url: URL, startAt: Double = 0) {
        stop()
        let item = AVPlayerItem(url: url)
        item.preferredPeakBitRate = 0
        let p = AVPlayer(playerItem: item)
        p.automaticallyWaitsToMinimizeStalling = true
        if #available(iOS 10.0, *) {
            item.preferredForwardBufferDuration = 30
        }
        player = p
        if startAt > 0 {
            let t = CMTime(seconds: startAt, preferredTimescale: 600)
            p.seek(to: t)
        }
        p.play()
        observer = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in self?.player?.play() }
        timeObserver = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 15, preferredTimescale: 1), queue: .main) { [weak self] t in
            guard let self = self, let item = p.currentItem else { return }
            let dur = item.duration.seconds
            if dur.isFinite && dur > 0 {
                self.onProgress?(t.seconds, dur)
            }
        }
    }

    func stop() {
        if let o = observer { NotificationCenter.default.removeObserver(o) }
        observer = nil
        if let p = player, let to = timeObserver { p.removeTimeObserver(to) }
        timeObserver = nil
        onProgress = nil
        player?.pause()
        player = nil
    }
}

struct NativePlayerScreen: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        vc.allowsPictureInPicturePlayback = true
        if #available(iOS 14.0, *) {
            vc.canStartPictureInPictureAutomaticallyFromInline = true
        }
        return vc
    }

    func updateUIViewController(_ uiViewController: AVPlayerViewController, context: Context) {
        uiViewController.player = player
    }
}
