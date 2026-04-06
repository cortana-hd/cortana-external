import Combine
import Foundation
import HealthKit

final class BackgroundSyncManager: ObservableObject {
    static let shared = BackgroundSyncManager()

    var healthKitService: HealthKitServiceProtocol
    var networkService: NetworkServiceProtocol

    @Published var recentSyncs: [SyncResult] = []

    var lastBackgroundSync: SyncResult? {
        recentSyncs.first
    }

    private let healthStore = HKHealthStore()
    private var observerQueries: [HKObserverQuery] = []

    init(
        healthKitService: HealthKitServiceProtocol = HealthKitService(),
        networkService: NetworkServiceProtocol = NetworkService.shared
    ) {
        self.healthKitService = healthKitService
        self.networkService = networkService
    }

    func setupBackgroundDelivery() {
        guard HKHealthStore.isHealthDataAvailable() else { return }

        let sampleTypes: [HKSampleType] = [
            HKQuantityType.quantityType(forIdentifier: .stepCount),
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned),
            HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned),
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning),
            HKQuantityType.quantityType(forIdentifier: .bodyMass),
            HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage),
            HKQuantityType.quantityType(forIdentifier: .leanBodyMass),
        ].compactMap { $0 }

        for sampleType in sampleTypes {
            healthStore.enableBackgroundDelivery(for: sampleType, frequency: .hourly) { _, _ in }

            let query = HKObserverQuery(sampleType: sampleType, predicate: nil) { [weak self] _, completionHandler, error in
                guard let self else {
                    completionHandler()
                    return
                }

                if let error {
                    self.addSyncResult(SyncResult(success: false, errorMessage: error.localizedDescription, isBackground: true))
                    completionHandler()
                    return
                }

                Task {
                    await self.performBackgroundSync()
                    completionHandler()
                }
            }

            healthStore.execute(query)
            observerQueries.append(query)
        }
    }

    func performBackgroundSync() async {
        let config = ServerConfig.load()
        guard config.isConfigured else {
            addSyncResult(SyncResult(success: false, errorMessage: "Server not configured", isBackground: true))
            return
        }

        do {
            let days = try await healthKitService.queryDailyMetrics(
                lookbackDays: config.resolvedLookbackDays,
                endingAt: Date()
            )
            let payload = AppleHealthExportBuilder.build(days: days, config: config)
            guard !payload.days.isEmpty else {
                addSyncResult(
                    SyncResult(
                        success: false,
                        errorMessage: "No Apple Health metrics found in the last \(config.resolvedLookbackDays) days",
                        isBackground: true
                    )
                )
                return
            }

            let response = try await networkService.sendImport(payload: payload, config: config)
            addSyncResult(
                SyncResult(
                    success: response.ok && response.stored,
                    isBackground: true,
                    importedDays: response.days ?? 0,
                    importedMetrics: response.metrics
                )
            )
        } catch {
            addSyncResult(SyncResult(success: false, errorMessage: error.localizedDescription, isBackground: true))
        }
    }

    func stopAllQueries() {
        for query in observerQueries {
            healthStore.stop(query)
        }
        observerQueries.removeAll()
    }

    private func addSyncResult(_ result: SyncResult) {
        DispatchQueue.main.async {
            self.recentSyncs.insert(result, at: 0)
            if self.recentSyncs.count > 5 {
                self.recentSyncs = Array(self.recentSyncs.prefix(5))
            }
        }
    }
}
