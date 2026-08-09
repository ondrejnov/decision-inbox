import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

FirebaseOptions? _firebaseOptions() {
  const apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  const appId = String.fromEnvironment('FIREBASE_APP_ID');
  const messagingSenderId = String.fromEnvironment(
    'FIREBASE_MESSAGING_SENDER_ID',
  );
  const projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  if ([
    apiKey,
    appId,
    messagingSenderId,
    projectId,
  ].any((value) => value.isEmpty)) {
    return null;
  }
  return const FirebaseOptions(
    apiKey: apiKey,
    appId: appId,
    messagingSenderId: messagingSenderId,
    projectId: projectId,
  );
}

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  final options = _firebaseOptions();
  if (options == null) return;
  if (Firebase.apps.isEmpty) await Firebase.initializeApp(options: options);
}

class PushHint {
  const PushHint({required this.eventId});

  factory PushHint.fromMessage(RemoteMessage message) {
    if (message.data['schema_version'] != '1' ||
        message.data['route'] != 'pending') {
      throw const FormatException('Unsupported push payload.');
    }
    final eventId = message.data['event_id'];
    if (eventId == null || eventId.isEmpty) {
      throw const FormatException('Push payload has no event identity.');
    }
    return PushHint(eventId: eventId);
  }

  final String eventId;
}

class NotificationService {
  NotificationService({
    FlutterLocalNotificationsPlugin? plugin,
    FirebaseMessaging? messaging,
  }) : _plugin = plugin ?? FlutterLocalNotificationsPlugin(),
       _messagingOverride = messaging;

  static const _channel = AndroidNotificationChannel(
    'decision_inbox_pending',
    'Pending decisions',
    description: 'Generic alerts for new questions and approvals.',
    importance: Importance.high,
  );

  final FlutterLocalNotificationsPlugin _plugin;
  final FirebaseMessaging? _messagingOverride;
  final StreamController<void> _pendingTaps = StreamController.broadcast();
  final StreamController<String> _pushTokens = StreamController.broadcast();
  final StreamController<PushHint> _pushHints = StreamController.broadcast();
  FirebaseMessaging? _messaging;
  StreamSubscription<String>? _tokenSubscription;
  StreamSubscription<RemoteMessage>? _messageSubscription;
  StreamSubscription<RemoteMessage>? _openedSubscription;

  Stream<void> get pendingTaps => _pendingTaps.stream;
  Stream<String> get pushTokens => _pushTokens.stream;
  Stream<PushHint> get pushHints => _pushHints.stream;

  static void configureBackgroundHandling() {
    if (_firebaseOptions() != null) {
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    }
  }

  Future<void> initialize() async {
    await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      ),
      onDidReceiveNotificationResponse: (response) {
        if (response.payload == 'pending') _pendingTaps.add(null);
      },
    );
    await _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(_channel);
    final launch = await _plugin.getNotificationAppLaunchDetails();
    if (launch?.didNotificationLaunchApp == true &&
        launch?.notificationResponse?.payload == 'pending') {
      _pendingTaps.add(null);
    }

    final options = _firebaseOptions();
    if (options == null) return;
    if (Firebase.apps.isEmpty) await Firebase.initializeApp(options: options);
    final messaging = _messagingOverride ?? FirebaseMessaging.instance;
    _messaging = messaging;
    _tokenSubscription = messaging.onTokenRefresh.listen(_pushTokens.add);
    _messageSubscription = FirebaseMessaging.onMessage.listen((message) {
      try {
        _pushHints.add(PushHint.fromMessage(message));
      } on FormatException {
        // Pushes are hints only; malformed payloads are ignored.
      }
    });
    _openedSubscription = FirebaseMessaging.onMessageOpenedApp.listen((
      message,
    ) {
      if (message.data['route'] == 'pending') _pendingTaps.add(null);
    });
    final initialMessage = await messaging.getInitialMessage();
    if (initialMessage?.data['route'] == 'pending') _pendingTaps.add(null);
  }

  Future<void> requestPermission() async {
    await _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.requestNotificationsPermission();
    await _messaging?.requestPermission(alert: true, badge: true, sound: false);
  }

  Future<String?> currentPushToken() async {
    return _messaging?.getToken();
  }

  Future<void> deletePushToken() async {
    final messaging = _messaging;
    if (messaging == null) {
      throw StateError('Firebase messaging is unavailable.');
    }
    await messaging.deleteToken();
  }

  Future<void> showPendingSummary({
    required int questions,
    required int approvals,
  }) async {
    final total = questions + approvals;
    if (total == 0) return;
    final parts = <String>[
      if (questions > 0)
        '$questions ${questions == 1 ? 'question' : 'questions'}',
      if (approvals > 0)
        '$approvals ${approvals == 1 ? 'approval' : 'approvals'}',
    ];
    await _plugin.show(
      id: 1001,
      title: 'Decision Inbox',
      body:
          '${parts.join(' and ')} ${total == 1 ? 'requires' : 'require'} your attention',
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          _channel.id,
          _channel.name,
          channelDescription: _channel.description,
          importance: Importance.high,
          priority: Priority.high,
          playSound: false,
          category: AndroidNotificationCategory.reminder,
        ),
      ),
      payload: 'pending',
    );
  }

  void dispose() {
    unawaited(_tokenSubscription?.cancel());
    unawaited(_messageSubscription?.cancel());
    unawaited(_openedSubscription?.cancel());
    unawaited(_pendingTaps.close());
    unawaited(_pushTokens.close());
    unawaited(_pushHints.close());
  }
}
