import 'package:flutter/material.dart';

import 'app_controller.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _formKey = GlobalKey<FormState>();
  final _tokenController = TextEditingController();
  bool _obscureToken = true;

  @override
  void dispose() {
    _tokenController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    await widget.controller.connect(_tokenController.text);
    if (widget.controller.status == AppStatus.signedIn) {
      _tokenController.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final theme = Theme.of(context);
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xffeef2ff), Color(0xfff8fafc), Color(0xfffffbeb)],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: Card(
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(28),
                    side: const BorderSide(color: Color(0xffc7d2fe)),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Align(
                            alignment: Alignment.centerLeft,
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                color: theme.colorScheme.primaryContainer,
                                borderRadius: BorderRadius.circular(16),
                              ),
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Icon(
                                  Icons.notifications_active_outlined,
                                  color: theme.colorScheme.primary,
                                  size: 28,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 22),
                          Text(
                            controller.requiresReauthentication
                                ? 'Reconnect your Agentis account'
                                : 'Connect your Agentis account',
                            style: theme.textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.w800,
                              color: const Color(0xff0f172a),
                            ),
                          ),
                          const SizedBox(height: 10),
                          Text(
                            'Review questions and approvals securely from your Android device. Your token is protected by the Android Keystore.',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: const Color(0xff475569),
                              height: 1.5,
                            ),
                          ),
                          const SizedBox(height: 24),
                          TextFormField(
                            controller: _tokenController,
                            obscureText: _obscureToken,
                            enableSuggestions: false,
                            autocorrect: false,
                            maxLength: 4096,
                            textInputAction: TextInputAction.done,
                            autofillHints: const [],
                            decoration: InputDecoration(
                              labelText: 'Agentis token',
                              hintText: 'Type or paste your token',
                              counterText: '',
                              prefixIcon: const Icon(Icons.key_outlined),
                              suffixIcon: IconButton(
                                tooltip: _obscureToken
                                    ? 'Show token'
                                    : 'Hide token',
                                onPressed: () => setState(
                                  () => _obscureToken = !_obscureToken,
                                ),
                                icon: Icon(
                                  _obscureToken
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined,
                                ),
                              ),
                            ),
                            validator: (value) =>
                                value == null || value.trim().isEmpty
                                ? 'An Agentis token is required.'
                                : null,
                            onFieldSubmitted: (_) {
                              if (!controller.isConnecting) _submit();
                            },
                          ),
                          if (controller.onboardingError != null) ...[
                            const SizedBox(height: 12),
                            _ErrorBanner(message: controller.onboardingError!),
                          ],
                          const SizedBox(height: 18),
                          FilledButton.icon(
                            onPressed: controller.isConnecting ? null : _submit,
                            icon: controller.isConnecting
                                ? const SizedBox.square(
                                    dimension: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.shield_outlined),
                            label: Text(
                              controller.isConnecting
                                  ? 'Testing connection...'
                                  : 'Test connection',
                            ),
                          ),
                          const SizedBox(height: 18),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(
                                Icons.lock_outline,
                                size: 18,
                                color: Color(0xff64748b),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'The token is never included in notifications or application logs.',
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: const Color(0xff64748b),
                                    height: 1.4,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 18),
                          Text(
                            controller.serviceUrl.toString(),
                            textAlign: TextAlign.center,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: const Color(0xff94a3b8),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xfffff1f2),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xffffcdd5)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: Color(0xffbe123c)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: Color(0xff9f1239)),
            ),
          ),
        ],
      ),
    ),
  );
}
