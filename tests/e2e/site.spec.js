import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

async function demo(page, id = 'alina', next = '/people') {
  await page.goto(`/#/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Демо-пользователь').selectOption(id);
  await page.getByRole('button', { name: 'Открыть демоверсию' }).click();
  await expect(page).toHaveURL(new RegExp(`#${next.replace(/[?]/g, '\\?')}$`));
}
async function saved(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('medium.frontend.v1'))); }

test('Production CSS mask icons resolve to existing SVG assets', async ({ page, request }) => {
  const urls = new Set();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/', '/people', '/questions', '/questions/q1', '/study', '/menu']) {
    await page.goto(`/#${route}`);
    await expect(page.locator('main')).toBeVisible();
    const masks = await page.locator('.icon').evaluateAll(elements => elements.map(el => {
      const style = getComputedStyle(el);
      return style.maskImage || style.webkitMaskImage;
    }));
    for (const mask of masks) {
      const match = mask.match(/^url\(["']?(.*?)["']?\)$/);
      expect(match, `Resolved icon mask: ${mask}`).not.toBeNull();
      urls.add(match[1]);
    }
  }
  expect(urls.size).toBeGreaterThan(5);
  for (const url of urls) {
    const response = await request.get(url);
    expect(response.status(), `Icon asset ${url}`).toBe(200);
    expect(await response.text(), `SVG content ${url}`).toMatch(/<svg\b/);
  }
});

test('Registration, validation, profile persistence and subsequent sign-in', async ({ page }) => {
  await page.goto('/#/register');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Укажи имя и фамилию');
  await page.getByLabel('Имя Фамилия', { exact: true }).fill('Ирина Тестовая');
  await page.getByLabel('Почта', { exact: true }).fill('irina@example.invalid');
  await page.getByLabel('Пароль', { exact: true }).fill('test-password-2026');
  await page.getByLabel('Повтори пароль', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Твой профиль');
  await page.getByLabel('Направление', { exact: true }).fill('Прикладная информатика');
  await page.getByLabel('Русский', { exact: true }).check();
  await page.getByLabel('English', { exact: true }).check();
  await page.getByLabel('Дизайн', { exact: true }).check();
  await page.getByLabel('Несколько слов о себе').fill('Люблю знакомиться и учиться вместе.');
  await page.getByRole('button', { name: 'Сохранить и найти людей' }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/#\/people$/);
  await page.reload();
  const state = await saved(page); const me = state.users.find(u => u.id === state.session);
  expect(me.firstName).toBe('Ирина'); expect(me.languages).toEqual(['Русский', 'English']);
  expect(me.credential.hash).toHaveLength(32); expect(JSON.stringify(state)).not.toContain('test-password-2026');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.goto('/#/login');
  await page.getByLabel('Почта', { exact: true }).fill('irina@example.invalid');
  await page.getByLabel('Пароль', { exact: true }).fill('wrong-password');
  await expect(page.getByLabel('Почта', { exact: true })).toHaveValue('irina@example.invalid');
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveValue('wrong-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Почта или пароль не подходят');
  await page.getByLabel('Пароль', { exact: true }).fill('test-password-2026');
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveValue('test-password-2026');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/people$/);
});

test('Question → answer → five-star rating, replacement, ranking and self-rating restriction', async ({ page }) => {
  await demo(page, 'alina', '/questions');
  await page.getByLabel('Твой вопрос', { exact: true }).fill('Как найти аудиторию для семинара?');
  await page.getByRole('button', { name: 'Спросить', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Как найти аудиторию для семинара?');
  const id = (await saved(page)).questions[0].id;
  await demo(page, 'wei', `/questions/${id}`);
  await page.getByLabel('Поделись полезной информацией').fill('Посмотри номер корпуса и аудитории в расписании группы.');
  await page.getByRole('button', { name: 'Ответить', exact: true }).click();
  const group = page.getByRole('radiogroup', { name: 'Оценка ответа Вэй Линь' });
  await expect(group.getByRole('radio', { name: '5 из 5 звёзд' })).toBeDisabled();
  await demo(page, 'alina', `/questions/${id}`);
  await group.getByRole('radio', { name: '5 из 5 звёзд' }).click();
  await expect(group.getByRole('radio', { name: '5 из 5 звёзд' })).toHaveAttribute('aria-checked', 'true');
  await group.getByRole('radio', { name: '2 из 5 звёзд' }).click();
  await page.reload();
  await expect(group.getByRole('radio', { name: '2 из 5 звёзд' })).toHaveAttribute('aria-checked', 'true');
  await page.goto('/#/questions?tab=rating');
  const row = page.locator('.rating-list li').filter({ hasText: 'Вэй Линь' });
  await expect(row.locator('.rating-score')).toContainText('2');
  await expect(row).toContainText('Оценок: 1 · средняя 2.0');
  await demo(page, 'wei', `/questions/${id}`);
  await expect(group.getByRole('radio', { name: '5 из 5 звёзд' })).toBeDisabled();
});

test('Study request, completion and help rating update the same leaderboard', async ({ page }) => {
  await demo(page, 'alina', '/study?tab=need');
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Опиши проблему');
  await page.getByLabel('Предмет', { exact: true }).fill('Алгебра');
  await page.getByLabel('Проблема', { exact: true }).fill('Хочу разобраться с решением квадратных уравнений.');
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.locator('.my-request').filter({ hasText: 'Алгебра' })).toBeVisible();
  await page.locator('.my-request').filter({ hasText: 'English' }).getByRole('button', { name: 'Помощь получена' }).click();
  await page.getByLabel('Выбор помощи').selectOption('h6');
  await page.getByRole('radiogroup', { name: 'Оценка полученной помощи' }).getByRole('radio', { name: '4 из 5 звёзд' }).click();
  await demo(page, 'wei', '/study');
  await page.getByLabel('Поиск по предмету').fill('Алгебра');
  await page.getByRole('button', { name: 'Помочь', exact: true }).click();
  await expect(page).toHaveURL(/#\/chats\/c1$/);
  await demo(page, 'alina', '/study?tab=need');
  const own = page.locator('.my-request').filter({ hasText: 'Алгебра' });
  await own.getByRole('button', { name: 'Помощь получена' }).click();
  const helpId = (await saved(page)).helpRequests.find(h => h.subject === 'Алгебра').id;
  await page.getByLabel('Выбор помощи').selectOption(helpId);
  await page.getByRole('radiogroup', { name: 'Оценка полученной помощи' }).getByRole('radio', { name: '5 из 5 звёзд' }).click();
  await page.goto('/#/questions?tab=rating');
  await expect(page.locator('.rating-list li').filter({ hasText: 'Вэй Линь' }).locator('.rating-score')).toContainText('5');
  await expect(page.locator('.rating-list li').filter({ hasText: 'Мария Соколова' }).locator('.rating-score')).toContainText('9');
});

test('Search, filters, empty state, person profile and real local chat messages', async ({ page }) => {
  await demo(page);
  await page.getByLabel('Поиск по имени или интересам').fill('НикогоНеНайти');
  await expect(page.getByRole('heading', { name: 'Пока никого не нашли' })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить поиск' }).click();
  await expect(page.locator('details.filters')).not.toHaveAttribute('open', '');
  await expect(page.getByLabel('Язык', { exact: true })).toBeVisible();
  await page.getByLabel('Язык', { exact: true }).selectOption('中文');
  await expect(page.locator('.student-card')).toHaveCount(2);
  await expect(page.locator('.student-card').first()).toContainText('Вэй Линь');
  await page.locator('.student-card').filter({ hasText: 'Вэй Линь' }).getByRole('link', { name: 'Познакомиться' }).click();
  await page.getByRole('button', { name: 'Написать', exact: true }).click();
  await page.getByLabel('Написать сообщение', { exact: true }).fill('<script>не исполнять</script> Привет, Вэй!');
  await page.getByLabel('Написать сообщение', { exact: true }).press('Enter');
  await expect(page.locator('.message.outgoing').last()).toContainText('<script>не исполнять</script> Привет, Вэй!');
  await page.reload();
  await expect(page.locator('.message.outgoing').last()).toContainText('Привет, Вэй!');
  await demo(page, 'wei', '/chats/c1');
  await expect(page.locator('.message.incoming').last()).toContainText('Привет, Вэй!');
});

test('Long chat lists and messages scroll independently while the composer stays in place', async ({ page, request }, testInfo) => {
  await demo(page, 'alina', '/chats/c1');
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('medium.frontend.v1'));
    const chat = state.chats.find(c => c.id === 'c1');
    chat.messages = Array.from({ length: 60 }, (_, i) => ({ id: `long-${i}`, senderId: i % 2 ? 'wei' : 'alina', body: `Сообщение ${i + 1}: обсуждаем занятия и кампус.`, createdAt: Date.now() + i }));
    const copies = Array.from({ length: 35 }, (_, i) => ({ ...chat, id: `list-${i}`, messages: chat.messages.slice(0, 1) }));
    state.chats.push(...copies);
    localStorage.setItem('medium.frontend.v1', JSON.stringify(state));
  });
  await page.reload();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#/chats/c1');
    const composer = page.locator('.message-field .field-control');
    const send = page.getByRole('button', { name: 'Отправить сообщение' });
    const before = await composer.boundingBox();
    const button = await send.boundingBox();
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(button.y + button.height / 2 - before.y - before.height / 2)).toBeLessThan(1);
    expect(button.x + button.width).toBeLessThanOrEqual(before.x + before.width);
    const scroll = page.locator('.message-scroll');
    const dimensions = await scroll.evaluate(el => ({ height: el.clientHeight, full: el.scrollHeight }));
    expect(dimensions.full).toBeGreaterThan(dimensions.height);
    await scroll.evaluate(el => { el.scrollTop = 0; });
    await expect(scroll).toHaveJSProperty('scrollTop', 0);
    const after = await composer.boundingBox();
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    await expect(send.locator('.icon')).toHaveAttribute('style', /send\.svg/);
    await send.click();
    await expect(page.getByRole('alert')).toContainText('Напиши сообщение');
    const inputBox = await composer.boundingBox();
    const errorButton = await send.boundingBox();
    expect(Math.abs(errorButton.y + errorButton.height / 2 - inputBox.y - inputBox.height / 2)).toBeLessThan(1);
    await page.getByLabel('Написать сообщение', { exact: true }).fill('Проверка самолётика');
    await send.click();
    await expect(page.locator('.message.outgoing').last()).toContainText('Проверка самолётика');
    await page.goto('/#/chats');
    const chats = page.getByRole('region', { name: 'Диалоги', exact: true });
    const listBefore = await chats.boundingBox();
    const list = await chats.evaluate(el => ({ height: el.clientHeight, full: el.scrollHeight }));
    expect(list.full).toBeGreaterThan(list.height);
    await chats.evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await chats.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    const listAfter = await chats.boundingBox();
    expect(listAfter.height).toBe(listBefore.height);
  }
  const response = await request.get('/assets/send.svg');
  expect(response.status()).toBe(200);
  if (testInfo.project.name === 'chromium') {
    await mkdir('test-results/screenshots', { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/chats/c1');
    await page.screenshot({ path: 'test-results/screenshots/desktop-long-chat.png', fullPage: true });
  }
});

test('Keyboard navigation, native modal focus and arrow-key star selection', async ({ page }) => {
  await demo(page, 'alina', '/questions/q1');
  const group = page.getByRole('radiogroup', { name: 'Оценка ответа Мария Соколова' });
  await group.getByRole('radio', { name: '1 из 5 звёзд' }).focus();
  await page.keyboard.press('End');
  await expect(group.getByRole('radio', { name: '5 из 5 звёзд' })).toBeFocused();
  await expect(group.getByRole('radio', { name: '5 из 5 звёзд' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement.closest('dialog')))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Switch interface to English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Your answer' })).toBeVisible();
});

test('All screens fit desktop, tablet and narrow phones without runtime errors', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await demo(page);
  const routes = ['/', '/profile', '/people', '/people/wei', '/questions', '/questions/q1', '/questions?tab=rating', '/study', '/study?tab=need', '/chats', '/chats/c1', '/menu', '/login', '/register'];
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
    for (const route of routes) {
      await page.goto(`/#${route}`);
      await expect(page.locator('main')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      expect(dimensions.scroll, `${route} at ${width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
      for (const img of await page.locator('img').all()) expect(await img.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    }
  }
  await page.getByRole('button', { name: 'Switch interface to English' }).click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
    for (const route of ['/', '/profile', '/people', '/questions', '/study', '/register']) {
      await page.goto(`/#${route}`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await page.evaluate(() => document.fonts.ready);
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      expect(dimensions.scroll, `English ${route} at ${width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
    }
  }
  await page.getByRole('button', { name: 'Переключить интерфейс на русский' }).click();
  expect(errors).toEqual([]);
  if (testInfo.project.name === 'chromium') {
    await mkdir('test-results/screenshots', { recursive: true });
    for (const [prefix,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
      await page.setViewportSize({ width,height });
      for (const [name,route] of [['home','/'],['people','/people'],['profile','/profile'],['questions','/questions'],['answer-rating','/questions/q1'],['leaderboard','/questions?tab=rating'],['study','/study'],['help-rating','/study?tab=need'],['chat','/chats/c1']]) {
        await page.goto(`/#${route}`); await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `test-results/screenshots/${prefix}-${name}.png`, fullPage: true });
      }
    }
  }
});

test('WCAG AA automated accessibility checks on desktop and mobile screens', async ({ page }) => {
  test.setTimeout(120000);
  await demo(page);
  for (const width of [1440,390]) {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
    for (const route of ['/', '/profile', '/people', '/questions', '/questions/q1', '/questions?tab=rating', '/study', '/study?tab=need', '/chats/c1', '/login', '/register']) {
      await page.goto(`/#${route}`);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), `${route} at ${width}px`).toEqual([]);
    }
  }
});

test('Guest phone header and navigation have usable touch targets at reduced viewport heights', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  async function touchTarget(locator) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    return box;
  }
  for (const [width,height] of [[320,580],[390,660],[390,844]]) {
    await page.setViewportSize({ width,height });
    await page.goto('/#/');
    for (const locale of ['ru','en']) {
      const join = page.locator('.button-header');
      const label = join.locator('.header-join-short');
      await expect(label).toHaveText(locale === 'ru' ? 'Начать' : 'Join');
      const controls = [page.locator('.language-button'), join, page.locator('.menu-toggle')];
      const boxes = [];
      for (const control of controls) boxes.push(await touchTarget(control));
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i-1].x + boxes[i-1].width);
      expect(boxes.at(-1).x + boxes.at(-1).width).toBeLessThanOrEqual(width);
      const text = await label.boundingBox();
      expect(text.height).toBeLessThan(24);
      await join.click();
      await expect(page).toHaveURL(/#\/register$/);
      await page.goto('/#/');
      for (const selector of ['.button-hero','.hero-logo']) {
        const item = page.locator(selector);
        await item.evaluate(el => el.scrollIntoView({ block: 'center' }));
        const rect = await item.boundingBox();
        const header = await page.locator('.site-header').boundingBox();
        const nav = await page.locator('.bottom-nav').boundingBox();
        expect(rect.y).toBeGreaterThanOrEqual(header.y + header.height);
        expect(rect.y + rect.height).toBeLessThanOrEqual(nav.y);
      }
      await page.goto('/#/questions/q1');
      const back = page.locator('.back-link');
      const backBox = await touchTarget(back);
      // Press the padded edge, where the old text-only link was hard to hit.
      await back.click({ position: { x: backBox.width - 8, y: backBox.height - 8 } });
      await expect(page).toHaveURL(/#\/questions$/);
      await page.goto('/#/study');
      for (const link of await page.locator('.study-tabs a').all()) await touchTarget(link);
      await page.locator('.study-tabs a').nth(1).click();
      await expect(page).toHaveURL(/#\/study\?tab=need$/);
      await page.locator('.study-tabs a').first().click();
      await expect(page).toHaveURL(/#\/study$/);
      const ranking = page.locator('.mobile-rating-link');
      await ranking.evaluate(el => el.scrollIntoView({ block: 'center' }));
      const rankingBox = await touchTarget(ranking);
      const bottom = await page.locator('.bottom-nav').boundingBox();
      expect(rankingBox.y + rankingBox.height).toBeLessThanOrEqual(bottom.y);
      await ranking.click();
      await expect(page).toHaveURL(/#\/questions\?tab=rating$/);
      await page.goto('/#/');
      const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      expect(accessibility.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
      if (testInfo.project.name === 'chromium' && width === 390 && height === 844 && locale === 'ru') {
        await mkdir('test-results/screenshots', { recursive: true });
        await page.screenshot({ path: 'test-results/screenshots/mobile-guest-home.png', fullPage: true });
        await page.goto('/#/questions/q1');
        await page.screenshot({ path: 'test-results/screenshots/mobile-guest-answer.png', fullPage: true });
      }
      await page.locator('.language-button').click();
      await page.goto('/#/');
    }
  }
});

test('Motion preserves touch targets, modal focus and reduced-motion behavior', async ({ page }) => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await demo(page, 'alina', '/questions/q1');
      const menuButton = page.getByRole('button', { name: 'Открыть меню' });
      await menuButton.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('data-phase', 'open');
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement.closest('dialog')))).toBe(true);
      if (reducedMotion === 'reduce') expect(await dialog.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(menuButton).toBeFocused();
      // Reopen immediately after an exit: no stale timer may close the new dialog.
      await menuButton.click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await menuButton.click();
      await expect(dialog).toHaveAttribute('data-phase', 'open');
      await page.waitForTimeout(200);
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();

      await menuButton.click();
      await dialog.getByRole('link', { name: 'Знакомства', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Знакомства' })).toBeFocused();
      await page.goto('/#/questions/q1');

      const stars = page.getByRole('radiogroup', { name: 'Оценка ответа Мария Соколова' });
      await stars.getByRole('radio', { name: '5 из 5 звёзд' }).click();
      await stars.getByRole('radio', { name: '2 из 5 звёзд' }).click();
      await expect(stars.getByRole('radio', { name: '2 из 5 звёзд' })).toHaveAttribute('aria-checked', 'true');
      expect((await saved(page)).answers.find(a => a.id === 'a1').rating).toBe(2);
      const target = await stars.getByRole('radio', { name: '2 из 5 звёзд' }).boundingBox();
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      if (reducedMotion === 'reduce') expect(await stars.locator('.star-confirming .icon').evaluate(el => getComputedStyle(el).animationName)).toBe('none');

      await page.goto('/#/study');
      const indicator = page.locator('.study-tabs .segment-indicator');
      const firstPosition = await indicator.boundingBox();
      await page.getByRole('link', { name: 'Нужна помощь', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'С чем нужно помочь?' })).toBeVisible();
      await expect.poll(async () => (await indicator.boundingBox()).x).toBeGreaterThan(firstPosition.x + firstPosition.width);
      await page.getByRole('link', { name: 'Могу помочь', exact: true }).click();
      await expect(page.getByLabel('Поиск по предмету')).toBeVisible();
      if (reducedMotion === 'reduce') {
        expect(await indicator.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
        expect(await page.locator('.tab-content').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
  }
});
