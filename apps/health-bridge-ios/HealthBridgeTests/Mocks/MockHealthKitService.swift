import Foundation
@testable import HealthBridge

final class MockHealthKitService: HealthKitServiceProtocol, @unchecked Sendable {
    var isAuthorized: Bool = false

    var requestAuthorizationCallCount = 0
    var queryLastDayCallCount = 0
    var lastLookbackDays: Int?

    var shouldFailAuthorization = false
    var authorizationError: Error = NSError(domain: "MockHealthKit", code: 1, userInfo: [NSLocalizedDescriptionKey: "Mock authorization failed"])

    var shouldFailQuery = false
    var queryError: Error = NSError(domain: "MockHealthKit", code: 2, userInfo: [NSLocalizedDescriptionKey: "Mock query failed"])

    var metricsToReturn = [
        HealthDayMetrics(
            date: Date(),
            steps: 8500,
            activeEnergyKcal: 620,
            restingEnergyKcal: 1785,
            walkingRunningDistanceKm: 6.9,
            bodyWeightKg: 78.4,
            bodyFatPct: 15.4,
            leanMassKg: 66.2
        ),
    ]

    func requestAuthorization() async throws {
        requestAuthorizationCallCount += 1
        if shouldFailAuthorization {
            throw authorizationError
        }
        isAuthorized = true
    }

    func queryDailyMetrics(lookbackDays: Int, endingAt: Date) async throws -> [HealthDayMetrics] {
        queryLastDayCallCount += 1
        lastLookbackDays = lookbackDays
        if shouldFailQuery {
            throw queryError
        }
        return metricsToReturn
    }
}
