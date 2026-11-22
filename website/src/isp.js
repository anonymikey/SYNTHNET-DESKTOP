'use strict';
(function () {
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const menu = $('.menu-toggle');
  const mobileNav = $('#isp-mobile-nav');
  if (menu && mobileNav) {
    menu.addEventListener('click', () => {
      const expanded = menu.getAttribute('aria-expanded') === 'true';
      menu.setAttribute('aria-expanded', String(!expanded));
      menu.setAttribute('aria-label', expanded ? 'Open navigation menu' : 'Close navigation menu');
      mobileNav.hidden = expanded;
    });
    $$('a', mobileNav).forEach((link) => link.addEventListener('click', () => {
      menu.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-label', 'Open navigation menu');
      mobileNav.hidden = true;
    }));
  }

  const labels = { overview: 'OVERVIEW', network: 'NETWORK', plans: 'BILLING PLANS', vouchers: 'VOUCHERS', payments: 'PAYMENTS' };
  const titles = { overview: 'Good evening, operator.', network: 'Your network, in view.', plans: 'Package rules, made readable.', vouchers: 'Prepaid access, under control.', payments: 'Every payment has a trail.' };
  const tabs = $$('.workspace-tab');
  const panels = $$('[data-panel]');
  function activateTab(name) {
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
    });
    panels.forEach((panel) => {
      const active = panel.dataset.panel === name;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    const label = $('#active-tab-label');
    const title = $('#workspace-title');
    if (label) label.textContent = labels[name] || name.toUpperCase();
    if (title) title.textContent = titles[name] || 'ISP Network workspace.';
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      activateTab(tabs[next].dataset.tab);
    });
  });

  let toastTimer;
  const toast = (message) => {
    const node = $('#workspace-toast');
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
  };
  $$('[data-toast]').forEach((button) => button.addEventListener('click', () => toast(button.dataset.toast)));
  $$('[data-adapter]').forEach((button) => button.addEventListener('click', () => toast(`${button.dataset.adapter}: adapter contract queued for the authenticated workspace.`)));

  const quantity = $('#voucher-quantity');
  const plan = $('#voucher-plan');
  const generate = $('#voucher-generate');
  const message = $('#voucher-message');
  if (generate && quantity && plan && message) {
    generate.addEventListener('click', () => {
      const count = Math.min(Math.max(Number(quantity.value) || 1, 1), 500);
      const selectedPlan = plan.value.split(' · ')[0];
      message.textContent = `${count} ${selectedPlan} codes ready for preview. No live batch was created.`;
      toast('Preview only — activate the ISP workspace to generate real vouchers.');
    });
  }
  const year = $('#isp-year');
  if (year) year.textContent = String(new Date().getFullYear());
}());
