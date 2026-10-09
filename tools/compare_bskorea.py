"""표준새번역 파일과 대한성서공회 새번역(웹)을 절 단위로 대조해 결함 절을 찾는다.

결함 판정: 잘림(파일 절이 웹 절의 앞부분뿐) / 밀림(파일 절이 이웃 절과 더 닮음) / 중복(같은 구절 반복).
판본 차이(1993 표준새번역 ↔ 2001 새번역)로 표현만 다른 절은 결함으로 보지 않는다.
출력: data/corrections_rnksv.json  { "Jer.17.2": {"t": 웹 본문, "why": "…"} }
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "bskorea"


def grams(s):
    s = re.sub(r"[\s\"'“”‘’.,!?;:()]", "", s)
    return {s[i:i + 2] for i in range(len(s) - 1)}


def sim(a, b):
    A, B = grams(a), grams(b)
    return 2 * len(A & B) / (len(A) + len(B)) if A and B else 0.0


def main():
    fixes = {}
    for p in sorted(RAW.glob("*.json")):
        osis, ch = p.stem.split(".")
        ch = int(ch)
        web = json.loads(p.read_text(encoding="utf-8"))
        doc = json.loads((ROOT / "data" / "out" / "rnksv" / f"{osis}.json").read_text(encoding="utf-8"))
        vs = doc["ch"][ch - 1]
        for i, v in enumerate(vs, 1):
            f, w = v["t"], web.get(str(i), "")
            if not w or v.get("merged") or re.search(r"절에 포함", f):
                continue
            s0 = sim(f, w)
            nb = max(sim(f, web.get(str(i - 1), "")), sim(f, web.get(str(i + 1), "")))
            why = None
            if len(f) < 0.6 * len(w) and sim(f, w[: len(f) + 4]) > 0.6:
                why = "잘림"
            elif nb > s0 + 0.15 and nb > 0.45:
                why = "밀림"
            elif s0 < 0.45 and len(f) > 1.6 * len(w) and sim(f, w + " " + web.get(str(i + 1), "")) > s0 + 0.15:
                why = "다음 절이 합쳐짐"
            elif re.search(r"(.{12,}).*\1", f) and not re.search(r"(.{12,}).*\1", w):
                why = "중복"
            if why:
                fixes[f"{osis}.{ch}.{i}"] = {"t": w, "why": why, "was": f}
    out = ROOT / "data" / "corrections_rnksv.json"
    out.write_text(json.dumps(fixes, ensure_ascii=False, indent=1), encoding="utf-8")
    for k, x in fixes.items():
        print(f"{k} [{x['why']}] {x['was'][:40]} → {x['t'][:40]}")
    print(len(fixes))


if __name__ == "__main__":
    main()
