import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'inbox_screen.dart';
import 'onboarding_screen.dart';

class DecisionInboxApp extends StatelessWidget {
  const DecisionInboxApp({super.key, required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xff4f46e5);
    final colors = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.light,
      surface: const Color(0xfff7f8fb),
    );
    return MaterialApp(
      title: 'Decision Inbox',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: colors,
        scaffoldBackgroundColor: const Color(0xfff7f8fb),
        fontFamily: 'sans-serif',
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          scrolledUnderElevation: 1,
        ),
        cardTheme: CardThemeData(
          color: Colors.white,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: const BorderSide(color: Color(0xffe2e8f0)),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: Color(0xffcbd5e1)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: Color(0xffcbd5e1)),
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            minimumSize: const Size(0, 50),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
          ),
        ),
      ),
      home: AnimatedBuilder(
        animation: controller,
        builder: (context, _) => switch (controller.status) {
          AppStatus.booting => const _BootScreen(),
          AppStatus.signedOut => OnboardingScreen(controller: controller),
          AppStatus.signedIn => InboxScreen(controller: controller),
        },
      ),
    );
  }
}

class _BootScreen extends StatelessWidget {
  const _BootScreen();

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: Semantics(
        label: 'Loading Decision Inbox',
        child: const CircularProgressIndicator(),
      ),
    ),
  );
}
