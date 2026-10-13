import UIKit
import SwiftUI

/// Covers the actual UIKit window *synchronously* during scene deactivation.
///
/// SwiftUI's scenePhase overlay remains as a second layer of defense. Relying
/// only on scenePhase can race with iOS's app-switcher snapshot: the snapshot
/// may be taken before SwiftUI has committed the new view hierarchy.
@MainActor
final class ALIGNPrivacyShield: NSObject, ObservableObject {
    private let shieldTag = 78_036_411
    private var observing = false

    func activate() {
        guard !observing else { return }
        observing = true
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(sceneWillDeactivate(_:)),
                           name: UIScene.willDeactivateNotification, object: nil)
        center.addObserver(self, selector: #selector(sceneDidActivate(_:)),
                           name: UIScene.didActivateNotification, object: nil)
        center.addObserver(self, selector: #selector(appWillResignActive(_:)),
                           name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(appDidBecomeActive(_:)),
                           name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func sceneWillDeactivate(_ notification: Notification) {
        protect(scene: notification.object as? UIWindowScene)
    }

    @objc private func sceneDidActivate(_ notification: Notification) {
        reveal(scene: notification.object as? UIWindowScene)
    }

    @objc private func appWillResignActive(_ notification: Notification) {
        protect(scene: nil)
    }

    @objc private func appDidBecomeActive(_ notification: Notification) {
        reveal(scene: nil)
    }

    /// UIKit subview insertion is synchronous on the main thread, unlike a
    /// SwiftUI @State redraw. The overlay must be in place before suspension.
    private func protect(scene: UIWindowScene?) {
        let scenes = scene.map { [$0] }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for windowScene in scenes {
            for window in windowScene.windows where !window.isHidden {
                guard window.viewWithTag(shieldTag) == nil else { continue }
                let cover = UIView(frame: window.bounds)
                cover.tag = shieldTag
                cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                cover.backgroundColor = UIColor(red: 9.0 / 255.0,
                                                green: 13.0 / 255.0,
                                                blue: 19.0 / 255.0,
                                                alpha: 1.0)
                cover.isUserInteractionEnabled = false
                cover.accessibilityIdentifier = "align.privacy.shield"

                let wordmark = UILabel()
                wordmark.text = "ALIGN"
                wordmark.font = .systemFont(ofSize: 39, weight: .light)
                wordmark.textColor = UIColor(red: 244.0 / 255.0,
                                             green: 241.0 / 255.0,
                                             blue: 235.0 / 255.0,
                                             alpha: 1.0)
                wordmark.textAlignment = .center
                wordmark.translatesAutoresizingMaskIntoConstraints = false
                cover.addSubview(wordmark)
                NSLayoutConstraint.activate([
                    wordmark.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
                    wordmark.centerYAnchor.constraint(equalTo: cover.centerYAnchor)
                ])

                window.addSubview(cover)
                window.bringSubviewToFront(cover)
            }
        }
    }

    private func reveal(scene: UIWindowScene?) {
        let scenes = scene.map { [$0] }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for windowScene in scenes {
            for window in windowScene.windows {
                window.viewWithTag(shieldTag)?.removeFromSuperview()
            }
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}
