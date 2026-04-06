import Foundation
@testable import HealthBridge

final class MockNetworkService: NetworkServiceProtocol, @unchecked Sendable {
    var sendImportCallCount = 0
    var testConnectionCallCount = 0

    var lastSendImportPayload: AppleHealthExport?
    var lastSendImportConfig: ServerConfig?
    var lastTestConnectionConfig: ServerConfig?

    var shouldFail = false
    var failureError: Error = NSError(domain: "MockNetwork", code: 1, userInfo: [NSLocalizedDescriptionKey: "Mock network error"])

    var importResponse = ImportResponse(
        ok: true,
        stored: true,
        dataPath: "/tmp/latest.json",
        generatedAt: ISO8601DateFormatter().string(from: Date()),
        maxAgeSeconds: 129_600,
        isStale: false,
        days: 1,
        metrics: ["activeEnergyKcal", "bodyWeightKg", "steps"],
        receivedAt: ISO8601DateFormatter().string(from: Date())
    )
    var connectionResponse = HealthStatusResponse(
        status: "healthy",
        dataPath: "/tmp/latest.json",
        generatedAt: ISO8601DateFormatter().string(from: Date()),
        ageSeconds: 30,
        maxAgeSeconds: 129_600,
        isStale: false,
        error: nil,
        note: nil
    )

    func sendImport(payload: AppleHealthExport, config: ServerConfig) async throws -> ImportResponse {
        sendImportCallCount += 1
        lastSendImportPayload = payload
        lastSendImportConfig = config
        if shouldFail {
            throw failureError
        }
        return importResponse
    }

    func testConnection(config: ServerConfig) async throws -> HealthStatusResponse {
        testConnectionCallCount += 1
        lastTestConnectionConfig = config
        if shouldFail {
            throw failureError
        }
        return connectionResponse
    }
}
