/* DuaDesk language layer: English page, with Hindi and Punjabi (Gurmukhi) on request. */
(function(){
 var INLINE={B:1,STRONG:1,I:1,EM:1,SMALL:1,SUP:1,SUB:1,BR:1,SPAN:1,U:1,MARK:1,ABBR:1};
 var SKIP={SCRIPT:1,STYLE:1,NOSCRIPT:1,TEXTAREA:1,CANVAS:1,CODE:1,PRE:1,IFRAME:1};
 var ATTRS=['placeholder','aria-label','title','alt'];
 var LETTER=/[A-Za-z]{2}/;
 function norm(s){return String(s).replace(/\s+/g,' ').trim();}
 /* numbers become {0},{1}... so one entry covers every value */
 function tmpl(s){var n=[];var k=s.replace(/\d[\d,]*(?:\.\d+)?/g,function(m){n.push(m);return '{'+(n.length-1)+'}';});return {k:k,n:n};}
 function fill(v,n){return v.replace(/\{(\d+)\}/g,function(m,i){return n[+i]!==undefined?n[+i]:m;}).replace(/(\d),([,،])/g,'$1$2').replace(/(\d),(\s*[।:])/g,'$1$2');}
 function inlineOnly(el){
  for(var c=el.firstElementChild;c;c=c.nextElementSibling){
   if(!INLINE[c.tagName]||c.id||c.hasAttribute('data-i18n-skip'))return false;
   if(c.firstElementChild&&!inlineOnly(c))return false;
  }return true;
 }
 function hasOwnText(el){for(var c=el.firstChild;c;c=c.nextSibling){if(c.nodeType===3&&LETTER.test(c.nodeValue))return true;}return false;}
 function skippable(el){return !el||SKIP[el.tagName]||el.closest&&el.closest('[translate="no"],.notranslate');}
 var SVGNS='http://www.w3.org/2000/svg';
 function svgUnits(el,cb){var s=el.tagName.toLowerCase()==='svg'?el:el.ownerSVGElement;if(!s)return;
  if(/stamp/i.test(s.getAttribute('class')||'')||s.closest('[translate="no"],.notranslate'))return;
  var list=/^(text|tspan)$/i.test(el.tagName)?[el]:[].slice.call(el.querySelectorAll('text,tspan'));
  list.forEach(function(t){if(t.querySelector('tspan,textPath')||t.closest('textPath'))return;for(var c=t.firstChild;c;c=c.nextSibling){if(c.nodeType===3)textUnit(c,cb);}});}
 /* visit every translatable unit under root: cb(kind, node, key, nums) */
 function units(root,cb){
  if(root.nodeType===3){if(root.parentElement)units(root.parentElement,cb);return;}
  if(root.nodeType!==1)return;
  if(root.namespaceURI===SVGNS){svgUnits(root,cb);return;}
  if(skippable(root))return;
  attrUnits(root,cb);
  if(blockOf(root)){var html=norm(root.innerHTML),x2=tmpl(html);cb('html',root,x2.k,x2.n);
   var all=root.querySelectorAll('*');for(var i=0;i<all.length;i++)attrUnits(all[i],cb);return;}
  for(var c=root.firstChild;c;c=c.nextSibling){
   if(c.nodeType===3){textUnit(c,cb);} else if(c.nodeType===1)units(c,cb);
  }
 }
 function blockOf(el){return el.firstElementChild&&hasOwnText(el)&&inlineOnly(el);}
 function textUnit(n,cb){if(!LETTER.test(n.nodeValue))return;var t=norm(n.nodeValue);if(!t)return;var x=tmpl(t);cb('text',n,x.k,x.n);}
 function attrUnits(el,cb){for(var i=0;i<ATTRS.length;i++){var v=el.getAttribute&&el.getAttribute(ATTRS[i]);if(v&&LETTER.test(v)){var x=tmpl(norm(v));cb('attr:'+ATTRS[i],el,x.k,x.n);}}
  if(el.tagName==='INPUT'&&(el.type==='button'||el.type==='submit')&&LETTER.test(el.value)){var y=tmpl(norm(el.value));cb('value',el,y.k,y.n);}}
 window.DDLang={norm:norm,tmpl:tmpl,fill:fill,units:units};

 /* ---------- live translation ---------- */
 var LANGS={en:{label:'English',short:'EN'},hi:{label:'हिंदी',short:'हिं',file:'dd-hi.js',v:'DD_HI'},pa:{label:'ਪੰਜਾਬੀ',short:'ਪੰ',file:'dd-pa.js',v:'DD_PA'}};
 var lang='en';
 try{var q=new URLSearchParams(location.search).get('lang');if(LANGS[q]){localStorage.setItem('dd-lang',q);} lang=localStorage.getItem('dd-lang')||'en';if(!LANGS[lang])lang='en';}catch(e){}
 DDLang.lang=lang;DDLang.LANGS=LANGS;
 function dict(){return (LANGS[lang].v&&window[LANGS[lang].v])||{};}
 var busy=false;
 function apply(root){
  var D=dict();busy=true;
  units(root,function(kind,node,key,nums){
   var v=D[key];if(v===undefined)return;v=fill(v,nums);
   if(kind==='html'){if(node.__ddv!==v){node.innerHTML=v;node.__ddv=v;}}
   else if(kind==='text'){if(!node)return;var o=node.nodeValue,lead=o.match(/^\s*/)[0],trail=o.match(/\s*$/)[0];node.nodeValue=lead+v+trail;}
   else if(kind==='value'){node.value=v;}
   else{node.setAttribute(kind.slice(5),v);}
  });
  busy=false;
 }
 /* translated slide images live in p3-deck/<lang>/ */
 function imgSrc(img){var s=img.getAttribute&&img.getAttribute('src');if(s&&/(^|\/)p3-deck\//.test(s)&&!/p3-deck\/(hi|pa)\//.test(s))img.setAttribute('src',s.replace('p3-deck/','p3-deck/'+lang+'/'));}
 function imgs(root){if(!root||!root.querySelectorAll)return;if(root.tagName==='IMG')imgSrc(root);root.querySelectorAll('img').forEach(imgSrc);}
 function start(){
  if(lang==='en')return;
  var h=document.documentElement;h.lang=lang;h.classList.add('dd-tr','dd-'+lang);
  var D=dict();var t=tmpl(norm(document.title));if(D[t.k])document.title=fill(D[t.k],t.n);
  document.querySelectorAll('meta[name=description],meta[property="og:title"],meta[property="og:description"],meta[name="twitter:title"],meta[name="twitter:description"]').forEach(function(m){var x=tmpl(norm(m.content||''));if(D[x.k])m.content=fill(D[x.k],x.n);});
  apply(document.body);imgs(document.body);
  new MutationObserver(function(ms){ms.forEach(function(m){if(m.type==='attributes')imgSrc(m.target);else m.addedNodes.forEach(imgs);});}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
  h.classList.remove('dd-tr-wait');
  var pending=[],timer=null;
  new MutationObserver(function(ms){if(busy)return;ms.forEach(function(m){
    if(m.type==='childList')m.addedNodes.forEach(function(n){pending.push(n.nodeType===3?n.parentElement||n:n);});
    else if(m.type==='characterData')pending.push(m.target.parentElement);
    else if(m.type==='attributes')pending.push(m.target);});
   if(!timer)timer=setTimeout(function(){timer=null;var p=pending;pending=[];p.forEach(function(n){if(n&&n.isConnected)apply(n);});},0);
  }).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});
 }
 DDLang.imgs=imgs;DDLang.apply=apply;DDLang.start=start;
 DDLang.set=function(l){if(!LANGS[l])return;try{localStorage.setItem('dd-lang',l);}catch(e){}var u=new URL(location.href);u.searchParams.delete('lang');if(l!=='en')u.searchParams.set('lang',l);location.href=u.toString();};
})();
/* loader and language menu */
(function(){
 var L=window.DDLang,LANGS=L.LANGS,cur=L.lang;
 function css(){var s=document.createElement('style');s.textContent=
  '.ddl{position:relative;display:inline-flex}'+
  '.ddlang{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(214,174,85,.55);background:rgba(214,174,85,.08);color:#f0d18a;border-radius:999px;padding:6px 12px;font:800 12.5px/1.2 Inter,"Noto Sans Devanagari","Noto Sans Gurmukhi","Nirmala UI",sans-serif;cursor:pointer;white-space:nowrap}'+
  '.ddlang:hover,.ddlang[aria-expanded="true"]{background:rgba(214,174,85,.2)}.ddlang .car{font-size:9px;opacity:.75}'+
  '.ddl-menu{position:absolute;right:0;top:calc(100% + 8px);min-width:150px;background:#071321;border:1px solid rgba(214,174,85,.45);border-radius:14px;padding:6px;box-shadow:0 18px 50px rgba(0,0,0,.55);z-index:10000;display:flex;flex-direction:column;gap:2px}'+
  '.ddl-menu[hidden]{display:none}'+
  '.ddl-menu button{all:unset;cursor:pointer;padding:9px 12px;border-radius:9px;color:#dce8f4;font:700 14px/1.3 Inter,"Noto Sans Devanagari","Noto Sans Gurmukhi","Nirmala UI",sans-serif;display:flex;justify-content:space-between;gap:12px}'+
  '.ddl-menu button:hover,.ddl-menu button:focus-visible{background:rgba(214,174,85,.15);color:#fff}.ddl-menu button[aria-current="true"]{color:#f0d18a}.ddl-menu button[aria-current="true"]:after{content:"✓"}'+
  'html.dd-tr body{word-break:normal;overflow-wrap:anywhere}html.dd-tr body *{letter-spacing:normal!important}'+
  '#navLinks .ddl{margin:0}.ddl-mob{display:none;margin-right:8px}'+
  '@media(max-width:900px){.ddl-mob{display:inline-flex}#navLinks .ddl{display:none!important}}'+
  '@media(min-width:901px) and (max-width:1500px){body[data-choice="ent"] #navLinks{gap:12px}}@media(min-width:901px) and (max-width:1120px){body[data-choice="ent"] #navLinks .ddl{display:none!important}}'+
  '.navin .ddl{margin-left:10px;flex:none}'+
  '.ddlang-foot{grid-column:1/-1;margin:14px 0 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.ddlang-foot span{color:#9fb0c3;font-size:13px;margin-right:4px}'+
  '.ddl-float{position:fixed;right:14px;bottom:14px;z-index:9990}';
  document.head.appendChild(s);}
 function menu(extra){
  var w=document.createElement('span');w.className='ddl'+(extra?' '+extra:'');w.setAttribute('translate','no');
  var b=document.createElement('button');b.type='button';b.className='ddlang';b.setAttribute('aria-haspopup','true');b.setAttribute('aria-expanded','false');
  b.setAttribute('aria-label','Language / भाषा / ਭਾਸ਼ਾ: '+LANGS[cur].label);
  b.innerHTML=(cur==='en'?'EN':LANGS[cur].label)+' <span class="car" aria-hidden="true">▾</span>';
  var m=document.createElement('span');m.className='ddl-menu';m.hidden=true;m.setAttribute('role','menu');
  Object.keys(LANGS).forEach(function(k){var o=document.createElement('button');o.type='button';o.setAttribute('role','menuitem');o.setAttribute('lang',k);o.setAttribute('aria-current',k===cur?'true':'false');o.textContent=LANGS[k].label;o.onclick=function(e){e.stopPropagation();if(k!==cur)L.set(k);else close();};m.appendChild(o);});
  function close(){m.hidden=true;b.setAttribute('aria-expanded','false');}
  b.onclick=function(e){e.stopPropagation();var open=m.hidden;document.querySelectorAll('.ddl-menu').forEach(function(x){x.hidden=true;});m.hidden=!open;b.setAttribute('aria-expanded',open?'true':'false');if(open){var f=m.querySelector('[aria-current="true"]');f&&f.focus();}};
  document.addEventListener('click',close);document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!m.hidden){close();b.focus();}});
  w.appendChild(b);w.appendChild(m);return w;
 }
 function place(){
  if(document.querySelector('.ddl'))return;
  var nl=document.getElementById('navLinks'),mb=document.getElementById('menuBtn'),ni=document.querySelector('.navin');
  if(nl){nl.appendChild(menu());if(mb&&mb.parentNode)mb.parentNode.insertBefore(menu('ddl-mob'),mb);}
  else if(ni){ni.appendChild(menu());}
  else{document.body.appendChild(menu('ddl-float'));}
  var ft=document.querySelector('footer');if(ft){var f=document.createElement('p');f.className='ddlang-foot';f.setAttribute('translate','no');
   var lab=document.createElement('span');lab.textContent='Language · भाषा · ਭਾਸ਼ਾ';f.appendChild(lab);
   Object.keys(LANGS).forEach(function(k){var a=document.createElement('button');a.type='button';a.className='ddlang';a.setAttribute('lang',k);a.textContent=LANGS[k].label;if(k===cur)a.setAttribute('aria-current','true');a.onclick=function(){if(k!==cur)L.set(k);};f.appendChild(a);});
   ft.appendChild(f);}
 }
 function ready(){css();place();
  if(cur==='en')return;
  var s=document.createElement('script');s.src=(window.DD_LANG_BASE||'')+LANGS[cur].file+'?v=3';s.onload=function(){L.start();};
  s.onerror=function(){document.documentElement.classList.remove('dd-tr-wait');};document.head.appendChild(s);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
