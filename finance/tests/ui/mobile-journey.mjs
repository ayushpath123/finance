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

// Dates relative to today in India, so the journey works on any day.
const istToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const human = (iso, year = true) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) })
    .format(new Date(`${iso}T00:00:00Z`))
    .replace("Sept", "Sep");
const START = plusDays(istToday, -1);
const FIRST = istToday;
const FINAL = plusDays(FIRST, 99);

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
  await page.fill("#start", START);
  await page.fill("#first", FIRST);
  await page.fill("#principal", "50000");
  await page.fill("#daily", "750");
  await page.fill("#days", "100");
  const preview = await text("section[aria-live]");
  assert.match(preview, /₹75,000/);
  assert.match(preview, /₹25,000/);
  assert.match(preview, new RegExp(human(FINAL)));
  await page.click("text=Review Contract");
  assert.match(await text("main"), new RegExp(`Review Contract[\\s\\S]*₹50,000[\\s\\S]*${human(FINAL)}`));
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
  // First collection is today: ₹750 pays today, ₹750 prepays tomorrow.
  assert.match(receipt, new RegExp(`Allocation[\\s\\S]*₹750[\\s\\S]*${human(FIRST, false)} collection[\\s\\S]*₹750[\\s\\S]*${human(plusDays(FIRST, 1), false)} prepaid`));
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
  assert.deepEqual(items, ["Edit Person", "Add Contract", "Record Payment", "Give Short-term Loan", "I Borrowed Money", "View Transactions", "View Statement", "View Activity"]);
  await page.keyboard.press("Escape");
});

await step("Short-term: give money from the person page with a fixed interest amount", async () => {
  await page.locator("main a:has-text('Short-term Loan')").first().click();
  await page.waitForURL(/short-term\/new/);
  await page.fill("#principal", "10000");
  await page.fill("#interest", "500");
  assert.match(await text("section[aria-live]"), /To come back[\s\S]*₹10,500/);
  await page.click("button:has-text('Review')");
  assert.match(await text("main"), /Time limit[\s\S]*None/);
  await page.click("button:has-text('Record short-term loan')");
  await page.waitForSelector("text=Short-term loan recorded");
  await page.click("text=View loan");
  await page.waitForURL(/\/short-term\/[0-9a-f-]{36}$/);
  assert.match(await text("main"), /TO COME BACK[\s\S]*₹10,500/i);
});

await step("Short-term: part of the money comes back, loan stays open", async () => {
  await page.fill("#amount", "4000");
  assert.match(await text("main form"), /₹6,500 will still be outstanding/);
  await page.click("button:has-text('Record ₹4,000')");
  await page.waitForSelector("text=₹4,000 recorded");
  await page.click("button:has-text('Done')");
  await page.waitForFunction(() => /TO COME BACK\s*₹6,500/i.test(document.querySelector("main")?.innerText ?? ""));
  assert.match(await text("main form"), /₹6,500 outstanding/);
});

await step("Short-term: settle & close for less records what was let go", async () => {
  await page.click("[role=tab]:has-text('Settle & close')");
  await page.fill("#amount", "6000");
  assert.match(await text("main form"), /₹500 will be recorded as let go/);
  assert.ok(await page.locator("button[type=submit]:has-text('Settle & close')").isDisabled(), "needs a reason when letting money go");
  await page.fill("#notes", "Interest forgiven");
  await page.click("button[type=submit]:has-text('Settle & close')");
  await page.waitForSelector("text=The loan is now closed");
  await page.click("button:has-text('Done')");
  await page.waitForFunction(() => /\bCLOSED\b/.test(document.querySelector("main")?.innerText ?? ""));
  const main = await text("main");
  assert.match(main, /CLOSED/);
  assert.match(main, /Let go[\s\S]*₹500/);
});

await step("Short-term: reversing a repayment reopens the loan", async () => {
  await page.locator("section[aria-labelledby=rep-h] button:has-text('Reverse')").first().click();
  await page.locator("[role=dialog] textarea").fill("Entered by mistake");
  await page.click("[role=dialog] button:has-text('Reverse repayment')");
  await page.waitForSelector("text=The loan is open again");
  await page.waitForFunction(() => /TO COME BACK/i.test(document.querySelector("main")?.innerText ?? ""));
  assert.match(await text("main"), /OPEN/);
  assert.match(await text("main"), /REVERSED|line-through|Repayments/);
});

await step("Short-term shows on the person page, Home and the short-term list", async () => {
  await go(`/people?q=${encodeURIComponent(NAME)}`);
  await page.locator(`a:has-text("${NAME}")`).first().click();
  await page.waitForURL(/\/people\/journey-test/);
  const main = await text("main");
  assert.match(main, /Short-term loans/);
  assert.match(main, /short-term/i);
  await go("/short-term");
  assert.match(await text("main"), new RegExp(NAME));
  await go("/dashboard");
  assert.match(await text("main"), /NET POSITION[\s\S]*Short-term out[\s\S]*I owe \(borrowed\)/i);
});

await step("Borrowing: record money I borrowed from this person", async () => {
  await go(`/people?q=${encodeURIComponent(NAME)}`);
  await page.locator(`a:has-text("${NAME}")`).first().click();
  await page.waitForURL(/\/people\/journey-test/);
  await settled();
  const before = (await text("main")).match(/TOTAL OUTSTANDING\s*(₹[\d,]+)/i)?.[1];
  await page.click("button[aria-label='More actions']");
  await page.click("[role=menuitem]:has-text('I Borrowed Money')");
  await page.waitForURL(/borrowed\/new/);
  await page.fill("#principal", "25000");
  await page.fill("#interest", "1000");
  assert.match(await text("section[aria-live]"), /To pay back[\s\S]*₹26,000/);
  await page.click("button:has-text('Review')");
  await page.click("button:has-text('Record borrowing')");
  await page.waitForSelector("text=Borrowing recorded");
  // The person page shows what I owe separately and does NOT reduce what they owe me.
  await page.click("text=Back to");
  await page.waitForURL(/\/people\/journey-test/);
  await page.waitForFunction(() => /YOU OWE/i.test(document.querySelector("main")?.innerText ?? ""));
  const main = await text("main");
  assert.match(main, /YOU OWE[\s\S]*₹26,000/i);
  assert.equal(main.match(/TOTAL OUTSTANDING\s*(₹[\d,]+)/i)?.[1], before);
  assert.match(main, /Money I borrowed/);
});

await step("Borrowing: paying it all back closes it", async () => {
  await page.locator("section[aria-labelledby=br-h] a[href^='/short-term/']").first().click();
  await page.waitForURL(/\/short-term\/[0-9a-f-]{36}$/);
  assert.match(await text("main"), /TO PAY BACK[\s\S]*₹26,000/i);
  assert.match(await text("main form"), /This pays everything back/);
  await page.click("main form button[type=submit]:has-text('Record ₹26,000')");
  await page.waitForSelector("text=The loan is now closed");
  await page.click("button:has-text('Done')");
  await page.waitForFunction(() => /\bCLOSED\b/.test(document.querySelector("main")?.innerText ?? ""));
  assert.match(await text("main"), /Paid back[\s\S]*₹26,000/);
});

await step("Lending and Borrowing are separate pages; Settlements shows the net and who owes whom", async () => {
  await go("/borrowing?show=closed");
  assert.match(await text("main"), /Borrowing[\s\S]*YOU OWE/i);
  assert.match(await text("main"), new RegExp(NAME));
  await go("/lending");
  assert.match(await text("main"), /Lending[\s\S]*THEY OWE YOU[\s\S]*Interest to earn/i);
  await go("/short-term?type=borrowed"); // old link still works
  assert.match(page.url(), /\/borrowing$/);
  await go("/settlements");
  const main = await text("main");
  assert.match(main, /NET POSITION/i);
  assert.match(main, /Owed to you[\s\S]*You owe/);
  assert.match(main, /Who owes whom/);
  assert.match(main, new RegExp(NAME));
  await page.click("[role=tab]:has-text('I owe')");
  await page.waitForURL(/who=i-owe/);
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
    ["/more", /Settlements[\s\S]*Lending[\s\S]*Borrowing[\s\S]*Security[\s\S]*Users[\s\S]*Logout/],
  ]) {
    await go(path);
    assert.match(await text("main"), re, path);
  }
});

await step("no horizontal overflow at 360 / 390 / 430px", async () => {
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/dashboard", "/people", "/collect", "/activity", "/settlements", "/lending", "/borrowing"]) {
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
