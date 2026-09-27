/**
 * Mobile-first UI journey in a real browser against a RUNNING server.
 *
 *   UI_BASE_URL=http://localhost:3000 UI_MOBILE=… UI_PASSWORD=… npm run test:ui
 *   (CHROMIUM_PATH=/path/to/chrome if Playwright's bundled browser isn't installed)
 *
 * Exercises: login → Home → People search → person dashboard → Add Person →
 * Add Contract (preview + review) → Record Payment (allocation receipt) →
 * contract calendar + day sheet → Collect/Activity/More → layout at 360/390/430px.
 * Creates one throwaway person per run; never touches existing records.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const BASE = process.env.UI_BASE_URL ?? "http://localhost:3000";
const MOBILE = process.env.UI_MOBILE;
const PASSWORD = process.env.UI_PASSWORD;
if (!MOBILE || !PASSWORD) throw new Error("Set UI_MOBILE and UI_PASSWORD (an ADMIN account on the target server).");

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

let passed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    await page.screenshot({ path: `ui-failure-${passed + 1}.png`, fullPage: true }) // gitignored.catch(() => {});
    await browser.close();
    process.exit(1);
  }
}
const go = async (path) => {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.locator("[aria-busy=true]").waitFor({ state: "detached" }).catch(() => {});
};
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, "horizontal overflow");
/** Wait until streaming has finished (no loading skeleton) before reading the page. */
const settled = async () => {
  await page.waitForLoadState("networkidle");
  await page.locator("[aria-busy=true]").waitFor({ state: "detached" }).catch(() => {});
};
const text = async (sel) => {
  await settled();
  return page.locator(sel).first().innerText();
};

const suffix = String(Date.now()).slice(-6);
const NAME = `Journey Test ${suffix}`;
const PHONE = `98${suffix}11`;

console.log(`Mobile journey against ${BASE}`);

await step("login redirects to Home", async () => {
  await go("/people");
  assert.match(page.url(), /\/login$/);
  await page.fill("#mobileNumber", MOBILE);
  await page.fill("#password", PASSWORD);
  await page.press("#password", "Enter");
  await page.waitForURL("**/dashboard");
  assert.match(await text("main"), /Collected for today/i);
});

await step("bottom navigation is visible with 5 tabs", async () => {
  const nav = page.locator("nav[aria-label=Main]:visible");
  assert.deepEqual((await nav.locator("a").allInnerTexts()).map((s) => s.trim()), ["Home", "People", "Collect", "Activity", "More"]);
});

await step("Add Person → success screen offers Add Contract first", async () => {
  await go("/people/new");
  await page.click("button[type=submit]");
  await page.waitForSelector("#fullName-error");
  await page.fill("#fullName", NAME);
  await page.fill("#phoneNumber", PHONE);
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Person created");
  const labels = (await page.locator("main a").allInnerTexts()).map((t) => t.trim());
  assert.ok(labels.indexOf("Add Contract") >= 0 && labels.indexOf("Add Contract") < labels.indexOf("View Person"), labels.join(","));
});

await step("Add Contract: person preselected, live calculation, review, create", async () => {
  await page.click("text=Add Contract");
  await page.waitForURL(/contracts\/new/);
  assert.match(await text("main"), new RegExp(NAME));
  await page.fill("#start", "2026-09-26");
  await page.fill("#first", "2026-09-27");
  await page.fill("#principal", "50000");
  await page.fill("#daily", "750");
  await page.fill("#days", "100");
  const preview = await text("section[aria-live]");
  assert.match(preview, /₹75,000/);
  assert.match(preview, /₹25,000/);
  assert.match(preview, /4 Jan 2027/);
  await page.click("text=Review Contract");
  assert.match(await text("main"), /Review Contract[\s\S]*₹50,000[\s\S]*4 Jan 2027/);
  await page.click("button:has-text('Create Contract')");
  await page.waitForSelector("text=Contract created");
  assert.match(await text("main"), /No payment has been recorded/);
});

await step("Record First Payment shows how the money was allocated", async () => {
  await page.click("text=Record First Payment");
  await page.waitForURL(/collect\?person=/);
  await noOverflow();
  await page.fill("#amount", "1500");
  assert.equal((await page.locator("button[type=submit]").innerText()).trim(), "Record ₹1,500");
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Payment recorded");
  const receipt = await text("main");
  assert.match(receipt, /Allocation/);
  // First collection is today (27 Sep): ₹750 pays today, ₹750 prepays tomorrow.
  assert.match(receipt, /Allocation[\s\S]*₹750[\s\S]*27 Sep collection[\s\S]*₹750[\s\S]*28 Sep prepaid/);
  assert.match(receipt, /₹75,000[\s\S]*₹73,500/);
});

await step("the payment is recorded exactly once and listed on the contract", async () => {
  await page.click("text=View Contract");
  await page.waitForURL(/\/contracts\//);
  await settled();
  const payments = await page.locator("section[aria-labelledby=pay-h] li").count();
  assert.equal(payments, 1);
});

await step("contract calendar opens a day sheet with the allocation", async () => {
  await page.locator("button[role=gridcell]").first().click();
  const sheet = page.locator("[role=dialog]");
  await sheet.waitFor();
  assert.match(await sheet.innerText(), /Expected[\s\S]*₹750/);
  assert.match(await sheet.innerText(), /Money applied to this day/);
  await page.keyboard.press("Escape");
});

await step("person dashboard shows the full financial position", async () => {
  await go(`/people?q=${encodeURIComponent(NAME)}`);
  await page.locator(`a:has-text("${NAME}")`).first().click();
  await page.waitForURL(/\/people\/journey-test/);
  const main = await text("main");
  assert.match(main, /TOTAL OUTSTANDING[\s\S]*₹73,500/i);
  assert.match(main, /Principal given[\s\S]*₹50,000/);
  assert.match(main, /Contracts/);
  assert.match(main, /Payment history[\s\S]*₹1,500/);
  assert.match(main, /Activity[\s\S]*received/);
  await page.click("button[aria-label='More actions']");
  const items = (await page.locator("[role=menuitem]").allInnerTexts()).map((s) => s.trim());
  assert.deepEqual(items, ["Edit Person", "Add Contract", "Record Payment", "View Transactions", "View Statement", "View Activity"]);
  await page.keyboard.press("Escape");
});

await step("search finds by mobile fragment and by contract number", async () => {
  await go(`/people?q=${PHONE.slice(-6)}`);
  assert.match(await text("main"), new RegExp(NAME));
  const contractLabel = (await text("main")).match(/AF-\d{4}/)?.[0];
  if (contractLabel) {
    await go(`/people?q=${contractLabel}`);
    assert.match(await text("main"), /1 result/);
  }
});

await step("Collect, Activity, More, Statement render", async () => {
  for (const [path, re] of [
    ["/collect", /Who is paying\?/],
    ["/activity", /Payment · /],
    ["/more", /Security[\s\S]*Users[\s\S]*Logout/],
  ]) {
    await go(path);
    assert.match(await text("main"), re, path);
  }
});

await step("no horizontal overflow at 360 / 390 / 430px", async () => {
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/dashboard", "/people", "/collect", "/activity"]) {
      await go(path);
      await noOverflow();
    }
  }
});

await step("desktop shows the people table and sidebar", async () => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await go("/people");
  assert.ok(await page.getByRole("table").isVisible());
  assert.ok(!(await page.locator("nav.fixed").isVisible()));
});

await step("no browser errors", async () => {
  assert.deepEqual(errors, []);
});

console.log(`\n${passed} steps passed.`);
await browser.close();
