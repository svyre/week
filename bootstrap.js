(() => {
  "use strict";

  // Применяем тему до первого кадра, чтобы не было вспышки другой темы.
  let preference = "system";
  try { preference = localStorage.getItem("week-theme") || "system"; } catch (_) {}
  const dark = preference === "dark" || (
    preference !== "light" && window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  window.__weekSplashStart = Date.now();
  if (dark) document.querySelector("#themeColor")?.setAttribute("content", "#121522");

  // Простая дополнительная защита от встраивания страницы во фрейм.
  // Главную защиту от clickjacking лучше задавать HTTP-заголовком frame-ancestors.
  if (window.top !== window.self) {
    document.documentElement.style.display = "none";
    try { window.top.location = window.self.location.href; } catch (_) {}
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
    }, { once: true });
  }
})();
