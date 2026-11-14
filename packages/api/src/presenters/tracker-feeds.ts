/**
 * Phone feeds for custom trackers (#452): copy shared by the apps. Pure
 * TypeScript — safe for the app bundles.
 *
 * The State of Mind table is the fixed one in `@openvalens/trackers/feeds`;
 * the link screen shows it in full, so how a mood becomes 1-5 is never hidden.
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { StateOfMindClassificationKey, TrackerFeed } from "@openvalens/trackers/feeds";

export type TrackerFeedCopy = {
  /** The feed, as the member sees it in the tracker's settings. */
  name: MessageDescriptor;
  /** What becomes an entry. */
  description: MessageDescriptor;
  /** The phone's health store. Product names, not translated. */
  store: "Apple Health" | "Health Connect";
};

export const TRACKER_FEED_COPY: Record<TrackerFeed, TrackerFeedCopy> = {
  healthkit_mindful_sessions: {
    name: msg`Apple Health mindful minutes`,
    description: msg`Each mindful session in Apple Health becomes an entry: its length, on the day it started.`,
    store: "Apple Health",
  },
  health_connect_mindfulness: {
    name: msg`Health Connect mindfulness`,
    description: msg`Each mindfulness session in Health Connect becomes an entry: its length, on the day it started.`,
    store: "Health Connect",
  },
  healthkit_state_of_mind: {
    name: msg`Apple Health State of Mind`,
    description: msg`Each daily mood you log in Apple Health becomes a 1 to 5 entry. Momentary emotions are not imported.`,
    store: "Apple Health",
  },
};

/** Apple's seven valence classifications, in Apple Health's own words. */
export const STATE_OF_MIND_LABELS: Record<StateOfMindClassificationKey, MessageDescriptor> = {
  very_unpleasant: msg`Very unpleasant`,
  unpleasant: msg`Unpleasant`,
  slightly_unpleasant: msg`Slightly unpleasant`,
  neutral: msg`Neutral`,
  slightly_pleasant: msg`Slightly pleasant`,
  pleasant: msg`Pleasant`,
  very_pleasant: msg`Very pleasant`,
};

/** Where an imported entry came from, for the entry list; null for manual entries. */
export function entrySourceLabel(source: string): MessageDescriptor | null {
  if (source === "healthkit") return msg`from Apple Health`;
  if (source === "health_connect") return msg`from Health Connect`;
  return null;
}
