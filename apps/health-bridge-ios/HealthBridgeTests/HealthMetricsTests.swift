import XCTest
@testable import HealthBridge

final class HealthMetricsTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
        return calendar
    }

    func testDayFormatterIsStable() {
        let date = calendar.date(from: DateComponents(year: 2026, month: 4, day: 7, hour: 8))!
        XCTAssertEqual(HealthDateFormatter.dayString(from: date, calendar: calendar), "2026-04-07")
    }

    func testHasAnyMetricRecognizesMetrics() {
        let withMetrics = HealthDayMetrics(
            date: Date(),
            steps: 10_000,
            activeEnergyKcal: nil,
            restingEnergyKcal: nil,
            walkingRunningDistanceKm: nil,
            bodyWeightKg: nil,
            bodyFatPct: nil,
            leanMassKg: nil
        )
        let empty = HealthDayMetrics(date: Date())

        XCTAssertTrue(withMetrics.hasAnyMetric)
        XCTAssertFalse(empty.hasAnyMetric)
    }

    func testExportBuilderBuildsSortedPayload() {
        let config = ServerConfig(
            serverURL: "http://127.0.0.1:3033",
            apiToken: "token",
            deviceName: "HD iPhone",
            lookbackDays: 7
        )
        let dayOne = calendar.date(from: DateComponents(year: 2026, month: 4, day: 5))!
        let dayTwo = calendar.date(from: DateComponents(year: 2026, month: 4, day: 6))!

        let export = AppleHealthExportBuilder.build(
            days: [
                HealthDayMetrics(date: dayTwo, steps: 12_000, bodyWeightKg: 78.4),
                HealthDayMetrics(date: dayOne, activeEnergyKcal: 540),
            ],
            config: config,
            generatedAt: ISO8601DateFormatter().date(from: "2026-04-06T12:00:00Z")!,
            timeZone: calendar.timeZone,
            appVersion: "0.2.0"
        )

        XCTAssertEqual(export.days.count, 2)
        XCTAssertEqual(export.days[0].date, "2026-04-05")
        XCTAssertEqual(export.days[1].date, "2026-04-06")
        XCTAssertEqual(export.provenance.deviceName, "HD iPhone")
        XCTAssertEqual(export.sourceVersion, "healthbridge-ios/0.2.0")
        XCTAssertEqual(export.days[1].bodyWeightKg, 78.4)
    }
}
