import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	type Frame,
	type Page,
} from "@playwright/test";
import Mocha from "mocha";

type Cfg = {
	code: string;
	ext: string;
	fresh: string;
	ready: string;
	root: string;
};

type Win = {
	app: ElectronApplication;
	page: Page;
};

async function pick(page: Page, list: string[], ms = 60000) {
	const stop = Date.now() + ms;

	while (Date.now() < stop) {
		for (const item of list) {
			const loc = page.locator(item).first();
			const ok = await loc.isVisible().catch(() => false);
			if (ok) return loc;
		}

		await wait(250);
	}

	throw new Error(`Timed out waiting for selector: ${list.join(" | ")}`);
}

async function open(cfg: Cfg, dir: string): Promise<Win> {
	const user = mkdtempSync(join(cfg.root, "user-"));
	const args = [
		dir,
		`--extensions-dir=${cfg.ext}`,
		`--user-data-dir=${user}`,
		"--disable-gpu",
		"--disable-workspace-trust",
		"--new-window",
		"--skip-release-notes",
		"--skip-welcome",
	];

	if (process.platform === "linux") args.push("--no-sandbox");

	const app = await electron.launch({
		args,
		cwd: cfg.root,
		executablePath: cfg.code,
		timeout: 60000,
	});
	const page = await app.firstWindow();
	await page.waitForSelector(".monaco-workbench", { timeout: 60000 });
	return { app, page };
}

async function icon(page: Page) {
	return pick(page, [
		'[id="workbench.view.extension.opencode-web"]',
		'.composite-bar [aria-label="OpenCode"]',
		'.activitybar [aria-label="OpenCode"]',
		'.composite-bar [aria-label^="OpenCode"]',
		'.activitybar [aria-label^="OpenCode"]',
	]);
}

async function web(page: Page, ms = 60000): Promise<Frame> {
	const stop = Date.now() + ms;

	while (Date.now() < stop) {
		for (const item of page.frames()) {
			if (item === page.mainFrame()) continue;
			const ok = await item
				.locator("#opencode-frame")
				.count()
				.then((n) => n > 0)
				.catch(() => false);
			if (ok) return item;
		}

		await wait(250);
	}

	throw new Error("Timed out waiting for OpenCode webview frame");
}

async function show(page: Page) {
	const item = await icon(page);
	await item.click();
	return web(page);
}

async function shut(win: Win) {
	await win.app.close();
}

function add(mocha: Mocha, cfg: Cfg) {
	const suite = Mocha.Suite.create(mocha.suite, "smoke");

	suite.addTest(
		new Mocha.Test(
			"shows SPA welcome page for unregistered folder",
			async () => {
				const win = await open(cfg, cfg.fresh);

				try {
					const frame = await show(win.page);
					await expect(frame.locator("body")).toHaveAttribute(
						"data-state",
						"ready",
						{ timeout: 60000 },
					);
					await expect(frame.locator("#shell")).toBeHidden();
					await expect(frame.locator("#opencode-frame")).toBeVisible();

					const src = await frame
						.locator("#opencode-frame")
						.getAttribute("src");
					assert.ok(src);
					assert.ok(
						src.startsWith("http://127.0.0.1:"),
						`Unexpected iframe src: ${src}`,
					);
					assert.equal(new URL(src).pathname, "/");
				} finally {
					await shut(win);
				}
			},
		),
	);

	suite.addTest(
		new Mocha.Test(
			"shows SPA iframe for registered project folder",
			async () => {
				const win = await open(cfg, cfg.ready);

				try {
					const frame = await show(win.page);
					await expect(frame.locator("body")).toHaveAttribute(
						"data-state",
						"ready",
						{ timeout: 60000 },
					);
					await expect(frame.locator("#shell")).toBeHidden();
					await expect(frame.locator("#opencode-frame")).toBeVisible();

					const src = await frame
						.locator("#opencode-frame")
						.getAttribute("src");
					assert.ok(src);
					assert.ok(
						src.startsWith("http://127.0.0.1:"),
						`Unexpected iframe src: ${src}`,
					);
				} finally {
					await shut(win);
				}
			},
		),
	);

	suite.addTest(
		new Mocha.Test(
			"opens OpenCode sidebar panel from the activity bar icon",
			async () => {
				const win = await open(cfg, cfg.fresh);

				try {
					await expect(win.page.locator("iframe.webview")).toHaveCount(0, {
						timeout: 10000,
					});
					const item = await icon(win.page);
					await item.click();

					const frame = await web(win.page);
					await expect(win.page.locator("iframe.webview").first()).toBeVisible({
						timeout: 60000,
					});
					await expect(frame.locator("#box")).toBeVisible();
				} finally {
					await shut(win);
				}
			},
		),
	);
}

export async function run(cfg: Cfg) {
	const mocha = new Mocha({
		color: true,
		timeout: 90000,
		ui: "bdd",
	});

	add(mocha, cfg);

	await new Promise<void>((done, fail) => {
		mocha.run((count) => {
			if (count > 0) {
				fail(new Error(`${count} smoke tests failed`));
				return;
			}

			done();
		});
	});
}
