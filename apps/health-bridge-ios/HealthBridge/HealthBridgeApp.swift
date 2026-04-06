import SwiftUI

@main
struct HealthBridgeApp: App {
    @StateObject private var homeViewModel: HomeViewModel
    @StateObject private var settingsViewModel: SettingsViewModel
    @StateObject private var backgroundSyncManager: BackgroundSyncManager
    @StateObject private var debugViewModel: DebugViewModel

    init() {
        let networkService = NetworkService.shared
        let healthKitService = HealthKitService()
        let backgroundSyncManager = BackgroundSyncManager(
            healthKitService: healthKitService,
            networkService: networkService
        )

        _homeViewModel = StateObject(
            wrappedValue: HomeViewModel(
                healthKitService: healthKitService,
                networkService: networkService
            )
        )
        _settingsViewModel = StateObject(
            wrappedValue: SettingsViewModel(networkService: networkService)
        )
        _backgroundSyncManager = StateObject(wrappedValue: backgroundSyncManager)
        _debugViewModel = StateObject(
            wrappedValue: DebugViewModel(
                networkService: networkService,
                backgroundSyncManager: backgroundSyncManager
            )
        )
    }

    var body: some Scene {
        WindowGroup {
            ContentView(
                homeViewModel: homeViewModel,
                settingsViewModel: settingsViewModel,
                backgroundSyncManager: backgroundSyncManager,
                debugViewModel: debugViewModel
            )
            .task {
                homeViewModel.refreshAuthorizationState()
                await homeViewModel.checkConnection()
                backgroundSyncManager.setupBackgroundDelivery()
            }
        }
    }
}
