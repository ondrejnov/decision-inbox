import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

abstract interface class DecisionApi {
  Uri get serviceUrl;
  Uri get agentisUrl;

  Future<Session?> getSession(String token);
  Future<DecisionPage> getDecisions(String token, DecisionView view, int page);
  Future<int> getPendingCount(String token);
  Future<void> registerPushDevice(
    String token, {
    required String installationId,
    required String pushToken,
  });
  Future<void> unregisterPushDevice(String token, String installationId);
  Future<void> resolve(String token, JsonMap request);
  Stream<DecisionEvent> events(
    String token, {
    String? lastEventId,
    void Function()? onConnected,
  });
}

class BffApiClient implements DecisionApi {
  BffApiClient({
    String bffUrl = const String.fromEnvironment(
      'DECISION_BFF_URL',
      defaultValue: 'https://agapprove.agentis.cz',
    ),
    String agentisWebUrl = const String.fromEnvironment(
      'AGENTIS_WEB_URL',
      defaultValue: 'https://agentis.cz',
    ),
    http.Client? client,
  }) : serviceUrl = _validatedServiceUrl(bffUrl),
       agentisUrl = _validatedWebUrl(agentisWebUrl),
       _client = client ?? http.Client();

  @override
  final Uri serviceUrl;
  @override
  final Uri agentisUrl;
  final http.Client _client;

  @override
  Future<Session?> getSession(String token) async {
    try {
      return Session.fromJson(await _get('/v1/session', token));
    } on ApiException catch (error) {
      if (error.status == 401) return null;
      rethrow;
    }
  }

  @override
  Future<DecisionPage> getDecisions(
    String token,
    DecisionView view,
    int page,
  ) async {
    final uri = _uri(
      '/v1/decisions',
    ).replace(queryParameters: {'view': view.name, 'page': '$page'});
    return DecisionPage.fromJson(await _send('GET', uri, token));
  }

  @override
  Future<int> getPendingCount(String token) async {
    final response = await _get('/v1/decisions/pending-count', token);
    final count = response['count'];
    if (count is! int || count < 0) {
      throw const ApiException('The server returned an invalid pending count.');
    }
    return count;
  }

  @override
  Future<void> registerPushDevice(
    String token, {
    required String installationId,
    required String pushToken,
  }) async {
    final response = await _send(
      'PUT',
      _uri('/v1/push/registration'),
      token,
      body: {
        'installationId': installationId,
        'pushToken': pushToken,
        'platform': 'android',
      },
    );
    _expectOk(response);
  }

  @override
  Future<void> unregisterPushDevice(String token, String installationId) async {
    final response = await _send(
      'DELETE',
      _uri('/v1/push/registration/${Uri.encodeComponent(installationId)}'),
      token,
    );
    _expectOk(response);
  }

  @override
  Future<void> resolve(String token, JsonMap request) async {
    final response = await _send(
      'POST',
      _uri('/v1/decisions/resolve'),
      token,
      body: request,
    );
    if (response['ok'] != true ||
        response['externalId'] is! String ||
        response['status'] is! String) {
      throw const ApiException(
        'The server returned an invalid resolution response.',
        code: 'invalid_bff_response',
      );
    }
  }

  @override
  Stream<DecisionEvent> events(
    String token, {
    String? lastEventId,
    void Function()? onConnected,
  }) async* {
    final headers = <String, String>{
      'accept': 'text/event-stream',
      'X-Auth-Token': token,
    };
    if (lastEventId != null) headers['Last-Event-ID'] = lastEventId;
    final request = http.Request('GET', _uri('/v1/events'))
      ..followRedirects = false
      ..headers.addAll(headers);
    late http.StreamedResponse response;
    try {
      response = await _client
          .send(request)
          .timeout(const Duration(seconds: 20));
    } on TimeoutException {
      throw const ApiException('The event stream did not respond in time.');
    } on http.ClientException {
      throw const ApiException('Could not reach the decision event stream.');
    }
    if (response.statusCode == 401 || response.statusCode == 403) {
      throw ApiException(
        'Agentis authentication is required.',
        code: 'unauthorized',
        status: response.statusCode,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        'Could not connect to decision updates.',
        status: response.statusCode,
      );
    }
    onConnected?.call();

    final data = <String>[];
    await for (final line
        in response.stream
            .timeout(const Duration(seconds: 45))
            .transform(utf8.decoder)
            .transform(const LineSplitter())) {
      if (line.isEmpty) {
        if (data.isEmpty) continue;
        try {
          final value = jsonDecode(data.join('\n'));
          if (value is JsonMap) yield DecisionEvent.fromJson(value);
        } on FormatException {
          // Malformed event hints are ignored; regular refresh repairs state.
        }
        data.clear();
      } else if (line.startsWith('data:')) {
        data.add(line.substring(5).trimLeft());
      }
    }
  }

  Future<JsonMap> _get(String path, String token) =>
      _send('GET', _uri(path), token);

  Future<JsonMap> _send(
    String method,
    Uri uri,
    String token, {
    JsonMap? body,
  }) async {
    final request = http.Request(method, uri)
      ..followRedirects = false
      ..headers.addAll({
        'accept': 'application/json',
        'content-type': 'application/json',
        'X-Auth-Token': token,
      });
    if (body != null) request.body = jsonEncode(body);

    late http.StreamedResponse streamed;
    try {
      streamed = await _client
          .send(request)
          .timeout(const Duration(seconds: 20));
    } on TimeoutException {
      throw const ApiException('The server did not respond in time.');
    } on http.ClientException {
      throw const ApiException('Could not reach the Decision Inbox service.');
    }

    final responseBody = await streamed.stream.bytesToString();
    Object? decoded;
    if (responseBody.isNotEmpty) {
      try {
        decoded = jsonDecode(responseBody);
      } on FormatException {
        throw ApiException(
          'The server returned an invalid response.',
          code: 'invalid_bff_response',
          status: streamed.statusCode,
        );
      }
    }
    if (streamed.statusCode < 200 || streamed.statusCode >= 300) {
      final error = decoded is JsonMap && decoded['error'] is JsonMap
          ? decoded['error'] as JsonMap
          : null;
      throw ApiException(
        error?['message'] is String
            ? error!['message'] as String
            : 'The Decision Inbox request failed.',
        code: error?['code'] as String?,
        status: streamed.statusCode,
      );
    }
    if (decoded is JsonMap) return decoded;
    throw ApiException(
      'The server returned an invalid response.',
      code: 'invalid_bff_response',
      status: streamed.statusCode,
    );
  }

  Uri _uri(String path) => serviceUrl.resolve(path);

  static void _expectOk(JsonMap response) {
    if (response['ok'] != true) {
      throw const ApiException(
        'The server returned an invalid push registration response.',
        code: 'invalid_bff_response',
      );
    }
  }
}

Uri _validatedServiceUrl(String value) {
  final uri = Uri.parse(value);
  final localDevelopmentHost =
      uri.host == 'localhost' || uri.host == '10.0.2.2';
  if (!uri.hasScheme ||
      !uri.hasAuthority ||
      (uri.scheme != 'https' &&
          !(uri.scheme == 'http' && localDevelopmentHost))) {
    throw ArgumentError.value(
      value,
      'bffUrl',
      'Use HTTPS, or HTTP with localhost/10.0.2.2 for local development.',
    );
  }
  return uri;
}

Uri _validatedWebUrl(String value) {
  final uri = Uri.parse(value);
  if (uri.scheme != 'https' || !uri.hasAuthority) {
    throw ArgumentError.value(value, 'agentisWebUrl', 'Use an HTTPS URL.');
  }
  return uri;
}
