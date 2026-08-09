import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

class QuestionPrompt extends StatelessWidget {
  const QuestionPrompt({
    super.key,
    required this.data,
    this.isRequired = false,
    this.style,
  });

  final String data;
  final bool isRequired;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final markdown = isRequired ? '$data \\*' : data;
    final baseStyle = style ?? DefaultTextStyle.of(context).style;

    return MarkdownBody(
      data: markdown,
      softLineBreak: true,
      styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
        p: baseStyle,
        strong: baseStyle.copyWith(fontWeight: FontWeight.w900),
      ),
    );
  }
}
