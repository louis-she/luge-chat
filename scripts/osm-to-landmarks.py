#!/usr/bin/env python3
"""OSM GeoJSONSeq -> geo_landmarks_cache 装载用 CSV。

用法: osm-to-landmarks.py pois.geojsonl out.csv.gz

输出列: external_ref, landmark_name, landmark_type, search_radius_m, geojson, metadata
无名地物直接丢弃 —— 讲不出名字的点对语音导游没有价值。
GeoJSON 与 metadata 里含反斜杠，必须走 CSV 而非 COPY TEXT，否则转义序列会被吞。
"""
import csv
import gzip
import json
import re
import sys
from collections import Counter

# geo_landmarks_cache.landmark_type 只有这六档
TOWN, RIVER, SCENERY, BRIDGE, MOUNTAIN, OTHER = (
    "town", "river", "scenery", "bridge", "mountain", "other"
)

HAN = re.compile(r"[\u4e00-\u9fff]")


def pick_name(t):
    for k in ("name:zh", "name", "int_name", "alt_name", "name:en"):
        v = (t.get(k) or "").strip()
        if v:
            return v
    return ""


def parse_ele(t):
    raw = (t.get("ele") or "").strip()
    if not raw:
        return None
    m = re.match(r"^-?\d+(\.\d+)?", raw)
    if not m:
        return None
    try:
        ele = float(m.group(0))
    except ValueError:
        return None
    return ele if -500 <= ele <= 9000 else None


def classify(t):
    """返回 (landmark_type, search_radius_m)，不值得讲的返回 None。顺序即优先级。"""
    nat = t.get("natural", "")
    wat = t.get("waterway", "")
    place = t.get("place", "")
    ele = parse_ele(t)

    if nat in ("peak", "volcano", "glacier"):
        if ele and ele >= 4000:
            return MOUNTAIN, 80000
        if ele and ele >= 2000:
            return MOUNTAIN, 50000
        return MOUNTAIN, 25000
    if nat == "saddle" or t.get("mountain_pass") == "yes":
        return MOUNTAIN, 15000

    if place == "city":
        return TOWN, 40000
    if place == "town":
        return TOWN, 20000
    if place == "village":
        return TOWN, 3000
    if place in ("island", "islet"):
        return SCENERY, 20000

    if wat in ("river", "canal"):
        return RIVER, 15000
    if wat == "waterfall":
        return SCENERY, 10000
    if wat == "dam":
        return OTHER, 10000
    if (
        nat == "water"
        or t.get("water") in ("lake", "reservoir")
        or t.get("landuse") == "reservoir"
    ):
        return RIVER, 20000
    if nat in ("spring", "hot_spring"):
        return RIVER, 8000

    if t.get("boundary") in ("national_park", "protected_area"):
        return SCENERY, 30000
    if t.get("leisure") == "nature_reserve":
        return SCENERY, 30000
    if t.get("leisure") == "park":
        return SCENERY, 8000

    if nat in ("valley", "gorge"):
        return SCENERY, 20000
    if nat in ("bay", "beach", "cape", "cliff", "cave_entrance"):
        return SCENERY, 10000

    if t.get("tourism") in ("viewpoint", "attraction", "theme_park", "zoo"):
        return SCENERY, 10000
    if t.get("tourism") in ("museum", "artwork"):
        return SCENERY, 6000
    if t.get("historic"):
        return SCENERY, 8000
    if t.get("amenity") == "place_of_worship":
        return SCENERY, 8000

    if t.get("man_made") == "bridge":
        return BRIDGE, 5000
    if t.get("man_made") in ("tower", "lighthouse", "watermill"):
        return OTHER, 6000

    # bridge=yes / tunnel=yes 是道路 way 上的属性，name 是路名而非桥名
    # （「沈海高速」出现 4014 次），不是可讲解的地物实体。
    if t.get("bridge") or t.get("tunnel"):
        return None

    return OTHER, 8000


def first_coord(geom):
    c = geom.get("coordinates")
    while isinstance(c, list) and c and isinstance(c[0], list):
        c = c[0]
    if isinstance(c, list) and len(c) >= 2:
        return c[0], c[1]
    return None


# 长城被切成 5689 段、坎儿井 5778 条、一条江几百个 way —— 同名地物在同一片
# 区域里重复入库会把 nearby_geo_landmarks 的 limit 8 全占满。按 ~10km 网格
# 每个名字只留一条，既保住沿线覆盖又不刷屏。
GRID_DEG = 0.1


META_KEYS = (
    "ele", "height", "population", "wikipedia", "wikidata", "description",
    "religion", "denomination", "start_date", "admin_level", "name:en",
    "natural", "waterway", "water", "place", "tourism", "historic",
    "leisure", "boundary", "man_made", "amenity", "mountain_pass",
)


def main(src, dst):
    stats = Counter()
    seen = set()
    grid = set()
    with open(src, encoding="utf-8") as fin, gzip.open(
        dst, "wt", encoding="utf-8", newline=""
    ) as fout:
        out = csv.writer(fout, lineterminator="\n")
        for line in fin:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            try:
                feat = json.loads(line)
            except json.JSONDecodeError:
                stats["bad_json"] += 1
                continue

            props = feat.get("properties") or {}
            geom = feat.get("geometry")
            if not geom:
                stats["no_geom"] += 1
                continue

            name = pick_name(props)
            if not name:
                stats["no_name"] += 1
                continue
            if len(name) > 120:
                stats["name_too_long"] += 1
                continue
            # 中文 TTS 念不了「Зэрэг гол」「Glass Bodem platform」，这类几乎全是
            # 境外地物或垃圾条目，留着比没有更糟
            if not HAN.search(name):
                stats["no_han_name"] += 1
                continue

            ref = "osm/{}/{}".format(props.get("@type", "?"), props.get("@id", "?"))
            if ref in seen:
                stats["dup_ref"] += 1
                continue
            seen.add(ref)

            klass = classify(props)
            if klass is None:
                stats["skip_road_attr"] += 1
                continue
            ltype, radius = klass

            pt = first_coord(geom)
            if pt is None:
                stats["no_coord"] += 1
                continue
            cell = (
                name,
                ltype,
                int(pt[1] // GRID_DEG),
                int(pt[0] // GRID_DEG),
            )
            if cell in grid:
                stats["dup_in_cell"] += 1
                continue
            grid.add(cell)

            meta = {k: props[k] for k in META_KEYS if props.get(k)}
            meta["osm_type"] = props.get("@type")
            meta["osm_id"] = props.get("@id")

            out.writerow(
                (
                    ref,
                    name,
                    ltype,
                    radius,
                    json.dumps(geom, separators=(",", ":"), ensure_ascii=False),
                    json.dumps(meta, separators=(",", ":"), ensure_ascii=False),
                )
            )
            stats["kept"] += 1
            stats["type_" + ltype] += 1

    for k, v in sorted(stats.items()):
        print("{:20s} {}".format(k, v), file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
