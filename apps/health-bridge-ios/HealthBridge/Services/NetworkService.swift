import Foundation

final class NetworkService: NetworkServiceProtocol, @unchecked Sendable {
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    private(set) var lastRequestBody: Data?
    private(set) var lastResponseStatusCode: Int?
    private(set) var lastError: Error?

    @MainActor static let shared = NetworkService()

    init(session: URLSession? = nil) {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 15
        self.session = session ?? URLSession(configuration: configuration)
        self.encoder = JSONEncoder()
        self.encoder.outputFormatting = [.sortedKeys]
        self.decoder = JSONDecoder()
    }

    func sendImport(payload: AppleHealthExport, config: ServerConfig) async throws -> ImportResponse {
        let url = try buildURL(base: config.serverURL, path: "/apple-health/import")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !config.apiToken.isEmpty {
            request.setValue("Bearer \(config.apiToken)", forHTTPHeaderField: "Authorization")
        }

        let body = try encoder.encode(payload)
        request.httpBody = body
        lastRequestBody = body

        return try await performRequest(request)
    }

    func testConnection(config: ServerConfig) async throws -> HealthStatusResponse {
        let url = try buildURL(base: config.serverURL, path: "/apple-health/health")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if !config.apiToken.isEmpty {
            request.setValue("Bearer \(config.apiToken)", forHTTPHeaderField: "Authorization")
        }

        lastRequestBody = nil
        return try await performRequest(request)
    }

    private func buildURL(base: String, path: String) throws -> URL {
        let normalizedBase = base.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        guard !normalizedBase.isEmpty, let url = URL(string: normalizedBase + path) else {
            throw NetworkError.invalidURL
        }
        return url
    }

    private func performRequest<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw NetworkError.invalidResponse
            }

            lastResponseStatusCode = httpResponse.statusCode
            lastError = nil

            guard (200...299).contains(httpResponse.statusCode) else {
                let errorBody = String(data: data, encoding: .utf8) ?? "Unknown error"
                throw NetworkError.serverError(statusCode: httpResponse.statusCode, message: errorBody)
            }

            return try decoder.decode(Response.self, from: data)
        } catch let error as NetworkError {
            lastError = error
            throw error
        } catch {
            lastError = error
            throw error
        }
    }
}

enum NetworkError: LocalizedError {
    case invalidURL
    case invalidResponse
    case serverError(statusCode: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL"
        case .invalidResponse:
            return "Invalid response from server"
        case let .serverError(statusCode, message):
            return "Server error (\(statusCode)): \(message)"
        }
    }
}
