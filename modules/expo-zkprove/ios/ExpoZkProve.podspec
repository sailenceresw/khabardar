Pod::Spec.new do |s|
  s.name           = 'ExpoZkProve'
  s.version        = '0.1.0'
  s.summary        = 'On-device Groth16 proving for Semaphore'
  s.description    = 'Generates zero-knowledge proofs on the device, so anonymous membership can be proved without a server ever seeing the identity.'
  s.author         = 'Khabardar'
  s.homepage       = 'https://github.com/khabardar/khabardar'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'LIBRARY_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/lib"',
    'SWIFT_INCLUDE_PATHS' => '"$(PODS_TARGET_SRCROOT)"',
    'OTHER_LDFLAGS' => '-lkhabardar_zkprove'
  }

  s.source_files   = '**/*.{h,m,mm,swift,hpp,cpp}'
  s.preserve_paths = 'lib/**/*'

  # Built by scripts/build-ios.sh. The build fails loudly without it rather
  # than shipping an app whose prover cannot start.
  s.vendored_libraries = 'lib/libkhabardar_zkprove.a'
end
