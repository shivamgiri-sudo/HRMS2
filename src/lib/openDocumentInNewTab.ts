const BLOB_URL_LIFETIME_MS = 5 * 60_000;

/**
 * Opens a fetched file in a new browser TAB (not a popup window).
 *
 * The tab is opened synchronously inside the click, before the network call, and with no window
 * features: a features string, or a window.open() that runs after an await, makes some browsers
 * (Edge in particular) open a separate window, which forces Alt+Tab to compare against the page.
 * The file is then loaded into that tab once it arrives.
 */
export async function openDocumentInNewTab(fetchBlob: () => Promise<Blob>): Promise<void> {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const url = URL.createObjectURL(await fetchBlob());
    window.setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS);
    if (tab && !tab.closed) {
      tab.location.href = url;
      return;
    }
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  } catch (error) {
    tab?.close();
    throw error;
  }
}
