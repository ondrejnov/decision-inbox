import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BellIcon,
  CircleNotchIcon,
  GearSixIcon,
  SignOutIcon,
  WifiHighIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react";
import type {
  DecisionListResponse,
  DecisionView,
  SessionResponse,
  Settings,
} from "@decision-inbox/contracts";
import type { DesktopApi } from "../../shared/ipc";
import { DecisionCard } from "./DecisionCard";
import { SettingsPanel } from "./SettingsPanel";

const snapshotStore = new Map<DecisionView, DecisionListResponse>();

export function clearDecisionSnapshots(): void {
  snapshotStore.clear();
}

interface InboxProps {
  api: DesktopApi;
  session: SessionResponse;
}

function LoadingCards() {
  return (
    <div className="space-y-3" aria-label="Loading decisions">
      <div className="h-48 animate-pulse rounded-2xl bg-slate-200/70" />
      <div className="h-36 animate-pulse rounded-2xl bg-slate-200/70" />
    </div>
  );
}

export function Inbox({ api, session }: InboxProps) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<DecisionView>("pending");
  const [page, setPage] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | undefined>();
  const decisionsQuery = useQuery({
    queryKey: ["decisions", view, page],
    queryFn: () => api.getDecisions(view, page),
    retry: false,
    staleTime: 5_000,
  });
  const countQuery = useQuery({
    queryKey: ["pending-count"],
    queryFn: () => api.getPendingCount(),
    refetchInterval: 60_000,
    retry: false,
  });
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.getSettings(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const logoutMutation = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      clearDecisionSnapshots();
      queryClient.setQueryData(["session"], null);
      queryClient.clear();
    },
  });
  const snapshot = snapshotStore.get(view);
  const data = decisionsQuery.data ?? snapshot;
  const offline = decisionsQuery.isError && Boolean(snapshot);

  useEffect(() => {
    if (decisionsQuery.data) snapshotStore.set(view, decisionsQuery.data);
  }, [decisionsQuery.data, view]);

  useEffect(() => {
    if (settingsQuery.data) setSettings(settingsQuery.data);
  }, [settingsQuery.data]);

  useEffect(() => {
    if (countQuery.data) void api.setPendingCount(countQuery.data.count);
  }, [api, countQuery.data]);

  useEffect(() => {
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["decisions"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-count"] });
    };
    const removeEventListener = api.onDecisionChanged(invalidate);
    const removeReconnectListener = api.onEventsReconnected(invalidate);
    const removePendingListener = api.onOpenPending(() => {
      setView("pending");
      setPage(1);
      invalidate();
    });
    void api.startEvents();
    const online = () => invalidate();
    window.addEventListener("online", online);
    return () => {
      removeEventListener();
      removeReconnectListener();
      removePendingListener();
      window.removeEventListener("online", online);
      void api.stopEvents();
    };
  }, [api, queryClient]);

  const title = useMemo(
    () => (view === "pending" ? "Pending inbox" : "Decision history"),
    [view],
  );

  function refresh(): void {
    void decisionsQuery.refetch();
    void countQuery.refetch();
  }

  function handleStale(): void {
    void decisionsQuery.refetch();
    void countQuery.refetch();
  }

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-5">
        <header className="relative flex items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/15"
              aria-hidden="true"
            >
              <BellIcon size={20} weight="bold" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                Decision Inbox
              </p>
              <p className="truncate text-xs text-slate-500">
                {session.user.displayName} ·{" "}
                {session.tenant.name ?? session.tenant.id}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={`mr-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${offline ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
              title={offline ? "Showing an in-memory snapshot" : "Connected"}
            >
              {offline ? (
                <WifiSlashIcon size={14} aria-hidden="true" />
              ) : (
                <WifiHighIcon size={14} aria-hidden="true" />
              )}
              {offline ? "Offline snapshot" : "Connected"}
            </span>
            <button
              type="button"
              onClick={refresh}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label="Refresh inbox"
              title="Refresh inbox"
            >
              <ArrowClockwiseIcon size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label="Open settings"
              title="Settings"
            >
              <GearSixIcon size={18} aria-hidden="true" />
            </button>
            {settingsOpen && settings ? (
              <SettingsPanel
                api={api}
                settings={settings}
                onChange={setSettings}
              />
            ) : null}
            <button
              type="button"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
              aria-label="Log out"
              title="Log out"
            >
              <SignOutIcon size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="flex items-end justify-between gap-4 border-b border-slate-200 pt-5">
          <div
            className="flex items-end gap-5"
            role="tablist"
            aria-label="Decision views"
          >
            {(["pending", "history"] as const).map((nextView) => (
              <button
                type="button"
                role="tab"
                aria-selected={view === nextView}
                key={nextView}
                onClick={() => {
                  setView(nextView);
                  setPage(1);
                }}
                className={`border-b-2 px-1 pb-3 text-sm font-semibold transition ${view === nextView ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-400 hover:text-slate-700"}`}
              >
                {nextView === "pending" ? "Pending" : "History"}
                {nextView === "pending" && countQuery.data ? (
                  <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">
                    {countQuery.data.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="pb-3 text-xs text-slate-400">20 per page</div>
        </div>

        <section className="flex-1 py-6" aria-labelledby="inbox-title">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">
                {view === "pending" ? "Action required" : "Archive"}
              </p>
              <h1
                id="inbox-title"
                className="mt-1 text-2xl font-semibold tracking-tight"
              >
                {title}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              {data?.total !== undefined ? (
                <span className="text-sm text-slate-400" aria-live="polite">
                  {data.total} total
                </span>
              ) : null}
              {decisionsQuery.isFetching ? (
                <CircleNotchIcon
                  size={20}
                  className="animate-spin text-indigo-500"
                  aria-label="Refreshing"
                />
              ) : null}
            </div>
          </div>
          {offline ? (
            <div
              role="status"
              className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800"
            >
              <WifiSlashIcon size={17} aria-hidden="true" /> Read-only snapshot.
              Actions will be available after reconnect.
            </div>
          ) : null}
          {decisionsQuery.isPending && !data ? <LoadingCards /> : null}
          {decisionsQuery.isError && !data ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
              <p className="font-semibold">Could not load the inbox.</p>
              <button
                type="button"
                onClick={refresh}
                className="mt-3 rounded-lg bg-white px-3 py-2 font-semibold text-rose-700 shadow-sm"
              >
                Try again
              </button>
            </div>
          ) : null}
          {data && data.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              <p className="text-sm font-semibold text-slate-700">
                {view === "pending"
                  ? "You are all caught up."
                  : "No decision history yet."}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {view === "pending"
                  ? "New questions and approvals will appear here."
                  : "Resolved decisions will appear here."}
              </p>
            </div>
          ) : null}
          {data && data.items.length > 0 ? (
            <div className="space-y-3">
              {data.items.map((decision) => (
                <DecisionCard
                  key={`${decision.kind}-${decision.externalId}`}
                  decision={decision}
                  pending={view === "pending" && !offline}
                  resolve={api.resolve}
                  openTask={api.openTask}
                  onResolved={refresh}
                  onStale={handleStale}
                />
              ))}
            </div>
          ) : null}
        </section>

        <footer className="flex items-center justify-between border-t border-slate-200 pt-4 text-xs text-slate-400">
          <span>
            Page {data?.page ?? page}
            {data?.total !== undefined
              ? ` of ${Math.max(1, Math.ceil(data.total / data.pageSize))}`
              : ""}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || decisionsQuery.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeftIcon size={14} aria-hidden="true" /> Previous
            </button>
            <button
              type="button"
              disabled={!data?.hasNext || decisionsQuery.isFetching}
              onClick={() => setPage((current) => current + 1)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next <ArrowRightIcon size={14} aria-hidden="true" />
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}
