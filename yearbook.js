const menu = document.querySelector(".year-menu");
const photoGallery = document.querySelector(".photo-gallery");
const galleryColumns = document.querySelector(".gallery-columns");

const imagePattern = /\.(jpe?g|png|gif|webp)$/i;
let requestId = 0;
let currentYear = null;

// below this width the whole page scrolls instead of the gallery - see yearbook.css
const mobile = window.matchMedia("(max-width: 1160px)");

function resetGalleryScroll(){
if (!mobile.matches){
photoGallery.scrollTop = 0;
return;
}
// only pull back up if we are already down inside the photos, so tapping a
// year from the top of the page does not skip past the left panel
const galleryTop = photoGallery.getBoundingClientRect().top + window.scrollY;
if (window.scrollY > galleryTop) window.scrollTo(0, galleryTop);
}

// Ask the server what is in the folder. Works when the page is served by
// something that lists directories, like `python3 -m http.server`.
async function listFromServer(year){
const response = await fetch("images/gallery/" + year + "/");
if (!response.ok) return null;
const html = await response.text();
const page = new DOMParser().parseFromString(html, "text/html");
const files = [];
for (const link of page.querySelectorAll("a")){
const name = decodeURIComponent(link.getAttribute("href") || "");
if (imagePattern.test(name) && !name.includes("/")) files.push(name);
}
return files;
}

async function listFiles(year){
try {
const files = await listFromServer(year);
if (files) return files;
} catch (error) {
// Opened straight from disk, or a host that does not list directories.
}
return (window.GALLERY && window.GALLERY[year]) || [];
}

async function showYear(year){
const id = ++requestId;
const yearChanged = currentYear !== String(year);
currentYear = String(year);
galleryColumns.innerHTML = "";
resetGalleryScroll();

for (const link of menu.querySelectorAll("a")){
link.classList.toggle("selected", link.textContent.trim() === String(year));
}

// keep the open panel tab in sync with the year
if (yearChanged){
if (deskSection.style.display !== "none") showDesk(currentYear);
if (booksSection.style.display !== "none") showBooks(currentYear);
}

const files = await listFiles(year);
if (id !== requestId) return; // a newer year was clicked while this was loading

if (files.length === 0){
const empty = document.createElement("p");
empty.textContent = "no photos for " + year;
galleryColumns.appendChild(empty);
return;
}

for (const file of files){
const img = document.createElement("img");
img.src = "images/gallery/" + year + "/" + file;
img.alt = year + " " + file.replace(/\.[^.]+$/, "");
galleryColumns.appendChild(img);
}
}

menu.addEventListener("click", function(event){
const link = event.target.closest("a");
if (!link) return;
showYear(link.textContent.trim());
});

// left panel content logic
const panelTabs = document.querySelector(".panel-labels");
const panelContent = document.querySelector(".panel-content");
const contentSections = panelContent.querySelectorAll("div");
const deskSection = panelContent.querySelector(".desk");
const booksSection = panelContent.querySelector(".books");

// the desk photo is always <year>_desk, but the extension varies by year
const deskExtensions = ["jpeg", "jpg", "png", "JPG", "webp"];

let booksRequestId = 0;

// one book per line in books/<year>.md - tolerate "- ", "* " and "1. " bullets
function bookTitle(line){
return line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim();
}

async function showBooks(year){
const id = ++booksRequestId;
let text = null;

try {
const response = await fetch("books/" + year + ".md");
if (response.ok) text = await response.text();
} catch (error) {
// Opened straight from disk, where fetch cannot read local files.
}
if (id !== booksRequestId) return; // a newer year was clicked while this was loading

// fall back to manifest.js, the same way the gallery does
const titles = text
? text.split("\n").filter(line => !line.trim().startsWith("#")).map(bookTitle).filter(Boolean)
: ((window.BOOKS && window.BOOKS[year]) || []);

if (titles.length === 0){
const empty = document.createElement("p");
empty.textContent = "no books for " + year;
booksSection.replaceChildren(empty);
return;
}

booksSection.replaceChildren(...titles.map(function(title){
const p = document.createElement("p");
p.textContent = title;
return p;
}));
}

function showDesk(year){
const img = document.createElement("img");
let attempt = 0;

img.alt = year + " desk";
img.onerror = function(){
attempt++;
if (attempt < deskExtensions.length){
img.src = "images/desks/" + year + "_desk." + deskExtensions[attempt];
return;
}
const empty = document.createElement("p");
empty.textContent = "no desk photo for " + year;
deskSection.replaceChildren(empty);
};
img.src = "images/desks/" + year + "_desk." + deskExtensions[0];

deskSection.replaceChildren(img);
}

function showSection(name){
for (const link of panelTabs.querySelectorAll("a")){
link.classList.toggle("selected", link.textContent.trim() === name);
}
for (const section of contentSections){
section.style.display = section.classList.contains(name) ? "" : "none";
}
if (name === "desk") showDesk(currentYear);
if (name === "books") showBooks(currentYear);
}

panelTabs.addEventListener("click", function(event){
const activeTab = event.target.closest("a");
if (!activeTab) return;
showSection(activeTab.textContent.trim());
});

// set the year first so the opening tab knows which year to load
currentYear = menu.querySelector("a").textContent.trim();
showSection(panelTabs.querySelector("a").textContent.trim());
showYear(currentYear);
