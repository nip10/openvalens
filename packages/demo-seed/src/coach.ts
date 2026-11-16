import type { Database } from "@openvalens/db";
import { chatMessage } from "@openvalens/db/schema/coach";

import type { DemoActor } from "./api";
import type { DemoCalendar } from "./dates";
import { demoUuid } from "./ids";

/**
 * One short, past coach conversation about the "Sleep higher than your usual"
 * insight (the better last week, `device.ts`), so the Coach list, its preview
 * line and message count have something to show.
 *
 * The coach writes messages only through `ai.chat`, which calls an AI
 * provider. The seed never does: the text below is fixed and synthetic, and
 * the rows are inserted as `ai.chat` stores them (private to the person,
 * oldest first). It names no figures, so it fits any "today".
 */
const MESSAGES = [
  {
    role: "user",
    content: "My insights say my sleep is higher than my usual this week. Is that a good thing?",
  },
  {
    role: "assistant",
    content:
      "Over the last week you slept longer than your usual on most nights, and you went to bed a little earlier. " +
      "Your resting heart rate came down over the same days, which often goes with better rest. " +
      "If you wake up feeling rested, there is nothing you need to change.\n\n" +
      "This is general information, not medical advice. If you feel tired for weeks even with more sleep, that is worth raising with a doctor.",
  },
  { role: "user", content: "How can I keep the earlier bedtime going?" },
  {
    role: "assistant",
    content:
      "A few things tend to help:\n\n" +
      "- Keep a similar bedtime on weekends.\n" +
      "- Have your last coffee before early afternoon.\n" +
      "- Put screens away for the last half hour.\n\n" +
      'Your "Sleep 7.5 hours a night" goal will show whether it holds over the next few weeks.',
  },
] as const;

/** Two evenings ago, so it reads as a past conversation. */
const DAYS_AGO = 2;
const EVENING_HOUR = 20.5;

export async function seedCoachConversation(
  db: Database,
  actor: DemoActor,
  calendar: DemoCalendar,
): Promise<void> {
  const conversationId = demoUuid("coach-sleep-higher-than-usual");
  const start = calendar.at(DAYS_AGO, EVENING_HOUR).getTime();
  await db.insert(chatMessage).values(
    MESSAGES.map((message, index) => ({
      organizationId: actor.organizationId,
      userId: actor.userId,
      conversationId,
      role: message.role,
      content: message.content,
      // A minute or two between turns.
      createdAt: new Date(start + index * 90_000).toISOString(),
    })),
  );
}
