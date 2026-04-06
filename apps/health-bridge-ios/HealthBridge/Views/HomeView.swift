import SwiftUI

struct HomeView: View {
    @ObservedObject var viewModel: HomeViewModel
    @ObservedObject var backgroundSyncManager: BackgroundSyncManager

    var body: some View {
        NavigationView {
            List {
                Section(header: Text("Status")) {
                    statusRow("Server", value: viewModel.connectionStatus.label)
                    statusRow("Apple Health", value: viewModel.isHealthKitAuthorized ? "Authorized" : "Not Authorized")
                    if let serviceHealthStatus = viewModel.serviceHealthStatus {
                        statusRow("Remote Import Health", value: serviceHealthStatus)
                    }
                }

                Section(header: Text("Actions")) {
                    Button("Request Apple Health Access") {
                        Task { await viewModel.requestHealthAccess() }
                    }

                    Button("Check Server Connection") {
                        Task { await viewModel.checkConnection() }
                    }

                    Button {
                        Task { await viewModel.syncNow() }
                    } label: {
                        HStack {
                            if viewModel.isSyncing {
                                ProgressView()
                            } else {
                                Image(systemName: "arrow.triangle.2.circlepath")
                            }
                            Text(viewModel.isSyncing ? "Syncing..." : "Sync Apple Health Now")
                        }
                    }
                    .disabled(viewModel.isSyncing)
                }

                if let result = viewModel.lastSyncResult {
                    Section(header: Text("Last Manual Sync")) {
                        syncResultView(result)
                    }
                }

                if let result = backgroundSyncManager.lastBackgroundSync {
                    Section(header: Text("Last Background Sync")) {
                        syncResultView(result)
                    }
                }
            }
            .navigationTitle("HealthBridge")
        }
    }

    @ViewBuilder
    private func statusRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .foregroundColor(.secondary)
        }
    }

    @ViewBuilder
    private func syncResultView(_ result: SyncResult) -> some View {
        statusRow("Success", value: result.success ? "Yes" : "No")
        statusRow("Imported Days", value: "\(result.importedDays)")
        if !result.importedMetrics.isEmpty {
            statusRow("Metrics", value: result.importedMetrics.joined(separator: ", "))
        }
        if let errorMessage = result.errorMessage {
            Text(errorMessage)
                .font(.footnote)
                .foregroundColor(.red)
        }
    }
}
