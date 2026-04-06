import SwiftUI

struct SettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel

    var body: some View {
        NavigationStack {
            Form {
                Section("Server Configuration") {
                    TextField("Server URL", text: $viewModel.serverURL)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .keyboardType(.URL)

                    SecureField("API Token (optional)", text: $viewModel.apiToken)

                    TextField("Device Name", text: $viewModel.deviceName)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)

                    Stepper(value: $viewModel.lookbackDays, in: 1...30) {
                        HStack {
                            Text("Lookback Days")
                            Spacer()
                            Text("\(viewModel.lookbackDays)")
                                .foregroundStyle(.secondary)
                        }
                    }

                    Text("Use the reachable Mac mini address, for example `http://192.168.1.50:3033`. Leave the token blank only if `APPLE_HEALTH_API_TOKEN` is unset on the server.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Actions") {
                    Button("Save Settings") {
                        viewModel.save()
                    }

                    Button {
                        Task { await viewModel.testConnection() }
                    } label: {
                        if viewModel.isTestingConnection {
                            HStack {
                                ProgressView()
                                Text("Testing Connection...")
                            }
                        } else {
                            Text("Test Connection")
                        }
                    }
                    .disabled(viewModel.isTestingConnection)

                    if let result = viewModel.connectionTestResult {
                        HStack {
                            Image(systemName: result ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundStyle(result ? .green : .red)
                            Text(result ? "Connection successful" : "Connection failed")
                                .foregroundStyle(result ? .green : .red)
                        }
                    }

                    if let status = viewModel.connectionTestStatus {
                        HStack {
                            Text("Remote Health")
                            Spacer()
                            Text(status)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("Info") {
                    HStack {
                        Text("App Version")
                        Spacer()
                        Text(HealthBridgeAppInfo.version())
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}
