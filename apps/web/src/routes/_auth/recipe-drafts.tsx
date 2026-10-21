import { createFileRoute } from "@tanstack/react-router";

import { RecipeDraftEditor } from "@/components/recipe-draft-editor";

export const Route = createFileRoute("/_auth/recipe-drafts")({ component: RecipeDraftEditor });
