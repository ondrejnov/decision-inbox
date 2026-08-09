import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'decision_card.dart';
import 'history_decision_card.dart';
import 'models.dart';
import 'settings_sheet.dart';

class InboxScreen extends StatelessWidget {
  const InboxScreen({super.key, required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final session = controller.session!;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.notifications_active_outlined, color: Color(0xff4f46e5)),
            SizedBox(width: 9),
            Text(
              'Decision Inbox',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh inbox',
            onPressed: controller.isRefreshing ? null : controller.refresh,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Settings',
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              showDragHandle: false,
              isScrollControlled: true,
              builder: (_) => AnimatedBuilder(
                animation: controller,
                builder: (_, _) => SettingsSheet(controller: controller),
              ),
            ),
            icon: const Icon(Icons.settings_outlined),
          ),
          PopupMenuButton<String>(
            tooltip: 'Account',
            onSelected: (value) {
              if (value == 'logout') controller.logout();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(
                value: 'logout',
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.logout),
                  title: Text('Log out'),
                ),
              ),
            ],
          ),
        ],
        bottom: controller.isRefreshing
            ? const PreferredSize(
                preferredSize: Size.fromHeight(3),
                child: LinearProgressIndicator(minHeight: 3),
              )
            : null,
      ),
      body: RefreshIndicator(
        onRefresh: controller.refresh,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 12),
              sliver: SliverToBoxAdapter(
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 760),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _AccountHeader(
                          displayName: session.displayName,
                          tenant: session.tenantName ?? session.tenantId,
                          offline: controller.isOfflineSnapshot,
                        ),
                        const SizedBox(height: 18),
                        SegmentedButton<DecisionView>(
                          showSelectedIcon: false,
                          segments: [
                            ButtonSegment(
                              value: DecisionView.pending,
                              icon: const Icon(Icons.inbox_outlined),
                              label: Text(
                                'Pending  ${controller.pendingCount}',
                              ),
                            ),
                            const ButtonSegment(
                              value: DecisionView.history,
                              icon: Icon(Icons.history),
                              label: Text('History'),
                            ),
                          ],
                          selected: {controller.view},
                          onSelectionChanged: (selection) =>
                              controller.setView(selection.first),
                        ),
                        const SizedBox(height: 22),
                        Text(
                          controller.view == DecisionView.pending
                              ? 'ACTION REQUIRED'
                              : 'ARCHIVE',
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(
                                color: const Color(0xff4f46e5),
                                fontWeight: FontWeight.w800,
                                letterSpacing: 1.2,
                              ),
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                controller.view == DecisionView.pending
                                    ? 'Pending inbox'
                                    : 'Decision history',
                                style: Theme.of(context).textTheme.headlineSmall
                                    ?.copyWith(fontWeight: FontWeight.w800),
                              ),
                            ),
                            const Text(
                              '20 per page',
                              style: TextStyle(color: Color(0xff64748b)),
                            ),
                          ],
                        ),
                        if (controller.decisionPage?.total != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            '${controller.decisionPage!.total} total',
                            style: const TextStyle(color: Color(0xff64748b)),
                          ),
                        ],
                        if (controller.isOfflineSnapshot) ...[
                          const SizedBox(height: 14),
                          const _StatusBanner(
                            icon: Icons.cloud_off_outlined,
                            text:
                                'Read-only snapshot. Actions will be available after reconnect.',
                            color: Color(0xff92400e),
                            background: Color(0xfffffbeb),
                          ),
                        ],
                        const SizedBox(height: 16),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            ..._content(context),
            const SliverToBoxAdapter(child: SizedBox(height: 32)),
          ],
        ),
      ),
    );
  }

  List<Widget> _content(BuildContext context) {
    final page = controller.decisionPage;
    if (page == null && controller.isRefreshing) {
      return [
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          sliver: SliverList.list(
            children: const [
              _LoadingCard(),
              SizedBox(height: 14),
              _LoadingCard(),
            ],
          ),
        ),
      ];
    }
    if (page == null || controller.inboxError != null) {
      return [
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          sliver: SliverToBoxAdapter(
            child: _EmptyState(
              icon: Icons.cloud_off_outlined,
              title: 'Could not load the inbox.',
              body:
                  controller.inboxError ??
                  'Check your connection and try again.',
              action: TextButton.icon(
                onPressed: controller.refresh,
                icon: const Icon(Icons.refresh),
                label: const Text('Try again'),
              ),
            ),
          ),
        ),
      ];
    }
    if (page.items.isEmpty) {
      final pending = controller.view == DecisionView.pending;
      return [
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          sliver: SliverToBoxAdapter(
            child: _EmptyState(
              icon: pending ? Icons.task_alt : Icons.history,
              title: pending
                  ? 'You are all caught up.'
                  : 'No decision history yet.',
              body: pending
                  ? 'New questions and approvals will appear here.'
                  : 'Resolved decisions will appear here.',
            ),
          ),
        ),
      ];
    }

    final pageCount = page.total == null
        ? null
        : (page.total! / page.pageSize).ceil().clamp(1, 1 << 31);
    return [
      SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        sliver: SliverList.separated(
          itemCount: page.items.length,
          separatorBuilder: (_, _) => const SizedBox(height: 14),
          itemBuilder: (context, index) {
            final decision = page.items[index];
            return Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 760),
                child: controller.view == DecisionView.pending
                    ? DecisionCard(
                        key: ValueKey(decision.baselineKey),
                        decision: decision,
                        controller: controller,
                        readOnly: controller.isOfflineSnapshot,
                      )
                    : HistoryDecisionCard(
                        key: ValueKey(decision.baselineKey),
                        decision: decision,
                        controller: controller,
                      ),
              ),
            );
          },
        ),
      ),
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 0),
        sliver: SliverToBoxAdapter(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: Row(
                children: [
                  OutlinedButton.icon(
                    onPressed: page.page > 1 && !controller.isRefreshing
                        ? controller.previousPage
                        : null,
                    icon: const Icon(Icons.chevron_left),
                    label: const Text('Previous'),
                  ),
                  Expanded(
                    child: Text(
                      'Page ${page.page}${pageCount == null ? '' : ' of $pageCount'}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Color(0xff64748b)),
                    ),
                  ),
                  OutlinedButton(
                    onPressed: page.hasNext && !controller.isRefreshing
                        ? controller.nextPage
                        : null,
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [Text('Next'), Icon(Icons.chevron_right)],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ];
  }
}

class _AccountHeader extends StatelessWidget {
  const _AccountHeader({
    required this.displayName,
    required this.tenant,
    required this.offline,
  });

  final String displayName;
  final String tenant;
  final bool offline;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      CircleAvatar(
        backgroundColor: const Color(0xffe0e7ff),
        foregroundColor: const Color(0xff4338ca),
        child: Text(
          displayName.isEmpty ? '?' : displayName.substring(0, 1).toUpperCase(),
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      const SizedBox(width: 11),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              displayName,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            Text(
              tenant,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Color(0xff64748b), fontSize: 12),
            ),
          ],
        ),
      ),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: offline ? const Color(0xfffffbeb) : const Color(0xffecfdf5),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          children: [
            Icon(
              offline ? Icons.wifi_off : Icons.wifi,
              size: 15,
              color: offline
                  ? const Color(0xff92400e)
                  : const Color(0xff047857),
            ),
            const SizedBox(width: 5),
            Text(
              offline ? 'Offline snapshot' : 'Connected',
              style: TextStyle(
                color: offline
                    ? const Color(0xff92400e)
                    : const Color(0xff047857),
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    ],
  );
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({
    required this.icon,
    required this.text,
    required this.color,
    required this.background,
  });

  final IconData icon;
  final String text;
  final Color color;
  final Color background;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 9),
          Expanded(
            child: Text(text, style: TextStyle(color: color)),
          ),
        ],
      ),
    ),
  );
}

class _LoadingCard extends StatelessWidget {
  const _LoadingCard();

  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 760),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(width: 110, height: 12, color: const Color(0xffe2e8f0)),
              const SizedBox(height: 14),
              Container(
                width: double.infinity,
                height: 20,
                color: const Color(0xffe2e8f0),
              ),
              const SizedBox(height: 10),
              Container(width: 220, height: 14, color: const Color(0xfff1f5f9)),
            ],
          ),
        ),
      ),
    ),
  );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.body,
    this.action,
  });

  final IconData icon;
  final String title;
  final String body;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 760),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(30),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xffe2e8f0)),
        ),
        child: Column(
          children: [
            Icon(icon, size: 38, color: const Color(0xff64748b)),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xff64748b)),
            ),
            if (action != null) ...[const SizedBox(height: 10), action!],
          ],
        ),
      ),
    ),
  );
}
