import Foundation

@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var serverURL: String
    @Published var apiToken: String
    @Published var deviceName: String
    @Published var lookbackDays: Int
    @Published var isTestingConnection: Bool = false
    @Published var connectionTestResult: Bool?
    @Published var connectionTestStatus: String?

    private let networkService: NetworkServiceProtocol

    init(networkService: NetworkServiceProtocol = NetworkService.shared) {
        self.networkService = networkService
        let config = ServerConfig.load()
        self.serverURL = config.serverURL
        self.apiToken = config.apiToken
        self.deviceName = config.deviceName
        self.lookbackDays = config.resolvedLookbackDays
    }

    func save() {
        ServerConfig(
            serverURL: serverURL,
            apiToken: apiToken,
            deviceName: deviceName,
            lookbackDays: lookbackDays
        ).save()
    }

    func testConnection() async {
        save()

        isTestingConnection = true
        connectionTestResult = nil
        connectionTestStatus = nil
        defer { isTestingConnection = false }

        do {
            let result = try await networkService.testConnection(config: ServerConfig.load())
            connectionTestResult = true
            connectionTestStatus = result.status
        } catch {
            connectionTestResult = false
        }
    }
}
