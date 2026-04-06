import XCTest
@testable import HealthBridge

@MainActor
final class SettingsViewModelTests: XCTestCase {
    private var mockNetwork: MockNetworkService!
    private var viewModel: SettingsViewModel!

    override func setUp() {
        super.setUp()
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "healthbridge_serverURL")
        defaults.removeObject(forKey: "healthbridge_apiToken")
        defaults.removeObject(forKey: "healthbridge_deviceName")
        defaults.removeObject(forKey: "healthbridge_lookbackDays")

        mockNetwork = MockNetworkService()
        viewModel = SettingsViewModel(networkService: mockNetwork)
    }

    override func tearDown() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "healthbridge_serverURL")
        defaults.removeObject(forKey: "healthbridge_apiToken")
        defaults.removeObject(forKey: "healthbridge_deviceName")
        defaults.removeObject(forKey: "healthbridge_lookbackDays")
        viewModel = nil
        mockNetwork = nil
        super.tearDown()
    }

    func testSavePersistsToUserDefaults() {
        viewModel.serverURL = "https://new.com"
        viewModel.apiToken = "new-token"
        viewModel.deviceName = "New Device"
        viewModel.lookbackDays = 10
        viewModel.save()

        let loaded = ServerConfig.load()
        XCTAssertEqual(loaded.serverURL, "https://new.com")
        XCTAssertEqual(loaded.apiToken, "new-token")
        XCTAssertEqual(loaded.deviceName, "New Device")
        XCTAssertEqual(loaded.lookbackDays, 10)
    }
}
