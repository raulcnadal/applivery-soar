import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import "./assets/styles/bluesky-tokens.css";
import router from "./router";

const app = createApp(App);
app.use(createPinia());
app.use(router);

// Wait for the router's initial navigation (and its `beforeEach` guard) to
// resolve before mounting. Without this, App.vue's `isStandalone` computed
// reads `route.name` as `undefined` for one tick on first paint — not yet
// "login" — so AppShell briefly renders even on a signed-out visit to
// /login. AppShell's setup fires `segmentsStore.fetchTree()` unconditionally
// (plus dashboardStateStore.fetchState() on mount), both unauthenticated,
// both 401 with a body the api.ts response interceptor matches as a session
// error, which hard-redirects via `window.location.href = "/login"` — a
// full page reload that restarts this exact race from scratch, producing a
// visible reload loop (flashing nav bar + refetched fonts/assets) on every
// signed-out load, worst right after clearing site data. `isReady()` makes
// sure the guard has already redirected to /login (so `route.name` is
// "login" and AppShell never mounts) before the app tree renders at all.
router.isReady().then(() => {
  app.mount("#app");
});
