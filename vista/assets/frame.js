// Builds the self-contained document a slide is rendered in (sandboxed iframe, 1920x1080).
window.vistaSlideDoc = function (sectionHtml) {
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Domine:wght@400;700&family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Mono&display=swap" rel="stylesheet">' +
    '<style>' +
    'html,body{margin:0;padding:0;width:1920px;height:1080px;overflow:hidden;background:#fff}' +
    '*,*::before,*::after{box-sizing:border-box}' +
    'p,h1,h2,h3,h4,ul,ol,figure{margin:0}' +
    'section{width:1920px;height:1080px;overflow:hidden;position:relative;-webkit-font-smoothing:antialiased}' +
    'section>*{flex-shrink:0}section>[style*="flex:1"]{flex-shrink:1;min-height:0}' +
    'table{border-collapse:collapse;border-radius:12px;overflow:hidden;table-layout:fixed;width:100%}' +
    'th{text-align:left;font-weight:600;padding:12px 18px;vertical-align:bottom}' +
    'td{padding:11px 18px;vertical-align:top;border-top:1px solid rgba(27,36,48,.09)}' +
    'h1,h2,h3{font-weight:700}' +
    '</style></head><body>' + sectionHtml + '</body></html>';
};
