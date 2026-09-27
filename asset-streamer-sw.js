"use strict";

const SPLIT_ASSETS = new Map([
    ["Glitches HK.data", 44],
    ["Glitches HK.wasm", 3]
]);
const CDN_BUILD_URL =
    "https://cdn.jsdelivr.net/gh/Re1muri/hollowknight@latest/Build/";
const PACKET_CACHE_NAME = "hollow-knight-packets-v1";

self.addEventListener("install", event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
    event.waitUntil(self.clients.claim());
});

function findSplitAsset(pathname) {
    let filename;

    try {
        filename = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
    } catch {
        return null;
    }

    const partCount = SPLIT_ASSETS.get(filename);
    return partCount ? { filename, partCount } : null;
}

function streamParts(request, filename, partCount) {
    let nextPart = 1;
    let currentReader = null;
    let packetCachePromise;

    return new ReadableStream({
        async pull(controller) {
            try {
                while (nextPart <= partCount) {
                    if (!currentReader) {
                        const partUrl = new URL(
                            `${encodeURIComponent(filename)}.part${nextPart}`,
                            CDN_BUILD_URL
                        );

                        packetCachePromise ||= caches.open(PACKET_CACHE_NAME);
                        const packetCache = await packetCachePromise;
                        let response = await packetCache.match(partUrl);

                        if (!response) {
                            response = await fetch(partUrl, { mode: "cors" });

                            if (response.ok) {
                                // Keep each packet available for the next launch.
                                await packetCache
                                    .put(partUrl, response.clone())
                                    .catch(() => {});
                            }
                        }

                        if (!response.ok || !response.body) {
                            throw new Error(
                                `Could not fetch ${partUrl.pathname}: HTTP ${response.status}`
                            );
                        }

                        currentReader = response.body.getReader();
                    }

                    const { done, value } = await currentReader.read();

                    if (done) {
                        currentReader = null;
                        nextPart++;
                        continue;
                    }

                    controller.enqueue(value);
                    return;
                }

                controller.close();
            } catch (error) {
                controller.error(error);
            }
        },

        async cancel() {
            if (currentReader) {
                await currentReader.cancel().catch(() => {});
            }
        }
    });
}

self.addEventListener("fetch", event => {
    const request = event.request;

    if (request.method !== "GET" || request.headers.has("range")) {
        return;
    }

    const asset = findSplitAsset(new URL(request.url).pathname);
    if (!asset) {
        return;
    }

    event.respondWith(
        new Response(
            streamParts(request, asset.filename, asset.partCount),
            {
                status: 200,
                headers: {
                    "Content-Type": asset.filename.endsWith(".wasm")
                        ? "application/wasm"
                        : "application/octet-stream",
                    "Cache-Control": "no-store"
                }
            }
        )
    );
});
