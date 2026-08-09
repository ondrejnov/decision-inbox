# Decision Inbox for Android

Flutter client for reviewing Agentis questions and approvals on Android. It uses the same BFF contract as the Electron desktop application.

## Features

- Agentis token onboarding with Android Keystore-backed storage
- Pending and history views with pagination and pull-to-refresh
- Single-choice, multiple-choice, and freeform question replies
- Immediate approval and rejection with optional comments
- Read-only in-memory snapshots when the BFF is unavailable
- SSE updates with `Last-Event-ID`, idle detection, and exponential reconnect
- FCM delivery while backgrounded or terminated, plus deduplicated foreground notifications without decision content
- External links to the source Agentis task and run

Desktop-only tray, close-to-tray, and login-autostart settings do not apply on Android.

## Requirements

- Flutter 3.44 or newer
- Android SDK 35 or newer
- JDK 17 or newer

## Development

The production service URLs are compiled in by default:

- `DECISION_BFF_URL=https://agapprove.agentis.cz`
- `AGENTIS_WEB_URL=https://agentis.cz`

Run against the local BFF from an Android emulator with:

```bash
flutter run \
  --dart-define=DECISION_BFF_URL=http://10.0.2.2:8787 \
  --dart-define=AGENTIS_WEB_URL=https://agentis.cz
```

Cleartext HTTP is accepted only for `localhost` and `10.0.2.2` in debug builds. Release builds reject cleartext traffic.

### Firebase

Push is enabled when all four public Firebase Android app values are compiled in. This project initializes Firebase from Dart defines and does not require a committed `google-services.json`:

```bash
flutter run \
  --dart-define=DECISION_BFF_URL=http://10.0.2.2:8787 \
  --dart-define-from-file=firebase-defines.json
```

The local ignored `firebase-defines.json` is derived from the downloaded Firebase Android configuration. The Firebase Android app must use package name `cz.agentis.decision_inbox`. Debug builds remain usable with foreground SSE/local notifications when Firebase values are omitted. Release builds fail if any Firebase value is missing. The BFF must use the same Firebase project and be configured with `FIREBASE_PROJECT_ID` plus Application Default Credentials allowed to send FCM messages.

Run validation and produce a debug APK:

```bash
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
flutter build apk --debug
```

The debug APK is written to `build/app/outputs/flutter-apk/app-debug.apk`.

## Release Signing

Release builds intentionally fail unless all signing variables are available:

```bash
export DECISION_INBOX_KEYSTORE=/secure/path/decision-inbox.jks
export DECISION_INBOX_STORE_PASSWORD=...
export DECISION_INBOX_KEY_ALIAS=decision-inbox
export DECISION_INBOX_KEY_PASSWORD=...
flutter build appbundle --release
```

Pass the Firebase values to the release build with `--dart-define-from-file=firebase-defines.json`. Signing credentials and keystores must remain outside the repository.

## Security

- The Agentis token, stable installation ID, and notification baseline are stored with `flutter_secure_storage`.
- Android application backup is disabled so encrypted preferences are not restored without their Keystore key.
- Authenticated HTTP requests do not follow redirects and the production BFF must use HTTPS.
- Push payloads contain only a route and opaque event ID; notification persistence contains decision identity keys, never prompts, summaries, answers, or comments.
- The BFF derives tenant/user ownership from the Agentis session and stores device registration metadata in SQLite; the mobile client never sends tenant or user IDs.
- Offline snapshots are process-memory only and never allow resolve actions.

## Background Delivery

After authentication, the app registers its current FCM token and stable installation ID with the BFF. Token rotation is synchronized automatically; disabling notifications or logging out unregisters the installation and deletes the local FCM token. Registration is retried after login, token rotation, and app resume.

The BFF sends only generic `created`/`pending` notifications. Android displays them while the app is backgrounded or terminated. Tapping a notification opens the pending inbox and performs an authenticated refresh; the push payload is never treated as authoritative decision content. Foreground FCM and SSE hints share the encrypted decision baseline to avoid duplicate local alerts.

Android force-stop blocks FCM until the user opens the app again. Delivery also depends on Firebase/Google Play services, device power policy, Android notification permission, valid BFF credentials, and successful device registration. Live delivery therefore requires a Firebase-enabled APK and a configured BFF; automated tests use fakes rather than contacting FCM.
