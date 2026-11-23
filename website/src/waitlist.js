'use strict';
(function () {
  const form = document.querySelector('#isp-waitlist-form');
  const email = document.querySelector('#isp-waitlist-email');
  const status = document.querySelector('#isp-waitlist-status');
  const button = form && form.querySelector('button[type="submit"]');
  if (!form || !email || !status) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!email.checkValidity()) { email.reportValidity(); return; }
    status.textContent = 'Joining the early-access list…';
    status.className = 'waitlist-status is-loading';
    if (button) { button.disabled = true; button.textContent = 'Joining…'; }
    try {
      const response = await fetch('/api/waitlist', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ email: email.value, website: form.elements.website.value }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'request_failed');
      status.textContent = result.already_registered ? 'You are already on the list. Check your inbox for the confirmation.' : 'You are in. Check your inbox for your early-access confirmation.';
      status.className = 'waitlist-status is-success';
      form.reset();
    } catch (error) {
      status.textContent = error.message === 'invalid_email' ? 'Please enter a valid email address.' : 'We could not join you to the list right now. Please try again shortly.';
      status.className = 'waitlist-status is-error';
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Join waiting list'; }
    }
  });
}());
