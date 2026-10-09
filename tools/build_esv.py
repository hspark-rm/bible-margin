"""ESV PDF(pdftotext 출력)를 앱용 JSON(책 단위)으로 변환한다.

사용: pdftotext "ESV Bible.pdf" esv.txt && python3 -I tools/build_esv.py esv.txt
출력: data/out/esv/<OSIS>.json, data/out/esv/meta.json, data/out/esv/_report.txt

PDF 텍스트에는 절 번호가 단어에 붙어 있다("2The earth"). 본문 속 숫자("110 years")와 구분하려고,
'다음에 와야 할 절 번호'만 찾는 방식으로 읽는다.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import OSIS, OUT, kjv_table  # noqa: E402

SUPERSCRIPT = re.compile(r"^(A Psalm|A Song|A Maskil|A Miktam|A Prayer|A Shiggaion|Shiggaion|To the choirmaster|Of David|Of Solomon|"
                         r"A Psalm of|A Song of|According to|For the|With stringed|Of the Sons|Of Asaph|Of Heman|Of Ethan|Of Moses|Of the)")
BOOK_START = re.compile(r"^(1:1\s|1\s(?!(Samuel|Kings|Chronicles|Corinthians|Thessalonians|Timothy|Peter|John|Esdras|Maccabees)\b)[A-Z“‘])")
ONE_CH = {"Obad", "Phlm", "2John", "3John", "Jude"}
VERSE_START = re.compile(r"^(\d+:\d+\s|\d+[A-Za-z“‘\"'(—\[]|1\s[A-Z“‘])")
FN_LINE = re.compile(r"^\[(\d+)\]\s+(\d+):(\d+)\s*(.*)$")


def chunks(lines):
    """빈 줄로 나뉜 덩어리 목록 [(시작 줄 번호, [줄…])]."""
    out, cur, start = [], [], 0
    for i, ln in enumerate(lines):
        if ln.strip() == "":
            if cur:
                out.append((start, cur))
            cur = []
        else:
            if not cur:
                start = i
            cur.append(ln.rstrip())
    if cur:
        out.append((start, cur))
    return out


def is_heading_chunk(lines, next_first, in_psalms):
    """소제목(또는 시편 표제) 덩어리인지 판정. 다음 덩어리가 절 번호로 시작해야 한다."""
    if not next_first or not VERSE_START.match(next_first):
        return False
    if any(VERSE_START.match(x) for x in lines) or lines[0][:1].islower():
        return False
    first = lines[0]
    if len(lines) == 1 and len(first) <= 60 and not re.search(r"[.,;:]$", first):
        return True
    if in_psalms:
        rest = lines[1:] if not SUPERSCRIPT.match(first) else lines
        if rest and SUPERSCRIPT.match(rest[0]) and sum(len(x) for x in lines) < 400:
            return True
    return False


TITLE_LIKE = re.compile(r"^[A-Z“‘\"'(]")
GLUED = re.compile(r"\d+[A-Za-z“‘]")


def split_chunk(lines, nxt, in_psalms):
    """덩어리 안에서 소제목(시편 표제 포함) 구간을 떼어 낸다. [("text"|"head", [줄…])]"""
    out, buf, i, n = [], [], 0, len(lines)
    while i < n:
        ln = lines[i].strip()
        prev_ok = i == 0 or re.search(r"[.?!”’)\]]$|Selah$", lines[i - 1].strip())
        cand = (prev_ok and not VERSE_START.match(ln) and not GLUED.search(ln) and len(ln) <= 70
                and (TITLE_LIKE.match(ln) and not re.search(r"[,;:]$", ln) and (not ln.endswith(".") or (in_psalms and SUPERSCRIPT.match(ln)))))
        if cand:
            j = i + 1
            if in_psalms:
                # 표제 다음에 오는 표제문("A Psalm of David, …")은 절 시작 줄 전까지 이어진다.
                while j < n and j - i < 6 and not VERSE_START.match(lines[j]) and not GLUED.search(lines[j]):
                    j += 1
            after = lines[j] if j < n else nxt
            after_ok = bool(after) and VERSE_START.match(after) and not re.match(r"^\d+[a-z]", after)
            if after_ok and (j - i == 1 or (in_psalms and SUPERSCRIPT.match(lines[i + 1].strip() if i + 1 < n else ""))
                             or (in_psalms and SUPERSCRIPT.match(ln))):
                if buf:
                    out.append(("text", buf)); buf = []
                out.append(("head", lines[i:j]))
                i = j
                continue
        buf.append(lines[i]); i += 1
    if buf:
        out.append(("text", buf))
    return out


def mark_psalm_titles(lines):
    """시편: 각 편의 'N:1' 줄 바로 위의 제목 + 표제문(빈 줄·각주 표지 섞임)을 한 줄 소제목 표지(\x01)로 바꾼다."""
    ps = next(i for i, l in enumerate(lines) if l.strip() == "PSALMS")
    pv = next(i for i, l in enumerate(lines) if l.strip() == "PROVERBS" and i > ps)
    out = list(lines)
    strip_fn = lambda x: re.sub(r"\[\d+\]\s*", "", x.strip())
    for i in range(ps, pv):
        if not re.match(r"^\d+:1\s", lines[i]):
            continue
        above = [k for k in range(i - 1, max(ps, i - 14), -1) if lines[k].strip()][:7]
        sup_top = None
        for k in above:
            if SUPERSCRIPT.match(strip_fn(lines[k])):
                sup_top = k
            if GLUED.search(lines[k]) or VERSE_START.match(lines[k]):
                break
        start = sup_top if sup_top is not None else i
        prev = [k for k in above if k < start]
        if prev:
            t = strip_fn(lines[prev[0]])
            if t and len(t) <= 70 and TITLE_LIKE.match(t) and not re.search(r"[.,;:!?]$", t) and not GLUED.search(t):
                start = prev[0]
        if start == i:
            continue
        seg = [strip_fn(lines[k]) for k in range(start, i) if lines[k].strip() and not re.fullmatch(r"BOOK (ONE|TWO|THREE|FOUR|FIVE)", lines[k].strip())]
        for k in range(start, i):
            if not re.fullmatch(r"BOOK (ONE|TWO|THREE|FOUR|FIVE)", lines[k].strip()):
                out[k] = ""
        # 제목과 표제문("A Psalm of David …")은 \x02로 나눠 두 줄로 표시한다.
        first_sup = next((n for n, x in enumerate(seg) if SUPERSCRIPT.match(x)), None)
        if first_sup:
            out[start] = "\x01" + join_lines(seg[:first_sup]) + "\x02" + join_lines(seg[first_sup:])
        else:
            out[start] = "\x01" + join_lines(seg)
        out.insert(start + 1, "") if False else None
    # 표지 줄은 앞뒤를 빈 줄로 둘러 별도 덩어리로 만든다.
    res = []
    for l in out:
        if l.startswith("\x01"):
            res += ["", l, ""]
        else:
            res.append(l)
    return res


def join_lines(lines):
    s = ""
    for ln in lines:
        ln = ln.strip()
        if not s:
            s = ln
        elif s.endswith("—") or ln.startswith("—") or s.endswith("-") and ln[:1].isalpha() and False:
            s += ln
        else:
            s += " " + ln
    return s


def main():
    src = Path(sys.argv[1])
    lines = src.read_text(encoding="utf-8").replace("\f", "\n").split("\n")
    start = next(i for i, l in enumerate(lines) if l.strip() == "GENESIS" and i > 200)
    toc = next(i for i, l in enumerate(lines) if l.strip() == "GENESIS")
    # 책 제목은 목차에 나온 대문자 줄로만 판정한다(본문의 단독 'LORD' 줄을 제목으로 오인하지 않게).
    BOOK_TITLES = {l.strip() for l in lines[toc:toc + 90] if l.strip().isupper()}
    def is_title(x):
        x = x.strip()
        return x in BOOK_TITLES or re.fullmatch(r"BOOK (ONE|TWO|THREE|FOUR|FIVE)", x) is not None
    lines = lines[start:]
    fixed = []
    for ln in lines:
        if ln.strip() == "Footnotes":
            fixed += ["", ln, ""]
        else:
            fixed.append(ln)
    lines = mark_psalm_titles(fixed)

    # 1) 덩어리를 본문 / 각주 / 소제목 / 장 목록으로 분류해 하나의 본문 흐름을 만든다.
    stream, heads, fn_blocks = [], [], []  # heads: (흐름 위치, 텍스트)
    pos = 0
    cks = chunks(lines)
    in_fn = False
    in_psalms = False
    for k, (_, ck) in enumerate(cks):
        nxt = cks[k + 1][1][0] if k + 1 < len(cks) else ""
        # 장 목록·책 제목 줄은 버린다.
        body = [x for x in ck if not re.fullmatch(r"Chapter \d+", x.strip()) and not is_title(x)]
        titles = [x.strip() for x in ck if is_title(x)]
        if "PSALMS" in titles:
            in_psalms = True
        elif titles and "BOOK" not in " ".join(titles):
            in_psalms = False
        if any(t.startswith("BOOK ") for t in titles):
            heads.append((pos, " ".join(t.title() for t in titles if t.startswith("BOOK "))))
        if not body:
            continue
        if body[0].startswith("\x01"):
            for n, part in enumerate(body[0][1:].split("\x02")):
                heads.append((pos + (1 if stream else 0), ("\x02" if n else "") + part))
            continue
        if body[0].strip() == "Footnotes":
            in_fn = True
            fn_blocks.append([pos, []])
            body = body[1:]
            if not body:
                continue
        # 각주 블록은 책 끝에 있으므로, 다음 책 첫 절(1:1 또는 한 장짜리 책의 '1 ')이 나와야 끝난다.
        if in_fn and any(BOOK_START.match(x) for x in body) and not FN_LINE.match(body[0]):
            in_fn = False
        if in_fn:
            if FN_LINE.match(body[0]) or (fn_blocks[-1][1] and not BOOK_START.match(body[0]) and not is_heading_chunk(body, nxt, in_psalms)):
                fn_blocks[-1][1].extend(body)
                continue
            in_fn = False
        for kind, seg in split_chunk(body, nxt, in_psalms):
            if kind == "head":
                heads.append((pos + (1 if stream else 0), join_lines(seg)))
                continue
            piece = join_lines(seg)
            if stream and not (stream[-1].endswith("—") or piece.startswith("—")):
                stream.append(" ")
                pos += 1
            stream.append(piece)
            pos += len(piece)
    text = "".join(stream)

    # 2) 기대 절 번호를 따라가며 절 경계를 찾는다.
    table = kjv_table()
    def vre(n):
        return re.compile(rf"(?<![\w\[,:.]){n}(?=[A-Za-z“‘\"'(—\[])")
    def cre(c):
        return re.compile(rf"(?<![\w\[,:.]){c}:1\s")
    marks = []  # (위치, 본문 시작 위치, 책 index, 장, 절)
    b, c, v, p = 0, 0, 0, 0
    nbooks = 66
    WINDOW = 6000
    while True:
        cands = []
        if c > 0:
            for d in (1, 2, 3):
                m = vre(v + d).search(text, p, p + WINDOW)
                if m:
                    cands.append((m.start(), m.end(), b, c, v + d))
        m = cre(c + 1).search(text, p, p + WINDOW * 3)
        if m:
            cands.append((m.start(), m.end(), b, c + 1, 1))
        if c > 0 and b + 1 < nbooks:
            # 한 장짜리 책(오바댜·빌레몬·요이·요삼·유다)은 첫 절이 '1:1'이 아니라 '1 '로 시작한다.
            nre = re.compile(r"(?<![\w\[,:.])1\s(?=[A-Z“‘])") if OSIS[b + 1] in ONE_CH else cre(1)
            m = nre.search(text, p, p + WINDOW * 3)
            if m:
                cands.append((m.start(), m.end(), b + 1, 1, 1))
        if c == 0:
            m = cre(1).search(text, p)
            cands = [(m.start(), m.end(), 0, 1, 1)] if m else []
        if not cands:
            break
        # 같은 위치면 '같은 장 다음 절' > '다음 장' > '다음 책' 순으로 고른다.
        cands.sort(key=lambda x: (x[0], x[2] - b, x[3] - c))
        best = cands[0]
        # 다음 절을 건너뛰었다면, 숫자로 시작하는 절("512,000" = 5절 + "12,000")을 의심하고 그 사이에서 다시 찾는다.
        if c > 0 and v + 1 <= table.get((b + 1, c), 0) and not (best[2] == b and best[3] == c and best[4] == v + 1):
            m = re.compile(rf"(?<![\w\[,:.]){v + 1}(?=\d{{1,3}}(?:,\d{{3}})*\s)").search(text, p, best[0])
            if m:
                best = (m.start(), m.end(), b, c, v + 1)
        s, e, b, c, v = best
        marks.append((s, e, b, c, v))
        p = e
        if b == nbooks - 1 and c == 22 and v >= 21:
            pass

    # 3) 절 본문·각주 표지·소제목 배치
    books = {}
    for i, (s, e, bi, ci, vi) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        books.setdefault(bi, {}).setdefault(ci, {})[vi] = (e, end)

    # 각주 블록은 그 위치 직전 절의 책에 속한다.
    import bisect
    starts = [m[0] for m in marks]
    fn_by_book = {}
    for fpos, flines in fn_blocks:
        idx = max(0, bisect.bisect_right(starts, fpos) - 1)
        bi = marks[idx][2]
        cur = None
        for ln in flines:
            m = FN_LINE.match(ln.strip())
            if m:
                cur = [int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4).strip()]
                fn_by_book.setdefault(bi, {})[cur[0]] = cur
            elif cur:
                cur[3] += " " + ln.strip()

    head_at = {}
    for hp, ht in sorted(heads, key=lambda x: x[0]):
        idx = bisect.bisect_right(starts, hp) - 1
        if idx < 0:
            idx = 0
        s0, e0, bi, ci, vi = marks[idx]
        end0 = marks[idx + 1][0] if idx + 1 < len(marks) else len(text)
        raw = text[e0:end0]
        body_len = len(raw.strip())
        at = hp - e0 - (len(raw) - len(raw.lstrip()))
        # 절 본문이 끝난 뒤(다음 절 번호 직전)에 놓인 소제목은 다음 절 맨 앞으로 옮긴다.
        if at >= body_len and idx + 1 < len(marks):
            _, _, bi, ci, vi = marks[idx + 1]
            at = 0
        head_at.setdefault((bi, ci, vi), []).append((max(0, at), ht))
    report, out_dir = [], OUT / "esv"
    out_dir.mkdir(parents=True, exist_ok=True)
    for bi, chs in books.items():
        osis = OSIS[bi]
        doc = {"id": osis, "ch": []}
        for ci in range(1, max(chs) + 1):
            vs = chs.get(ci, {})
            arr = []
            for vi in range(1, (max(vs) if vs else 0) + 1):
                if vi not in vs:
                    arr.append({"t": "", "merged": True, "omitted": True})
                    continue
                e, end = vs[vi]
                raw = text[e:end]
                lead = len(raw) - len(raw.lstrip())
                raw_s = raw.strip()
                # 소제목: 이 절 범위 안에 있으면 그 위치(at)에 둔다. 절 끝 직후 소제목은 다음 절 앞(at=0)으로 간다.
                hs = head_at.get((bi, ci, vi), [])
                notes, t, out_t = [], raw_s, ""
                last, removed = 0, 0
                for m in re.finditer(r"\[(\d+)\]", t):
                    out_t += t[last:m.start()]
                    n = int(m.group(1))
                    f = fn_by_book.get(bi, {}).get(n)
                    notes.append({"m": str(n), "t": f[3] if f else "", "at": len(out_t)})
                    last = m.end()
                out_t += t[last:]
                item = {"t": re.sub(r"\s+", " ", out_t).strip()}
                if hs:
                    adj = []
                    for at, ht in hs:
                        shift = sum(len(m.group(0)) for m in re.finditer(r"\[\d+\]", t[:max(at, 0)]))
                        h = {"at": max(0, at - shift), "t": ht.lstrip("\x02")}
                        if ht.startswith("\x02") or SUPERSCRIPT.match(ht):
                            h["sup"] = True  # 시편 표제문은 소제목과 다른 모양으로 표시한다
                        adj.append(h)
                    item["h"] = adj
                if notes:
                    item["n"] = notes
                arr.append(item)
            doc["ch"].append(arr)
            exp = table.get((bi + 1, ci))
            if exp != len(arr):
                report.append(f"{osis}.{ci}: 기대 {exp} / 추출 {len(arr)}")
        (out_dir / f"{osis}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    missing_ch = [f"{OSIS[b-1]}.{c}" for (b, c) in table if b - 1 not in books or c not in books[b - 1]]
    report += [f"장 없음: {x}" for x in missing_ch]
    (out_dir / "meta.json").write_text(json.dumps({"code": "esv", "name": "English Standard Version", "short": "ESV"}, ensure_ascii=False), encoding="utf-8")
    (out_dir / "_report.txt").write_text("\n".join(report), encoding="utf-8")
    nv = sum(len(a) for b in books.values() for a in b.values())
    print(f"책 {len(books)}, 절 {nv}, 소제목 {len(heads)}, 각주 블록 {len(fn_blocks)}, 불일치 {len(report)}")
    print("\n".join(report[:40]))


if __name__ == "__main__":
    main()
