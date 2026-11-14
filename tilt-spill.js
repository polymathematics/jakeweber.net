/* tilt-spill — when the device tips past a threshold, the page's contents
   come loose and slide to the low side, piling up against the bottom corner.

   matter.js runs headless here: it is the physics solver only, never the
   renderer. Each piece of real content gets a rigid body, and every frame we
   copy that body's position and angle onto the actual DOM element as a
   transform. So what tumbles down the screen is the live text and the real
   photo, not a canvas drawing of them.

   Phones only. Tablets and convertibles carry the same gyroscope and pass
   every feature test a phone would, so the gate is the screen's short side
   rather than a capability check. Apple Silicon Macs keep their accelerometer
   behind the undocumented SPU with no public framework access, so no browser
   can read it there regardless — see spill()/restore() for manual testing. */
(function () {
  'use strict';

  /* one body per piece of content. deliberately no ancestor/descendant pairs
     in this list, or a parent would drag its children along by two rules at
     once */
  var SELECTORS = [
    '.site-header h1',
    '.member-badge',
    '.shimmer-squares',
    '.block h2',
    '.block p',
    '.block li',
    '.photo-of-the-day',
    '.shortcuts-footer',
    '.bottom-box'
  ].join(',');

  /* asymmetric on purpose: it takes a deliberate tip to break the page, and
     you have to bring it most of the way back before it reassembles. equal
     thresholds would strobe on and off while you held it at the edge */
  var TRIGGER_DEG = 32;
  var RELEASE_DEG = 18;

  var RESTORE_MS = 620;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var state = {
    spilled: false,
    engine: null,
    frame: null,
    pieces: [],
    walls: [],
    baseBeta: null,
    baseGamma: null,
    gravity: { x: 0, y: 1 }
  };

  /* --- capture ------------------------------------------------------- */

  function measure() {
    var nodes = document.querySelectorAll(SELECTORS);
    var pieces = [];

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var rect = el.getBoundingClientRect();

      /* skip anything collapsed, clipped away, or scrolled out of the
         overflow panels — a body at a stale offscreen rect would rain in
         from nowhere */
      if (rect.width < 2 || rect.height < 2) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;

      pieces.push({
        el: el,
        body: null,
        originX: rect.left + rect.width / 2,
        originY: rect.top + rect.height / 2,
        rect: rect,
        prevStyle: el.getAttribute('style')
      });
    }

    return pieces;
  }

  /* pinning each element at its measured rect is what lets the layout fall
     away while the bordered boxes stay put as empty vessels. position:fixed
     escapes the overflow:hidden panels, and nothing in this page's ancestry
     sets a transform or filter, so there is no containing block to trap them */
  function pin(piece) {
    var r = piece.rect;
    piece.el.style.position = 'fixed';
    piece.el.style.left = r.left + 'px';
    piece.el.style.top = r.top + 'px';
    piece.el.style.width = r.width + 'px';
    piece.el.style.height = r.height + 'px';
    piece.el.style.margin = '0';
    piece.el.style.zIndex = '40';
    piece.el.style.willChange = 'transform';
  }

  /* --- physics -------------------------------------------------------- */

  function buildWorld(pieces) {
    var Engine = Matter.Engine;
    var Bodies = Matter.Bodies;
    var Composite = Matter.Composite;

    var engine = Engine.create();
    engine.gravity.scale = 0.0014;

    var w = window.innerWidth;
    var h = window.innerHeight;
    var t = 200; /* thick walls: a fast body can tunnel straight through a
                    thin one between solver steps */

    var walls = [
      Bodies.rectangle(w / 2, h + t / 2, w + t * 2, t, { isStatic: true }),
      Bodies.rectangle(w / 2, -t / 2, w + t * 2, t, { isStatic: true }),
      Bodies.rectangle(-t / 2, h / 2, t, h + t * 2, { isStatic: true }),
      Bodies.rectangle(w + t / 2, h / 2, t, h + t * 2, { isStatic: true })
    ];

    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      p.body = Bodies.rectangle(p.originX, p.originY, p.rect.width, p.rect.height, {
        restitution: 0.12,   /* text should land, not bounce like a ball */
        friction: 0.35,
        frictionAir: 0.012,
        /* lines of text are wide and thin; left at true density they behave
           like steel beams and shove everything aside */
        density: 0.0009
      });
      Composite.add(engine.world, p.body);
    }

    Composite.add(engine.world, walls);

    state.walls = walls;
    return engine;
  }

  function step() {
    var engine = state.engine;
    if (!engine) return;

    engine.gravity.x = state.gravity.x;
    engine.gravity.y = state.gravity.y;

    Matter.Engine.update(engine, 1000 / 60);

    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];
      if (!p.body) continue;
      var dx = p.body.position.x - p.originX;
      var dy = p.body.position.y - p.originY;
      p.el.style.transform =
        'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px) rotate(' +
        p.body.angle.toFixed(4) + 'rad)';
    }

    state.frame = window.requestAnimationFrame(step);
  }

  /* --- spill / restore ------------------------------------------------ */

  function spill() {
    if (state.spilled || reduceMotion.matches) return;
    if (typeof Matter === 'undefined') return;

    var pieces = measure();
    if (!pieces.length) return;

    state.pieces = pieces;
    state.spilled = true;

    for (var i = 0; i < pieces.length; i++) pin(pieces[i]);

    document.body.classList.add('is-spilled');
    state.engine = buildWorld(pieces);
    state.frame = window.requestAnimationFrame(step);
  }

  function restore() {
    if (!state.spilled) return;
    state.spilled = false;

    if (state.frame) window.cancelAnimationFrame(state.frame);
    state.frame = null;

    if (state.engine) {
      Matter.Engine.clear(state.engine);
      Matter.Composite.clear(state.engine.world, false);
      state.engine = null;
    }

    /* glide home from wherever physics left things, then hand the elements
       back to normal layout once the transition has actually finished */
    var pieces = state.pieces;
    state.pieces = [];

    pieces.forEach(function (p) {
      p.el.style.willChange = '';
      p.el.style.transition = 'transform ' + RESTORE_MS + 'ms cubic-bezier(.22,.61,.36,1)';
      p.el.style.transform = 'translate(0px,0px) rotate(0rad)';
    });

    window.setTimeout(function () {
      pieces.forEach(function (p) {
        if (p.prevStyle === null) p.el.removeAttribute('style');
        else p.el.setAttribute('style', p.prevStyle);
      });
      document.body.classList.remove('is-spilled');
    }, RESTORE_MS + 40);
  }

  /* --- tilt input ------------------------------------------------------ */

  function onOrientation(e) {
    if (e.beta === null || e.gamma === null) return;

    /* a phone held for reading already sits around 45 degrees of beta, so an
       absolute threshold would fire the instant the page loaded. everything
       is measured against however the device was being held when it armed */
    if (state.baseBeta === null) {
      state.baseBeta = e.beta;
      state.baseGamma = e.gamma;
      return;
    }

    var roll = e.gamma - state.baseGamma;
    var pitch = e.beta - state.baseBeta;

    /* device axes are fixed to the chassis, screen axes are not. without
       folding in the screen angle, a landscape phone spills sideways when you
       tip it forwards */
    var a = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
    var cos = Math.cos(a);
    var sin = Math.sin(a);
    var screenRoll = roll * cos + pitch * sin;
    var screenPitch = pitch * cos - roll * sin;

    var lean = Math.max(-1, Math.min(1, screenRoll / 50));
    state.gravity.x = lean * 1.9;
    /* never let gravity point up the screen: things slide to the low side,
       they do not float */
    state.gravity.y = Math.max(0.35, 1 - Math.abs(screenPitch) / 160);

    var magnitude = Math.abs(screenRoll);

    if (!state.spilled && magnitude > TRIGGER_DEG) spill();
    else if (state.spilled && magnitude < RELEASE_DEG) restore();
  }

  function listen() {
    window.addEventListener('deviceorientation', onOrientation, false);
  }

  /* phones only, and no feature test can tell a phone from a tablet -- both
     carry the same gyroscope. the screen's short side is the honest signal:
     it does not change when the device rotates, where a width media query
     would, since a phone in landscape is around 844px wide and would read as
     a tablet. phones sit at 360-430, the smallest tablets at 600+ */
  function isPhone() {
    var s = window.screen || {};
    var shortSide = Math.min(s.width || 9999, s.height || 9999);
    return shortSide <= 500 && window.matchMedia('(pointer: coarse)').matches;
  }

  function arm() {
    var DOE = window.DeviceOrientationEvent;
    if (!DOE) return;
    if (!isPhone()) return;

    if (typeof DOE.requestPermission !== 'function') {
      /* android delivers orientation events unasked */
      listen();
      return;
    }

    /* iOS hands over nothing until requestPermission resolves granted, and
       that call is only honoured inside a user gesture. with no button to
       press, the first touch anywhere on the page has to be the gesture --
       so the system dialog arrives unannounced, and a decline cannot be
       retried without a reload. that is the cost of having no affordance */
    var ask = function () {
      document.removeEventListener('touchend', ask);
      document.removeEventListener('click', ask);
      DOE.requestPermission().then(function (res) {
        if (res === 'granted') listen();
      }).catch(function () {});
    };

    document.addEventListener('touchend', ask, { passive: true });
    document.addEventListener('click', ask);
  }

  /* Apple Silicon Macs cannot tilt at all, so leave a way in from the
     console and a ?spill= URL for working on the effect */
  window.tiltSpill = { spill: spill, restore: restore, state: state };

  if (/[?&]spill\b/.test(window.location.search)) {
    window.addEventListener('load', function () {
      state.gravity.x = 1.6;
      window.setTimeout(spill, 400);
    });
  }

  if (reduceMotion.matches) return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arm);
  } else {
    arm();
  }
})();
