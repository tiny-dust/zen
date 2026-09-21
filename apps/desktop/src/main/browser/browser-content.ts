import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ELEMENT_PICK_SCRIPT,
  ELEMENT_PICK_TEARDOWN,
  formatConsoleForPrompt,
  formatExtractForPrompt,
  formatPerformanceForPrompt,
  formatSnapshotForPrompt,
} from "@zen/tools-browser";

import { screenshotCacheDir } from "../cache-ipc";
import { zenCacheRoot } from "../zen-dir";

import type {
  BrowserActionResult,
  BrowserConsoleEntry,
  BrowserEvalResult,
  BrowserExtractResult,
  BrowserNetworkEntry,
  BrowserPerformanceMetrics,
  BrowserScreenshotResult,
  BrowserSnapshot,
} from "@zen/shared";

import { withTimeout } from "./browser-utils";
import { BrowserCdpClient } from "./browser-cdp";

function screenshotDir(): string {
  // 临时截图一律进用户域 ~/.zen/cache/screenshots，不写入应用包/userData
  try {
    return screenshotCacheDir();
  } catch {
    return join(zenCacheRoot(), "screenshots");
  }
}

/** 页面内容与动作：snapshot/extract、click/type/evaluate、截图、性能指标与元素标注。 */
export class BrowserContentApi extends BrowserCdpClient {
  async snapshot(): Promise<BrowserSnapshot> {
    await this.ensureRunning();
    await this.refreshMeta();
    return this.evalPage<BrowserSnapshot>(`(() => {
      const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 80).map((a) => ({
        text: (a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
        href: a.href,
      }));
      const text = (document.body?.innerText || '').slice(0, 12000);
      const nodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,nav,main,section,button,input,textarea,select,a'))
        .slice(0, 120)
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
          return tag + (label ? ': ' + label : '');
        });
      return {
        url: location.href,
        title: document.title,
        text,
        links,
        outline: nodes.join('\\n'),
        a11y: null,
      };
    })()`);
  }

  async extract(): Promise<BrowserExtractResult> {
    await this.ensureRunning();
    await this.refreshMeta();
    return this.evalPage<BrowserExtractResult>(`(() => {
      function sel(el) {
        if (el.id && !/^\\d/.test(el.id)) return '#' + CSS.escape(el.id);
        const testId = el.getAttribute('data-testid');
        if (testId) return '[data-testid="' + testId + '"]';
        const name = el.getAttribute('name');
        if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
        return el.tagName.toLowerCase();
      }
      const buttons = Array.from(document.querySelectorAll('button,[role="button"],input[type="submit"]')).slice(0, 40).map((el) => ({
        selector: sel(el),
        text: (el.textContent || el.getAttribute('value') || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
        disabled: Boolean(el.disabled),
      }));
      const inputs = Array.from(document.querySelectorAll('input,textarea,select')).slice(0, 40).map((el) => {
        let label = '';
        const id = el.id;
        if (id) {
          const lab = document.querySelector('label[for="' + CSS.escape(id) + '"]');
          if (lab) label = (lab.textContent || '').trim();
        }
        return {
          selector: sel(el),
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          name: el.getAttribute('name') || '',
          placeholder: el.getAttribute('placeholder') || '',
          label,
        };
      });
      return {
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || '').slice(0, 12000),
        links: Array.from(document.querySelectorAll('a[href]')).slice(0, 40).map((a) => ({
          text: (a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
          href: a.href,
        })),
        inputs,
        buttons,
      };
    })()`);
  }

  async click(selector: string): Promise<BrowserActionResult> {
    try {
      await this.ensureRunning();
      const value = await this.evalPage<BrowserActionResult>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, error: 'selector not found' };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
        return { ok: true, url: location.href, title: document.title };
      })()`);
      if (value?.ok) {
        this.setStatus({ url: value.url || this.state.url, title: value.title || this.state.title });
      }
      return value ?? { ok: false, error: "click failed" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "click failed" };
    }
  }

  async type(
    selector: string,
    text: string,
    options?: { submit?: boolean },
  ): Promise<BrowserActionResult> {
    try {
      await this.ensureRunning();
      return await this.evalPage<BrowserActionResult>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, error: 'selector not found' };
        el.focus();
        if ('value' in el) {
          el.value = ${JSON.stringify(text)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.textContent = ${JSON.stringify(text)};
        }
        if (${options?.submit ? "true" : "false"}) {
          const form = el.form || el.closest('form');
          if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
          else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
        return { ok: true, url: location.href, title: document.title };
      })()`);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "type failed" };
    }
  }

  async console(limit = 50): Promise<{ entries: BrowserConsoleEntry[] }> {
    return { entries: this.consoleBuffer.slice(-limit) };
  }

  async performance(): Promise<BrowserPerformanceMetrics> {
    await this.ensureRunning();
    const metricsResult = await this.sendDebugger<{
      metrics: Array<{ name: string; value: number }>;
    }>("Performance.getMetrics");
    const metrics: Record<string, number> = {};
    for (const item of metricsResult.metrics || []) {
      metrics[item.name] = item.value;
    }

    let navigation: BrowserPerformanceMetrics["navigation"];
    let paint: BrowserPerformanceMetrics["paint"];
    try {
      const value = await this.evalPage<{
        navigation?: BrowserPerformanceMetrics["navigation"];
        paint?: BrowserPerformanceMetrics["paint"];
      }>(`(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const paints = performance.getEntriesByType('paint');
        const fcp = paints.find((p) => p.name === 'first-contentful-paint');
        const fp = paints.find((p) => p.name === 'first-paint');
        return {
          navigation: nav ? {
            type: nav.type,
            durationMs: nav.duration,
            domContentLoadedMs: nav.domContentLoadedEventEnd,
            loadMs: nav.loadEventEnd,
            transferSize: nav.transferSize,
            encodedBodySize: nav.encodedBodySize,
          } : null,
          paint: {
            firstPaintMs: fp ? fp.startTime : undefined,
            firstContentfulPaintMs: fcp ? fcp.startTime : undefined,
          },
        };
      })()`);
      navigation = value?.navigation ?? undefined;
      paint = value?.paint ?? undefined;
    } catch {
      // optional
    }

    return { metrics, navigation, paint };
  }

  async screenshot(): Promise<BrowserScreenshotResult> {
    try {
      await this.ensureRunning();
      const wc = this.requireWebContents();
      const image = await withTimeout(wc.capturePage(), 8000, "截图");
      const dir = screenshotDir();
      await mkdir(dir, { recursive: true });
      const path = join(dir, `zen-browser-${Date.now()}.png`);
      await writeFile(path, image.toPNG());
      return { ok: true, path };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "screenshot failed" };
    }
  }

  async evaluate(expression: string): Promise<BrowserEvalResult> {
    try {
      await this.ensureRunning();
      const value = await this.evalPage<unknown>(expression);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "evaluate failed" };
    }
  }

  async startElementPick(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureRunning();
      const wc = this.requireWebContents();
      const attached = await this.ensureDebugger(3000);
      await withTimeout(wc.executeJavaScript(ELEMENT_PICK_SCRIPT, true), 4000, "启动标注");
      this.setStatus({ picking: true });
      if (!attached) {
        return { ok: true };
      }
      try {
        await this.sendDebugger("Runtime.addBinding", { name: "zenElementPicked" }, 2000);
      } catch {
        // binding optional
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "无法启动标注" };
    }
  }

  async stopElementPick(): Promise<{ ok: boolean }> {
    try {
      if (this.view && !this.view.webContents.isDestroyed()) {
        await withTimeout(
          Promise.resolve(this.view.webContents.executeJavaScript(ELEMENT_PICK_TEARDOWN, true)),
          2000,
          "停止标注",
        ).catch(() => undefined);
      }
    } catch {
      // ignore
    }
    this.setStatus({ picking: false });
    return { ok: true };
  }

  async consoleText(limit = 40): Promise<string> {
    const { entries } = await this.console(limit);
    return formatConsoleForPrompt(entries, limit);
  }

  async performanceText(): Promise<string> {
    return formatPerformanceForPrompt(await this.performance());
  }

  async snapshotText(): Promise<string> {
    return formatSnapshotForPrompt(await this.snapshot());
  }

  async extractText(): Promise<string> {
    return formatExtractForPrompt(await this.extract());
  }

  async networkEntries(limit = 30): Promise<BrowserNetworkEntry[]> {
    return this.networkBuffer.slice(-limit);
  }
}
