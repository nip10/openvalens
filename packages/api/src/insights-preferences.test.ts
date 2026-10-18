import { describe, expect, test } from "bun:test";

import { channelsFromDisabled, disabledFromChannels } from "./insights";
import { defaultKindChannels } from "./insight-rules";

const observationCombinations = Array.from({ length: 8 }, (_, mask) => ({
  in_app: Boolean(mask & 1),
  push: Boolean(mask & 2),
  email: Boolean(mask & 4),
}));

describe("observation preference persistence", () => {
  test.each(observationCombinations)("round-trips observation channels %#", (observation) => {
    const channels = defaultKindChannels();
    channels.observation = observation;

    expect(channelsFromDisabled(disabledFromChannels(channels)).observation).toEqual(observation);
  });

  test("legacy rows default off and unrelated preference edits do not opt in", () => {
    expect(channelsFromDisabled([]).observation).toEqual({
      in_app: false,
      push: false,
      email: false,
    });

    const channels = channelsFromDisabled([]);
    channels.change.in_app = false;
    expect(channelsFromDisabled(disabledFromChannels(channels)).observation).toEqual({
      in_app: false,
      push: false,
      email: false,
    });
  });

  test("unrelated edits preserve opt-in and revocation turns every observation channel off", () => {
    const optedIn = channelsFromDisabled([]);
    optedIn.observation.in_app = true;

    const afterUnrelatedEdit = channelsFromDisabled(disabledFromChannels(optedIn));
    afterUnrelatedEdit.change.push = false;
    expect(channelsFromDisabled(disabledFromChannels(afterUnrelatedEdit)).observation).toEqual({
      in_app: true,
      push: false,
      email: false,
    });

    afterUnrelatedEdit.observation = { in_app: false, push: false, email: false };
    expect(channelsFromDisabled(disabledFromChannels(afterUnrelatedEdit)).observation).toEqual({
      in_app: false,
      push: false,
      email: false,
    });
  });
});
