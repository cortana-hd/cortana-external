import { loadTradingOpsPolymarketLiveData } from "@/lib/trading-ops-polymarket-live";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const encoder = new TextEncoder();
const STREAM_INTERVAL_MS = 2_000;
const KEEPALIVE_INTERVAL_MS = 15_000;

export async function GET(request: Request) {
  let closed = false;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (timeout) clearTimeout(timeout);
        if (keepAlive) clearInterval(keepAlive);
        controller.close();
      };

      const sendEvent = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const sendKeepAlive = () => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
      };

      const pump = async () => {
        if (closed) return;

        try {
          const payload = await loadTradingOpsPolymarketLiveData();
          sendEvent("snapshot", payload);
        } catch (error) {
          sendEvent("warning", {
            message: error instanceof Error ? error.message : "Polymarket live stream update failed.",
            ts: Date.now(),
          });
        } finally {
          if (!closed) {
            timeout = setTimeout(pump, STREAM_INTERVAL_MS);
          }
        }
      };

      sendEvent("ready", { ts: Date.now(), intervalMs: STREAM_INTERVAL_MS });
      void pump();
      keepAlive = setInterval(sendKeepAlive, KEEPALIVE_INTERVAL_MS);

      request.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      if (timeout) clearTimeout(timeout);
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
