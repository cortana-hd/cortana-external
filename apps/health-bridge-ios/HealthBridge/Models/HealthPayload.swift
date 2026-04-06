import Foundation

struct AppleHealthExport: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let generatedAt: String
    let sourceName: String
    let sourceVersion: String
    let provenance: AppleHealthExportProvenance
    let days: [AppleHealthDay]

    init(
        schemaVersion: Int = 1,
        generatedAt: String,
        sourceName: String = "apple_health",
        sourceVersion: String,
        provenance: AppleHealthExportProvenance,
        days: [AppleHealthDay]
    ) {
        self.schemaVersion = schemaVersion
        self.generatedAt = generatedAt
        self.sourceName = sourceName
        self.sourceVersion = sourceVersion
        self.provenance = provenance
        self.days = days
    }

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case generatedAt = "generated_at"
        case sourceName = "source_name"
        case sourceVersion = "source_version"
        case provenance
        case days
    }
}

struct AppleHealthExportProvenance: Codable, Equatable, Sendable {
    let source: String
    let deviceId: String
    let deviceName: String
    let collectedBy: String
    let appVersion: String

    init(
        source: String = "apple_health",
        deviceId: String,
        deviceName: String,
        collectedBy: String = "healthbridge_ios",
        appVersion: String
    ) {
        self.source = source
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.collectedBy = collectedBy
        self.appVersion = appVersion
    }

    enum CodingKeys: String, CodingKey {
        case source
        case deviceId = "device_id"
        case deviceName = "device_name"
        case collectedBy = "collected_by"
        case appVersion = "app_version"
    }
}

struct AppleHealthDay: Codable, Equatable, Identifiable, Sendable {
    let date: String
    let steps: Int?
    let activeEnergyKcal: Double?
    let restingEnergyKcal: Double?
    let walkingRunningDistanceKm: Double?
    let bodyWeightKg: Double?
    let bodyFatPct: Double?
    let leanMassKg: Double?
    let provenance: AppleHealthExportProvenance?

    var id: String { date }

    enum CodingKeys: String, CodingKey {
        case date
        case steps
        case activeEnergyKcal
        case restingEnergyKcal
        case walkingRunningDistanceKm
        case bodyWeightKg
        case bodyFatPct
        case leanMassKg
        case provenance
    }
}

struct ImportResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let stored: Bool
    let dataPath: String
    let generatedAt: String
    let maxAgeSeconds: Int
    let isStale: Bool
    let days: Int?
    let metrics: [String]
    let receivedAt: String

    enum CodingKeys: String, CodingKey {
        case ok
        case stored
        case dataPath = "data_path"
        case generatedAt = "generated_at"
        case maxAgeSeconds = "max_age_seconds"
        case isStale = "is_stale"
        case days
        case metrics
        case receivedAt = "received_at"
    }
}

struct HealthStatusResponse: Codable, Equatable, Sendable {
    let status: String
    let dataPath: String
    let generatedAt: String?
    let ageSeconds: Int?
    let maxAgeSeconds: Int
    let isStale: Bool
    let error: String?
    let note: String?

    enum CodingKeys: String, CodingKey {
        case status
        case dataPath = "data_path"
        case generatedAt = "generated_at"
        case ageSeconds = "age_seconds"
        case maxAgeSeconds = "max_age_seconds"
        case isStale = "is_stale"
        case error
        case note
    }
}
