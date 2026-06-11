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

// MARK: - Login

final class UIKitLoginViewController: UIViewController {
    private let serverField = UITextField()
    private let userField = UITextField()
    private let passField = UITextField()
    private let errorLabel = UILabel()
    private let loginButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Vix TV"
        view.backgroundColor = .black
        navigationController?.navigationBar.barStyle = .black
        navigationController?.navigationBar.titleTextAttributes = [.foregroundColor: UIColor.white]

        let titleLabel = UILabel()
        titleLabel.text = "App nativa · AVPlayer"
        titleLabel.textColor = .secondaryLabel
        titleLabel.font = .preferredFont(forTextStyle: .subheadline)
        titleLabel.textAlignment = .center

        styleField(serverField, placeholder: "https://tv.vixred.com", text: VixConfig.serverURL)
        styleField(userField, placeholder: "Usuario")
        styleField(passField, placeholder: "Contraseña", secure: true)

        errorLabel.textColor = .systemRed
        errorLabel.font = .preferredFont(forTextStyle: .footnote)
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center

        loginButton.setTitle("Iniciar sesión", for: .normal)
        loginButton.titleLabel?.font = .boldSystemFont(ofSize: 17)
        loginButton.backgroundColor = .systemRed
        loginButton.setTitleColor(.white, for: .normal)
        loginButton.layer.cornerRadius = 10
        loginButton.addTarget(self, action: #selector(doLogin), for: .touchUpInside)

        spinner.hidesWhenStopped = true

        let stack = UIStackView(arrangedSubviews: [
            titleLabel, labeled("Servidor", serverField), labeled("Usuario", userField),
            labeled("Contraseña", passField), errorLabel, loginButton
        ])
        stack.axis = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        view.addSubview(spinner)
        spinner.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            loginButton.heightAnchor.constraint(equalToConstant: 48),
            spinner.centerXAnchor.constraint(equalTo: loginButton.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: loginButton.centerYAnchor)
        ])
    }

    private func styleField(_ field: UITextField, placeholder: String, text: String? = nil, secure: Bool = false) {
        field.placeholder = placeholder
        field.text = text
        field.borderStyle = .roundedRect
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.isSecureTextEntry = secure
        field.backgroundColor = UIColor(white: 0.12, alpha: 1)
        field.textColor = .white
    }

    private func labeled(_ title: String, _ field: UIView) -> UIStackView {
        let cap = UILabel()
        cap.text = title
        cap.font = .preferredFont(forTextStyle: .caption1)
        cap.textColor = .secondaryLabel
        return UIStackView(arrangedSubviews: [cap, field])
    }

    @objc private func doLogin() {
        errorLabel.text = ""
        guard let user = userField.text, !user.isEmpty,
              let pass = passField.text, !pass.isEmpty else { return }
        let server = serverField.text ?? VixConfig.serverURL
        VixConfig.saveServer(server)
        setLoading(true)
        Task {
            do {
                let result = try await AuthSession.shared.api.login(username: user, password: pass)
                await MainActor.run {
                    self.setLoading(false)
                    AuthSession.shared.applyLogin(result)
                    if result.needsProfilePick {
                        let pick = UIKitProfilePickerViewController()
                        self.navigationController?.setViewControllers([pick], animated: true)
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
        loginButton.setTitle(on ? "" : "Iniciar sesión", for: .normal)
        on ? spinner.startAnimating() : spinner.stopAnimating()
    }
}

// MARK: - Profile picker

final class UIKitProfilePickerViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    private let table = UITableView(frame: .zero, style: .insetGrouped)
    private var profiles: [UserProfile] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Elige perfil"
        view.backgroundColor = .black
        profiles = AuthSession.shared.profiles
        table.dataSource = self
        table.delegate = self
        table.backgroundColor = .black
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
        cell.backgroundColor = UIColor(white: 0.1, alpha: 1)
        cell.textLabel?.textColor = .white
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let profile = profiles[indexPath.row]
        if profile.is_kids {
            promptPin(for: profile)
        } else {
            select(profile: profile, pin: nil)
        }
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

final class UIKitMainTabController: UITabBarController {
    override func viewDidLoad() {
        super.viewDidLoad()
        tabBar.barStyle = .black
        tabBar.tintColor = .systemRed
        viewControllers = [
            wrap(UIKitHomeViewController(), title: "Inicio", icon: "house.fill"),
            wrap(UIKitLiveViewController(), title: "En vivo", icon: "dot.radiowaves.left.and.right"),
            wrap(UIKitSettingsViewController(), title: "Cuenta", icon: "person.fill")
        ]
    }

    private func wrap(_ vc: UIViewController, title: String, icon: String) -> UINavigationController {
        vc.title = title
        let nav = UINavigationController(rootViewController: vc)
        nav.tabBarItem = UITabBarItem(title: title, image: UIImage(systemName: icon), tag: 0)
        nav.navigationBar.barStyle = .black
        nav.navigationBar.titleTextAttributes = [.foregroundColor: UIColor.white]
        return nav
    }
}

// MARK: - Home

final class UIKitHomeViewController: UIViewController, UITableViewDataSource {
    private let table = UITableView(frame: .zero, style: .plain)
    private var sections: [CatalogSection] = []
    private let spinner = UIActivityIndicatorView(style: .large)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        table.backgroundColor = .black
        table.dataSource = self
        table.register(UITableViewCell.self, forCellReuseIdentifier: "c")
        table.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(table)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        load()
    }

    private func load() {
        spinner.startAnimating()
        Task {
            do {
                let home = try await AuthSession.shared.api.catalogHome()
                await MainActor.run {
                    self.sections = home.sections ?? []
                    self.table.reloadData()
                    self.spinner.stopAnimating()
                }
            } catch {
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.showError(error.localizedDescription)
                }
            }
        }
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { sections.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "c", for: indexPath)
        let s = sections[indexPath.row]
        cell.textLabel?.text = "\(s.title) (\(s.items.count))"
        cell.textLabel?.textColor = .white
        cell.backgroundColor = UIColor(white: 0.08, alpha: 1)
        cell.accessoryType = .disclosureIndicator
        return cell
    }

    private func showError(_ msg: String) {
        let a = UIAlertController(title: "Error", message: msg, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }
}

// MARK: - Live

final class UIKitLiveViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    private let playerVC = AVPlayerViewController()
    private let table = UITableView(frame: .zero, style: .plain)
    private var channels: [LiveChannel] = []
    private let spinner = UIActivityIndicatorView(style: .large)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        playerVC.view.translatesAutoresizingMaskIntoConstraints = false
        playerVC.view.isHidden = true
        addChild(playerVC)
        view.addSubview(playerVC.view)
        playerVC.didMove(toParent: self)

        table.backgroundColor = .black
        table.dataSource = self
        table.delegate = self
        table.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(table)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)

        NSLayoutConstraint.activate([
            playerVC.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            playerVC.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            playerVC.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            playerVC.view.heightAnchor.constraint(equalTo: view.widthAnchor, multiplier: 9.0 / 16.0),
            table.topAnchor.constraint(equalTo: playerVC.view.bottomAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        loadData()
    }

    private func loadData() {
        spinner.startAnimating()
        Task {
            do {
                let ch = try await AuthSession.shared.api.liveChannels()
                await MainActor.run {
                    self.channels = ch
                    self.table.reloadData()
                    self.spinner.stopAnimating()
                }
            } catch {
                await MainActor.run {
                    self.spinner.stopAnimating()
                    let a = UIAlertController(title: "Error", message: error.localizedDescription, preferredStyle: .alert)
                    a.addAction(UIAlertAction(title: "OK", style: .default))
                    self.present(a, animated: true)
                }
            }
        }
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { channels.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "ch") ?? UITableViewCell(style: .subtitle, reuseIdentifier: "ch")
        let ch = channels[indexPath.row]
        cell.textLabel?.text = ch.name
        cell.detailTextLabel?.text = ch.group_title
        cell.textLabel?.textColor = .white
        cell.detailTextLabel?.textColor = .secondaryLabel
        cell.backgroundColor = .black
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

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if isMovingFromParent || isBeingDismissed {
            playerVC.player?.pause()
        }
    }
}

// MARK: - Settings

final class UIKitSettingsViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let logoutButton = UIButton(type: .system)
        logoutButton.setTitle("Cerrar sesión", for: .normal)
        logoutButton.setTitleColor(.systemRed, for: .normal)
        logoutButton.addTarget(self, action: #selector(doLogout), for: .touchUpInside)
        logoutButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(logoutButton)
        NSLayoutConstraint.activate([
            logoutButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            logoutButton.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        if let p = AuthSession.shared.currentProfile {
            navigationItem.prompt = "Perfil: \(p.name)"
        }
    }

    @objc private func doLogout() {
        AuthSession.shared.logout()
        let nav = UINavigationController(rootViewController: UIKitLoginViewController())
        view.window?.rootViewController = nav
        view.window?.makeKeyAndVisible()
    }
}
