Pod::Spec.new do |s|
  s.name           = 'ExpoTor'
  s.version        = '0.1.0'
  s.summary        = 'Embedded Arti (Tor) client exposing a loopback SOCKS5 proxy'
  s.description    = 'Runs Tor in-process via Arti and performs HTTP through it, so the app never contacts a server directly.'
  s.author         = 'Khabardar'
  s.homepage       = 'https://github.com/khabardar/khabardar'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    # Where the Rust staticlib lands (see scripts/build-ios.sh).
    'LIBRARY_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/lib"',
    'SWIFT_INCLUDE_PATHS' => '"$(PODS_TARGET_SRCROOT)"',
    'OTHER_LDFLAGS' => '-lkhabardar_tor'
  }

  s.source_files   = '**/*.{h,m,mm,swift,hpp,cpp}'
  s.preserve_paths = 'lib/**/*', 'module.modulemap'

  # The Arti staticlib. Built by scripts/build-ios.sh; the build fails loudly
  # if it is missing rather than shipping an app whose Tor cannot start.
  s.vendored_libraries = 'lib/libkhabardar_tor.a'
end
