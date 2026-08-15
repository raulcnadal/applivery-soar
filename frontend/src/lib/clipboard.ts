// Shared clipboard helper — extracted from MtlsPanel.vue's copy-button fix
// (the Clipboard API's writeText silently no-ops outside a secure context,
// i.e. plain HTTP deployments like this app's own default docker-compose.yml
// on port 8080) so every Settings panel that copies a secret/token/snippet
// gets the same HTTPS-first + execCommand("copy") fallback instead of each
// reimplementing it. Returns false (never throws) if both paths fail, so
// callers can show their own "copy this manually" message.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path below
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
