// Génération et lecture de QR codes. Les bibliothèques sont chargées à la demande
// (une seule fois) depuis jsDelivr, autorisé par la CSP de vercel.json.
const LIBS = {
  generator: { url: "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js", global: "qrcode" },
  scanner: { url: "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js", global: "Html5Qrcode" },
};
const loaded = new Map();

function load({ url, global }) {
  if (window[global]) return Promise.resolve(window[global]);
  if (!loaded.has(url)) {
    loaded.set(url, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = () => (window[global] ? resolve(window[global]) : reject(new Error("Bibliothèque QR introuvable.")));
      s.onerror = () => { loaded.delete(url); reject(new Error("Impossible de charger la bibliothèque QR. Vérifiez votre réseau.")); };
      document.head.append(s);
    }));
  }
  return loaded.get(url);
}

/** Renvoie le SVG (texte) d'un QR code contenant `text`. */
export async function qrSvg(text) {
  const qrcode = await load(LIBS.generator);
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

/**
 * Démarre la caméra arrière dans l'élément `elementId` et appelle `onCode(texte)` à chaque lecture.
 * Renvoie une fonction d'arrêt.
 */
export async function startScanner(elementId, onCode) {
  const Html5Qrcode = await load(LIBS.scanner);
  const reader = new Html5Qrcode(elementId);
  await reader.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 220, height: 220 } }, (text) => onCode(text));
  return async () => {
    try { await reader.stop(); reader.clear(); } catch { /* déjà arrêté */ }
  };
}
