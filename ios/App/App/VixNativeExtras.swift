import SwiftUI
import AVKit

// MARK: - Profile picker

struct ProfilePickerView: View {
    @ObservedObject var session: AuthSession
    var switching: Bool = false
    @Environment(\.presentationMode) var presentationMode
    @State private var profiles: [UserProfile] = []
    @State private var loading = true
    @State private var errorMessage = ""
    @State private var pinProfile: UserProfile?
    @State private var pin = ""
    @State private var pinError = ""

    var body: some View {
        VStack(spacing: 24) {
            Text(switching ? "Cambiar perfil" : "¿Quién ve Vix TV?")
                .font(.title.bold())
            if loading {
                ProgressView()
            } else if profiles.isEmpty {
                Text(errorMessage.isEmpty ? "Sin perfiles" : errorMessage)
                    .foregroundColor(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 20) {
                    ForEach(profiles) { profile in
                        Button(action: { pick(profile) }) {
                            VStack(spacing: 8) {
                                Circle()
                                    .fill(Color(hex: profile.avatar_color) ?? .red)
                                    .frame(width: 72, height: 72)
                                    .overlay(
                                        Text(String(profile.name.prefix(1)).uppercased())
                                            .font(.title.bold())
                                            .foregroundColor(.white)
                                    )
                                Text(profile.name)
                                    .font(.subheadline)
                                    .foregroundColor(.primary)
                                if profile.is_kids {
                                    Text("Kids").font(.caption2).foregroundColor(.orange)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal)
            }
            if switching {
                Button("Cancelar") { presentationMode.wrappedValue.dismiss() }
                    .foregroundColor(.secondary)
            }
        }
        .padding(24)
        .background(Color.black.edgesIgnoringSafeArea(.all))
        .onAppear(perform: load)
        .sheet(item: $pinProfile) { profile in
            PinEntrySheet(profileName: profile.name, pin: $pin, error: $pinError) {
                confirmPin(profile)
            }
        }
    }

    private func load() {
        loading = true
        let list = session.profiles
        if !list.isEmpty && !switching {
            profiles = list
            loading = false
            return
        }
        Task {
            do {
                let p = try await session.api.listProfiles()
                await MainActor.run {
                    profiles = p
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

    private func pick(_ profile: UserProfile) {
        pinError = ""
        if session.currentProfile?.is_kids == true && !profile.is_kids {
            pinProfile = profile
            pin = ""
            return
        }
        select(profile, pin: nil)
    }

    private func confirmPin(_ profile: UserProfile) {
        select(profile, pin: pin)
    }

    private func select(_ profile: UserProfile, pin: String?) {
        Task {
            do {
                try await session.selectProfile(profileId: profile.id, pin: pin)
                await MainActor.run {
                    pinProfile = nil
                    if switching { presentationMode.wrappedValue.dismiss() }
                }
            } catch let err as VixAPIError {
                await MainActor.run {
                    if case .needsPin = err {
                        pinError = err.localizedDescription
                        pinProfile = profile
                    } else {
                        errorMessage = err.localizedDescription
                    }
                }
            } catch let err {
                await MainActor.run { errorMessage = err.localizedDescription }
            }
        }
    }
}

struct PinEntrySheet: View {
    let profileName: String
    @Binding var pin: String
    @Binding var error: String
    let onConfirm: () -> Void
    @Environment(\.presentationMode) var presentationMode

    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                Text("PIN del perfil infantil")
                    .font(.headline)
                Text("Para entrar a \(profileName) necesitas el PIN de 4 dígitos.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                SecureField("PIN", text: $pin)
                    .keyboardType(.numberPad)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .frame(maxWidth: 200)
                if !error.isEmpty {
                    Text(error).font(.footnote).foregroundColor(.red)
                }
                Button("Confirmar", action: onConfirm)
                    .disabled(pin.count < 4)
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
            }
            .padding()
            .navigationBarTitle("PIN", displayMode: .inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { presentationMode.wrappedValue.dismiss() }
                }
            }
        }
    }
}

// MARK: - Storefront

struct StorefrontNativeView: View {
    let slug: String
    let title: String
    @ObservedObject private var session = AuthSession.shared
    @State private var page: StorefrontPage?
    @State private var loading = true

    var body: some View {
        Group {
            if loading {
                ProgressView()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if let hero = page?.hero, !hero.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 12) {
                                    ForEach(hero.prefix(10)) { item in
                                        ContentNavLink(item: item) {
                                            PosterCard(item: item, width: 130)
                                        }
                                    }
                                }
                                .padding(.horizontal)
                            }
                        }
                        ForEach(page?.sections ?? []) { section in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(section.title).font(.headline).padding(.horizontal)
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
            }
        }
        .navigationBarTitle(title, displayMode: .large)
        .onAppear(perform: load)
    }

    private func load() {
        Task {
            do {
                let p = try await session.api.storefront(slug: slug)
                await MainActor.run {
                    page = p
                    loading = false
                }
            } catch {
                await MainActor.run { loading = false }
            }
        }
    }
}

// MARK: - Search

struct SearchNativeView: View {
    @ObservedObject private var session = AuthSession.shared
    @State private var query = ""
    @State private var result: SearchResponse?
    @State private var loading = false

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                HStack {
                    Image(systemName: "magnifyingglass").foregroundColor(.secondary)
                    TextField("Películas, series, canales…", text: $query, onCommit: search)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                    if !query.isEmpty {
                        Button(action: { query = ""; result = nil }) {
                            Image(systemName: "xmark.circle.fill").foregroundColor(.secondary)
                        }
                    }
                    Button("Buscar", action: search)
                        .font(.subheadline.bold())
                        .foregroundColor(.red)
                        .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
                }
                .padding(10)
                .background(Color.gray.opacity(0.15))
                .cornerRadius(10)
                .padding()

                if loading {
                    Spacer()
                    ProgressView("Buscando…")
                    Spacer()
                } else if let r = result {
                    List {
                        if let movies = r.movies, !movies.isEmpty {
                            Section(header: Text("Películas (\(movies.count))")) {
                                ForEach(movies) { item in
                                    NavigationLink(destination: MovieDetailView(movieId: item.id)) {
                                        SearchRow(title: item.title, poster: item.poster)
                                    }
                                }
                            }
                        }
                        if let series = r.series, !series.isEmpty {
                            Section(header: Text("Series (\(series.count))")) {
                                ForEach(series) { item in
                                    NavigationLink(destination: SeriesDetailView(seriesId: item.id)) {
                                        SearchRow(title: item.title, poster: item.poster)
                                    }
                                }
                            }
                        }
                        if let live = r.live, !live.isEmpty {
                            Section(header: Text("TV en vivo (\(live.count))")) {
                                ForEach(live) { ch in
                                    HStack {
                                        AsyncImage(url: PlayUrls.poster(ch.logo)) { ph in
                                            if case .success(let img) = ph {
                                                img.resizable().aspectRatio(contentMode: .fit)
                                            } else { Color.gray.opacity(0.2) }
                                        }
                                        .frame(width: 40, height: 40)
                                        .cornerRadius(4)
                                        Text(ch.name)
                                    }
                                }
                            }
                        }
                        if (r.total ?? 0) == 0 {
                            Text("Sin resultados para «\(r.query ?? query)»")
                                .foregroundColor(.secondary)
                        }
                    }
                    .listStyle(PlainListStyle())
                } else {
                    Spacer()
                    Text("Escribe al menos 2 caracteres")
                        .foregroundColor(.secondary)
                    Spacer()
                }
            }
            .navigationBarTitle("Buscar", displayMode: .large)
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }

    private func search() {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2 else { return }
        loading = true
        Task {
            do {
                let r = try await session.api.search(query: q)
                await MainActor.run {
                    result = r
                    loading = false
                }
            } catch {
                await MainActor.run { loading = false }
            }
        }
    }
}

struct SearchRow: View {
    let title: String
    let poster: String?

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: PlayUrls.poster(poster)) { ph in
                if case .success(let img) = ph {
                    img.resizable().aspectRatio(2/3, contentMode: .fill)
                } else {
                    Color.gray.opacity(0.2)
                }
            }
            .frame(width: 44, height: 66)
            .clipped()
            .cornerRadius(4)
            Text(title)
        }
    }
}

// MARK: - Library (favorites + history)

struct LibraryNativeView: View {
    @ObservedObject private var session = AuthSession.shared
    @State private var tab = 0
    @State private var favorites: [LibraryItem] = []
    @State private var history: [WatchItem] = []
    @State private var cont: [WatchItem] = []
    @State private var loading = true

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                Picker("", selection: $tab) {
                    Text("Favoritos").tag(0)
                    Text("Historial").tag(1)
                    Text("Continuar").tag(2)
                }
                .pickerStyle(SegmentedPickerStyle())
                .padding()

                if loading {
                    Spacer()
                    ProgressView()
                    Spacer()
                } else {
                    List {
                        if tab == 0 {
                            if favorites.isEmpty {
                                Text("Sin favoritos").foregroundColor(.secondary)
                            } else {
                                ForEach(favorites) { item in
                                    libraryLink(item)
                                }
                            }
                        } else if tab == 1 {
                            if history.isEmpty {
                                Text("Sin historial").foregroundColor(.secondary)
                            } else {
                                ForEach(history) { item in
                                    watchLink(item)
                                }
                            }
                        } else {
                            if cont.isEmpty {
                                Text("Nada pendiente").foregroundColor(.secondary)
                            } else {
                                ForEach(cont) { item in
                                    watchLink(item)
                                }
                            }
                        }
                    }
                    .listStyle(PlainListStyle())
                }
            }
            .navigationBarTitle("Mi lista", displayMode: .large)
            .onAppear(perform: load)
            .onChange(of: tab) { _ in }
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }

    @ViewBuilder
    private func libraryLink(_ item: LibraryItem) -> some View {
        if item.isSeries {
            NavigationLink(destination: SeriesDetailView(seriesId: item.id)) {
                SearchRow(title: item.title, poster: item.poster)
            }
        } else {
            NavigationLink(destination: MovieDetailView(movieId: item.id)) {
                SearchRow(title: item.title, poster: item.poster)
            }
        }
    }

    @ViewBuilder
    private func watchLink(_ item: WatchItem) -> some View {
        if item.content_type == "episode", let sid = item.series_id {
            NavigationLink(destination: SeriesDetailView(seriesId: sid, episodeId: item.content_id)) {
                VStack(alignment: .leading, spacing: 4) {
                    SearchRow(title: item.displayTitle, poster: item.poster)
                    if let label = item.progress_label {
                        Text(label).font(.caption).foregroundColor(.secondary)
                    }
                }
            }
        } else {
            NavigationLink(destination: MovieDetailView(movieId: item.content_id, startAt: item.progress ?? 0)) {
                VStack(alignment: .leading, spacing: 4) {
                    SearchRow(title: item.displayTitle, poster: item.poster)
                    if let label = item.progress_label {
                        Text(label).font(.caption).foregroundColor(.secondary)
                    }
                }
            }
        }
    }

    private func load() {
        loading = true
        Task {
            do {
                async let fav = session.api.favorites()
                async let hist = session.api.watchHistory()
                async let contItems = session.api.watchContinue()
                let (f, h, c) = try await (fav, hist, contItems)
                await MainActor.run {
                    favorites = f
                    history = h
                    cont = c
                    loading = false
                }
            } catch {
                await MainActor.run { loading = false }
            }
        }
    }
}

// MARK: - Movie detail

struct MovieDetailView: View {
    let movieId: Int
    var startAt: Double = 0
    @ObservedObject private var session = AuthSession.shared
    @StateObject private var playerCtrl = VixPlayerController()
    @State private var detail: MovieDetail?
    @State private var liked = false
    @State private var loading = true
    @State private var showPlayer = false
    @State private var errorMessage = ""

    var body: some View {
        ScrollView {
            if loading {
                ProgressView().padding(.top, 80)
            } else if let d = detail {
                VStack(alignment: .leading, spacing: 16) {
                    AsyncImage(url: PlayUrls.poster(d.backdrop ?? d.poster)) { ph in
                        if case .success(let img) = ph {
                            img.resizable().aspectRatio(16/9, contentMode: .fill)
                        } else {
                            Rectangle().fill(Color.gray.opacity(0.3)).aspectRatio(16/9, contentMode: .fit)
                        }
                    }
                    .clipped()

                    VStack(alignment: .leading, spacing: 8) {
                        Text(d.title).font(.title2.bold())
                        HStack {
                            if let r = d.rating, r > 0 {
                                Label(String(format: "%.1f", r), systemImage: "star.fill")
                                    .font(.caption).foregroundColor(.yellow)
                            }
                            if let rt = d.runtime, rt > 0 {
                                Text("\(rt) min").font(.caption).foregroundColor(.secondary)
                            }
                        }
                        if let syn = d.synopsis, !syn.isEmpty {
                            Text(syn).font(.body).foregroundColor(.secondary)
                        }
                    }
                    .padding(.horizontal)

                    HStack(spacing: 12) {
                        Button(action: playMovie) {
                            Label("Reproducir", systemImage: "play.fill")
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.red)
                                .foregroundColor(.white)
                                .cornerRadius(8)
                        }
                        Button(action: toggleLike) {
                            Image(systemName: liked ? "heart.fill" : "heart")
                                .font(.title2)
                                .foregroundColor(liked ? .red : .primary)
                                .padding()
                                .background(Color.gray.opacity(0.2))
                                .cornerRadius(8)
                        }
                    }
                    .padding(.horizontal)

                    if showPlayer, let p = playerCtrl.player {
                        NativePlayerInline(player: p)
                            .frame(height: 220)
                            .padding(.horizontal)
                    }

                    if let sim = d.similar, !sim.isEmpty {
                        Text("Similares").font(.headline).padding(.horizontal)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(sim.prefix(12)) { item in
                                    ContentNavLink(item: item) {
                                        PosterCard(item: item, width: 100)
                                    }
                                }
                            }
                            .padding(.horizontal)
                        }
                    }
                }
            } else {
                Text(errorMessage).foregroundColor(.secondary).padding()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: load)
        .onDisappear { playerCtrl.stop() }
        .fullScreenCover(isPresented: Binding(
            get: { showPlayer && playerCtrl.player != nil },
            set: { if !$0 { showPlayer = false } }
        )) {
            if let p = playerCtrl.player {
                NativePlayerScreen(player: p)
                    .ignoresSafeArea()
                    .overlay(alignment: .topTrailing) {
                        Button("Cerrar") { showPlayer = false }
                            .padding().foregroundColor(.white)
                    }
            }
        }
    }

    private func load() {
        Task {
            do {
                async let det = session.api.movieDetail(id: movieId)
                async let st = session.api.libraryStatus(type: "movie", id: movieId)
                let (d, status) = try await (det, st)
                await MainActor.run {
                    detail = d
                    liked = status.liked
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

    private func playMovie() {
        guard let path = detail?.video_path, !path.isEmpty,
              let url = PlayUrls.video(server: VixConfig.serverURL, token: session.api.token, path: path) else { return }
        playerCtrl.onProgress = { prog, dur in
            Task {
                try? await session.api.saveWatchProgress(
                    contentType: "movie", contentId: movieId, seriesId: nil,
                    progress: prog, duration: dur
                )
            }
        }
        playerCtrl.play(url: url, startAt: startAt)
        showPlayer = true
    }

    private func toggleLike() {
        Task {
            if let active = try? await session.api.toggleLike(contentType: "movie", contentId: movieId) {
                await MainActor.run { liked = active }
            }
        }
    }
}

// MARK: - Series detail

struct SeriesDetailView: View {
    let seriesId: Int
    var episodeId: Int?
    @ObservedObject private var session = AuthSession.shared
    @StateObject private var playerCtrl = VixPlayerController()
    @State private var detail: SeriesDetail?
    @State private var liked = false
    @State private var loading = true
    @State private var selectedSeason = 1
    @State private var playingEp: SeriesEpisode?
    @State private var showPlayer = false

    private var seasons: [Int] {
        Array(Set((detail?.episodes ?? []).map(\.season))).sorted()
    }

    private var filteredEps: [SeriesEpisode] {
        (detail?.episodes ?? []).filter { $0.season == selectedSeason }
    }

    var body: some View {
        ScrollView {
            if loading {
                ProgressView().padding(.top, 80)
            } else if let d = detail {
                VStack(alignment: .leading, spacing: 16) {
                    AsyncImage(url: PlayUrls.poster(d.backdrop ?? d.poster)) { ph in
                        if case .success(let img) = ph {
                            img.resizable().aspectRatio(16/9, contentMode: .fill)
                        } else {
                            Rectangle().fill(Color.gray.opacity(0.3)).aspectRatio(16/9, contentMode: .fit)
                        }
                    }
                    .clipped()

                    HStack {
                        Text(d.title).font(.title2.bold())
                        Spacer()
                        Button(action: toggleLike) {
                            Image(systemName: liked ? "heart.fill" : "heart")
                                .foregroundColor(liked ? .red : .primary)
                        }
                    }
                    .padding(.horizontal)

                    if let syn = d.synopsis, !syn.isEmpty {
                        Text(syn).font(.body).foregroundColor(.secondary).padding(.horizontal)
                    }

                    if seasons.count > 1 {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(seasons, id: \.self) { s in
                                    CategoryChip(title: "T\(s)", selected: selectedSeason == s) {
                                        selectedSeason = s
                                    }
                                }
                            }
                            .padding(.horizontal)
                        }
                    }

                    if showPlayer, let p = playerCtrl.player {
                        VStack(alignment: .leading) {
                            if let ep = playingEp {
                                Text("T\(ep.season)E\(ep.episode) · \(ep.title ?? "")")
                                    .font(.subheadline).padding(.horizontal)
                            }
                            NativePlayerInline(player: p)
                                .frame(height: 220)
                                .padding(.horizontal)
                        }
                    }

                    if let sim = d.similar, !sim.isEmpty {
                        Text("Similares").font(.headline).padding(.horizontal)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(sim.prefix(12)) { item in
                                    NavigationLink(destination: SeriesDetailView(seriesId: item.id)) {
                                        PosterCard(item: item, width: 100)
                                    }
                                }
                            }
                            .padding(.horizontal)
                        }
                    }

                    ForEach(filteredEps) { ep in
                        Button(action: { playEpisode(ep) }) {
                            HStack {
                                Text("E\(ep.episode)")
                                    .font(.caption.bold())
                                    .frame(width: 36)
                                Text(ep.title ?? "Episodio \(ep.episode)")
                                    .foregroundColor(.primary)
                                Spacer()
                                if playingEp?.id == ep.id {
                                    Image(systemName: "speaker.wave.2.fill").foregroundColor(.red)
                                }
                            }
                            .padding(.horizontal)
                            .padding(.vertical, 8)
                        }
                    }
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: load)
        .onDisappear { playerCtrl.stop() }
        .fullScreenCover(isPresented: Binding(
            get: { showPlayer && playerCtrl.player != nil },
            set: { if !$0 { showPlayer = false } }
        )) {
            if let p = playerCtrl.player {
                NativePlayerScreen(player: p)
                    .ignoresSafeArea()
                    .overlay(alignment: .topTrailing) {
                        Button("Cerrar") { showPlayer = false }
                            .padding().foregroundColor(.white)
                    }
            }
        }
    }

    private func load() {
        Task {
            do {
                async let det = session.api.seriesDetail(id: seriesId)
                async let st = session.api.libraryStatus(type: "series", id: seriesId)
                let (d, status) = try await (det, st)
                await MainActor.run {
                    detail = d
                    liked = status.liked
                    if let s = d.episodes.map(\.season).min() { selectedSeason = s }
                    if let eid = episodeId, let ep = d.episodes.first(where: { $0.id == eid }) {
                        selectedSeason = ep.season
                        playEpisode(ep)
                    }
                    loading = false
                }
            } catch {
                await MainActor.run { loading = false }
            }
        }
    }

    private func playEpisode(_ ep: SeriesEpisode) {
        guard let path = ep.video_path, !path.isEmpty,
              let url = PlayUrls.video(server: VixConfig.serverURL, token: session.api.token, path: path) else { return }
        playingEp = ep
        playerCtrl.onProgress = { prog, dur in
            Task {
                try? await session.api.saveWatchProgress(
                    contentType: "episode", contentId: ep.id, seriesId: seriesId,
                    progress: prog, duration: dur
                )
            }
        }
        playerCtrl.play(url: url)
        showPlayer = true
    }

    private func toggleLike() {
        Task {
            if let active = try? await session.api.toggleLike(contentType: "series", contentId: seriesId) {
                await MainActor.run { liked = active }
            }
        }
    }
}

// MARK: - Navigation helpers

struct ContentNavLink<Content: View>: View {
    let item: CatalogPoster
    @ViewBuilder let content: () -> Content

    var body: some View {
        if item.isSeries {
            NavigationLink(destination: SeriesDetailView(seriesId: item.id), label: content)
        } else {
            NavigationLink(destination: MovieDetailView(movieId: item.id), label: content)
        }
    }
}

extension Color {
    init?(hex: String?) {
        guard var h = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !h.isEmpty else { return nil }
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6, let val = UInt64(h, radix: 16) else { return nil }
        let r = Double((val >> 16) & 0xFF) / 255
        let g = Double((val >> 8) & 0xFF) / 255
        let b = Double(val & 0xFF) / 255
        self = Color(red: r, green: g, blue: b)
    }
}
