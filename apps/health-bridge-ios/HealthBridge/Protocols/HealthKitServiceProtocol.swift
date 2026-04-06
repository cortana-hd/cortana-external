import Foundation

protocol HealthKitServiceProtocol: Sendable {
    func requestAuthorization() async throws
    func queryDailyMetrics(lookbackDays: Int, endingAt: Date) async throws -> [HealthDayMetrics]
    var isAuthorized: Bool { get }
}
