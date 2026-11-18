// Home page photo of the day. Draws from the same images/gallery/ manifest the
// yearbook uses, so a photo joins the rotation the moment it is committed.

const potdFigure = document.querySelector(".photo-of-the-day");
const potdImage = potdFigure.querySelector("img");
const potdCaption = potdFigure.querySelector("figcaption");

// every year in the manifest, flattened to one list of (year, file) pairs
function allPhotos(){
const gallery = window.GALLERY || {};
const photos = [];
for (const year of Object.keys(gallery)){
for (const file of gallery[year]) photos.push({ year: year, file: file });
}
return photos;
}

// FNV-1a, then an avalanche pass. The pick below compares whole hashes, so it
// leans on the high bits - and FNV alone leaves those barely stirred by the
// last few characters, which is the whole date. Without the finisher the same
// handful of filenames win day after day.
function hash(text){
let value = 2166136261;
for (let i = 0; i < text.length; i++){
value ^= text.charCodeAt(i);
value = Math.imul(value, 16777619);
}
value ^= value >>> 16;
value = Math.imul(value, 2246822507);
value ^= value >>> 13;
value = Math.imul(value, 3266489909);
value ^= value >>> 16;
return value >>> 0;
}

// Score every photo against today's date and keep the highest, so the pick is
// stable all day and the same for everyone - Math.random() would deal a new
// photo on every refresh. Seeding on the filename rather than a position in the
// list means adding photos leaves most days' picks alone, where an index would
// reshuffle the whole rotation.
function photoForDay(photos, date){
const day = date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();
let best = null;
let bestScore = -1;

for (const photo of photos){
const score = hash(photo.file + day);
if (score > bestScore){
bestScore = score;
best = photo;
}
}
return best;
}

function showPhotoOfTheDay(date){
const photo = photoForDay(allPhotos(), date);
if (!photo){
potdFigure.remove();
return false;
}

// a photo listed in a stale manifest may no longer be on disk
potdImage.onerror = function(){ potdFigure.remove(); };
potdImage.onload = function(){
cropToSubject(potdImage, photo.year + "/" + photo.file);
introPan(potdImage);
};
potdImage.alt = "a photo from " + photo.year;
potdImage.src = "images/gallery/" + photo.year + "/" + photo.file;
potdCaption.textContent = "photo of the day from " + photo.year;
return true;
}

// ---- crop to the subject ----------------------------------------------------
// The box is a fixed 4:3 and object-fit: cover fills it, so a photo of any
// other shape loses a strip off two sides. Left alone the browser takes that
// strip evenly from both, which beheads portraits and slices people off the
// edge of wide shots. Instead: score every pixel of a thumbnail for how likely
// it is to be the subject, slide a 4:3 window along the one axis that has room
// to move, and point object-position at the window that keeps the most.
// The box's size never changes - only which part of the photo shows in it.

// Hand-picked focus for any photo the scoring gets wrong, keyed "year/file",
// as an object-position value, e.g.  "2021/IMG_0042.jpg": "50% 20%"
const POTD_FOCUS = {
};

const CROP_SAMPLE = 120;    // longest side of the thumbnail that gets scored
const SKIN_WEIGHT = 1.8;    // faces and people are almost always the point
const EDGE_WEIGHT = 1.0;    // detail and texture over flat sky, wall, table
const SAT_WEIGHT = 0.5;     // colour over grey
const EDGE_FALLOFF = 0.35;  // how far a window's own edges count for less

// how skin-like a colour is, 0..1. Judged on chroma alone (YCbCr's Cb and
// Cr), which is where skin of every tone clusters - brightness is what varies
// from one person to the next, so it only gates out deep shadow and glare.
function skinScore(r, g, b){
const y = 0.299 * r + 0.587 * g + 0.114 * b;
if (y < 35 || y > 240) return 0;
const cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b;
const cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
const d = ((cb - 102) / 24) ** 2 + ((cr - 153) / 19) ** 2;
return Math.max(0, 1 - d);
}

// one importance value per thumbnail pixel
function importanceMap(img){
const scale = CROP_SAMPLE / Math.max(img.naturalWidth, img.naturalHeight);
const w = Math.max(1, Math.round(img.naturalWidth * scale));
const h = Math.max(1, Math.round(img.naturalHeight * scale));
const canvas = document.createElement("canvas");
canvas.width = w;
canvas.height = h;
const ctx = canvas.getContext("2d", { willReadFrequently: true });
ctx.drawImage(img, 0, 0, w, h);
const px = ctx.getImageData(0, 0, w, h).data;   // throws on a tainted canvas

const luma = new Float32Array(w * h);
for (let i = 0; i < w * h; i++){
luma[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
}

const map = new Float32Array(w * h);
for (let y = 0; y < h; y++){
for (let x = 0; x < w; x++){
const i = y * w + x;
const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
// edge: how far this pixel stands out from its four neighbours
const l = luma[i];
const edge = Math.abs(4 * l
- luma[y * w + Math.max(0, x - 1)] - luma[y * w + Math.min(w - 1, x + 1)]
- luma[Math.max(0, y - 1) * w + x] - luma[Math.min(h - 1, y + 1) * w + x]);
const max = Math.max(r, g, b), min = Math.min(r, g, b);
const sat = max ? (max - min) / max : 0;
map[i] = EDGE_WEIGHT * Math.min(1, edge * 4)
+ SAT_WEIGHT * sat * (l > 0.1 && l < 0.92 ? 1 : 0.3)
+ SKIN_WEIGHT * skinScore(r, g, b);
}
}
return { map: map, w: w, h: h };
}

// a window counts its own middle in full and its edges for less, so the
// subject lands comfortably inside the crop rather than pressed against a side
function windowWeight(t){
const fromEdge = Math.min(t, 1 - t);
return fromEdge >= EDGE_FALLOFF ? 1 : 0.35 + 0.65 * fromEdge / EDGE_FALLOFF;
}

// the best start for a window of `span` cells sliding along `profile`,
// returned as the 0..1 fraction object-position expects
function bestOffset(profile, span){
const room = profile.length - span;
if (room <= 0) return 0.5;
let best = room / 2, bestScore = -Infinity;
for (let start = 0; start <= room; start++){
let score = 0;
for (let k = 0; k < span; k++) score += profile[start + k] * windowWeight((k + 0.5) / span);
// a faint pull to the middle, so a photo with nothing to choose between
// still crops evenly
score *= 1 - 0.08 * Math.abs(start / room - 0.5);
if (score > bestScore){ bestScore = score; best = start; }
}
return best / room;
}

function cropToSubject(img, key){
if (POTD_FOCUS[key]){
img.style.objectPosition = POTD_FOCUS[key];
return;
}

const boxRatio = (img.clientWidth && img.clientHeight) ? img.clientWidth / img.clientHeight : 4 / 3;
const photoRatio = img.naturalWidth / img.naturalHeight;
if (!photoRatio || Math.abs(photoRatio - boxRatio) < 0.02) return;   // nothing is cut off

let scored;
try {
scored = importanceMap(img);
} catch (e){
return;   // opened from disk, where the canvas cannot be read: keep the centre crop
}
const { map, w, h } = scored;

if (photoRatio > boxRatio){
// wider than the box: slide left/right across column totals
const profile = new Float32Array(w);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) profile[x] += map[y * w + x];
const span = Math.round(h * boxRatio);
img.style.objectPosition = (bestOffset(profile, span) * 100).toFixed(1) + "% 50%";
} else {
// taller than the box: slide up/down across row totals
const profile = new Float32Array(h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) profile[y] += map[y * w + x];
const span = Math.round(w / boxRatio);
img.style.objectPosition = "50% " + (bestOffset(profile, span) * 100).toFixed(1) + "%";
}
}

// ---- arrival pan -------------------------------------------------------------
// On load the photo travels up to its top edge, down to its bottom edge, then
// settles back on its crop - a glance at everything the box is leaving out. A
// photo taller than the box scrolls through its real hidden strip. A wide one
// already fills the box top to bottom, so it has nothing to scroll to; it
// zooms in a touch to make room, and the zoom is gone again by the time it
// settles.

const PAN_MS = 2400;
const PAN_DELAY_MS = 250;
const PAN_MIN_ROOM = 12;   // px of hidden photo worth scrolling through rather than zooming
const PAN_ZOOM = 1.1;      // how far a wide one zooms to make room

// keyframe offsets in proportion to the distance of each leg, so the photo
// moves at one steady speed rather than rushing the long middle stretch.
// each leg eases into its turn on its own
function evenLegs(frames, distances){
const total = distances.reduce(function(a, b){ return a + b; }, 0) || 1;
let run = 0;
return frames.map(function(frame, i){
if (i > 0) run += distances[i - 1];
frame.offset = run / total;
frame.easing = "ease-in-out";
return frame;
});
}

function introPan(img){
if (!img.animate) return;
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

const boxW = img.clientWidth, boxH = img.clientHeight;
if (!boxW || !boxH || !img.naturalWidth) return;
const room = boxW * img.naturalHeight / img.naturalWidth - boxH;   // hidden px, top + bottom
const timing = { duration: PAN_MS, delay: PAN_DELAY_MS };

if (room >= PAN_MIN_ROOM){
// object-position as a px offset: 0 shows the top, -room the bottom
const final = img.style.objectPosition || "50% 50%";
const [x, y = "50%"] = final.split(" ");
// a hand-set focus may be a keyword ("top") rather than a %; pan from the middle
const pct = /%$/.test(y) ? parseFloat(y) : 50;
const rest = -(pct / 100) * room;
const at = function(offset){ return x + " " + offset.toFixed(1) + "px"; };
img.animate(evenLegs([
{ objectPosition: at(rest) },
{ objectPosition: at(0) },
{ objectPosition: at(-room) },
{ objectPosition: at(rest) }
], [-rest, room, room + rest]), timing);
} else {
// the zoom leaves (PAN_ZOOM - 1) / 2 of spare height on each side; travel
// all of it, to the zoomed photo's own edges. translate is applied inside
// the scale, so divide back out
const shift = ((PAN_ZOOM - 1) / 2 / PAN_ZOOM * 100).toFixed(3) + "%";
const zoomed = "scale(" + PAN_ZOOM + ") translateY(";
img.animate(evenLegs([
{ transform: "none" },
{ transform: zoomed + shift + ")" },
{ transform: zoomed + "-" + shift + ")" },
{ transform: "none" }
], [1, 2, 1]), timing);
}
}

// ---- lightbox ---------------------------------------------------------------
// Click the photo for the whole frame, uncropped, centred over a dimmed page.
// Esc, the close button, or a click anywhere puts it away.

const potdOpen = potdFigure.querySelector(".potd-open");
const potdLightbox = document.querySelector(".potd-lightbox");

if (potdOpen && potdLightbox && potdLightbox.showModal){
const lightboxImage = potdLightbox.querySelector("img");
const lightboxCaption = potdLightbox.querySelector("figcaption");

potdOpen.addEventListener("click", function(){
lightboxImage.src = potdImage.currentSrc || potdImage.src;
lightboxImage.alt = potdImage.alt;
lightboxCaption.textContent = potdCaption.textContent;
potdLightbox.showModal();
});

potdLightbox.addEventListener("click", function(){ potdLightbox.close(); });
} else if (potdOpen){
// no <dialog> support: the photo stays a plain, unclickable picture
potdOpen.disabled = true;
potdOpen.style.cursor = "default";
}

// On desktop the photo sits in the left panel beside the work list. Stacked, it
// belongs at the very bottom, below the right panel and above the gradient
// footer - and that footer lives in a different container, so this cannot be
// done by reordering in CSS alone.
const potdDesktopSlot = document.querySelector(".left-columns");
const potdMobileAnchor = document.querySelector(".bottom-box");
const potdMobile = window.matchMedia("(max-width: 1160px)");

function placePhotoOfTheDay(){
if (potdMobile.matches) potdMobileAnchor.before(potdFigure);
else potdDesktopSlot.append(potdFigure);
}

if (showPhotoOfTheDay(new Date())){
placePhotoOfTheDay();
potdMobile.addEventListener("change", placePhotoOfTheDay);
}
