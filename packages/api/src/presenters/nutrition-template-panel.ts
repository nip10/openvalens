import { msg } from "@lingui/core/macro";

/** Copy owned by the native panel so manager/presenter changes remain isolated. */
export const TEMPLATE_PANEL_COPY = Object.freeze({
  logged: msg`Saved meal added to your diary.`,
  undo: msg`Undo`,
  undoQueued: msg`Undo added to the sync queue.`,
});
