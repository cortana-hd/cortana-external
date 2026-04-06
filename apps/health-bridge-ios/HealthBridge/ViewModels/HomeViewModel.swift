import Combine
import Foundation

enum ConnectionStatus: Equatable {
    case connected
    case disconnected
    case unknown

    var label: String {
        switch self {
        case .connected: return "Connected"
        case .disconnected: return "Disconnected"
        case .unknown: return "Unknown"
        }
    }
}

@MainActor
final class HomeViewModel: ObservableObject {
    @Published var connectionStatus: ConnectionStatus = .unknown
    @Published var isHealthKitAuthorized: Bool = false
    @Published var serviceHealthStatus: String?
    @Published var lastSyncTime: Date?
    @Published var isSyncing: Bool = false
    @Published var lastSyncResult: SyncResult?
    @Published var lastImportedDays: Int?
    @Published var lastImportedMetrics: [String] = []
    @Published var profileDaysRemaining: Int = 7

    private let healthKitService: HealthKitServiceProtocol
    private let networkService: NetworkServiceProtocol
    private let buildDate: Date

    init(
        healthKitService: HealthKitServiceProtocol,
        networkService: NetworkServiceProtocol,
        buildDate: Date? = nil
    ) {
        self.healthKitService = healthKitService
        self.networkService = networkService
        if let buildDate {
            self.buildDate = buildDate
        } else {
            let key = "healthbridge_firstLaunchDate"
            if let stored = UserDefaults.standard.object(forKey: key) as? Date {
                self.buildDate = stored
            } else {
                let now = Date()
                UserDefaults.standard.set(now, forKey: key)
                self.buildDate = now
            }
        }

        self.isHealthKitAuthorized = healthKitService.isAuthorized
        updateProfileExpiration()
    }

    func refreshAuthorizationState() {
        isHealthKitAuthorized = healthKitService.isAuthorized
    }

    func checkConnection() async {
        let config = ServerConfig.load()
        guard config.isConfigured else {
            connectionStatus = .unknown
            serviceHealthStatus = nil
            return
        }

        do {
            let health = try await networkService.testConnection(config: config)
            serviceHealthStatus = health.status
            connectionStatus = .connected
        } catch {
            serviceHealthStatus = nil
            connectionStatus = .disconnected
        }
    }

    func syncNow() async {
        guard !isSyncing else { return }

        let config = ServerConfig.load()
        guard config.isConfigured else {
            lastSyncResult = SyncResult(success: false, errorMessage: "Server not configured")
            return
        }

        isSyncing = true
        defer { isSyncing = false }

        do {
            let days = try await healthKitService.queryDailyMetrics(
                lookbackDays: config.resolvedLookbackDays,
                endingAt: Date()
            )
            let payload = AppleHealthExportBuilder.build(days: days, config: config)
            guard !payload.days.isEmpty else {
                lastSyncResult = SyncResult(
                    success: false,
                    errorMessage: "No Apple Health metrics found in the last \(config.resolvedLookbackDays) days"
                )
                return
            }

            let response = try await networkService.sendImport(payload: payload, config: config)
            lastSyncTime = Date()
            lastImportedDays = response.days
            lastImportedMetrics = response.metrics
            serviceHealthStatus = response.isStale ? "degraded" : "healthy"
            lastSyncResult = SyncResult(
                success: response.ok && response.stored,
                importedDays: response.days ?? 0,
                importedMetrics: response.metrics
            )
            connectionStatus = .connected
        } catch {
            lastSyncResult = SyncResult(success: false, errorMessage: error.localizedDescription)
            connectionStatus = .disconnected
        }
    }

    func requestHealthAccess() async {
        do {
            try await healthKitService.requestAuthorization()
            isHealthKitAuthorized = healthKitService.isAuthorized
        } catch {
            isHealthKitAuthorized = false
        }
    }

    private func updateProfileExpiration() {
        let daysSinceBuild = Calendar.current.dateComponents([.day], from: buildDate, to: Date()).day ?? 0
        profileDaysRemaining = max(0, 7 - daysSinceBuild)
    }
}
