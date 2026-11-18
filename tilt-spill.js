/* shake-spill — shake the pointer, or scrub a finger back and forth across the
   screen, and the page's contents come loose and pile up at the bottom. Shake
   again and they climb back into place.

   One gesture on every device. The accelerometer is not involved: Apple
   Silicon Macs keep theirs behind the undocumented SPU with no public
   framework access, so no browser can read it there, and on a phone the tilt
   API costs an unexplained iOS permission dialog before it will report
   anything. A rapid back-and-forth works everywhere, needs no permission and
   no button, and is already what people do on macOS to find a lost cursor —
   so it is discoverable by accident.

   The build-up is a tremble: the harder you shake, the more the type shivers,
   until it lets go. Below a gate nothing moves at all, so ordinary browsing
   leaves the page completely still.

   matter.js is the solver only, never the renderer. Each piece of real content
   gets a rigid body and every frame the body's position and angle are copied
   onto the actual DOM element as a transform, so what tumbles is the live text
   and the real photo rather than a canvas drawing of them. Coming back, the
   same pieces are carried home by their own springs. */
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

  /* a shake is read as reversals of horizontal direction. each qualifying one
     bumps "agitation", which decays every frame -- so sustained shaking
     accumulates while a single flick fades.
     deliberately not very sensitive: seven or eight sustained reversals to
     fire. the decay has to stay slow enough that agitation plateaus well
     above 1 -- a faster one with this small a bump plateaus at 0.99 and the
     effect then never fires at all, however long you shake */
  var BUMP = 0.20;
  var DECAY = 0.990;
  var AGITATION_MAX = 2;

  /* horizontal speed only, never the 2D magnitude: a fast vertical scroll on a
     phone carries enough total speed to qualify, and the thumb always drifts
     sideways a little while it does */
  var MIN_SPEED = 750;   /* px/sec at the fastest point of the run */
  var MIN_TRAVEL = 45;   /* px since the last turn, so a jittery hand is not a shake */

  /* the tremble rides on top of the springs rather than through them: at ~9Hz
     it is far above their 1.5Hz natural frequency, so routing it through the
     spring would simply filter it away */
  var TREMBLE_PX = 4;
  var TREMBLE_RAD = 0.012;

  /* below this much agitation nothing moves at all. one fast flick scores 0.20
     and a couple of casual reversals little more -- both ordinary input, and
     both would otherwise show a visible shiver */
  var TREMBLE_GATE = 0.5;

  /* the pile stays scrambled until it is shaken again. the lockout covers the
     tail of the shake that broke it: a hand does not stop the instant the type
     lets go, and those last few reversals would otherwise count toward putting
     it straight back */
  var LOCKOUT_MS = 700;
  var SETTLED_FRAMES = 45;

  /* agitation holds instead of decaying for a moment after each reversal. a
     finger swiping repeatedly has to lift and land between strokes, and that
     pause used to be counted against you -- twelve separate swipes crept to
     0.99 and never fired, while the same motion without lifting fired in
     under a second. 120ms covers the reposition without loosening a continuous
     shake, which still needs its six reversals */
  var HOLD_MS = 120;

  var DT = 1 / 60;
  var SETTLE_FRAMES = 30;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var state = {
    mode: 'calm',       /* calm | spilled */
    running: false,
    pieces: [],
    engine: null,
    frame: null,
    still: 0,
    agitation: 0,
    spillAt: 0,
    lastBump: -1e9
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
        /* spring state, in px and radians relative to where layout put it.
           the springs rest at zero and exist to carry pieces home after a
           spill -- the shake itself is the tremble below */
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

  function fade(now) {
    if (state.agitation <= 0) return;
    if (now - state.lastBump < HOLD_MS) return;
    state.agitation = state.agitation > 0.002 ? state.agitation * DECAY : 0;
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
    var ag = state.agitation;
    /* remapped so the shiver starts from nothing at the gate rather than
       appearing already part-grown */
    var amp = ag > TREMBLE_GATE
      ? Math.min(1, (ag - TREMBLE_GATE) / (1 - TREMBLE_GATE))
      : 0;
    var moving = 0;

    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];

      /* homing toward zero: nothing pulls the layout off its mark any more,
         so this only has work to do on the way back from a spill */
      p.vx += (-p.x * p.stiff - p.vx * p.damp) * DT;
      p.vy += (-p.y * p.stiff - p.vy * p.damp) * DT;
      p.vr += (-p.r * p.stiff - p.vr * p.damp) * DT;

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

      moving = Math.max(moving, Math.abs(p.vx), Math.abs(p.vy), Math.abs(p.x));

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

    fade(now);

    /* nothing is moving and nothing wants to: stop burning frames until the
       next shake disturbs it */
    if (moving < 0.05 && state.agitation === 0) {
      if (++state.still > SETTLE_FRAMES) return false;
    } else {
      state.still = 0;
    }

    return true;
  }

  function physicsStep(now) {
    var engine = state.engine;
    if (!engine) return true;

    /* nothing to lean toward: it simply falls, and the sideways scatter came
       from the impulse each piece was given at the moment it let go */
    engine.gravity.x = 0;
    engine.gravity.y = 1;

    fade(now);

    Matter.Engine.update(engine, 1000 / 60);

    var moving = 0;

    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];
      if (!p.body) continue;
      p.x = p.body.position.x - p.originX;
      p.y = p.body.position.y - p.originY;
      p.r = p.body.angle;
      moving = Math.max(moving,
        Math.abs(p.body.velocity.x), Math.abs(p.body.velocity.y));
      write(p);
    }

    /* the pile waits to be shaken again rather than reassembling on a timer,
       so without this the loop would solve a settled pile forever. agitation
       has to be spent too, or sleeping would freeze a half-built shake in
       place and a few reversals much later would finish it */
    if (moving < 0.08 && state.agitation === 0) {
      if (++state.still > SETTLED_FRAMES) return false;
    } else {
      state.still = 0;
    }

    return true;
  }

  function tick() {
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    var alive = state.mode === 'spilled' ? physicsStep(now) : springStep(now);

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
     includes whatever the tremble had shifted it to. the layout falls away
     behind it while the bordered boxes stay as empty vessels */
  function pin(p) {
    var rect = p.el.getBoundingClientRect();
    var w = p.el.offsetWidth;
    var h = p.el.offsetHeight;

    /* rotation about the centre leaves the centre alone, so this is the
       untransformed origin even mid-tremble. offsetWidth over the bbox width
       for the same reason -- a rotated bbox is wider than the element */
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

      /* the springs' own momentum, plus whatever the pointer or finger was
         doing at the instant it broke -- that kick is what makes a shake
         scatter the type sideways instead of just dropping it.
         matter measures velocity per step, the springs in px per second --
         without the divide every piece would be flung sixty times too hard */
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
    state.agitation = 0;
    state.still = 0;
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

  /* --- the gesture ----------------------------------------------------- */

  var ptr = { x: 0, y: 0, t: 0, dir: 0, run: 0, peak: 0, vx: 0, vy: 0, has: false };

  /* one detector for pointer and finger alike: both arrive here as a position
     and a clock */
  function feed(x, y) {
    /* the photo lightbox covers the page; shaking over it should not spill
       what is hidden behind */
    if (document.querySelector('dialog[open]')) return;

    var now = (window.performance && performance.now) ? performance.now() : Date.now();

    if (!ptr.has) {
      ptr.x = x; ptr.y = y; ptr.t = now; ptr.has = true;
      return;
    }

    var dt = now - ptr.t;
    if (dt < 4) return;   /* coalesce the bursts browsers deliver per frame */

    var dx = x - ptr.x;
    var dy = y - ptr.y;
    var speed = Math.abs(dx) / dt * 1000;

    ptr.vx = dx / dt * 1000;
    ptr.vy = dy / dt * 1000;
    ptr.x = x; ptr.y = y; ptr.t = now;

    if (!dx) return;
    var dir = dx > 0 ? 1 : -1;

    if (dir === ptr.dir) {
      ptr.run += Math.abs(dx);
      ptr.peak = Math.max(ptr.peak, speed);
      return;
    }

    /* a turn only counts as part of a shake if the thing was actually
       travelling and had covered some ground since the last one. without the
       distance test a hand resting unsteadily reads as a shake; without the
       speed test, slow browsing does.
       the speed that matters is the fastest point of the run that just ended,
       NOT the speed at the turn -- a turn is where a shake is momentarily
       slowest, so testing there rejects every gentle shake outright */
    if (ptr.dir && ptr.run > MIN_TRAVEL && Math.max(ptr.peak, speed) > MIN_SPEED) {
      /* measured on first use, not at arming: the photo of the day is still
         loading then, so it would measure 0x0 and be dropped from the spill */
      if (!state.pieces.length) state.pieces = collect();

      /* ignore the tail of the shake that just broke the page, or it would go
         straight back together */
      var locked = state.mode === 'spilled' && now - state.spillAt < LOCKOUT_MS;

      if (!locked) {
        state.agitation = Math.min(AGITATION_MAX, state.agitation + BUMP);
        state.lastBump = now;

        if (state.agitation >= 1) {
          if (state.mode === 'spilled') restore();
          else spill({ x: ptr.vx * 0.0016, y: ptr.vy * 0.0016 });
        } else {
          run();
        }
      }
    }

    ptr.dir = dir;
    ptr.run = Math.abs(dx);
    ptr.peak = speed;
  }

  function onMouseMove(e) {
    feed(e.clientX, e.clientY);
  }

  function onTouchMove(e) {
    var t = e.touches[0];
    if (t) feed(t.clientX, t.clientY);
  }

  /* a finger leaving the glass and landing again must not read as one huge
     sideways jump, so position tracking restarts -- but the direction and the
     run it covered are kept. that is what lets a series of separate swipes
     count as a shake, rather than only one unbroken back-and-forth */
  function onTouchBreak() {
    ptr.has = false;
  }

  function arm() {
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchstart', onTouchBreak, { passive: true });
    window.addEventListener('touchend', onTouchBreak, { passive: true });
    window.addEventListener('touchcancel', onTouchBreak, { passive: true });
  }

  /* console hooks, for working on the effect by hand */
  window.tiltSpill = {
    spill: spill,
    restore: restore,
    state: state,
    /* fake a shake: tiltSpill.shake() breaks the page, again puts it back */
    shake: function (n) {
      if (!state.pieces.length) state.pieces = collect();
      state.agitation = Math.min(AGITATION_MAX, (n || 8) * BUMP);
      if (state.agitation >= 1) {
        if (state.mode === 'spilled') { state.spillAt = 0; restore(); }
        else spill({ x: 1.2, y: -0.4 });
      } else run();
    }
  };

  if (/[?&]spill\b/.test(window.location.search)) {
    window.addEventListener('load', function () {
      window.setTimeout(function () { window.tiltSpill.shake(); }, 400);
    });
  }

  if (reduceMotion.matches) return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arm);
  } else {
    arm();
  }
})();
