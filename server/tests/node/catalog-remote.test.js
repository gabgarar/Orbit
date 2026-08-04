import test from "node:test";
import assert from "node:assert/strict";
import { fetchTextWithTimeout, normalizeCatalogSources, parseCatalogSource } from "../../src/catalog/remote.js";

const ommXml = `
<ndm><omm><body><segment>
  <metadata><OBJECT_NAME>TEST OMM</OBJECT_NAME></metadata>
  <data><tleParameters>
    <TLE_LINE1>1 48843U 21050D   26197.30124859  .00001521  00000+0  66451-4 0  9996</TLE_LINE1>
    <TLE_LINE2>2 48843  97.3327 272.6770 0006429 149.2414 210.9202 15.23598987283395</TLE_LINE2>
  </tleParameters></data>
</segment></body></omm></ndm>`;

test("catalog sources ignore missing URLs and deduplicate by format and URL", () => {
    const sources = normalizeCatalogSources([
        { name: "First", format: "tle", url: "https://celestrak.org/catalog" },
        { name: "Replacement", format: "TLE", url: "https://celestrak.org/catalog" },
        { name: "Different format", format: "OMM_XML", url: "https://celestrak.org/catalog" },
        { name: "Blocked localhost", format: "TLE", url: "https://localhost/catalog" },
        { name: "Blocked IP", format: "TLE", url: "https://127.0.0.1/catalog" },
        { name: "Blocked HTTP", format: "TLE", url: "http://celestrak.org/catalog" },
        { name: "Ignored" }
    ]);
    assert.deepEqual(sources, [
        { name: "Replacement", format: "TLE", url: "https://celestrak.org/catalog" },
        { name: "Different format", format: "OMM_XML", url: "https://celestrak.org/catalog" }
    ]);
});

test("remote fetch returns text and rejects HTTP errors", async () => {
    const text = await fetchTextWithTimeout("https://celestrak.org/ok", {
        fetchImpl: async () => new Response("catalog", { status: 200 })
    });
    assert.equal(text, "catalog");
    await assert.rejects(
        fetchTextWithTimeout("https://celestrak.org/unavailable", { fetchImpl: async () => new Response("", { status: 503 }) }),
        /HTTP 503/
    );
});

test("remote fetch propagates a shutdown abort to the active request", async () => {
    const controller = new AbortController();
    let requestSignal;
    let beginRequest;
    const requestStarted = new Promise((resolve) => { beginRequest = resolve; });
    const downloading = fetchTextWithTimeout("https://celestrak.org/catalog", {
        signal: controller.signal,
        fetchImpl: async (_url, options) => {
            requestSignal = options.signal;
            beginRequest();
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
            });
        }
    });

    await requestStarted;
    controller.abort();

    await assert.rejects(downloading, /request aborted/);
    assert.equal(requestSignal.aborted, true);
});

test("remote fetch rejects untrusted URLs and redirects before issuing a second request", async () => {
    let requests = 0;
    await assert.rejects(
        fetchTextWithTimeout("https://localhost/catalog", {
            fetchImpl: async () => { requests += 1; return new Response("catalog", { status: 200 }); }
        }),
        /approved provider/
    );
    assert.equal(requests, 0);

    await assert.rejects(
        fetchTextWithTimeout("https://celestrak.org/catalog", {
            fetchImpl: async () => {
                requests += 1;
                return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/internal" } });
            }
        }),
        /redirected outside approved/
    );
    assert.equal(requests, 1);
});

test("remote OMM aliases use the shared XML parser", () => {
    const parsed = parseCatalogSource("OMM", ommXml, "remote.omm");
    assert.equal(parsed.format, "OMM_XML");
    assert.equal(parsed.skipped, 0);
    assert.equal(parsed.entries[0].name, "TEST OMM");
    assert.equal(parsed.entries[0].sourceFormat, "OMM");
});
