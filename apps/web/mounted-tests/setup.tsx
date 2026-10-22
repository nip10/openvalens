import { GlobalRegistrator } from "@happy-dom/global-registrator";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

GlobalRegistrator.register({ url: "http://localhost:3000" });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
await import("../src/testing/varlock-test-setup");
