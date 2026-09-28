import { describe, expect, it } from "vitest";
import packageJson from "../package.json";

describe("current DSH client manifest", () => {
  it("loads the conversation client graph and does not depend on the removed runtime package", () => {
    expect(packageJson.dsh.client).toEqual({
      platform: "web",
      immediately: true,
      inject: ["@deepseek-ai/dsh-client-ui-conversation"],
    });
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
