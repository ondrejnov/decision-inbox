import 'package:flutter/material.dart';

import 'app_controller.dart';

class SettingsSheet extends StatelessWidget {
  const SettingsSheet({super.key, required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final settings = controller.settings;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xffcbd5e1),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              'Settings',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Notifications'),
              subtitle: const Text('Show new pending decisions.'),
              value: settings.notificationsEnabled,
              onChanged: (value) => controller.updateSettings(
                settings.copyWith(notificationsEnabled: value),
              ),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Notify while active'),
              subtitle: const Text(
                'Allow notifications while this app is visible.',
              ),
              value: settings.notifyWhileActive,
              onChanged: settings.notificationsEnabled
                  ? (value) => controller.updateSettings(
                      settings.copyWith(notifyWhileActive: value),
                    )
                  : null,
            ),
            if (controller.settingsError != null) ...[
              const SizedBox(height: 4),
              Text(
                controller.settingsError!,
                style: const TextStyle(color: Color(0xffbe123c)),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              'Android manages startup and background execution. Desktop tray and autostart settings do not apply on this device.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: const Color(0xff64748b),
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
