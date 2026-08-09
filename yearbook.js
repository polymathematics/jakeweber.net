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
if (workSection.style.display !== "none") showWork(currentYear);
if (otherSection.style.display !== "none") showJournal(currentYear);
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
const workSection = panelContent.querySelector(".work");
const otherSection = panelContent.querySelector(".other");

// the desk photo is always <year>_desk, but the extension varies by year
const deskExtensions = ["jpeg", "jpg", "png", "JPG", "webp"];

let booksRequestId = 0;

// one entry per line - tolerate "- ", "* " and "1. " bullets
function bookTitle(line){
return line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim();
}

// Every list tab reads <folder>/<year>.md the same way: live over HTTP, and
// from the manifest.js copy when the page is opened straight off disk, where
// fetch cannot read local files.
async function loadYearLines(folder, year, fallback){
let text = null;

try {
const response = await fetch(folder + "/" + year + ".md");
if (response.ok) text = await response.text();
} catch (error) {
// Opened straight from disk. Fall back to manifest.js, like the gallery does.
}
if (text === null) return (fallback && fallback[year]) || [];

return text.split("\n").filter(line => !line.trim().startsWith("#")).map(bookTitle).filter(Boolean);
}

function emptyNote(section, message){
const empty = document.createElement("p");
empty.textContent = message;
section.replaceChildren(empty);
}

async function showBooks(year){
const id = ++booksRequestId;
const titles = await loadYearLines("books", year, window.BOOKS);
if (id !== booksRequestId) return; // a newer year was clicked while this was loading

if (titles.length === 0) return emptyNote(booksSection, "no books for " + year);

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

// the order categories are listed in; anything else falls in after these
const workCategories = ["writing", "invention", "music", "media"];

let workRequestId = 0;

// one entry per line in work/<year>.md:  category, what happened, place, year
// The year is optional and only shown when it is a range, like "2020 - 2024".
// Split from the outside in, so commas inside the description survive.
function workEntry(line){
const text = bookTitle(line); // strips a leading bullet, same as the book list
const firstComma = text.indexOf(",");
if (firstComma === -1) return { category: "", description: text, place: "", span: "" };

const category = text.slice(0, firstComma).trim().toLowerCase();
let rest = text.slice(firstComma + 1);
let span = "";
let place = "";

const year = rest.match(/,\s*(\d{4}(?:\s*[-–—]\s*\d{4})?)\s*$/);
if (year){
span = year[1].replace(/\s*[-–—]\s*/, " - ");
rest = rest.slice(0, year.index);
}

const lastComma = rest.lastIndexOf(",");
if (lastComma > 0){
place = rest.slice(lastComma + 1).trim();
rest = rest.slice(0, lastComma);
}

return { category: category, description: rest.trim(), place: place, span: span };
}

async function showWork(year){
const id = ++workRequestId;
const lines = await loadYearLines("work", year, window.WORK);
if (id !== workRequestId) return; // a newer year was clicked while this was loading

const entries = lines.map(workEntry);

if (entries.length === 0) return emptyNote(workSection, "no work logged for " + year);

const order = workCategories.slice();
for (const entry of entries){
if (!order.includes(entry.category)) order.push(entry.category);
}

const groups = [];
for (const category of order){
const inCategory = entries.filter(entry => entry.category === category);
if (inCategory.length === 0) continue;

const group = document.createElement("div");
group.className = "work-group";

const heading = document.createElement("h3");
heading.textContent = category;
group.appendChild(heading);

for (const entry of inCategory){
const p = document.createElement("p");
p.className = "work-entry";
p.textContent = entry.description;

// a range is worth showing since the entry repeats across those years
const meta = [entry.place, entry.span.includes("-") ? entry.span : ""].filter(Boolean).join(", ");
if (meta){
const span = document.createElement("span");
span.className = "work-meta";
span.textContent = " — " + meta;
p.appendChild(span);
}

group.appendChild(p);
}
groups.push(group);
}

workSection.replaceChildren(...groups);
}

let journalRequestId = 0;

// the "other" tab is the journal: one paragraph per line in journal/<year>.md
async function showJournal(year){
const id = ++journalRequestId;
const entries = await loadYearLines("journal", year, window.JOURNAL);
if (id !== journalRequestId) return; // a newer year was clicked while this was loading

if (entries.length === 0) return emptyNote(otherSection, "nothing else for " + year);

otherSection.replaceChildren(...entries.map(function(entry){
const p = document.createElement("p");
p.className = "journal-entry";
p.textContent = entry;
return p;
}));
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
if (name === "work") showWork(currentYear);
if (name === "other") showJournal(currentYear);
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
