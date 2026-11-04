import { createElement } from "react";
import type { ReactNode } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";

export function createMountedRouter(homeContent: ReactNode) {
  const rootRoute = createRootRoute({ component: () => createElement(Outlet) });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => homeContent,
  });
  const goalsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/goals",
    component: () => createElement("div", null, "Goals route mounted"),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, goalsRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return { router, RouterProvider };
}
