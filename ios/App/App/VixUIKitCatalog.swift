import UIKit
import AVKit
import AVFoundation

// MARK: - Theme & images

enum VixUITheme {
    static let bg = UIColor(red: 0.05, green: 0.05, blue: 0.07, alpha: 1)
    static let card = UIColor(white: 0.14, alpha: 1)
    static let accent = UIColor(red: 0.95, green: 0.58, blue: 0.12, alpha: 1)
    static let text = UIColor.white
    static let muted = UIColor(white: 0.65, alpha: 1)
}

enum VixImageLoader {
    private static let cache = NSCache<NSString, UIImage>()

    static func load(_ url: URL?, into imageView: UIImageView, placeholder: UIImage? = nil) {
        imageView.image = placeholder
        guard let url else { return }
        let key = url.absoluteString as NSString
        if let cached = cache.object(forKey: key) {
            imageView.image = cached
            return
        }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data, let img = UIImage(data: data) else { return }
            cache.setObject(img, forKey: key)
            DispatchQueue.main.async { imageView.image = img }
        }.resume()
    }
}

enum VixUIKitPlayer {
    private static var progressObserver: Any?
    private static var progressHandler: ((Double, Double) -> Void)?
    private static var statusObserver: NSKeyValueObservation?
    private static var readyObserver: NSKeyValueObservation?

    static func activateAudioSession() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    static func playerItem(for url: URL, token: String) -> AVPlayerItem {
        let path = url.absoluteString
        var headers: [String: String] = [:]
        if path.contains("/api/live/") && !path.contains("token="), !token.isEmpty {
            headers["Authorization"] = "Bearer \(token)"
        }
        if path.contains("/api/stream/") || path.contains("/uploads/") {
            headers["Accept"] = "*/*"
        }
        if !headers.isEmpty {
            let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
            return AVPlayerItem(asset: asset)
        }
        return AVPlayerItem(url: url)
    }

    private static func isVodStreamURL(_ url: URL) -> Bool {
        let s = url.absoluteString
        return s.contains("/api/stream/") || s.contains("/uploads/")
    }

    private static func topPresenter(from vc: UIViewController) -> UIViewController {
        var target = vc
        while let presented = target.presentedViewController { target = presented }
        return target
    }

    static func playFullscreen(
        from vc: UIViewController,
        url: URL,
        startAt: Double = 0,
        onProgress: ((Double, Double) -> Void)? = nil
    ) {
        playFullscreen(from: vc, url: url, startAt: startAt, allowTranscodeFallback: true, onProgress: onProgress)
    }

    private static func playFullscreen(
        from vc: UIViewController,
        url: URL,
        startAt: Double,
        allowTranscodeFallback: Bool,
        onProgress: ((Double, Double) -> Void)?
    ) {
        activateAudioSession()
        clearObservers()
        progressHandler = onProgress
        let token = AuthSession.shared.api.token
        let item = playerItem(for: url, token: token)
        let isStream = isVodStreamURL(url)
        if isStream {
            item.preferredPeakBitRate = 0
            item.preferredForwardBufferDuration = 45
        }

        func openPlayer() {
            let player = AVPlayer(playerItem: item)
            player.automaticallyWaitsToMinimizeStalling = false
            if let onProgress {
                progressObserver = player.addPeriodicTimeObserver(
                    forInterval: CMTime(seconds: 15, preferredTimescale: 1),
                    queue: .main
                ) { t in
                    let dur = player.currentItem?.duration.seconds ?? 0
                    if dur.isFinite && dur > 0 { onProgress(t.seconds, dur) }
                }
            }
            statusObserver = item.observe(\.status, options: [.new]) { [weak vc] observed, _ in
                guard observed.status == .failed, allowTranscodeFallback, isStream, let vc else { return }
                guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
                var query = parts.queryItems ?? []
                if query.contains(where: { $0.name == "transcode" }) { return }
                query.append(URLQueryItem(name: "transcode", value: "1"))
                parts.queryItems = query
                guard let retry = parts.url else { return }
                DispatchQueue.main.async {
                    vc.presentedViewController?.dismiss(animated: false)
                    playFullscreen(from: vc, url: retry, startAt: 0, allowTranscodeFallback: false, onProgress: onProgress)
                }
            }
            let pvc = AVPlayerViewController()
            pvc.player = player
            pvc.modalPresentationStyle = .fullScreen
            topPresenter(from: vc).present(pvc, animated: true) {
                beginPlayback(player: player, item: item, startAt: startAt)
            }
        }

        if let asset = item.asset as? AVURLAsset {
            asset.loadValuesAsynchronously(forKeys: ["playable", "duration"]) {
                DispatchQueue.main.async { openPlayer() }
            }
        } else {
            openPlayer()
        }
    }

    private static func beginPlayback(player: AVPlayer, item: AVPlayerItem, startAt: Double) {
        readyObserver?.invalidate()
        readyObserver = nil

        func start() {
            if startAt > 5 {
                player.seek(to: CMTime(seconds: startAt, preferredTimescale: 600)) { finished in
                    if finished { player.play() }
                }
            } else {
                player.play()
            }
        }

        if item.status == .readyToPlay {
            start()
            return
        }

        readyObserver = item.observe(\.status, options: [.new]) { observed, _ in
            switch observed.status {
            case .readyToPlay:
                readyObserver?.invalidate()
                readyObserver = nil
                start()
            case .failed:
                readyObserver?.invalidate()
                readyObserver = nil
            default:
                break
            }
        }
    }

    private static func clearObservers() {
        progressHandler = nil
        progressObserver = nil
        statusObserver?.invalidate()
        statusObserver = nil
        readyObserver?.invalidate()
        readyObserver = nil
    }

    static func attachLive(player: inout AVPlayer?, playerVC: AVPlayerViewController, url: URL) {
        activateAudioSession()
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        let token = AuthSession.shared.api.token
        let item = playerItem(for: url, token: token)
        item.preferredPeakBitRate = 0
        if #available(iOS 10.0, *) {
            item.preferredForwardBufferDuration = 8
        }
        playerVC.videoGravity = .resizeAspect
        if let existing = player {
            existing.replaceCurrentItem(with: item)
            playerVC.player = existing
            existing.play()
        } else {
            let p = AVPlayer(playerItem: item)
            p.automaticallyWaitsToMinimizeStalling = true
            p.appliesMediaSelectionCriteriaAutomatically = true
            player = p
            playerVC.player = p
            p.play()
        }
    }

    static func stop(player: inout AVPlayer?, playerVC: AVPlayerViewController? = nil) {
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        playerVC?.player = nil
        player = nil
    }
}

enum VixMetaChip {
    static func make(_ text: String) -> UILabel {
        let l = UILabel()
        l.text = "  \(text)  "
        l.font = .systemFont(ofSize: 12, weight: .semibold)
        l.textColor = .white
        l.backgroundColor = UIColor.white.withAlphaComponent(0.12)
        l.layer.cornerRadius = 6
        l.clipsToBounds = true
        return l
    }
}

// MARK: - Home (Tele Latino style)

final class UIKitHomeViewController: UIViewController {
    private enum Section: Hashable {
        case hero
        case tabs
        case row(id: String, title: String, subtitle: String?)
    }

    private let tabs: [HomeTab] = [
        HomeTab(slug: "inicio", title: "Inicio"),
        HomeTab(slug: "destacados", title: "Destacados"),
        HomeTab(slug: "peliculas", title: "Películas"),
        HomeTab(slug: "series", title: "Series"),
        HomeTab(slug: "kids", title: "Kids"),
        HomeTab(slug: "anime", title: "Anime"),
        HomeTab(slug: "explorar", title: "Explorar"),
        HomeTab(slug: "categorias", title: "Categorías")
    ]

    private var collectionView: UICollectionView!
    private var dataSource: UICollectionViewDiffableDataSource<Section, HomeCatalogItem>!
    private var heroSlides: [HeroSlide] = []
    private var sections: [CatalogSection] = []
    private var continueItems: [WatchItem] = []
    private var selectedTab = "inicio"
    private let heroView = VixHeroCarouselView()
    private let searchField = UITextField()
    private let spinner = UIActivityIndicatorView(style: .large)
    private var heroTimer: Timer?
    private weak var tabBarCell: VixTabCell?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = VixUITheme.bg
        navigationController?.setNavigationBarHidden(true, animated: false)
        setupHeader()
        setupCollection()
        setupSpinner()
        reloadContent()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        heroView.pause()
        heroTimer?.invalidate()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        heroView.resumeIfNeeded()
        startHeroTimer()
    }

    private func setupHeader() {
        let logo = UILabel()
        logo.text = "Vix TV"
        logo.font = .boldSystemFont(ofSize: 22)
        logo.textColor = VixUITheme.accent

        searchField.placeholder = "Buscar por título…"
        searchField.textColor = .white
        searchField.backgroundColor = VixUITheme.card
        searchField.layer.cornerRadius = 10
        searchField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
        searchField.leftViewMode = .always
        searchField.returnKeyType = .search
        searchField.delegate = self
        searchField.autocapitalizationType = .none
        searchField.autocorrectionType = .no

        let profile = UIButton(type: .system)
        profile.setImage(UIImage(systemName: "person.circle.fill"), for: .normal)
        profile.tintColor = VixUITheme.muted
        profile.addTarget(self, action: #selector(openAccount), for: .touchUpInside)

        let top = UIStackView(arrangedSubviews: [logo, searchField, profile])
        top.axis = .horizontal
        top.spacing = 10
        top.alignment = .center
        top.translatesAutoresizingMaskIntoConstraints = false
        searchField.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.addSubview(top)
        NSLayoutConstraint.activate([
            top.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            top.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            top.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            searchField.heightAnchor.constraint(equalToConstant: 40),
            profile.widthAnchor.constraint(equalToConstant: 36)
        ])
    }

    private func setupCollection() {
        collectionView = UICollectionView(frame: .zero, collectionViewLayout: makeLayout())
        collectionView.backgroundColor = .clear
        collectionView.translatesAutoresizingMaskIntoConstraints = false
        collectionView.delegate = self
        view.addSubview(collectionView)

        let heroReg = UICollectionView.CellRegistration<UICollectionViewCell, HomeCatalogItem> { [weak self] cell, _, _ in
            guard let self else { return }
            cell.contentView.subviews.forEach { $0.removeFromSuperview() }
            self.heroView.translatesAutoresizingMaskIntoConstraints = false
            cell.contentView.addSubview(self.heroView)
            NSLayoutConstraint.activate([
                self.heroView.topAnchor.constraint(equalTo: cell.contentView.topAnchor),
                self.heroView.leadingAnchor.constraint(equalTo: cell.contentView.leadingAnchor),
                self.heroView.trailingAnchor.constraint(equalTo: cell.contentView.trailingAnchor),
                self.heroView.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor)
            ])
        }

        let tabsReg = UICollectionView.CellRegistration<VixTabCell, HomeCatalogItem> { [weak self] cell, _, _ in
            guard let self else { return }
            self.tabBarCell = cell
            cell.configure(tabs: self.tabs, selected: self.selectedTab) { slug in
                self.selectedTab = slug
                self.tabBarCell?.updateSelected(slug)
                self.reloadContent()
            }
        }

        let posterReg = UICollectionView.CellRegistration<VixPosterCell, HomeCatalogItem> { cell, _, item in
            cell.configure(item: item.poster, progress: item.progress, duration: item.duration)
        }

        dataSource = UICollectionViewDiffableDataSource<Section, HomeCatalogItem>(collectionView: collectionView) { cv, indexPath, item in
            let section = self.dataSource.snapshot().sectionIdentifiers[indexPath.section]
            switch section {
            case .hero:
                return cv.dequeueConfiguredReusableCell(using: heroReg, for: indexPath, item: item)
            case .tabs:
                return cv.dequeueConfiguredReusableCell(using: tabsReg, for: indexPath, item: item)
            case .row:
                return cv.dequeueConfiguredReusableCell(using: posterReg, for: indexPath, item: item)
            }
        }

        collectionView.register(VixSectionHeader.self,
            forSupplementaryViewOfKind: UICollectionView.elementKindSectionHeader,
            withReuseIdentifier: VixSectionHeader.reuseId)

        dataSource.supplementaryViewProvider = { [weak self] cv, kind, indexPath in
            guard kind == UICollectionView.elementKindSectionHeader,
                  let self,
                  case .row(_, let title, let subtitle) = self.dataSource.snapshot().sectionIdentifiers[indexPath.section] else { return nil }
            let header = cv.dequeueReusableSupplementaryView(
                ofKind: kind,
                withReuseIdentifier: VixSectionHeader.reuseId,
                for: indexPath
            ) as! VixSectionHeader
            header.setTitle(title, subtitle: subtitle)
            return header
        }

        NSLayoutConstraint.activate([
            collectionView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 56),
            collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            collectionView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func setupSpinner() {
        spinner.color = VixUITheme.accent
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    private func makeLayout() -> UICollectionViewLayout {
        UICollectionViewCompositionalLayout { [weak self] sectionIndex, env in
            guard let self else { return nil }
            let section = self.dataSource?.snapshot().sectionIdentifiers[sectionIndex]
            switch section {
            case .hero:
                let item = NSCollectionLayoutItem(layoutSize: NSCollectionLayoutSize(
                    widthDimension: .fractionalWidth(1), heightDimension: .fractionalHeight(1)))
                let group = NSCollectionLayoutGroup.horizontal(layoutSize: NSCollectionLayoutSize(
                    widthDimension: .fractionalWidth(1), heightDimension: .absolute(260)), subitems: [item])
                return NSCollectionLayoutSection(group: group)
            case .tabs:
                let item = NSCollectionLayoutItem(layoutSize: NSCollectionLayoutSize(
                    widthDimension: .fractionalWidth(1), heightDimension: .fractionalHeight(1)))
                let group = NSCollectionLayoutGroup.horizontal(layoutSize: NSCollectionLayoutSize(
                    widthDimension: .fractionalWidth(1), heightDimension: .absolute(48)), subitems: [item])
                let sec = NSCollectionLayoutSection(group: group)
                sec.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 0, bottom: 8, trailing: 0)
                return sec
            case .row(id: _, title: _, subtitle: _):
                let item = NSCollectionLayoutItem(layoutSize: NSCollectionLayoutSize(
                    widthDimension: .absolute(118), heightDimension: .absolute(178)))
                let group = NSCollectionLayoutGroup.horizontal(layoutSize: NSCollectionLayoutSize(
                    widthDimension: .absolute(118), heightDimension: .absolute(178)), subitems: [item])
                group.interItemSpacing = .fixed(10)
                let row = NSCollectionLayoutSection(group: group)
                row.orthogonalScrollingBehavior = .continuous
                row.interGroupSpacing = 10
                row.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 16, bottom: 20, trailing: 16)
                let header = NSCollectionLayoutBoundarySupplementaryItem(
                    layoutSize: NSCollectionLayoutSize(widthDimension: .fractionalWidth(1), heightDimension: .absolute(48)),
                    elementKind: UICollectionView.elementKindSectionHeader,
                    alignment: .top)
                row.boundarySupplementaryItems = [header]
                return row
            case .none:
                return nil
            }
        }
    }

    private func reloadContent() {
        spinner.startAnimating()
        Task {
            do {
                let api = AuthSession.shared.api
                let tab = self.selectedTab
                async let heroTask: [HeroSlide] = self.loadHero(for: tab, api: api)
                async let continueTask: [WatchItem] = tab == "inicio" ? (try? await api.watchContinue()) ?? [] : []
                let catalogSections: [CatalogSection] = try await self.loadSections(for: tab, api: api)
                let hero = await heroTask
                let cont = await continueTask
                await MainActor.run {
                    self.heroSlides = hero
                    self.sections = catalogSections
                    self.continueItems = cont
                    self.heroView.setSlides(hero, api: api)
                    self.applySnapshot()
                    self.spinner.stopAnimating()
                    self.startHeroTimer()
                }
            } catch {
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.showError(error.localizedDescription)
                }
            }
        }
    }

    private func loadHero(for tab: String, api: VixAPI) async -> [HeroSlide] {
        if tab == "inicio" || tab == "peliculas" || tab == "series" || tab == "categorias" {
            return (try? await api.catalogHero()) ?? []
        }
        if ["destacados", "kids", "anime", "explorar"].contains(tab),
           let page = try? await api.storefront(slug: tab) {
            return (page.hero ?? []).map { h in
                HeroSlide(id: h.id, title: h.title, poster: h.poster, backdrop: h.poster,
                          trailer: nil, content_type: h.content_type, description: nil, rating: nil)
            }
        }
        return []
    }

    private func loadSections(for tab: String, api: VixAPI) async throws -> [CatalogSection] {
        switch tab {
        case "inicio":
            return try await api.catalogHome().sections ?? []
        case "peliculas":
            return try await api.catalogMovies()
        case "series":
            return try await api.catalogSeries()
        case "categorias":
            return try await api.catalogCategories()
        case "destacados", "kids", "anime", "explorar":
            return try await api.storefront(slug: tab).sections ?? []
        default:
            return try await api.catalogHome().sections ?? []
        }
    }

    private func applySnapshot() {
        var snap = NSDiffableDataSourceSnapshot<Section, HomeCatalogItem>()
        snap.appendSections([.hero, .tabs])
        snap.appendItems([HomeCatalogItem(key: "hero", poster: CatalogPoster(id: -1, title: "", poster: nil, content_type: nil), progress: nil, duration: nil)], toSection: .hero)
        snap.appendItems([HomeCatalogItem(key: "tabs-\(selectedTab)", poster: CatalogPoster(id: -2, title: "", poster: nil, content_type: nil), progress: nil, duration: nil)], toSection: .tabs)

        if selectedTab == "inicio" && !continueItems.isEmpty {
            let sec = Section.row(id: "continue-watching", title: "Seguir viendo", subtitle: "Retoma donde lo dejaste")
            snap.appendSections([sec])
            let items = continueItems.prefix(16).map { w in
                let poster = CatalogPoster(
                    id: w.content_type == "episode" ? (w.series_id ?? w.content_id) : w.content_id,
                    title: w.displayTitle,
                    poster: w.poster,
                    content_type: w.content_type == "episode" ? "series" : "movie"
                )
                return HomeCatalogItem(
                    key: "cw-\(w.content_type)-\(w.content_id)",
                    poster: poster,
                    progress: w.progress,
                    duration: w.duration,
                    watch: w
                )
            }
            snap.appendItems(items, toSection: sec)
        }

        for sec in sections where !sec.items.isEmpty {
            let section = Section.row(id: sec.id, title: sec.title, subtitle: sec.subtitle)
            snap.appendSections([section])
            let items = sec.items.prefix(24).map { p in
                let key: String
                if p.isExternal, let src = p.source, let sl = p.slug {
                    key = "\(sec.id)-ext-\(src)-\(sl)"
                } else {
                    key = "\(sec.id)-\(p.mediaType)-\(p.id)"
                }
                return HomeCatalogItem(key: key, poster: p, progress: nil, duration: nil)
            }
            snap.appendItems(items, toSection: section)
        }
        dataSource.apply(snap, animatingDifferences: false)
    }

    private func startHeroTimer() {
        heroTimer?.invalidate()
        guard heroSlides.count > 1 else { return }
        heroTimer = Timer.scheduledTimer(withTimeInterval: 32, repeats: true) { [weak self] _ in
            self?.heroView.advance()
        }
    }

    @objc private func openAccount() {
        tabBarController?.selectedIndex = 2
    }

    private func showError(_ msg: String) {
        let a = UIAlertController(title: "Error", message: msg, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }

    private func openDetail(_ item: CatalogPoster) {
        if item.isExternal, let src = item.source, let slug = item.slug {
            if item.isSeries {
                navigationController?.pushViewController(
                    UIKitExternalSeriesDetailViewController(source: src, slug: slug), animated: true)
            } else {
                navigationController?.pushViewController(
                    UIKitExternalMovieDetailViewController(source: src, slug: slug, year: item.year), animated: true)
            }
            return
        }
        if item.isSeries {
            navigationController?.pushViewController(UIKitSeriesDetailViewController(seriesId: item.id), animated: true)
        } else {
            navigationController?.pushViewController(UIKitMovieDetailViewController(movieId: item.id), animated: true)
        }
    }
}

extension UIKitHomeViewController: UICollectionViewDelegate {
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        guard let catalogItem = dataSource.itemIdentifier(for: indexPath) else { return }
        let section = dataSource.snapshot().sectionIdentifiers[indexPath.section]
        guard case .row = section else { return }
        if let watch = catalogItem.watch {
            openWatch(watch)
            return
        }
        let poster = catalogItem.poster
        if !poster.isExternal && poster.id <= 0 { return }
        openDetail(poster)
    }

    private func openWatch(_ item: WatchItem) {
        if item.content_type == "episode", let sid = item.series_id {
            navigationController?.pushViewController(
                UIKitSeriesDetailViewController(seriesId: sid, episodeId: item.content_id, startAt: item.progress ?? 0),
                animated: true
            )
        } else if let path = item.video_path, !path.isEmpty,
                  let url = PlayUrls.video(server: VixConfig.serverURL, token: AuthSession.shared.api.token, path: path, startAt: item.progress ?? 0) {
            VixUIKitPlayer.playFullscreen(from: self, url: url, startAt: item.progress ?? 0) { prog, dur in
                Task {
                    try? await AuthSession.shared.api.saveWatchProgress(
                        contentType: "movie", contentId: item.content_id, seriesId: nil, progress: prog, duration: dur
                    )
                }
            }
        } else {
            navigationController?.pushViewController(
                UIKitMovieDetailViewController(movieId: item.content_id, startAt: item.progress ?? 0),
                animated: true
            )
        }
    }
}

extension UIKitHomeViewController: UITextFieldDelegate {
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        guard let q = textField.text?.trimmingCharacters(in: .whitespacesAndNewlines), !q.isEmpty else { return true }
        navigationController?.pushViewController(UIKitSearchViewController(query: q), animated: true)
        return true
    }
}

// MARK: - Hero carousel

final class VixHeroCarouselView: UIView {
    private let imageView = UIImageView()
    private let titleLabel = UILabel()
    private let dotsStack = UIStackView()
    private let muteButton = UIButton(type: .system)
    private let gradient = CAGradientLayer()
    private var player: AVPlayer?
    private var playerLayer: AVPlayerLayer?
    private var endObserver: NSObjectProtocol?
    private var slides: [HeroSlide] = []
    private var index = 0
    private var isMuted = true
    private weak var api: VixAPI?

    override init(frame: CGRect) {
        super.init(frame: frame)
        clipsToBounds = true
        layer.cornerRadius = 12
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(imageView)

        gradient.colors = [UIColor.clear.cgColor, UIColor.black.withAlphaComponent(0.85).cgColor]
        gradient.locations = [0.45, 1]
        layer.addSublayer(gradient)

        muteButton.tintColor = .white
        muteButton.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        muteButton.layer.cornerRadius = 18
        muteButton.translatesAutoresizingMaskIntoConstraints = false
        muteButton.isHidden = true
        muteButton.addTarget(self, action: #selector(toggleMute), for: .touchUpInside)
        updateMuteIcon()
        addSubview(muteButton)

        titleLabel.font = .boldSystemFont(ofSize: 26)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 2
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        addSubview(titleLabel)

        dotsStack.axis = .horizontal
        dotsStack.spacing = 6
        dotsStack.alignment = .center
        dotsStack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(dotsStack)

        NSLayoutConstraint.activate([
            imageView.topAnchor.constraint(equalTo: topAnchor),
            imageView.leadingAnchor.constraint(equalTo: leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: trailingAnchor),
            imageView.bottomAnchor.constraint(equalTo: bottomAnchor),
            muteButton.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            muteButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            muteButton.widthAnchor.constraint(equalToConstant: 36),
            muteButton.heightAnchor.constraint(equalToConstant: 36),
            titleLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            titleLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            titleLabel.bottomAnchor.constraint(equalTo: dotsStack.topAnchor, constant: -10),
            dotsStack.centerXAnchor.constraint(equalTo: centerXAnchor),
            dotsStack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        gradient.frame = bounds
        playerLayer?.frame = bounds
    }

    func setSlides(_ slides: [HeroSlide], api: VixAPI) {
        self.slides = slides
        self.api = api
        index = 0
        rebuildDots()
        showSlide(at: 0)
    }

    func advance() {
        guard slides.count > 1 else { return }
        index = (index + 1) % slides.count
        showSlide(at: index)
    }

    func pause() {
        player?.pause()
    }

    func resumeIfNeeded() {
        player?.play()
    }

    private func rebuildDots() {
        dotsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for i in 0..<slides.count {
            let dot = UIView()
            dot.layer.cornerRadius = 4
            dot.translatesAutoresizingMaskIntoConstraints = false
            dot.widthAnchor.constraint(equalToConstant: i == index ? 18 : 8).isActive = true
            dot.heightAnchor.constraint(equalToConstant: 8).isActive = true
            dot.backgroundColor = i == index ? VixUITheme.accent : UIColor.white.withAlphaComponent(0.35)
            dotsStack.addArrangedSubview(dot)
        }
    }

    private func showSlide(at i: Int) {
        guard slides.indices.contains(i) else {
            imageView.image = nil
            titleLabel.text = ""
            stopPlayer()
            return
        }
        index = i
        rebuildDots()
        let slide = slides[i]
        if let r = slide.rating, r > 0 {
            titleLabel.text = "\(slide.title.uppercased())  ⭐ \(String(format: "%.1f", r))"
        } else {
            titleLabel.text = slide.title.uppercased()
        }
        let imgURL = PlayUrls.poster(slide.backdrop ?? slide.poster)
        VixImageLoader.load(imgURL, into: imageView)
        stopPlayer()
        guard let trailer = slide.trailer, !trailer.isEmpty, let api else { return }
        Task {
            do {
                let url = try await api.trailerPlayURL(youtubeKey: trailer)
                await MainActor.run { self.playTrailer(url) }
            } catch { /* backdrop only */ }
        }
    }

    private func playTrailer(_ url: URL) {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        let item = AVPlayerItem(url: url)
        let p = AVPlayer(playerItem: item)
        p.isMuted = isMuted
        p.volume = isMuted ? 0 : 1
        p.actionAtItemEnd = .none
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak p] _ in p?.seek(to: .zero); p?.play() }
        let layer = AVPlayerLayer(player: p)
        layer.videoGravity = .resizeAspectFill
        layer.frame = bounds
        self.layer.insertSublayer(layer, above: imageView.layer)
        playerLayer = layer
        player = p
        muteButton.isHidden = false
        bringSubviewToFront(muteButton)
        p.play()
    }

    @objc private func toggleMute() {
        isMuted.toggle()
        player?.isMuted = isMuted
        player?.volume = isMuted ? 0 : 1
        updateMuteIcon()
    }

    private func updateMuteIcon() {
        let icon = isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill"
        muteButton.setImage(UIImage(systemName: icon), for: .normal)
    }

    private func stopPlayer() {
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        player?.pause()
        player = nil
        playerLayer?.removeFromSuperlayer()
        playerLayer = nil
        muteButton.isHidden = true
    }
}

// MARK: - Cells

final class VixTabCell: UICollectionViewCell {
    private let scroll = UIScrollView()
    private let stack = UIStackView()
    private var tabButtons: [String: UIButton] = [:]
    private var onSelect: ((String) -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        scroll.showsHorizontalScrollIndicator = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .horizontal
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: contentView.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            scroll.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            stack.topAnchor.constraint(equalTo: scroll.topAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
            stack.heightAnchor.constraint(equalTo: scroll.heightAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(tabs: [HomeTab], selected: String, onSelect: @escaping (String) -> Void) {
        self.onSelect = onSelect
        if tabButtons.isEmpty {
            for tab in tabs {
                let btn = UIButton(type: .system)
                btn.setTitle(tab.title, for: .normal)
                btn.titleLabel?.font = .systemFont(ofSize: 14, weight: .medium)
                btn.contentEdgeInsets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
                btn.layer.cornerRadius = 18
                let slug = tab.slug
                btn.addAction(UIAction { [weak self] _ in
                    self?.onSelect?(slug)
                }, for: .touchUpInside)
                tabButtons[slug] = btn
                stack.addArrangedSubview(btn)
            }
        }
        updateSelected(selected)
    }

    func updateSelected(_ selected: String) {
        for (slug, btn) in tabButtons {
            let active = slug == selected
            btn.titleLabel?.font = .systemFont(ofSize: 14, weight: active ? .bold : .medium)
            btn.setTitleColor(active ? VixUITheme.accent : VixUITheme.muted, for: .normal)
            btn.layer.borderWidth = active ? 1 : 0
            btn.layer.borderColor = active ? VixUITheme.accent.withAlphaComponent(0.55).cgColor : nil
            btn.backgroundColor = active ? VixUITheme.accent.withAlphaComponent(0.12) : .clear
        }
        if let btn = tabButtons[selected] {
            let frame = btn.convert(btn.bounds, to: scroll)
            scroll.scrollRectToVisible(frame.insetBy(dx: -16, dy: 0), animated: true)
        }
    }
}

struct HomeTab: Hashable {
    let slug: String
    let title: String
}

final class VixPosterCell: UICollectionViewCell {
    static let reuseId = "poster"
    private let imageView = UIImageView()
    private let titleLabel = UILabel()
    private let ratingLabel = UILabel()
    private let progressBar = UIView()
    private let progressFill = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.backgroundColor = VixUITheme.card
        contentView.layer.cornerRadius = 8
        contentView.clipsToBounds = true
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.translatesAutoresizingMaskIntoConstraints = false
        ratingLabel.font = .systemFont(ofSize: 10, weight: .bold)
        ratingLabel.textColor = .white
        ratingLabel.backgroundColor = UIColor.black.withAlphaComponent(0.65)
        ratingLabel.layer.cornerRadius = 6
        ratingLabel.clipsToBounds = true
        ratingLabel.textAlignment = .center
        ratingLabel.translatesAutoresizingMaskIntoConstraints = false
        progressBar.backgroundColor = UIColor.white.withAlphaComponent(0.2)
        progressFill.backgroundColor = VixUITheme.accent
        progressBar.translatesAutoresizingMaskIntoConstraints = false
        progressFill.translatesAutoresizingMaskIntoConstraints = false
        progressBar.isHidden = true
        titleLabel.font = .systemFont(ofSize: 11, weight: .medium)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 2
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(imageView)
        contentView.addSubview(ratingLabel)
        contentView.addSubview(progressBar)
        progressBar.addSubview(progressFill)
        contentView.addSubview(titleLabel)
        NSLayoutConstraint.activate([
            imageView.topAnchor.constraint(equalTo: contentView.topAnchor),
            imageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            imageView.heightAnchor.constraint(equalTo: contentView.widthAnchor, multiplier: 1.45),
            ratingLabel.topAnchor.constraint(equalTo: imageView.topAnchor, constant: 6),
            ratingLabel.trailingAnchor.constraint(equalTo: imageView.trailingAnchor, constant: -6),
            ratingLabel.heightAnchor.constraint(equalToConstant: 20),
            ratingLabel.widthAnchor.constraint(greaterThanOrEqualToConstant: 34),
            progressBar.leadingAnchor.constraint(equalTo: imageView.leadingAnchor),
            progressBar.trailingAnchor.constraint(equalTo: imageView.trailingAnchor),
            progressBar.bottomAnchor.constraint(equalTo: imageView.bottomAnchor),
            progressBar.heightAnchor.constraint(equalToConstant: 4),
            progressFill.leadingAnchor.constraint(equalTo: progressBar.leadingAnchor),
            progressFill.topAnchor.constraint(equalTo: progressBar.topAnchor),
            progressFill.bottomAnchor.constraint(equalTo: progressBar.bottomAnchor),
            titleLabel.topAnchor.constraint(equalTo: imageView.bottomAnchor, constant: 4),
            titleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 4),
            titleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -4),
            titleLabel.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor, constant: -4)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    private var progressWidth: NSLayoutConstraint?

    override func prepareForReuse() {
        super.prepareForReuse()
        progressBar.isHidden = true
        ratingLabel.isHidden = true
        progressWidth?.isActive = false
        progressWidth = nil
    }

    func configure(item: CatalogPoster, progress: Double? = nil, duration: Double? = nil) {
        titleLabel.text = item.title
        VixImageLoader.load(PlayUrls.poster(item.poster), into: imageView,
                            placeholder: UIImage(systemName: item.isSeries ? "tv" : "film"))
        if let r = item.rating, r > 0 {
            ratingLabel.isHidden = false
            ratingLabel.text = " ⭐\(String(format: "%.1f", r)) "
        } else {
            ratingLabel.isHidden = true
        }
        if let prog = progress, let dur = duration, dur > 0, prog > 0 {
            progressBar.isHidden = false
            let pct = min(1, max(0, prog / dur))
            progressWidth?.isActive = false
            progressWidth = progressFill.widthAnchor.constraint(equalTo: progressBar.widthAnchor, multiplier: pct)
            progressWidth?.isActive = true
        } else {
            progressBar.isHidden = true
        }
    }
}

final class VixSectionHeader: UICollectionReusableView {
    static let reuseId = "hdr"
    private let label = UILabel()
    private let subtitleLabel = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        label.font = .boldSystemFont(ofSize: 18)
        label.textColor = .white
        label.translatesAutoresizingMaskIntoConstraints = false
        subtitleLabel.font = .systemFont(ofSize: 12)
        subtitleLabel.textColor = VixUITheme.muted
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        addSubview(subtitleLabel)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            label.topAnchor.constraint(equalTo: topAnchor, constant: 4),
            subtitleLabel.leadingAnchor.constraint(equalTo: label.leadingAnchor),
            subtitleLabel.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 2),
            subtitleLabel.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor, constant: -4)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func setTitle(_ t: String, subtitle: String? = nil) {
        label.text = t
        subtitleLabel.text = subtitle
        subtitleLabel.isHidden = (subtitle ?? "").isEmpty
    }
}

// MARK: - Live TV (mejorado)

final class UIKitLiveViewController: UIViewController {
    private let playerVC = AVPlayerViewController()
    private var livePlayer: AVPlayer?
    private let categoryScroll = UIScrollView()
    private let categoryStack = UIStackView()
    private let table = UITableView(frame: .zero, style: .plain)
    private var channels: [LiveChannel] = []
    private var categories: [LiveCategory] = []
    private var selectedGroup = "all"
    private var playingChannelId: Int?
    private let spinner = UIActivityIndicatorView(style: .large)

    private static let lastLiveChannelKey = "vix_last_live_channel_id"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = VixUITheme.bg
        navigationController?.setNavigationBarHidden(true, animated: false)

        let title = UILabel()
        title.text = "TV en vivo"
        title.font = .boldSystemFont(ofSize: 22)
        title.textColor = VixUITheme.accent
        title.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(title)

        playerVC.view.translatesAutoresizingMaskIntoConstraints = false
        playerVC.view.layer.cornerRadius = 12
        playerVC.view.clipsToBounds = true
        playerVC.view.isHidden = true
        addChild(playerVC)
        view.addSubview(playerVC.view)
        playerVC.didMove(toParent: self)

        categoryScroll.showsHorizontalScrollIndicator = false
        categoryScroll.translatesAutoresizingMaskIntoConstraints = false
        categoryStack.axis = .horizontal
        categoryStack.spacing = 8
        categoryStack.translatesAutoresizingMaskIntoConstraints = false
        categoryScroll.addSubview(categoryStack)
        view.addSubview(categoryScroll)

        table.backgroundColor = .clear
        table.separatorColor = UIColor.white.withAlphaComponent(0.08)
        table.rowHeight = 64
        table.dataSource = self
        table.delegate = self
        table.register(VixChannelCell.self, forCellReuseIdentifier: VixChannelCell.reuseId)
        table.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(table)

        spinner.color = VixUITheme.accent
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)

        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            title.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            playerVC.view.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 12),
            playerVC.view.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            playerVC.view.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            playerVC.view.heightAnchor.constraint(equalTo: view.widthAnchor, multiplier: 9.0 / 16.0, constant: -32),
            categoryScroll.topAnchor.constraint(equalTo: playerVC.view.bottomAnchor, constant: 12),
            categoryScroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            categoryScroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            categoryScroll.heightAnchor.constraint(equalToConstant: 40),
            categoryStack.topAnchor.constraint(equalTo: categoryScroll.topAnchor),
            categoryStack.leadingAnchor.constraint(equalTo: categoryScroll.leadingAnchor, constant: 16),
            categoryStack.trailingAnchor.constraint(equalTo: categoryScroll.trailingAnchor, constant: -16),
            categoryStack.bottomAnchor.constraint(equalTo: categoryScroll.bottomAnchor),
            categoryStack.heightAnchor.constraint(equalTo: categoryScroll.heightAnchor),
            table.topAnchor.constraint(equalTo: categoryScroll.bottomAnchor, constant: 8),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        loadCategories()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        VixLivePlayback.current = self
        if livePlayer == nil, !channels.isEmpty {
            playRandomChannel()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if isMovingFromParent || tabBarController?.selectedViewController !== navigationController {
            stopPlayback()
        }
    }

    func stopPlayback() {
        VixUIKitPlayer.stop(player: &livePlayer, playerVC: playerVC)
        playerVC.view.isHidden = true
    }

    private func loadCategories() {
        spinner.startAnimating()
        Task {
            do {
                let cats = try await AuthSession.shared.api.liveCategories()
                await MainActor.run {
                    self.categories = cats
                    self.buildCategoryChips()
                    self.loadChannels()
                }
            } catch {
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.loadChannels()
                }
            }
        }
    }

    private func buildCategoryChips() {
        categoryStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let all = makeChip("Todos", slug: "all", selected: selectedGroup == "all")
        categoryStack.addArrangedSubview(all)
        for c in categories.prefix(12) {
            categoryStack.addArrangedSubview(makeChip(c.name, slug: c.name, selected: selectedGroup == c.name))
        }
    }

    private func makeChip(_ title: String, slug: String, selected: Bool) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
        b.contentEdgeInsets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
        b.layer.cornerRadius = 18
        b.backgroundColor = selected ? VixUITheme.accent : VixUITheme.card
        b.setTitleColor(selected ? .black : .white, for: .normal)
        b.addAction(UIAction { [weak self] _ in
            self?.selectedGroup = slug
            self?.buildCategoryChips()
            self?.loadChannels()
        }, for: .touchUpInside)
        return b
    }

    private func loadChannels() {
        spinner.startAnimating()
        Task {
            do {
                let group = selectedGroup == "all" ? nil : selectedGroup
                let ch = try await AuthSession.shared.api.liveChannels(group: group)
                await MainActor.run {
                    self.channels = ch
                    self.table.reloadData()
                    self.spinner.stopAnimating()
                    self.playRandomChannel()
                }
            } catch {
                await MainActor.run { self.spinner.stopAnimating() }
            }
        }
    }

    private func playRandomChannel() {
        guard !channels.isEmpty else { return }
        let lastId = UserDefaults.standard.integer(forKey: Self.lastLiveChannelKey)
        if lastId > 0, let idx = channels.firstIndex(where: { $0.id == lastId }) {
            tuneChannel(channels[idx], at: idx)
            return
        }
        let idx = Int.random(in: 0..<channels.count)
        tuneChannel(channels[idx], at: idx)
    }

    private func tuneChannel(_ ch: LiveChannel, at index: Int) {
        guard let url = PlayUrls.live(server: VixConfig.serverURL, token: AuthSession.shared.api.token, channelId: ch.id) else { return }
        playingChannelId = ch.id
        UserDefaults.standard.set(ch.id, forKey: Self.lastLiveChannelKey)
        playerVC.view.isHidden = false
        VixUIKitPlayer.attachLive(player: &livePlayer, playerVC: playerVC, url: url)
        let path = IndexPath(row: index, section: 0)
        if table.numberOfRows(inSection: 0) > index {
            table.selectRow(at: path, animated: true, scrollPosition: .middle)
        }
    }
}

extension UIKitLiveViewController: UITableViewDataSource, UITableViewDelegate {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { channels.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: VixChannelCell.reuseId, for: indexPath) as! VixChannelCell
        cell.configure(channel: channels[indexPath.row])
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tuneChannel(channels[indexPath.row], at: indexPath.row)
    }

    func tableView(_ tableView: UITableView, willDisplay cell: UITableViewCell, forRowAt indexPath: IndexPath) {
        let selected = playingChannelId == channels[indexPath.row].id
        cell.accessoryType = selected ? .checkmark : .none
        cell.tintColor = VixUITheme.accent
    }
}

final class VixChannelCell: UITableViewCell {
    static let reuseId = "ch"
    private let logoView = UIImageView()
    private let nameLabel = UILabel()
    private let groupLabel = UILabel()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        selectionStyle = .none
        logoView.contentMode = .scaleAspectFit
        logoView.layer.cornerRadius = 6
        logoView.clipsToBounds = true
        logoView.backgroundColor = VixUITheme.card
        logoView.translatesAutoresizingMaskIntoConstraints = false
        nameLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        nameLabel.textColor = .white
        groupLabel.font = .systemFont(ofSize: 12)
        groupLabel.textColor = VixUITheme.muted
        let text = UIStackView(arrangedSubviews: [nameLabel, groupLabel])
        text.axis = .vertical
        text.spacing = 2
        text.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(logoView)
        contentView.addSubview(text)
        NSLayoutConstraint.activate([
            logoView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            logoView.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            logoView.widthAnchor.constraint(equalToConstant: 48),
            logoView.heightAnchor.constraint(equalToConstant: 48),
            text.leadingAnchor.constraint(equalTo: logoView.trailingAnchor, constant: 12),
            text.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            text.centerYAnchor.constraint(equalTo: contentView.centerYAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(channel: LiveChannel) {
        nameLabel.text = channel.name
        groupLabel.text = channel.group_title
        VixImageLoader.load(PlayUrls.poster(channel.logo), into: logoView,
                            placeholder: UIImage(systemName: "dot.radiowaves.left.and.right"))
    }
}

// MARK: - Search & detail

final class VixSearchResultCell: UITableViewCell {
    static let reuseId = "searchResult"
    private let poster = UIImageView()
    private let titleLabel = UILabel()
    private let typeLabel = UILabel()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        selectionStyle = .none
        poster.contentMode = .scaleAspectFill
        poster.clipsToBounds = true
        poster.layer.cornerRadius = 8
        poster.backgroundColor = VixUITheme.card
        poster.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 2
        typeLabel.font = .systemFont(ofSize: 12, weight: .medium)
        typeLabel.textColor = VixUITheme.muted
        let text = UIStackView(arrangedSubviews: [titleLabel, typeLabel])
        text.axis = .vertical
        text.spacing = 4
        text.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(poster)
        contentView.addSubview(text)
        NSLayoutConstraint.activate([
            poster.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            poster.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 8),
            poster.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -8),
            poster.widthAnchor.constraint(equalToConstant: 56),
            poster.heightAnchor.constraint(equalToConstant: 84),
            text.leadingAnchor.constraint(equalTo: poster.trailingAnchor, constant: 12),
            text.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            text.centerYAnchor.constraint(equalTo: poster.centerYAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(item: SearchItem) {
        titleLabel.text = item.title
        typeLabel.text = item.mediaType == "series" ? "Serie" : "Película"
        VixImageLoader.load(PlayUrls.poster(item.poster), into: poster,
                            placeholder: UIImage(systemName: item.mediaType == "series" ? "tv" : "film"))
    }
}

final class UIKitSearchViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    private let query: String
    private let table = UITableView(frame: .zero, style: .plain)
    private let spinner = UIActivityIndicatorView(style: .large)
    private let emptyLabel = UILabel()
    private var items: [SearchItem] = []

    init(query: String) {
        self.query = query
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "« \(query) »"
        view.backgroundColor = VixUITheme.bg
        navigationController?.setNavigationBarHidden(false, animated: false)
        table.backgroundColor = .clear
        table.separatorColor = UIColor.white.withAlphaComponent(0.08)
        table.rowHeight = 100
        table.dataSource = self
        table.delegate = self
        table.register(VixSearchResultCell.self, forCellReuseIdentifier: VixSearchResultCell.reuseId)
        table.translatesAutoresizingMaskIntoConstraints = false
        spinner.color = VixUITheme.accent
        spinner.translatesAutoresizingMaskIntoConstraints = false
        emptyLabel.text = "Sin resultados"
        emptyLabel.textColor = VixUITheme.muted
        emptyLabel.textAlignment = .center
        emptyLabel.isHidden = true
        emptyLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(table)
        view.addSubview(spinner)
        view.addSubview(emptyLabel)
        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            emptyLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            emptyLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        spinner.startAnimating()
        Task {
            let res = try? await AuthSession.shared.api.search(query: query)
            let merged = (res?.movies ?? []) + (res?.series ?? [])
            await MainActor.run {
                self.items = merged
                self.spinner.stopAnimating()
                self.emptyLabel.isHidden = !merged.isEmpty
                self.table.reloadData()
            }
        }
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { items.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: VixSearchResultCell.reuseId, for: indexPath) as! VixSearchResultCell
        cell.configure(item: items[indexPath.row])
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let item = items[indexPath.row]
        if item.mediaType == "series" {
            navigationController?.pushViewController(UIKitSeriesDetailViewController(seriesId: item.id), animated: true)
        } else {
            navigationController?.pushViewController(UIKitMovieDetailViewController(movieId: item.id), animated: true)
        }
    }
}

final class UIKitMovieDetailViewController: UIViewController {
    private let movieId: Int
    private let startAt: Double
    private let scroll = UIScrollView()
    private let contentStack = UIStackView()
    private let hero = UIImageView()
    private let poster = UIImageView()
    private let titleLabel = UILabel()
    private let metaRow = UIStackView()
    private let synopsisLabel = UILabel()
    private let playButton = UIButton(type: .system)
    private let similarTitle = UILabel()
    private let similarScroll = UIScrollView()
    private let similarStack = UIStackView()
    private let spinner = UIActivityIndicatorView(style: .large)
    private var detail: MovieDetail?

    init(movieId: Int, startAt: Double = 0) {
        self.movieId = movieId
        self.startAt = startAt
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = VixUITheme.bg
        navigationController?.setNavigationBarHidden(false, animated: false)

        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)

        hero.contentMode = .scaleAspectFill
        hero.clipsToBounds = true
        hero.backgroundColor = VixUITheme.card
        hero.translatesAutoresizingMaskIntoConstraints = false

        poster.contentMode = .scaleAspectFill
        poster.clipsToBounds = true
        poster.layer.cornerRadius = 8
        poster.backgroundColor = VixUITheme.card
        poster.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.font = .boldSystemFont(ofSize: 26)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 0

        metaRow.axis = .horizontal
        metaRow.spacing = 8
        metaRow.alignment = .center

        synopsisLabel.font = .preferredFont(forTextStyle: .body)
        synopsisLabel.textColor = VixUITheme.muted
        synopsisLabel.numberOfLines = 0

        playButton.setTitle("  Reproducir", for: .normal)
        playButton.setImage(UIImage(systemName: "play.fill"), for: .normal)
        playButton.titleLabel?.font = .boldSystemFont(ofSize: 18)
        playButton.backgroundColor = VixUITheme.accent
        playButton.setTitleColor(.black, for: .normal)
        playButton.tintColor = .black
        playButton.layer.cornerRadius = 10
        playButton.contentEdgeInsets = UIEdgeInsets(top: 16, left: 28, bottom: 16, right: 28)
        playButton.addTarget(self, action: #selector(play), for: .touchUpInside)

        similarTitle.text = "Te recomendamos"
        similarTitle.font = .boldSystemFont(ofSize: 18)
        similarTitle.textColor = .white
        similarTitle.isHidden = true

        similarScroll.showsHorizontalScrollIndicator = false
        similarStack.axis = .horizontal
        similarStack.spacing = 10
        similarStack.translatesAutoresizingMaskIntoConstraints = false
        similarScroll.addSubview(similarStack)
        similarScroll.translatesAutoresizingMaskIntoConstraints = false
        similarScroll.isHidden = true

        let infoRow = UIStackView(arrangedSubviews: [poster, titleLabel])
        infoRow.axis = .horizontal
        infoRow.spacing = 14
        infoRow.alignment = .top
        poster.setContentHuggingPriority(.required, for: .horizontal)

        contentStack.axis = .vertical
        contentStack.spacing = 16
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        contentStack.addArrangedSubview(hero)
        let body = UIStackView(arrangedSubviews: [infoRow, metaRow, synopsisLabel, playButton, similarTitle, similarScroll])
        body.axis = .vertical
        body.spacing = 14
        body.isLayoutMarginsRelativeArrangement = true
        body.layoutMargins = UIEdgeInsets(top: 16, left: 16, bottom: 24, right: 16)
        contentStack.addArrangedSubview(body)
        scroll.addSubview(contentStack)

        spinner.color = VixUITheme.accent
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)

        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            contentStack.topAnchor.constraint(equalTo: scroll.topAnchor),
            contentStack.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
            contentStack.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
            contentStack.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
            contentStack.widthAnchor.constraint(equalTo: scroll.widthAnchor),
            hero.heightAnchor.constraint(equalTo: scroll.widthAnchor, multiplier: 9.0 / 16.0),
            poster.widthAnchor.constraint(equalToConstant: 100),
            poster.heightAnchor.constraint(equalToConstant: 150),
            similarScroll.heightAnchor.constraint(equalToConstant: 150),
            similarStack.topAnchor.constraint(equalTo: similarScroll.topAnchor),
            similarStack.leadingAnchor.constraint(equalTo: similarScroll.leadingAnchor),
            similarStack.trailingAnchor.constraint(equalTo: similarScroll.trailingAnchor),
            similarStack.bottomAnchor.constraint(equalTo: similarScroll.bottomAnchor),
            similarStack.heightAnchor.constraint(equalTo: similarScroll.heightAnchor),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        load()
    }

    private func load() {
        spinner.startAnimating()
        Task {
            do {
                let d = try await AuthSession.shared.api.movieDetail(id: movieId)
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.detail = d
                    self.title = d.title
                    self.titleLabel.text = d.title
                    self.synopsisLabel.text = d.synopsis ?? "Sin sinopsis disponible."
                    VixImageLoader.load(PlayUrls.poster(d.backdrop ?? d.poster), into: self.hero)
                    VixImageLoader.load(PlayUrls.poster(d.poster ?? d.backdrop), into: self.poster)
                    self.metaRow.arrangedSubviews.forEach { $0.removeFromSuperview() }
                    if let r = d.rating, r > 0 { self.metaRow.addArrangedSubview(VixMetaChip.make("⭐ \(String(format: "%.1f", r))")) }
                    if let rt = d.runtime, rt > 0 { self.metaRow.addArrangedSubview(VixMetaChip.make("\(rt) min")) }
                    let hasVideo = !(d.video_path ?? "").isEmpty
                    self.playButton.isEnabled = hasVideo
                    self.playButton.alpha = hasVideo ? 1 : 0.45
                    self.buildSimilar(d.similar ?? [])
                    if hasVideo && self.startAt > 5 { self.play() }
                }
            } catch {
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.showAlert("No se pudo cargar la película")
                }
            }
        }
    }

    private func buildSimilar(_ items: [CatalogPoster]) {
        similarStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        guard !items.isEmpty else { return }
        similarTitle.isHidden = false
        similarScroll.isHidden = false
        for item in items.prefix(12) {
            let card = VixSimilarPosterView(item: item) { [weak self] tapped in
                let vc = tapped.isSeries
                    ? UIKitSeriesDetailViewController(seriesId: tapped.id)
                    : UIKitMovieDetailViewController(movieId: tapped.id)
                self?.navigationController?.pushViewController(vc, animated: true)
            }
            card.widthAnchor.constraint(equalToConstant: 100).isActive = true
            similarStack.addArrangedSubview(card)
        }
    }

    @objc private func play() {
        guard let path = detail?.video_path, !path.isEmpty else {
            showAlert("Video no disponible")
            return
        }
        let normalized = PlayUrls.normalizeMediaPath(path)
        guard let url = PlayUrls.video(server: VixConfig.serverURL, token: AuthSession.shared.api.token, path: normalized, startAt: startAt) else {
            showAlert("Video no disponible")
            return
        }
        let seek = normalized.lowercased().contains(".mkv") ? 0 : startAt
        VixUIKitPlayer.playFullscreen(from: self, url: url, startAt: seek) { prog, dur in
            Task {
                try? await AuthSession.shared.api.saveWatchProgress(
                    contentType: "movie", contentId: self.movieId, seriesId: nil, progress: prog, duration: dur
                )
            }
        }
    }

    private func showAlert(_ msg: String) {
        let a = UIAlertController(title: nil, message: msg, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }
}

final class VixSimilarPosterView: UIView {
    private let item: CatalogPoster
    private let onTap: (CatalogPoster) -> Void

    init(item: CatalogPoster, onTap: @escaping (CatalogPoster) -> Void) {
        self.item = item
        self.onTap = onTap
        super.init(frame: .zero)
        let img = UIImageView()
        img.contentMode = .scaleAspectFill
        img.clipsToBounds = true
        img.layer.cornerRadius = 8
        img.backgroundColor = VixUITheme.card
        img.translatesAutoresizingMaskIntoConstraints = false
        VixImageLoader.load(PlayUrls.poster(item.poster), into: img,
                            placeholder: UIImage(systemName: item.isSeries ? "tv" : "film"))
        addSubview(img)
        NSLayoutConstraint.activate([
            img.topAnchor.constraint(equalTo: topAnchor),
            img.leadingAnchor.constraint(equalTo: leadingAnchor),
            img.trailingAnchor.constraint(equalTo: trailingAnchor),
            img.heightAnchor.constraint(equalToConstant: 140),
            img.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
        isUserInteractionEnabled = true
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
    }

    required init?(coder: NSCoder) { fatalError() }

    @objc private func tapped() { onTap(item) }
}

final class VixEpisodeCell: UITableViewCell {
    static let reuseId = "episode"
    private let thumb = UIImageView()
    private let epNum = UILabel()
    private let titleLabel = UILabel()
    private let metaLabel = UILabel()
    private let playIcon = UIImageView(image: UIImage(systemName: "play.circle.fill"))

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        selectionStyle = .none
        thumb.contentMode = .scaleAspectFill
        thumb.clipsToBounds = true
        thumb.layer.cornerRadius = 8
        thumb.backgroundColor = VixUITheme.card
        thumb.translatesAutoresizingMaskIntoConstraints = false
        epNum.font = .boldSystemFont(ofSize: 13)
        epNum.textColor = VixUITheme.accent
        titleLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 2
        metaLabel.font = .systemFont(ofSize: 12)
        metaLabel.textColor = VixUITheme.muted
        playIcon.tintColor = VixUITheme.accent
        playIcon.translatesAutoresizingMaskIntoConstraints = false
        let text = UIStackView(arrangedSubviews: [epNum, titleLabel, metaLabel])
        text.axis = .vertical
        text.spacing = 4
        text.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(thumb)
        contentView.addSubview(text)
        contentView.addSubview(playIcon)
        NSLayoutConstraint.activate([
            thumb.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            thumb.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            thumb.widthAnchor.constraint(equalToConstant: 120),
            thumb.heightAnchor.constraint(equalToConstant: 68),
            text.leadingAnchor.constraint(equalTo: thumb.trailingAnchor, constant: 12),
            text.trailingAnchor.constraint(equalTo: playIcon.leadingAnchor, constant: -8),
            text.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            playIcon.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            playIcon.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            playIcon.widthAnchor.constraint(equalToConstant: 32),
            playIcon.heightAnchor.constraint(equalToConstant: 32)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(ep: SeriesEpisode, seriesPoster: String?) {
        epNum.text = "T\(ep.season) E\(ep.episode)"
        titleLabel.text = ep.title ?? "Episodio \(ep.episode)"
        metaLabel.text = (ep.video_path ?? "").isEmpty ? "No disponible" : "Toca para reproducir"
        let img = ep.poster ?? seriesPoster
        VixImageLoader.load(PlayUrls.poster(img), into: thumb,
                            placeholder: UIImage(systemName: "tv"))
        playIcon.alpha = (ep.video_path ?? "").isEmpty ? 0.3 : 1
    }
}

final class UIKitSeriesDetailViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    private let seriesId: Int
    private let episodeId: Int?
    private let startAt: Double
    private let table = UITableView(frame: .zero, style: .plain)
    private let headerStack = UIStackView()
    private let hero = UIImageView()
    private let poster = UIImageView()
    private let titleLabel = UILabel()
    private let synopsisLabel = UILabel()
    private let seasonScroll = UIScrollView()
    private let seasonStack = UIStackView()
    private let spinner = UIActivityIndicatorView(style: .large)
    private var detail: SeriesDetail?
    private var selectedSeason = 1
    private let metaRow = UIStackView()
    private let playButton = UIButton(type: .system)
    private let similarTitle = UILabel()
    private let similarScroll = UIScrollView()
    private let similarStack = UIStackView()

    init(seriesId: Int, episodeId: Int? = nil, startAt: Double = 0) {
        self.seriesId = seriesId
        self.episodeId = episodeId
        self.startAt = startAt
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = VixUITheme.bg
        navigationController?.setNavigationBarHidden(false, animated: false)

        hero.contentMode = .scaleAspectFill
        hero.clipsToBounds = true
        hero.backgroundColor = VixUITheme.card
        hero.translatesAutoresizingMaskIntoConstraints = false

        poster.contentMode = .scaleAspectFill
        poster.clipsToBounds = true
        poster.layer.cornerRadius = 8
        poster.backgroundColor = VixUITheme.card
        poster.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.font = .boldSystemFont(ofSize: 24)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 0

        synopsisLabel.font = .preferredFont(forTextStyle: .body)
        synopsisLabel.textColor = VixUITheme.muted
        synopsisLabel.numberOfLines = 0

        seasonScroll.showsHorizontalScrollIndicator = false
        seasonStack.axis = .horizontal
        seasonStack.spacing = 8
        seasonStack.translatesAutoresizingMaskIntoConstraints = false
        seasonScroll.addSubview(seasonStack)
        seasonScroll.translatesAutoresizingMaskIntoConstraints = false

        metaRow.axis = .horizontal
        metaRow.spacing = 8
        playButton.setTitle("  Reproducir episodio", for: .normal)
        playButton.setImage(UIImage(systemName: "play.fill"), for: .normal)
        playButton.titleLabel?.font = .boldSystemFont(ofSize: 16)
        playButton.backgroundColor = VixUITheme.accent
        playButton.setTitleColor(.black, for: .normal)
        playButton.tintColor = .black
        playButton.layer.cornerRadius = 10
        playButton.contentEdgeInsets = UIEdgeInsets(top: 14, left: 20, bottom: 14, right: 20)
        playButton.isHidden = true
        playButton.addTarget(self, action: #selector(playFirstEpisode), for: .touchUpInside)
        similarTitle.text = "Series similares"
        similarTitle.font = .boldSystemFont(ofSize: 17)
        similarTitle.textColor = .white
        similarTitle.isHidden = true
        similarScroll.showsHorizontalScrollIndicator = false
        similarScroll.isHidden = true
        similarStack.axis = .horizontal
        similarStack.spacing = 10
        similarStack.translatesAutoresizingMaskIntoConstraints = false
        similarScroll.addSubview(similarStack)
        similarScroll.translatesAutoresizingMaskIntoConstraints = false

        let infoRow = UIStackView(arrangedSubviews: [poster, titleLabel])
        infoRow.axis = .horizontal
        infoRow.spacing = 12
        infoRow.alignment = .top

        headerStack.axis = .vertical
        headerStack.spacing = 12
        headerStack.isLayoutMarginsRelativeArrangement = true
        headerStack.layoutMargins = UIEdgeInsets(top: 0, left: 0, bottom: 12, right: 0)
        headerStack.addArrangedSubview(hero)
        let body = UIStackView(arrangedSubviews: [infoRow, metaRow, synopsisLabel, playButton, seasonScroll, similarTitle, similarScroll])
        body.axis = .vertical
        body.spacing = 12
        body.isLayoutMarginsRelativeArrangement = true
        body.layoutMargins = UIEdgeInsets(top: 12, left: 16, bottom: 0, right: 16)
        headerStack.addArrangedSubview(body)

        table.backgroundColor = .clear
        table.separatorStyle = .none
        table.rowHeight = 84
        table.dataSource = self
        table.delegate = self
        table.tableHeaderView = wrapHeader(headerStack)
        table.register(VixEpisodeCell.self, forCellReuseIdentifier: VixEpisodeCell.reuseId)
        table.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(table)

        spinner.color = VixUITheme.accent
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)

        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hero.heightAnchor.constraint(equalToConstant: UIScreen.main.bounds.width * 9 / 16),
            poster.widthAnchor.constraint(equalToConstant: 80),
            poster.heightAnchor.constraint(equalToConstant: 120),
            seasonScroll.heightAnchor.constraint(equalToConstant: 40),
            seasonStack.topAnchor.constraint(equalTo: seasonScroll.topAnchor),
            seasonStack.leadingAnchor.constraint(equalTo: seasonScroll.leadingAnchor),
            seasonStack.trailingAnchor.constraint(equalTo: seasonScroll.trailingAnchor),
            seasonStack.bottomAnchor.constraint(equalTo: seasonScroll.bottomAnchor),
            seasonStack.heightAnchor.constraint(equalTo: seasonScroll.heightAnchor),
            similarScroll.heightAnchor.constraint(equalToConstant: 140),
            similarStack.topAnchor.constraint(equalTo: similarScroll.topAnchor),
            similarStack.leadingAnchor.constraint(equalTo: similarScroll.leadingAnchor),
            similarStack.trailingAnchor.constraint(equalTo: similarScroll.trailingAnchor),
            similarStack.bottomAnchor.constraint(equalTo: similarScroll.bottomAnchor),
            similarStack.heightAnchor.constraint(equalTo: similarScroll.heightAnchor),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        load()
    }

    @objc private func playFirstEpisode() {
        guard let ep = filteredEpisodes.first else { return }
        playEpisode(ep, startAt: startAt)
    }

    private func wrapHeader(_ stack: UIStackView) -> UIView {
        let w = UIView(frame: CGRect(x: 0, y: 0, width: view.bounds.width, height: 1))
        stack.translatesAutoresizingMaskIntoConstraints = false
        w.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: w.topAnchor),
            stack.leadingAnchor.constraint(equalTo: w.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: w.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: w.bottomAnchor)
        ])
        w.setNeedsLayout()
        w.layoutIfNeeded()
        let h = stack.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize).height
        w.frame.size.height = h
        return w
    }

    private var seasons: [Int] {
        Array(Set((detail?.episodes ?? []).map(\.season))).sorted()
    }

    private var filteredEpisodes: [SeriesEpisode] {
        (detail?.episodes ?? []).filter { $0.season == selectedSeason }.sorted { $0.episode < $1.episode }
    }

    private func load() {
        spinner.startAnimating()
        Task {
            do {
                let d = try await AuthSession.shared.api.seriesDetail(id: seriesId)
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.detail = d
                    self.title = d.title
                    self.titleLabel.text = d.title
                    self.synopsisLabel.text = d.synopsis ?? "Sin sinopsis disponible."
                    VixImageLoader.load(PlayUrls.poster(d.backdrop ?? d.poster), into: self.hero)
                    VixImageLoader.load(PlayUrls.poster(d.poster ?? d.backdrop), into: self.poster)
                    if let eid = self.episodeId, let ep = d.episodes.first(where: { $0.id == eid }) {
                        self.selectedSeason = ep.season
                    } else if let min = d.episodes.map(\.season).min() {
                        self.selectedSeason = min
                    }
                    self.metaRow.arrangedSubviews.forEach { $0.removeFromSuperview() }
                    if let r = d.rating, r > 0 { self.metaRow.addArrangedSubview(VixMetaChip.make("⭐ \(String(format: "%.1f", r))")) }
                    self.playButton.isHidden = self.filteredEpisodes.isEmpty
                    self.buildSimilar(d.similar ?? [])
                    self.rebuildSeasonChips()
                    self.table.tableHeaderView = self.wrapHeader(self.headerStack)
                    self.table.reloadData()
                    if let eid = self.episodeId, let ep = d.episodes.first(where: { $0.id == eid }) {
                        self.playEpisode(ep, startAt: self.startAt)
                    }
                }
            } catch {
                await MainActor.run {
                    self.spinner.stopAnimating()
                    let a = UIAlertController(title: nil, message: error.localizedDescription, preferredStyle: .alert)
                    a.addAction(UIAlertAction(title: "OK", style: .default))
                    self.present(a, animated: true)
                }
            }
        }
    }

    private func buildSimilar(_ items: [CatalogPoster]) {
        similarStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        guard !items.isEmpty else { return }
        similarTitle.isHidden = false
        similarScroll.isHidden = false
        for item in items.prefix(10) {
            let card = VixSimilarPosterView(item: item) { [weak self] tapped in
                self?.navigationController?.pushViewController(UIKitSeriesDetailViewController(seriesId: tapped.id), animated: true)
            }
            card.widthAnchor.constraint(equalToConstant: 100).isActive = true
            similarStack.addArrangedSubview(card)
        }
    }

    private func rebuildSeasonChips() {
        seasonStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let ss = seasons
        seasonScroll.isHidden = ss.count <= 1
        for s in ss {
            let b = UIButton(type: .system)
            b.setTitle("Temporada \(s)", for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
            b.contentEdgeInsets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
            b.layer.cornerRadius = 18
            let sel = s == selectedSeason
            b.backgroundColor = sel ? VixUITheme.accent : VixUITheme.card
            b.setTitleColor(sel ? .black : .white, for: .normal)
            b.tag = s
            b.addTarget(self, action: #selector(seasonTapped(_:)), for: .touchUpInside)
            seasonStack.addArrangedSubview(b)
        }
    }

    @objc private func seasonTapped(_ sender: UIButton) {
        selectedSeason = sender.tag
        rebuildSeasonChips()
        table.reloadData()
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { filteredEpisodes.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: VixEpisodeCell.reuseId, for: indexPath) as! VixEpisodeCell
        let ep = filteredEpisodes[indexPath.row]
        cell.configure(ep: ep, seriesPoster: detail?.poster)
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        playEpisode(filteredEpisodes[indexPath.row])
    }

    private func playEpisode(_ ep: SeriesEpisode, startAt: Double = 0) {
        guard let path = ep.video_path, !path.isEmpty else {
            showAlert("Video no disponible para este episodio")
            return
        }
        let normalized = PlayUrls.normalizeMediaPath(path)
        guard let url = PlayUrls.video(
            server: VixConfig.serverURL,
            token: AuthSession.shared.api.token,
            path: normalized,
            startAt: startAt
        ) else {
            showAlert("No se pudo abrir el video")
            return
        }
        let seek = normalized.lowercased().contains(".mkv") ? 0 : startAt
        VixUIKitPlayer.playFullscreen(from: self, url: url, startAt: seek) { prog, dur in
            Task {
                try? await AuthSession.shared.api.saveWatchProgress(
                    contentType: "episode", contentId: ep.id, seriesId: self.seriesId, progress: prog, duration: dur
                )
            }
        }
    }

    private func showAlert(_ msg: String) {
        let a = UIAlertController(title: nil, message: msg, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }
}

// MARK: - External catalog detail

final class UIKitExternalMovieDetailViewController: UIViewController {
    private let source: String
    private let slug: String
    private let year: Int?
    private let scroll = UIScrollView()
    private let hero = UIImageView()
    private let poster = UIImageView()
    private let titleLabel = UILabel()
    private let metaRow = UIStackView()
    private let synopsisLabel = UILabel()
    private let playButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .large)
    private var detail: ExternalMovieDetail?

    init(source: String, slug: String, year: Int? = nil) {
        self.source = source
        self.slug = slug
        self.year = year
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = VixUITheme.bg
        navigationController?.setNavigationBarHidden(false, animated: false)

        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)

        hero.contentMode = .scaleAspectFill
        hero.clipsToBounds = true
        hero.backgroundColor = VixUITheme.card
        hero.translatesAutoresizingMaskIntoConstraints = false

        poster.contentMode = .scaleAspectFill
        poster.clipsToBounds = true
        poster.layer.cornerRadius = 8
        poster.backgroundColor = VixUITheme.card
        poster.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.font = .boldSystemFont(ofSize: 26)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 0

        metaRow.axis = .horizontal
        metaRow.spacing = 8

        synopsisLabel.font = .preferredFont(forTextStyle: .body)
        synopsisLabel.textColor = VixUITheme.muted
        synopsisLabel.numberOfLines = 0

        playButton.setTitle("  Reproducir", for: .normal)
        playButton.setImage(UIImage(systemName: "play.fill"), for: .normal)
        playButton.titleLabel?.font = .boldSystemFont(ofSize: 18)
        playButton.backgroundColor = VixUITheme.accent
        playButton.setTitleColor(.black, for: .normal)
        playButton.tintColor = .black
        playButton.layer.cornerRadius = 10
        playButton.contentEdgeInsets = UIEdgeInsets(top: 16, left: 28, bottom: 16, right: 28)
        playButton.addTarget(self, action: #selector(play), for: .touchUpInside)

        let infoRow = UIStackView(arrangedSubviews: [poster, titleLabel])
        infoRow.axis = .horizontal
        infoRow.spacing = 14
        infoRow.alignment = .top

        let body = UIStackView(arrangedSubviews: [infoRow, metaRow, synopsisLabel, playButton])
        body.axis = .vertical
        body.spacing = 14
        body.isLayoutMarginsRelativeArrangement = true
        body.layoutMargins = UIEdgeInsets(top: 16, left: 16, bottom: 24, right: 16)
        body.translatesAutoresizingMaskIntoConstraints = false

        let stack = UIStackView(arrangedSubviews: [hero, body])
        stack.axis = .vertical
        stack.spacing = 0
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)

        spinner.color = VixUITheme.accent
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)

        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.topAnchor.constraint(equalTo: scroll.topAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.widthAnchor),
            hero.heightAnchor.constraint(equalTo: scroll.widthAnchor, multiplier: 9.0 / 16.0),
            poster.widthAnchor.constraint(equalToConstant: 100),
            poster.heightAnchor.constraint(equalToConstant: 150),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        load()
    }

    private func load() {
        spinner.startAnimating()
        Task {
            do {
                let d = try await AuthSession.shared.api.externalMovieMeta(source: source, slug: slug, year: year)
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.detail = d
                    self.title = d.title
                    self.titleLabel.text = d.title
                    self.synopsisLabel.text = d.synopsis ?? d.overview ?? "Sin sinopsis disponible."
                    VixImageLoader.load(PlayUrls.poster(d.backdrop ?? d.poster), into: self.hero)
                    VixImageLoader.load(PlayUrls.poster(d.poster ?? d.backdrop), into: self.poster)
                    self.metaRow.arrangedSubviews.forEach { $0.removeFromSuperview() }
                    if let r = d.rating, r > 0 { self.metaRow.addArrangedSubview(VixMetaChip.make("⭐ \(String(format: "%.1f", r))")) }
                    if let y = d.year, y > 0 { self.metaRow.addArrangedSubview(VixMetaChip.make("\(y)")) }
                    if let g = d.genre, !g.isEmpty { self.metaRow.addArrangedSubview(VixMetaChip.make(g)) }
                }
            } catch {
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.showAlert(error.localizedDescription)
                }
            }
        }
    }

    @objc private func play() {
        spinner.startAnimating()
        playButton.isEnabled = false
        Task {
            do {
                let y = year ?? detail?.year
                let play = try await AuthSession.shared.api.externalMoviePlay(source: source, slug: slug, year: y)
                guard let url = VixAPI.externalPlayURL(server: VixConfig.serverURL, play: play) else {
                    throw VixAPIError.invalid
                }
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.playButton.isEnabled = true
                    VixUIKitPlayer.playFullscreen(from: self, url: url)
                }
            } catch {
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.playButton.isEnabled = true
                    self.showAlert(error.localizedDescription)
                }
            }
        }
    }

    private func showAlert(_ msg: String) {
        let a = UIAlertController(title: nil, message: msg, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }
}

final class UIKitExternalSeriesDetailViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    private let source: String
    private let slug: String
    private let table = UITableView(frame: .zero, style: .plain)
    private let headerStack = UIStackView()
    private let hero = UIImageView()
    private let poster = UIImageView()
    private let titleLabel = UILabel()
    private let synopsisLabel = UILabel()
    private let seasonScroll = UIScrollView()
    private let seasonStack = UIStackView()
    private let spinner = UIActivityIndicatorView(style: .large)
    private var detail: ExternalSeriesDetail?
    private var episodes: [ExternalSeriesEpisode] = []
    private var seasons: [Int] = []
    private var selectedSeason = 1

    init(source: String, slug: String) {
        self.source = source
        self.slug = slug
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = VixUITheme.bg
        navigationController?.setNavigationBarHidden(false, animated: false)

        hero.contentMode = .scaleAspectFill
        hero.clipsToBounds = true
        hero.backgroundColor = VixUITheme.card
        hero.translatesAutoresizingMaskIntoConstraints = false

        poster.contentMode = .scaleAspectFill
        poster.clipsToBounds = true
        poster.layer.cornerRadius = 8
        poster.backgroundColor = VixUITheme.card
        poster.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.font = .boldSystemFont(ofSize: 24)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 0

        synopsisLabel.font = .preferredFont(forTextStyle: .body)
        synopsisLabel.textColor = VixUITheme.muted
        synopsisLabel.numberOfLines = 0

        seasonScroll.showsHorizontalScrollIndicator = false
        seasonStack.axis = .horizontal
        seasonStack.spacing = 8
        seasonStack.translatesAutoresizingMaskIntoConstraints = false
        seasonScroll.addSubview(seasonStack)
        seasonScroll.translatesAutoresizingMaskIntoConstraints = false

        let infoRow = UIStackView(arrangedSubviews: [poster, titleLabel])
        infoRow.axis = .horizontal
        infoRow.spacing = 12
        infoRow.alignment = .top

        headerStack.axis = .vertical
        headerStack.spacing = 12
        headerStack.isLayoutMarginsRelativeArrangement = true
        headerStack.layoutMargins = UIEdgeInsets(top: 0, left: 0, bottom: 12, right: 0)
        headerStack.addArrangedSubview(hero)
        let body = UIStackView(arrangedSubviews: [infoRow, synopsisLabel, seasonScroll])
        body.axis = .vertical
        body.spacing = 12
        body.isLayoutMarginsRelativeArrangement = true
        body.layoutMargins = UIEdgeInsets(top: 12, left: 16, bottom: 0, right: 16)
        headerStack.addArrangedSubview(body)

        table.backgroundColor = .clear
        table.separatorStyle = .none
        table.rowHeight = 84
        table.dataSource = self
        table.delegate = self
        table.tableHeaderView = wrapHeader(headerStack)
        table.register(VixEpisodeCell.self, forCellReuseIdentifier: VixEpisodeCell.reuseId)
        table.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(table)

        spinner.color = VixUITheme.accent
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)

        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hero.heightAnchor.constraint(equalToConstant: UIScreen.main.bounds.width * 9 / 16),
            poster.widthAnchor.constraint(equalToConstant: 80),
            poster.heightAnchor.constraint(equalToConstant: 120),
            seasonScroll.heightAnchor.constraint(equalToConstant: 40),
            seasonStack.topAnchor.constraint(equalTo: seasonScroll.topAnchor),
            seasonStack.leadingAnchor.constraint(equalTo: seasonScroll.leadingAnchor),
            seasonStack.trailingAnchor.constraint(equalTo: seasonScroll.trailingAnchor),
            seasonStack.bottomAnchor.constraint(equalTo: seasonScroll.bottomAnchor),
            seasonStack.heightAnchor.constraint(equalTo: seasonScroll.heightAnchor),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        load()
    }

    private func wrapHeader(_ stack: UIStackView) -> UIView {
        let w = UIView(frame: CGRect(x: 0, y: 0, width: view.bounds.width, height: 1))
        stack.translatesAutoresizingMaskIntoConstraints = false
        w.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: w.topAnchor),
            stack.leadingAnchor.constraint(equalTo: w.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: w.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: w.bottomAnchor)
        ])
        w.setNeedsLayout()
        w.layoutIfNeeded()
        let h = stack.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize).height
        w.frame.size.height = h
        return w
    }

    private var filteredEpisodes: [ExternalSeriesEpisode] {
        episodes.filter { $0.season == selectedSeason }
    }

    private func load() {
        spinner.startAnimating()
        Task {
            do {
                let d = try await AuthSession.shared.api.externalSeriesMeta(source: source, slug: slug)
                let eps = d.flatEpisodes
                let ss = Array(Set(eps.map(\.season))).sorted()
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.detail = d
                    self.episodes = eps
                    self.seasons = ss
                    self.title = d.title
                    self.titleLabel.text = d.title
                    self.synopsisLabel.text = d.synopsis ?? d.overview ?? "Sin sinopsis disponible."
                    VixImageLoader.load(PlayUrls.poster(d.backdrop ?? d.poster), into: self.hero)
                    VixImageLoader.load(PlayUrls.poster(d.poster ?? d.backdrop), into: self.poster)
                    self.selectedSeason = ss.first ?? 1
                    self.rebuildSeasonChips()
                    self.table.tableHeaderView = self.wrapHeader(self.headerStack)
                    self.table.reloadData()
                }
            } catch {
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.showAlert(error.localizedDescription)
                }
            }
        }
    }

    private func rebuildSeasonChips() {
        seasonStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        seasonScroll.isHidden = seasons.count <= 1
        for s in seasons {
            let b = UIButton(type: .system)
            b.setTitle("Temporada \(s)", for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
            b.contentEdgeInsets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
            b.layer.cornerRadius = 18
            let sel = s == selectedSeason
            b.backgroundColor = sel ? VixUITheme.accent : VixUITheme.card
            b.setTitleColor(sel ? .black : .white, for: .normal)
            b.tag = s
            b.addTarget(self, action: #selector(seasonTapped(_:)), for: .touchUpInside)
            seasonStack.addArrangedSubview(b)
        }
    }

    @objc private func seasonTapped(_ sender: UIButton) {
        selectedSeason = sender.tag
        rebuildSeasonChips()
        table.reloadData()
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { filteredEpisodes.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: VixEpisodeCell.reuseId, for: indexPath) as! VixEpisodeCell
        let ep = filteredEpisodes[indexPath.row]
        let seriesEp = SeriesEpisode(
            id: ep.season * 10000 + ep.episode,
            title: ep.title,
            season: ep.season,
            episode: ep.episode,
            video_path: "external",
            poster: ep.poster
        )
        cell.configure(ep: seriesEp, seriesPoster: detail?.poster)
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        playEpisode(filteredEpisodes[indexPath.row])
    }

    private func playEpisode(_ ep: ExternalSeriesEpisode) {
        spinner.startAnimating()
        Task {
            do {
                let play = try await AuthSession.shared.api.externalSeriesPlay(
                    source: source, slug: slug, season: ep.season, episode: ep.episode)
                guard let url = VixAPI.externalPlayURL(server: VixConfig.serverURL, play: play) else {
                    throw VixAPIError.invalid
                }
                await MainActor.run {
                    self.spinner.stopAnimating()
                    VixUIKitPlayer.playFullscreen(from: self, url: url)
                }
            } catch {
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.showAlert(error.localizedDescription)
                }
            }
        }
    }

    private func showAlert(_ msg: String) {
        let a = UIAlertController(title: nil, message: msg, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }
}
