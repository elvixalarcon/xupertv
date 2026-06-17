import Foundation
import Capacitor
import AVFoundation
import MediaPlayer

@objc(BackgroundAudioPlugin)
public class BackgroundAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackgroundAudioPlugin"
    public let jsName = "BackgroundAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPlaying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPlaybackStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
    ]

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var statusObserver: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var failObserver: NSObjectProtocol?
    private var title = "VixMusic"
    private var artist = ""
    private var imageUrl = ""
    private var volume: Float = 1.0
    private var remoteCommandsConfigured = false

    override public func load() {
        configureAudioSession()
        setupRemoteCommands()
    }

    deinit {
        cleanupPlayer()
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.allowAirPlay, .allowBluetooth, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch {
            NSLog("BackgroundAudio audio session: \(error.localizedDescription)")
        }
    }

    private func setupRemoteCommands() {
        guard !remoteCommandsConfigured else { return }
        remoteCommandsConfigured = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true

        center.playCommand.addTarget { [weak self] _ in
            self?.player?.play()
            self?.emitPlayback(type: "playing")
            self?.notifyMediaAction("play")
            self?.updateNowPlayingInfo()
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            self?.player?.pause()
            self?.emitPlayback(type: "paused")
            self?.notifyMediaAction("pause")
            self?.updateNowPlayingInfo()
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.notifyMediaAction("next")
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.notifyMediaAction("prev")
            return .success
        }
    }

    private func notifyMediaAction(_ action: String) {
        notifyListeners("mediaAction", data: ["action": action])
    }

    private func emitPlayback(type: String) {
        let position = currentPositionSeconds()
        let duration = currentDurationSeconds()
        notifyListeners("playbackEvent", data: [
            "type": type,
            "position": position,
            "duration": duration,
        ])
    }

    private func currentPositionSeconds() -> Double {
        guard let player = player else { return 0 }
        let t = player.currentTime()
        guard t.isNumeric else { return 0 }
        return max(0, CMTimeGetSeconds(t))
    }

    private func currentDurationSeconds() -> Double {
        guard let item = player?.currentItem else { return 0 }
        let d = item.duration
        guard d.isNumeric else { return 0 }
        let sec = CMTimeGetSeconds(d)
        return sec.isFinite && sec > 0 ? sec : 0
    }

    private func updateNowPlayingInfo() {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPNowPlayingInfoPropertyPlaybackRate: (player?.rate ?? 0) > 0 ? 1.0 : 0.0,
            MPMediaItemPropertyPlaybackDuration: currentDurationSeconds(),
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentPositionSeconds(),
        ]
        if let artwork = MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork] {
            info[MPMediaItemPropertyArtwork] = artwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func loadArtwork() {
        guard !imageUrl.isEmpty, let url = URL(string: imageUrl) else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data, let image = UIImage(data: data) else { return }
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }.resume()
    }

    private func cleanupPlayer() {
        if let timeObserver = timeObserver, let player = player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        statusObserver?.invalidate()
        statusObserver = nil
        if let endObserver = endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        endObserver = nil
        if let failObserver = failObserver {
            NotificationCenter.default.removeObserver(failObserver)
        }
        failObserver = nil
        player?.pause()
        player = nil
    }

    private func attachObservers(to item: AVPlayerItem) {
        statusObserver = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard let self = self else { return }
            switch item.status {
            case .readyToPlay:
                self.emitPlayback(type: "ready")
                self.emitPlayback(type: "playing")
                self.updateNowPlayingInfo()
            case .failed:
                self.emitPlayback(type: "error")
            default:
                break
            }
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            self?.emitPlayback(type: "ended")
        }

        failObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            self?.emitPlayback(type: "error")
        }

        timeObserver = player?.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 1, preferredTimescale: 1),
            queue: .main
        ) { [weak self] _ in
            guard let self = self, let player = self.player, player.rate > 0 else { return }
            self.emitPlayback(type: "playing")
            self.updateNowPlayingInfo()
        }
    }

    private func startPlayback(url: URL) {
        cleanupPlayer()
        configureAudioSession()
        let item = AVPlayerItem(url: url)
        player = AVPlayer(playerItem: item)
        player?.volume = volume
        attachObservers(to: item)
        updateNowPlayingInfo()
        loadArtwork()
        player?.play()
    }

    @objc func play(_ call: CAPPluginCall) {
        guard let playUrl = call.getString("playUrl"), !playUrl.isEmpty, let url = URL(string: playUrl) else {
            call.reject("playUrl requerido")
            return
        }
        title = call.getString("title") ?? "VixMusic"
        artist = call.getString("artist") ?? ""
        imageUrl = call.getString("imageUrl") ?? ""
        volume = Float(call.getDouble("volume") ?? 1.0)
        DispatchQueue.main.async {
            self.startPlayback(url: url)
            call.resolve()
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        title = call.getString("title") ?? "VixMusic"
        artist = call.getString("artist") ?? ""
        imageUrl = call.getString("imageUrl") ?? ""
        let playing = call.getBool("playing") ?? true
        DispatchQueue.main.async {
            if playing {
                self.player?.play()
                self.emitPlayback(type: "playing")
            } else {
                self.player?.pause()
                self.emitPlayback(type: "paused")
            }
            self.updateNowPlayingInfo()
            self.loadArtwork()
            call.resolve()
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        start(call)
    }

    @objc func setPlaying(_ call: CAPPluginCall) {
        let playing = call.getBool("playing") ?? true
        DispatchQueue.main.async {
            if playing {
                self.player?.play()
                self.emitPlayback(type: "playing")
            } else {
                self.player?.pause()
                self.emitPlayback(type: "paused")
            }
            self.updateNowPlayingInfo()
            call.resolve()
        }
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        volume = Float(call.getDouble("volume") ?? 1.0)
        DispatchQueue.main.async {
            self.player?.volume = self.volume
            call.resolve()
        }
    }

    @objc func seek(_ call: CAPPluginCall) {
        let seconds = call.getDouble("position") ?? 0
        DispatchQueue.main.async {
            self.player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
            self.updateNowPlayingInfo()
            call.resolve()
        }
    }

    @objc func getPlaybackStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let playing = (self.player?.rate ?? 0) > 0
            call.resolve([
                "playing": playing,
                "position": self.currentPositionSeconds(),
                "duration": self.currentDurationSeconds(),
            ])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.cleanupPlayer()
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            call.resolve()
        }
    }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        call.resolve()
    }
}
