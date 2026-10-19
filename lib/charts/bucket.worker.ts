import { handleRequest, type BucketRequest, type BucketResponse } from "./bucket";

export { handleRequest };
export type { BucketRequest, BucketResponse };

declare const self: {
  postMessage(message: BucketResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<BucketRequest>) => void): void;
};
declare const WorkerGlobalScope: unknown;

/** Register only inside a real worker. Node has no `self`; a window has
 * `self` but is not a WorkerGlobalScope. */
const isWorker =
  typeof self !== "undefined" &&
  typeof WorkerGlobalScope !== "undefined" &&
  (self as unknown) instanceof (WorkerGlobalScope as new () => unknown);

if (isWorker) {
  self.addEventListener("message", event => {
    self.postMessage(handleRequest(event.data));
  });
}
