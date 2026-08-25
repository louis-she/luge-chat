#!/usr/bin/env python3
"""OSM GeoJSONSeq -> geo_admin_areas 装载用 CSV。

用法: osm-to-admin.py admin.geojsonl out.csv.gz

替代高德 regeo 的 addressComponent：点在多边形内即可得到「省/市/县/镇」。
中国 OSM 的层级约定：L4 省·直辖市·自治区，L5 地级市·自治州，L6 县·县级市·区，
L8 镇·街道，L9 更细的街道。L10 及以下是社区/网格，对讲解无意义。
只要 relation 组装出来的面；导出里的 Point 是行政中心节点、LineString 是未组装的边界 way。
"""
import csv
import gzip
import json
import re
import sys
from collections import Counter

HAN = re.compile(r"[\u4e00-\u9fff]")
WANTED_LEVELS = {4, 5, 6, 7, 8, 9}
AREA_TYPES = ("Polygon", "MultiPolygon")


def pick_name(t):
    for k in ("name:zh", "name"):
        v = (t.get(k) or "").strip()
        if v:
            return v
    return ""


def main(src, dst):
    stats = Counter()
    seen = set()
    with open(src, encoding="utf-8") as fin, gzip.open(
        dst, "wt", encoding="utf-8", newline=""
    ) as fout:
        out = csv.writer(fout, lineterminator="\n")
        for line in fin:
            line = line.strip()
            if not line:
                continue
            feat = json.loads(line)
            geom = feat.get("geometry") or {}
            if geom.get("type") not in AREA_TYPES:
                stats["not_area"] += 1
                continue

            props = feat.get("properties") or {}
            try:
                level = int(str(props.get("admin_level", "")).strip())
            except ValueError:
                stats["bad_level"] += 1
                continue
            if level not in WANTED_LEVELS:
                stats["level_out_of_range"] += 1
                continue

            name = pick_name(props)
            if not name or not HAN.search(name):
                stats["no_han_name"] += 1
                continue
            # 「苏皖界」「粤港界」这类是省界线段的名字，不是行政区
            if name.endswith("界"):
                stats["border_segment"] += 1
                continue

            ref = "osm/{}/{}".format(props.get("@type", "?"), props.get("@id", "?"))
            if ref in seen:
                stats["dup_ref"] += 1
                continue
            seen.add(ref)

            meta = {
                k: props[k]
                for k in ("name:en", "wikidata", "wikipedia", "boundary")
                if props.get(k)
            }
            meta["osm_type"] = props.get("@type")
            meta["osm_id"] = props.get("@id")

            out.writerow(
                (
                    ref,
                    name,
                    level,
                    json.dumps(geom, separators=(",", ":"), ensure_ascii=False),
                    json.dumps(meta, separators=(",", ":"), ensure_ascii=False),
                )
            )
            stats["kept"] += 1
            stats["level_%d" % level] += 1

    for k, v in sorted(stats.items()):
        print("{:24s} {}".format(k, v), file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
