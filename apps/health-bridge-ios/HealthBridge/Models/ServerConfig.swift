import Foundation

struct ServerConfig: Equatable, Sendable {
    var serverURL: String
    var apiToken: String
    var deviceName: String
    var lookbackDays: Int

    private static let serverURLKey = "healthbridge_serverURL"
    private static let apiTokenKey = "healthbridge_apiToken"
    private static let deviceNameKey = "healthbridge_deviceName"
    private static let lookbackDaysKey = "healthbridge_lookbackDays"

    static let defaultLookbackDays = 14

    var isConfigured: Bool {
        !serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var deviceId: String {
        deviceName
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
            .replacingOccurrences(of: #"[^a-z0-9\-]"#, with: "", options: .regularExpression)
    }

    var resolvedLookbackDays: Int {
        min(max(lookbackDays, 1), 30)
    }

    static func load() -> ServerConfig {
        let defaults = UserDefaults.standard
        return ServerConfig(
            serverURL: defaults.string(forKey: serverURLKey) ?? "",
            apiToken: defaults.string(forKey: apiTokenKey) ?? "",
            deviceName: defaults.string(forKey: deviceNameKey) ?? "",
            lookbackDays: defaults.object(forKey: lookbackDaysKey) as? Int ?? defaultLookbackDays
        )
    }

    func save() {
        let defaults = UserDefaults.standard
        defaults.set(serverURL, forKey: ServerConfig.serverURLKey)
        defaults.set(apiToken, forKey: ServerConfig.apiTokenKey)
        defaults.set(deviceName, forKey: ServerConfig.deviceNameKey)
        defaults.set(resolvedLookbackDays, forKey: ServerConfig.lookbackDaysKey)
    }
}
