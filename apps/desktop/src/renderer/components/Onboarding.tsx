import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  KeyIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { RuntimeConfig, SessionResponse } from "@decision-inbox/contracts";
import type { DesktopApi } from "../../shared/ipc";

interface OnboardingProps {
  api: DesktopApi;
  config?: RuntimeConfig;
  onComplete: (session: SessionResponse) => void;
  reauthenticate?: boolean;
}

export function Onboarding({
  api,
  config,
  onComplete,
  reauthenticate = false,
}: OnboardingProps) {
  const [tokenLength, setTokenLength] = useState(0);
  const [autostart, setAutostart] = useState(false);
  const mutation = useMutation({
    mutationFn: () => api.submitTokenEntry(autostart),
    onSuccess: onComplete,
  });

  useEffect(() => {
    const removeState = api.onTokenEntryState((state) =>
      setTokenLength(state.length),
    );
    const removeSubmit = api.onTokenEntrySubmit(() => {
      if (tokenLength > 0 && !mutation.isPending) mutation.mutate();
    });
    return () => {
      removeState();
      removeSubmit();
    };
  }, [api, mutation, tokenLength]);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!tokenLength || mutation.isPending) return;
    mutation.mutate();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] p-6 text-slate-900">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_24px_70px_-35px_rgba(15,23,42,0.35)]">
        <div
          className="flex size-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
          aria-hidden="true"
        >
          <KeyIcon size={24} weight="bold" />
        </div>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">
          Decision Inbox
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {reauthenticate
            ? "Reconnect your Agentis account"
            : "Connect your Agentis account"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          {reauthenticate
            ? "The saved Agentis token is no longer accepted. Enter a new token to resume the inbox."
            : "The secure entry buffer stays in the desktop main process. It is tested and stored only using the operating system secure store."}
        </p>
        <form className="mt-7 space-y-5" onSubmit={submit}>
          <div className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Agentis API token
            </span>
            <button
              type="button"
              onClick={() => {
                mutation.reset();
                void api.beginTokenEntry();
              }}
              aria-label="Agentis API token secure entry"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-left text-sm text-slate-900 outline-none transition hover:border-indigo-300 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            >
              {tokenLength ? (
                "•".repeat(Math.min(tokenLength, 32))
              ) : (
                <span className="text-slate-400">
                  Click here, then type or paste your token
                </span>
              )}
            </button>
            {tokenLength ? (
              <button
                type="button"
                onClick={() => void api.cancelTokenEntry()}
                className="mt-2 text-xs font-medium text-slate-500 hover:text-slate-800"
              >
                Clear secure entry
              </button>
            ) : null}
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={autostart}
              onChange={(event) => setAutostart(event.target.checked)}
              className="mt-0.5 size-4 accent-indigo-600"
            />
            <span>
              <strong className="font-semibold text-slate-800">
                Start at login
              </strong>
              <br />
              Enable only with your consent.
            </span>
          </label>
          {mutation.isError ? (
            <div
              role="alert"
              className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
            >
              <WarningCircleIcon
                size={18}
                className="mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <span>
                {mutation.error instanceof Error
                  ? mutation.error.message
                  : "Connection failed."}
              </span>
            </div>
          ) : null}
          <button
            type="submit"
            disabled={!tokenLength || mutation.isPending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShieldCheckIcon size={18} weight="bold" aria-hidden="true" />
            {mutation.isPending ? "Testing connection…" : "Test connection"}
            {!mutation.isPending ? (
              <ArrowRightIcon size={17} aria-hidden="true" />
            ) : null}
          </button>
        </form>
        {config ? (
          <p className="mt-5 truncate text-center text-[11px] text-slate-400">
            BFF: {config.bffUrl}
          </p>
        ) : null}
      </section>
    </main>
  );
}
