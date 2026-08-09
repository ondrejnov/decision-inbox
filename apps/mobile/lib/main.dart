import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'src/api_client.dart';
import 'src/app.dart';
import 'src/app_controller.dart';
import 'src/notification_service.dart';
import 'src/storage.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  NotificationService.configureBackgroundHandling();
  await initializeDateFormatting('cs_CZ');
  final controller = AppController(
    api: BffApiClient(),
    storage: AndroidAppStorage(),
    notifications: NotificationService(),
  );
  runApp(DecisionInboxApp(controller: controller));
  unawaited(controller.initialize());
}
