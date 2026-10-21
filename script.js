(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const form = $('#request-form');
  const dialog = $('#request-dialog');
  const panel = $('#form-panel');
  const formHome = $('#form-home');
  const bar = $('#mobile-bar');
  const heroActions = $('#hero-actions');
  let opener = null;
  let closing = false;
  let busy = false;
  let submitted = false;
  let selectedFiles = [];
  let requestKey = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let started = false;
  let receiverMode = 'unavailable';
  const confirmedKeys = new Set();
  const contactDrafts = {phone: '', email: ''};
  let previousResponse = 'phone';

  // Only categorical, allowlisted data can enter an analytics event.
  function track(event, extra = {}) {
    const detail = {event};
    for (const name of ['service', 'configuration', 'contact_method', 'error_code', 'mode']) {
      if (extra[name] !== undefined) detail[name] = extra[name];
    }
    window.dispatchEvent(new CustomEvent('prints:analytics', {detail}));
  }
  function dirty() {
    if (busy) return;
    requestKey = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    submitted = false;
    $('.submit-button', form).disabled = false;
    $('.submit-button', form).innerHTML = 'Получить расчёт <svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg>';
    $('#form-status').textContent = '';
    $('#form-status').classList.remove('success');
  }
  function updateBar() {
    const mobile = matchMedia('(max-width: 767px)').matches;
    const above = heroActions.getBoundingClientRect().bottom < 0;
    const textFocused = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    const visible = element => {const r = element.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0;};
    bar.hidden = !mobile || !above || dialog.open || textFocused || visible($('#request')) || visible($('#footer'));
  }
  let framePending = false;
  function onScroll() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => {
      $('#top').classList.toggle('is-scrolled', scrollY > 16);
      updateBar();
      framePending = false;
    });
  }
  addEventListener('scroll', onScroll, {passive: true});
  addEventListener('resize', updateBar, {passive: true});
  visualViewport?.addEventListener('resize', updateBar, {passive: true});
  document.addEventListener('focusin', updateBar);
  document.addEventListener('focusout', () => requestAnimationFrame(updateBar));
  onScroll();

  const menuToggle = $('.menu-toggle');
  function closeMenu() {$('#mobile-menu').hidden = true; menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-label', 'Открыть меню');}
  menuToggle.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    $('#mobile-menu').hidden = !open;
  });
  $$('#mobile-menu a').forEach(a => a.addEventListener('click', closeMenu));
  document.addEventListener('keydown', e => {if (e.key === 'Escape' && !dialog.open) {closeMenu(); menuToggle.focus({preventScroll: true});}});
  matchMedia('(min-width: 768px)').addEventListener('change', closeMenu);

  $$('[data-request]').forEach(link => link.addEventListener('click', e => {
    e.preventDefault();
    if (dialog.open || closing) return;
    opener = link;
    if (!busy) {
      if (link.dataset.service) $('#service').value = link.dataset.service;
      if (link.dataset.configuration) {
        $('#configuration').value = link.dataset.configuration;
        $('.form-options', form).open = true;
      }
      if (link.dataset.service || link.dataset.configuration) dirty();
    }
    closeMenu();
    formHome.style.minHeight = `${panel.getBoundingClientRect().height}px`;
    $('#dialog-form-slot').append(panel);
    dialog.showModal();
    document.body.style.paddingRight = `${innerWidth - document.documentElement.clientWidth}px`;
    document.body.classList.add('dialog-open');
    $('#service').focus({preventScroll: true});
    updateBar();
    track('form_open', {service: $('#service').value, configuration: $('#configuration').value});
    if (link.dataset.service) track('service_select', {service: $('#service').value});
  }));
  function finishClose() {
    dialog.close();
    dialog.classList.remove('is-closing');
    formHome.append(panel);
    formHome.style.minHeight = '';
    document.body.classList.remove('dialog-open');
    document.body.style.paddingRight = '';
    closing = false;
    opener?.focus({preventScroll: true});
    updateBar();
  }
  function closeDialog() {
    if (!dialog.open || closing) return;
    closing = true;
    if (reduced.matches) finishClose();
    else {dialog.classList.add('is-closing'); setTimeout(finishClose, 160);}
  }
  $('.dialog-close').addEventListener('click', closeDialog);
  document.addEventListener('keydown', event => {
    if (!dialog.open || event.key !== 'Tab') return;
    const focusable = $$('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]', dialog)
      .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const first = focusable[0], last = focusable.at(-1);
    if (!first) {event.preventDefault(); dialog.focus(); return;}
    if (!dialog.contains(document.activeElement)) {event.preventDefault(); (event.shiftKey ? last : first).focus();}
    else if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
  });
  dialog.addEventListener('cancel', e => {e.preventDefault(); closeDialog();});
  dialog.addEventListener('click', e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog();
  });

  // Native <details> is the no-JavaScript fallback; WAAPI animates the real measured height.
  $$('.faq-item').forEach(item => {
    const summary = $('summary', item);
    const answer = $('.faq-answer', item);
    let desired = false;
    let animation = null;
    summary.setAttribute('aria-expanded', 'false');
    reduced.addEventListener('change', () => {
      if (reduced.matches && animation) {
        animation.cancel(); animation = null; item.open = desired; answer.style.height = '';
      }
    });
    summary.addEventListener('click', e => {
      e.preventDefault();
      desired = !desired;
      summary.setAttribute('aria-expanded', String(desired));
      const from = item.open ? answer.getBoundingClientRect().height : 0;
      animation?.cancel();
      item.open = true;
      if (reduced.matches || !answer.animate) {item.open = desired; return;}
      const to = desired ? answer.scrollHeight : 0;
      animation = answer.animate([{height: `${from}px`}, {height: `${to}px`}], {duration: 200, easing: 'cubic-bezier(.2,0,0,1)'});
      const running = animation;
      animation.onfinish = () => {
        if (animation !== running) return;
        item.open = desired;
        animation = null;
        answer.style.height = '';
      };
    });
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.remove('reveal-pending');
      observer.unobserve(entry.target);
    }), {threshold: .15});
    $$('.reveal-image').forEach(image => {
      if (!reduced.matches && image.getBoundingClientRect().top > innerHeight) image.classList.add('reveal-pending');
      observer.observe(image);
    });
    reduced.addEventListener('change', () => {
      if (reduced.matches) $$('.reveal-pending').forEach(image => image.classList.remove('reveal-pending'));
    });
  }

  form.addEventListener('focusin', () => {if (!started) {started = true; track('form_start');}});
  form.addEventListener('input', dirty);
  form.addEventListener('change', dirty);
  $('#service').addEventListener('change', () => track('service_select', {service: $('#service').value}));
  $$('a[href^="tel:"],a[href^="mailto:"]').forEach(link => link.addEventListener('click', () => track('contact_click', {contact_method: link.href.startsWith('tel:') ? 'phone' : 'email'})));
  $$('input[name="response"]').forEach(input => input.addEventListener('change', () => {
    contactDrafts[previousResponse] = $('#contact').value;
    const email = input.value === 'email';
    $('#contact').type = email ? 'email' : 'tel';
    $('#contact').autocomplete = email ? 'email' : 'tel';
    $('#contact').placeholder = email ? 'you@example.ru' : '+7 (___) ___-__-__';
    $('#contact-label').textContent = email ? 'Ваш e-mail' : 'Ваш телефон';
    $('#contact').value = contactDrafts[input.value];
    $('#contact').removeAttribute('aria-invalid');
    $('#contact-error').textContent = '';
    previousResponse = input.value;
  }));

  function renderFiles() {
    const list = $('#file-list');
    list.replaceChildren();
    selectedFiles.forEach((file, index) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} МБ`;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'icon-button';
      remove.setAttribute('aria-label', `Удалить файл ${file.name}`);
      remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-close"></use></svg>';
      remove.addEventListener('click', () => {
        selectedFiles.splice(index, 1); dirty(); renderFiles(); $('#file-error').textContent = ''; $('#attachments').focus();
      });
      li.append(name, remove); list.append(li);
    });
  }
  $('#attachments').addEventListener('change', event => {
    const errors = [];
    for (const file of event.target.files) {
      const extension = file.name.split('.').pop().toLowerCase();
      const mime = {jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf'}[extension];
      if (!mime || (file.type && file.type !== mime)) {errors.push('Разрешены только JPG, PNG и PDF.'); continue;}
      if (!file.size || file.size > 10 * 1024 * 1024) {errors.push('Каждый файл должен быть не больше 10 МБ и не пустым.'); continue;}
      if (selectedFiles.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) continue;
      if (selectedFiles.length >= 3) {errors.push('Можно прикрепить до трёх файлов. Удалите лишний файл.'); continue;}
      selectedFiles.push(file);
    }
    event.target.value = '';
    $('#file-error').textContent = [...new Set(errors)].join(' ');
    if (errors.length) track('form_error', {error_code: 'attachment_validation'});
    dirty(); renderFiles();
  });

  function validate() {
    const contact = $('#contact');
    const email = $('input[name="response"]:checked').value === 'email';
    const value = contact.value.trim();
    const digits = value.replace(/\D/g, '');
    const valid = email ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254 : /^[+()\d\s-]+$/.test(value) && digits.length >= 10 && digits.length <= 15;
    contact.setAttribute('aria-invalid', String(!valid));
    $('#contact-error').textContent = valid ? '' : email ? 'Введите e-mail в формате name@example.ru.' : 'Введите телефон: от 10 до 15 цифр.';
    const consent = $('#consent').checked;
    $('#consent').setAttribute('aria-invalid', String(!consent));
    $('#consent-error').textContent = consent ? '' : 'Нужно согласие на обработку данных.';
    if (!valid) contact.focus();
    else if (!consent) $('#consent').focus();
    return valid && consent;
  }
  function setBusy(value) {
    busy = value;
    form.setAttribute('aria-busy', String(value));
    $$('input, select, textarea, button', form).forEach(el => {el.disabled = value;});
    if (!value && submitted) $('.submit-button', form).disabled = true;
    $('.submit-button', form).textContent = value ? 'Отправляем…' : submitted ? (receiverMode === 'test' ? 'Тестовая заявка сохранена' : 'Заявка принята') : 'Получить расчёт';
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy || submitted) return;
    if (!validate()) {track('form_error', {error_code: 'contact_or_consent'}); return;}
    const status = $('#form-status');
    status.textContent = ''; status.classList.remove('success');
    if (location.protocol === 'file:' || !['test', 'live'].includes(receiverMode)) {
      status.textContent = 'Не удалось отправить заявку. Ваши данные остались в форме. Позвоните нам: +7 (916) 623-21-92 или напишите на info@prints-ru.ru.';
      track('form_error', {error_code: 'receiver_unavailable'}); return;
    }
    const data = new FormData(form);
    data.append('idempotency_key', requestKey);
    selectedFiles.forEach(file => data.append('attachments', file, file.name));
    setBusy(true);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', new URL('api/requests', location.href));
    xhr.timeout = 60000;
    let completed = false;
    function failure(message, code) {
      if (completed) return;
      completed = true;
      status.textContent = message;
      $('#upload-progress').hidden = true;
      setBusy(false);
      track('form_error', {error_code: code});
    }
    xhr.upload.onprogress = progress => {
      if (!progress.lengthComputable || !selectedFiles.length) return;
      const amount = Math.round(progress.loaded / progress.total * 100);
      $('#upload-progress').hidden = false;
      $('#progress').value = amount;
      $('#progress-value').textContent = `${amount}%`;
    };
    xhr.upload.onload = () => {if (!completed) status.textContent = 'Файлы загружены. Ожидаем подтверждение сохранения…';};
    xhr.onload = () => {
      let result;
      try {result = JSON.parse(xhr.responseText);} catch {failure('Не удалось получить подтверждение. Ввод сохранён — попробуйте ещё раз.', 'invalid_response'); return;}
      if (xhr.status >= 200 && xhr.status < 300 && result.saved === true && result.mode === receiverMode && result.request_id) {
        completed = true; submitted = true;
        status.classList.add('success');
        status.textContent = receiverMode === 'test' ? 'Тестовая заявка сохранена локально. В компанию не отправлена. Для настоящего заказа позвоните или напишите на e-mail.' : 'Заявка принята. Специалист свяжется с вами выбранным способом.';
        $('#upload-progress').hidden = true;
        setBusy(false);
        if (!confirmedKeys.has(requestKey)) {
          confirmedKeys.add(requestKey);
          track('request_created', {service: $('#service').value, configuration: $('#configuration').value, mode: receiverMode});
        }
      } else failure(result.message || 'Не удалось сохранить заявку. Ввод сохранён — попробуйте ещё раз.', result.code || 'server_error');
    };
    xhr.onerror = () => failure('Нет связи с сервером. Ввод и файлы сохранены в форме — попробуйте ещё раз.', 'network_error');
    xhr.ontimeout = () => failure('Сервер не ответил вовремя. Повторная отправка не создаст дубликат.', 'timeout');
    xhr.send(data);
  });

  if (/^https?:$/.test(location.protocol)) {
    fetch(new URL('api/config.json', location.href), {cache: 'no-store'}).then(response => response.ok ? response.json() : null).then(config => {
      if (config?.mode === 'test') {
        receiverMode = 'test';
      } else if (config?.mode === 'live') {
        receiverMode = 'live';
      }
    }).catch(() => {});
  }

  // One mechanical episode, only after the real scene layers and first frame are ready.
  async function initHero() {
    const hero = $('.hero-visual');
    const heroImage = $('#hero-image');
    const desktop = matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
    let done = false, hasLeft = false, inView = false;
    let animations = [];
    const stop = () => {done = true; animations.forEach(a => a.cancel()); hero.classList.remove('hero-layered');};
    const eligible = () => desktop.matches && !reduced.matches && document.visibilityState === 'visible' && !hasLeft;
    if (!eligible() || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      if (!inView && entries[0].boundingClientRect.bottom <= 0) {hasLeft = true; stop(); observer.disconnect();}
    }, {threshold: .15});
    observer.observe(hero);
    desktop.addEventListener('change', () => {if (!desktop.matches) stop();});
    reduced.addEventListener('change', () => {if (reduced.matches) stop();});
    document.addEventListener('visibilitychange', () => {if (document.hidden) stop();});
    try {
      await heroImage.decode();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!eligible() || done) return;
      const layers = document.createElement('div'); layers.className = 'hero-layers'; layers.setAttribute('aria-hidden', 'true');
      const background = new Image(), stamp = new Image(), ink = new Image();
      background.src = 'public/images/hero-wide-background.webp';
      stamp.src = 'public/images/hero-wide-stamp.webp';
      ink.src = 'public/images/hero-wide-ink.webp';
      const move = document.createElement('div'); move.className = 'hero-stamp-movement'; move.append(stamp);
      background.className = 'hero-layer-background'; ink.className = 'hero-layer-ink';
      layers.append(background, move, ink); hero.append(layers);
      await Promise.all([background.decode(), stamp.decode(), ink.decode()]);
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (!eligible() || done || !inView) {layers.remove(); return;}
      done = true;
      hero.classList.add('hero-layered');
      animations = [move.animate([
        {transform:'translateY(0)',offset:0,easing:'cubic-bezier(.2,0,0,1)'},
        {transform:'translateY(10px)',offset:220/680},
        {transform:'translateY(10px)',offset:320/680,easing:'cubic-bezier(.2,0,0,1)'},
        {transform:'translateY(0)',offset:580/680},
        {transform:'translateY(0)',offset:1}
      ], {duration:680}), ink.animate([
        {opacity:0,offset:0},{opacity:0,offset:220/680},{opacity:.18,offset:380/680},{opacity:0,offset:1}
      ], {duration:680,easing:'linear'})];
      await Promise.allSettled(animations.map(a => a.finished));
      stop(); observer.disconnect(); layers.remove();
    } catch {stop(); observer.disconnect();}
  }
  addEventListener('load', initHero, {once: true});
})();
