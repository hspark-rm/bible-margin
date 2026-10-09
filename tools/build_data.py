"""원본 성경 텍스트와 관주 자료를 앱용 JSON(책 단위)으로 변환한다.

사용: python3 -I tools/build_data.py <원본 폴더> <공동번역 파일>
출력: data/out/{rnksv,krv,ctb}/<OSIS>.json, data/out/xref/<OSIS>.json, data/out/books.json
"""
import collections
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "out"

# 66권 + 제2경전 7권. (OSIS, 개신교 이름, 약칭) — 공동번역 고유 이름은 ctb_name에 따로 둔다.
BOOKS = [
    ("Gen", "창세기", "창"), ("Exod", "출애굽기", "출"), ("Lev", "레위기", "레"),
    ("Num", "민수기", "민"), ("Deut", "신명기", "신"), ("Josh", "여호수아", "수"),
    ("Judg", "사사기", "삿"), ("Ruth", "룻기", "룻"), ("1Sam", "사무엘상", "삼상"),
    ("2Sam", "사무엘하", "삼하"), ("1Kgs", "열왕기상", "왕상"), ("2Kgs", "열왕기하", "왕하"),
    ("1Chr", "역대상", "대상"), ("2Chr", "역대하", "대하"), ("Ezra", "에스라", "스"),
    ("Neh", "느헤미야", "느"), ("Esth", "에스더", "에"), ("Job", "욥기", "욥"),
    ("Ps", "시편", "시"), ("Prov", "잠언", "잠"), ("Eccl", "전도서", "전"),
    ("Song", "아가", "아"), ("Isa", "이사야", "사"), ("Jer", "예레미야", "렘"),
    ("Lam", "예레미야애가", "애"), ("Ezek", "에스겔", "겔"), ("Dan", "다니엘", "단"),
    ("Hos", "호세아", "호"), ("Joel", "요엘", "욜"), ("Amos", "아모스", "암"),
    ("Obad", "오바댜", "옵"), ("Jonah", "요나", "욘"), ("Mic", "미가", "미"),
    ("Nah", "나훔", "나"), ("Hab", "하박국", "합"), ("Zeph", "스바냐", "습"),
    ("Hag", "학개", "학"), ("Zech", "스가랴", "슥"), ("Mal", "말라기", "말"),
    ("Matt", "마태복음", "마"), ("Mark", "마가복음", "막"), ("Luke", "누가복음", "눅"),
    ("John", "요한복음", "요"), ("Acts", "사도행전", "행"), ("Rom", "로마서", "롬"),
    ("1Cor", "고린도전서", "고전"), ("2Cor", "고린도후서", "고후"), ("Gal", "갈라디아서", "갈"),
    ("Eph", "에베소서", "엡"), ("Phil", "빌립보서", "빌"), ("Col", "골로새서", "골"),
    ("1Thess", "데살로니가전서", "살전"), ("2Thess", "데살로니가후서", "살후"),
    ("1Tim", "디모데전서", "딤전"), ("2Tim", "디모데후서", "딤후"), ("Titus", "디도서", "딛"),
    ("Phlm", "빌레몬서", "몬"), ("Heb", "히브리서", "히"), ("Jas", "야고보서", "약"),
    ("1Pet", "베드로전서", "벧전"), ("2Pet", "베드로후서", "벧후"), ("1John", "요한일서", "요일"),
    ("2John", "요한이서", "요이"), ("3John", "요한삼서", "요삼"), ("Jude", "유다서", "유"),
    ("Rev", "요한계시록", "계"),
    ("Tob", "토비트", "토"), ("Jdt", "유딧", "유딧"), ("Wis", "지혜서", "지혜"),
    ("Sir", "집회서", "집회"), ("Bar", "바룩", "바룩"), ("1Macc", "마카베오상", "마카상"),
    ("2Macc", "마카베오하", "마카하"),
]
OSIS = [b[0] for b in BOOKS]


def read_cp949(path):
    return path.read_bytes().decode("cp949").replace("\r", "").split("\n")


def kjv_table():
    """KJV 장별 절 수. 개역개정·표준새번역 파일은 장·절 표기가 없어 이 표로 줄 번호를 장·절로 바꾼다."""
    verses = json.load(open(RAW / "bible_verses.json", encoding="utf-8"))
    t = collections.defaultdict(int)
    for x in verses:
        if x.get("kjv_ch"):
            k = (x["book_id"], x["kjv_ch"])
            t[k] = max(t[k], x["kjv_vs"])
    return t


# 한글 성경(개역개정·표준새번역) 파일은 KJV와 두 곳에서 절 구분이 다르다.
# 고후 13장: KJV 14절 → 한글 13절(KJV 12–13절이 한글 12절). 요삼: KJV 14절 → 한글 15절.
KOR_DIFF = {(47, 13): 13, (64, 1): 15}


def kjv_refs(table, korean=False):
    refs = []
    for (b, c), n in sorted(table.items()):
        if korean:
            n = KOR_DIFF.get((b, c), n)
        refs += [(b, c, v) for v in range(1, n + 1)]
    assert len(refs) == 31102, len(refs)
    return refs


# ---- 소제목·각주 분리 ----
# 표준새번역: <소제목>, 본문 표지 a/b…, 줄 끝 (a. …). 공동번역: [소제목], 본문 표지 ㄱ) ㄴ)…, 줄 끝 (ㄱ. …).
STYLES = {
    "rnksv": dict(
        head=re.compile(r"<([^<>]+)>\s*"),
        mark=re.compile(r"([a-n])\)?(?=[a-n]?[가-힣\"“‘'(\[0-9]|\s*$)"),
        orphan=re.compile(r"(?<![A-Za-z])[a-n]{1,2}\)?(?=[가-힣\"“‘'(\[]|\s*$)"),
        letters="a-n"),
    "ctb": dict(
        head=re.compile(r"\[([^\[\]]+)\]\s*"),
        mark=re.compile(r"([ㄱ-ㅎ])\)\s?"),
        orphan=re.compile(r"[ㄱ-ㅎ]\)\s?"),
        letters="ㄱ-ㅎ"),
}


def split_notes(line, L):
    """줄 끝 '(a. …) (b. …)' 묶음을 각주 목록으로 떼어 낸다. 괄호 안에 여러 각주가 이어질 수도 있다."""
    m = re.search(rf"\s*\(([{L}])[.,]\s", line)
    if not m:
        return line, []
    body, tail = line[: m.start()], line[m.start():].strip()
    notes, depth, buf = [], 0, ""
    for ch in tail:
        if ch == "(":
            depth += 1
            if depth == 1:
                buf = ""
                continue
        elif ch == ")":
            depth -= 1
            if depth == 0:
                notes.append(buf)
                continue
        if depth >= 1:
            buf += ch
    if depth > 0 and buf:
        notes.append(buf)  # 원본에 닫는 괄호가 빠진 줄
    out = []
    for grp in notes:
        for part in re.split(rf"(?:^|\s)(?=[{L}][.,]\s)", grp):
            pm = re.match(rf"([{L}])[.,]\s*(.*)", part.strip(), re.S)
            if pm:
                out.append({"m": pm.group(1), "t": pm.group(2).strip().rstrip(".") + "."})
    return body.rstrip(), out


def parse_annotated(line, issues, ref, style="rnksv"):
    st = STYLES[style]
    HEAD_RE, MARK_RE, ORPHAN_RE = st["head"], st["mark"], st["orphan"]
    body, notes = split_notes(line, st["letters"])
    wanted = {n["m"] for n in notes}
    head_marks = set()

    def strip_head_marks(text):
        # 시편 표제처럼 소제목 안에 각주 표지가 있으면, 그 각주를 소제목에 붙인다.
        def repl(mm):
            if mm.group(1) in wanted:
                head_marks.add(mm.group(1))
                return ""
            return mm.group(0)
        return MARK_RE.sub(repl, text)

    heads = []
    # 소제목은 절 중간에도 나온다. 위치(at)를 남겨 그 자리에 표시한다.
    while True:
        m = HEAD_RE.search(body)
        if not m:
            break
        heads.append({"at": m.start(), "t": strip_head_marks(m.group(1).strip())})
        body = body[: m.start()] + body[m.end():]
    marks = {}
    if notes:
        # 표지를 지우면서 뒤쪽 위치가 당겨지므로, 지운 길이만큼 보정한 위치를 남긴다.
        kept, removed, pos, last = [], [], 0, 0
        for mm in MARK_RE.finditer(body):
            if mm.group(1) in wanted:
                kept.append(body[last:mm.start()])
                marks.setdefault(mm.group(1), mm.start() - pos)
                removed.append((mm.start(), mm.end() - mm.start()))
                pos += mm.end() - mm.start()
                last = mm.end()
        kept.append(body[last:])
        for h in heads:
            h["at"] -= sum(n for at, n in removed if at < h["at"])
        body = "".join(kept)
        missing = [n["m"] for n in notes if n["m"] not in marks and n["m"] not in head_marks]
        if missing:
            issues.append(f"{ref}: 본문에 표지 없음 {missing}")
    # 짝이 되는 각주 없이 남은 표지(원본 결함)는 지운다. 한글 본문에 라틴 소문자·단독 자음+괄호는 표지뿐이다.
    body = ORPHAN_RE.sub("", body)
    if style == "rnksv":
        body = re.sub(r"(^|\s)h\s", r"\1", body)  # 신약의 구약 인용 앞 'h ' 기호(원본 변환 잔재)
    v = {"t": body.strip()}
    if heads:
        v["h"] = heads
    if notes:
        for n in notes:
            if n["m"] in marks:
                n["at"] = marks[n["m"]]
            elif n["m"] in head_marks:
                n["head"] = True
            else:
                n["at"] = len(v["t"])
        v["n"] = notes
    return v


def build_lined(name, path, refs, rnksv=False):
    lines = read_cp949(path)
    if lines and lines[-1] == "":
        lines = lines[:-1]
    assert len(lines) == 31102, (name, len(lines))
    books = collections.defaultdict(lambda: collections.defaultdict(list))
    issues = []
    for (b, c, vno), line in zip(refs, lines):
        ref = f"{OSIS[b-1]}.{c}.{vno}"
        if rnksv:
            v = parse_annotated(line.strip(), issues, ref)
        else:
            v = {"t": line.strip()}
        if not v["t"]:
            v["merged"] = True  # 앞 절에 합쳐진 절
        books[b][c].append(v)
    return books, issues


def build_ctb(path):
    books = collections.defaultdict(lambda: collections.defaultdict(list))
    names, issues = {}, []
    for line in read_cp949(path):
        m = re.match(r"(\d+) (\d+):(\d+) ?(.*)$", line)
        if not m:
            continue
        b, c, vno, t = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4).strip()
        if c == 0:
            names[b] = t.split(",")[1]
            continue
        lst = books[b][c]
        while len(lst) < vno - 1:
            lst.append({"t": "", "merged": True})
        if re.match(r"^[^\[\]]+\]", t):
            t = "[" + t  # 원본에 소제목 여는 괄호가 빠진 줄(마 3:1 등 4곳)
        lst.append(parse_annotated(t, issues, f"{OSIS[b-1]}.{c}.{vno}", "ctb"))
    return books, names, issues


def write_translation(code, books, meta, extra_names=None):
    d = OUT / code
    d.mkdir(parents=True, exist_ok=True)
    for b, chs in books.items():
        osis = OSIS[b - 1]
        doc = {"id": osis, "name": BOOKS[b - 1][1],
               "ch": [chs[c] for c in sorted(chs)]}
        if extra_names and b in extra_names:
            doc["ownName"] = extra_names[b]
        (d / f"{osis}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


# ---- 관주 ----
TSK_BOOK = {b.replace(" ", ""): b for b in OSIS}


def tsk_ref_list(s):
    """'Ps 33:6,9|Prov 8:22-30' → ['Ps.33.6','Ps.33.9','Prov.8.22-30']"""
    out = []
    for part in s.split("|"):
        m = re.match(r"(\d?\s?[A-Za-z]+)\s+(\d+):(.+)$", part.strip())
        if not m:
            continue
        bk = m.group(1).replace(" ", "")
        if bk not in TSK_BOOK:
            continue
        for seg in m.group(3).split(","):
            seg = seg.strip()
            if seg:
                out.append(f"{bk}.{m.group(2)}.{seg}")
    return out


def build_xref():
    x = collections.defaultdict(lambda: collections.defaultdict(dict))
    with open(RAW / "crossreferences_kjv.tsv", encoding="utf-8") as f:
        next(f)
        for line in f:
            bk, c, v, anchor, refs = line.rstrip("\n").split("\t")
            bk = bk.replace(" ", "")
            if bk not in TSK_BOOK:
                continue
            x[bk][f"{c}.{v}"].setdefault("tsk", []).append({"a": anchor, "r": tsk_ref_list(refs)})
    with open(RAW / "openbible" / "cross_references.txt", encoding="utf-8") as f:
        next(f)
        for line in f:
            frm, to, votes = line.rstrip("\n").split("\t")[:3]
            bk, c, v = frm.split(".")
            if int(votes) <= 0:
                continue  # 음수·0표는 공동체가 기각한 연결
            to = to.replace("-", "~") if "-" in to else to
            x[bk][f"{c}.{v}"].setdefault("ob", []).append([to, int(votes)])
    d = OUT / "xref"
    d.mkdir(parents=True, exist_ok=True)
    n = 0
    for bk, verses in x.items():
        for v in verses.values():
            if "ob" in v:
                v["ob"].sort(key=lambda r: -r[1])
                n += len(v["ob"])
        (d / f"{bk}.json").write_text(json.dumps(verses, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return n


def main():
    src, ctb_path = Path(sys.argv[1]), Path(sys.argv[2])
    table = kjv_table()
    refs = kjv_refs(table, korean=True)

    rn, rn_issues = build_lined("rnksv", src / "표준새번역.txt", refs, rnksv=True)
    # 원본 결함(잘림·중복)은 대한성서공회 웹 본문으로 교정한다. 교정한 절에는 fix 표시를 남긴다.
    corr_path = ROOT / "data" / "corrections_rnksv.json"
    n_fix = 0
    if corr_path.exists():
        for key, x in json.loads(corr_path.read_text(encoding="utf-8")).items():
            o, c, vno = key.split(".")
            v = rn[OSIS.index(o) + 1][int(c)][int(vno) - 1]
            v["t"] = x["t"]
            v["fix"] = x["why"]
            v.pop("merged", None)
            for nt in v.get("n", []):
                nt["at"] = min(nt.get("at", 0), len(v["t"]))
            n_fix += 1
    print(f"표준새번역 교정: {n_fix}절")
    kdiff = ["2Cor.13", "3John.1"]  # 관주(KJV 절 번호)를 절 단위로 맞추지 않는 장
    write_translation("rnksv", rn, {"code": "rnksv", "name": "표준새번역", "short": "새번역", "versificationDiff": kdiff})
    kr, _ = build_lined("krv", src / "개역개정.txt", refs)
    write_translation("krv", kr, {"code": "krv", "name": "개역개정", "short": "개역개정", "versificationDiff": kdiff})
    ctb, ctb_names, ctb_issues = build_ctb(ctb_path)
    # 공동번역 깨진 글자는 문자열 치환으로 고친다(data/corrections_ctb.json).
    cc = ROOT / "data" / "corrections_ctb.json"
    if cc.exists():
        for key, reps in json.loads(cc.read_text(encoding="utf-8")).items():
            o, c, vno = key.split(".")
            v = ctb[OSIS.index(o) + 1][int(c)][int(vno) - 1]
            for a, b in reps:
                v["t"] = v["t"].replace(a, b).strip()
            v["fix"] = "깨진 글자"
    # 공동번역 절 체계가 KJV와 다른 장은 관주·대조를 절 단위로 맞추지 않는다.
    diff = sorted(f"{OSIS[b-1]}.{c}" for (b, c) in set(table) | {(b, c) for b in ctb for c in ctb[b] if b <= 66}
                  if b <= 66 and table.get((b, c)) != len(ctb.get(b, {}).get(c, [])))
    write_translation("ctb", ctb, {"code": "ctb", "name": "공동번역(외경포함)", "short": "공동번역",
                                    "versificationDiff": diff}, extra_names=ctb_names)
    n_ob = build_xref()

    books = [{"id": o, "name": n, "abbr": a, "deutero": i >= 66,
              "chapters": max(c for (b, c) in table if b == i + 1) if i < 66 else len(ctb[i + 1])}
             for i, (o, n, a) in enumerate(BOOKS)]
    (OUT / "books.json").write_text(json.dumps(books, ensure_ascii=False, indent=0), encoding="utf-8")

    n_notes = sum(len(v.get("n", [])) for b in rn.values() for c in b.values() for v in c)
    n_heads = sum(len(v.get("h", [])) for b in rn.values() for c in b.values() for v in c)
    print(f"표준새번역: 소제목 {n_heads}, 각주 {n_notes}, 표지 불일치 {len(rn_issues)}")
    for s in rn_issues[:15]:
        print("  ", s)
    merged = sum(1 for b in kr.values() for c in b.values() for v in c if v.get("merged"))
    print(f"개역개정: 합쳐진 절 {merged}")
    c_notes = sum(len(v.get("n", [])) for b in ctb.values() for c in b.values() for v in c)
    c_heads = sum(len(v.get("h", [])) for b in ctb.values() for c in b.values() for v in c)
    print(f"공동번역: {len(ctb)}권, 절 체계 다른 장 {len(diff)}, 소제목 {c_heads}, 각주 {c_notes}, 표지 불일치 {len(ctb_issues)}")
    print(f"OpenBible 관주(양수 표): {n_ob}")


if __name__ == "__main__":
    main()
