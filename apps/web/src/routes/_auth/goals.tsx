import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/goals")({ component: GoalsLayout });

function GoalsLayout() {
  return <Outlet />;
}
