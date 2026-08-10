import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleIcon,
  QuestionIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { Decision, ResolveRequest } from "@decision-inbox/contracts";
import { isStaleError, type ResolveFunction } from "../api";
import { HistoryDecisionCard } from "./HistoryDecisionCard";
import { MarkdownText } from "./MarkdownText";

interface DecisionCardProps {
  /** Normalized decision rendered by the BFF. */
  decision: Decision;
  /** Whether this card is actionable rather than a compact history item. */
  pending: boolean;
  /** Resolves one card independently from other cards. */
  resolve: ResolveFunction;
  /** Opens the fixed Agentis task URL through the main process. */
  openTask: (taskId: string, runId: string) => Promise<void>;
  /** Refreshes the list after a successful action. */
  onResolved: () => void;
  /** Refreshes the list after a stale response. */
  onStale: () => void;
}

interface AnswerState {
  optionIds: string[];
  answerText: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The decision could not be resolved.";
}

/** One focused, fully actionable decision card. */
export function DecisionCard({
  decision,
  pending,
  resolve,
  openTask,
  onResolved,
  onStale,
}: DecisionCardProps) {
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [comment, setComment] = useState("");
  const [stale, setStale] = useState(false);
  const mutation = useMutation({
    mutationFn: resolve,
    onSuccess: onResolved,
    onError: (error) => {
      if (isStaleError(error)) {
        setStale(true);
        onStale();
      }
    },
  });

  if (!pending) {
    return <HistoryDecisionCard decision={decision} openTask={openTask} />;
  }

  const questions = decision.questions ?? [];
  const firstQuestionPrompt = questions[0]?.prompt.trim();
  const titleDuplicatesQuestion =
    decision.kind === "question" &&
    decision.title.trim() === firstQuestionPrompt;
  const summary = decision.summary?.trim();
  const summaryDuplicatesVisibleText =
    decision.kind === "question" &&
    (summary === firstQuestionPrompt || summary === decision.title.trim());
  const canSubmitQuestions = questions.every((question) => {
    if (!question.required) return true;
    const answer = answers[question.id];
    return Boolean(
      answer?.optionIds.length ||
      (question.allowFreeformInput && answer?.answerText.trim()),
    );
  });
  const actionDisabled =
    mutation.isPending || (decision.kind === "question" && !canSubmitQuestions);

  function selectOption(
    questionId: string,
    optionId: string,
    multiple: boolean,
  ): void {
    setAnswers((current) => {
      const previous = current[questionId] ?? { optionIds: [], answerText: "" };
      const optionIds = multiple
        ? previous.optionIds.includes(optionId)
          ? previous.optionIds.filter((id) => id !== optionId)
          : [...previous.optionIds, optionId]
        : [optionId];
      return { ...current, [questionId]: { ...previous, optionIds } };
    });
  }

  function submitQuestions(): void {
    const request: ResolveRequest = {
      decisionKind: "question",
      externalId: decision.externalId,
      taskId: decision.taskId,
      runId: decision.runId,
      answers: questions.map((question) => ({
        questionId: question.id,
        optionIds: answers[question.id]?.optionIds ?? [],
        answerText: answers[question.id]?.answerText.trim() || undefined,
      })),
    };
    mutation.mutate(request);
  }

  function submitApproval(action: "approve" | "reject"): void {
    mutation.mutate({
      decisionKind: "approval",
      externalId: decision.externalId,
      taskId: decision.taskId,
      runId: decision.runId,
      action,
      comment: comment.trim() || undefined,
    });
  }

  return (
    <article
      className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-[0_10px_30px_-18px_rgba(67,56,202,0.45)]"
      data-testid={`decision-card-${decision.externalId}`}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"
          aria-hidden="true"
        >
          {decision.kind === "question" ? (
            <QuestionIcon size={19} weight="bold" />
          ) : (
            <CheckCircleIcon size={19} weight="bold" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-600">
              {decision.kind}
            </span>
            <span className="text-xs text-slate-400">
              Waiting for your decision
            </span>
          </div>
          {!titleDuplicatesQuestion ? (
            <h2 className="mt-1 text-base font-semibold leading-6 text-slate-900">
              {decision.title}
            </h2>
          ) : null}
          {summary && !summaryDuplicatesVisibleText ? (
            <p className="mt-1 text-sm leading-5 text-slate-500">{summary}</p>
          ) : null}
        </div>
        <div className="flex max-w-[45%] shrink-0 items-center gap-1">
          {decision.taskTitle ? (
            <span
              className="truncate text-xs font-medium text-slate-600"
              title={decision.taskTitle}
            >
              {decision.taskTitle}
            </span>
          ) : null}
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={() => void openTask(decision.taskId, decision.runId)}
            aria-label="Open source task"
          >
            <ArrowSquareOutIcon size={15} aria-hidden="true" />
            Source
          </button>
        </div>
      </div>

      {stale ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800"
        >
          <WarningCircleIcon
            size={18}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>This decision changed elsewhere. The inbox is refreshing.</span>
        </div>
      ) : null}
      {mutation.isError && !stale ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
        >
          {errorMessage(mutation.error)}
        </div>
      ) : null}

      {decision.kind === "question" ? (
        <div className="mt-5 space-y-5">
          {questions.map((question, questionIndex) => {
            const answer = answers[question.id] ?? {
              optionIds: [],
              answerText: "",
            };
            const promptId = `${decision.externalId}-${question.id}-prompt`;
            return (
              <fieldset
                key={question.id}
                className="space-y-2.5"
                data-testid={`question-${question.id}`}
                aria-labelledby={promptId}
              >
                <div
                  id={promptId}
                  className="flex items-start text-sm font-semibold text-slate-800"
                >
                  <span className="mr-2 text-xs font-normal text-slate-400">
                    {questionIndex + 1}
                  </span>
                  <MarkdownText
                    className="min-w-0 flex-1"
                    content={question.prompt}
                  />
                  {question.required ? (
                    <span
                      className="ml-1 text-indigo-600"
                      aria-label="required"
                    >
                      *
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {question.options.map((option) => {
                    const selected = answer.optionIds.includes(option.id);
                    const descriptionId = `${decision.externalId}-${question.id}-${option.id}-description`;
                    return (
                      <label
                        key={option.id}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition ${selected ? "border-indigo-300 bg-indigo-50 text-indigo-900" : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}
                      >
                        <input
                          type={question.multiple ? "checkbox" : "radio"}
                          name={`${decision.externalId}-${question.id}`}
                          value={option.id}
                          checked={selected}
                          aria-label={option.label}
                          aria-describedby={
                            option.description ? descriptionId : undefined
                          }
                          onChange={() =>
                            selectOption(
                              question.id,
                              option.id,
                              question.multiple,
                            )
                          }
                          className="sr-only"
                        />
                        <span
                          className="flex size-4 items-center justify-center rounded-full border border-current"
                          aria-hidden="true"
                        >
                          {selected ? (
                            <CheckIcon size={11} weight="bold" />
                          ) : question.multiple ? (
                            <CircleIcon size={5} weight="fill" />
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block">{option.label}</span>
                          {option.description ? (
                            <span
                              id={descriptionId}
                              className="mt-0.5 block text-xs text-slate-500"
                            >
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {question.allowFreeformInput ? (
                  <input
                    value={answer.answerText}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.id]: {
                          ...answer,
                          answerText: event.target.value,
                        },
                      }))
                    }
                    placeholder="Add a short answer (optional)"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                  />
                ) : null}
              </fieldset>
            );
          })}
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <span className="text-xs text-slate-400">
              All answers are sent together.
            </span>
            <button
              type="button"
              disabled={actionDisabled}
              onClick={submitQuestions}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckIcon size={17} weight="bold" aria-hidden="true" />
              {mutation.isPending ? "Sending…" : "Submit answers"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-slate-600">
            Review this request and choose an action. No confirmation is
            required.
          </p>
          {decision.approval?.commentAllowed !== false ? (
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="Optional comment"
              aria-label="Optional comment"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => submitApproval("reject")}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <XIcon size={17} weight="bold" aria-hidden="true" />
              Reject
            </button>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => submitApproval("approve")}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckIcon size={17} weight="bold" aria-hidden="true" />
              Approve
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
