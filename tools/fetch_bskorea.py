"""대한성서공회 새번역 웹페이지에서 지정한 장만 받아 절별 텍스트로 저장한다(원본 결함 대조용, 개인용).

사용: python3 -I tools/fetch_bskorea.py Gen.1 Jer.17 ...
출력: data/raw/bskorea/<OSIS>.<장>.json  ({"1": "…", "2": "…"})
"""
import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "raw" / "bskorea"
CODES = dict(zip(
    "Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal "
    "Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev".split(),
    "gen exo lev num deu jos jdg rut 1sa 2sa 1ki 2ki 1ch 2ch ezr neh est job psa pro ecc sng isa jer lam ezk dan hos jol amo oba jnh mic nam hab zep hag zec mal "
    "mat mrk luk jhn act rom 1co 2co gal eph php col 1th 2th 1ti 2ti tit phm heb jas 1pe 2pe 1jn 2jn 3jn jud rev".split()))


def fetch(osis, ch):
    url = f"https://www.bskorea.or.kr/bible/korbibReadpage.php?version=SAENEW&book={CODES[osis]}&chap={ch}"
    raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20).read().decode("utf-8", "replace")
    body = raw[raw.find('id="tdBible1"'):]
    body = re.split(r"<script|성경 단어 검색", body)[0]  # 본문 뒤의 검색 상자·스크립트 제거
    body = re.sub(r"<div id=['\"]?D_[^'\" ]*['\"]? class=['\"]?D2.*?</div>", "", body, flags=re.S)   # 각주 팝업
    body = re.sub(r"<a class=['\"]?comment.*?</a>", "", body, flags=re.S)                          # 각주 표지
    verses = {}
    # 절 번호 span을 기준으로 잘라, 다음 절 번호 전까지를 그 절 본문으로 본다(마지막 절도 포함).
    parts = re.split(r'<span class="number">(\d+)&nbsp;&nbsp;&nbsp;</span>', body)
    for num, seg in zip(parts[1::2], parts[2::2]):
        t = html.unescape(re.sub(r"<[^>]+>", "", seg))
        verses[num] = re.sub(r"\s+", " ", t).strip()
    return verses


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for ref in sys.argv[1:]:
        osis, ch = ref.split(".")
        p = OUT / f"{osis}.{ch}.json"
        if p.exists():
            continue
        v = fetch(osis, int(ch))
        p.write_text(json.dumps(v, ensure_ascii=False), encoding="utf-8")
        print(ref, len(v))
        time.sleep(1.0)  # 서버 부담을 줄이려고 장마다 1초 쉰다


if __name__ == "__main__":
    main()
