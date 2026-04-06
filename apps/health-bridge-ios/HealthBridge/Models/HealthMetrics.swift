import Foundation

struct HealthDayMetrics: Equatable, Sendable, Identifiable {
    let date: Date
    var steps: Int?
    var activeEnergyKcal: Double?
    var restingEnergyKcal: Double?
    var walkingRunningDistanceKm: Double?
    var bodyWeightKg: Double?
    var bodyFatPct: Double?
    var leanMassKg: Double?

    var id: String {
        HealthDateFormatter.dayString(from: date)
    }

    var hasAnyMetric: Bool {
        steps != nil
            || activeEnergyKcal != nil
            || restingEnergyKcal != nil
            || walkingRunningDistanceKm != nil
            || bodyWeightKg != nil
            || bodyFatPct != nil
            || leanMassKg != nil
    }
}

enum HealthDateFormatter {
    static func dayString(from date: Date, calendar: Calendar = .current) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

enum HealthBridgeAppInfo {
    static func version(bundle: Bundle = .main) -> String {
        let shortVersion = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let buildVersion = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        switch (shortVersion, buildVersion) {
        case let (short?, build?) where short != build:
            return "\(short) (\(build))"
        case let (short?, _):
            return short
        case let (_, build?):
            return build
        default:
            return "0.2.0"
        }
    }
}
