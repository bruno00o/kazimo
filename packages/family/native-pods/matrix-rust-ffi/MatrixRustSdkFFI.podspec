Pod::Spec.new do |s|
  s.name         = "MatrixRustSdkFFI"
  s.version      = "0.9.1"
  s.summary      = "Vendored matrix-rust-sdk FFI static xcframework for extension targets"
  s.homepage     = "https://github.com/unomed-dev/react-native-matrix-sdk"
  s.license      = { :type => "Apache-2.0" }
  s.authors      = { "Kazimo" => "kazimo@example.invalid" }
  s.source       = { :git => "https://github.com/unomed-dev/react-native-matrix-sdk.git", :tag => s.version.to_s }
  s.platforms    = { :ios => "16.0" }
  s.vendored_frameworks = "RnMatrixRustSdk.xcframework"
end
