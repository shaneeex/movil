(() => {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return;

  if (document.documentElement.dataset.vercelAnalytics === "loaded") return;

  const injectAnalytics = (token) => {
    if (!token || document.querySelector('script[data-token][src="https://analytics.vercel.com/script.js"]')) {
      return;
    }
    const script = document.createElement("script");
    script.defer = true;
    script.src = "https://analytics.vercel.com/script.js";
    script.dataset.token = token;
    document.head.appendChild(script);
    document.documentElement.dataset.vercelAnalytics = "loaded";
  };

  fetch("/api/analytics/token", { credentials: "same-origin", cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      if (payload?.token) {
        injectAnalytics(payload.token);
      }
    })
    .catch((err) => {
      console.warn("Unable to initialize Vercel Analytics", err);
    });
})();
