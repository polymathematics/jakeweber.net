/* tilt-spill — the page's contents answer the tilt of the phone continuously,
   drifting toward the low side as it leans and coming fully loose past a
   threshold, where they slide down and pile against the bottom corner.

   Two regimes share one loop. Under the threshold every piece is pulled by its
   own spring toward an offset derived from the tilt; past it, matter.js takes
   over as the solver. The handoff seeds each body with the position AND the
   velocity its spring already had, so the break is a continuation rather than
   a jump, and coming back runs the springs in reverse.

   matter.js is the solver only, never the renderer. Each piece of real content
   gets a rigid body and every frame the body's position and angle are copied
   onto the actual DOM element as a transform, so what tumbles is the live text
   and the real photo rather than a canvas drawing of them.

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

  /* how far a piece drifts, and how far it cants over, at the moment before
     everything lets go. small on purpose — this is the page breathing with
     the phone, not a preview of the spill */
  var LEAN_PX = 15;
  var LEAN_RAD = 0.022;
  var LEAN_REF = TRIGGER_DEG;

  /* the accelerometer is noisy enough that mapping it straight onto position
     visibly jitters while the phone is held still. a low-pass costs one
     multiply and removes essentially all of it */
  var SMOOTH = 0.12;

  var DT = 1 / 60;
  var SETTLE_FRAMES = 30;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var state = {
    mode: 'calm',       /* calm | spilled */
    running: false,
    pieces: [],
    engine: null,
    frame: null,
    tilt: { roll: 0, pitch: 0 },   /* smoothed, degrees from the held baseline */
    baseBeta: null,
    baseGamma: null,
    still: 0
  };

  /* --- the pieces ------------------------------------------------------ */

  /* a cheap deterministic hash, so every piece gets its own constants and the
     page keeps them across reloads. with one shared stiffness the whole
     layout moves as a single sheet, which is the thing that reads as fake */
  function vary(i, spread) {
    var h = Math.sin(i * 12.9898) * 43758.5453;
    return 1 + (h - Math.floor(h) - 0.5) * 2 * spread;
  }

  function collect() {
    var nodes = document.querySelectorAll(SELECTORS);
    var pieces = [];

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el.offsetWidth || !el.offsetHeight) continue;

      pieces.push({
        el: el,
        body: null,
        /* spring state, in px and radians relative to where layout put it */
        x: 0, y: 0, r: 0,
        vx: 0, vy: 0, vr: 0,
        /* a long line of text has more of itself hanging off the pivot than a
           heading does, so it swings further and slower */
        drift: vary(i, 0.35),
        stiff: 90 * vary(i + 7, 0.22),
        damp: 13 * vary(i + 19, 0.16)
      });
    }

    return pieces;
  }

  function write(p) {
    p.el.style.transform =
      'translate3d(' + p.x.toFixed(2) + 'px,' + p.y.toFixed(2) + 'px,0) rotate(' +
      p.r.toFixed(4) + 'rad)';
  }

  /* --- the loop -------------------------------------------------------- */

  function springStep() {
    var t = state.tilt;
    var lean = Math.max(-1, Math.min(1, t.roll / LEAN_REF));
    var sag = Math.max(0, Math.min(1, Math.abs(t.pitch) / 90));
    var moving = 0;

    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];

      var tx = lean * LEAN_PX * p.drift;
      var ty = sag * LEAN_PX * 0.4 * p.drift;
      var tr = lean * LEAN_RAD * p.drift;

      p.vx += ((tx - p.x) * p.stiff - p.vx * p.damp) * DT;
      p.vy += ((ty - p.y) * p.stiff - p.vy * p.damp) * DT;
      p.vr += ((tr - p.r) * p.stiff - p.vr * p.damp) * DT;

      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.r += p.vr * DT;

      moving = Math.max(moving, Math.abs(p.vx), Math.abs(p.vy), Math.abs(tx - p.x));
      write(p);
    }

    /* nothing is moving and nothing wants to: stop burning frames until the
       next orientation event disturbs it */
    if (moving < 0.05) {
      if (++state.still > SETTLE_FRAMES) return false;
    } else {
      state.still = 0;
    }

    return true;
  }

  function physicsStep() {
    var engine = state.engine;
    if (!engine) return true;

    var t = state.tilt;
    var lean = Math.max(-1, Math.min(1, t.roll / 50));
    engine.gravity.x = lean * 1.9;
    /* never let gravity point up the screen: things slide to the low side,
       they do not float */
    engine.gravity.y = Math.max(0.35, 1 - Math.abs(t.pitch) / 160);

    Matter.Engine.update(engine, 1000 / 60);

    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];
      if (!p.body) continue;
      p.x = p.body.position.x - p.originX;
      p.y = p.body.position.y - p.originY;
      p.r = p.body.angle;
      write(p);
    }

    return true;
  }

  function tick() {
    var alive = state.mode === 'spilled' ? physicsStep() : springStep();

    if (!alive) {
      state.running = false;
      state.frame = null;
      return;
    }

    state.frame = window.requestAnimationFrame(tick);
  }

  function run() {
    state.still = 0;
    if (state.running) return;
    state.running = true;
    state.frame = window.requestAnimationFrame(tick);
  }

  /* --- letting go ------------------------------------------------------ */

  /* the element is pinned at the rect it currently occupies, which already
     includes whatever the spring had drifted it to. the layout falls away
     behind it while the bordered boxes stay as empty vessels */
  function pin(p) {
    var rect = p.el.getBoundingClientRect();
    var w = p.el.offsetWidth;
    var h = p.el.offsetHeight;

    /* rotation about the centre leaves the centre alone, so this is the
       untransformed origin even mid-lean. offsetWidth over the bbox width for
       the same reason — a rotated bbox is wider than the element */
    p.originX = rect.left + rect.width / 2 - p.x;
    p.originY = rect.top + rect.height / 2 - p.y;
    p.w = w;
    p.h = h;

    p.prevStyle = p.el.getAttribute('style');
    p.el.style.position = 'fixed';
    p.el.style.left = (p.originX - w / 2) + 'px';
    p.el.style.top = (p.originY - h / 2) + 'px';
    p.el.style.width = w + 'px';
    p.el.style.height = h + 'px';
    p.el.style.margin = '0';
    p.el.style.zIndex = '40';
    p.el.style.willChange = 'transform';
  }

  function spill() {
    if (state.mode === 'spilled' || reduceMotion.matches) return;
    if (typeof Matter === 'undefined') return;
    if (!state.pieces.length) state.pieces = collect();
    if (!state.pieces.length) return;

    var Bodies = Matter.Bodies;
    var Composite = Matter.Composite;

    var engine = Matter.Engine.create();
    engine.gravity.scale = 0.0014;

    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var t = 200; /* thick walls: a fast body can tunnel straight through a
                    thin one between solver steps */

    var walls = [
      Bodies.rectangle(vw / 2, vh + t / 2, vw + t * 2, t, { isStatic: true }),
      Bodies.rectangle(vw / 2, -t / 2, vw + t * 2, t, { isStatic: true }),
      Bodies.rectangle(-t / 2, vh / 2, t, vh + t * 2, { isStatic: true }),
      Bodies.rectangle(vw + t / 2, vh / 2, t, vh + t * 2, { isStatic: true })
    ];

    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];
      pin(p);

      var body = Bodies.rectangle(p.originX + p.x, p.originY + p.y, p.w, p.h, {
        angle: p.r,
        restitution: 0.12,   /* text should land, not bounce like a ball */
        friction: 0.35,
        frictionAir: 0.012,
        /* lines of text are wide and thin; left at true density they behave
           like steel beams and shove everything aside */
        density: 0.0009
      });

      /* carry the spring's momentum across. matter measures velocity per
         step, the springs in px per second — without the divide every piece
         would be flung sixty times too hard at the moment of release */
      Matter.Body.setVelocity(body, { x: p.vx * DT, y: p.vy * DT });
      Matter.Body.setAngularVelocity(body, p.vr * DT);

      p.body = body;
      Composite.add(engine.world, body);
    }

    Composite.add(engine.world, walls);

    state.engine = engine;
    state.mode = 'spilled';
    document.body.classList.add('is-spilled');
    run();
  }

  function restore() {
    if (state.mode !== 'spilled') return;

    /* hand the springs the exact offset and momentum physics finished with,
       then unpin. they carry each piece home from wherever it landed, which
       is smoother than a transition and needs no timer to clean up after */
    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];

      if (p.body) {
        p.x = p.body.position.x - p.originX;
        p.y = p.body.position.y - p.originY;
        p.r = p.body.angle;
        p.vx = p.body.velocity.x / DT;
        p.vy = p.body.velocity.y / DT;
        p.vr = p.body.angularVelocity / DT;
        p.body = null;
      }

      if (p.prevStyle === null || p.prevStyle === undefined) p.el.removeAttribute('style');
      else p.el.setAttribute('style', p.prevStyle);

      write(p);
    }

    if (state.engine) {
      Matter.Composite.clear(state.engine.world, false);
      Matter.Engine.clear(state.engine);
      state.engine = null;
    }

    state.mode = 'calm';
    document.body.classList.remove('is-spilled');
    run();
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
      state.pieces = collect();
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

    var targetRoll = roll * cos + pitch * sin;
    var targetPitch = pitch * cos - roll * sin;

    state.tilt.roll += (targetRoll - state.tilt.roll) * SMOOTH;
    state.tilt.pitch += (targetPitch - state.tilt.pitch) * SMOOTH;

    var magnitude = Math.abs(state.tilt.roll);

    if (state.mode !== 'spilled' && magnitude > TRIGGER_DEG) spill();
    else if (state.mode === 'spilled' && magnitude < RELEASE_DEG) restore();
    else run();
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
  window.tiltSpill = {
    spill: spill,
    restore: restore,
    state: state,
    /* drive the whole thing by hand: tiltSpill.set(40) leans and then lets go */
    set: function (roll, pitch) {
      if (!state.pieces.length) state.pieces = collect();
      state.tilt.roll = roll;
      state.tilt.pitch = pitch || 0;
      if (state.mode !== 'spilled' && Math.abs(roll) > TRIGGER_DEG) spill();
      else if (state.mode === 'spilled' && Math.abs(roll) < RELEASE_DEG) restore();
      else run();
    }
  };

  if (/[?&]spill\b/.test(window.location.search)) {
    window.addEventListener('load', function () {
      window.setTimeout(function () { window.tiltSpill.set(45); }, 400);
    });
  }

  if (reduceMotion.matches) return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arm);
  } else {
    arm();
  }
})();
