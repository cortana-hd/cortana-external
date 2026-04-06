import SwiftUI

struct ContentView: View {
    @ObservedObject var homeViewModel: HomeViewModel
    @ObservedObject var settingsViewModel: SettingsViewModel
    @ObservedObject var backgroundSyncManager: BackgroundSyncManager
    @ObservedObject var debugViewModel: DebugViewModel

    var body: some View {
        TabView {
            HomeView(
                viewModel: homeViewModel,
                backgroundSyncManager: backgroundSyncManager
            )
            .tabItem {
                Label("Home", systemImage: "heart.text.square")
            }

            SettingsView(viewModel: settingsViewModel)
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }

            DebugView(viewModel: debugViewModel)
                .tabItem {
                    Label("Debug", systemImage: "ladybug")
                }
        }
    }
}
