import XCTest
@testable import HealthBridge

final class HealthPayloadTests: XCTestCase {
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    func testAppleHealthExportEncode() throws {
        let export = AppleHealthExport(
            generatedAt: "2026-04-06T12:00:00.000Z",
            sourceVersion: "healthbridge-ios/0.2.0",
            provenance: AppleHealthExportProvenance(
                deviceId: "hd-iphone",
                deviceName: "HD iPhone",
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

        let data = try encoder.encode(export)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(json?["schema_version"] as? Int, 1)
        XCTAssertEqual(json?["source_name"] as? String, "apple_health")
        XCTAssertEqual(json?["source_version"] as? String, "healthbridge-ios/0.2.0")
        let days = try XCTUnwrap(json?["days"] as? [[String: Any]])
        XCTAssertEqual(days.first?["bodyWeightKg"] as? Double, 78.4)
        XCTAssertEqual(days.first?["steps"] as? Int, 10_432)
    }

    func testImportResponseDecodes() throws {
        let json = """
        {"ok":true,"stored":true,"data_path":"/tmp/latest.json","generated_at":"2026-04-06T12:00:00.000Z","max_age_seconds":129600,"is_stale":false,"days":2,"metrics":["activeEnergyKcal","bodyWeightKg","steps"],"received_at":"2026-04-06T12:00:05.000Z"}
        """.data(using: .utf8)!

        let response = try decoder.decode(ImportResponse.self, from: json)
        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.dataPath, "/tmp/latest.json")
        XCTAssertEqual(response.days, 2)
        XCTAssertEqual(response.metrics, ["activeEnergyKcal", "bodyWeightKg", "steps"])
    }
}
