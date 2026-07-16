import { CleanFeedError } from "@/shared/errors";
import { parseExtensionMessage } from "@/shared/message-validation";
import { WorkerHost } from "@/offscreen/worker-host";

const workerHost = new WorkerHost();
workerHost.initialize();

chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
  let message;
  try {
    message = parseExtensionMessage(rawMessage);
  } catch {
    return undefined;
  }

  if (message.target !== "offscreen") {
    return undefined;
  }

  if (message.type === "CANCEL_CLASSIFICATION") {
    workerHost.cancel(message.requestId!);
    sendResponse(undefined);
    return false;
  }

  if (message.type !== "OFFSCREEN_CLASSIFY") return undefined;

  void workerHost
    .classify({ requestId: message.requestId, ...message.payload })
    .then((result) =>
      sendResponse({
        source: "offscreen",
        target: "background",
        type: "OFFSCREEN_RESULT",
        requestId: message.requestId,
        payload: result,
      }),
    )
    .catch((error: unknown) => {
      const cleanFeedError =
        error instanceof CleanFeedError
          ? error
          : new CleanFeedError("INFERENCE_FAILED", "INFERENCE_FAILED");
      sendResponse({
        source: "offscreen",
        target: "background",
        type: "ERROR",
        requestId: message.requestId,
        payload: {
          code: cleanFeedError.code,
          recoverable: cleanFeedError.recoverable,
        },
      });
    });

  return true;
});
