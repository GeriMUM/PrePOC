import assert from "node:assert/strict";
import { test } from "node:test";
import { coachEmbedUrl } from "../lib/embed-config";

test("embed accepts the Microsoft iframe source and rejects other hosts/protocols/paths", () => {
  const previous = process.env.COPILOT_STUDIO_EMBED_URL;
  try {
    delete process.env.COPILOT_STUDIO_EMBED_URL;
    assert.equal(coachEmbedUrl(), undefined);
    const url = "https://copilotstudio.microsoft.com/environments/example/bots/coach/webchat?__version__=2&enableFileAttachment=false&cliAgent=true";
    process.env.COPILOT_STUDIO_EMBED_URL = url;
    assert.equal(coachEmbedUrl(), url);
    for (const invalid of [
      url.replace("https:", "http:"),
      url.replace("copilotstudio.microsoft.com", "example.com"),
      url.replace("copilotstudio.microsoft.com", "copilotstudio.microsoft.com.example.com"),
      url.replace("/webchat", "/conversations"),
      url.replace("https://", "https://user:password@"),
    ]) {
      process.env.COPILOT_STUDIO_EMBED_URL = invalid;
      assert.throws(coachEmbedUrl, /webchat iframe URL/);
    }
  } finally {
    if (previous === undefined) delete process.env.COPILOT_STUDIO_EMBED_URL;
    else process.env.COPILOT_STUDIO_EMBED_URL = previous;
  }
});
