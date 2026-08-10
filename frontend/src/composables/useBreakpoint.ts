import { onMounted, onUnmounted, ref } from "vue";

/**
 * Reactive "are we below Tailwind's `md` breakpoint (768px)" flag, driven
 * entirely by viewport width (matchMedia), never user-agent sniffing — a
 * desktop browser window narrowed below 768px gets the mobile layout too,
 * same as Tailwind's own `md:` prefix would decide, and a phone in
 * landscape or a tablet above 768px gets the desktop layout. This is the
 * single source of truth every mobile-specific `v-if="isMobile"` branch
 * added across the app should use, so "mobile" means the same width
 * everywhere.
 *
 * Every component using this keeps its existing (unprefixed) desktop
 * template as the `v-else`/`!isMobile` branch, untouched — so nothing
 * changes for anyone above 768px; this only ever adds a new, separate
 * branch below it.
 */
const MOBILE_QUERY = "(max-width: 767px)";

export function useBreakpoint() {
  const query = typeof window !== "undefined" ? window.matchMedia(MOBILE_QUERY) : null;
  const isMobile = ref(query?.matches ?? false);

  function onChange(e: MediaQueryListEvent) {
    isMobile.value = e.matches;
  }

  onMounted(() => {
    if (!query) return;
    isMobile.value = query.matches;
    query.addEventListener("change", onChange);
  });
  onUnmounted(() => {
    query?.removeEventListener("change", onChange);
  });

  return { isMobile };
}
