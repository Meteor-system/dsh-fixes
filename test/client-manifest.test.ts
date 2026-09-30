import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import {
  apply as applyClient,
  formAsScope,
  inject as clientInject,
} from "../src/client/index.ts";

describe("current DSH client manifest", () => {
  it("loads the settings provider and conversation graph without the removed runtime package", () => {
    expect(packageJson.dsh.client).toEqual({
      platform: "web",
      immediately: true,
      inject: [
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-conversation",
      ],
    });
  });

  it("declares every Client service read by the dynamic module", () => {
    expect(clientInject).toContain("configForms");
  });

  it("keeps decoded config form snapshots stable until the raw value changes", () => {
    let raw: unknown = { enabled: true };
    const form = {
      getSnapshot: () => ({ value: raw }),
      subscribe: () => () => undefined,
      set: async () => undefined,
    };
    const scope = formAsScope(form, (value) => ({ decoded: value }));

    const first = scope.getSnapshot();
    expect(scope.getSnapshot()).toBe(first);
    raw = { enabled: false };
    expect(scope.getSnapshot()).not.toBe(first);
  });

  it("mounts without probing the forbidden dynamic ctx.inject property", () => {
    const registrations: string[] = [];
    const form = {
      getSnapshot: () => ({ value: undefined }),
      subscribe: () => () => undefined,
      set: async () => undefined,
    };
    const context = {
      get: (name: string) => name === "configForms" ? { get: () => form } : undefined,
      slots: {
        inject: (name: string) => {
          registrations.push(name);
          return () => undefined;
        },
        register: () => () => undefined,
      },
    };
    const guarded = new Proxy(context, {
      get(target, property, receiver) {
        if (property === "inject") throw new Error("dynamic ctx.inject must not be read");
        return Reflect.get(target, property, receiver);
      },
    });

    applyClient(guarded as Parameters<typeof applyClient>[0]);

    expect(registrations).toEqual(["conversation.input.right"]);
  });
});

declare module "../package.json" {
  const packageJson: {
    dsh: {
      client: {
        platform: string;
        immediately?: boolean;
        inject: string[];
      };
    };
  };
  export default packageJson;
}
