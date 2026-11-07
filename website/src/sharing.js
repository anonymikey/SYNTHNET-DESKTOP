'use strict';
(function () {
  const url = 'https://synthnetdesktop.anonymiketech.space/sharing';
  const status = document.querySelector('#share-status');
  const say = (text) => { if (status) status.textContent = text; };
  const native = document.querySelector('#native-share');
  if (native) native.addEventListener('click', async () => {
    if (!navigator.share) { say('Your browser does not offer native sharing. Use WhatsApp, Telegram, or Copy link.'); return; }
    try { await navigator.share({ title: 'SYNTHNET Desktop', text: 'Local-first paid Wi-Fi control for Windows.', url }); say('Share sheet opened.'); } catch (error) { if (error.name !== 'AbortError') say('Sharing was not completed. You can use one of the direct share buttons.'); }
  });
  const copy = document.querySelector('#copy-share');
  if (copy) copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); say('Sharing link copied.'); } catch { say(url); } });
  const year = document.querySelector('#year'); if (year) year.textContent = String(new Date().getFullYear());
}());
