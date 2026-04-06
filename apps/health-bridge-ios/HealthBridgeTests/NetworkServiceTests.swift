import XCTest
@testable import HealthBridge

final class MockURLProtocol: URLProtocol {
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = MockURLProtocol.requestHandler else {
            client?.urlProtocol(self, didFailWithError: NSError(domain: "MockURLProtocol", code: 0))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

final class NetworkServiceTests: XCTestCase {
    private var networkService: NetworkService!
    private var session: URLSession!

    override func setUp() {
        super.setUp()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        session = URLSession(configuration: configuration)
        networkService = NetworkService(session: session)
    }

    override func tearDown() {
        MockURLProtocol.requestHandler = nil
        networkService = nil
        session = nil
        super.tearDown()
    }

    private var testConfig: ServerConfig {
        ServerConfig(serverURL: "https://example.com", apiToken: "test-token-123", deviceName: "Test Device", lookbackDays: 7)
    }

    private var testPayload: AppleHealthExport {
        AppleHealthExport(
            generatedAt: "2026-04-06T12:00:00.000Z",
            sourceVersion: "healthbridge-ios/0.2.0",
            provenance: AppleHealthExportProvenance(
                deviceId: "test-device",
                deviceName: "Test Device",
                appVersion: "0.2.0"
            ),
            days: [
                AppleHealthDay(
                    date: "2026-04-06",
                    steps: 10_432,
                    activeEnergyKcal: 612,
                    restingEnergyKcal: 1775,
                    walkingRunningDistanceKm: 7.8,
                    bodyWeightKg: 78.4,
                    bodyFatPct: 15.2,
                    leanMassKg: 66.5,
                    provenance: nil
                ),
            ]
        )
    }

    func testSendImportRequestFormat() async throws {
        MockURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/apple-health/import")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token-123")

            let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
            XCTAssertEqual(body["schema_version"] as? Int, 1)
            XCTAssertEqual(body["source_name"] as? String, "apple_health")
            XCTAssertEqual(body["source_version"] as? String, "healthbridge-ios/0.2.0")

            let responseData = """
            {"ok":true,"stored":true,"data_path":"/tmp/latest.json","generated_at":"2026-04-06T12:00:00.000Z","max_age_seconds":129600,"is_stale":false,"days":1,"metrics":["steps"],"received_at":"2026-04-06T12:00:05.000Z"}
            """.data(using: .utf8)!
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, responseData)
        }

        let response = try await networkService.sendImport(payload: testPayload, config: testConfig)
        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.days, 1)
    }

    func testConnectionDecodesHealthResponse() async throws {
        MockURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/apple-health/health")

            let data = """
            {"status":"unconfigured","data_path":"/tmp/latest.json","generated_at":null,"age_seconds":null,"max_age_seconds":129600,"is_stale":false,"note":"not configured"}
            """.data(using: .utf8)!
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, data)
        }

        let response = try await networkService.testConnection(config: testConfig)
        XCTAssertEqual(response.status, "unconfigured")
    }
}
