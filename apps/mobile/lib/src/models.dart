typedef JsonMap = Map<String, dynamic>;

class ApiException implements Exception {
  const ApiException(this.message, {this.code, this.status});

  final String message;
  final String? code;
  final int? status;

  bool get requiresAuthentication => status == 401 || status == 403;

  @override
  String toString() => message;
}

class Session {
  const Session({
    required this.userId,
    required this.displayName,
    required this.tenantId,
    this.tenantName,
  });

  factory Session.fromJson(JsonMap json) {
    if (json['authenticated'] != true) {
      throw const FormatException('Expected an authenticated session.');
    }
    final user = _map(json['user']);
    final tenant = _map(json['tenant']);
    return Session(
      userId: _identifier(user['id']),
      displayName: _content(user['displayName']),
      tenantId: _identifier(tenant['id']),
      tenantName: _optionalContent(tenant['name']),
    );
  }

  final String userId;
  final String displayName;
  final String tenantId;
  final String? tenantName;
}

enum DecisionKind { question, approval }

enum DecisionView { pending, history }

class DecisionOption {
  const DecisionOption({
    required this.id,
    required this.label,
    this.description,
    this.selected = false,
  });

  factory DecisionOption.fromJson(JsonMap json) => DecisionOption(
    id: _identifier(json['id']),
    label: _content(json['label']),
    description: _optionalContent(json['description']),
    selected: _optionalBoolean(json['selected']),
  );

  final String id;
  final String label;
  final String? description;
  final bool selected;
}

class DecisionQuestion {
  const DecisionQuestion({
    required this.id,
    required this.prompt,
    required this.options,
    required this.multiple,
    required this.required,
    required this.allowFreeformInput,
    this.header,
    this.answerText,
  });

  factory DecisionQuestion.fromJson(JsonMap json) => DecisionQuestion(
    id: _identifier(json['id']),
    header: _optionalContent(json['header']),
    prompt: _content(json['prompt']),
    options: _list(json['options'])
        .map((value) => DecisionOption.fromJson(_map(value)))
        .toList(growable: false),
    multiple: _boolean(json['multiple']),
    required: _boolean(json['required']),
    allowFreeformInput: _boolean(json['allowFreeformInput']),
    answerText: _optionalContent(json['answerText']),
  );

  final String id;
  final String? header;
  final String prompt;
  final List<DecisionOption> options;
  final bool multiple;
  final bool required;
  final bool allowFreeformInput;
  final String? answerText;
}

class DecisionApproval {
  const DecisionApproval({
    required this.commentAllowed,
    this.approved,
    this.comment,
  });

  factory DecisionApproval.fromJson(JsonMap json) => DecisionApproval(
    commentAllowed: _boolean(json['commentAllowed']),
    approved: json['approved'] == null ? null : _boolean(json['approved']),
    comment: _optionalContent(json['comment']),
  );

  final bool commentAllowed;
  final bool? approved;
  final String? comment;
}

class DecisionResolver {
  const DecisionResolver({required this.type, this.name, this.viaName});

  factory DecisionResolver.fromJson(JsonMap json) {
    final via = json['via'] == null ? null : _map(json['via']);
    return DecisionResolver(
      type: _identifier(json['type']),
      name: _optionalContent(json['name']),
      viaName: via == null ? null : _optionalContent(via['name']),
    );
  }

  final String type;
  final String? name;
  final String? viaName;
}

class Decision {
  const Decision({
    required this.externalId,
    required this.kind,
    required this.status,
    required this.title,
    required this.taskId,
    required this.runId,
    required this.createdAt,
    this.summary,
    this.taskTitle,
    this.taskNumber,
    this.projectName,
    this.projectFallback,
    this.updatedAt,
    this.resolvedAt,
    this.cancelledAt,
    this.cancellationReason,
    this.resolver,
    this.questions = const [],
    this.approval,
  });

  factory Decision.fromJson(JsonMap json) => Decision(
    externalId: _identifier(json['externalId']),
    kind: _decisionKind(json['kind']),
    status: _identifier(json['status']),
    title: _content(json['title']),
    summary: _optionalContent(json['summary']),
    taskId: _identifier(json['taskId']),
    runId: _identifier(json['runId']),
    taskTitle: _optionalContent(json['taskTitle']),
    taskNumber: json['taskNumber'] as int?,
    projectName: _optionalContent(json['projectName']),
    projectFallback: _optionalContent(json['projectFallback']),
    createdAt: _date(json['createdAt']),
    updatedAt: _optionalDate(json['updatedAt']),
    resolvedAt: _optionalDate(json['resolvedAt']),
    cancelledAt: _optionalDate(json['cancelledAt']),
    cancellationReason: _optionalContent(json['cancellationReason']),
    resolver: json['resolver'] == null
        ? null
        : DecisionResolver.fromJson(_map(json['resolver'])),
    questions: json['questions'] == null
        ? const []
        : _list(json['questions'])
              .map((value) => DecisionQuestion.fromJson(_map(value)))
              .toList(growable: false),
    approval: json['approval'] == null
        ? null
        : DecisionApproval.fromJson(_map(json['approval'])),
  );

  final String externalId;
  final DecisionKind kind;
  final String status;
  final String title;
  final String? summary;
  final String taskId;
  final String runId;
  final String? taskTitle;
  final int? taskNumber;
  final String? projectName;
  final String? projectFallback;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final DateTime? resolvedAt;
  final DateTime? cancelledAt;
  final String? cancellationReason;
  final DecisionResolver? resolver;
  final List<DecisionQuestion> questions;
  final DecisionApproval? approval;

  String get baselineKey => '${kind.name}:$externalId';
  String get taskLabel =>
      '${taskNumber == null ? '' : '#$taskNumber '}${taskTitle ?? 'Untitled'}';
  String get projectLabel => projectName ?? projectFallback ?? 'No project';
}

class DecisionPage {
  const DecisionPage({
    required this.items,
    required this.page,
    required this.pageSize,
    required this.hasNext,
    this.total,
  });

  factory DecisionPage.fromJson(JsonMap json) => DecisionPage(
    items: _list(
      json['items'],
    ).map((value) => Decision.fromJson(_map(value))).toList(growable: false),
    page: _integer(json['page']),
    pageSize: _integer(json['pageSize']),
    total: json['total'] as int?,
    hasNext: _boolean(json['hasNext']),
  );

  final List<Decision> items;
  final int page;
  final int pageSize;
  final int? total;
  final bool hasNext;
}

class DecisionEvent {
  const DecisionEvent({
    required this.id,
    required this.transition,
    required this.status,
    this.kind,
    this.externalId,
  });

  factory DecisionEvent.fromJson(JsonMap json) {
    if (json['schema_version'] != 1) {
      throw const FormatException('Unsupported event schema version.');
    }
    final transition = _identifier(json['transition']);
    if (!const {'created', 'answered', 'cancelled'}.contains(transition)) {
      throw const FormatException('Unknown decision transition.');
    }
    final kindValue = json['decision_kind'];
    _identifier(json['task_id']);
    _date(json['occurred_at']);
    return DecisionEvent(
      id: _identifier(json['event_id']),
      transition: transition,
      status: _identifier(json['status']),
      kind: kindValue == null ? null : _decisionKind(kindValue),
      externalId: _optionalIdentifier(json['external_id']),
    );
  }

  final String id;
  final String transition;
  final String status;
  final DecisionKind? kind;
  final String? externalId;
}

JsonMap _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  throw const FormatException('Expected a JSON object.');
}

List<dynamic> _list(Object? value) {
  if (value is List<dynamic>) return value;
  throw const FormatException('Expected a JSON list.');
}

String _identifier(Object? value) {
  if (value is String && value.trim().isNotEmpty) return value;
  throw const FormatException('Expected a non-empty string.');
}

String _content(Object? value) {
  if (value is String) return value;
  throw const FormatException('Expected a string.');
}

String? _optionalContent(Object? value) =>
    value == null ? null : _content(value);

String? _optionalIdentifier(Object? value) =>
    value == null ? null : _identifier(value);

bool _boolean(Object? value) {
  if (value is bool) return value;
  throw const FormatException('Expected a boolean.');
}

bool _optionalBoolean(Object? value) => value == null ? false : _boolean(value);

DecisionKind _decisionKind(Object? value) => switch (_identifier(value)) {
  'question' => DecisionKind.question,
  'approval' => DecisionKind.approval,
  _ => throw const FormatException('Unknown decision kind.'),
};

int _integer(Object? value) {
  if (value is int) return value;
  throw const FormatException('Expected an integer.');
}

DateTime _date(Object? value) => DateTime.parse(_identifier(value));

DateTime? _optionalDate(Object? value) => value == null ? null : _date(value);
