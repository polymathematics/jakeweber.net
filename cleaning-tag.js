// The "last updated" dry-cleaning tag in the home page header. The date comes
// from manifest.js, which the pre-commit hook regenerates on every commit.

(function(){
const tag = document.querySelector(".cleaning-tag");
if (!tag) return;

const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(window.LAST_UPDATED || "");
if (!match){
tag.remove();   // a manifest from before the date was recorded
return;
}

// read the parts directly rather than through new Date(), which would take
// the string as UTC midnight and show the day before for anyone west of it
const year = match[1], month = Number(match[2]), day = Number(match[3]);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

tag.querySelector(".ct-date").dateTime = window.LAST_UPDATED;
tag.querySelector(".ct-box").textContent = MONTHS[month - 1];
tag.querySelector(".ct-day").textContent = day;
tag.querySelector(".ct-year").textContent = "\u2019" + year.slice(2);
})();
