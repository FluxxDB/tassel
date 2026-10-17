import AVFoundation
let types: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera, .continuityCamera, .deskViewCamera, .external]
let session = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified)
for d in session.devices {
    print("\(d.localizedName) | type=\(d.deviceType.rawValue) | model=\(d.modelID) | id=\(d.uniqueID)")
}
print("camera authorization status (0=notDetermined,1=restricted,2=denied,3=authorized):", AVCaptureDevice.authorizationStatus(for: .video).rawValue)
