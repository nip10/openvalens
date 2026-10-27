import { Toaster } from "@openvalens/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import AppShell from "@/components/header";
import { ThemeProvider } from "@/components/theme-provider";
import { orpc } from "@/utils/orpc";

import "../index.css";

export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  // The description and the Open Graph / Twitter tags are static in
  // apps/web/index.html, because link-preview crawlers do not run JavaScript;
  // only the title is managed here, so nothing is emitted twice.
  head: () => ({
    meta: [
      {
        title: "OpenValens",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.ico",
      },
    ],
  }),
});

function RootComponent() {
  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        {/* The shell's tracks are minmax(0,1fr) so wide page content (tables,
            <pre>) scrolls inside its own box instead of widening the document. */}
        <AppShell>
          <Outlet />
        </AppShell>
        <Toaster />
      </ThemeProvider>
      <TanStackRouterDevtools position="bottom-left" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </>
  );
}
