import UIKit
import SwiftUI

/// Punto de entrada UIKit (storyboard) — mismo arranque que la app WebView que abría en iPad.
final class NativeHostViewController: UIViewController {
    private var hostingController: UIHostingController<AnyView>?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        mountSwiftUI()
    }

    private func mountSwiftUI() {
        let root = AnyView(NativeRootView().preferredColorScheme(.dark))
        let host = UIHostingController(rootView: root)
        host.view.backgroundColor = .black
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        host.didMove(toParent: self)
        hostingController = host
    }
}
