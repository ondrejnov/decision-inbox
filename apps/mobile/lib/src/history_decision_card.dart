import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'app_controller.dart';
import 'models.dart';

class HistoryDecisionCard extends StatelessWidget {
  const HistoryDecisionCard({
    super.key,
    required this.decision,
    required this.controller,
  });

  final Decision decision;
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final cancelled = decision.status == 'cancelled';
    final terminalTime = cancelled
        ? decision.cancelledAt
        : (decision.resolvedAt ?? decision.updatedAt);
    final result = _result(decision);
    return Card(
      key: ValueKey('history-card-${decision.externalId}'),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
        childrenPadding: EdgeInsets.zero,
        leading: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: decision.kind == DecisionKind.question
                ? const Color(0xffeff6ff)
                : const Color(0xfffffbeb),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(
            decision.kind == DecisionKind.question
                ? Icons.help_outline
                : Icons.approval_outlined,
            color: decision.kind == DecisionKind.question
                ? const Color(0xff1d4ed8)
                : const Color(0xffb45309),
          ),
        ),
        title: Text(
          decision.title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Color(0xff0f172a),
            fontWeight: FontWeight.w700,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 5),
          child: Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(decision.taskLabel),
              Text(decision.projectLabel),
              Text(_formatDate(terminalTime)),
              _ResultBadge(result: result),
            ],
          ),
        ),
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              color: Color(0xfff8fafc),
              border: Border(top: BorderSide(color: Color(0xffe2e8f0))),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Wrap(
                  spacing: 10,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _Meta(
                      icon: Icons.folder_outlined,
                      text: decision.projectLabel,
                    ),
                    _Meta(
                      icon: Icons.schedule,
                      text:
                          '${cancelled ? 'Cancelled' : 'Resolved'} ${_formatDate(terminalTime)}',
                    ),
                    TextButton.icon(
                      onPressed: () => _openSource(context),
                      icon: const Icon(Icons.open_in_new, size: 18),
                      label: Text(decision.taskLabel),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                if (decision.kind == DecisionKind.question)
                  for (
                    var index = 0;
                    index < decision.questions.length;
                    index++
                  )
                    _QuestionHistory(
                      question: decision.questions[index],
                      index: index,
                    )
                else
                  _ApprovalHistory(decision: decision, result: result),
                const SizedBox(height: 8),
                if (!cancelled)
                  _Meta(
                    icon: Icons.person_outline,
                    text: 'Resolved by ${_resolverLabel(decision.resolver)}',
                  ),
                if (cancelled && decision.cancellationReason != null)
                  _DetailBox(
                    label: 'Cancellation reason',
                    value: decision.cancellationReason!,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openSource(BuildContext context) async {
    try {
      await controller.openTask(decision);
    } on ApiException catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }
}

class _QuestionHistory extends StatelessWidget {
  const _QuestionHistory({required this.question, required this.index});

  final DecisionQuestion question;
  final int index;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: const Color(0xffbae6fd)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          question.header ?? 'Question ${index + 1}',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 5),
        Text(question.prompt, style: const TextStyle(height: 1.4)),
        if (question.options.isNotEmpty) ...[
          const SizedBox(height: 10),
          for (final option in question.options)
            Container(
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: option.selected
                    ? const Color(0xfff0f9ff)
                    : const Color(0xfff8fafc),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: option.selected
                      ? const Color(0xff7dd3fc)
                      : const Color(0xffe2e8f0),
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    option.selected
                        ? Icons.check_circle
                        : Icons.circle_outlined,
                    size: 18,
                    color: option.selected
                        ? const Color(0xff0284c7)
                        : const Color(0xff94a3b8),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(option.label),
                        if (option.description != null)
                          Text(
                            option.description!,
                            style: const TextStyle(
                              color: Color(0xff64748b),
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
        if (question.answerText != null) ...[
          const SizedBox(height: 8),
          _DetailBox(label: 'Text answer', value: question.answerText!),
        ],
      ],
    ),
  );
}

class _ApprovalHistory extends StatelessWidget {
  const _ApprovalHistory({required this.decision, required this.result});

  final Decision decision;
  final String result;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: const Color(0xfffde68a)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          decision.title,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        if (decision.summary != null) ...[
          const SizedBox(height: 6),
          Text(decision.summary!, style: const TextStyle(height: 1.4)),
        ],
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerLeft,
          child: _ResultBadge(result: result),
        ),
        if (decision.approval?.comment != null) ...[
          const SizedBox(height: 10),
          _DetailBox(label: 'Comment', value: decision.approval!.comment!),
        ],
      ],
    ),
  );
}

class _Meta extends StatelessWidget {
  const _Meta({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 17, color: const Color(0xff64748b)),
      const SizedBox(width: 5),
      Flexible(
        child: Text(text, style: const TextStyle(color: Color(0xff475569))),
      ),
    ],
  );
}

class _DetailBox extends StatelessWidget {
  const _DetailBox({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(10),
    decoration: BoxDecoration(
      color: const Color(0xfff8fafc),
      borderRadius: BorderRadius.circular(10),
      border: Border.all(color: const Color(0xffe2e8f0)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Color(0xff64748b),
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 3),
        Text(value),
      ],
    ),
  );
}

class _ResultBadge extends StatelessWidget {
  const _ResultBadge({required this.result});

  final String result;

  @override
  Widget build(BuildContext context) {
    final colors = switch (result) {
      'Approved' => (const Color(0xffecfdf5), const Color(0xff047857)),
      'Rejected' => (const Color(0xfffff1f2), const Color(0xffbe123c)),
      _ => (const Color(0xfff1f5f9), const Color(0xff475569)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: colors.$1,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        result,
        style: TextStyle(
          color: colors.$2,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

String _result(Decision decision) {
  if (decision.status == 'cancelled') return 'Cancelled';
  if (decision.approval?.approved == true) return 'Approved';
  if (decision.approval?.approved == false) return 'Rejected';
  return 'Resolved';
}

String _resolverLabel(DecisionResolver? resolver) {
  if (resolver == null || resolver.type == 'unknown' || resolver.name == null) {
    return 'Unknown';
  }
  return resolver.viaName == null
      ? resolver.name!
      : '${resolver.name} via ${resolver.viaName}';
}

String _formatDate(DateTime? date) => date == null
    ? '-'
    : DateFormat('d. M. y, HH:mm', 'cs_CZ').format(date.toLocal());
