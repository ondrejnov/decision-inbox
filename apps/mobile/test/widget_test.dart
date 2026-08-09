import 'package:decision_inbox/src/api_client.dart';
import 'package:decision_inbox/src/app.dart';
import 'package:decision_inbox/src/app_controller.dart';
import 'package:decision_inbox/src/decision_card.dart';
import 'package:decision_inbox/src/models.dart';
import 'package:decision_inbox/src/notification_service.dart';
import 'package:decision_inbox/src/storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shows secure onboarding when signed out', (tester) async {
    final controller = _controller()..status = AppStatus.signedOut;

    await tester.pumpWidget(DecisionInboxApp(controller: controller));

    expect(find.text('Connect your Agentis account'), findsOneWidget);
    expect(find.text('Agentis token'), findsOneWidget);
    expect(find.text('Test connection'), findsOneWidget);
  });

  testWidgets('required question enables submit after a selection', (
    tester,
  ) async {
    final controller = _controller();
    final decision = Decision(
      externalId: 'question-1',
      kind: DecisionKind.question,
      status: 'pending',
      title: 'Choose a target',
      taskId: 'task-1',
      runId: 'run-1',
      createdAt: _createdAt,
      questions: [
        DecisionQuestion(
          id: 'target',
          prompt: 'Choose a target',
          options: [DecisionOption(id: 'prod', label: 'Production')],
          multiple: false,
          required: true,
          allowFreeformInput: false,
        ),
      ],
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: DecisionCard(
              decision: decision,
              controller: controller,
              readOnly: false,
            ),
          ),
        ),
      ),
    );

    FilledButton submit = tester.widget(
      find.widgetWithText(FilledButton, 'Submit answers'),
    );
    expect(submit.onPressed, isNull);

    await tester.tap(find.text('Production'));
    await tester.pump();

    submit = tester.widget(find.widgetWithText(FilledButton, 'Submit answers'));
    expect(submit.onPressed, isNotNull);
  });
}

final _createdAt = DateTime.utc(2026, 8, 7, 10);

AppController _controller() => AppController(
  api: _FakeApi(),
  storage: _FakeStorage(),
  notifications: NotificationService(),
);

class _FakeApi implements DecisionApi {
  @override
  Uri get agentisUrl => Uri.parse('https://agentis.example');

  @override
  Uri get serviceUrl => Uri.parse('https://decisions.example');

  @override
  Stream<DecisionEvent> events(
    String token, {
    String? lastEventId,
    void Function()? onConnected,
  }) {
    onConnected?.call();
    return const Stream.empty();
  }

  @override
  Future<DecisionPage> getDecisions(
    String token,
    DecisionView view,
    int page,
  ) async =>
      const DecisionPage(items: [], page: 1, pageSize: 20, hasNext: false);

  @override
  Future<int> getPendingCount(String token) async => 0;

  @override
  Future<void> registerPushDevice(
    String token, {
    required String installationId,
    required String pushToken,
  }) async {}

  @override
  Future<Session?> getSession(String token) async => null;

  @override
  Future<void> resolve(String token, JsonMap request) async {}

  @override
  Future<void> unregisterPushDevice(
    String token,
    String installationId,
  ) async {}
}

class _FakeStorage implements AppStorage {
  @override
  Future<void> clearToken() async {}

  @override
  Future<Set<String>> readNotificationBaseline() async => {};

  @override
  Future<bool> readNotificationBaselineInitialized() async => false;

  @override
  Future<String> readOrCreateInstallationId() async => 'installation-1';

  @override
  Future<bool> readPushTokenDeletionPending() async => false;

  @override
  Future<void> resetNotificationBaseline() async {}

  @override
  Future<AppSettings> readSettings() async => const AppSettings();

  @override
  Future<String?> readToken() async => null;

  @override
  Future<void> writeNotificationBaseline(Set<String> keys) async {}

  @override
  Future<void> writePushTokenDeletionPending(bool pending) async {}

  @override
  Future<void> writeSettings(AppSettings settings) async {}

  @override
  Future<void> writeToken(String token) async {}
}
