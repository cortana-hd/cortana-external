import XCTest
@testable import HealthBridge

@MainActor
final class HomeViewModelTests: XCTestCase {
    private var mockHealthKit: MockHealthKitService!
    private var mockNetwork: MockNetworkService!
    private var viewModel: HomeViewModel!

    override func setUp() {
        super.setUp()
        mockHealthKit = MockHealthKitService()
        mockNetwork = MockNetworkService()

        ServerConfig(serverURL: "https://test.com", apiToken: "token", deviceName: "Test", lookbackDays: 7).save()

        viewModel = HomeViewModel(
            healthKitService: mockHealthKit,
            networkService: mockNetwork,
            buildDate: Date()
        )
    }

    override func tearDown() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "healthbridge_serverURL")
        defaults.removeObject(forKey: "healthbridge_apiToken")
        defaults.removeObject(forKey: "healthbridge_deviceName")
        defaults.removeObject(forKey: "healthbridge_lookbackDays")
        defaults.removeObject(forKey: "healthbridge_firstLaunchDate")
        viewModel = nil
        mockNetwork = nil
        mockHealthKit = nil
        super.tearDown()
    }

    func testSyncNowSuccess() async {
        await viewModel.syncNow()

        XCTAssertNotNil(viewModel.lastSyncTime)
        XCTAssertTrue(viewModel.lastSyncResult?.success == true)
        XCTAssertEqual(mockHealthKit.queryLastDayCallCount, 1)
        XCTAssertEqual(mockNetwork.sendImportCallCount, 1)
        XCTAssertEqual(viewModel.lastImportedDays, 1)
    }

    func testCheckConnectionSuccess() async {
        await viewModel.checkConnection()
        XCTAssertEqual(viewModel.connectionStatus, .connected)
        XCTAssertEqual(viewModel.serviceHealthStatus, "healthy")
    }
}
