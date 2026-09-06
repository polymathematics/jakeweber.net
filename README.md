# jakeweber.net

Jake Weber's personal website. 2026 version. A simplified and trimmed back version of the 2024-2025 version. 

## Pages

| file | what it is |
|---|---|
| `index.html` | home |
| `consulting.html` | consulting |
| `blogroll.html` | people to follow |
| `yearbook.html` | year-by-year photos, books, desks, work, and journal |
| `membership/index.html` | membership, served at `/membership` |
| `projects/index.html` | projects, served at `/projects` |
| `essays/essays.html` | the writing archive — **generated**, see below |
| `essays/*.html` | one page per piece — **generated**, see below |

`styleNew.css` styles the whole site. `yearbook.css` and `yearbook.js` are loaded
only by the yearbook page, `photo-of-the-day.js` only by the home page.

## Membership

`/membership` is a directory with an `index.html` rather than a top-level
`membership.html`, so GitHub Pages serves it at the clean URL. Because it sits a
level down its stylesheet and home links are `../`-relative, not root-relative —
a leading `/` resolves to the disk root when the file is opened straight off
disk, and the page loses all its styling.

Unlike the rest of the site the membership page scrolls rather than fitting the
viewport, which is what `body class="membership"` turns on.

The tier "join" buttons are placeholders — they open a pre-addressed email. When
billing is wired up, those four `href`s are the only thing that needs to change.

## Photo of the day

The home page shows one photo from `images/gallery/`, any year, with the year in
its caption. Add a photo to the gallery and it joins the rotation — there's no
separate list to keep up.

The pick is seeded by the date, so it holds for the whole day and every visitor
sees the same one. Nothing is stored in the browser. It rotates at the visitor's
local midnight.

Note that `script.js` is deliberately *not* loaded on the home page: it redirects
mobile user agents to `mobile.html`, which doesn't exist here.

## Writing a post

Write one markdown file in `essays/posts/`. That's the whole job — the page,
its place in the archive, and the previous/next links at its foot are all built
from it.

    essays/posts/theinventors.md

    title: The Inventors
    deck: Looking for the ones who make their ideas real.
    date: 2023-10-24
    ---

    In the last year or so, I've tapped into a new network of people...

The header runs until the first line that is only dashes. `title` and `date`
(as `YYYY-MM-DD`) are required; `deck` is the subtitle under the headline and
can be left out. `dateline` overrides the printed date when it needs to say
something the date alone can't — `dateline: 3.19.24, updated on 05.04.24`.
`kicker` overrides the word above the headline, otherwise "writing".

**The filename is the URL.** `theinventors.md` is served at
`/essays/theinventors.html`, so renaming a file breaks every link anyone has
ever made to it.

The markdown is deliberately small: paragraphs, `##` and `###` subheads, `-`
and `1.` lists, `>` quotes, `[links](url)`, `**bold**`, `*italic*`, `---`
rules. Anything it can't do, write as HTML and it passes straight through —
which is how the photo rows and margin notes work:

    <div class="image-row">
      <img src="../images/firstIssue.jpg">
      <img src="../images/danHonCollab.jpg">
    </div>

    <p class="sidenote">A note out in the margin.</p>

A link to an outside site opens in a new tab on its own; an internal one
doesn't. Paths in raw HTML are `../`-relative, the same as everywhere under
`essays/`.

The archive page's own words — the paragraphs under "writing" and the
"elsewhere" list beside them — live in `essays/index.md`, lede first, then a
line of dashes, then the list.

Then commit. That's it.

**Never edit `essays/*.html`.** They're output, the same as `manifest.js`, and
the next commit overwrites whatever you put there. Every one of them says so on
its second line.

## Adding to the yearbook

**Photos** — drop them in `images/gallery/<year>/`. Create the folder if the year
is new. Any `.jpg`, `.jpeg`, `.png`, `.gif`, or `.webp` is picked up.

**Books** — one title per line in `books/<year>.md`. Blank lines, `#` headings,
and `-` / `*` / `1.` bullets are all fine; they get stripped.

**Desk photo** — `images/desks/<year>_desk.jpeg` (`.jpg`, `.png`, `.JPG`, and
`.webp` also work).

**Work** — one entry per line in `work/<year>.md`, four comma-separated fields:

    category, what happened, place, year

    invention, launch Cubicle, Austin, 2024

Same blank-line / `#` / bullet handling as the book lists. The tab groups
entries under their category, in this order: writing, invention, music, media.
A category that isn't one of those still works — it just lands after the ones
that are.

Only the first and last two commas are structural, so a description can
contain commas of its own (`~15,000 words written for Bad Rabbit, Austin, 2023`
parses the way you'd want).

**Other** — the "other" tab is the journal. One paragraph per line in
`journal/<year>.md`, plain prose, no structure to it.

The trailing year is optional, and it's only *displayed* when it's a range —
`music, begin writing solo demos, Austin, 2020 - 2024`. Something that ran
across several years goes in each of those years' files, and the range is what
tells a reader why the same line shows up again in 2021.

Then commit. That's it — no other step.

## What gets built

Two things in this repo are generated rather than written, and the pre-commit
hook in `.githooks/` rebuilds both on every commit so neither can drift:

| built | from | by |
|---|---|---|
| `manifest.js` | `images/gallery/`, `books/`, `work/`, `journal/` | `make-manifest.sh` |
| `essays/*.html` | `essays/posts/*.md`, `essays/index.md` | `make-essays.py` |

Either can be run by hand at any time:

    ./make-manifest.sh
    ./make-essays.py

`make-essays.py` needs nothing but Python 3 — the markdown it understands is
small enough to carry with it, so there's nothing to install and nothing to
keep up to date.

## How the manifest works

Browsers can't list the contents of a directory, so `manifest.js` holds the list
of what's in `images/gallery/`, `books/`, `work/`, and `journal/`. It's generated by
`make-manifest.sh`, which runs automatically on every commit via the pre-commit
hook in `.githooks/`.

It also records each photo's pixel dimensions, read with `sips`. The gallery uses
those to reserve every tile at the right shape before the photo arrives, so the
columns don't jump around while a year loads. If that block ever comes up empty —
`sips` is macOS-only — the tiles fall back to a guessed shape and the grid still
works, it just shifts a little as photos land.

You should never edit `manifest.js` by hand. If it ever looks stale, run:

    ./make-manifest.sh

When the site is served over HTTP the book, work, and journal lists are read live
from the `.md` files and the manifest isn't consulted for them. The manifest is what
makes the page still work when it's opened straight off disk, where `fetch()` is
blocked.

### If you re-clone this repo

Hooks aren't copied by `git clone`. Turn the pre-commit hook back on with:

    git config core.hooksPath .githooks

## Local preview

Open `yearbook.html` directly and it works, but to exercise the same code paths
the live site uses, serve it:

    python3 -m http.server 8000

## Hosting

GitHub Pages, served at jakeweber.net. Pushing to `main` deploys.
