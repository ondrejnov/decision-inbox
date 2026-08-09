import 'dart:async';

import 'package:decision_inbox/src/api_client.dart';
import 'package:decision_inbox/src/app_controller.dart';
import 'package:decision_inbox/src/models.dart';
import 'package:decision_inbox/src/notification_service.dart';
import 'package:decision_inbox/src/storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('an old account response cannot populate a new account inbox', () async {
    final api = _DelayedApi();
    final storage = _MemoryStorage()..token = 'account-a';
    final controller = AppController(
      api: api,
      storage: storage,
      notifications: _FakeNotifications(),
    );

    final initialization = controller.initialize();
    await api.firstRequestStarted.future;
    await controller.logout();
    api.firstResponse.complete(_page('account-a-decision'));
    await initialization;

    expect(controller.status, AppStatus.signedOut);
    expect(controller.decisionPage, isNull);

    await controller.connect('account-b');

    expect(controller.status, AppStatus.signedIn);
    expect(
      controller.decisionPage?.items.single.externalId,
      'account-b-decision',
    );
    controller.dispose();
  });

  test('registers after login and unregisters on logout', () async {
    final api = _DelayedApi();
    final notifications = _FakeNotifications()..pushToken = 'fcm-token';
    final controller = AppController(
      api: api,
      storage: _MemoryStorage(),
      notifications: notifications,
    );

    await controller.connect('account-b');
    await pumpEventQueue();

    expect(api.registered, [('account-b', 'installation-1', 'fcm-token')]);

    await controller.logout();

    expect(api.unregistered, [('account-b', 'installation-1')]);
    expect(notifications.deletedToken, isTrue);
    controller.dispose();
  });

  test('a new login waits until the previous logout finishes', () async {
    final api = _DelayedApi();
    final storage = _MemoryStorage();
    final notifications = _FakeNotifications()..pushToken = 'fcm-token';
    final controller = AppController(
      api: api,
      storage: storage,
      notifications: notifications,
    );
    await controller.connect('account-b');
    api.unregisterBarrier = Completer<void>();

    final logout = controller.logout();
    await pumpEventQueue();
    final login = controller.connect('account-c');
    await pumpEventQueue();

    expect(api.sessionTokens, isNot(contains('account-c')));

    api.unregisterBarrier!.complete();
    await logout;
    await login;

    expect(storage.token, 'account-c');
    expect(controller.session?.userId, 'account-c');
    expect(controller.status, AppStatus.signedIn);
    controller.dispose();
  });

  test('retries a pending FCM token deletion on startup', () async {
    final storage = _MemoryStorage()..pushTokenDeletionPending = true;
    final notifications = _FakeNotifications();
    final controller = AppController(
      api: _DelayedApi(),
      storage: storage,
      notifications: notifications,
    );

    await controller.initialize();

    expect(notifications.deletedToken, isTrue);
    expect(storage.pushTokenDeletionPending, isFalse);
    controller.dispose();
  });

  test('keeps a pending FCM deletion when messaging is unavailable', () async {
    final storage = _MemoryStorage()..pushTokenDeletionPending = true;
    final notifications = _FakeNotifications()..deleteFails = true;
    final controller = AppController(
      api: _DelayedApi(),
      storage: storage,
      notifications: notifications,
    );

    await controller.initialize();

    expect(storage.pushTokenDeletionPending, isTrue);
    controller.dispose();
  });

  test(
    'rapid notification disable and enable leaves the device registered',
    () async {
      final api = _DelayedApi();
      final notifications = _FakeNotifications()..pushToken = 'fcm-token-1';
      final controller = AppController(
        api: api,
        storage: _MemoryStorage(),
        notifications: notifications,
      );
      await controller.connect('account-b');
      await pumpEventQueue();
      notifications.deleteBarrier = Completer<void>();

      final disable = controller.updateSettings(
        const AppSettings(notificationsEnabled: false),
      );
      await pumpEventQueue();
      notifications.generatedPushToken = 'fcm-token-2';
      final enable = controller.updateSettings(const AppSettings());
      await pumpEventQueue();
      expect(api.pushOperations, ['register:fcm-token-1']);
      notifications.deleteBarrier!.complete();
      await disable;
      await enable;
      await pumpEventQueue();

      expect(api.pushOperations, [
        'register:fcm-token-1',
        'unregister',
        'register:fcm-token-2',
      ]);
      controller.dispose();
    },
  );
}

DecisionPage _page(String externalId) => DecisionPage(
  items: [
    Decision(
      externalId: externalId,
      kind: DecisionKind.approval,
      status: 'pending',
      title: 'Approval',
      taskId: 'task-1',
      runId: 'run-1',
      createdAt: DateTime.utc(2026, 8, 7),
      approval: const DecisionApproval(commentAllowed: true),
    ),
  ],
  page: 1,
  pageSize: 20,
  hasNext: false,
);

class _DelayedApi implements DecisionApi {
  final firstRequestStarted = Completer<void>();
  final firstResponse = Completer<DecisionPage>();
  final registered = <(String, String, String)>[];
  final unregistered = <(String, String)>[];
  final sessionTokens = <String>[];
  final pushOperations = <String>[];
  Completer<void>? unregisterBarrier;

  @override
  Uri get agentisUrl => Uri.parse('https://agentis.example');

  @override
  Uri get serviceUrl => Uri.parse('https://decisions.example');

  @override
  Stream<DecisionEvent> events(
    String token, {
    String? lastEventId,
    void Function()? onConnected,
  }) => const Stream.empty();

  @override
  Future<DecisionPage> getDecisions(String token, DecisionView view, int page) {
    if (token == 'account-a') {
      if (!firstRequestStarted.isCompleted) firstRequestStarted.complete();
      return firstResponse.future;
    }
    return Future.value(_page('account-b-decision'));
  }

  @override
  Future<int> getPendingCount(String token) async => 1;

  @override
  Future<void> registerPushDevice(
    String token, {
    required String installationId,
    required String pushToken,
  }) async {
    registered.add((token, installationId, pushToken));
    pushOperations.add('register:$pushToken');
  }

  @override
  Future<Session?> getSession(String token) async {
    sessionTokens.add(token);
    return Session(userId: token, displayName: token, tenantId: token);
  }

  @override
  Future<void> resolve(String token, JsonMap request) async {}

  @override
  Future<void> unregisterPushDevice(String token, String installationId) async {
    unregistered.add((token, installationId));
    pushOperations.add('unregister');
    await unregisterBarrier?.future;
  }
}

class _MemoryStorage implements AppStorage {
  String? token;
  Set<String> baseline = {};
  bool baselineInitialized = false;
  bool pushTokenDeletionPending = false;

  @override
  Future<void> clearToken() async {
    token = null;
    baseline = {};
    baselineInitialized = false;
  }

  @override
  Future<Set<String>> readNotificationBaseline() async => baseline;

  @override
  Future<bool> readNotificationBaselineInitialized() async =>
      baselineInitialized;

  @override
  Future<String> readOrCreateInstallationId() async => 'installation-1';

  @override
  Future<bool> readPushTokenDeletionPending() async => pushTokenDeletionPending;

  @override
  Future<void> resetNotificationBaseline() async {
    baseline = {};
    baselineInitialized = false;
  }

  @override
  Future<AppSettings> readSettings() async => const AppSettings();

  @override
  Future<String?> readToken() async => token;

  @override
  Future<void> writeNotificationBaseline(Set<String> keys) async {
    baseline = {...keys};
    baselineInitialized = true;
  }

  @override
  Future<void> writePushTokenDeletionPending(bool pending) async {
    pushTokenDeletionPending = pending;
  }

  @override
  Future<void> writeSettings(AppSettings settings) async {}

  @override
  Future<void> writeToken(String nextToken) async => token = nextToken;
}

class _FakeNotifications extends NotificationService {
  final StreamController<void> _taps = StreamController<void>.broadcast();
  String? pushToken;
  String? generatedPushToken;
  bool deletedToken = false;
  bool deleteFails = false;
  Completer<void>? deleteBarrier;

  @override
  Future<String?> currentPushToken() async {
    pushToken ??= generatedPushToken;
    return pushToken;
  }

  @override
  Future<void> deletePushToken() async {
    if (deleteFails) throw StateError('Firebase messaging is unavailable.');
    await deleteBarrier?.future;
    deletedToken = true;
    pushToken = null;
  }

  @override
  Stream<void> get pendingTaps => _taps.stream;

  @override
  Future<void> initialize() async {}

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> showPendingSummary({
    required int questions,
    required int approvals,
  }) async {}
}
