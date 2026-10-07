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
  await expect(row).toContainText('1 оценок · средняя 2.0');
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
  await page.getByText('Фильтры', { exact: true }).click();
  await page.getByLabel('Язык', { exact: true }).selectOption('中文');
  await expect(page.locator('.student-card')).toHaveCount(2);
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
  expect(errors).toEqual([]);
  if (testInfo.project.name === 'chromium') {
    await mkdir('docs/screenshots', { recursive: true });
    for (const [prefix,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
      await page.setViewportSize({ width,height });
      for (const [name,route] of [['home','/'],['people','/people'],['profile','/profile'],['questions','/questions'],['answer-rating','/questions/q1'],['leaderboard','/questions?tab=rating'],['study','/study'],['help-rating','/study?tab=need'],['chat','/chats/c1']]) {
        await page.goto(`/#${route}`); await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `docs/screenshots/${prefix}-${name}.png`, fullPage: true });
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
