import Foundation
@testable import HealthBridge

enum ValidationFailure: Error, CustomStringConvertible {
    case failed(String)

    var description: String {
        switch self {
        case let .failed(message):
            return message
        }
    }
}

func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() {
        throw ValidationFailure.failed(message)
    }
}

final class ValidationHealthKitService: HealthKitServiceProtocol, @unchecked Sendable {
    var isAuthorized = true
    var requestedAuthorization = false
    var metrics: [HealthDayMetrics] = []

    func requestAuthorization() async throws {
        requestedAuthorization = true
    }

    func queryDailyMetrics(lookbackDays _: Int, endingAt _: Date) async throws -> [HealthDayMetrics] {
        metrics
    }
}

final class ValidationNetworkService: NetworkServiceProtocol, @unchecked Sendable {
    var lastPayload: AppleHealthExport?
    var healthResponse = HealthStatusResponse(
        status: "healthy",
        dataPath: "/tmp/latest.json",
        generatedAt: "2026-04-06T13:00:00.000Z",
        ageSeconds: 0,
        maxAgeSeconds: 129600,
        isStale: false,
        error: nil,
        note: nil
    )

    func sendImport(payload: AppleHealthExport, config _: ServerConfig) async throws -> ImportResponse {
        lastPayload = payload
        return ImportResponse(
            ok: true,
            stored: true,
            dataPath: "/tmp/latest.json",
            generatedAt: payload.generatedAt,
            maxAgeSeconds: 129600,
            isStale: false,
            days: payload.days.count,
            metrics: ["activeEnergyKcal", "bodyWeightKg", "steps"],
            receivedAt: payload.generatedAt
        )
    }

    func testConnection(config _: ServerConfig) async throws -> HealthStatusResponse {
        healthResponse
    }
}

@MainActor
func runValidation() async throws {
    let defaults = UserDefaults.standard
    defaults.removeObject(forKey: "healthbridge_serverURL")
    defaults.removeObject(forKey: "healthbridge_apiToken")
    defaults.removeObject(forKey: "healthbridge_deviceName")
    defaults.removeObject(forKey: "healthbridge_lookbackDays")
    defaults.removeObject(forKey: "healthbridge_firstLaunchDate")

    let savedConfig = ServerConfig(
        serverURL: "https://example.com/",
        apiToken: "",
        deviceName: "HD iPhone",
        lookbackDays: 14
    )
    savedConfig.save()
    let loaded = ServerConfig.load()
    try expect(loaded.deviceId == "hd-iphone", "device id normalization failed")
    try expect(loaded.resolvedLookbackDays == 14, "lookback days did not persist")

    let formatter = ISO8601DateFormatter()
    let firstDate = formatter.date(from: "2026-04-05T12:00:00Z")!
    let secondDate = formatter.date(from: "2026-04-06T12:00:00Z")!
    let export = AppleHealthExportBuilder.build(
        days: [
            HealthDayMetrics(
                date: secondDate,
                steps: 10432,
                activeEnergyKcal: 612.236,
                restingEnergyKcal: 1775.449,
                walkingRunningDistanceKm: 7.81234,
                bodyWeightKg: 78.444,
                bodyFatPct: 15.234,
                leanMassKg: 66.512
            ),
            HealthDayMetrics(
                date: firstDate,
                steps: 9000,
                activeEnergyKcal: nil,
                restingEnergyKcal: nil,
                walkingRunningDistanceKm: nil,
                bodyWeightKg: nil,
                bodyFatPct: nil,
                leanMassKg: nil
            ),
        ],
        config: loaded,
        generatedAt: formatter.date(from: "2026-04-06T13:00:00Z")!,
        timeZone: TimeZone(secondsFromGMT: 0)!,
        appVersion: "0.2.0"
    )
    try expect(export.days.count == 2, "export should contain two days")
    try expect(export.days[0].date == "2026-04-05", "export did not sort days")
    try expect(export.days[1].activeEnergyKcal == 612.24, "active energy rounding failed")

    let healthKit = ValidationHealthKitService()
    healthKit.metrics = [
        HealthDayMetrics(
            date: secondDate,
            steps: 10432,
            activeEnergyKcal: 612,
            restingEnergyKcal: 1775,
            walkingRunningDistanceKm: 7.8,
            bodyWeightKg: 78.4,
            bodyFatPct: 15.2,
            leanMassKg: 66.5
        )
    ]
    let network = ValidationNetworkService()
    let viewModel = HomeViewModel(healthKitService: healthKit, networkService: network, buildDate: Date())
    await viewModel.checkConnection()
    try expect(viewModel.connectionStatus == .connected, "connection check did not update status")

    await viewModel.syncNow()
    try expect(viewModel.lastSyncResult?.success == true, "sync did not succeed")
    try expect(viewModel.lastImportedDays == 1, "sync did not record imported day count")
    try expect(network.lastPayload?.days.first?.steps == 10432, "network import payload missing steps")
    try expect(viewModel.serviceHealthStatus == "healthy", "view model did not record health status")

    print("HealthBridge validation passed")
}

@main
struct ValidationMain {
    static func main() async {
        do {
            try await runValidation()
        } catch {
            fputs("HealthBridge validation failed: \(error)\n", stderr)
            exit(1)
        }
    }
}
