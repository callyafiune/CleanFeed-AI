const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/offscreen.html";
const OFFSCREEN_JUSTIFICATION =
  "Executar classificação local fora da thread da página.";

let creating: Promise<void> | undefined;

/** Ensures the extension owns exactly one document that can host workers. */
export async function ensureOffscreenDocument(): Promise<void> {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl],
  });

  if (contexts.length > 0) {
    return;
  }

  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: OFFSCREEN_JUSTIFICATION,
    })
    .finally(() => {
      creating = undefined;
    });

  await creating;
}
