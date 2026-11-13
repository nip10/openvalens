import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/trackers")({ component: TrackersLayout });

function TrackersLayout() {
  return <Outlet />;
}
