import { useState } from "react";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockIcon,
  FolderOpenIcon,
  ProhibitIcon,
  QuestionIcon,
  UserCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { Decision } from "@decision-inbox/contracts";
import { MarkdownText } from "./MarkdownText";

interface HistoryDecisionCardProps {
  decision: Decision;
  openTask: (taskId: string, runId: string) => Promise<void>;
}

const dateTimeFormatter = new Intl.DateTimeFormat("cs-CZ", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function HistoryDecisionCard({
  decision,
  openTask,
}: HistoryDecisionCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const cancelled = decision.status === "cancelled";
  const projectLabel =
    decision.projectName ?? decision.projectFallback ?? "No project";
  const taskLabel = `${decision.taskNumber == null ? "" : `#${decision.taskNumber} `}${decision.taskTitle ?? "Untitled"}`;
  const terminalTime = cancelled
    ? decision.cancelledAt
    : (decision.resolvedAt ?? decision.updatedAt);
  const approvalResult = decision.approval?.approved;
  const resultLabel = cancelled
    ? "Cancelled"
    : approvalResult === true
      ? "Approved"
      : approvalResult === false
        ? "Rejected"
        : "Resolved";
  const resultClassName = cancelled
    ? "bg-slate-100 text-slate-600"
    : approvalResult === true
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : approvalResult === false
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "bg-slate-100 text-slate-700";
  const typeLabel = decision.kind === "question" ? "Question" : "Approval";
  const resolverName =
    decision.resolver?.type === "unknown" || !decision.resolver?.name
      ? "Unknown"
      : decision.resolver.name;

  return (
    <article
      className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
      data-testid={`decision-card-${decision.externalId}`}
    >
      <button
        type="button"
        className="w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 sm:px-5"
        aria-expanded={isOpen}
        aria-label={`${isOpen ? "Collapse" : "Expand"} decision: ${decision.title}`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="flex min-w-0 items-start gap-2.5">
          {isOpen ? (
            <CaretDownIcon
              size={16}
              weight="bold"
              className="mt-1.5 shrink-0 text-slate-400"
              aria-hidden="true"
            />
          ) : (
            <CaretRightIcon
              size={16}
              weight="bold"
              className="mt-1.5 shrink-0 text-slate-400"
              aria-hidden="true"
            />
          )}
          <span
            role="img"
            aria-label={typeLabel}
            title={typeLabel}
            className={`flex size-7 shrink-0 items-center justify-center rounded-md ${decision.kind === "question" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}
          >
            {decision.kind === "question" ? (
              <QuestionIcon size={16} weight="bold" aria-hidden="true" />
            ) : (
              <CheckCircleIcon size={16} weight="bold" aria-hidden="true" />
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                {decision.title}
              </span>
              <span
                className={`rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold ${resultClassName}`}
              >
                {resultLabel}
              </span>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="min-w-0 truncate font-medium text-slate-700">
                {taskLabel}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1">
                <FolderOpenIcon
                  size={14}
                  className="shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate">{projectLabel}</span>
              </span>
              <span className="inline-flex items-center gap-1 sm:ml-auto">
                <ClockIcon size={14} className="shrink-0" aria-hidden="true" />
                <time dateTime={terminalTime}>
                  {formatDateTime(terminalTime)}
                </time>
              </span>
            </span>
          </span>
        </span>
      </button>

      {isOpen ? (
        <div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-sm sm:px-5">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-slate-500">
              <FolderOpenIcon
                size={16}
                className="shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">{projectLabel}</span>
            </span>
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1 font-semibold text-slate-900 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              onClick={() => void openTask(decision.taskId, decision.runId)}
              aria-label="Open source task"
            >
              <span className="truncate">{taskLabel}</span>
              <ArrowSquareOutIcon
                size={14}
                className="shrink-0"
                aria-hidden="true"
              />
            </button>
            <span className="ml-auto rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              {typeLabel}
            </span>
            <span className="font-medium text-slate-500">
              {cancelled ? "Cancelled" : "Resolved"}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <ClockIcon size={14} aria-hidden="true" />
              <time dateTime={terminalTime}>
                {formatDateTime(terminalTime)}
              </time>
            </span>
          </div>

          <div className="min-w-0 p-3 sm:p-4">
            {decision.kind === "question" ? (
              <QuestionHistory decision={decision} />
            ) : (
              <ApprovalHistory
                decision={decision}
                resultLabel={resultLabel}
                resultClassName={resultClassName}
              />
            )}
          </div>

          <footer className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50/40 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:px-5">
            <span className="inline-flex items-center gap-1.5">
              <ClockIcon size={16} aria-hidden="true" />
              <span>{cancelled ? "Cancelled" : "Resolved"}:</span>
              <time dateTime={terminalTime}>
                {formatDateTime(terminalTime)}
              </time>
            </span>
            {!cancelled ? (
              <span className="inline-flex items-center gap-1.5">
                <UserCircleIcon size={16} aria-hidden="true" />
                <span>Resolved by:</span>
                <span className="font-medium text-slate-900">
                  {resolverName}
                </span>
                {decision.resolver?.via?.name ? (
                  <span>(via {decision.resolver.via.name})</span>
                ) : null}
              </span>
            ) : null}
            {cancelled && decision.cancellationReason ? (
              <span className="min-w-0 whitespace-pre-wrap text-slate-900">
                {decision.cancellationReason}
              </span>
            ) : null}
          </footer>
        </div>
      ) : null}
    </article>
  );
}

function QuestionHistory({ decision }: { decision: Decision }) {
  return (
    <div className="space-y-3">
      {(decision.questions ?? []).map((question, index) => (
        <section
          key={question.id}
          className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm"
        >
          <div className="text-sm font-semibold text-slate-900">
            {question.header ?? `Question ${index + 1}`}
          </div>
          <MarkdownText
            className="mt-1 text-base text-slate-800"
            content={question.prompt}
          />
          {question.options.length > 0 ? (
            <div className="mt-4 space-y-2">
              {question.options.map((option) => (
                <div
                  key={option.id}
                  className={`flex w-full gap-3 rounded-lg border px-3 py-3 text-left ${option.selected ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-slate-50/80"}`}
                >
                  <span
                    className={`mt-0.5 size-4 shrink-0 border ${question.multiple ? "rounded-sm" : "rounded-full"} ${option.selected ? "border-sky-500 bg-sky-500 ring-2 ring-sky-200" : "border-slate-400 bg-white"}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-900">
                      {option.label}
                    </span>
                    {option.description ? (
                      <span className="mt-0.5 block text-xs text-slate-600">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {question.answerText ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
              <div className="text-xs font-medium text-slate-600">
                Text answer
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-slate-900">
                {question.answerText}
              </div>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function ApprovalHistory({
  decision,
  resultLabel,
  resultClassName,
}: {
  decision: Decision;
  resultLabel: string;
  resultClassName: string;
}) {
  const cancelled = decision.status === "cancelled";
  return (
    <section className="rounded-lg border border-amber-100 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-slate-900">
        {decision.title}
      </div>
      {decision.summary ? (
        <p className="mt-1 whitespace-pre-wrap text-base text-slate-800">
          {decision.summary}
        </p>
      ) : null}
      <div className="mt-4 flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium ${resultClassName}`}
        >
          {cancelled ? (
            <ProhibitIcon size={16} weight="bold" aria-hidden="true" />
          ) : decision.approval?.approved === true ? (
            <CheckCircleIcon size={16} weight="fill" aria-hidden="true" />
          ) : decision.approval?.approved === false ? (
            <XCircleIcon size={16} weight="fill" aria-hidden="true" />
          ) : null}
          {resultLabel}
        </span>
      </div>
      {decision.approval?.comment ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
          <div className="text-xs font-medium text-slate-600">Comment</div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-slate-900">
            {decision.approval.comment}
          </div>
        </div>
      ) : null}
      {cancelled && decision.cancellationReason ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
          <div className="text-xs font-medium text-slate-600">
            Cancellation reason
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-slate-900">
            {decision.cancellationReason}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}
