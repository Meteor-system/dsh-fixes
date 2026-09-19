import { describe, expect, it } from "vitest";
import {
  parseBingHtml,
  parseDuckDuckGoHtml,
  searchDuckDuckGo,
  searchFreeWeb,
  unwrapDuckDuckGoUrl,
} from "../src/duckduckgo.ts";

const FIXTURE = `
<div class="result">
  <h2 class="result__title">
    <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fgrok&amp;rut=abc">Grok 4.6 overview</a>
  </h2>
  <a class="result__snippet" href="https://example.com/grok">Grok is a multimodal model from xAI.</a>
</div>
<div class="result">
  <h2 class="result__title">
    <a class="result__a" href="https://docs.example.org/search">Plain docs link</a>
  </h2>
  <a class="result__snippet">How to search without an API key.</a>
</div>
`;

describe("unwrapDuckDuckGoUrl", () => {
  it("extracts the destination from a DDG redirect", () => {
    expect(
      unwrapDuckDuckGoUrl(
        "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fgrok&rut=abc",
      ),
    ).toBe("https://example.com/grok");
  });
});

describe("parseDuckDuckGoHtml", () => {
  it("reads titles, snippets, and unwrapped urls from html.duckduckgo.com results", () => {
    expect(parseDuckDuckGoHtml(FIXTURE)).toEqual([
      {
        url: "https://example.com/grok",
        title: "Grok 4.6 overview",
        snippet: "Grok is a multimodal model from xAI.",
      },
      {
        url: "https://docs.example.org/search",
        title: "Plain docs link",
        snippet: "How to search without an API key.",
      },
    ]);
  });
});

describe("searchDuckDuckGo", () => {
  it("requests the html endpoint and returns parsed sources", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const result = await searchDuckDuckGo(
      { query: "grok 4.6", maxResults: 8 },
      {
        fetch: async (url, init) => {
          calls.push({
            url: String(url),
            headers: (init?.headers ?? {}) as Record<string, string>,
          });
          return {
            ok: true,
            status: 200,
            text: async () => FIXTURE,
          };
        },
      },
    );

    expect(calls[0]?.url).toContain("html.duckduckgo.com/html");
    expect(calls[0]?.url).toContain("q=grok%204.6");
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]?.url).toBe("https://example.com/grok");
    expect(result.truncated).toBe(false);
  });
});

const BING_FIXTURE = `
<li class="b_algo">
  <h2><a href="https://openai.com">OpenAI</a></h2>
  <p>OpenAI is an AI research company.</p>
</li>
<li class="b_algo">
  <h2><a href="https://github.com/openai/">OpenAI - GitHub</a></h2>
  <p>Official GitHub organization.</p>
</li>
`;

describe("parseBingHtml", () => {
  it("reads titles, urls, and snippets from Bing result cards", () => {
    expect(parseBingHtml(BING_FIXTURE)).toEqual([
      {
        url: "https://openai.com",
        title: "OpenAI",
        snippet: "OpenAI is an AI research company.",
      },
      {
        url: "https://github.com/openai/",
        title: "OpenAI - GitHub",
        snippet: "Official GitHub organization.",
      },
    ]);
  });
});

describe("searchFreeWeb", () => {
  it("falls back to Bing when DuckDuckGo is unreachable", async () => {
    const result = await searchFreeWeb(
      { query: "OpenAI" },
      {
        fetch: async (url) => {
          if (String(url).includes("duckduckgo")) {
            throw new Error("Connect Timeout Error");
          }
          return {
            ok: true,
            status: 200,
            text: async () => BING_FIXTURE,
          };
        },
      },
    );
    expect(result.sources[0]?.url).toBe("https://openai.com");
  });
});

