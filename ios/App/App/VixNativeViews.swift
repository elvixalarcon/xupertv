import SwiftUI
import AVKit

// MARK: - Root

struct NativeRootView: View {
    @ObservedObject private var session = AuthSession.shared

    var body: some View {
        Group {
            if !session.isLoggedIn {
                LoginView()
            } else if session.needsProfilePick {
                ProfilePickerView(session: session)
            } else {
                MainTabView()
            }
        }
    }
}

// MARK: - Session

final class AuthSession: ObservableObject {
    static let shared = AuthSession()
    @Published var isLoggedIn: Bool
    @Published var needsProfilePick = false
    @Published var profiles: [UserProfile] = []
    @Published var currentProfile: UserProfile?
    let api: VixAPI

    private init() {
        let api = VixAPI()
        self.api = api
        isLoggedIn = !api.token.isEmpty
    }

    func applyLogin(_ result: LoginResponse) {
        api.saveToken(result.token)
        profiles = result.profiles
        currentProfile = result.profile
        needsProfilePick = result.needsProfilePick
        isLoggedIn = true
    }

    func selectProfile(profileId: Int, pin: String?) async throws {
        let (tok, profile) = try await api.selectProfile(profileId: profileId, pin: pin)
        api.saveToken(tok)
        currentProfile = profile
        needsProfilePick = false
    }

    func logout() {
        api.clearToken()
        isLoggedIn = false
        needsProfilePick = false
        profiles = []
        currentProfile = nil
    }
}

// MARK: - Login

struct LoginView: View {
    @ObservedObject private var session = AuthSession.shared
    @State private var server = VixConfig.serverURL
    @State private var username = ""
    @State private var password = ""
    @State private var loading = false
    @State private var errorMessage = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Image(systemName: "play.tv.fill")
                    .font(.system(size: 56))
                    .foregroundColor(.red)
                Text("Vix TV")
                    .font(.largeTitle.bold())
                Text("App nativa · AVPlayer")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Servidor").font(.caption).foregroundColor(.secondary)
                    TextField("https://tv.vixred.com", text: $server)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Usuario").font(.caption).foregroundColor(.secondary)
                    TextField("Usuario", text: $username)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .autocapitalization(.none)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Contraseña").font(.caption).foregroundColor(.secondary)
                    SecureField("Contraseña", text: $password)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                }

                if !errorMessage.isEmpty {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)
                }

                Button(action: doLogin) {
                    HStack {
                        if loading { ProgressView().progressViewStyle(CircularProgressViewStyle()) }
                        Text(loading ? "Entrando…" : "Iniciar sesión")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.red)
                    .foregroundColor(.white)
                    .cornerRadius(10)
                }
                .disabled(loading || username.isEmpty || password.isEmpty)
            }
            .padding(24)
        }
        .background(Color.black.edgesIgnoringSafeArea(.all))
    }

    private func doLogin() {
        errorMessage = ""
        loading = true
        VixConfig.saveServer(server)
        Task {
            do {
                let result = try await session.api.login(username: username, password: password)
                await MainActor.run {
                    loading = false
                    session.applyLogin(result)
                }
            } catch let err {
                await MainActor.run {
                    loading = false
                    errorMessage = err.localizedDescription
                }
            }
        }
    }
}

// MARK: - Main tabs

struct MainTabView: View {
    var body: some View {
        TabView {
            HomeNativeView()
                .tabItem { Label("Inicio", systemImage: "house.fill") }
            LiveNativeView()
                .tabItem { Label("En vivo", systemImage: "dot.radiowaves.left.and.right") }
            SearchNativeView()
                .tabItem { Label("Buscar", systemImage: "magnifyingglass") }
            LibraryNativeView()
                .tabItem { Label("Mi lista", systemImage: "heart.fill") }
            SettingsNativeView()
                .tabItem { Label("Cuenta", systemImage: "person.fill") }
        }
        .accentColor(.red)
    }
}

// MARK: - Home

struct HomeNativeView: View {
    @ObservedObject private var session = AuthSession.shared
    @State private var home: CatalogHome?
    @State private var errorMessage = ""
    @State private var loading = true

    private let storefronts: [(slug: String, title: String, icon: String)] = [
        ("destacados", "Destacados", "star.fill"),
        ("kids", "Kids", "heart.fill"),
        ("anime", "Anime", "sparkles")
    ]

    var body: some View {
        NavigationView {
            Group {
                if loading {
                    ProgressView("Cargando…")
                } else if let home = home {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 20) {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 10) {
                                    ForEach(storefronts, id: \.slug) { sf in
                                        NavigationLink(destination: StorefrontNativeView(slug: sf.slug, title: sf.title)) {
                                            HStack(spacing: 6) {
                                                Image(systemName: sf.icon)
                                                Text(sf.title).fontWeight(.medium)
                                            }
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 10)
                                            .background(Color.red.opacity(0.85))
                                            .foregroundColor(.white)
                                            .cornerRadius(20)
                                        }
                                    }
                                }
                                .padding(.horizontal)
                            }

                            ForEach(home.sections ?? []) { section in
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(section.title)
                                        .font(.headline)
                                        .padding(.horizontal)
                                    ScrollView(.horizontal, showsIndicators: false) {
                                        HStack(spacing: 10) {
                                            ForEach(section.items.prefix(20)) { item in
                                                ContentNavLink(item: item) {
                                                    PosterCard(item: item, width: 110)
                                                }
                                            }
                                        }
                                        .padding(.horizontal)
                                    }
                                }
                            }
                        }
                        .padding(.vertical)
                    }
                } else {
                    Text(errorMessage.isEmpty ? "Sin contenido" : errorMessage)
                        .foregroundColor(.secondary)
                }
            }
            .navigationBarTitle("Inicio", displayMode: .large)
            .onAppear(perform: load)
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }

    private func load() {
        loading = true
        Task {
            do {
                let h = try await session.api.catalogHome()
                await MainActor.run {
                    home = h
                    loading = false
                }
            } catch let err {
                await MainActor.run {
                    errorMessage = err.localizedDescription
                    loading = false
                }
            }
        }
    }
}

struct PosterCard: View {
    let item: CatalogPoster
    var width: CGFloat = 110

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            AsyncImage(url: PlayUrls.poster(item.poster)) { phase in
                switch phase {
                case .success(let img):
                    img.resizable().aspectRatio(2/3, contentMode: .fill)
                default:
                    Rectangle().fill(Color.gray.opacity(0.3))
                        .overlay(Image(systemName: item.isSeries ? "tv" : "film").foregroundColor(.gray))
                }
            }
            .frame(width: width, height: width * 1.5)
            .clipped()
            .cornerRadius(6)
            Text(item.title)
                .font(.caption)
                .lineLimit(2)
                .frame(width: width, alignment: .leading)
        }
    }
}

// MARK: - Live TV

struct LiveNativeView: View {
    @ObservedObject private var session = AuthSession.shared
    @StateObject private var playerCtrl = VixPlayerController()
    @State private var categories: [LiveCategory] = []
    @State private var channels: [LiveChannel] = []
    @State private var selectedGroup = "all"
    @State private var loading = true
    @State private var errorMessage = ""
    @State private var playingChannel: LiveChannel?
    @State private var showPlayer = false
    @State private var showFullscreen = false

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                if showPlayer, let ch = playingChannel, let p = playerCtrl.player {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(ch.name).font(.headline)
                            Spacer()
                            Button("Pantalla completa") { showFullscreen = true }
                                .font(.subheadline)
                            Button("Cerrar") {
                                playerCtrl.stop()
                                showPlayer = false
                                playingChannel = nil
                            }
                            .font(.subheadline)
                        }
                        .padding(.horizontal)
                        NativePlayerInline(player: p)
                            .frame(height: 220)
                            .background(Color.black)
                    }
                }

                if !categories.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            CategoryChip(title: "Todos", selected: selectedGroup == "all") {
                                selectGroup("all")
                            }
                            ForEach(categories) { cat in
                                CategoryChip(title: cat.name, selected: selectedGroup == cat.name) {
                                    selectGroup(cat.name)
                                }
                            }
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                    }
                }

                Group {
                    if loading {
                        Spacer()
                        ProgressView("Cargando canales…")
                        Spacer()
                    } else if channels.isEmpty {
                        Spacer()
                        Text(errorMessage.isEmpty ? "Sin canales" : errorMessage).foregroundColor(.secondary)
                        Spacer()
                    } else {
                        List(channels) { ch in
                            Button(action: { playChannel(ch) }) {
                                HStack(spacing: 12) {
                                    AsyncImage(url: PlayUrls.poster(ch.logo)) { phase in
                                        if case .success(let img) = phase {
                                            img.resizable().aspectRatio(contentMode: .fit)
                                        } else {
                                            Color.gray.opacity(0.2)
                                        }
                                    }
                                    .frame(width: 48, height: 48)
                                    .cornerRadius(6)
                                    Text(ch.name)
                                        .foregroundColor(.primary)
                                    Spacer()
                                    if playingChannel?.id == ch.id {
                                        Image(systemName: "speaker.wave.2.fill").foregroundColor(.red)
                                    }
                                }
                            }
                        }
                        .listStyle(PlainListStyle())
                    }
                }
            }
            .navigationBarTitle("TV en vivo", displayMode: .large)
            .onAppear { loadInitial() }
            .fullScreenCover(isPresented: $showFullscreen) {
                if let p = playerCtrl.player {
                    FullscreenPlayerWrapper(player: p) {
                        showFullscreen = false
                    }
                }
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }

    private func loadInitial() {
        loading = true
        Task {
            do {
                async let cats = session.api.liveCategories()
                async let chs = session.api.liveChannels(group: nil)
                let (c, ch) = try await (cats, chs)
                await MainActor.run {
                    categories = c
                    channels = ch
                    loading = false
                }
            } catch let err {
                await MainActor.run {
                    errorMessage = err.localizedDescription
                    loading = false
                }
            }
        }
    }

    private func selectGroup(_ group: String) {
        selectedGroup = group
        loading = true
        Task {
            do {
                let g = group == "all" ? nil : group
                let ch = try await session.api.liveChannels(group: g)
                await MainActor.run {
                    channels = ch
                    loading = false
                }
            } catch let err {
                await MainActor.run {
                    errorMessage = err.localizedDescription
                    loading = false
                }
            }
        }
    }

    private func playChannel(_ ch: LiveChannel) {
        guard let url = PlayUrls.livePlayback(server: VixConfig.serverURL, token: session.api.token, channel: ch) else { return }
        playingChannel = ch
        playerCtrl.play(url: url)
        showPlayer = true
    }
}

struct CategoryChip: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(selected ? Color.red : Color.gray.opacity(0.25))
                .foregroundColor(selected ? .white : .primary)
                .cornerRadius(20)
        }
    }
}

struct NativePlayerInline: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        vc.showsPlaybackControls = true
        vc.allowsPictureInPicturePlayback = true
        return vc
    }

    func updateUIViewController(_ uiViewController: AVPlayerViewController, context: Context) {
        uiViewController.player = player
    }
}

// MARK: - Settings

struct SettingsNativeView: View {
    @ObservedObject private var session = AuthSession.shared
    @State private var server = VixConfig.serverURL
    @State private var showProfilePicker = false
    @State private var showChangePassword = false

    var body: some View {
        NavigationView {
            Form {
                if let profile = session.currentProfile {
                    Section(header: Text("Perfil activo")) {
                        HStack {
                            Circle()
                                .fill(Color(hex: profile.avatar_color) ?? .red)
                                .frame(width: 36, height: 36)
                                .overlay(
                                    Text(String(profile.name.prefix(1)).uppercased())
                                        .foregroundColor(.white)
                                )
                            Text(profile.name)
                            if profile.is_kids {
                                Spacer()
                                Text("Kids").font(.caption).foregroundColor(.orange)
                            }
                        }
                        Button("Cambiar perfil") { showProfilePicker = true }
                    }
                }

                Section(header: Text("Cuenta")) {
                    Button("Cambiar contraseña") { showChangePassword = true }
                }

                Section(header: Text("Servidor")) {
                    TextField("URL", text: $server)
                        .autocapitalization(.none)
                    Button("Guardar") { VixConfig.saveServer(server) }
                }

                Section {
                    Button("Cerrar sesión") { session.logout() }
                        .foregroundColor(.red)
                }

                Section(header: Text("Info")) {
                    HStack {
                        Text("Reproductor")
                        Spacer()
                        Text("AVPlayer nativo").foregroundColor(.secondary)
                    }
                    HStack {
                        Text("Versión")
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationBarTitle("Cuenta", displayMode: .large)
            .sheet(isPresented: $showProfilePicker) {
                ProfilePickerView(session: session, switching: true)
            }
            .sheet(isPresented: $showChangePassword) {
                ChangePasswordView()
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }
}

struct ChangePasswordView: View {
    @Environment(\.presentationMode) private var presentationMode
    @State private var current = ""
    @State private var newPassword = ""
    @State private var confirm = ""
    @State private var error = ""
    @State private var saving = false

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Contraseña actual")) {
                    SecureField("Actual", text: $current)
                }
                Section(header: Text("Nueva contraseña")) {
                    SecureField("Nueva", text: $newPassword)
                    SecureField("Confirmar", text: $confirm)
                }
                if !error.isEmpty {
                    Section {
                        Text(error).foregroundColor(.red)
                    }
                }
                Section {
                    Button(saving ? "Guardando…" : "Guardar") {
                        Task { await save() }
                    }
                    .disabled(saving)
                }
            }
            .navigationBarTitle("Cambiar contraseña", displayMode: .inline)
            .navigationBarItems(leading: Button("Cancelar") {
                presentationMode.wrappedValue.dismiss()
            })
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }

    private func save() async {
        error = ""
        guard !current.isEmpty, !newPassword.isEmpty, !confirm.isEmpty else {
            error = "Completa todos los campos"
            return
        }
        guard newPassword == confirm else {
            error = "Las contraseñas nuevas no coinciden"
            return
        }
        guard newPassword.count >= 4 else {
            error = "Mínimo 4 caracteres"
            return
        }
        saving = true
        defer { saving = false }
        do {
            try await AuthSession.shared.api.changePassword(current: current, new: newPassword)
            presentationMode.wrappedValue.dismiss()
        } catch let err {
            error = err.localizedDescription
        }
    }
}
