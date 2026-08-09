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
potdImage.alt = "a photo from " + photo.year;
potdImage.src = "images/gallery/" + photo.year + "/" + photo.file;
potdCaption.textContent = "photo of the day from " + photo.year;
return true;
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
