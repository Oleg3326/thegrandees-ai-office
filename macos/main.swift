// TGTI AI Office for macOS.
// One small app does everything:
//   - draws the office as the desktop wallpaper (behind the desktop icons);
//   - on a MacBook with a notch, a panel with the office drops down when the mouse touches the notch;
//   - starts the office server (Node.js) and stops it when the app quits, so nothing is left running.
// Menu bar icon: switch the wallpaper and the notch panel, season, weather, sound, start at login, quit.
import Cocoa
import WebKit

let resDir = Bundle.main.resourceURL!
let supportDir = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/TGTI AI Office")
let agentPlist = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/LaunchAgents/com.thegrandees.aioffice.plist")
let port = 7777
let pageURL = URL(string: "http://127.0.0.1:\(port)/")!
let defaults = UserDefaults.standard

final class Panel: NSPanel {
    override var canBecomeKey: Bool { true }
}

final class App: NSObject, NSApplicationDelegate, WKNavigationDelegate, NSMenuDelegate {
    var server: Process?
    var serverIn: Pipe?
    var item: NSStatusItem!
    var wall: NSWindow?
    var wallWeb: WKWebView?
    var notch: Panel?
    var notchWeb: WKWebView?
    var notchShown = false
    var notchLeaveAt: Date?
    var hoverTimer: Timer?
    var selftest: String?

    var wallOn: Bool { get { defaults.object(forKey: "wallpaper") as? Bool ?? true } set { defaults.set(newValue, forKey: "wallpaper") } }
    var notchOn: Bool { get { defaults.object(forKey: "notch") as? Bool ?? true } set { defaults.set(newValue, forKey: "notch") } }

    func applicationDidFinishLaunching(_ n: Notification) {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--selftest"), i + 1 < args.count { selftest = args[i + 1] }
        startServer()
        buildMenu()
        applyModes()
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        if let out = selftest { runSelftest(out) }
    }

    func applicationWillTerminate(_ n: Notification) { stopServer() }

    // ---------- server ----------
    func nodePath() -> String? {
        let saved = supportDir.appendingPathComponent("node-path")
        var cands: [String] = []
        if let s = try? String(contentsOf: saved, encoding: .utf8) { cands.append(s.trimmingCharacters(in: .whitespacesAndNewlines)) }
        cands += [supportDir.appendingPathComponent("node/bin/node").path, "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        return cands.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    func startServer() {
        guard let node = nodePath() else { NSLog("AI Office: node not found"); return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [resDir.appendingPathComponent("office-server.mjs").path]
        p.currentDirectoryURL = resDir
        var env = ProcessInfo.processInfo.environment
        env["OFFICE_WITH_PARENT"] = "1"      // the server exits as soon as this app is gone (stdin closes)
        env["OFFICE_VERSION_FILE"] = supportDir.appendingPathComponent("version").path   // automatic updates
        p.environment = env
        let pin = Pipe()
        p.standardInput = pin
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do { try p.run(); server = p; serverIn = pin } catch { NSLog("AI Office: server failed: \(error)") }
    }

    func stopServer() {
        try? serverIn?.fileHandleForWriting.close()
        if let p = server, p.isRunning { p.terminate() }
    }

    // ---------- web views ----------
    func makeWeb() -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.mediaTypesRequiringUserActionForPlayback = []
        let w = WKWebView(frame: .zero, configuration: cfg)
        w.navigationDelegate = self
        w.setValue(false, forKey: "drawsBackground")
        w.load(URLRequest(url: pageURL))
        return w
    }

    // the server may need a second to start: retry the page until it answers
    func webView(_ w: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { w.load(URLRequest(url: pageURL)) }
    }
    func webView(_ w: WKWebView, didFail nav: WKNavigation!, withError e: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { w.load(URLRequest(url: pageURL)) }
    }
    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        if w === notchWeb { setPaused(w, !notchShown) }
    }

    func setPaused(_ w: WKWebView?, _ p: Bool) {
        w?.evaluateJavaScript("window.wallpaperPropertyListener && window.wallpaperPropertyListener.setPaused(\(p))", completionHandler: nil)
    }

    func everyWeb(_ js: String) {
        for w in [wallWeb, notchWeb] { w?.evaluateJavaScript(js, completionHandler: nil) }
    }

    // ---------- wallpaper ----------
    func showWall() {
        guard let screen = NSScreen.screens.first else { return }
        if wall == nil {
            let w = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
            w.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
            w.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
            w.ignoresMouseEvents = true
            w.isOpaque = true
            w.backgroundColor = .black
            w.hasShadow = false
            w.isReleasedWhenClosed = false
            let web = makeWeb()
            w.contentView = web
            wall = w; wallWeb = web
            NotificationCenter.default.addObserver(self, selector: #selector(wallOcclusion), name: NSWindow.didChangeOcclusionStateNotification, object: w)
        }
        wall!.setFrame(screen.frame, display: true)
        wall!.orderFront(nil)
    }

    func hideWall() {
        wall?.orderOut(nil)
        setPaused(wallWeb, true)
    }

    // covered by full-screen apps: stop drawing, saves the battery
    @objc func wallOcclusion() {
        guard let w = wall else { return }
        setPaused(wallWeb, !w.occlusionState.contains(.visible))
    }

    // ---------- notch panel ----------
    let panelSize = NSSize(width: 768, height: 432)

    func notchScreen() -> NSScreen? {
        if #available(macOS 12.0, *) {
            if let s = NSScreen.screens.first(where: { $0.safeAreaInsets.top > 0 }) { return s }
        }
        return NSScreen.screens.first
    }

    // the area that opens the panel: the notch itself (or the middle of the menu bar on a Mac without one)
    func hotZone() -> NSRect? {
        guard let s = notchScreen() else { return nil }
        let f = s.frame
        var w: CGFloat = 220, h: CGFloat = NSStatusBar.system.thickness
        if #available(macOS 12.0, *), s.safeAreaInsets.top > 0,
           let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea {
            w = f.width - l.width - r.width
            h = s.safeAreaInsets.top
        }
        return NSRect(x: f.midX - w / 2, y: f.maxY - h, width: w, height: h)
    }

    func panelFrame(shown: Bool) -> NSRect {
        let f = notchScreen()?.frame ?? .zero
        let y = shown ? f.maxY - panelSize.height : f.maxY + 4
        return NSRect(x: f.midX - panelSize.width / 2, y: y, width: panelSize.width, height: panelSize.height)
    }

    func setupNotch() {
        if notch == nil {
            let p = Panel(contentRect: panelFrame(shown: false), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            p.level = .statusBar
            p.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
            p.isOpaque = false
            p.backgroundColor = .clear
            p.hasShadow = true
            p.isReleasedWhenClosed = false
            p.hidesOnDeactivate = false
            let box = NSView(frame: NSRect(origin: .zero, size: panelSize))
            box.wantsLayer = true
            box.layer?.backgroundColor = NSColor.black.cgColor
            box.layer?.cornerRadius = 18
            box.layer?.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]   // rounded at the bottom, like the notch
            box.layer?.masksToBounds = true
            let web = makeWeb()
            web.frame = box.bounds
            web.autoresizingMask = [.width, .height]
            box.addSubview(web)
            p.contentView = box
            notch = p; notchWeb = web
        }
        notch!.setFrame(panelFrame(shown: false), display: false)
        notch!.alphaValue = 0
        notch!.orderFrontRegardless()
        notchShown = false
        hoverTimer?.invalidate()
        hoverTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.hoverTick() }
    }

    func hoverTick() {
        guard let zone = hotZone(), let p = notch else { return }
        let m = NSEvent.mouseLocation
        let inZone = zone.insetBy(dx: -6, dy: -2).contains(m)
        if !notchShown {
            if inZone { slideNotch(true) }
            return
        }
        if inZone || p.frame.insetBy(dx: -12, dy: -12).contains(m) { notchLeaveAt = nil; return }
        if notchLeaveAt == nil { notchLeaveAt = Date() }
        if Date().timeIntervalSince(notchLeaveAt!) > 0.4 { slideNotch(false) }
    }

    func slideNotch(_ show: Bool) {
        guard let p = notch else { return }
        notchShown = show
        notchLeaveAt = nil
        if show { setPaused(notchWeb, false) }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = show ? 0.28 : 0.22
            ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1)
            p.animator().setFrame(panelFrame(shown: show), display: true)
            p.animator().alphaValue = show ? 1 : 0
        }, completionHandler: { [weak self] in
            if !show { self?.setPaused(self?.notchWeb, true) }
        })
    }

    func removeNotch() {
        hoverTimer?.invalidate(); hoverTimer = nil
        notch?.orderOut(nil)
        setPaused(notchWeb, true)
        notchShown = false
    }

    func applyModes() {
        if wallOn { showWall() } else { hideWall() }
        if notchOn { setupNotch() } else { removeNotch() }
        refreshMenu()
    }

    @objc func screensChanged() { applyModes() }

    // ---------- menu bar ----------
    let seasons = [("auto", "Авто"), ("spring", "Весна"), ("summer", "Літо"), ("autumn", "Осінь"), ("winter", "Зима")]
    let weathers = [("auto", "Авто"), ("clear", "Ясно"), ("rain", "Дощ"), ("storm", "Гроза"), ("snow", "Сніг"), ("fog", "Туман"), ("wind", "Вітер")]
    var wallMenu: NSMenuItem!, notchMenu: NSMenuItem!, soundMenu: NSMenuItem!, loginMenu: NSMenuItem!

    func buildMenu() {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let b = item.button {
            if #available(macOS 11.0, *), let img = NSImage(systemSymbolName: "building.2", accessibilityDescription: "AI Office") {
                img.isTemplate = true
                b.image = img
            } else { b.title = "AI" }
        }
        let m = NSMenu()
        m.delegate = self
        m.addItem(withTitle: "TGTI AI Office", action: nil, keyEquivalent: "").isEnabled = false
        m.addItem(.separator())
        wallMenu = m.addItem(withTitle: "Шпалери на робочому столі", action: #selector(toggleWall), keyEquivalent: "")
        notchMenu = m.addItem(withTitle: "Панель з «чубчика»", action: #selector(toggleNotch), keyEquivalent: "")
        m.addItem(.separator())
        m.setSubmenu(sub(seasons, #selector(pickSeason(_:))), for: m.addItem(withTitle: "Сезон", action: nil, keyEquivalent: ""))
        m.setSubmenu(sub(weathers, #selector(pickWeather(_:))), for: m.addItem(withTitle: "Погода", action: nil, keyEquivalent: ""))
        soundMenu = m.addItem(withTitle: "Звук", action: #selector(toggleSound), keyEquivalent: "")
        m.addItem(.separator())
        loginMenu = m.addItem(withTitle: "Запускати при вході", action: #selector(toggleLogin), keyEquivalent: "")
        m.addItem(withTitle: "Вийти", action: #selector(quit), keyEquivalent: "q")
        for i in m.items { i.target = self }
        item.menu = m
        refreshMenu()
    }

    func sub(_ list: [(String, String)], _ sel: Selector) -> NSMenu {
        let s = NSMenu()
        for (v, t) in list { let i = s.addItem(withTitle: t, action: sel, keyEquivalent: ""); i.representedObject = v; i.target = self }
        return s
    }

    func refreshMenu() {
        wallMenu?.state = wallOn ? .on : .off
        notchMenu?.state = notchOn ? .on : .off
        soundMenu?.state = (defaults.object(forKey: "sound") as? Bool ?? true) ? .on : .off
        loginMenu?.state = FileManager.default.fileExists(atPath: agentPlist.path) ? .on : .off
    }

    func menuWillOpen(_ menu: NSMenu) { refreshMenu() }

    @objc func toggleWall() { wallOn.toggle(); applyModes() }
    @objc func toggleNotch() { notchOn.toggle(); applyModes() }
    @objc func pickSeason(_ s: NSMenuItem) { everyWeb("setSeason('\(s.representedObject as! String)')") }
    @objc func pickWeather(_ s: NSMenuItem) { everyWeb("setWeather('\(s.representedObject as! String)')") }
    @objc func toggleSound() {
        let on = !(defaults.object(forKey: "sound") as? Bool ?? true)
        defaults.set(on, forKey: "sound")
        everyWeb("setSound(\(on))")
        refreshMenu()
    }
    @objc func toggleLogin() {
        if FileManager.default.fileExists(atPath: agentPlist.path) { try? FileManager.default.removeItem(at: agentPlist) }
        else {
            let plist: [String: Any] = ["Label": "com.thegrandees.aioffice", "ProgramArguments": ["/usr/bin/open", "-a", Bundle.main.bundlePath], "RunAtLoad": true]
            try? FileManager.default.createDirectory(at: agentPlist.deletingLastPathComponent(), withIntermediateDirectories: true)
            (plist as NSDictionary).write(to: agentPlist, atomically: true)
        }
        refreshMenu()
    }
    @objc func quit() { NSApp.terminate(nil) }

    // ---------- self-test (used by the build check): draws the wallpaper, saves a picture, checks the server ----------
    func savePNG(_ img: NSImage?, _ path: String) -> Bool {
        guard let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else { return false }
        return (try? png.write(to: URL(fileURLWithPath: path))) != nil
    }

    func runSelftest(_ out: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 7) { [weak self] in self?.slideNotch(true) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self = self, let web = self.wallWeb else { print("SELFTEST FAIL no web view"); exit(2) }
            self.notchWeb?.takeSnapshot(with: nil) { img, _ in
                print("SELFTEST notchSnapshot=\(self.savePNG(img, out.replacingOccurrences(of: ".png", with: "-notch.png")))")
            }
            web.takeSnapshot(with: nil) { img, err in
                let ok = self.savePNG(img, out)
                let state = (try? String(contentsOf: URL(string: "http://127.0.0.1:\(port)/state")!, encoding: .utf8)) ?? ""
                print("SELFTEST snapshot=\(ok) server=\(state.contains("\"agents\"")) notchZone=\(self.hotZone().map { "\($0)" } ?? "none")")
                print("SELFTEST state \(state.prefix(300))")
                self.stopServer()
                exit(ok && state.contains("\"agents\"") ? 0 : 1)
            }
        }
    }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
