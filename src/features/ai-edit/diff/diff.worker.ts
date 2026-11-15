import { createGraphemeDiff } from "./diff";
import {
  parseDiffWorkerRequest,
  type DiffWorkerResponse,
} from "./protocol";

globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = parseDiffWorkerRequest(event.data);

  if (request === null) {
    return;
  }

  let response: DiffWorkerResponse;

  try {
    response = Object.freeze({
      candidateId: request.candidateId,
      parts: createGraphemeDiff(request.originalText, request.candidateText),
      requestId: request.requestId,
      type: "result",
    });
  } catch {
    response = Object.freeze({
      candidateId: request.candidateId,
      requestId: request.requestId,
      type: "failed",
    });
  }

  globalThis.postMessage(response);
});
