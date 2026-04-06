import XCTest
@testable import HealthBridge

final class BackgroundSyncManagerTests: XCTestCase {
    private var mockHealthKit: MockHealthKitService!
    private var mockNetwork: MockNetworkService!
    private var syncManager: BackgroundSyncManager!

    override func setUp() {
        super.setUp()
        mockHealthKit = MockHealthKitService()
        mockNetwork = MockNetworkService()
        syncManager = BackgroundSyncManager(
            healthKitService: mockHealthKit,
            networkService: mockNetwork
        )

        ServerConfig(serverURL: "https://test.com", apiToken: "token", deviceName: "Test", lookbackDays: 7).save()
    }

    override func tearDown() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "healthbridge_serverURL")
        defaults.removeObject(forKey: "healthbridge_apiToken")
        defaults.removeObject(forKey: "healthbridge_deviceName")
        defaults.removeObject(forKey: "healthbridge_lookbackDays")
        syncManager = nil
        mockNetwork = nil
        mockHealthKit = nil
        super.tearDown()
    }

    func testBackgroundSyncSuccess() async {
        await syncManager.performBackgroundSync()

        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(mockHealthKit.queryLastDayCallCount, 1)
        XCTAssertEqual(mockNetwork.sendImportCallCount, 1)
        XCTAssertEqual(syncManager.recentSyncs.count, 1)
        XCTAssertTrue(syncManager.recentSyncs[0].success)
        XCTAssertTrue(syncManager.recentSyncs[0].isBackground)
        XCTAssertEqual(syncManager.recentSyncs[0].importedDays, 1)
    }

    func testBackgroundSyncNetworkFailure() async {
        mockNetwork.shouldFail = true

        await syncManager.performBackgroundSync()
        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(syncManager.recentSyncs.count, 1)
        XCTAssertFalse(syncManager.recentSyncs[0].success)
        XCTAssertNotNil(syncManager.recentSyncs[0].errorMessage)
    }

    func testBackgroundSyncHealthKitFailure() async {
        mockHealthKit.shouldFailQuery = true

        await syncManager.performBackgroundSync()
        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(syncManager.recentSyncs.count, 1)
        XCTAssertFalse(syncManager.recentSyncs[0].success)
        XCTAssertEqual(mockNetwork.sendImportCallCount, 0)
    }

    func testBackgroundSyncNoMetrics() async {
        mockHealthKit.metricsToReturn = []

        await syncManager.performBackgroundSync()
        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(syncManager.recentSyncs.count, 1)
        XCTAssertEqual(syncManager.recentSyncs[0].errorMessage, "No Apple Health metrics found in the last 7 days")
    }

    func testRecentSyncsLimitedToFive() async {
        for _ in 0..<7 {
            await syncManager.performBackgroundSync()
            try? await Task.sleep(nanoseconds: 50_000_000)
        }

        try? await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertLessThanOrEqual(syncManager.recentSyncs.count, 5)
    }
}
