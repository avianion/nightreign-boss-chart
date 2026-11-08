"""Regenerate the SEEDS table in index.html from the datamined map-pattern CSVs.

    python tools/build_seeds.py [map_patterns_base.csv map_patterns_gh.csv]

With no arguments the two CSVs are downloaded from a pinned commit of
andrii-baldyniuk/nightreign-seed-finder, which compiles thefifthmatt's
pattern dump (https://thefifthmatt.github.io/nightreign/). Every Nightlord has
a fixed list of map patterns; each pattern fixes the map, the Night 1 boss and
the Night 2 boss (plus a second boss on "Extra Night Boss" patterns). The page
predicts the Nightlord by counting which patterns match what the player saw.

Fails loudly on any boss, Nightlord or map name it doesn't recognise, so a game
update that adds content can't silently produce a wrong table.
"""
import csv
import io
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

SOURCE = ("https://raw.githubusercontent.com/andrii-baldyniuk/nightreign-seed-finder/"
          "a08281a6590078a1befb553d52d16acff0b34f35/data/")
INDEX = Path(__file__).resolve().parent.parent / "index.html"

NIGHTLORDS = {
    "Gladius": "gladius", "Adel": "adel", "Gnoster": "gnoster", "Maris": "maris",
    "Libra": "libra", "Fulghor": "fulghor", "Caligo": "caligo", "Heolstor": "heolstor",
    "Dreglord": "dreglord", "Harmonia": "balancers",
}
MAPS = {
    "Default": "default", "Crater": "crater", "Mountaintop": "mountaintop",
    "Rotted Woods": "rotted", "Noklateo": "noklateo",
}
# CSV spelling -> dropdown value. The two CSVs spell some bosses differently.
NIGHT1 = {
    "Battlefield Commander": "battlefield", "Bell Bearing Hunter": "bbh",
    "Centipede Demon": "centipede", "Demi-Human Queen and Swordmaster": "demi",
    "Demihuman Queen & Swordmaster": "demi", "Gaping Dragon": "gaping",
    "Grafted Monarch": "grafted", "Night's Cavalry Duo": "cavalry", "Night's Cavalries": "cavalry",
    "Royal Revenant": "revenant", "Smelter Demon": "smelter", "The Duke's Dear Freja": "freja",
    "Duke's Dear Freja": "freja", "Tibia Mariner": "tibia", "Ulcerated Tree Spirit": "tree",
    "Valiant Gargoyle": "gargoyle", "Wormface": "wormface", "Death Knights": "deathknight",
    "Demons": "demons", "DBW & Curseblade": "warrior", "Great Red Bear": "bear",
}
NIGHT2 = {
    "Ancient Dragon": "ancient", "Crucible Knight and Golden Hippopotamus": "crucible",
    "Crucible Knight & Hippo": "crucible", "Dancer of the Boreal Valley": "dancer", "Dancer": "dancer",
    "Death Rite Bird": "deathrite", "Draconic Tree Sentinel and Royal Cavalrymen": "draconic",
    "Draconic Tree Sentinel": "draconic", "Fallingstar Beast": "fallingstar", "Morgott": "fell",
    "Godskin Duo": "godskin", "Great Wyrm": "wyrm", "Nameless King": "nameless",
    "Dragonkin Soldier": "nox", "Outland Commander": "outland",
    "Tree Sentinel and Royal Cavalrymen": "treesent", "Tree Sentinel": "treesent",
    "Artorias": "artorias", "Dancing Lion": "lion", "Mohg": "mohg", "Demon Prince": "demonprince",
}


def lookup(table, name, what, pattern_id):
    try:
        return table[name]
    except KeyError:
        sys.exit(f"pattern {pattern_id}: unknown {what} {name!r}; add it to tools/build_seeds.py")


def read_csv(arg, name):
    if arg:
        return Path(arg).read_text(encoding="utf-8")
    with urllib.request.urlopen(SOURCE + name, timeout=30) as resp:
        return resp.read().decode("utf-8")


def build(base_text, hollow_text):
    seeds, seen = [], set()
    for text, hollow in ((base_text, False), (hollow_text, True)):
        for row in csv.DictReader(io.StringIO(text)):
            pid = int(row["ID"])
            if pid in seen:
                sys.exit(f"duplicate pattern id {pid}")
            seen.add(pid)
            nightlord = lookup(NIGHTLORDS, row["Nightlord"], "nightlord", pid)
            map_key = "hollow" if hollow else lookup(MAPS, row["Shifting Earth"], "map", pid)
            n1 = lookup(NIGHT1, row["Night 1 Boss"], "night 1 boss", pid)
            n2 = lookup(NIGHT2, row["Night 2 Boss"], "night 2 boss", pid)
            x1 = x2 = ""
            extra, event = row.get("Extra Night Boss", ""), row.get("Special Event", "")
            if extra:
                if event == "Day 1 Extra Night Boss":
                    x1 = lookup(NIGHT1, extra, "extra night 1 boss", pid)
                elif event == "Day 2 Extra Night Boss":
                    x2 = lookup(NIGHT2, extra, "extra night 2 boss", pid)
                else:
                    sys.exit(f"pattern {pid}: extra boss {extra!r} but event is {event!r}")
            elif "Extra Night Boss" in event:
                sys.exit(f"pattern {pid}: {event!r} without an extra boss")
            seeds.append((pid, nightlord, map_key, n1, n2, x1, x2))
    seeds.sort()
    return seeds


def render(seeds):
    lines = ["const SEEDS = ["]
    lines += [f"  [{pid},'{nl}','{mp}','{n1}','{n2}','{x1}','{x2}']," for pid, nl, mp, n1, n2, x1, x2 in seeds]
    lines.append("];")
    return "\n".join(lines)


def main():
    args = sys.argv[1:]
    if len(args) not in (0, 2):
        sys.exit(__doc__)
    seeds = build(read_csv(args[0] if args else None, "map_patterns_base.csv"),
                  read_csv(args[1] if args else None, "map_patterns_gh.csv"))
    html = INDEX.read_text(encoding="utf-8")
    block = re.compile(r"(// <seeds>\n).*?(\n// </seeds>)", re.S)
    if not block.search(html):
        sys.exit("index.html has no // <seeds> ... // </seeds> block")
    html = block.sub(lambda m: m.group(1) + render(seeds) + m.group(2), html, count=1)
    INDEX.write_text(html, encoding="utf-8", newline="")
    counts = Counter(s[1] for s in seeds)
    print(f"wrote {len(seeds)} patterns: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()
