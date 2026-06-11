import UIKit
import AVKit
import SwiftUI

// UIKit puro para iOS 17 — SwiftUI no renderiza si SwiftUICore no está en el sistema.

enum VixAppRouter {
    static func rootViewController() -> UIViewController {
        if #available(iOS 18.0, *) {
            return makeSwiftUIHost()
        }
        return makeUIKitRoot()
    }

    @available(iOS 18.0, *)
    private static func makeSwiftUIHost() -> UIViewController {
        let host = UIHostingController(rootView: AnyView(NativeRootView().preferredColorScheme(.dark)))
        host.view.backgroundColor = .black
        return host
    }

    private static func makeUIKitRoot() -> UIViewController {
        let session = AuthSession.shared
        if !session.isLoggedIn {
            return UINavigationController(rootViewController: UIKitLoginViewController())
        }
        if session.needsProfilePick {
            return UINavigationController(rootViewController: UIKitProfilePickerViewController())
        }
        return UIKitMainTabController()
    }

    static func showMain(from nav: UINavigationController?) {
        let tabs = UIKitMainTabController()
        if let window = nav?.view.window ?? UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap({ $0.windows })
            .first(where: { $0.isKeyWindow }) {
            window.rootViewController = tabs
            window.makeKeyAndVisible()
            return
        }
        nav?.setViewControllers([tabs], animated: true)
    }
}

/// Detiene reproducción en vivo al cambiar de pestaña.
enum VixLivePlayback {
    static weak var current: UIKitLiveViewController?
    static func stopAll() { current?.stopPlayback() }
}

// MARK: - Login

final class UIKitLoginViewController: UIViewController {
    private let userField = UITextField()
    private let passField = UITextField()
    private let errorLabel = UILabel()
    private let loginButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let gradientLayer = CAGradientLayer()

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationController?.setNavigationBarHidden(true, animated: false)
        VixConfig.saveServer(VixConfig.defaultServer)

        gradientLayer.colors = [
            UIColor(red: 0.08, green: 0.05, blue: 0.02, alpha: 1).cgColor,
            UIColor(red: 0.04, green: 0.04, blue: 0.06, alpha: 1).cgColor,
            UIColor.black.cgColor
        ]
        gradientLayer.locations = [0, 0.45, 1]
        view.layer.insertSublayer(gradientLayer, at: 0)

        let card = UIView()
        card.backgroundColor = UIColor(white: 1, alpha: 0.06)
        card.layer.cornerRadius = 20
        card.layer.borderWidth = 1
        card.layer.borderColor = UIColor(white: 1, alpha: 0.1).cgColor
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        let icon = UIImageView(image: UIImage(systemName: "play.tv.fill"))
        icon.tintColor = VixUITheme.accent
        icon.contentMode = .scaleAspectFit
        icon.translatesAutoresizingMaskIntoConstraints = false

        let brand = UILabel()
        brand.text = "Vix TV"
        brand.font = .boldSystemFont(ofSize: 34)
        brand.textColor = .white
        brand.textAlignment = .center

        let subtitle = UILabel()
        subtitle.text = "Películas · Series · TV en vivo"
        subtitle.font = .systemFont(ofSize: 15, weight: .medium)
        subtitle.textColor = VixUITheme.muted
        subtitle.textAlignment = .center

        styleField(userField, placeholder: "Usuario", icon: "person.fill")
        styleField(passField, placeholder: "Contraseña", icon: "lock.fill", secure: true)

        errorLabel.textColor = UIColor(red: 1, green: 0.45, blue: 0.45, alpha: 1)
        errorLabel.font = .systemFont(ofSize: 13)
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center

        loginButton.setTitle("Entrar", for: .normal)
        loginButton.titleLabel?.font = .boldSystemFont(ofSize: 18)
        loginButton.backgroundColor = VixUITheme.accent
        loginButton.setTitleColor(.black, for: .normal)
        loginButton.layer.cornerRadius = 14
        loginButton.addTarget(self, action: #selector(doLogin), for: .touchUpInside)
        spinner.color = .black
        spinner.hidesWhenStopped = true

        let stack = UIStackView(arrangedSubviews: [
            icon, brand, subtitle, userField, passField, errorLabel, loginButton
        ])
        stack.axis = .vertical
        stack.spacing = 16
        stack.setCustomSpacing(8, after: brand)
        stack.setCustomSpacing(28, after: subtitle)
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        view.addSubview(spinner)

        NSLayoutConstraint.activate([
            card.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -28),
            icon.heightAnchor.constraint(equalToConstant: 52),
            userField.heightAnchor.constraint(equalToConstant: 50),
            passField.heightAnchor.constraint(equalToConstant: 50),
            loginButton.heightAnchor.constraint(equalToConstant: 52),
            spinner.centerXAnchor.constraint(equalTo: loginButton.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: loginButton.centerYAnchor)
        ])

        userField.delegate = self
        passField.delegate = self
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        gradientLayer.frame = view.bounds
    }

    private func styleField(_ field: UITextField, placeholder: String, icon: String, secure: Bool = false) {
        field.placeholder = placeholder
        field.textColor = .white
        field.backgroundColor = UIColor(white: 0, alpha: 0.35)
        field.layer.cornerRadius = 12
        field.layer.borderWidth = 1
        field.layer.borderColor = UIColor(white: 1, alpha: 0.12).cgColor
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.isSecureTextEntry = secure
        field.leftView = fieldIcon(icon)
        field.leftViewMode = .always
        field.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: UIColor(white: 0.55, alpha: 1)]
        )
    }

    private func fieldIcon(_ name: String) -> UIView {
        let wrap = UIView(frame: CGRect(x: 0, y: 0, width: 44, height: 50))
        let iv = UIImageView(image: UIImage(systemName: name))
        iv.tintColor = VixUITheme.muted
        iv.frame = CGRect(x: 14, y: 13, width: 22, height: 22)
        wrap.addSubview(iv)
        return wrap
    }

    @objc private func doLogin() {
        errorLabel.text = ""
        guard let user = userField.text?.trimmingCharacters(in: .whitespacesAndNewlines), !user.isEmpty,
              let pass = passField.text, !pass.isEmpty else {
            errorLabel.text = "Ingresa usuario y contraseña"
            return
        }
        setLoading(true)
        Task {
            do {
                let result = try await AuthSession.shared.api.login(username: user, password: pass)
                await MainActor.run {
                    self.setLoading(false)
                    AuthSession.shared.applyLogin(result)
                    if result.needsProfilePick {
                        self.navigationController?.setViewControllers([UIKitProfilePickerViewController()], animated: true)
                    } else {
                        VixAppRouter.showMain(from: self.navigationController)
                    }
                }
            } catch {
                await MainActor.run {
                    self.setLoading(false)
                    self.errorLabel.text = error.localizedDescription
                }
            }
        }
    }

    private func setLoading(_ on: Bool) {
        loginButton.isEnabled = !on
        loginButton.setTitle(on ? "" : "Entrar", for: .normal)
        on ? spinner.startAnimating() : spinner.stopAnimating()
    }
}

extension UIKitLoginViewController: UITextFieldDelegate {
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        if textField === userField { passField.becomeFirstResponder() }
        else { textField.resignFirstResponder(); doLogin() }
        return true
    }
}

// MARK: - Profile picker

final class UIKitProfilePickerViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    private let table = UITableView(frame: .zero, style: .insetGrouped)
    private var profiles: [UserProfile] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Elige perfil"
        view.backgroundColor = VixUITheme.bg
        profiles = AuthSession.shared.profiles
        table.dataSource = self
        table.delegate = self
        table.backgroundColor = .clear
        table.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(table)
        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { profiles.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "p") ?? UITableViewCell(style: .subtitle, reuseIdentifier: "p")
        let p = profiles[indexPath.row]
        cell.textLabel?.text = p.name
        cell.detailTextLabel?.text = p.is_kids ? "Kids" : nil
        cell.backgroundColor = VixUITheme.card
        cell.textLabel?.textColor = .white
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let profile = profiles[indexPath.row]
        if profile.is_kids { promptPin(for: profile) }
        else { select(profile: profile, pin: nil) }
    }

    private func promptPin(for profile: UserProfile) {
        let alert = UIAlertController(title: "PIN Kids", message: "Perfil \(profile.name)", preferredStyle: .alert)
        alert.addTextField { $0.isSecureTextEntry = true; $0.keyboardType = .numberPad }
        alert.addAction(UIAlertAction(title: "Cancelar", style: .cancel))
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            self.select(profile: profile, pin: alert.textFields?.first?.text)
        })
        present(alert, animated: true)
    }

    private func select(profile: UserProfile, pin: String?) {
        Task {
            do {
                try await AuthSession.shared.selectProfile(profileId: profile.id, pin: pin)
                await MainActor.run { VixAppRouter.showMain(from: self.navigationController) }
            } catch {
                await MainActor.run {
                    let a = UIAlertController(title: "Error", message: error.localizedDescription, preferredStyle: .alert)
                    a.addAction(UIAlertAction(title: "OK", style: .default))
                    self.present(a, animated: true)
                }
            }
        }
    }
}

// MARK: - Tabs

final class UIKitMainTabController: UITabBarController, UITabBarControllerDelegate {
    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self
        tabBar.barStyle = .black
        tabBar.tintColor = VixUITheme.accent
        tabBar.unselectedItemTintColor = VixUITheme.muted
        tabBar.backgroundColor = VixUITheme.bg
        viewControllers = [
            wrap(UIKitHomeViewController(), title: "Inicio", icon: "house.fill"),
            wrap(UIKitLiveViewController(), title: "En vivo", icon: "dot.radiowaves.left.and.right"),
            wrap(UIKitProfileViewController(), title: "Perfil", icon: "person.fill")
        ]
    }

    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        if !(viewController.children.first is UIKitLiveViewController) {
            VixLivePlayback.stopAll()
        }
    }

    private func wrap(_ vc: UIViewController, title: String, icon: String) -> UINavigationController {
        let nav = UINavigationController(rootViewController: vc)
        nav.tabBarItem = UITabBarItem(title: title, image: UIImage(systemName: icon), tag: 0)
        nav.navigationBar.barStyle = .black
        nav.navigationBar.titleTextAttributes = [.foregroundColor: UIColor.white]
        return nav
    }
}

// MARK: - Perfil (favoritos + historial)

final class UIKitProfileViewController: UIViewController {
    private let segmented = UISegmentedControl(items: ["Favoritos", "Historial", "Continuar"])
    private let table = UITableView(frame: .zero, style: .plain)
    private var favorites: [LibraryItem] = []
    private var history: [WatchItem] = []
    private var cont: [WatchItem] = []
    private let spinner = UIActivityIndicatorView(style: .large)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = VixUITheme.bg
        navigationController?.setNavigationBarHidden(true, animated: false)

        let title = UILabel()
        title.text = "Perfil"
        title.font = .boldSystemFont(ofSize: 28)
        title.textColor = .white

        let headerStack = UIStackView(arrangedSubviews: [title])
        headerStack.axis = .vertical
        headerStack.spacing = 4
        headerStack.alignment = .leading
        if let p = AuthSession.shared.currentProfile {
            let sub = UILabel()
            sub.text = p.name
            sub.font = .systemFont(ofSize: 15)
            sub.textColor = VixUITheme.muted
            headerStack.addArrangedSubview(sub)
        }
        headerStack.translatesAutoresizingMaskIntoConstraints = false

        segmented.selectedSegmentIndex = 0
        segmented.selectedSegmentTintColor = VixUITheme.accent
        segmented.setTitleTextAttributes([.foregroundColor: UIColor.black], for: .selected)
        segmented.setTitleTextAttributes([.foregroundColor: UIColor.white], for: .normal)
        segmented.backgroundColor = VixUITheme.card
        segmented.addTarget(self, action: #selector(tabChanged), for: .valueChanged)
        segmented.translatesAutoresizingMaskIntoConstraints = false

        table.backgroundColor = .clear
        table.separatorColor = UIColor.white.withAlphaComponent(0.08)
        table.dataSource = self
        table.delegate = self
        table.register(UIKitLibraryCell.self, forCellReuseIdentifier: UIKitLibraryCell.reuseId)
        table.translatesAutoresizingMaskIntoConstraints = false

        let logout = UIButton(type: .system)
        logout.setTitle("Cerrar sesión", for: .normal)
        logout.setTitleColor(.systemRed, for: .normal)
        logout.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        logout.addTarget(self, action: #selector(doLogout), for: .touchUpInside)
        logout.translatesAutoresizingMaskIntoConstraints = false

        spinner.color = VixUITheme.accent
        spinner.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(title)
        view.addSubview(segmented)
        view.addSubview(table)
        view.addSubview(logout)
        view.addSubview(spinner)

        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            title.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            segmented.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 28),
            segmented.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            segmented.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            table.topAnchor.constraint(equalTo: segmented.bottomAnchor, constant: 12),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: logout.topAnchor, constant: -8),
            logout.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
            logout.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        load()
    }

    @objc private func tabChanged() { table.reloadData() }

    private func load() {
        spinner.startAnimating()
        Task {
            do {
                async let fav = AuthSession.shared.api.favorites()
                async let hist = AuthSession.shared.api.watchHistory()
                async let c = AuthSession.shared.api.watchContinue()
                let (f, h, co) = try await (fav, hist, c)
                await MainActor.run {
                    self.favorites = f
                    self.history = h
                    self.cont = co
                    self.table.reloadData()
                    self.spinner.stopAnimating()
                }
            } catch {
                await MainActor.run { self.spinner.stopAnimating() }
            }
        }
    }

    @objc private func doLogout() {
        AuthSession.shared.logout()
        VixLivePlayback.stopAll()
        view.window?.rootViewController = UINavigationController(rootViewController: UIKitLoginViewController())
        view.window?.makeKeyAndVisible()
    }
}

extension UIKitProfileViewController: UITableViewDataSource, UITableViewDelegate {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch segmented.selectedSegmentIndex {
        case 0: return max(favorites.count, 1)
        case 1: return max(history.count, 1)
        default: return max(cont.count, 1)
        }
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: UIKitLibraryCell.reuseId, for: indexPath) as! UIKitLibraryCell
        switch segmented.selectedSegmentIndex {
        case 0:
            if favorites.isEmpty { cell.setEmpty("Sin favoritos"); return cell }
            let item = favorites[indexPath.row]
            cell.configure(title: item.title, poster: item.poster, subtitle: item.isSeries ? "Serie" : "Película")
        case 1:
            if history.isEmpty { cell.setEmpty("Sin historial"); return cell }
            let item = history[indexPath.row]
            cell.configure(title: item.displayTitle, poster: item.poster, subtitle: item.progress_label)
        default:
            if cont.isEmpty { cell.setEmpty("Nada pendiente"); return cell }
            let item = cont[indexPath.row]
            cell.configure(title: item.displayTitle, poster: item.poster, subtitle: item.progress_label ?? "Continuar")
        }
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        switch segmented.selectedSegmentIndex {
        case 0:
            guard indexPath.row < favorites.count else { return }
            let item = favorites[indexPath.row]
            openLibrary(item)
        case 1, 2:
            let list = segmented.selectedSegmentIndex == 1 ? history : cont
            guard indexPath.row < list.count else { return }
            openWatch(list[indexPath.row])
        default: break
        }
    }

    private func openLibrary(_ item: LibraryItem) {
        let vc = item.isSeries
            ? UIKitSeriesDetailViewController(seriesId: item.id)
            : UIKitMovieDetailViewController(movieId: item.id)
        navigationController?.pushViewController(vc, animated: true)
    }

    private func openWatch(_ item: WatchItem) {
        if item.content_type == "episode", let sid = item.series_id {
            navigationController?.pushViewController(UIKitSeriesDetailViewController(seriesId: sid), animated: true)
        } else {
            navigationController?.pushViewController(
                UIKitMovieDetailViewController(movieId: item.content_id, startAt: item.progress ?? 0),
                animated: true
            )
        }
    }
}

final class UIKitLibraryCell: UITableViewCell {
    static let reuseId = "lib"
    private let poster = UIImageView()
    private let titleLabel = UILabel()
    private let subLabel = UILabel()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        selectionStyle = .none
        poster.layer.cornerRadius = 6
        poster.clipsToBounds = true
        poster.contentMode = .scaleAspectFill
        poster.backgroundColor = VixUITheme.card
        poster.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 2
        subLabel.font = .systemFont(ofSize: 12)
        subLabel.textColor = VixUITheme.muted
        let text = UIStackView(arrangedSubviews: [titleLabel, subLabel])
        text.axis = .vertical
        text.spacing = 4
        text.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(poster)
        contentView.addSubview(text)
        NSLayoutConstraint.activate([
            poster.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            poster.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            poster.widthAnchor.constraint(equalToConstant: 48),
            poster.heightAnchor.constraint(equalToConstant: 68),
            text.leadingAnchor.constraint(equalTo: poster.trailingAnchor, constant: 12),
            text.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            text.centerYAnchor.constraint(equalTo: contentView.centerYAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(title: String, poster path: String?, subtitle: String?) {
        titleLabel.text = title
        subLabel.text = subtitle
        VixImageLoader.load(PlayUrls.poster(path), into: poster)
    }

    func setEmpty(_ msg: String) {
        titleLabel.text = msg
        subLabel.text = nil
        poster.image = nil
    }
}
