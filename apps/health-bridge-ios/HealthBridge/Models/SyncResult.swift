import Foundation

struct SyncResult: Codable, Identifiable {
    let id: UUID
    let timestamp: Date
    let success: Bool
    let errorMessage: String?
    let isBackground: Bool
    let importedDays: Int
    let importedMetrics: [String]

    init(
        id: UUID = UUID(),
        timestamp: Date = Date(),
        success: Bool,
        errorMessage: String? = nil,
        isBackground: Bool = false,
        importedDays: Int = 0,
        importedMetrics: [String] = []
    ) {
        self.id = id
        self.timestamp = timestamp
        self.success = success
        self.errorMessage = errorMessage
        self.isBackground = isBackground
        self.importedDays = importedDays
        self.importedMetrics = importedMetrics
    }
}
