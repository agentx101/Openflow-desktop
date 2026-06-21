/* ============================================================
   OPENFLOW AI — landing interactions & animations
   ============================================================ */
(function(){
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── nav scrolled state ─────────────────────────────────── */
  var nav = document.getElementById('nav');
  function onScrollNav(){
    if(window.scrollY > 12) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  }
  onScrollNav();
  window.addEventListener('scroll', onScrollNav, {passive:true});

  /* ── scroll reveal (IO + scroll fallback, bulletproof) ──── */
  var revEls = [].slice.call(document.querySelectorAll('.reveal'));
  function showEl(el){ el.classList.add('in'); }
  function checkReveal(){
    var vh = window.innerHeight || document.documentElement.clientHeight;
    for(var i=revEls.length-1;i>=0;i--){
      var el = revEls[i];
      var r = el.getBoundingClientRect();
      if(r.top < vh * 0.92 && r.bottom > 0){ showEl(el); revEls.splice(i,1); }
    }
  }
  if('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ showEl(e.target); io.unobserve(e.target); } });
    }, {threshold:0.08});
    revEls.forEach(function(el){ io.observe(el); });
  }
  window.addEventListener('scroll', checkReveal, {passive:true});
  window.addEventListener('resize', checkReveal);
  window.addEventListener('load', checkReveal);
  checkReveal();

  /* ── animated counters ──────────────────────────────────── */
  function animateCount(el){
    var target = parseFloat(el.dataset.to);
    var dec = parseInt(el.dataset.dec || '0', 10);
    var dur = 1500, t0 = null;
    function ease(t){ return 1 - Math.pow(1 - t, 3); }
    function step(ts){
      if(!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      var v = target * ease(p);
      el.textContent = v.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      if(p < 1) requestAnimationFrame(step);
      else el.textContent = target.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    requestAnimationFrame(step);
  }
  var countEls = [].slice.call(document.querySelectorAll('[data-to]'));
  function fireCount(el){
    if(reduce){ el.textContent = parseFloat(el.dataset.to).toFixed(parseInt(el.dataset.dec||'0',10)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    else animateCount(el);
  }
  function checkCounters(){
    var vh = window.innerHeight || document.documentElement.clientHeight;
    for(var i=countEls.length-1;i>=0;i--){
      var r = countEls[i].getBoundingClientRect();
      if(r.top < vh * 0.9 && r.bottom > 0){ fireCount(countEls[i]); countEls.splice(i,1); }
    }
  }
  if('IntersectionObserver' in window){
    var cio = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){ fireCount(e.target); cio.unobserve(e.target);
          var ix = countEls.indexOf(e.target); if(ix>=0) countEls.splice(ix,1); }
      });
    }, {threshold:0.4});
    document.querySelectorAll('[data-to]').forEach(function(el){ cio.observe(el); });
  }
  window.addEventListener('scroll', checkCounters, {passive:true});
  window.addEventListener('load', checkCounters);
  checkCounters();

  /* ── parallax (rAF-throttled) ───────────────────────────── */
  var pxEls = [].slice.call(document.querySelectorAll('[data-px]'));
  var ticking = false;
  function applyParallax(){
    var vh = window.innerHeight;
    pxEls.forEach(function(el){
      var r = el.getBoundingClientRect();
      var center = r.top + r.height/2;
      var off = (center - vh/2) / vh;            // -1..1 around viewport center
      var speed = parseFloat(el.dataset.px);
      el.style.setProperty('--py', (off * speed * -60).toFixed(1) + 'px');
    });
    ticking = false;
  }
  function reqParallax(){ if(!ticking && !reduce){ ticking = true; requestAnimationFrame(applyParallax); } }
  if(!reduce){
    window.addEventListener('scroll', reqParallax, {passive:true});
    window.addEventListener('resize', reqParallax);
    applyParallax();
  }

  /* ── hero pointer parallax on the device + orbs ─────────── */
  var stage = document.querySelector('.hero-stage');
  if(stage && !reduce){
    stage.addEventListener('pointermove', function(e){
      var r = stage.getBoundingClientRect();
      var mx = (e.clientX - r.left)/r.width - .5;
      var my = (e.clientY - r.top)/r.height - .5;
      stage.style.setProperty('--mx', mx.toFixed(3));
      stage.style.setProperty('--my', my.toFixed(3));
    });
    stage.addEventListener('pointerleave', function(){
      stage.style.setProperty('--mx', 0); stage.style.setProperty('--my', 0);
    });
  }

  /* ── terminal typing effect ─────────────────────────────── */
  var term = document.getElementById('term-body');
  if(term){
    var lines = [
      {c:'pr', t:'$ '}, {c:'hl', t:'npx openflow init', nl:true},
      {c:'cm', t:'↳ scaffolding command center…', nl:true},
      {c:'ok', t:'✓ 3 agent brains connected  ·  Customer · Brand · Presentation', nl:true},
      {c:'pr', t:'$ '}, {c:'hl', t:'openflow run --brief', nl:true},
      {c:'cm', t:'↳ synthesising research → strategic brief…', nl:true},
      {c:'ok', t:'✓ brief ready  ·  4.0× ROAS target  ·  exported to /briefs', nl:true}
    ];
    var tHost = term;
    var li = 0, ci = 0, cur = null;
    function ensureLine(cls){
      cur = document.createElement('span'); cur.className = 'ln ' + cls; tHost.appendChild(cur);
    }
    function typeStart(){
      tHost.innerHTML = '';
      var cursor = document.createElement('span'); cursor.className='cursor';
      li = 0; ci = 0; cur = null; tHost.appendChild(cursor);
      tick(cursor);
    }
    function tick(cursor){
      if(li >= lines.length){ return; }
      var seg = lines[li];
      if(ci === 0){ ensureLine(seg.c); tHost.appendChild(cursor); }
      if(ci < seg.t.length){
        cur.textContent += seg.t[ci]; ci++;
        tHost.insertBefore(cursor, null);
        setTimeout(function(){ tick(cursor); }, 16 + Math.random()*26);
      } else {
        if(seg.nl){ tHost.insertBefore(document.createTextNode('\n'), cursor); }
        li++; ci = 0;
        setTimeout(function(){ tick(cursor); }, seg.nl ? 260 : 40);
      }
    }
    var tStarted = false;
    function startTerm(){ if(tStarted) return; tStarted = true; if(!reduce) typeStart(); }
    function checkTerm(){
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var r = term.closest('.term').getBoundingClientRect();
      if(r.top < vh * 0.8 && r.bottom > 0) startTerm();
    }
    if('IntersectionObserver' in window){
      var tio = new IntersectionObserver(function(es){
        es.forEach(function(e){ if(e.isIntersecting){ startTerm(); tio.unobserve(e.target); } });
      }, {threshold:0.4});
      tio.observe(term.closest('.term'));
    }
    window.addEventListener('scroll', checkTerm, {passive:true});
    window.addEventListener('load', checkTerm);
    checkTerm();
  }

  /* ── hero live pipeline simulation ──────────────────────── */
  (function(){
    var sim = document.getElementById('flowsim');
    if(!sim) return;
    var core   = document.getElementById('fsCore');
    var bell   = document.getElementById('fsBell');
    var badge  = document.getElementById('fsBadge');
    var countEl= document.getElementById('fsCount');

    var tkMark = '<svg class="tk" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M14.2 3.5c.2 2.5 1.7 4.1 4.1 4.3v2.7c-1.5.1-2.9-.4-4.1-1.3v5.9a5 5 0 11-5-5c.2 0 .4 0 .6.1v2.8a2.2 2.2 0 102 2.2V3.5z" fill="#26F4EE"/>'
      + '<path d="M13.4 3.5c.2 2.5 1.7 4.1 4.1 4.3v2.7c-1.5.1-2.9-.4-4.1-1.3v5.9a5 5 0 11-5-5c.2 0 .4 0 .6.1v2.8a2.2 2.2 0 102 2.2V3.5z" fill="#fff" opacity=".92"/></svg>';

    var redditGlyph = '<svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<circle cx="12" cy="13.4" r="6.4" fill="#fff"/>'
      + '<circle cx="9.6" cy="13" r="1.15" fill="#FF4500"/><circle cx="14.4" cy="13" r="1.15" fill="#FF4500"/>'
      + '<path d="M9.3 15.6c1.7 1.3 3.7 1.3 5.4 0" stroke="#FF4500" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
      + '<circle cx="17.4" cy="6.3" r="1.7" fill="#fff"/><path d="M12.1 7l4.6-.9" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/></svg>';
    var amazonGlyph = '<svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<text x="12" y="13.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="12" fill="#fff">a</text>'
      + '<path d="M5.2 16.4c4.4 2.6 9.2 2.6 13.6 0" stroke="#FF9900" stroke-width="1.7" fill="none" stroke-linecap="round"/>'
      + '<path d="M16.6 15.4l2.2 1-.9 2.1" stroke="#FF9900" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    var icStar  = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.5 6.8 19.2l1-5.8L3.6 9.3l5.8-.8z" fill="currentColor"/></svg>';
    var icMsg   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 11.5A8.5 8.5 0 117 19l-4 1 1.3-3.6A8.5 8.5 0 0121 11.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var icClip  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="6" y="4.5" width="12" height="15.5" rx="2.2"/><path d="M9 4.5h6v2.6H9z" fill="currentColor" stroke="none"/><path d="M9 11h6M9 14.6h4" stroke-linecap="round"/></svg>';
    var icPlay  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3.5" y="6" width="17" height="12" rx="3"/><path d="M11 9.5l3.5 2.5-3.5 2.5z" fill="currentColor" stroke="none"/></svg>';

    var inputs = [
      {cls:'reddit',                 svg:redditGlyph, t:'Reddit',     s:'r/SkincareAddiction'},
      {cls:'amazon',                 svg:amazonGlyph, t:'Amazon',     s:'4,812 reviews'},
      {cls:'tint', c:'#F5A623',      svg:icStar,      t:'Reviews',    s:'Yotpo · 1,204'},
      {cls:'tint', c:'#2D6BE0',      svg:icMsg,       t:'Support',    s:'Gorgias · 89 tickets'},
      {cls:'reddit',                 svg:redditGlyph, t:'Reddit',     s:'r/30PlusSkinCare'},
      {cls:'tint', c:'#10B981',      svg:icClip,      t:'Survey',     s:'Typeform · 312 replies'},
      {cls:'amazon',                 svg:amazonGlyph, t:'Amazon',     s:'verified Q&A'},
      {cls:'tint', c:'#26F4EE',      svg:icPlay,      t:'TikTok',     s:'540 new comments'},
      {cls:'tint', c:'#F5A623',      svg:icStar,      t:'Reviews',    s:'Trustpilot · 4.6★'},
      {cls:'tint', c:'#2D6BE0',      svg:icMsg,       t:'DMs',        s:'182 saved replies'}
    ];
    var reels = [
      {v:'1.2M', l:'84k'}, {v:'642k', l:'51k'}, {v:'2.1M', l:'120k'},
      {v:'318k', l:'27k'}, {v:'904k', l:'73k'}, {v:'1.6M', l:'98k'}
    ];

    // varied notifications, each routed to a brain (a=Customer, b=Presentation, c=Brand)
    var icPersona = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 19a6.5 6.5 0 0113 0" stroke-linecap="round"/></svg>';
    var icComment = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 11.5A8.5 8.5 0 117 19l-4 1 1.3-3.6A8.5 8.5 0 0121 11.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var icChart   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 20V11M9.3 20V5M14.6 20v-6M20 20V8"/></svg>';
    var icHook    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v7a4 4 0 11-4-4"/><circle cx="12" cy="3.4" r="1.4" fill="currentColor" stroke="none"/></svg>';
    var notifs = [
      {key:'a', col:'#A855F7', to:'Customer', cls:'',   ic:icPersona, t:'New persona identified', s:'Budget-conscious Gen Z'},
      {key:'b', col:'#D9B061', to:'Present',  cls:'av', ic:'AB',      t:'6 new hooks added',       s:'by Alysha Boehm'},
      {key:'c', col:'#10B981', to:'Brand',    cls:'',   ic:icChart,   t:'Analytics report ready',  s:'Weekly ROAS · +18%'},
      {key:'a', col:'#FF4500', to:'Customer', cls:'rc', ic:'__reddit',t:'Reddit post trending',    s:'r/SkincareAddiction'},
      {key:'a', col:'#A855F7', to:'Customer', cls:'',   ic:icComment, t:'12 new comments',         s:'on the Hydra Mist reel'},
      {key:'b', col:'#D9B061', to:'Present',  cls:'',   ic:icHook,    t:'Hook test complete',      s:'4.2s avg hold'}
    ];

    var ii=0, ri=0, ships=0, notif=3;

    /* ── three-brain interaction graph ── */
    var token = document.getElementById('fsToken');
    var convo = document.getElementById('fsConvo');
    var brainEl = {
      a: sim.querySelector('.fs-brain.b-a'),
      b: sim.querySelector('.fs-brain.b-b'),
      c: sim.querySelector('.fs-brain.b-c')
    };
    var names = { a:'Customer', b:'Present', c:'Brand' };
    var center = { a:[28,26], b:[166,26], c:[97,94] };
    var linkFor = function(x,y){
      var k = [x,y].sort().join('');
      return sim.querySelector('.gl-'+k);
    };
    var script = [
      ['a','c','trust gap surfaced'],
      ['c','b','keep it on-voice'],
      ['b','a','hook held 4.2s'],
      ['c','a','competitor edge'],
      ['a','b','top objection'],
      ['b','c','format split set']
    ];
    var si = 0, convoTimer = null;
    function exchange(){
      var step = script[si++ % script.length];
      var from = step[0], to = step[1], msg = step[2];
      var col = getComputedStyle(brainEl[from]).getPropertyValue('--bc').trim();
      // light the link
      var lk = linkFor(from, to);
      if(lk){ lk.classList.add('hot'); setTimeout(function(){ lk.classList.remove('hot'); }, 2400); }
      // sender speaks
      brainEl[from].classList.add('speaking');
      // caption
      convo.classList.add('swap');
      setTimeout(function(){
        convo.innerHTML = names[from] + '<span class="ar">→</span>' + names[to] + ' · ' + msg;
        convo.classList.remove('swap');
      }, 440);
      // token travels from -> to
      token.style.color = col;
      token.style.transition = 'none';
      token.style.left = center[from][0] + 'px';
      token.style.top  = center[from][1] + 'px';
      token.style.opacity = '0';
      void token.offsetWidth;
      token.style.transition = '';
      token.style.opacity = '1';
      token.style.left = center[to][0] + 'px';
      token.style.top  = center[to][1] + 'px';
      // arrival
      setTimeout(function(){
        brainEl[from].classList.remove('speaking');
        brainEl[to].classList.add('lit');
        token.style.opacity = '0';
        setTimeout(function(){ brainEl[to].classList.remove('lit'); }, 600);
      }, 1700);
    }
    function startConvo(){
      if(convoTimer) return;
      exchange();
      convoTimer = setInterval(exchange, 3400);
    }

    function corePulse(){
      core.classList.remove('pulse'); void core.offsetWidth; core.classList.add('pulse');
      setTimeout(function(){ core.classList.remove('pulse'); }, 600);
    }

    function spawnInput(){
      var d = inputs[ii++ % inputs.length];
      var cy = sim.clientHeight/2, cx = sim.clientWidth/2;
      var el = document.createElement('div');
      el.className = 'src-pill';
      el.style.top = (cy + (Math.random()*210 - 105)) + 'px';
      el.style.setProperty('--dx', (cx - 64) + 'px');
      el.innerHTML = '<span class="ico '+d.cls+'"'+(d.c?' style="--c:'+d.c+'"':'')+'>'+d.svg+'</span>'
        + '<span class="tx">'+d.t+'<small>'+d.s+'</small></span>';
      sim.appendChild(el);
      el.style.animation = 'srcIn 7.2s var(--ease) forwards';
      // arrives at the core ~70% through
      setTimeout(function(){ corePulse(); }, 5000);
      el.addEventListener('animationend', function(){ el.remove(); });
    }

    function spawnReel(){
      var d = reels[ri++ % reels.length];
      var cx = sim.clientWidth/2, cy = sim.clientHeight/2;
      var el = document.createElement('div');
      el.className = 'reel';
      el.style.left = cx + 'px'; el.style.top = cy + 'px';
      el.style.setProperty('--ox', 'calc(-50% + ' + (cx - 26) + 'px)');
      el.style.setProperty('--oy', 'calc(-50% - ' + (30 + Math.random()*120) + 'px)');
      el.innerHTML = '<div class="thumb">'+tkMark+'<span class="play"></span></div>'
        + '<div class="stat"><span><b>'+d.v+'</b> views</span><span>\u2665 '+d.l+'</span></div>';
      sim.appendChild(el);
      el.style.animation = 'reelOut 5.4s var(--ease) forwards';
      el.addEventListener('animationend', function(){ el.remove(); });
      // ship + count
      ships += 1; countEl.textContent = ships;
    }

    var ni = 0;
    function notify(){
      var existing = sim.querySelectorAll('.fs-toast').length;
      if(existing >= 2) return;
      var n = notifs[ni++ % notifs.length];
      var brain = brainEl[n.key];
      // bump unread badge + ring the bell
      notif += 1;
      badge.textContent = notif > 99 ? '99+' : notif;
      badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
      bell.classList.remove('ring'); void bell.offsetWidth; bell.classList.add('ring');
      // route to the respective brain
      if(brain){
        brain.classList.remove('recv'); void brain.offsetWidth; brain.classList.add('recv');
        setTimeout(function(){ brain.classList.remove('recv'); }, 2600);
      }
      // build toast
      var icoHtml = n.ic === '__reddit' ? redditGlyph : n.ic;
      var el = document.createElement('div');
      el.className = 'fs-toast';
      el.style.setProperty('--ac', n.col);
      el.style.top = (10 + existing*64) + 'px';
      el.innerHTML = '<span class="nt-ic '+n.cls+'">'+icoHtml+'</span>'
        + '<span class="nt-bd"><b>'+n.t+'</b><small>'+n.s+'</small></span>'
        + '<span class="nt-to">'+n.to+'</span>';
      sim.appendChild(el);
      requestAnimationFrame(function(){ el.classList.add('show'); });
      setTimeout(function(){
        el.classList.add('out');
        setTimeout(function(){ el.remove(); }, 420);
      }, 6000);
    }

    if(reduce){
      // static composed state
      countEl.textContent = '37'; badge.textContent = '12';
      convo.innerHTML = 'Customer<span class="ar">→</span>Brand · trust gap surfaced';
      brainEl.a.classList.add('speaking'); brainEl.c.classList.add('lit');
      var lk0 = linkFor('a','c'); if(lk0) lk0.classList.add('hot');
      token.style.color = '#A855F7'; token.style.transition = 'none';
      token.style.left = '62px'; token.style.top = '60px'; token.style.opacity = '1';
      var d0 = inputs[0], cy = 230, cx = 230;
      var p = document.createElement('div'); p.className='src-pill';
      p.style.top='150px'; p.style.left='6px';
      p.innerHTML = '<span class="ico '+d0.cls+'">'+d0.svg+'</span><span class="tx">'+d0.t+'<small>'+d0.s+'</small></span>';
      sim.appendChild(p);
      var r = document.createElement('div'); r.className='reel';
      r.style.left='auto'; r.style.right='6px'; r.style.top='110px'; r.style.transform='none';
      r.innerHTML = '<div class="thumb">'+tkMark+'<span class="play"></span></div><div class="stat"><span><b>1.2M</b> views</span><span>\u2665 84k</span></div>';
      sim.appendChild(r);
      var nt = document.createElement('div'); nt.className='fs-toast show';
      nt.style.setProperty('--ac','#A855F7'); nt.style.top='10px';
      nt.innerHTML = '<span class="nt-ic">'+icPersona+'</span>'
        + '<span class="nt-bd"><b>New persona identified</b><small>Budget-conscious Gen Z</small></span>'
        + '<span class="nt-to">Customer</span>';
      sim.appendChild(nt);
      brainEl.a.classList.add('recv');
      return;
    }

    function burstInputs(){
      spawnInput();
      if(Math.random() < 0.55) setTimeout(spawnInput, 960);
    }
    var started = false;
    function start(){
      if(started) return; started = true;
      startConvo();
      burstInputs();
      setTimeout(spawnReel, 3200);
      setTimeout(notify, 1800);
      setInterval(burstInputs, 2800);
      setTimeout(function(){ setInterval(spawnReel, 5200); }, 3200);
      setInterval(notify, 5200);
    }
    if('IntersectionObserver' in window){
      var fio = new IntersectionObserver(function(es){
        es.forEach(function(e){ if(e.isIntersecting){ start(); fio.disconnect(); } });
      }, {threshold:0.2});
      fio.observe(sim);
    } else { start(); }
  })();

  /* ── year ───────────────────────────────────────────────── */
  var y = document.getElementById('year'); if(y) y.textContent = new Date().getFullYear();
})();
