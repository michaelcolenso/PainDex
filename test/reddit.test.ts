import { describe, expect, it } from "vitest";
import { parseListing, parseRss, userAgent } from "../src/lib/reddit";
import type { Env } from "../src/types";

describe("userAgent", () => {
  it("includes the reddit handle when set", () => {
    expect(userAgent({ REDDIT_USERNAME: "scrappydev" } as Env)).toBe("web:paindex:v1.0 (by /u/scrappydev)");
  });

  it("omits the contact suffix when no username is configured", () => {
    expect(userAgent({} as Env)).toBe("web:paindex:v1.0");
  });
});

describe("parseListing", () => {
  it("extracts post rows from a JSON listing payload", () => {
    const payload = {
      data: {
        children: [
          {
            kind: "t3",
            data: {
              id: "abc123",
              name: "t3_abc123",
              subreddit: "FoodTrucks",
              title: "How do I price catering?",
              selftext: "Starting out and unsure.",
              created_utc: 1_700_000_000,
              score: 42,
              num_comments: 7,
              permalink: "/r/FoodTrucks/comments/abc123/",
              subreddit_subscribers: 90000,
            },
          },
        ],
      },
    };
    const [post] = parseListing(payload);
    expect(post.name).toBe("t3_abc123");
    expect(post.score).toBe(42);
    expect(post.num_comments).toBe(7);
    expect(post.subreddit_subscribers).toBe(90000);
  });

  it("returns an empty array for a malformed payload", () => {
    expect(parseListing({})).toEqual([]);
    expect(parseListing(null)).toEqual([]);
  });
});

describe("parseRss", () => {
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>t3_abc123</id>
    <title>Do I need a permit &amp; license to sell jam?</title>
    <link href="https://www.reddit.com/r/FoodTrucks/comments/abc123/do_i_need/" />
    <published>2026-07-20T12:00:00+00:00</published>
    <content type="html">&lt;div&gt;Trying to sell at markets &amp;amp; unsure about &lt;b&gt;rules&lt;/b&gt;.&lt;/div&gt;</content>
    <author><name>/u/seller</name></author>
  </entry>
  <entry>
    <id>t3_def456</id>
    <title>Best wholesale supplier?</title>
    <link href="https://www.reddit.com/r/FoodTrucks/comments/def456/best/" />
    <updated>2026-07-19T08:30:00+00:00</updated>
    <content type="html">Looking for recommendations.</content>
  </entry>
</feed>`;

  it("maps Atom entries to the listing shape", () => {
    const posts = parseRss(feed, "FoodTrucks");
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      id: "abc123",
      name: "t3_abc123",
      subreddit: "FoodTrucks",
      score: 0,
      num_comments: 0,
      subreddit_subscribers: null,
      permalink: "https://www.reddit.com/r/FoodTrucks/comments/abc123/do_i_need/",
    });
  });

  it("decodes entities in the title", () => {
    const [post] = parseRss(feed, "FoodTrucks");
    expect(post.title).toBe("Do I need a permit & license to sell jam?");
  });

  it("unwinds double-encoded HTML content into plain text", () => {
    const [post] = parseRss(feed, "FoodTrucks");
    expect(post.title.includes("?")).toBe(true); // keeps the question mark for prefilter
    expect(post.selftext).toBe("Trying to sell at markets & unsure about rules.");
    expect(post.selftext).not.toContain("<"); // tags stripped
  });

  it("parses the published (or updated) timestamp into epoch seconds", () => {
    const posts = parseRss(feed, "FoodTrucks");
    expect(posts[0].created_utc).toBe(Math.floor(Date.parse("2026-07-20T12:00:00+00:00") / 1000));
    expect(posts[1].created_utc).toBe(Math.floor(Date.parse("2026-07-19T08:30:00+00:00") / 1000)); // falls back to <updated>
  });

  it("recovers the fullname from the permalink when the id isn't a t3_ name", () => {
    const oddFeed = `<feed><entry>
      <id>https://www.reddit.com/r/x/comments/zzz999/thing/</id>
      <title>hi</title>
      <link href="https://www.reddit.com/r/x/comments/zzz999/thing/" />
      <published>2026-07-20T00:00:00+00:00</published>
      <content type="html">body</content>
    </entry></feed>`;
    const [post] = parseRss(oddFeed, "x");
    expect(post.name).toBe("t3_zzz999");
    expect(post.id).toBe("zzz999");
  });

  it("returns an empty array for a feed with no entries", () => {
    expect(parseRss("<feed></feed>", "x")).toEqual([]);
  });
});
