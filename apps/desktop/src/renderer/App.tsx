import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { DesktopApi } from "../shared/ipc";
import { desktopApi } from "./api";
import { Inbox } from "./components/Inbox";
import { Onboarding } from "./components/Onboarding";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
});

function Workspace({ api }: { api: DesktopApi }) {
  const client = useQueryClient();
  const [authRequired, setAuthRequired] = useState(false);
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => api.getSession(),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const configQuery = useQuery({
    queryKey: ["runtime-config"],
    queryFn: () => api.getConfig(),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => api.onAuthRequired(() => setAuthRequired(true)), [api]);

  if (sessionQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] text-sm text-slate-500">
        Loading secure session…
      </div>
    );
  }
  if (sessionQuery.data && !authRequired)
    return <Inbox api={api} session={sessionQuery.data} />;
  return (
    <Onboarding
      api={api}
      config={configQuery.data}
      onComplete={(session) => {
        setAuthRequired(false);
        client.setQueryData(["session"], session);
      }}
      reauthenticate={authRequired}
    />
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Workspace api={desktopApi()} />
    </QueryClientProvider>
  );
}
