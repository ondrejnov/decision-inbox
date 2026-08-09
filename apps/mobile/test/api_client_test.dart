import 'dart:convert';

import 'package:decision_inbox/src/api_client.dart';
import 'package:decision_inbox/src/models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('sends the token and pagination to the BFF', () async {
    late http.Request captured;
    final client = MockClient((request) async {
      captured = request;
      return http.Response(
        jsonEncode({
          'items': <Object>[],
          'page': 2,
          'pageSize': 20,
          'hasNext': false,
        }),
        200,
      );
    });
    final api = BffApiClient(
      bffUrl: 'https://decisions.example',
      client: client,
    );

    final page = await api.getDecisions(
      'secret-token',
      DecisionView.history,
      2,
    );

    expect(captured.url.path, '/v1/decisions');
    expect(captured.url.queryParameters, {'view': 'history', 'page': '2'});
    expect(captured.headers['X-Auth-Token'], 'secret-token');
    expect(page.page, 2);
  });

  test('preserves API error codes for stale decisions', () async {
    final client = MockClient(
      (_) async => http.Response(
        jsonEncode({
          'error': {
            'code': 'already_resolved',
            'message': 'Decision was already resolved.',
          },
        }),
        409,
      ),
    );
    final api = BffApiClient(
      bffUrl: 'https://decisions.example',
      client: client,
    );

    expect(
      () => api.resolve('token', {
        'decisionKind': 'approval',
        'externalId': 'approval-1',
        'taskId': 'task-1',
        'runId': 'run-1',
        'action': 'approve',
      }),
      throwsA(
        isA<ApiException>()
            .having((error) => error.status, 'status', 409)
            .having((error) => error.code, 'code', 'already_resolved'),
      ),
    );
  });

  test('registers and unregisters the current Android installation', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response(jsonEncode({'ok': true}), 200);
    });
    final api = BffApiClient(
      bffUrl: 'https://decisions.example',
      client: client,
    );

    await api.registerPushDevice(
      'secret-token',
      installationId: 'installation-1',
      pushToken: 'fcm-token',
    );
    await api.unregisterPushDevice('secret-token', 'installation-1');

    expect(requests, hasLength(2));
    expect(requests.first.method, 'PUT');
    expect(requests.first.url.path, '/v1/push/registration');
    expect(requests.first.headers['X-Auth-Token'], 'secret-token');
    expect(jsonDecode(requests.first.body), {
      'installationId': 'installation-1',
      'pushToken': 'fcm-token',
      'platform': 'android',
    });
    expect(requests.last.method, 'DELETE');
    expect(requests.last.url.path, '/v1/push/registration/installation-1');
  });

  test('parses valid SSE hints and sends Last-Event-ID', () async {
    late http.Request captured;
    final client = MockClient((request) async {
      captured = request;
      return http.Response(
        ': connected\n\n'
        'data: not-json\n\n'
        'id: evt-2\n'
        'data: {"schema_version":1,"event_id":"evt-2","transition":"created","decision_kind":"question","external_id":"question-1","task_id":"task-1","run_id":"run-1","status":"pending","occurred_at":"2026-08-07T10:00:00.000Z"}\n\n',
        200,
        headers: {'content-type': 'text/event-stream'},
      );
    });
    final api = BffApiClient(
      bffUrl: 'https://decisions.example',
      client: client,
    );

    final events = await api.events('token', lastEventId: 'evt-1').toList();

    expect(captured.url.path, '/v1/events');
    expect(captured.headers['Last-Event-ID'], 'evt-1');
    expect(events, hasLength(1));
    expect(events.single.id, 'evt-2');
    expect(events.single.kind, DecisionKind.question);
  });
}
