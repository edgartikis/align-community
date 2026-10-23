// ALIGN member-card privacy guard.
//
// Browsers cannot block or reliably detect OS screenshots and recordings.
// This guard only masks the QR while the web page is backgrounded, blurred,
// or printed. It is NOT an anti-screenshot guarantee.
(() => {
  "use strict";

  const style = document.createElement("style");
  style.id = "align-qr-privacy-guard";
  style.textContent = `
    body.align-qr-masked .qr-wrap,
    body.align-qr-masked .qr-box {
      position: relative !important;
      overflow: hidden !important;
    }
    body.align-qr-masked .qr-wrap :is(img, canvas),
    body.align-qr-masked .qr-box :is(img, canvas) {
      visibility: hidden !important;
    }
    body.align-qr-masked .qr-wrap::after,
    body.align-qr-masked .qr-box::after {
      content: "QR oculto por privacidad";
      position: absolute;
      inset: 0;
      z-index: 10;
      display: grid;
      place-items: center;
      padding: 12px;
      background: #10233e;
      color: #f4f1eb;
      text-align: center;
      font: 500 11px/1.5 system-ui, sans-serif;
    }
    @media print {
      .qr-wrap, .qr-box {
        visibility: hidden !important;
      }
    }
  `;
  document.head.appendChild(style);

  const mask = () => document.body?.classList.add("align-qr-masked");
  const unmaskWhenVisible = () => {
    if (!document.hidden) document.body?.classList.remove("align-qr-masked");
  };
  const updateVisibility = () => {
    if (document.hidden) mask();
    else unmaskWhenVisible();
  };

  // These events reduce background/app-switcher exposure but do not
  // control browser/OS screenshot capture.
  document.addEventListener("visibilitychange", updateVisibility);
  window.addEventListener("blur", mask);
  window.addEventListener("focus", unmaskWhenVisible);
  window.addEventListener("pagehide", mask);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateVisibility, { once: true });
  } else {
    updateVisibility();
  }
})();
