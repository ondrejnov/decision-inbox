import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AppSettings {
  const AppSettings({
    this.notificationsEnabled = true,
    this.notifyWhileActive = false,
  });

  final bool notificationsEnabled;
  final bool notifyWhileActive;

  AppSettings copyWith({bool? notificationsEnabled, bool? notifyWhileActive}) =>
      AppSettings(
        notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
        notifyWhileActive: notifyWhileActive ?? this.notifyWhileActive,
      );
}

abstract interface class AppStorage {
  Future<String?> readToken();
  Future<void> writeToken(String token);
  Future<void> clearToken();
  Future<String> readOrCreateInstallationId();
  Future<bool> readPushTokenDeletionPending();
  Future<void> writePushTokenDeletionPending(bool pending);
  Future<Set<String>> readNotificationBaseline();
  Future<bool> readNotificationBaselineInitialized();
  Future<void> resetNotificationBaseline();
  Future<void> writeNotificationBaseline(Set<String> keys);
  Future<AppSettings> readSettings();
  Future<void> writeSettings(AppSettings settings);
}

class AndroidAppStorage implements AppStorage {
  AndroidAppStorage({FlutterSecureStorage? secureStorage})
    : _secureStorage = secureStorage ?? const FlutterSecureStorage();

  static const _tokenKey = 'agentis_token';
  static const _installationIdKey = 'push_installation_id';
  static const _pushTokenDeletionPendingKey = 'push_token_deletion_pending';
  static const _baselineKey = 'decision_notification_baseline';
  static const _baselineInitializedKey = 'decision_notification_initialized';
  static const _notificationsKey = 'notifications_enabled';
  static const _notifyActiveKey = 'notify_while_active';

  final FlutterSecureStorage _secureStorage;

  @override
  Future<String?> readToken() => _secureStorage.read(key: _tokenKey);

  @override
  Future<void> writeToken(String token) =>
      _secureStorage.write(key: _tokenKey, value: token);

  @override
  Future<void> clearToken() async {
    await _secureStorage.delete(key: _tokenKey);
    await _secureStorage.delete(key: _baselineKey);
    await _secureStorage.delete(key: _baselineInitializedKey);
  }

  @override
  Future<String> readOrCreateInstallationId() async {
    final existing = await _secureStorage.read(key: _installationIdKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final random = Random.secure();
    final value = base64Url
        .encode(List<int>.generate(32, (_) => random.nextInt(256)))
        .replaceAll('=', '');
    await _secureStorage.write(key: _installationIdKey, value: value);
    return value;
  }

  @override
  Future<bool> readPushTokenDeletionPending() async =>
      await _secureStorage.read(key: _pushTokenDeletionPendingKey) == 'true';

  @override
  Future<void> writePushTokenDeletionPending(bool pending) => pending
      ? _secureStorage.write(key: _pushTokenDeletionPendingKey, value: 'true')
      : _secureStorage.delete(key: _pushTokenDeletionPendingKey);

  @override
  Future<Set<String>> readNotificationBaseline() async {
    final encoded = await _secureStorage.read(key: _baselineKey);
    if (encoded == null) return <String>{};
    try {
      final value = jsonDecode(encoded);
      if (value is List<dynamic>) return value.whereType<String>().toSet();
    } on FormatException {
      // Corrupt encrypted state is replaced by the next inbox synchronization.
    }
    return <String>{};
  }

  @override
  Future<bool> readNotificationBaselineInitialized() async =>
      await _secureStorage.read(key: _baselineInitializedKey) == 'true';

  @override
  Future<void> resetNotificationBaseline() async {
    await _secureStorage.delete(key: _baselineKey);
    await _secureStorage.delete(key: _baselineInitializedKey);
  }

  @override
  Future<void> writeNotificationBaseline(Set<String> keys) async {
    await _secureStorage.write(
      key: _baselineKey,
      value: jsonEncode(keys.toList()..sort()),
    );
    await _secureStorage.write(key: _baselineInitializedKey, value: 'true');
  }

  @override
  Future<AppSettings> readSettings() async {
    final preferences = await SharedPreferences.getInstance();
    return AppSettings(
      notificationsEnabled: preferences.getBool(_notificationsKey) ?? true,
      notifyWhileActive: preferences.getBool(_notifyActiveKey) ?? false,
    );
  }

  @override
  Future<void> writeSettings(AppSettings settings) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setBool(_notificationsKey, settings.notificationsEnabled);
    await preferences.setBool(_notifyActiveKey, settings.notifyWhileActive);
  }
}
