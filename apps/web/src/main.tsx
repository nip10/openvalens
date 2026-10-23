// Must run before any module that parses with zod (see ./zod-config).
import "./zod-config";

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import Loader from "./components/loader";
import { DisplayPreferencesProvider } from "./lib/display-preferences";
import { AppI18nProvider } from "./lib/i18n";
import { initErrorReporting, reportError } from "./lib/error-reporting";
import { routeTree } from "./routeTree.gen";
import { orpc, queryClient } from "./utils/orpc";

initErrorReporting();

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultOnCatch: (error) => reportError(error),
  defaultPendingComponent: () => <Loader />,
  context: { orpc, queryClient },
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return (
      <AppI18nProvider>
        <DisplayPreferencesProvider>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </DisplayPreferencesProvider>
      </AppI18nProvider>
    );
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<RouterProvider router={router} />);
}
