import UIKit
import AVKit
import UserNotifications

// UIKit en todas las versiones (iOS 17+): misma interfaz Tele Latino en iPhone/iPad.

enum VixAppRouter {
    static func rootViewController() -> UIViewController {
        makeUIKitRoot()
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
    private let scrollView = UIScrollView()
    private let contentView = UIView()
    private let userField = UITextField()
    private let passField = UITextField()
    private let errorLabel = UILabel()
    private let loginButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let gradientLayer = CAGradientLayer()

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationController?.setNavigationBarHidden(true, animated: false)
        view.backgroundColor = .black
        VixConfig.saveServer(VixConfig.defaultServer)

        gradientLayer.colors = [
            UIColor(red: 0.08, green: 0.05, blue: 0.02, alpha: 1).cgColor,
            UIColor(red: 0.04, green: 0.04, blue: 0.06, alpha: 1).cgColor,
            UIColor.black.cgColor
        ]
        gradientLayer.locations = [0, 0.45, 1]
        view.layer.insertSublayer(gradientLayer, at: 0)

        scrollView.keyboardDismissMode = .interactive
        scrollView.alwaysBounceVertical = true
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        contentView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)
        scrollView.addSubview(contentView)

        let card = UIView()
        card.backgroundColor = UIColor(white: 1, alpha: 0.06)
        card.layer.cornerRadius = 20
        card.layer.borderWidth = 1
        card.layer.borderColor = UIColor(white: 1, alpha: 0.1).cgColor
        card.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(card)

        let icon = UIImageView(image: UIImage(systemName: "play.tv.fill"))
        icon.tintColor = VixUITheme.accent
        icon.contentMode = .scaleAspectFit
        icon.translatesAutoresizingMaskIntoConstraints = false

        let brand = UILabel()
        brand.text = "Vix TV"
        brand.font = .boldSystemFont(ofSize: 34)
        brand.textColor = .white
        brand.textAlignment = .center
        brand.translatesAutoresizingMaskIntoConstraints = false

        let subtitle = UILabel()
        subtitle.text = "Películas · Series · TV en vivo"
        subtitle.font = .systemFont(ofSize: 15, weight: .medium)
        subtitle.textColor = VixUITheme.muted
        subtitle.textAlignment = .center
        subtitle.translatesAutoresizingMaskIntoConstraints = false

        styleField(userField, placeholder: "Usuario", icon: "person.fill")
        styleField(passField, placeholder: "Contraseña", icon: "lock.fill", secure: true)

        errorLabel.textColor = UIColor(red: 1, green: 0.45, blue: 0.45, alpha: 1)
        errorLabel.font = .systemFont(ofSize: 13)
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.translatesAutoresizingMaskIntoConstraints = false

        loginButton.setTitle("Entrar", for: .normal)
        loginButton.titleLabel?.font = .boldSystemFont(ofSize: 18)
        loginButton.backgroundColor = VixUITheme.accent
        loginButton.setTitleColor(.black, for: .normal)
        loginButton.layer.cornerRadius = 14
        loginButton.translatesAutoresizingMaskIntoConstraints = false
        loginButton.addTarget(self, action: #selector(doLogin), for: .touchUpInside)
        spinner.color = .black
        spinner.hidesWhenStopped = true
        spinner.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(icon)
        card.addSubview(brand)
        card.addSubview(subtitle)
        card.addSubview(userField)
        card.addSubview(passField)
        card.addSubview(errorLabel)
        card.addSubview(loginButton)
        card.addSubview(spinner)

        let pad: CGFloat = 24
        let cardMax = card.widthAnchor.constraint(lessThanOrEqualToConstant: 420)
        let cardWidth = card.widthAnchor.constraint(equalTo: contentView.widthAnchor, constant: -(pad * 2))
        cardWidth.priority = .defaultHigh

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            contentView.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
            contentView.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
            contentView.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
            contentView.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
            contentView.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor),

            card.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            card.topAnchor.constraint(greaterThanOrEqualTo: contentView.safeAreaLayoutGuide.topAnchor, constant: 24),
            card.bottomAnchor.constraint(lessThanOrEqualTo: contentView.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            card.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: contentView.leadingAnchor, constant: pad),
            card.trailingAnchor.constraint(lessThanOrEqualTo: contentView.trailingAnchor, constant: -pad),
            cardWidth,
            cardMax,

            icon.topAnchor.constraint(equalTo: card.topAnchor, constant: 28),
            icon.centerXAnchor.constraint(equalTo: card.centerXAnchor),
            icon.widthAnchor.constraint(equalToConstant: 72),
            icon.heightAnchor.constraint(equalToConstant: 72),

            brand.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 12),
            brand.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            brand.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22),

            subtitle.topAnchor.constraint(equalTo: brand.bottomAnchor, constant: 8),
            subtitle.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            subtitle.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22),

            userField.topAnchor.constraint(equalTo: subtitle.bottomAnchor, constant: 28),
            userField.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            userField.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22),
            userField.heightAnchor.constraint(equalToConstant: 50),

            passField.topAnchor.constraint(equalTo: userField.bottomAnchor, constant: 14),
            passField.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            passField.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22),
            passField.heightAnchor.constraint(equalToConstant: 50),

            errorLabel.topAnchor.constraint(equalTo: passField.bottomAnchor, constant: 10),
            errorLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            errorLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22),

            loginButton.topAnchor.constraint(equalTo: errorLabel.bottomAnchor, constant: 16),
            loginButton.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            loginButton.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22),
            loginButton.heightAnchor.constraint(equalToConstant: 52),
            loginButton.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -28),

            spinner.centerXAnchor.constraint(equalTo: loginButton.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: loginButton.centerYAnchor)
        ])

        contentView.heightAnchor.constraint(greaterThanOrEqualTo: scrollView.frameLayoutGuide.heightAnchor).isActive = true

        userField.delegate = self
        passField.delegate = self
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        gradientLayer.frame = view.bounds
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        VixUpdateChecker.check(from: self)
    }

    private func styleField(_ field: UITextField, placeholder: String, icon: String, secure: Bool = false) {
        field.translatesAutoresizingMaskIntoConstraints = false
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

// MARK: - Profile picker (Netflix style)

final class UIKitProfilePickerViewController: UIViewController, UICollectionViewDataSource, UICollectionViewDelegate, UICollectionViewDelegateFlowLayout {
    private var profiles: [UserProfile] = []
    private var collectionView: UICollectionView!
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let manageButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = VixUITheme.bg
        navigationController?.setNavigationBarHidden(true, animated: false)
        titleLabel.text = "¿Quién está viendo?"
        titleLabel.font = .boldSystemFont(ofSize: 30)
        titleLabel.textColor = .white
        titleLabel.textAlignment = .center
        subtitleLabel.text = "Cada perfil tiene su lista, favoritos y progreso"
        subtitleLabel.font = .systemFont(ofSize: 15)
        subtitleLabel.textColor = VixUITheme.muted
        subtitleLabel.textAlignment = .center
        subtitleLabel.numberOfLines = 0
        manageButton.setTitle("Administrar perfiles", for: .normal)
        manageButton.setTitleColor(VixUITheme.muted, for: .normal)
        manageButton.addTarget(self, action: #selector(toggleManage), for: .touchUpInside)
        let layout = UICollectionViewFlowLayout()
        layout.minimumInteritemSpacing = 20
        layout.minimumLineSpacing = 24
        layout.sectionInset = UIEdgeInsets(top: 16, left: 24, bottom: 24, right: 24)
        collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collectionView.backgroundColor = .clear
        collectionView.dataSource = self
        collectionView.delegate = self
        collectionView.register(VixProfileAvatarCell.self, forCellWithReuseIdentifier: VixProfileAvatarCell.reuseId)
        [titleLabel, subtitleLabel, collectionView, manageButton].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview($0)
        }
        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 32),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 8),
            subtitleLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            subtitleLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            collectionView.topAnchor.constraint(equalTo: subtitleLabel.bottomAnchor, constant: 24),
            collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            collectionView.bottomAnchor.constraint(equalTo: manageButton.topAnchor, constant: -12),
            manageButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            manageButton.centerXAnchor.constraint(equalTo: view.centerXAnchor)
        ])
        reloadProfiles()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reloadProfiles()
    }

    private func reloadProfiles() {
        Task {
            let list = (try? await AuthSession.shared.api.listProfiles()) ?? AuthSession.shared.profiles
            await MainActor.run {
                self.profiles = list
                AuthSession.shared.profiles = list
                self.collectionView?.reloadData()
            }
        }
    }

    @objc private func toggleManage() {
        let sheet = UIAlertController(title: "Perfiles", message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "Agregar perfil", style: .default) { _ in self.promptCreateProfile() })
        if profiles.count > 1 {
            sheet.addAction(UIAlertAction(title: "Eliminar un perfil", style: .destructive) { _ in self.promptDeleteProfile() })
        }
        sheet.addAction(UIAlertAction(title: "Cancelar", style: .cancel))
        if let pop = sheet.popoverPresentationController { pop.sourceView = manageButton }
        present(sheet, animated: true)
    }

    private func promptCreateProfile() {
        let alert = UIAlertController(title: "Nuevo perfil", message: nil, preferredStyle: .alert)
        alert.addTextField { $0.placeholder = "Nombre" }
        alert.addAction(UIAlertAction(title: "Cancelar", style: .cancel))
        alert.addAction(UIAlertAction(title: "Infantil (Kids)", style: .default) { _ in
            self.promptKidsPin(name: alert.textFields?.first?.text ?? "")
        })
        alert.addAction(UIAlertAction(title: "Adulto", style: .default) { _ in
            self.createProfile(name: alert.textFields?.first?.text ?? "", isKids: false, pin: nil)
        })
        present(alert, animated: true)
    }

    private func promptKidsPin(name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let alert = UIAlertController(title: "PIN parental", message: "PIN de 4 dígitos para salir del perfil infantil", preferredStyle: .alert)
        alert.addTextField { $0.isSecureTextEntry = true; $0.keyboardType = .numberPad; $0.placeholder = "••••" }
        alert.addAction(UIAlertAction(title: "Cancelar", style: .cancel))
        alert.addAction(UIAlertAction(title: "Crear", style: .default) { _ in
            self.createProfile(name: trimmed, isKids: true, pin: alert.textFields?.first?.text)
        })
        present(alert, animated: true)
    }

    private func createProfile(name: String, isKids: Bool, pin: String?) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        Task {
            do {
                if profiles.isEmpty {
                    let result = try await AuthSession.shared.api.setupProfile(name: trimmed, isKids: isKids, pin: pin)
                    await MainActor.run {
                        AuthSession.shared.api.saveToken(result.token)
                        AuthSession.shared.currentProfile = result.profile
                        AuthSession.shared.needsProfilePick = false
                        VixAppRouter.showMain(from: self.navigationController)
                    }
                } else {
                    _ = try await AuthSession.shared.api.createProfile(name: trimmed, isKids: isKids, pin: pin)
                    await MainActor.run { self.reloadProfiles() }
                }
            } catch {
                await MainActor.run { self.showError(error.localizedDescription) }
            }
        }
    }

    private func promptDeleteProfile() {
        let alert = UIAlertController(title: "Eliminar perfil", message: "Elige cuál eliminar", preferredStyle: .actionSheet)
        for p in profiles {
            alert.addAction(UIAlertAction(title: p.name, style: .destructive) { _ in
                Task {
                    try? await AuthSession.shared.api.deleteProfile(id: p.id)
                    await MainActor.run { self.reloadProfiles() }
                }
            })
        }
        alert.addAction(UIAlertAction(title: "Cancelar", style: .cancel))
        if let pop = alert.popoverPresentationController { pop.sourceView = manageButton }
        present(alert, animated: true)
    }

    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
        profiles.count + (profiles.count < 5 ? 1 : 0)
    }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: VixProfileAvatarCell.reuseId, for: indexPath) as! VixProfileAvatarCell
        if indexPath.item < profiles.count {
            cell.configure(profile: profiles[indexPath.item])
        } else {
            cell.configureAdd()
        }
        return cell
    }

    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        if indexPath.item >= profiles.count {
            promptCreateProfile()
            return
        }
        let profile = profiles[indexPath.item]
        if profile.is_kids { promptPin(for: profile) }
        else { select(profile: profile, pin: nil) }
    }

    func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
        let w = min(collectionView.bounds.width - 48, 420)
        let cols: CGFloat = collectionView.bounds.width > 500 ? 4 : 2
        let side = (w - (cols - 1) * 20) / cols
        return CGSize(width: side, height: side + 28)
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
                await MainActor.run { self.showError(error.localizedDescription) }
            }
        }
    }

    private func showError(_ msg: String) {
        let a = UIAlertController(title: "Error", message: msg, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }
}

final class VixProfileAvatarCell: UICollectionViewCell {
    static let reuseId = "profileAvatar"
    private let circle = UIView()
    private let initial = UILabel()
    private let nameLabel = UILabel()
    private let badge = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        circle.layer.cornerRadius = 8
        circle.translatesAutoresizingMaskIntoConstraints = false
        initial.font = .boldSystemFont(ofSize: 36)
        initial.textColor = .white
        initial.textAlignment = .center
        initial.translatesAutoresizingMaskIntoConstraints = false
        nameLabel.font = .systemFont(ofSize: 14, weight: .medium)
        nameLabel.textColor = VixUITheme.muted
        nameLabel.textAlignment = .center
        nameLabel.translatesAutoresizingMaskIntoConstraints = false
        badge.font = .systemFont(ofSize: 10, weight: .bold)
        badge.textColor = .black
        badge.backgroundColor = VixUITheme.accent
        badge.text = " KIDS "
        badge.layer.cornerRadius = 4
        badge.clipsToBounds = true
        badge.isHidden = true
        badge.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(circle)
        circle.addSubview(initial)
        contentView.addSubview(nameLabel)
        contentView.addSubview(badge)
        NSLayoutConstraint.activate([
            circle.topAnchor.constraint(equalTo: contentView.topAnchor),
            circle.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
            circle.widthAnchor.constraint(equalTo: contentView.widthAnchor, multiplier: 0.85),
            circle.heightAnchor.constraint(equalTo: circle.widthAnchor),
            initial.centerXAnchor.constraint(equalTo: circle.centerXAnchor),
            initial.centerYAnchor.constraint(equalTo: circle.centerYAnchor),
            nameLabel.topAnchor.constraint(equalTo: circle.bottomAnchor, constant: 8),
            nameLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            nameLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            badge.topAnchor.constraint(equalTo: circle.topAnchor, constant: 6),
            badge.trailingAnchor.constraint(equalTo: circle.trailingAnchor, constant: -6)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(profile: UserProfile) {
        let color = UIColor(hex: profile.avatar_color ?? "#7c3aed") ?? VixUITheme.accent
        circle.backgroundColor = color
        initial.text = String(profile.name.prefix(1)).uppercased()
        nameLabel.text = profile.name
        badge.isHidden = !profile.is_kids
        initial.text = profile.is_kids ? "👶" : String(profile.name.prefix(1)).uppercased()
    }

    func configureAdd() {
        circle.backgroundColor = VixUITheme.card
        circle.layer.borderWidth = 2
        circle.layer.borderColor = VixUITheme.muted.withAlphaComponent(0.35).cgColor
        initial.text = "+"
        nameLabel.text = "Agregar"
        badge.isHidden = true
    }
}

private extension UIColor {
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = Int(s, radix: 16) else { return nil }
        self.init(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
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

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        VixUpdateChecker.check(from: self)
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

// MARK: - Cambiar contraseña

final class UIKitChangePasswordViewController: UIViewController {
    private let currentField = UITextField()
    private let newField = UITextField()
    private let confirmField = UITextField()
    private let errorLabel = UILabel()
    private let saveButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = VixUITheme.bg
        title = "Cambiar contraseña"
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            title: "Cancelar",
            style: .plain,
            target: self,
            action: #selector(cancelTapped)
        )
        navigationController?.navigationBar.barStyle = .black
        navigationController?.navigationBar.titleTextAttributes = [.foregroundColor: UIColor.white]
        navigationController?.navigationBar.tintColor = VixUITheme.accent

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false

        func styleField(_ field: UITextField, placeholder: String) {
            field.placeholder = placeholder
            field.isSecureTextEntry = true
            field.borderStyle = .roundedRect
            field.backgroundColor = VixUITheme.card
            field.textColor = .white
            field.autocapitalizationType = .none
            field.autocorrectionType = .no
        }
        styleField(currentField, placeholder: "Contraseña actual")
        styleField(newField, placeholder: "Nueva contraseña")
        styleField(confirmField, placeholder: "Confirmar nueva contraseña")

        errorLabel.textColor = .systemRed
        errorLabel.font = .systemFont(ofSize: 14)
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center

        saveButton.setTitle("Guardar", for: .normal)
        saveButton.setTitleColor(.black, for: .normal)
        saveButton.backgroundColor = VixUITheme.accent
        saveButton.layer.cornerRadius = 10
        saveButton.titleLabel?.font = .boldSystemFont(ofSize: 17)
        saveButton.contentEdgeInsets = UIEdgeInsets(top: 12, left: 20, bottom: 12, right: 20)
        saveButton.addTarget(self, action: #selector(saveTapped), for: .touchUpInside)

        spinner.color = VixUITheme.accent
        spinner.hidesWhenStopped = true

        stack.addArrangedSubview(currentField)
        stack.addArrangedSubview(newField)
        stack.addArrangedSubview(confirmField)
        stack.addArrangedSubview(errorLabel)
        stack.addArrangedSubview(saveButton)
        stack.addArrangedSubview(spinner)

        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        currentField.becomeFirstResponder()
    }

    @objc private func cancelTapped() {
        dismiss(animated: true)
    }

    @objc private func saveTapped() {
        errorLabel.text = ""
        let current = currentField.text ?? ""
        let next = newField.text ?? ""
        let confirm = confirmField.text ?? ""
        guard !current.isEmpty, !next.isEmpty, !confirm.isEmpty else {
            errorLabel.text = "Completa todos los campos"
            return
        }
        guard next == confirm else {
            errorLabel.text = "Las contraseñas nuevas no coinciden"
            return
        }
        guard next.count >= 4 else {
            errorLabel.text = "Mínimo 4 caracteres"
            return
        }
        saveButton.isEnabled = false
        spinner.startAnimating()
        Task {
            do {
                try await AuthSession.shared.api.changePassword(current: current, new: next)
                await MainActor.run {
                    spinner.stopAnimating()
                    let alert = UIAlertController(title: "Listo", message: "Contraseña actualizada", preferredStyle: .alert)
                    alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
                        self?.dismiss(animated: true)
                    })
                    self.present(alert, animated: true)
                }
            } catch {
                await MainActor.run {
                    spinner.stopAnimating()
                    saveButton.isEnabled = true
                    errorLabel.text = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
    }
}

// MARK: - Perfil (favoritos + historial)

final class UIKitProfileViewController: UIViewController {
    private let segmented = UISegmentedControl(items: ["Favoritos", "Ya miré", "Seguir viendo"])
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
            sub.text = p.name + (p.is_kids ? " · Kids" : "")
            sub.font = .systemFont(ofSize: 15)
            sub.textColor = VixUITheme.muted
            headerStack.addArrangedSubview(sub)
        }
        let switchProfile = UIButton(type: .system)
        switchProfile.setTitle("Cambiar perfil", for: .normal)
        switchProfile.setTitleColor(VixUITheme.accent, for: .normal)
        switchProfile.addTarget(self, action: #selector(switchProfileTapped), for: .touchUpInside)
        headerStack.addArrangedSubview(switchProfile)
        let changePassword = UIButton(type: .system)
        changePassword.setTitle("Cambiar contraseña", for: .normal)
        changePassword.setTitleColor(VixUITheme.accent, for: .normal)
        changePassword.addTarget(self, action: #selector(changePasswordTapped), for: .touchUpInside)
        headerStack.addArrangedSubview(changePassword)
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

        view.addSubview(headerStack)
        view.addSubview(segmented)
        view.addSubview(table)
        view.addSubview(logout)
        view.addSubview(spinner)

        NSLayoutConstraint.activate([
            headerStack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            headerStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            headerStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            segmented.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 20),
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

    @objc private func switchProfileTapped() {
        let picker = UIKitProfilePickerViewController()
        picker.modalPresentationStyle = .fullScreen
        present(UINavigationController(rootViewController: picker), animated: true)
    }

    @objc private func changePasswordTapped() {
        let vc = UIKitChangePasswordViewController()
        let nav = UINavigationController(rootViewController: vc)
        nav.modalPresentationStyle = .fullScreen
        present(nav, animated: true)
    }

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
            if let path = item.video_path, !path.isEmpty,
               let url = PlayUrls.video(server: VixConfig.serverURL, token: AuthSession.shared.api.token, path: PlayUrls.normalizeMediaPath(path), startAt: item.progress ?? 0) {
                VixUIKitPlayer.playFullscreen(from: self, url: url, startAt: item.progress ?? 0) { prog, dur in
                    Task {
                        try? await AuthSession.shared.api.saveWatchProgress(
                            contentType: "episode", contentId: item.content_id, seriesId: sid, progress: prog, duration: dur
                        )
                    }
                }
            } else {
                navigationController?.pushViewController(
                    UIKitSeriesDetailViewController(seriesId: sid, episodeId: item.content_id, startAt: item.progress ?? 0),
                    animated: true
                )
            }
        } else if let path = item.video_path, !path.isEmpty,
                  let url = PlayUrls.video(server: VixConfig.serverURL, token: AuthSession.shared.api.token, path: PlayUrls.normalizeMediaPath(path), startAt: item.progress ?? 0) {
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

// MARK: - OTA updates (iOS)

enum VixUpdateChecker {
    private static var dialogVisible = false
    private static let notifiedBuildKey = "vix_ios_update_notified_build"

    static func check(from presenter: UIViewController?) {
        guard let presenter = presenter else { return }
        Task { await checkAndPrompt(presenter: presenter) }
    }

    private static func clientBuild() -> Int {
        Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0") ?? 0
    }

    @MainActor
    private static func checkAndPrompt(presenter: UIViewController) async {
        let build = clientBuild()
        let server = VixConfig.serverURL
        guard var components = URLComponents(string: "\(server)/api/app/update") else { return }
        components.queryItems = [
            URLQueryItem(name: "platform", value: "ios"),
            URLQueryItem(name: "version_code", value: String(build))
        ]
        guard let url = components.url else { return }
        do {
            var req = URLRequest(url: url)
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            req.timeoutInterval = 12
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { return }
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  json["update_available"] as? Bool == true else { return }
            let versionName = json["version_name"] as? String ?? ""
            let message = json["message"] as? String ?? "Hay una nueva versión de Vix TV."
            let installUrl = (json["install_url"] as? String)
                ?? (json["download_url"] as? String)
                ?? "\(server)/ipa/install"
            let latestCode = json["version_code"] as? Int ?? 0
            postLocalNotification(versionName: versionName, message: message, installUrl: installUrl, latestCode: latestCode)
            guard !dialogVisible else { return }
            dialogVisible = true
            let title = versionName.isEmpty ? "Actualización disponible" : "Vix TV \(versionName)"
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Más tarde", style: .cancel) { _ in
                dialogVisible = false
            })
            alert.addAction(UIAlertAction(title: "Actualizar", style: .default) { _ in
                dialogVisible = false
                openInstall(urlString: installUrl, presenter: presenter)
            })
            presenter.present(alert, animated: true)
        } catch {
            return
        }
    }

    @MainActor
    private static func openInstall(urlString: String, presenter: UIViewController) {
        guard let url = URL(string: urlString) else { return }
        UIApplication.shared.open(url)
    }

    private static func postLocalNotification(versionName: String, message: String, installUrl: String, latestCode: Int) {
        let last = UserDefaults.standard.integer(forKey: notifiedBuildKey)
        guard latestCode > last else { return }
        UserDefaults.standard.set(latestCode, forKey: notifiedBuildKey)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = versionName.isEmpty ? "Actualización Vix TV" : "Vix TV \(versionName)"
            content.body = message
            content.sound = .default
            if let url = URL(string: installUrl) {
                content.userInfo = ["install_url": url.absoluteString]
            }
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
            let req = UNNotificationRequest(identifier: "vixtv-ios-update-\(latestCode)", content: content, trigger: trigger)
            UNUserNotificationCenter.current().add(req)
        }
    }
}
