import UIKit
import AVKit

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

// MARK: - Home (Tele Latino style)

final class UIKitHomeViewController: UIViewController {
    private enum Section: Hashable {
        case hero
        case tabs
        case row(String)
    }

    private let tabs: [HomeTab] = [
        HomeTab(slug: "recomendados", title: "Recomendados"),
        HomeTab(slug: "destacados", title: "Destacados"),
        HomeTab(slug: "kids", title: "Kids"),
        HomeTab(slug: "anime", title: "Anime")
    ]

    private var collectionView: UICollectionView!
    private var dataSource: UICollectionViewDiffableDataSource<Section, CatalogPoster>!
    private var heroSlides: [HeroSlide] = []
    private var sections: [CatalogSection] = []
    private var selectedTab = "recomendados"
    private let heroView = VixHeroCarouselView()
    private let searchField = UITextField()
    private let spinner = UIActivityIndicatorView(style: .large)
    private var heroTimer: Timer?

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

        let heroReg = UICollectionView.CellRegistration<UICollectionViewCell, CatalogPoster> { [weak self] cell, _, _ in
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

        let tabsReg = UICollectionView.CellRegistration<VixTabCell, CatalogPoster> { [weak self] cell, _, _ in
            guard let self else { return }
            cell.configure(tabs: self.tabs, selected: self.selectedTab) { slug in
                self.selectedTab = slug
                self.reloadContent()
            }
        }

        let posterReg = UICollectionView.CellRegistration<VixPosterCell, CatalogPoster> { cell, _, item in
            cell.configure(item: item)
        }

        dataSource = UICollectionViewDiffableDataSource(collectionView: collectionView) { cv, indexPath, item in
            let section = self.dataSource.snapshot().sectionIdentifiers[indexPath.section]
            switch section {
            case .hero: return cv.dequeueConfiguredReusableCell(using: heroReg, for: indexPath, item: item)
            case .tabs: return cv.dequeueConfiguredReusableCell(using: tabsReg, for: indexPath, item: item)
            case .row: return cv.dequeueConfiguredReusableCell(using: posterReg, for: indexPath, item: item)
            }
        }

        collectionView.register(VixSectionHeader.self,
            forSupplementaryViewOfKind: UICollectionView.elementKindSectionHeader,
            withReuseIdentifier: VixSectionHeader.reuseId)

        dataSource.supplementaryViewProvider = { [weak self] cv, kind, indexPath in
            guard kind == UICollectionView.elementKindSectionHeader,
                  let self,
                  case .row(let title) = self.dataSource.snapshot().sectionIdentifiers[indexPath.section] else { return nil }
            let header = cv.dequeueReusableSupplementaryView(
                ofKind: kind,
                withReuseIdentifier: VixSectionHeader.reuseId,
                for: indexPath
            ) as! VixSectionHeader
            header.setTitle(title)
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
                    widthDimension: .fractionalWidth(1), heightDimension: .absolute(44)), subitems: [item])
                let sec = NSCollectionLayoutSection(group: group)
                sec.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 0, bottom: 8, trailing: 0)
                return sec
            case .row:
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
                    layoutSize: NSCollectionLayoutSize(widthDimension: .fractionalWidth(1), heightDimension: .absolute(36)),
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
                async let heroTask: [HeroSlide] = {
                    if self.selectedTab == "recomendados" {
                        return (try? await api.catalogHero()) ?? []
                    }
                    if let page = try? await api.storefront(slug: self.selectedTab) {
                        return (page.hero ?? []).map { h in
                            HeroSlide(id: h.id, title: h.title, poster: h.poster, backdrop: h.poster,
                                      trailer: nil, content_type: h.content_type, description: nil, rating: nil)
                        }
                    }
                    return []
                }()
                let catalogSections: [CatalogSection]
                if self.selectedTab == "recomendados" {
                    let home = try await api.catalogHome()
                    catalogSections = home.sections ?? []
                } else {
                    let page = try await api.storefront(slug: self.selectedTab)
                    catalogSections = page.sections ?? []
                }
                let hero = try await heroTask
                await MainActor.run {
                    self.heroSlides = hero
                    self.sections = catalogSections
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

    private func applySnapshot() {
        var snap = NSDiffableDataSourceSnapshot<Section, CatalogPoster>()
        snap.appendSections([.hero, .tabs])
        snap.appendItems([CatalogPoster(id: -1, title: "", poster: nil, content_type: nil)], toSection: .hero)
        snap.appendItems([CatalogPoster(id: -2, title: "", poster: nil, content_type: nil)], toSection: .tabs)
        for sec in sections where !sec.items.isEmpty {
            snap.appendSections([.row(sec.title)])
            snap.appendItems(Array(sec.items.prefix(24)), toSection: .row(sec.title))
        }
        dataSource.apply(snap, animatingDifferences: true)
    }

    private func startHeroTimer() {
        heroTimer?.invalidate()
        guard heroSlides.count > 1 else { return }
        heroTimer = Timer.scheduledTimer(withTimeInterval: 8, repeats: true) { [weak self] _ in
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
        if item.isSeries {
            navigationController?.pushViewController(UIKitSeriesDetailViewController(seriesId: item.id), animated: true)
        } else {
            navigationController?.pushViewController(UIKitMovieDetailViewController(movieId: item.id), animated: true)
        }
    }
}

extension UIKitHomeViewController: UICollectionViewDelegate {
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        guard let item = dataSource.itemIdentifier(for: indexPath), item.id > 0 else { return }
        let section = dataSource.snapshot().sectionIdentifiers[indexPath.section]
        if case .row = section { openDetail(item) }
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
    private let gradient = CAGradientLayer()
    private var player: AVPlayer?
    private var playerLayer: AVPlayerLayer?
    private var slides: [HeroSlide] = []
    private var index = 0
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
        titleLabel.text = slide.title.uppercased()
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
        let item = AVPlayerItem(url: url)
        let p = AVPlayer(playerItem: item)
        p.isMuted = true
        p.actionAtItemEnd = .none
        NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak p] _ in p?.seek(to: .zero); p?.play() }
        let layer = AVPlayerLayer(player: p)
        layer.videoGravity = .resizeAspectFill
        layer.frame = bounds
        self.layer.insertSublayer(layer, above: imageView.layer)
        playerLayer = layer
        player = p
        p.play()
    }

    private func stopPlayer() {
        player?.pause()
        player = nil
        playerLayer?.removeFromSuperlayer()
        playerLayer = nil
    }
}

// MARK: - Cells

final class VixTabCell: UICollectionViewCell {
    private let scroll = UIScrollView()
    private let stack = UIStackView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        scroll.showsHorizontalScrollIndicator = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .horizontal
        stack.spacing = 18
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
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for tab in tabs {
            let btn = UIButton(type: .system)
            btn.setTitle(tab.title, for: .normal)
            btn.titleLabel?.font = .boldSystemFont(ofSize: 15)
            btn.setTitleColor(tab.slug == selected ? VixUITheme.accent : VixUITheme.muted, for: .normal)
            btn.addAction(UIAction { _ in onSelect(tab.slug) }, for: .touchUpInside)
            if tab.slug == selected {
                let line = UIView()
                line.backgroundColor = VixUITheme.accent
                line.translatesAutoresizingMaskIntoConstraints = false
                line.heightAnchor.constraint(equalToConstant: 2).isActive = true
                let col = UIStackView(arrangedSubviews: [btn, line])
                col.axis = .vertical
                col.spacing = 4
                stack.addArrangedSubview(col)
            } else {
                stack.addArrangedSubview(btn)
            }
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

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.backgroundColor = VixUITheme.card
        contentView.layer.cornerRadius = 8
        contentView.clipsToBounds = true
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = .systemFont(ofSize: 11, weight: .medium)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 2
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(imageView)
        contentView.addSubview(titleLabel)
        NSLayoutConstraint.activate([
            imageView.topAnchor.constraint(equalTo: contentView.topAnchor),
            imageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            imageView.heightAnchor.constraint(equalTo: contentView.widthAnchor, multiplier: 1.45),
            titleLabel.topAnchor.constraint(equalTo: imageView.bottomAnchor, constant: 4),
            titleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 4),
            titleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -4),
            titleLabel.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor, constant: -4)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(item: CatalogPoster) {
        titleLabel.text = item.title
        VixImageLoader.load(PlayUrls.poster(item.poster), into: imageView,
                            placeholder: UIImage(systemName: item.isSeries ? "tv" : "film"))
    }
}

final class VixSectionHeader: UICollectionReusableView {
    static let reuseId = "hdr"
    private let label = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        label.font = .boldSystemFont(ofSize: 18)
        label.textColor = .white
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            label.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }
    func setTitle(_ t: String) { label.text = t }
}

// MARK: - Live TV (mejorado)

final class UIKitLiveViewController: UIViewController {
    private let playerVC = AVPlayerViewController()
    private let categoryScroll = UIScrollView()
    private let categoryStack = UIStackView()
    private let table = UITableView(frame: .zero, style: .plain)
    private var channels: [LiveChannel] = []
    private var categories: [LiveCategory] = []
    private var selectedGroup = "all"
    private let spinner = UIActivityIndicatorView(style: .large)

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
                }
            } catch {
                await MainActor.run { self.spinner.stopAnimating() }
            }
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
        tableView.deselectRow(at: indexPath, animated: true)
        let ch = channels[indexPath.row]
        guard let url = PlayUrls.live(server: VixConfig.serverURL, token: AuthSession.shared.api.token, channelId: ch.id) else { return }
        playerVC.view.isHidden = false
        playerVC.player = AVPlayer(url: url)
        playerVC.player?.automaticallyWaitsToMinimizeStalling = true
        playerVC.player?.play()
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

final class UIKitSearchViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    private let query: String
    private let table = UITableView(frame: .zero, style: .plain)
    private var items: [SearchItem] = []

    init(query: String) {
        self.query = query
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Buscar"
        view.backgroundColor = VixUITheme.bg
        navigationController?.setNavigationBarHidden(false, animated: false)
        table.backgroundColor = .clear
        table.dataSource = self
        table.delegate = self
        table.register(VixChannelCell.self, forCellReuseIdentifier: "s")
        table.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(table)
        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        Task {
            let res = try? await AuthSession.shared.api.search(query: query)
            let merged = (res?.movies ?? []) + (res?.series ?? [])
            await MainActor.run {
                self.items = merged
                self.table.reloadData()
            }
        }
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { items.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "s", for: indexPath)
        let item = items[indexPath.row]
        cell.textLabel?.text = item.title
        cell.textLabel?.textColor = .white
        cell.backgroundColor = .clear
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let item = items[indexPath.row]
        let poster = CatalogPoster(id: item.id, title: item.title, poster: item.poster, content_type: item.mediaType)
        if item.mediaType == "series" {
            navigationController?.pushViewController(UIKitSeriesDetailViewController(seriesId: item.id), animated: true)
        } else {
            navigationController?.pushViewController(UIKitMovieDetailViewController(movieId: item.id), animated: true)
        }
        _ = poster
    }
}

final class UIKitMovieDetailViewController: UIViewController {
    private let movieId: Int
    private let scroll = UIScrollView()
    private let hero = UIImageView()
    private let titleLabel = UILabel()
    private let synopsisLabel = UILabel()
    private let playButton = UIButton(type: .system)
    private let playerVC = AVPlayerViewController()
    private var detail: MovieDetail?

    init(movieId: Int) { self.movieId = movieId; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = VixUITheme.bg
        title = "Película"
        navigationController?.setNavigationBarHidden(false, animated: false)
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        hero.contentMode = .scaleAspectFill
        hero.clipsToBounds = true
        hero.layer.cornerRadius = 12
        hero.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = .boldSystemFont(ofSize: 24)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 0
        synopsisLabel.font = .preferredFont(forTextStyle: .body)
        synopsisLabel.textColor = VixUITheme.muted
        synopsisLabel.numberOfLines = 0
        playButton.setTitle("  Reproducir", for: .normal)
        playButton.setImage(UIImage(systemName: "play.fill"), for: .normal)
        playButton.titleLabel?.font = .boldSystemFont(ofSize: 17)
        playButton.backgroundColor = VixUITheme.accent
        playButton.setTitleColor(.black, for: .normal)
        playButton.tintColor = .black
        playButton.layer.cornerRadius = 10
        playButton.contentEdgeInsets = UIEdgeInsets(top: 14, left: 24, bottom: 14, right: 24)
        playButton.addTarget(self, action: #selector(play), for: .touchUpInside)
        playerVC.view.translatesAutoresizingMaskIntoConstraints = false
        playerVC.view.isHidden = true
        addChild(playerVC)
        let stack = UIStackView(arrangedSubviews: [hero, titleLabel, synopsisLabel, playButton, playerVC.view])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        playerVC.didMove(toParent: self)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.topAnchor.constraint(equalTo: scroll.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: scroll.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: scroll.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: scroll.bottomAnchor, constant: -24),
            stack.widthAnchor.constraint(equalTo: scroll.widthAnchor, constant: -32),
            hero.heightAnchor.constraint(equalToConstant: 200),
            playerVC.view.heightAnchor.constraint(equalToConstant: 220)
        ])
        load()
    }

    private func load() {
        Task {
            do {
                let d = try await AuthSession.shared.api.movieDetail(id: movieId)
                await MainActor.run {
                    self.detail = d
                    self.titleLabel.text = d.title
                    self.synopsisLabel.text = d.synopsis
                    VixImageLoader.load(PlayUrls.poster(d.backdrop ?? d.poster), into: self.hero)
                }
            } catch { }
        }
    }

    @objc private func play() {
        guard let path = detail?.video_path,
              let url = PlayUrls.video(server: VixConfig.serverURL, token: AuthSession.shared.api.token, path: path) else { return }
        playerVC.view.isHidden = false
        playerVC.player = AVPlayer(url: url)
        playerVC.player?.play()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        playerVC.player?.pause()
    }
}

final class UIKitSeriesDetailViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    private let seriesId: Int
    private let table = UITableView(frame: .zero, style: .plain)
    private var detail: SeriesDetail?

    init(seriesId: Int) { self.seriesId = seriesId; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = VixUITheme.bg
        navigationController?.setNavigationBarHidden(false, animated: false)
        table.backgroundColor = .clear
        table.dataSource = self
        table.delegate = self
        table.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(table)
        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        Task {
            let d = try? await AuthSession.shared.api.seriesDetail(id: seriesId)
            await MainActor.run {
                self.detail = d
                self.title = d?.title
                self.table.reloadData()
            }
        }
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { detail?.episodes.count ?? 0 }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "ep") ?? UITableViewCell(style: .subtitle, reuseIdentifier: "ep")
        let ep = detail!.episodes[indexPath.row]
        cell.textLabel?.text = ep.title ?? "Episodio \(ep.episode)"
        cell.detailTextLabel?.text = "T\(ep.season) E\(ep.episode)"
        cell.textLabel?.textColor = .white
        cell.backgroundColor = .clear
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let ep = detail!.episodes[indexPath.row]
        guard let path = ep.video_path,
              let url = PlayUrls.video(server: VixConfig.serverURL, token: AuthSession.shared.api.token, path: path) else { return }
        let player = AVPlayerViewController()
        player.player = AVPlayer(url: url)
        present(player, animated: true) { player.player?.play() }
    }
}
