import Foundation

protocol NetworkServiceProtocol: Sendable {
    func sendImport(payload: AppleHealthExport, config: ServerConfig) async throws -> ImportResponse
    func testConnection(config: ServerConfig) async throws -> HealthStatusResponse
}
