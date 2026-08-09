import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Decision } from "@decision-inbox/contracts";
import { DecisionCard } from "../src/renderer/components/DecisionCard";

const question: Decision = {
  externalId: "question-1",
  kind: "question",
  status: "pending",
  title: "Choose an environment",
  taskId: "task-1",
  runId: "run-1",
  createdAt: "2026-08-07T10:00:00.000Z",
  questions: [
    {
      id: "q-1",
      prompt: "Where should it run?",
      options: [
        {
          id: "prod",
          label: "Production",
          description: "Deploy to customer-facing servers.",
        },
        { id: "stage", label: "Staging" },
      ],
      multiple: false,
      required: true,
      allowFreeformInput: false,
    },
  ],
};

const approval: Decision = {
  externalId: "approval-1",
  kind: "approval",
  status: "pending",
  title: "Approve deployment",
  taskId: "task-1",
  runId: "run-1",
  taskTitle: "Production release",
  createdAt: "2026-08-07T10:00:00.000Z",
  approval: { commentAllowed: true },
};

function renderCard(
  decision: Decision,
  pending = true,
  resolve = vi.fn(async () => ({
    ok: true as const,
    externalId: decision.externalId,
    status: "answered",
  })),
) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return {
    resolve,
    ...render(
      <QueryClientProvider client={client}>
        <DecisionCard
          decision={decision}
          pending={pending}
          resolve={resolve}
          openTask={vi.fn(async () => undefined)}
          onResolved={vi.fn()}
          onStale={vi.fn()}
        />
      </QueryClientProvider>,
    ),
  };
}

describe("DecisionCard", () => {
  it("renders option descriptions without repeating the question as the card title", () => {
    renderCard(question);

    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(
      screen.getByText("Deploy to customer-facing servers."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Production")).toHaveAccessibleDescription(
      "Deploy to customer-facing servers.",
    );
    expect(
      screen.queryByRole("heading", { name: "Where should it run?" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Where should it run?")).toHaveLength(1);
  });

  it("keeps question answers together and validates required answers before submit", async () => {
    const user = userEvent.setup();
    const { resolve } = renderCard(question);
    expect(
      screen.getByRole("button", { name: "Submit answers" }),
    ).toBeDisabled();

    await user.click(screen.getByLabelText("Production"));
    expect(
      screen.getByRole("button", { name: "Submit answers" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Submit answers" }));

    await waitFor(() =>
      expect(resolve.mock.calls[0]?.[0]).toEqual({
        decisionKind: "question",
        externalId: "question-1",
        taskId: "task-1",
        runId: "run-1",
        answers: [
          { questionId: "q-1", optionIds: ["prod"], answerText: undefined },
        ],
      }),
    );
  });

  it("approves or rejects immediately without a confirmation step", async () => {
    const user = userEvent.setup();
    const { resolve } = renderCard(approval);
    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(resolve.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          decisionKind: "approval",
          action: "approve",
        }),
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the task title next to the source link", () => {
    renderCard(approval);

    expect(screen.getByText("Production release")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open source task" }),
    ).toBeInTheDocument();
  });

  it("shows a stale banner and asks the inbox to refetch", async () => {
    const user = userEvent.setup();
    const onStale = vi.fn();
    const resolve = vi.fn(async () => {
      const error = Object.assign(new Error("Already resolved"), {
        code: "already_resolved",
      });
      throw error;
    });
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <DecisionCard
          decision={approval}
          pending
          resolve={resolve}
          openTask={vi.fn(async () => undefined)}
          onResolved={vi.fn()}
          onStale={onStale}
        />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "changed elsewhere",
    );
    expect(onStale).toHaveBeenCalledOnce();
  });

  it("renders history as collapsed and read-only", () => {
    renderCard(
      { ...approval, status: "answered", summary: "Approved yesterday." },
      false,
    );
    expect(screen.getByText("Approve deployment")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Approved yesterday.")).not.toBeInTheDocument();
  });

  it("reveals all immutable history and audit details", async () => {
    const user = userEvent.setup();
    renderCard(
      {
        ...question,
        status: "answered",
        title: "Deployment target",
        taskTitle: "Deploy service",
        taskNumber: 42,
        projectName: "Platform",
        resolvedAt: "2026-08-07T10:30:00.000Z",
        resolver: {
          type: "external_agent",
          id: "agent-1",
          name: "Release bot",
          via: {
            type: "service_token",
            id: "token-1",
            name: "Desktop token",
          },
        },
        questions: [
          {
            id: "q-1",
            header: "Deployment target",
            prompt: "Where should it run?",
            options: [
              {
                id: "prod",
                label: "Production",
                description: "Customer-facing servers.",
                selected: true,
              },
              { id: "stage", label: "Staging", selected: false },
            ],
            multiple: false,
            required: true,
            allowFreeformInput: true,
            answerText: "After midnight",
          },
        ],
      },
      false,
    );

    const trigger = screen.getByRole("button", {
      name: "Expand decision: Deployment target",
    });
    expect(trigger).toHaveTextContent("Resolved");
    expect(trigger).toHaveTextContent("#42 Deploy service");
    expect(trigger).toHaveTextContent("Platform");
    expect(screen.queryByText("Where should it run?")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(screen.getByText("Where should it run?")).toBeInTheDocument();
    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("Customer-facing servers.")).toBeInTheDocument();
    expect(screen.getByText("After midnight")).toBeInTheDocument();
    expect(screen.getByText("Release bot")).toBeInTheDocument();
    expect(screen.getByText("(via Desktop token)")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open source task" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit answers" }),
    ).not.toBeInTheDocument();
  });

  it("shows the approval result and comment from history", async () => {
    const user = userEvent.setup();
    renderCard(
      {
        ...approval,
        status: "answered",
        resolvedAt: "2026-08-07T10:30:00.000Z",
        approval: {
          commentAllowed: true,
          approved: false,
          comment: "Needs another review",
        },
      },
      false,
    );

    expect(
      screen.getByRole("button", { name: /Expand decision/ }),
    ).toHaveTextContent("Rejected");
    await user.click(screen.getByRole("button", { name: /Expand decision/ }));
    expect(screen.getByText("Needs another review")).toBeInTheDocument();
  });

  it("shows cancellation time and reason without resolution controls", async () => {
    const user = userEvent.setup();
    renderCard(
      {
        ...approval,
        status: "cancelled",
        cancelledAt: "2026-08-07T10:30:00.000Z",
        cancellationReason: "The run was stopped",
        projectFallback: "/workspace/agentis",
        approval: { commentAllowed: true, approved: null },
      },
      false,
    );

    const trigger = screen.getByRole("button", { name: /Expand decision/ });
    expect(trigger).toHaveTextContent("Cancelled");
    expect(trigger).toHaveTextContent("/workspace/agentis");
    expect(screen.queryByText("The run was stopped")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(screen.getAllByText("The run was stopped")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
  });
});
