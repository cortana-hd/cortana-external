import XCTest
@testable import HealthBridge

final class ServerConfigTests: XCTestCase {
    override func setUp() {
        super.setUp()
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "healthbridge_serverURL")
        defaults.removeObject(forKey: "healthbridge_apiToken")
        defaults.removeObject(forKey: "healthbridge_deviceName")
        defaults.removeObject(forKey: "healthbridge_lookbackDays")
    }

    override func tearDown() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "healthbridge_serverURL")
        defaults.removeObject(forKey: "healthbridge_apiToken")
        defaults.removeObject(forKey: "healthbridge_deviceName")
        defaults.removeObject(forKey: "healthbridge_lookbackDays")
        super.tearDown()
    }

    func testDeviceIdFromDeviceName() {
        let config = ServerConfig(serverURL: "", apiToken: "", deviceName: "My iPhone 15", lookbackDays: 7)
        XCTAssertEqual(config.deviceId, "my-iphone-15")
    }

    func testResolvedLookbackDaysIsBounded() {
        XCTAssertEqual(ServerConfig(serverURL: "", apiToken: "", deviceName: "", lookbackDays: 0).resolvedLookbackDays, 1)
        XCTAssertEqual(ServerConfig(serverURL: "", apiToken: "", deviceName: "", lookbackDays: 99).resolvedLookbackDays, 30)
    }
}
