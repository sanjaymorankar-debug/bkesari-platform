/* The style guide's two demos. A file, so the hub's CSP holds. */
(function () {
  'use strict';
  const K = window.Kesari;
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-sg-toast]')) K.toast('Saved. This is a toast.', { kind: 'success', action: 'Undo', onAction: () => K.toast('Undone') });
    const d = e.target.closest('[data-sg-dialog]');
    if (d) K.openDialog(document.getElementById('sg-dialog'), d);
  });
})();
