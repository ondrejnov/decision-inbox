import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api_client.dart';
import 'models.dart';
import 'notification_service.dart';
import 'storage.dart';

enum AppStatus { booting, signedOut, signedIn }

class AppController extends ChangeNotifier with WidgetsBindingObserver {
  AppController({
    required DecisionApi api,
    required AppStorage storage,
    required NotificationService notifications,
    // Public parameter names keep dependency injection readable at call sites.
    // ignore: prefer_initializing_formals
  }) : _api = api,
       // ignore: prefer_initializing_formals
       _storage = storage,
       // ignore: prefer_initializing_formals
       _notifications = notifications;

  final DecisionApi _api;
  final AppStorage _storage;
  final NotificationService _notifications;
  final Map<String, DecisionPage> _snapshots = {};

  AppStatus status = AppStatus.booting;
  Session? session;
  DecisionView view = DecisionView.pending;
  DecisionPage? decisionPage;
  AppSettings settings = const AppSettings();
  int pendingCount = 0;
  bool isConnecting = false;
  bool isRefreshing = false;
  bool isOfflineSnapshot = false;
  bool requiresReauthentication = false;
  String? onboardingError;
  String? inboxError;
  String? settingsError;

  String? _token;
  Set<String> _notificationBaseline = {};
  bool _notificationBaselineInitialized = false;
  StreamSubscription<DecisionEvent>? _eventsSubscription;
  StreamSubscription<void>? _notificationTapSubscription;
  StreamSubscription<String>? _pushTokenSubscription;
  StreamSubscription<PushHint>? _pushHintSubscription;
  Timer? _reconnectTimer;
  Timer? _pollTimer;
  Timer? _notificationTimer;
  int _reconnectSeconds = 1;
  int _eventGeneration = 0;
  int _accountGeneration = 0;
  int _queuedQuestions = 0;
  int _queuedApprovals = 0;
  bool _isActive = true;
  bool _refreshQueued = false;
  Future<void> _credentialMutation = Future.value();
  Future<void> _pushMutation = Future.value();
  Future<void>? _logoutOperation;

  Uri get serviceUrl => _api.serviceUrl;

  Future<void> initialize() async {
    WidgetsBinding.instance.addObserver(this);
    _notificationTapSubscription = _notifications.pendingTaps.listen((_) {
      if (status != AppStatus.signedIn) return;
      view = DecisionView.pending;
      decisionPage = _snapshots[_cacheKey(DecisionView.pending, 1)];
      notifyListeners();
      unawaited(_loadPage(1));
    });
    _pushTokenSubscription = _notifications.pushTokens.listen((pushToken) {
      unawaited(_registerPushToken(pushToken));
    });
    _pushHintSubscription = _notifications.pushHints.listen((hint) {
      unawaited(_handlePushHint(hint));
    });
    try {
      await _notifications.initialize();
    } catch (_) {
      // Notifications are optional and must not block access to the inbox.
    }
    await _retryPendingPushTokenDeletion();
    try {
      settings = await _storage.readSettings();
    } catch (_) {
      settings = const AppSettings();
    }
    try {
      _notificationBaseline = await _storage.readNotificationBaseline();
      _notificationBaselineInitialized = await _storage
          .readNotificationBaselineInitialized();
    } catch (_) {
      _notificationBaseline = {};
      _notificationBaselineInitialized = false;
    }
    try {
      final token = await _storage.readToken();
      if (token == null || token.isEmpty) {
        status = AppStatus.signedOut;
        notifyListeners();
        return;
      }
      final currentSession = await _api.getSession(token);
      if (currentSession == null) {
        _token = token;
        requiresReauthentication = true;
        status = AppStatus.signedOut;
        await _revokePushDevice(token);
        notifyListeners();
        return;
      }
      _activateAccount(token, currentSession);
      notifyListeners();
      await refresh();
      if (_token == token && status == AppStatus.signedIn) {
        unawaited(_registerCurrentPushToken());
        _startLiveUpdates();
        _startPolling();
      }
    } catch (error) {
      onboardingError = _message(error);
      status = AppStatus.signedOut;
      notifyListeners();
    }
  }

  Future<void> connect(String rawToken) async {
    final token = rawToken.trim();
    if (token.isEmpty) {
      onboardingError = 'An Agentis token is required.';
      notifyListeners();
      return;
    }
    if (token.length > 4096) {
      onboardingError = 'The Agentis token is too long.';
      notifyListeners();
      return;
    }

    isConnecting = true;
    onboardingError = null;
    notifyListeners();
    try {
      await _logoutOperation;
      await _credentialMutation;
      final currentSession = await _api.getSession(token);
      if (currentSession == null) {
        throw const ApiException(
          'The Agentis token is invalid or expired.',
          code: 'unauthorized',
          status: 401,
        );
      }
      await _runCredentialMutation(() async {
        try {
          await _storage.resetNotificationBaseline();
        } catch (_) {
          // Deduplication state must not block an otherwise valid login.
        }
        await _storage.writeToken(token);
      });
      _activateAccount(token, currentSession, resetBaseline: true);
      notifyListeners();
      if (settings.notificationsEnabled) {
        try {
          await _notifications.requestPermission();
        } catch (_) {
          // A denied or unavailable permission does not block the inbox.
        }
        unawaited(_registerCurrentPushToken());
      }
      await refresh();
      if (_token == token && status == AppStatus.signedIn) {
        _startLiveUpdates();
        _startPolling();
      }
    } catch (error) {
      onboardingError = _message(error);
    } finally {
      isConnecting = false;
      notifyListeners();
    }
  }

  Future<void> logout() {
    final existing = _logoutOperation;
    if (existing != null) return existing;
    late final Future<void> operation;
    operation = _performLogout().whenComplete(() {
      if (identical(_logoutOperation, operation)) _logoutOperation = null;
    });
    _logoutOperation = operation;
    return operation;
  }

  Future<void> _performLogout() async {
    final authToken = _token;
    _stopBackgroundWork();
    _accountGeneration++;
    _token = null;
    session = null;
    decisionPage = null;
    pendingCount = 0;
    _notificationBaseline = {};
    _notificationBaselineInitialized = false;
    _snapshots.clear();
    isRefreshing = false;
    _refreshQueued = false;
    isOfflineSnapshot = false;
    requiresReauthentication = false;
    onboardingError = null;
    status = AppStatus.signedOut;
    notifyListeners();
    await _revokePushDevice(authToken);
    try {
      await _runCredentialMutation(_storage.clearToken);
    } catch (error) {
      onboardingError = _message(error);
      notifyListeners();
    }
  }

  Future<void> refresh() async {
    final token = _token;
    if (token == null || status != AppStatus.signedIn) return;
    if (isRefreshing) {
      _refreshQueued = true;
      return;
    }
    final generation = _accountGeneration;
    isRefreshing = true;
    inboxError = null;
    notifyListeners();
    final requestedView = view;
    final requestedPage = decisionPage?.page ?? 1;
    final cacheKey = _cacheKey(requestedView, requestedPage);
    try {
      final page = await _api.getDecisions(token, requestedView, requestedPage);
      if (!_isCurrentAccount(generation, token)) return;
      final count = await _api.getPendingCount(token);
      if (!_isCurrentAccount(generation, token)) return;
      _snapshots[cacheKey] = page;
      if (view == requestedView) decisionPage = page;
      pendingCount = count;
      isOfflineSnapshot = false;
      if (requestedView == DecisionView.pending && requestedPage == 1) {
        await _synchronizeNotificationBaseline(page.items, generation, token);
      }
    } on ApiException catch (error) {
      if (!_isCurrentAccount(generation, token)) return;
      if (error.requiresAuthentication) {
        _requireAuthentication();
        return;
      }
      final snapshot = _snapshots[cacheKey];
      if (snapshot != null) {
        decisionPage = snapshot;
        isOfflineSnapshot = true;
      } else {
        inboxError = error.message;
      }
    } catch (error) {
      if (!_isCurrentAccount(generation, token)) return;
      final snapshot = _snapshots[cacheKey];
      if (snapshot != null) {
        decisionPage = snapshot;
        isOfflineSnapshot = true;
      } else {
        inboxError = _message(error);
      }
    } finally {
      if (_isCurrentAccount(generation, token)) {
        isRefreshing = false;
        notifyListeners();
        if (_refreshQueued) {
          _refreshQueued = false;
          unawaited(refresh());
        }
      }
    }
  }

  Future<void> setView(DecisionView nextView) async {
    if (view == nextView) return;
    view = nextView;
    decisionPage = _snapshots[_cacheKey(nextView, 1)];
    inboxError = null;
    notifyListeners();
    await _loadPage(1);
  }

  Future<void> previousPage() async {
    final current = decisionPage?.page ?? 1;
    if (current > 1) await _loadPage(current - 1);
  }

  Future<void> nextPage() async {
    final current = decisionPage;
    if (current?.hasNext == true) await _loadPage(current!.page + 1);
  }

  Future<void> resolve(JsonMap request) async {
    final token = _token;
    if (token == null || isOfflineSnapshot) {
      throw const ApiException(
        'Actions are unavailable until the app reconnects.',
      );
    }
    final generation = _accountGeneration;
    try {
      await _api.resolve(token, request);
      if (_isCurrentAccount(generation, token)) await refresh();
    } on ApiException catch (error) {
      if (!_isCurrentAccount(generation, token)) rethrow;
      if (error.requiresAuthentication) _requireAuthentication();
      if (error.code == 'already_resolved' ||
          error.code == 'decision_cancelled') {
        await refresh();
      }
      rethrow;
    }
  }

  Future<void> openTask(Decision decision) async {
    final uri = _api.agentisUrl
        .resolve('/task/${Uri.encodeComponent(decision.taskId)}')
        .replace(queryParameters: {'openRun': decision.runId});
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      throw const ApiException('Could not open the source task.');
    }
  }

  Future<void> updateSettings(AppSettings nextSettings) async {
    final notificationsWereEnabled = settings.notificationsEnabled;
    settings = nextSettings;
    settingsError = null;
    if (!settings.notificationsEnabled) {
      _notificationTimer?.cancel();
      _notificationTimer = null;
      _queuedQuestions = 0;
      _queuedApprovals = 0;
    }
    notifyListeners();
    try {
      await _storage.writeSettings(settings);
    } catch (_) {
      settingsError = 'Could not save settings.';
      notifyListeners();
    }
    if (settings.notificationsEnabled) {
      try {
        await _notifications.requestPermission();
      } catch (_) {
        // Android permission state is independent from the in-app preference.
      }
      if (!notificationsWereEnabled) unawaited(_registerCurrentPushToken());
    } else if (notificationsWereEnabled) {
      final authToken = _token;
      await _revokePushDevice(authToken);
    }
  }

  Future<void> _loadPage(int page) async {
    decisionPage = _snapshots[_cacheKey(view, page)];
    notifyListeners();
    final token = _token;
    if (token == null) return;
    if (isRefreshing) {
      _refreshQueued = true;
      return;
    }
    final generation = _accountGeneration;
    isRefreshing = true;
    inboxError = null;
    notifyListeners();
    final requestedView = view;
    final key = _cacheKey(requestedView, page);
    try {
      final result = await _api.getDecisions(token, requestedView, page);
      if (!_isCurrentAccount(generation, token)) return;
      _snapshots[key] = result;
      if (view == requestedView) decisionPage = result;
      isOfflineSnapshot = false;
    } on ApiException catch (error) {
      if (!_isCurrentAccount(generation, token)) return;
      if (error.requiresAuthentication) {
        _requireAuthentication();
      } else if (_snapshots[key] != null) {
        decisionPage = _snapshots[key];
        isOfflineSnapshot = true;
      } else {
        inboxError = error.message;
      }
    } finally {
      if (_isCurrentAccount(generation, token)) {
        isRefreshing = false;
        notifyListeners();
        if (_refreshQueued) {
          _refreshQueued = false;
          unawaited(refresh());
        }
      }
    }
  }

  Future<void> _synchronizeNotificationBaseline(
    List<Decision> items,
    int accountGeneration,
    String token,
  ) async {
    if (!_isCurrentAccount(accountGeneration, token)) return;
    final current = items.map((decision) => decision.baselineKey).toSet();
    final added = current.difference(_notificationBaseline);
    final shouldNotify = _notificationBaselineInitialized;
    _notificationBaseline.addAll(current);
    await _persistNotificationBaseline(accountGeneration, token);
    if (!_isCurrentAccount(accountGeneration, token)) return;
    _notificationBaselineInitialized = true;
    if (added.isNotEmpty && shouldNotify) {
      _queueNotificationKeys(added);
    }
  }

  void _startLiveUpdates() {
    _eventGeneration++;
    _eventsSubscription?.cancel();
    _reconnectTimer?.cancel();
    _reconnectSeconds = 1;
    _connectEventStream(_eventGeneration);
  }

  void _connectEventStream(int generation, {String? lastEventId}) {
    final token = _token;
    if (token == null || generation != _eventGeneration) return;
    final accountGeneration = _accountGeneration;
    var latestEventId = lastEventId;
    _eventsSubscription = _api
        .events(
          token,
          lastEventId: lastEventId,
          onConnected: () {
            if (generation == _eventGeneration) _reconnectSeconds = 1;
          },
        )
        .listen(
          (event) {
            if (generation != _eventGeneration) return;
            latestEventId = event.id;
            unawaited(_handleDecisionEvent(event, accountGeneration, token));
          },
          onError: (Object error) {
            if (generation != _eventGeneration) return;
            if (error is ApiException && error.requiresAuthentication) {
              _requireAuthentication();
              return;
            }
            _scheduleReconnect(generation, lastEventId: latestEventId);
          },
          onDone: () =>
              _scheduleReconnect(generation, lastEventId: latestEventId),
          cancelOnError: true,
        );
  }

  void _scheduleReconnect(int generation, {String? lastEventId}) {
    if (generation != _eventGeneration || status != AppStatus.signedIn) return;
    _reconnectTimer?.cancel();
    final delay = _reconnectSeconds;
    _reconnectSeconds = (_reconnectSeconds * 2).clamp(1, 30);
    _reconnectTimer = Timer(Duration(seconds: delay), () {
      unawaited(refresh());
      _connectEventStream(generation, lastEventId: lastEventId);
    });
  }

  Future<void> _handleDecisionEvent(
    DecisionEvent event,
    int accountGeneration,
    String token,
  ) async {
    if (!_isCurrentAccount(accountGeneration, token)) return;
    final kind = event.kind;
    final externalId = event.externalId;
    if (kind != null && externalId != null) {
      final key = '${kind.name}:$externalId';
      if (event.transition == 'created' &&
          event.status == 'pending' &&
          _notificationBaseline.add(key)) {
        await _persistNotificationBaseline(accountGeneration, token);
        if (!_isCurrentAccount(accountGeneration, token)) return;
        _queueNotificationKeys({key});
      } else if (event.transition == 'answered' ||
          event.transition == 'cancelled') {
        _notificationBaseline.remove(key);
        await _persistNotificationBaseline(accountGeneration, token);
        if (!_isCurrentAccount(accountGeneration, token)) return;
      }
    }
    await refresh();
  }

  Future<void> _handlePushHint(PushHint hint) async {
    final token = _token;
    if (token == null || status != AppStatus.signedIn) return;
    final generation = _accountGeneration;
    if (hint.eventId.isEmpty || !_isCurrentAccount(generation, token)) return;
    await refresh();
  }

  Future<void> _retryPendingPushTokenDeletion() async {
    try {
      if (!await _storage.readPushTokenDeletionPending()) return;
      await _notifications.deletePushToken();
      await _storage.writePushTokenDeletionPending(false);
    } catch (_) {
      // Retried on the next process start.
    }
  }

  Future<void> _deletePushTokenWithRetry() async {
    try {
      await _storage.writePushTokenDeletionPending(true);
    } catch (_) {
      // Secure retry state is best-effort; deletion is still attempted now.
    }
    try {
      await _notifications.deletePushToken();
      await _storage.writePushTokenDeletionPending(false);
    } catch (_) {
      // A persisted pending flag retries deletion on the next process start.
    }
  }

  Future<void> _registerCurrentPushToken() => _runPushMutation(() async {
    if (!settings.notificationsEnabled) return;
    try {
      final pushToken = await _notifications.currentPushToken();
      if (pushToken != null && pushToken.isNotEmpty) {
        await _registerPushTokenNow(pushToken);
      }
    } catch (_) {
      // Missing Firebase configuration or transport errors are retried on resume.
    }
  });

  Future<void> _registerPushToken(String pushToken) =>
      _runPushMutation(() => _registerPushTokenNow(pushToken));

  Future<void> _registerPushTokenNow(String pushToken) async {
    final authToken = _token;
    if (authToken == null ||
        status != AppStatus.signedIn ||
        !settings.notificationsEnabled) {
      return;
    }
    final generation = _accountGeneration;
    if (!_isCurrentAccount(generation, authToken) ||
        !settings.notificationsEnabled) {
      return;
    }
    try {
      final installationId = await _storage.readOrCreateInstallationId();
      if (!_isCurrentAccount(generation, authToken)) return;
      await _api.registerPushDevice(
        authToken,
        installationId: installationId,
        pushToken: pushToken,
      );
    } on ApiException catch (error) {
      if (_isCurrentAccount(generation, authToken) &&
          error.requiresAuthentication) {
        _requireAuthentication();
      }
    } catch (_) {
      // Registration is reconciled again after login, token rotation, or resume.
    }
  }

  Future<void> _revokePushDevice(String? authToken) =>
      _runPushMutation(() async {
        await _deletePushTokenWithRetry();
        if (authToken == null) return;
        try {
          final installationId = await _storage.readOrCreateInstallationId();
          await _api.unregisterPushDevice(authToken, installationId);
        } catch (_) {
          // Logout and disabling notifications must work while offline.
        }
      });

  void _queueNotificationKeys(Set<String> keys) {
    if (!settings.notificationsEnabled ||
        (_isActive && !settings.notifyWhileActive)) {
      return;
    }
    _queuedQuestions += keys.where((key) => key.startsWith('question:')).length;
    _queuedApprovals += keys.where((key) => key.startsWith('approval:')).length;
    _notificationTimer ??= Timer(const Duration(milliseconds: 800), () async {
      final questions = _queuedQuestions;
      final approvals = _queuedApprovals;
      _queuedQuestions = 0;
      _queuedApprovals = 0;
      _notificationTimer = null;
      try {
        await _notifications.showPendingSummary(
          questions: questions,
          approvals: approvals,
        );
      } catch (_) {
        // Notification delivery failures do not affect inbox state.
      }
    });
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(
      const Duration(seconds: 60),
      (_) => unawaited(refresh()),
    );
  }

  void _requireAuthentication() {
    _stopBackgroundWork();
    unawaited(_revokePushDevice(_token));
    _accountGeneration++;
    session = null;
    decisionPage = null;
    pendingCount = 0;
    _snapshots.clear();
    isRefreshing = false;
    _refreshQueued = false;
    status = AppStatus.signedOut;
    requiresReauthentication = true;
    onboardingError = null;
    notifyListeners();
  }

  void _stopBackgroundWork() {
    _eventGeneration++;
    _eventsSubscription?.cancel();
    _eventsSubscription = null;
    _reconnectTimer?.cancel();
    _pollTimer?.cancel();
    _notificationTimer?.cancel();
    _notificationTimer = null;
    _queuedQuestions = 0;
    _queuedApprovals = 0;
  }

  void _activateAccount(
    String token,
    Session currentSession, {
    bool resetBaseline = false,
  }) {
    _stopBackgroundWork();
    _accountGeneration++;
    _snapshots.clear();
    _token = token;
    session = currentSession;
    status = AppStatus.signedIn;
    requiresReauthentication = false;
    view = DecisionView.pending;
    decisionPage = null;
    pendingCount = 0;
    isRefreshing = false;
    _refreshQueued = false;
    isOfflineSnapshot = false;
    inboxError = null;
    if (resetBaseline) {
      _notificationBaseline = {};
      _notificationBaselineInitialized = false;
    }
  }

  bool _isCurrentAccount(int generation, String token) =>
      generation == _accountGeneration &&
      token == _token &&
      status == AppStatus.signedIn;

  Future<void> _persistNotificationBaseline(
    int accountGeneration,
    String token,
  ) async {
    if (!_isCurrentAccount(accountGeneration, token)) return;
    final keys = {..._notificationBaseline};
    try {
      await _runCredentialMutation(
        () => _storage.writeNotificationBaseline(keys),
      );
    } catch (_) {
      // Encrypted deduplication is best-effort and never stores decision text.
    }
  }

  Future<void> _runCredentialMutation(Future<void> Function() action) {
    final operation = _credentialMutation.then((_) => action());
    _credentialMutation = operation.catchError((Object _) {});
    return operation;
  }

  Future<void> _runPushMutation(Future<void> Function() action) {
    final operation = _pushMutation.then((_) => action());
    _pushMutation = operation.catchError((Object _) {});
    return operation;
  }

  String _cacheKey(DecisionView selectedView, int page) =>
      '${selectedView.name}:$page';

  static String _message(Object error) => error is ApiException
      ? error.message
      : 'Something went wrong. Try again.';

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _isActive = state == AppLifecycleState.resumed;
    if (_isActive && status == AppStatus.signedIn) {
      _startLiveUpdates();
      _startPolling();
      unawaited(_registerCurrentPushToken());
      unawaited(refresh());
    } else if (!_isActive) {
      _stopBackgroundWork();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopBackgroundWork();
    _notificationTapSubscription?.cancel();
    _pushTokenSubscription?.cancel();
    _pushHintSubscription?.cancel();
    _notifications.dispose();
    super.dispose();
  }
}
