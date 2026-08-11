(function () {
  'use strict';

  function addScript(src, marker, onload) {
    if (document.querySelector('script[' + marker + ']')) {
      if (onload) onload();
      return;
    }
    var script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.setAttribute(marker, 'true');
    if (onload) script.onload = onload;
    document.head.appendChild(script);
  }

  // This file replaces the old compiled bundle at the same URL. During the
  // initial HTML parse, keep the old synchronous semantics so any code that
  // follows the script tag can use window.OrgChart immediately.
  if (document.readyState === 'loading') {
    document.write('<script src="/org-chart-widget-core.js" data-org-chart-core="true"><\\/script>');
    document.write('<script src="/document-folders.js" data-document-folders="true"><\\/script>');
    return;
  }

  // Fallback for dynamically injected/reloaded scripts.
  addScript('/org-chart-widget-core.js', 'data-org-chart-core', function () {
    addScript('/document-folders.js', 'data-document-folders');
  });
})();
