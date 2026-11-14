/* tilt-spill — the page's contents come loose and pile up, driven by whatever
   the device can actually sense.

   On a phone that is tilt: the pieces drift toward the low side as it leans
   and let go past a threshold. A laptop has no readable accelerometer, so
   there the trigger is shaking the cursor — the same gesture macOS uses to
   find a lost pointer. Shaking has no steady direction to lean toward, so the
   continuous build-up is a tremble instead: the harder you shake, the more the
   type shivers, until it comes apart.

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

  /* a shake is read as direction reversals of the cursor. each qualifying one
     bumps "agitation", which decays every frame -- so sustained shaking
     accumulates while a single flick fades. tuned so a vigorous shake fires in
     about 0.6s and a deliberate one in 1.5s, while one flick peaks at 0.27 and
     two casual reversals at 0.44, both well under the 1.0 trigger */
  var BUMP = 0.27;
  var DECAY = 0.985;
  var AGITATION_MAX = 2;
  var MIN_SPEED = 550;   /* px/sec at the turn */
  var MIN_TRAVEL = 25;   /* px since the last turn, so a jittery hand is not a shake */

  /* the tremble rides on top of the springs rather than through them: at ~9Hz
     it is far above their 1.5Hz natural frequency, so routing it through the
     spring would simply filter it away */
  var TREMBLE_PX = 4;
  var TREMBLE_RAD = 0.012;

  /* below this much agitation nothing moves at all. one fast flick of the
     cursor scores 0.27 and two casual reversals 0.44 -- both ordinary
     browsing, and both used to show a visible shiver. the tremble now only
     exists once a shake is genuinely under way, so the page is untouched the
     rest of the time */
  var TREMBLE_GATE = 0.5;

  /* once shaken apart, the pile sits for a beat and then reassembles itself --
     there is no "un-shake" the way un-tilting a phone puts things back */
  var DWELL_MS = 2200;

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
    still: 0,
    source: 'tilt',                /* tilt | shake */
    agitation: 0,
    spillAt: 0
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
        damp: 13 * vary(i + 19, 0.16),
        /* its own shiver frequency and phase, so the page does not buzz as one
           sheet -- around 9Hz, give or take a third */
        tf: 0.058 * vary(i + 31, 0.3),
        tp: i * 1.7,
        marked: false
      });
    }

    return pieces;
  }

  function write(p, jx, jy, jr) {
    /* every path that writes a transform marks the element, so springStep
       knows there is one to strip once the piece comes to rest */
    p.marked = true;
    p.el.style.transform =
      'translate3d(' + (p.x + (jx || 0)).toFixed(2) + 'px,' +
      (p.y + (jy || 0)).toFixed(2) + 'px,0) rotate(' +
      (p.r + (jr || 0)).toFixed(4) + 'rad)';
  }

  /* --- the loop -------------------------------------------------------- */

  function springStep(now) {
    var shaking = state.source === 'shake';
    var t = state.tilt;

    /* a shake has no steady direction, so there is nothing to lean toward --
       the springs rest at zero and the whole build-up is the tremble */
    var lean = shaking ? 0 : Math.max(-1, Math.min(1, t.roll / LEAN_REF));
    var sag = shaking ? 0 : Math.max(0, Math.min(1, Math.abs(t.pitch) / 90));
    var ag = state.agitation;
    /* remapped so the shiver starts from nothing at the gate rather than
       appearing already part-grown */
    var amp = ag > TREMBLE_GATE
      ? Math.min(1, (ag - TREMBLE_GATE) / (1 - TREMBLE_GATE))
      : 0;
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

      var jx = 0, jy = 0, jr = 0;
      if (amp > 0) {
        var a = amp * p.drift;
        jx = Math.sin(now * p.tf + p.tp) * TREMBLE_PX * a;
        jy = Math.cos(now * p.tf * 1.3 + p.tp) * TREMBLE_PX * 0.6 * a;
        jr = Math.sin(now * p.tf * 0.8 + p.tp) * TREMBLE_RAD * a;
      }

      moving = Math.max(moving, Math.abs(p.vx), Math.abs(p.vy), Math.abs(tx - p.x));

      /* strip the transform rather than writing an identity one. translate3d
         promotes the element to its own compositing layer, which rasterises
         text differently -- leaving one on would mean the page never quite
         looks untouched even when nothing is moving */
      if (!jx && !jy && !jr &&
          Math.abs(p.x) < 0.01 && Math.abs(p.y) < 0.01 && Math.abs(p.r) < 0.0005) {
        if (p.marked) {
          p.el.style.transform = '';
          p.marked = false;
        }
      } else {
        write(p, jx, jy, jr);
      }
    }

    if (ag > 0) state.agitation = ag > 0.002 ? ag * DECAY : 0;

    /* nothing is moving and nothing wants to: stop burning frames until the
       next shake or orientation event disturbs it */
    if (moving < 0.05 && state.agitation === 0) {
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
    if (state.source === 'shake') {
      /* nothing to lean toward: it simply falls, and the sideways scatter came
         from the impulse each piece was given at the moment it let go */
      engine.gravity.x = 0;
      engine.gravity.y = 1;
      if (state.agitation > 0) {
        state.agitation = state.agitation > 0.002 ? state.agitation * DECAY : 0;
      }
    } else {
      var lean = Math.max(-1, Math.min(1, t.roll / 50));
      engine.gravity.x = lean * 1.9;
      /* never let gravity point up the screen: things slide to the low side,
         they do not float */
      engine.gravity.y = Math.max(0.35, 1 - Math.abs(t.pitch) / 160);
    }

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
    var now = (window.performance && performance.now) ? performance.now() : Date.now();

    /* no "un-shake" exists the way un-tilting a phone puts things back, so the
       pile waits out a beat of calm and then reassembles on its own */
    /* restore() flips the mode to calm and the springs below pick the pieces
       up in the same frame. it must not return here: restore()'s own run() is
       a no-op while this loop is already running, so returning would schedule
       no next frame and leave everything frozen mid-fall */
    if (state.mode === 'spilled' && state.source === 'shake' &&
        now - state.spillAt > DWELL_MS && state.agitation < 0.2) {
      restore();
    }

    var alive = state.mode === 'spilled' ? physicsStep() : springStep(now);

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

  function spill(impulse) {
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

      /* the scrolling panels can hold list items well outside the viewport.
         those still tremble happily in flow, but giving one a body would pin
         it at a nonsense offscreen rect and rain it in from nowhere */
      var seen = p.el.getBoundingClientRect();
      if (seen.bottom < 0 || seen.top > window.innerHeight ||
          seen.right < 0 || seen.left > window.innerWidth) {
        p.body = null;
        continue;
      }

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
      /* the springs' own momentum, plus whatever the cursor was doing at the
         instant it broke -- that kick is what makes a shake scatter the type
         sideways instead of just dropping it */
      var kx = impulse ? impulse.x * p.drift : 0;
      var ky = impulse ? impulse.y * p.drift : 0;
      Matter.Body.setVelocity(body, { x: p.vx * DT + kx, y: p.vy * DT + ky });
      Matter.Body.setAngularVelocity(body, p.vr * DT + (impulse ? impulse.x * 0.004 : 0));

      p.body = body;
      Composite.add(engine.world, body);
    }

    Composite.add(engine.world, walls);

    state.engine = engine;
    state.mode = 'spilled';
    state.spillAt = (window.performance && performance.now) ? performance.now() : Date.now();
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

      /* only pieces that were actually pinned have a saved style to put back.
         calling removeAttribute on the others would strip an inline style this
         script never set */
      if (p.prevStyle !== undefined) {
        if (p.prevStyle === null) p.el.removeAttribute('style');
        else p.el.setAttribute('style', p.prevStyle);
        p.prevStyle = undefined;
      }

      write(p);
    }

    if (state.engine) {
      Matter.Composite.clear(state.engine.world, false);
      Matter.Engine.clear(state.engine);
      state.engine = null;
    }

    state.mode = 'calm';
    state.agitation = 0;
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

  /* --- shake input (laptops and desktops) ------------------------------ */

  /* a laptop has no accelerometer a browser can read -- Apple Silicon Macs
     keep theirs behind the undocumented SPU -- so the gesture stands in for
     the sensor. Shaking the cursor is already a thing people do on macOS to
     find a lost pointer, which makes it discoverable by accident and needs no
     button, no permission and no instructions */
  var ptr = { x: 0, y: 0, t: 0, dir: 0, run: 0, peak: 0, vx: 0, vy: 0, has: false };

  function onMove(e) {
    var now = (window.performance && performance.now) ? performance.now() : Date.now();

    if (!ptr.has) {
      ptr.x = e.clientX; ptr.y = e.clientY; ptr.t = now; ptr.has = true;
      return;
    }

    var dt = now - ptr.t;
    if (dt < 4) return;   /* coalesce the bursts browsers deliver per frame */

    var dx = e.clientX - ptr.x;
    var dy = e.clientY - ptr.y;
    var speed = Math.sqrt(dx * dx + dy * dy) / dt * 1000;

    ptr.vx = dx / dt * 1000;
    ptr.vy = dy / dt * 1000;
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.t = now;

    if (!dx) return;
    var dir = dx > 0 ? 1 : -1;

    if (dir === ptr.dir) {
      ptr.run += Math.abs(dx);
      ptr.peak = Math.max(ptr.peak, speed);
      return;
    }

    /* a turn only counts as part of a shake if the cursor was actually
       travelling and had covered some ground since the last one. without the
       distance test a hand resting unsteadily on the trackpad reads as a
       shake; without the speed test, slow browsing does.
       the speed that matters is the fastest point of the run that just ended,
       NOT the speed at the turn -- a turn is where a shake is momentarily
       slowest, so testing there rejects every gentle shake outright */
    if (ptr.dir && ptr.run > MIN_TRAVEL && Math.max(ptr.peak, speed) > MIN_SPEED) {
      /* measured on first use, not at arming: the photo of the day is still
         loading then, so it would measure 0x0 and be dropped from the spill */
      if (!state.pieces.length) state.pieces = collect();
      state.agitation = Math.min(AGITATION_MAX, state.agitation + BUMP);

      if (state.mode !== 'spilled' && state.agitation >= 1) {
        spill({ x: ptr.vx * 0.0016, y: ptr.vy * 0.0016 });
      } else {
        run();
      }
    }

    ptr.dir = dir;
    ptr.run = Math.abs(dx);
    ptr.peak = speed;
  }

  function listenShake() {
    state.source = 'shake';
    window.addEventListener('mousemove', onMove, { passive: true });
  }

  function arm() {
    /* a phone that can report its own tilt uses it; everything else with a
       real pointer gets the shake instead */
    if (!isPhone()) {
      if (window.matchMedia('(pointer: fine)').matches) listenShake();
      return;
    }

    var DOE = window.DeviceOrientationEvent;
    if (!DOE) return;

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

  /* console hooks and a ?spill= URL for working on the effect by hand */
  window.tiltSpill = {
    spill: spill,
    restore: restore,
    state: state,
    /* fake a shake from the console, for when there is no hand on the mouse */
    shake: function (n) {
      state.source = 'shake';
      if (!state.pieces.length) state.pieces = collect();
      state.agitation = Math.min(AGITATION_MAX, (n || 4) * BUMP);
      if (state.mode !== 'spilled' && state.agitation >= 1) spill({ x: 1.2, y: -0.4 });
      else run();
    },
    /* drive the whole thing by hand: tiltSpill.set(40) leans and then lets go */
    set: function (roll, pitch) {
      state.source = 'tilt';
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
