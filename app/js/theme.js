// Mode jour / nuit. Chargé dans <head> (script classique) pour appliquer le thème avant l'affichage.
// Sans choix enregistré, le thème suit le système (prefers-color-scheme).
(function () {
  var KEY = "carnet-theme";
  var root = document.documentElement;
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (saved === "light" || saved === "dark") root.dataset.theme = saved;

  function current() { return root.dataset.theme || (media.matches ? "dark" : "light"); }

  function sync(btn) {
    var dark = current() === "dark";
    btn.textContent = dark ? "☀️" : "🌙";
    btn.setAttribute("aria-label", dark ? "Passer en mode jour" : "Passer en mode nuit");
    btn.setAttribute("aria-pressed", String(dark));
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    sync(btn);
    btn.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch (e) {}
      sync(btn);
    });
    media.addEventListener("change", function () { sync(btn); });
  });
})();
