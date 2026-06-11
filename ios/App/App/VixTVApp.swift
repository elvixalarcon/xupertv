import SwiftUI

@main
struct VixTVApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            NativeRootView()
                .preferredColorScheme(.dark)
        }
    }
}
