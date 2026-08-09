import 'package:decision_inbox/src/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses the desktop decision contract', () {
    final page = DecisionPage.fromJson({
      'items': [
        {
          'externalId': 'approval-1',
          'kind': 'approval',
          'status': 'answered',
          'title': 'Deploy production',
          'taskId': 'task-1',
          'runId': 'run-1',
          'taskNumber': 42,
          'taskTitle': 'Release',
          'createdAt': '2026-08-07T10:00:00.000Z',
          'resolvedAt': '2026-08-07T10:05:00.000Z',
          'approval': {
            'commentAllowed': true,
            'approved': true,
            'comment': 'Reviewed',
          },
        },
      ],
      'page': 1,
      'pageSize': 20,
      'total': 1,
      'hasNext': false,
    });

    expect(page.total, 1);
    expect(page.items.single.kind, DecisionKind.approval);
    expect(page.items.single.approval?.approved, isTrue);
    expect(page.items.single.taskLabel, '#42 Release');
  });

  test('rejects malformed required contract fields', () {
    expect(
      () => DecisionPage.fromJson({
        'items': [
          {
            'externalId': '',
            'kind': 'question',
            'status': 'pending',
            'title': 'Question',
            'taskId': 'task-1',
            'runId': 'run-1',
            'createdAt': '2026-08-07T10:00:00.000Z',
          },
        ],
        'page': 1,
        'pageSize': 20,
        'hasNext': false,
      }),
      throwsFormatException,
    );
  });
}
