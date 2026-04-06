import Foundation
import HealthKit

enum HealthKitServiceError: LocalizedError {
    case healthDataUnavailable

    var errorDescription: String? {
        switch self {
        case .healthDataUnavailable:
            return "Apple Health data is not available on this device."
        }
    }
}

final class HealthKitService: HealthKitServiceProtocol, @unchecked Sendable {
    private let healthStore = HKHealthStore()
    private let calendar: Calendar

    init(calendar: Calendar = .autoupdatingCurrent) {
        self.calendar = calendar
    }

    var isAuthorized: Bool {
        guard HKHealthStore.isHealthDataAvailable(),
              let bodyMass = HKObjectType.quantityType(forIdentifier: .bodyMass)
        else {
            return false
        }
        return healthStore.authorizationStatus(for: bodyMass) == .sharingAuthorized
    }

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitServiceError.healthDataUnavailable
        }
        try await healthStore.requestAuthorization(toShare: [], read: readTypes)
    }

    func queryDailyMetrics(lookbackDays: Int, endingAt: Date) async throws -> [HealthDayMetrics] {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitServiceError.healthDataUnavailable
        }

        let boundedLookback = min(max(lookbackDays, 1), 30)
        let endDay = calendar.startOfDay(for: endingAt)
        let startDay = calendar.date(byAdding: .day, value: -(boundedLookback - 1), to: endDay) ?? endDay
        let rangeEnd = calendar.date(byAdding: .day, value: 1, to: endDay) ?? endingAt
        let dayStarts = strideDays(from: startDay, count: boundedLookback)

        async let steps = fetchDailyCumulative(
            identifier: .stepCount,
            unit: .count(),
            start: startDay,
            end: rangeEnd
        )
        async let activeEnergy = fetchDailyCumulative(
            identifier: .activeEnergyBurned,
            unit: .kilocalorie(),
            start: startDay,
            end: rangeEnd
        )
        async let restingEnergy = fetchDailyCumulative(
            identifier: .basalEnergyBurned,
            unit: .kilocalorie(),
            start: startDay,
            end: rangeEnd
        )
        async let distance = fetchDailyCumulative(
            identifier: .distanceWalkingRunning,
            unit: .meterUnit(with: .kilo),
            start: startDay,
            end: rangeEnd
        )
        async let bodyWeight = fetchLatestDailyQuantity(
            identifier: .bodyMass,
            unit: .gramUnit(with: .kilo),
            start: startDay,
            end: rangeEnd
        )
        async let bodyFat = fetchLatestDailyQuantity(
            identifier: .bodyFatPercentage,
            unit: .percent(),
            start: startDay,
            end: rangeEnd
        )
        async let leanMass = fetchLatestDailyQuantity(
            identifier: .leanBodyMass,
            unit: .gramUnit(with: .kilo),
            start: startDay,
            end: rangeEnd
        )

        let stepValues = try await steps
        let activeEnergyValues = try await activeEnergy
        let restingEnergyValues = try await restingEnergy
        let distanceValues = try await distance
        let bodyWeightValues = try await bodyWeight
        let bodyFatValues = try await bodyFat
        let leanMassValues = try await leanMass

        var snapshots = dayStarts.map { HealthDayMetrics(date: $0) }

        for index in snapshots.indices {
            let day = dayStarts[index]
            if let value = stepValues[day] {
                snapshots[index].steps = Int(value.rounded())
            }
            snapshots[index].activeEnergyKcal = rounded(activeEnergyValues[day])
            snapshots[index].restingEnergyKcal = rounded(restingEnergyValues[day])
            snapshots[index].walkingRunningDistanceKm = rounded(distanceValues[day], places: 3)
            snapshots[index].bodyWeightKg = rounded(bodyWeightValues[day])
            if let value = bodyFatValues[day] {
                snapshots[index].bodyFatPct = rounded(value * 100)
            }
            snapshots[index].leanMassKg = rounded(leanMassValues[day])
        }

        return snapshots.filter(\.hasAnyMetric)
    }

    private var readTypes: Set<HKObjectType> {
        [
            HKQuantityType.quantityType(forIdentifier: .stepCount),
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned),
            HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned),
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning),
            HKQuantityType.quantityType(forIdentifier: .bodyMass),
            HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage),
            HKQuantityType.quantityType(forIdentifier: .leanBodyMass),
        ]
        .compactMap { $0 }
        .reduce(into: Set<HKObjectType>()) { partialResult, type in
            partialResult.insert(type)
        }
    }

    private func fetchDailyCumulative(
        identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        start: Date,
        end: Date
    ) async throws -> [Date: Double] {
        guard let quantityType = HKObjectType.quantityType(forIdentifier: identifier) else {
            return [:]
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        var interval = DateComponents()
        interval.day = 1

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(
                quantityType: quantityType,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum,
                anchorDate: start,
                intervalComponents: interval
            )

            query.initialResultsHandler = { [calendar] _, collection, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                var values: [Date: Double] = [:]
                collection?.enumerateStatistics(from: start, to: end) { statistics, _ in
                    let day = calendar.startOfDay(for: statistics.startDate)
                    values[day] = statistics.sumQuantity()?.doubleValue(for: unit)
                }
                continuation.resume(returning: values)
            }

            healthStore.execute(query)
        }
    }

    private func fetchLatestDailyQuantity(
        identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        start: Date,
        end: Date
    ) async throws -> [Date: Double] {
        guard let quantityType = HKObjectType.quantityType(forIdentifier: identifier) else {
            return [:]
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let sortDescriptors = [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: quantityType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: sortDescriptors
            ) { [calendar] _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                var values: [Date: Double] = [:]
                for case let sample as HKQuantitySample in samples ?? [] {
                    let day = calendar.startOfDay(for: sample.startDate)
                    if values[day] == nil {
                        values[day] = sample.quantity.doubleValue(for: unit)
                    }
                }
                continuation.resume(returning: values)
            }
            healthStore.execute(query)
        }
    }

    private func strideDays(from start: Date, count: Int) -> [Date] {
        (0..<count).compactMap { offset in
            calendar.date(byAdding: .day, value: offset, to: start)
        }
    }

    private func rounded(_ value: Double?, places: Int = 2) -> Double? {
        guard let value else { return nil }
        let multiplier = pow(10.0, Double(places))
        return (value * multiplier).rounded() / multiplier
    }
}
