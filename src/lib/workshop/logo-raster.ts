"use client";

import { useEffect, useState } from "react";

const LOGO_SRC = "/assets/logo.svg";
const RASTER_WIDTH = 460;
const RASTER_HEIGHT = 260;

let cachedPng: string | null = null;
let pendingPng: Promise<string> | null = null;

/**
 * jsPDF only accepts raster data (PNG/JPEG), so the SVG brand asset has to be
 * painted onto a canvas before it can be embedded in a document.
 */
export function loadLogoPngDataUrl(): Promise<string> {
  if (cachedPng) return Promise.resolve(cachedPng);
  if (pendingPng) return pendingPng;

  pendingPng = new Promise<string>((resolve) => {
    if (typeof window === "undefined") {
      resolve("");
      return;
    }

    const image = new window.Image();
    image.crossOrigin = "anonymous";

    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = RASTER_WIDTH;
        canvas.height = RASTER_HEIGHT;

        const context = canvas.getContext("2d");
        if (!context) {
          resolve("");
          return;
        }

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);

        const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        context.drawImage(
          image,
          (canvas.width - drawWidth) / 2,
          (canvas.height - drawHeight) / 2,
          drawWidth,
          drawHeight,
        );

        const dataUrl = canvas.toDataURL("image/png");
        cachedPng = dataUrl;
        resolve(dataUrl);
      } catch {
        resolve("");
      }
    };

    image.onerror = () => resolve("");
    image.src = LOGO_SRC;
  }).finally(() => {
    pendingPng = null;
  });

  return pendingPng;
}

export function useLogoPngDataUrl(enabled = true) {
  const [logoDataUrl, setLogoDataUrl] = useState(cachedPng ?? "");

  useEffect(() => {
    if (!enabled || logoDataUrl) return;
    let cancelled = false;

    void loadLogoPngDataUrl().then((dataUrl) => {
      if (!cancelled) setLogoDataUrl(dataUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, logoDataUrl]);

  return logoDataUrl;
}
