import UIKit
import Capacitor

class BridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = self.webView else { return }
        webView.isOpaque = true
        webView.backgroundColor = UIColor.black
        webView.scrollView.backgroundColor = UIColor.black
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
    }
}
