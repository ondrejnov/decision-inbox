import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'models.dart';
import 'question_prompt.dart';

class DecisionCard extends StatefulWidget {
  const DecisionCard({
    super.key,
    required this.decision,
    required this.controller,
    required this.readOnly,
  });

  final Decision decision;
  final AppController controller;
  final bool readOnly;

  @override
  State<DecisionCard> createState() => _DecisionCardState();
}

class _DecisionCardState extends State<DecisionCard> {
  final Map<String, Set<String>> _selected = {};
  final Map<String, TextEditingController> _answers = {};
  final _commentController = TextEditingController();
  bool _submitting = false;
  bool _stale = false;
  bool _dirty = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _initializeEditors();
  }

  void _initializeEditors() {
    for (final question in widget.decision.questions) {
      _selected[question.id] = question.options
          .where((option) => option.selected)
          .map((option) => option.id)
          .toSet();
      _answers[question.id] = TextEditingController(text: question.answerText);
    }
    _commentController.text = widget.decision.approval?.comment ?? '';
  }

  @override
  void didUpdateWidget(covariant DecisionCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final structureChanged =
        _decisionStructure(oldWidget.decision) !=
        _decisionStructure(widget.decision);
    final serverValuesChanged =
        _decisionServerValues(oldWidget.decision) !=
        _decisionServerValues(widget.decision);
    if (!structureChanged && (_dirty || !serverValuesChanged)) {
      return;
    }
    for (final controller in _answers.values) {
      controller.dispose();
    }
    _answers.clear();
    _selected.clear();
    _initializeEditors();
    _dirty = false;
    _stale = false;
    _error = null;
  }

  @override
  void dispose() {
    for (final controller in _answers.values) {
      controller.dispose();
    }
    _commentController.dispose();
    super.dispose();
  }

  bool get _questionsValid =>
      widget.decision.questions.isNotEmpty &&
      widget.decision.questions.every((question) {
        if (!question.required) return true;
        if (_selected[question.id]!.isNotEmpty) return true;
        return question.allowFreeformInput &&
            _answers[question.id]!.text.trim().isNotEmpty;
      });

  Future<void> _submitQuestions() async {
    if (!_questionsValid) return;
    final answers = widget.decision.questions
        .map(
          (question) => <String, dynamic>{
            'questionId': question.id,
            'optionIds': _selected[question.id]!.toList(),
            if (_answers[question.id]!.text.trim().isNotEmpty)
              'answerText': _answers[question.id]!.text.trim(),
          },
        )
        .toList(growable: false);
    await _resolve({
      'decisionKind': 'question',
      'externalId': widget.decision.externalId,
      'taskId': widget.decision.taskId,
      'runId': widget.decision.runId,
      'answers': answers,
    });
  }

  Future<void> _submitApproval(String action) => _resolve({
    'decisionKind': 'approval',
    'externalId': widget.decision.externalId,
    'taskId': widget.decision.taskId,
    'runId': widget.decision.runId,
    'action': action,
    if (_commentController.text.trim().isNotEmpty)
      'comment': _commentController.text.trim(),
  });

  Future<void> _resolve(JsonMap request) async {
    setState(() {
      _submitting = true;
      _stale = false;
      _error = null;
    });
    try {
      await widget.controller.resolve(request);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _stale =
            error.code == 'already_resolved' ||
            error.code == 'decision_cancelled';
        _error = _stale ? null : error.message;
      });
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not submit the decision.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _openSource() async {
    try {
      await widget.controller.openTask(widget.decision);
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final decision = widget.decision;
    final firstPrompt = decision.questions.isEmpty
        ? null
        : decision.questions.first.prompt;
    final showTitle = decision.title != firstPrompt;
    final showSummary =
        decision.summary != null &&
        decision.summary != firstPrompt &&
        decision.summary != decision.title;
    return Card(
      key: ValueKey('decision-card-${decision.externalId}'),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: Color(0xffc7d2fe)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(9),
                  decoration: BoxDecoration(
                    color: decision.kind == DecisionKind.question
                        ? const Color(0xffeff6ff)
                        : const Color(0xfffffbeb),
                    borderRadius: BorderRadius.circular(12),
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
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        decision.kind == DecisionKind.question
                            ? 'QUESTION'
                            : 'APPROVAL',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: const Color(0xff4f46e5),
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.1,
                        ),
                      ),
                      const SizedBox(height: 3),
                      const Text(
                        'Waiting for your decision',
                        style: TextStyle(
                          color: Color(0xff64748b),
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Open source task',
                  onPressed: _openSource,
                  icon: const Icon(Icons.open_in_new),
                ),
              ],
            ),
            if (decision.taskTitle != null) ...[
              const SizedBox(height: 12),
              Text(
                decision.taskTitle!,
                style: const TextStyle(
                  color: Color(0xff64748b),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            if (showTitle) ...[
              const SizedBox(height: 12),
              Text(
                decision.title,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  color: const Color(0xff0f172a),
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
            if (showSummary) ...[
              const SizedBox(height: 8),
              Text(
                decision.summary!,
                style: const TextStyle(color: Color(0xff475569), height: 1.45),
              ),
            ],
            const SizedBox(height: 18),
            if (decision.kind == DecisionKind.question)
              ..._buildQuestions(context)
            else
              _buildApproval(context),
            if (_stale) ...[
              const SizedBox(height: 14),
              const _InlineMessage(
                icon: Icons.sync,
                text:
                    'This decision changed elsewhere. The inbox is refreshing.',
                background: Color(0xfffffbeb),
                foreground: Color(0xff92400e),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 14),
              _InlineMessage(
                icon: Icons.error_outline,
                text: _error!,
                background: const Color(0xfffff1f2),
                foreground: const Color(0xff9f1239),
              ),
            ],
          ],
        ),
      ),
    );
  }

  List<Widget> _buildQuestions(BuildContext context) {
    final widgets = <Widget>[];
    if (widget.decision.questions.isEmpty) {
      return const [
        _InlineMessage(
          icon: Icons.warning_amber_outlined,
          text: 'This question has no answer fields and cannot be submitted.',
          background: Color(0xfffffbeb),
          foreground: Color(0xff92400e),
        ),
      ];
    }
    for (var index = 0; index < widget.decision.questions.length; index++) {
      final question = widget.decision.questions[index];
      widgets.add(
        Container(
          margin: const EdgeInsets.only(bottom: 14),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xfff8fafc),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xffe2e8f0)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                question.header ?? 'Question ${index + 1}',
                style: const TextStyle(
                  color: Color(0xff64748b),
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 5),
              QuestionPrompt(
                data: question.prompt,
                isRequired: question.required,
                style: const TextStyle(
                  color: Color(0xff0f172a),
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  height: 1.35,
                ),
              ),
              if (question.options.isNotEmpty) ...[
                const SizedBox(height: 12),
                for (final option in question.options)
                  _OptionTile(
                    option: option,
                    multiple: question.multiple,
                    selected: _selected[question.id]!.contains(option.id),
                    enabled: !_submitting && !widget.readOnly,
                    onTap: () {
                      setState(() {
                        _dirty = true;
                        final selected = _selected[question.id]!;
                        if (question.multiple) {
                          selected.contains(option.id)
                              ? selected.remove(option.id)
                              : selected.add(option.id);
                        } else {
                          selected
                            ..clear()
                            ..add(option.id);
                        }
                      });
                    },
                  ),
              ],
              if (question.allowFreeformInput) ...[
                const SizedBox(height: 10),
                TextField(
                  controller: _answers[question.id],
                  enabled: !_submitting && !widget.readOnly,
                  maxLength: 4000,
                  minLines: 1,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    hintText: 'Add a short answer (optional)',
                    counterText: '',
                  ),
                  onChanged: (_) => setState(() => _dirty = true),
                ),
              ],
            ],
          ),
        ),
      );
    }
    widgets.add(
      FilledButton.icon(
        onPressed: _submitting || !_questionsValid || widget.readOnly
            ? null
            : _submitQuestions,
        icon: _submitting
            ? const SizedBox.square(
                dimension: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.send_outlined),
        label: Text(_submitting ? 'Sending...' : 'Submit answers'),
      ),
    );
    return widgets;
  }

  Widget _buildApproval(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Text(
        'Review this request and choose an action. No confirmation is required.',
        style: TextStyle(color: Color(0xff64748b), height: 1.4),
      ),
      if (widget.decision.approval?.commentAllowed != false) ...[
        const SizedBox(height: 14),
        TextField(
          controller: _commentController,
          enabled: !_submitting && !widget.readOnly,
          maxLength: 4000,
          minLines: 2,
          maxLines: 5,
          decoration: const InputDecoration(
            labelText: 'Comment (optional)',
            alignLabelWithHint: true,
          ),
          onChanged: (_) => _dirty = true,
        ),
      ],
      const SizedBox(height: 14),
      Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xffbe123c),
                minimumSize: const Size(0, 50),
                side: const BorderSide(color: Color(0xfffda4af)),
              ),
              onPressed: _submitting || widget.readOnly
                  ? null
                  : () => _submitApproval('reject'),
              icon: const Icon(Icons.close),
              label: const Text('Reject'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xff059669),
              ),
              onPressed: _submitting || widget.readOnly
                  ? null
                  : () => _submitApproval('approve'),
              icon: _submitting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.check),
              label: const Text('Approve'),
            ),
          ),
        ],
      ),
    ],
  );
}

String _decisionStructure(Decision decision) => [
  decision.baselineKey,
  for (final question in decision.questions)
    '${question.id}:${question.options.map((option) => option.id).join(',')}',
].join('|');

String _decisionServerValues(Decision decision) => [
  for (final question in decision.questions) ...[
    question.answerText ?? '',
    for (final option in question.options) '${option.id}:${option.selected}',
  ],
  decision.approval?.comment ?? '',
].join('|');

class _OptionTile extends StatelessWidget {
  const _OptionTile({
    required this.option,
    required this.multiple,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  final DecisionOption option;
  final bool multiple;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? const Color(0xffeef2ff) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: selected ? const Color(0xff818cf8) : const Color(0xffcbd5e1),
          ),
        ),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Icon(
                  selected
                      ? (multiple
                            ? Icons.check_box
                            : Icons.radio_button_checked)
                      : (multiple
                            ? Icons.check_box_outline_blank
                            : Icons.radio_button_unchecked),
                  color: selected
                      ? const Color(0xff4f46e5)
                      : const Color(0xff64748b),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        option.label,
                        style: const TextStyle(
                          color: Color(0xff0f172a),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (option.description != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          option.description!,
                          style: const TextStyle(
                            color: Color(0xff64748b),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class _InlineMessage extends StatelessWidget {
  const _InlineMessage({
    required this.icon,
    required this.text,
    required this.background,
    required this.foreground,
  });

  final IconData icon;
  final String text;
  final Color background;
  final Color foreground;

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
          Icon(icon, color: foreground, size: 20),
          const SizedBox(width: 9),
          Expanded(
            child: Text(text, style: TextStyle(color: foreground)),
          ),
        ],
      ),
    ),
  );
}
