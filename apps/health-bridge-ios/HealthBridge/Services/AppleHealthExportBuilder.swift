import Foundation

enum AppleHealthExportBuilder {
    static func build(
        days: [HealthDayMetrics],
        config: ServerConfig,
        generatedAt: Date = Date(),
        timeZone: TimeZone = .current,
        appVersion: String = HealthBridgeAppInfo.version()
    ) -> AppleHealthExport {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        let provenance = AppleHealthExportProvenance(
            deviceId: config.deviceId,
            deviceName: config.deviceName,
            appVersion: appVersion
        )

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone

        return AppleHealthExport(
            generatedAt: formatter.string(from: generatedAt),
            sourceVersion: "healthbridge-ios/\(appVersion)",
            provenance: provenance,
            days: days
                .sorted { $0.date < $1.date }
                .filter(\.hasAnyMetric)
                .map { day in
                    AppleHealthDay(
                        date: HealthDateFormatter.dayString(from: day.date, calendar: calendar),
                        steps: day.steps,
                        activeEnergyKcal: day.activeEnergyKcal?.rounded(decimalPlaces: 2),
                        restingEnergyKcal: day.restingEnergyKcal?.rounded(decimalPlaces: 2),
                        walkingRunningDistanceKm: day.walkingRunningDistanceKm?.rounded(decimalPlaces: 3),
                        bodyWeightKg: day.bodyWeightKg?.rounded(decimalPlaces: 2),
                        bodyFatPct: day.bodyFatPct?.rounded(decimalPlaces: 2),
                        leanMassKg: day.leanMassKg?.rounded(decimalPlaces: 2),
                        provenance: provenance
                    )
                }
        )
    }
}

private extension Double {
    func rounded(decimalPlaces: Int) -> Double {
        let multiplier = pow(10.0, Double(decimalPlaces))
        return (self * multiplier).rounded() / multiplier
    }
}
