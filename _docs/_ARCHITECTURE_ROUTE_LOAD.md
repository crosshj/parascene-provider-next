# Route Load Architecture: /feed, /explore, /creations

High-level description of what happens when the app loads at a given route, and how that design can contribute to the kinds of trouble we’ve seen (loops, repeated API/image loads, crashes).

---

## 1. Single HTML shell, all routes in the DOM

- **What:** One HTML document (`app.html`) is served for `/`, `/feed`, `/explore`, `/creations`, etc. The `<main>` section contains **all** route components at once: `<app-route-feed>`, `<app-route-explore>`, `<app-route-creations>`, `<app-route-servers>`.
- **Routing:** The nav reads `window.location.pathname`, sets one section to `display: block` and the rest to `display: none`, then dispatches a `route-change` event with the current route.
- **Implication:** Every route custom element is **connected to the document on first page load**. Each runs `connectedCallback()` once when its module is defined, regardless of which route the URL shows. So on load at `/feed`, feed, explore, and creations all run their mount logic; only the “active” one is visible.

**Relation to bugs:** All routes run init and register for `route-change` at the same time. Order of execution depends on script load order. If one route’s init (or a deferred timer) assumes it’s the only one running, or assumes a stable “active” state, you get races and duplicate work. Inactive routes still schedule deferred preloads (setTimeout + requestIdleCallback), so multiple routes can be fetching in the background at once.

---

## 2. Boot and route establishment order

- **What:** `global.js` imports nav first, then modals, then route modules (feed, explore, creations, …). When each custom element is defined, any existing instance in the DOM gets `connectedCallback()` immediately.
- **Typical sequence:**  
  1. Nav connects → `handleRouteChange()` runs → reads pathname, sets `window.__CURRENT_ROUTE__`, toggles section `display`, dispatches `route-change`.  
  2. Feed connects → reads nothing from nav → always calls `loadFeed()`.  
  3. Explore connects → reads `__CURRENT_ROUTE__` or pathname → calls `setActiveRoute(inferred === 'explore')`. If inactive, schedules deferred preload.  
  4. Creations connects → same idea → `setActiveRoute(inferred === 'creations')`, then either `refreshOnActivate()` + polling or deferred preload.
- **Implication:** The **first** `route-change` is fired **before** explore/creations exist. They only learn the initial route from `__CURRENT_ROUTE__` or pathname in their own `connectedCallback`. If nav’s `handleRouteChange` is ever delayed or run again (e.g. mobile nav’s `setTimeout(..., 0)`), route state can be applied twice or in a different order.

**Relation to bugs:** Two nav components (desktop and mobile) both listen for `popstate` and `route-change` and can both run their own `handleRouteChange`/`updateContentForRoute`. That can mean duplicate `route-change` dispatches or duplicate display toggling. Any logic that assumes “one route change per user action” is fragile.

---

## 3. Per-route data loading

| Route      | When it loads data | How it knows it’s “active” |
|-----------|--------------------|-----------------------------|
| **Feed**  | Unconditionally in `connectedCallback`: always calls `loadFeed()`. | Doesn’t check; feed is “always” loading when mounted. |
| **Explore** | (1) If active at mount: `setActiveRoute(true)` → `refreshOnActivate()` → `loadExplore({ background: false, force: true })`. (2) If inactive: `setActiveRoute(false)` → `scheduleDeferredPreload()` → after 2.5s + idle, `loadExplore({ background: true, force: true })`. | `window.__CURRENT_ROUTE__` or pathname in `connectedCallback`; later, `route-change` updates `isActiveRoute`. |
| **Creations** | Same pattern: active → `refreshOnActivate()` → `loadCreations(...)`; inactive → deferred preload. Also has IntersectionObserver on the route element to call `refreshOnActivate()` when the section becomes visible. | Same: initial route from global/pathname, then `route-change` and visibility observer. |

**Relation to bugs:** Feed **never** checks the current route; it always fetches. So even on `/explore` or `/creations`, feed’s `loadFeed()` runs once on boot. That’s one extra API call and potential for confusion if feed state is ever read elsewhere. For explore/creations, “active” is derived in two ways (event vs visibility). If the visibility observer fires before or after `route-change`, or fires repeatedly while the section is visible, you can get multiple `refreshOnActivate()` / load calls and the loops we’ve seen.

---

## 4. Deferred preload (inactive routes)

- **What:** When a route is **inactive** at mount (or becomes inactive), it schedules a one-shot “background” load: `setTimeout(..., 2500)` then `requestIdleCallback(run, { timeout: 2000 })`, then `loadExplore`/`loadCreations` with `background: true, force: true`.
- **Goal:** Prefill that route’s data so when the user switches to it, content is already there.
- **Guards:** “Don’t schedule if `hasLoadedOnce`” and “in `run()`, don’t call load if `isActiveRoute || hasLoadedOnce`”. Plus in the load function: “if `background && hasLoadedOnce`, return”.

**Relation to bugs:** If the component is ever disconnected and reconnected (e.g. future DOM reuse or buggy re-render), it’s a **new instance**: `hasLoadedOnce` is false again, so deferred preload can run again and call load again. So any architecture that re-mounts route nodes will re-trigger background loads and the associated API/image work. Also, the first `route-change` is dispatched before explore/creations exist; they only react to later route changes. So the “initial route” is entirely from reading `__CURRENT_ROUTE__`/pathname once at mount. If that read is wrong or racy, the wrong route will think it’s active/inactive and schedule (or skip) preload incorrectly.

---

## 5. Image loading (feed vs explore/creations)

- **Feed:** Uses `<img>` tags; sets `src` in JS when building cards. Infinite-scroll sentinel triggers more cards; each card sets one image `src`. No shared “queue”; each card is self-contained.
- **Explore / Creations:** Use a shared pattern: a **queue** of `{ el, url }` and an **IntersectionObserver** that enqueues elements when they intersect, then `drainImageLoadQueue()` runs `setRouteMediaBackgroundImage(el, url)`. That helper creates a new `Image()`, sets `src`, and on load applies the URL as a CSS background on the element.

**Relation to bugs:** The observer fires whenever intersection state is computed (scroll, layout, etc.). If you don’t gate on “transition to visible” (e.g. was not intersecting, now is), the same element can be enqueued many times or the drain can be triggered repeatedly. We added “only enqueue if not already `bgLoadedUrl`” and “in the loader, skip if this element already has this URL”, but the observer still runs on every intersection. So any bug that re-enqueues or re-observes (e.g. re-running `setupImageLazyLoading()` or re-observing the same nodes) can still cause repeated image requests and work. Feed’s “already have this URL” check on the `<img>` avoids duplicate `src` sets when the same card is re-used; without it, every batch or re-render would re-request images.

---

## 6. Event flow summary (e.g. load at `/explore`)

1. HTML parsed → all route elements exist in DOM but may not be “defined” yet.
2. Nav defined → nav `connectedCallback` → `handleRouteChange()` → pathname `/explore` → `currentRoute = 'explore'` → sections toggled (explore `block`, others `none`) → `route-change` dispatched (no route components listening yet).
3. Feed defined → feed `connectedCallback` → `loadFeed()` runs (feed doesn’t care about route).
4. Explore defined → explore `connectedCallback` → `setActiveRoute(true)` (from pathname) → `refreshOnActivate()` → `loadExplore({ background: false, force: true })` → API call, container cleared, cards appended, image observer observes new nodes.
5. Creations defined → creations `connectedCallback` → `setActiveRoute(false)` → `scheduleDeferredPreload()` (2.5s + idle, then `loadCreations({ background: true, force: true })`).
6. User later switches to feed → nav updates URL, toggles sections, dispatches `route-change` → feed does nothing (it doesn’t listen); explore gets `setActiveRoute(false)` → cancels preload, disconnects image observer; creations might get visibility observer firing when its section becomes hidden, etc.

**Relation to bugs:** Feed and explore/creations behave differently: feed is “load once on mount”; explore/creations are “active vs inactive + deferred preload + visibility”. So the same “page load” triggers different patterns (one unconditional load, others conditional + timers + observers). That asymmetry makes it easy to add a guard in one place and miss another, or to introduce a path that only one route hits and that path crashes (e.g. missing `hasLoadedOnce` or wrong `this`).

---

## 7. Architectural takeaways for the current issues

- **All routes mounted at once:** Every route’s `connectedCallback` and any deferred logic run on first load. To avoid loops and duplicate work, **every** load path (initial, refresh, background, visibility) must have clear “already did this” guards and must not assume it’s the only thing running.
- **Two sources of “am I active?”:** `route-change` and (for creations) IntersectionObserver. They can get out of sync or fire in surprising order; reacting to “became visible” (transition) instead of “is visible” reduces repeated work and avoids re-entrant refresh/load.
- **Deferred preload is easy to re-trigger:** Any new instance of a route (or any code that resets `hasLoadedOnce` / clears timers) will schedule preload again. So the architecture that “all routes are always in the DOM” is good for not re-mounting; if anything ever does re-mount or re-init, guards in the load function (`background && hasLoadedOnce`) are the last line of defense.
- **Feed is special:** It doesn’t listen to `route-change` and always loads once. That keeps feed simple but means feed and explore/creations don’t share the same “active + load” contract. Any global assumption like “only the visible route loads” is false while feed runs on every boot.
- **Crash risk:** If a guard or early return leaves the component in a state where a later callback (timer, observer, event) assumes something that isn’t true (e.g. `container` or `this.feedItems` is null/undefined, or a method is missing), one of those callbacks can throw and take down the page. The more conditional early returns we add, the more we need to ensure every code path that runs later can tolerate “we bailed out earlier.”

This doc should be updated when route mounting, navigation, or loading strategy changes so we keep a single place that describes why the app behaves the way it does and where the failure modes are.
