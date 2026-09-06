#!/usr/bin/env python3
"""Regenerates every page under essays/ from the markdown in essays/posts/.

One .md file is one piece. This writes essays/<slug>.html for each of them and
rebuilds essays/essays.html, the archive index. The .html files are output, the
way manifest.js is - never edit them by hand, the next commit will overwrite it.

Run it after writing or editing a post:  ./make-essays.py
Or let the pre-commit hook in .githooks/ run it for you, which it does on every
commit.

A post looks like this - the header runs until the first line that is only
dashes, and everything after it is the piece:

    title: The Inventors
    deck: Looking for the ones who make their ideas real.
    date: 2023-10-24
    ---

    In the last year or so, I've tapped into a new network of people...

title and date are required. deck is the subtitle under the headline and can be
left out. dateline overrides the printed date when it needs to say something
the date alone can't ("3.19.24, updated on 05.04.24"). kicker overrides the
word above the headline, which is otherwise "writing".

The filename is the URL: theinventors.md is served at /essays/theinventors.html,
so renaming a file breaks every link anyone has ever made to it.

Markdown here is deliberately small - paragraphs, ## and ### subheads, - and 1.
lists, > quotes, [links](url), **bold**, *italic*, --- rules. Anything it can't
do, write as HTML and it passes through untouched, which is how the photo rows
and margin notes work.
"""

import html as html_mod
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
POSTS = os.path.join(ROOT, "essays", "posts")
OUT = os.path.join(ROOT, "essays")
# the archive page's own words: the paragraphs under "writing", then a line of
# dashes, then the "elsewhere" list
INTRO = os.path.join(OUT, "index.md")

VOID = {"img", "br", "hr", "input", "meta", "link", "source", "col"}

# a list marker, with or without anything after it - a bullet on its own is an
# empty item, which is a thing a few of the older pieces actually contain
BULLET = r"^\s*([-*+]|\d+\.)(?:[ \t]+|[ \t]*$)"

# one ![alt](src), and a line made of nothing but those
IMAGE = r"!\[([^\]]*)\]\(([^)\s]+)\)"
IMAGE_LINE = re.compile(r"^\s*(?:%s\s*)+$" % IMAGE)


# blocks that start a run of raw html rather than a paragraph that happens to
# open with a tag
BLOCK_TAGS = {
    "div", "p", "ul", "ol", "table", "figure", "blockquote", "pre", "section",
    "aside", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "img", "iframe", "video",
    "details", "dl",
}


# --------------------------------------------------------------------------
# markdown
# --------------------------------------------------------------------------

def asset(src):
    """Every page under essays/ is one directory down, so assets are ../ from
    here. Accept the path with or without that prefix, because forgetting it is
    the one mistake worth being forgiving about."""
    if src.startswith("/images/"):
        return ".." + src
    if src.startswith("images/"):
        return "../" + src
    return src


def img_tag(alt, src):
    return '<img src="%s" alt="%s">' % (asset(src), html_mod.escape(alt, quote=True))


def inline(text):
    """Spans. Raw html is left alone, so this must never escape anything."""
    # images before links, or ![alt](src) is read as a link with a stray !
    text = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)\)",
                  lambda m: img_tag(m.group(1), m.group(2)), text)
    # links: their bracketed text must not be read as emphasis markers.
    # an off-site link opens in a new tab, an internal one does not - which is
    # a decision the markup should not have to keep restating
    def link(m):
        label, href = m.group(1), m.group(2)
        if href.startswith(("http://", "https://")):
            return ('<a target="_blank" rel="noopener noreferrer" href="%s">%s</a>'
                    % (href, label))
        return '<a href="%s">%s</a>' % (href, label)

    text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, text)
    text = re.sub(r"\*\*(\S(?:[^*]*\S)?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![*\w])\*(\S(?:[^*]*\S)?)\*(?!\*)", r"<em>\1</em>", text)
    text = re.sub(r"(?<![`\w])`([^`]+)`", r"<code>\1</code>", text)
    return text


def opens_raw_html(line):
    m = re.match(r"<([a-zA-Z][a-zA-Z0-9]*)", line.strip())
    return bool(m) and m.group(1).lower() in BLOCK_TAGS


def take_raw_html(lines, i):
    """Consume one raw html block, balancing on the tag it opened with."""
    tag = re.match(r"<([a-zA-Z][a-zA-Z0-9]*)", lines[i].strip()).group(1).lower()
    buf = []
    depth = 0
    while i < len(lines):
        line = lines[i]
        buf.append(line)
        if tag not in VOID:
            depth += len(re.findall(r"<%s\b" % tag, line, re.I))
            depth -= len(re.findall(r"</%s\s*>" % tag, line, re.I))
        i += 1
        if depth <= 0 and (i >= len(lines) or not lines[i].strip()):
            break
    return "\n".join(buf), i


def to_html(md):
    """Blocks. Kept small on purpose; html is the escape hatch."""
    lines = md.replace("\r\n", "\n").split("\n")
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue

        if opens_raw_html(line):
            block, i = take_raw_html(lines, i)
            out.append(block)
            continue

        if re.match(r"^-{3,}\s*$", line) or re.match(r"^\*{3,}\s*$", line):
            out.append("<hr>")
            i += 1
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            level = len(m.group(1))
            out.append("<h%d>%s</h%d>" % (level, inline(m.group(2).strip()), level))
            i += 1
            continue

        # photographs. one on its own is a figure in the column; two or more
        # together are a plate, which is the grid the older pieces already use
        if IMAGE_LINE.match(line):
            shots = []
            while i < len(lines) and IMAGE_LINE.match(lines[i]):
                shots += re.findall(IMAGE, lines[i])
                i += 1
            if len(shots) == 1:
                out.append(img_tag(*shots[0]))
            else:
                out.append('<div class="image-row">\n%s\n</div>' % "\n".join(
                    "  " + img_tag(a, s) for a, s in shots))
            continue

        m = re.match(BULLET, line)
        if m:
            ordered = m.group(1).endswith(".")
            items = []
            while i < len(lines):
                m = re.match(BULLET + r"(.*)$", lines[i])
                if not m:
                    # a plain indented line continues the item above it
                    if items and lines[i].startswith(("  ", "\t")) and lines[i].strip():
                        items[-1] += " " + lines[i].strip()
                        i += 1
                        continue
                    break
                items.append(m.group(2).strip())
                i += 1
            tag = "ol" if ordered else "ul"
            out.append("<%s>\n%s\n</%s>" % (
                tag,
                "\n".join("  <li>%s</li>" % inline(it) for it in items),
                tag,
            ))
            continue

        if line.lstrip().startswith(">"):
            quoted = []
            while i < len(lines) and (lines[i].lstrip().startswith(">") or
                                      (quoted and lines[i].strip())):
                quoted.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            out.append("<blockquote>\n%s\n</blockquote>" % to_html("\n".join(quoted)))
            continue

        para = []
        while i < len(lines) and lines[i].strip() and not opens_raw_html(lines[i]) \
                and not re.match(r"^\s*(?:#{1,6}\s|>|-{3,}\s*$)", lines[i]) \
                and not re.match(BULLET, lines[i]) and not IMAGE_LINE.match(lines[i]):
            para.append(lines[i].strip())
            i += 1
        out.append("<p>%s</p>" % inline(" ".join(para)))

    return "\n\n".join(out)


# --------------------------------------------------------------------------
# posts
# --------------------------------------------------------------------------

def read_post(path):
    raw = open(path, encoding="utf-8").read().replace("\r\n", "\n")
    head, _, body = raw.partition("\n---\n")
    if not _:
        sys.exit("%s: no '---' line separating the header from the piece" % path)

    meta = {}
    key = None
    for line in head.split("\n"):
        if not line.strip():
            continue
        m = re.match(r"^([a-z]+):\s*(.*)$", line)
        if m:
            key = m.group(1)
            meta[key] = m.group(2).strip()
        elif key and line.startswith((" ", "\t")):
            meta[key] += " " + line.strip()          # wrapped value
        else:
            sys.exit("%s: can't read header line %r" % (path, line))

    slug = os.path.splitext(os.path.basename(path))[0]
    for required in ("title", "date"):
        if not meta.get(required):
            sys.exit("%s: missing '%s:'" % (path, required))
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", meta["date"]):
        sys.exit("%s: date must be YYYY-MM-DD, got %r" % (path, meta["date"]))

    y, m, d = meta["date"].split("-")
    meta.setdefault("dateline", "%d.%s.%s" % (int(m), d, y[2:]))
    meta.setdefault("kicker", "writing")
    meta.setdefault("deck", "")
    meta["slug"] = slug
    meta["year"] = int(y)
    meta["body"] = to_html(body.strip())
    return meta


# --------------------------------------------------------------------------
# pages
# --------------------------------------------------------------------------

# the two ink filters. url(#id) resolves against the current document and there
# is no build step to share one, so every page that uses a filter carries its
# own copy - index.html and membership/index.html have theirs too. this is the
# one that gets written 23 times, so it is the one to edit.
FILTERS = """  <!-- ink-bleed filters for the ink-set headings. two passes: high-frequency
       noise nudges the outline the way ink creeps along paper fibres, then a
       second noise is quantised into hard steps and multiplied into the alpha,
       so coverage either takes or it doesn't - newsprint grain rather than a
       smooth wash. copies of the filter in index.html; keep them in sync -->
  <svg width="0" height="0" aria-hidden="true" focusable="false"
    style="position:absolute;width:0;height:0;overflow:hidden">
    <filter id="ink-bleed" x="-15%" y="-15%" width="130%" height="130%"
      color-interpolation-filters="sRGB">
      <!-- letter-scale jitter. one noise cell is about one glyph wide at 18px,
           so neighbouring letters get different offsets and each sits a hair
           off the line - loose type rather than a wave -->
      <feTurbulence type="fractalNoise" baseFrequency="0.075" numOctaves="1" seed="31" result="loose" />
      <feDisplacementMap in="SourceGraphic" in2="loose" scale="1.4"
        xChannelSelector="R" yChannelSelector="G" result="shifted" />

      <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="6" result="fibre" />
      <feDisplacementMap in="shifted" in2="fibre" scale="0.7"
        xChannelSelector="R" yChannelSelector="G" result="bled" />

      <!-- turbulence, not fractalNoise: more contrast, less cloud -->
      <feTurbulence type="turbulence" baseFrequency="0.95" numOctaves="1" seed="23" result="speck" />
      <!-- discrete steps are what kill the watercolour look: no smooth ramp
           between covered and not, just a handful of coverage levels -->
      <feComponentTransfer in="speck" result="grain">
        <feFuncA type="discrete" tableValues="0.8 1 0.92 1 0.86 1 0.97" />
      </feComponentTransfer>
      <feComposite in="bled" in2="grain" operator="in" />
    </filter>

    <!-- the headline version. only two numbers move: the jitter noise drops to
         a cell about as wide as a 44px glyph, and the displacement grows with
         it, so a headline gets the same loose-type effect a subhead does
         rather than a ripple running through each letter. the fibre and grain
         passes are left alone on purpose - paper does not get coarser because
         the type got bigger -->
    <filter id="ink-bleed-display" x="-15%" y="-15%" width="130%" height="130%"
      color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.032" numOctaves="1" seed="31" result="loose" />
      <feDisplacementMap in="SourceGraphic" in2="loose" scale="2.6"
        xChannelSelector="R" yChannelSelector="G" result="shifted" />

      <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="6" result="fibre" />
      <feDisplacementMap in="shifted" in2="fibre" scale="0.7"
        xChannelSelector="R" yChannelSelector="G" result="bled" />

      <feTurbulence type="turbulence" baseFrequency="0.95" numOctaves="1" seed="23" result="speck" />
      <feComponentTransfer in="speck" result="grain">
        <feFuncA type="discrete" tableValues="0.8 1 0.92 1 0.86 1 0.97" />
      </feComponentTransfer>
      <feComposite in="bled" in2="grain" operator="in" />
    </filter>
  </svg>"""

SUBSTACK = [
    ("https://readpolymathematics.substack.com/p/what-i-ought-to-be-doing-planting",
     "what I ought to be doing: planting and growing"),
    ("https://readpolymathematics.substack.com/p/how-we-learn-cities", "how we learn cities"),
    ("https://readpolymathematics.substack.com/p/polymathematics-in-one-breath",
     "polymathematics in one breath"),
    ("https://readpolymathematics.substack.com/p/this-blog-will-last-a-lifetime",
     "this blog will last a lifetime"),
    ("https://readpolymathematics.substack.com/p/pair-programming-with-artificial",
     "pair programming with artificial intelligence"),
    ("https://polymathematics.blog/2018/10/12/digital-infants/", "digital infants"),
]

HCB = """<script type="text/javascript" id="hcb"> /*<!--*/ if(!window.hcb_user){hcb_user={};} (function(){var s=document.createElement("script"), l=hcb_user.PAGE || (""+window.location).replace(/'/g,"%27"), h="https://www.htmlcommentbox.com";s.setAttribute("type","text/javascript");s.setAttribute("src", h+"/jread?page="+encodeURIComponent(l).replace("+","%2B")+"&mod=%241%24wq1rdBcg%24j5aby.paqw7Za7hNARXjh1"+"&opts=16798&num=10&ts=1698346692708");if (typeof s!="undefined") document.getElementsByTagName("head")[0].appendChild(s);})(); /*-->*/ </script>"""

ESSAY = """<!DOCTYPE html>
<!-- Generated by make-essays.py from essays/posts/<slug>.md - do not edit by hand.
     Anything you change here is overwritten on the next commit. -->
<html>

<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <meta name="description" content="{desc}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{title_attr} — jake weber">
  <meta name="twitter:description" content="{desc}">
  <meta name="twitter:image" content="/images/preview.png">
  <meta property="og:image" content="/images/preview.png">
  <link rel="shortcut icon" type="image/x-icon" href="../images/shortcut.png">
  <title>{title_attr} — jake weber</title>
  <link rel="stylesheet" href="../styleNew.css" />
</head>

<body class="essay">
  <main class="page">
    <header class="site-header">
      <h1><a href="../index.html" style="color: inherit; text-decoration: none;">jake <span>weber</span></a></h1>
      <a class="member-badge" href="../membership/index.html">join the membership</a>
    </header>

    <div class="essay-layout">

      <div class="essay-sheet box">
        <aside class="essay-rail">
          <p class="rail-label">index</p>
          <nav class="rail-nav">
            <a href="essays.html">all writing</a>
            <a href="../index.html">home</a>
            <a target="_blank" rel="noopener noreferrer"
              href="https://readpolymathematics.substack.com/">substack</a>
            <a href="../membership/index.html">membership</a>
          </nav>
        </aside>

        <article class="essay-article">
          <header class="essay-head">
            <p class="essay-kicker">{kicker}</p>
            <h2 class="essay-title">{title}</h2>
{deck_block}            <p class="essay-dateline"><span>published on {dateline}</span><span>jake weber</span></p>
          </header>

          <div class="essay-body">
{body}
          </div>
        </article>
      </div>

      <div class="essay-foot box">
        <section class="essay-continue">
          <h2>keep reading</h2>
          <ul class="continue">
{continue_block}          </ul>
        </section>

        <section class="essay-elsewhere">
          <h2>from the substack</h2>
          <ul class="strands">
{substack_block}          </ul>
        </section>
      </div>

      <div class="essay-comments box">
        <h2>comments</h2>
        <div id="HCB_comment_box"><a href="http://www.htmlcommentbox.com">Comment Box</a> is loading comments...</div>
        {hcb}
      </div>

      <div class="bottom-box box"></div>
    </div>
  </main>

{filters}
</body>

</html>
"""

INDEX = """<!DOCTYPE html>
<!-- Generated by make-essays.py from essays/posts/ and essays/index.md - do not edit by hand.
     Anything you change here is overwritten on the next commit. -->
<html>

<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <meta name="description"
    content="Essays and notes published on jakeweber.net since 2023 — on the internet, attention, reading, work and the things worth making.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="writing — jake weber">
  <meta name="twitter:description" content="Essays and notes published here since 2023.">
  <meta name="twitter:image" content="/images/preview.png">
  <meta property="og:image" content="/images/preview.png">
  <link rel="shortcut icon" type="image/x-icon" href="../images/shortcut.png">
  <title>writing — jake weber</title>
  <link rel="stylesheet" href="../styleNew.css" />
</head>

<body class="writing">
  <main class="page">
    <header class="site-header">
      <h1><a href="../index.html" style="color: inherit; text-decoration: none;">jake <span>weber</span></a></h1>
      <a class="member-badge" href="../membership/index.html">join the membership</a>
    </header>

    <section class="writing-layout">

      <div class="writing-intro box">
        <div class="writing-intro-grid">
          <section class="block writing-lede">
            <h2>writing</h2>
{lede}
          </section>

          <section class="block writing-elsewhere">
            <h2>elsewhere</h2>
{elsewhere}
            <div class="shimmer-squares" aria-hidden="true">
              <div class="sq sq-a"></div>
              <div class="sq sq-b"></div>
              <div class="sq sq-c"></div>
              <div class="sq sq-d"></div>
              <div class="sq sq-e"></div>
            </div>
          </section>
        </div>
      </div>

      <div class="writing-panel box">
{years}      </div>

      <div class="bottom-box box"></div>
    </section>
  </main>

{filters}
</body>

</html>
"""


def indent(block, pad):
    return "\n".join((pad + ln) if ln.strip() else "" for ln in block.split("\n"))


def strip_tags(s):
    return re.sub(r"<[^>]+>", "", s).strip()


def build_essay(i, post, posts):
    deck_block = ""
    if post["deck"]:
        deck_block = '            <p class="essay-deck">%s</p>\n' % inline(post["deck"])

    links = []
    if i > 0:
        links.append(("previous", posts[i - 1]))
    if i < len(posts) - 1:
        links.append(("next", posts[i + 1]))

    return ESSAY.format(
        title=inline(post["title"]),
        title_attr=html_mod.escape(strip_tags(post["title"]), quote=True),
        desc=html_mod.escape(strip_tags(post["deck"]) or strip_tags(post["title"]), quote=True),
        kicker=post["kicker"],
        dateline=post["dateline"],
        deck_block=deck_block,
        body=indent(post["body"], "            "),
        continue_block="".join(
            '            <li><span class="continue-label">%s</span>'
            '<a class="continue-title" href="%s.html">%s</a></li>\n'
            % (label, other["slug"], inline(other["title"]))
            for label, other in links
        ),
        substack_block="".join(
            '            <li><a target="_blank" rel="noopener noreferrer" href="%s">%s</a></li>\n' % kv
            for kv in SUBSTACK
        ),
        hcb=HCB,
        filters=FILTERS,
    )


def build_index(posts):
    out = []
    for year in sorted({p["year"] for p in posts}, reverse=True):
        rows = [p for p in reversed(posts) if p["year"] == year]
        items = []
        for p in rows:
            deck = ('<span class="entry-deck">%s</span>' % inline(p["deck"])) if p["deck"] else ""
            # the contents column shows the publication date only; anything the
            # dateline adds after a comma stays on the piece, where there is room
            items.append(
                '            <li><a class="entry" href="%s.html">'
                '<span class="entry-title">%s</span>%s'
                '<span class="entry-date">%s</span></a></li>'
                % (p["slug"], inline(p["title"]), deck, p["dateline"].split(",")[0].strip())
            )
        out.append(
            '        <section class="archive-year">\n'
            "          <h2>%d</h2>\n"
            '          <ul class="archive-list">\n%s\n          </ul>\n'
            "        </section>\n" % (year, "\n".join(items))
        )
    return "\n".join(out)


def read_intro():
    """essays/index.md: the lede paragraphs, then --- , then the elsewhere list."""
    if not os.path.exists(INTRO):
        sys.exit("no essays/index.md - the archive page has no words of its own")
    raw = open(INTRO, encoding="utf-8").read().replace("\r\n", "\n")
    parts = re.split(r"^-{3,}\s*$", raw, maxsplit=1, flags=re.M)
    if len(parts) != 2:
        sys.exit("essays/index.md: no '---' line between the lede and the list")
    lede, elsewhere = (to_html(p.strip()) for p in parts)
    # the list carries the site's own class rather than a bare <ul>
    return lede, elsewhere.replace("<ul>", '<ul class="strands">', 1)


def main():
    if not os.path.isdir(POSTS):
        sys.exit("no essays/posts/ directory - nothing to build")

    paths = sorted(f for f in os.listdir(POSTS) if f.endswith(".md"))
    if not paths:
        sys.exit("essays/posts/ has no .md files")

    posts = [read_post(os.path.join(POSTS, f)) for f in paths]
    posts.sort(key=lambda p: (p["date"], p["slug"]))

    seen = {}
    for p in posts:
        if p["slug"] in seen:
            sys.exit("two posts want the same url: %s" % p["slug"])
        seen[p["slug"]] = True

    for i, post in enumerate(posts):
        path = os.path.join(OUT, post["slug"] + ".html")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(build_essay(i, post, posts))

    lede, elsewhere = read_intro()
    with open(os.path.join(OUT, "essays.html"), "w", encoding="utf-8") as fh:
        fh.write(INDEX.format(
            years=build_index(posts),
            lede=indent(lede, "            "),
            elsewhere=indent(elsewhere, "            "),
            filters=FILTERS,
        ))

    missing = []
    for name in sorted(os.listdir(OUT)):
        if not name.endswith(".html"):
            continue
        page = open(os.path.join(OUT, name), encoding="utf-8").read()
        for src in re.findall(r'src="([^"]+)"', page):
            if src.startswith(("http://", "https://", "data:", "//")):
                continue
            if not os.path.exists(os.path.normpath(os.path.join(OUT, src))):
                missing.append("  %s -> %s" % (name, src))
    if missing:
        sys.exit("these pages point at files that aren't there:\n" + "\n".join(missing))

    print("wrote %d essays and the archive index" % len(posts))


if __name__ == "__main__":
    main()
