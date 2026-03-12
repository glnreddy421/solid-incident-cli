/**
 * Open URL in default browser. Cross-platform, no external deps.
 */

import { exec } from "child_process";

export function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const cmd =
      process.platform === "darwin"
        ? `open "${url}"`
        : process.platform === "win32"
          ? `start "" "${url}"`
          : `xdg-open "${url}"`;
    exec(cmd, (err) => {
      resolve(!err);
    });
  });
}
