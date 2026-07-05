#!/usr/bin/env python3
"""Parse the ASTC Travel Passport participant list PDF into structured JSON.

Strategy: extract text per page with pypdf (which reads the 2-column layout in
correct order), then segment entries using the "Reciprocal Membership(s)" line
that appears exactly once per entry. Each entry's header block (name, address,
phone, email, url) is parsed backwards from that anchor; the membership block
(individual tiers, group tiers, proof-of-residence flag) runs from the anchor
to the start of the next entry's header block.
"""

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "assets" / "Standard-List-11pt-Font.pdf"
OUT = ROOT / "data" / "museums_raw.json"

ANCHOR = "Reciprocal Membership(s)"
POR = "Proof of Residence Required"

US_STATES = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR",
    "CALIFORNIA": "CA", "COLORADO": "CO", "CONNECTICUT": "CT", "DELAWARE": "DE",
    "DISTRICT OF COLUMBIA": "DC", "FLORIDA": "FL", "GEORGIA": "GA",
    "HAWAII": "HI", "IDAHO": "ID", "ILLINOIS": "IL", "INDIANA": "IN",
    "IOWA": "IA", "KANSAS": "KS", "KENTUCKY": "KY", "LOUISIANA": "LA",
    "MAINE": "ME", "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI",
    "MINNESOTA": "MN", "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT",
    "NEBRASKA": "NE", "NEVADA": "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR",
    "PENNSYLVANIA": "PA", "PUERTO RICO": "PR", "RHODE ISLAND": "RI",
    "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", "TENNESSEE": "TN",
    "TEXAS": "TX", "UTAH": "UT", "VERMONT": "VT", "VIRGINIA": "VA",
    "WASHINGTON": "WA", "WEST VIRGINIA": "WV", "WISCONSIN": "WI", "WYOMING": "WY",
}

COUNTRIES = {
    "AUSTRALIA", "BERMUDA", "CANADA", "CZECH REPUBLIC", "ISRAEL",
    "MALAYSIA", "PHILIPPINES", "SINGAPORE", "UNITED KINGDOM", "MEXICO",
    "BRAZIL", "INDIA", "SOUTH KOREA", "SPAIN", "FINLAND", "SWEDEN",
}
SECTIONS = set(US_STATES) | COUNTRIES

PHONE_RE = re.compile(r"^[+(]?[\d(][\d\s().\-]{6,}$")
URL_RE = re.compile(r"^(https?://|www\.)", re.I)


def is_section(line: str) -> bool:
    return line.strip() in SECTIONS


def is_blank(line: str) -> bool:
    return not line.strip()


def extract_lines() -> tuple[list[str], set[int]]:
    """Return all lines plus the indices of page-leading blank lines.

    Every page starts with decorative whitespace lines; treating those as
    entry separators would split entries that straddle a page break.
    """
    reader = PdfReader(PDF)
    lines: list[str] = []
    page_leading_blanks: set[int] = set()
    for page in reader.pages:
        page_lines = page.extract_text().splitlines()
        n = 0
        while n < len(page_lines) and not page_lines[n].strip():
            page_leading_blanks.add(len(lines) + n)
            n += 1
        lines.extend(page_lines)
    return lines, page_leading_blanks


def parse(lines: list[str], page_leading_blanks: set[int]):
    anchors = [i for i, l in enumerate(lines) if l.strip() == ANCHOR]
    entries = []
    problems = []

    # Header block of entry k lives directly above anchors[k]:
    #   name line(s), address line(s), phone?, email?, url?
    # Parse it backwards from the anchor. Blank lines may appear inside the
    # block where a field is missing (e.g. no email) or at page breaks, so we
    # match fields structurally instead of stopping at the first blank.
    def parse_header_backward(anchor: int, seg_start: int):
        """Return (boundary, header) where lines[boundary:anchor] is the
        header block of the entry whose anchor is at `anchor`."""
        url = email = phone = None
        i = anchor - 1

        def skip_blanks(i):
            while i >= seg_start and is_blank(lines[i]):
                i -= 1
            return i

        i = skip_blanks(i)
        if i >= seg_start and URL_RE.match(lines[i].strip()):
            url = lines[i].strip()
            i = skip_blanks(i - 1)
        elif i > seg_start and URL_RE.match(lines[i - 1].strip()):
            # URL wrapped across two lines
            url = lines[i - 1].strip() + lines[i].strip()
            i = skip_blanks(i - 2)
        if i >= seg_start and "@" in lines[i] and " " not in lines[i].strip():
            email = lines[i].strip()
            i = skip_blanks(i - 1)
        if i >= seg_start and PHONE_RE.match(lines[i].strip()):
            phone = lines[i].strip()
            i -= 1
            # phone continuation is never wrapped, no blank skip: name/address
            # must be contiguous directly above (page-break blanks excepted)
        # name + address: contiguous non-blank run (skipping page-break blanks)
        content = []
        while i >= seg_start:
            l = lines[i]
            if is_blank(l):
                if i in page_leading_blanks:
                    i -= 1
                    continue
                break
            if l.strip() == POR or is_section(l):
                break
            content.insert(0, l.strip())
            i -= 1
        boundary = i + 1
        if not content:
            return boundary, None
        # address starts at first line beginning with a digit (skipping the
        # first line, which is always part of the name); else last line
        addr_start = None
        for idx, l in enumerate(content):
            if idx > 0 and re.match(r"^\d|^I40|^U Planet|^Ta Do|^Pier |^JY C|^Petronas|^Weizmann", l):
                addr_start = idx
                break
        if addr_start is None:
            addr_start = len(content) - 1
        name = " ".join(content[:addr_start]).strip()
        address = " ".join(content[addr_start:]).strip()
        return boundary, {
            "name": name, "address": address,
            "phone": phone, "email": email, "url": url,
        }

    section_positions = [(i, lines[i].strip()) for i in range(len(lines)) if is_section(lines[i])]

    # first pass: find each entry's header block boundary
    boundaries = []
    headers = []
    for k, a in enumerate(anchors):
        seg_start = anchors[k - 1] + 1 if k > 0 else 0
        boundary, header = parse_header_backward(a, seg_start)
        boundaries.append(boundary)
        headers.append(header)

    for k, a in enumerate(anchors):
        header = headers[k]
        region = None
        for pos, name in section_positions:
            if pos < boundaries[k]:
                region = name
            else:
                break

        # membership block: from this anchor to the next entry's boundary
        mb_end = boundaries[k + 1] if k + 1 < len(anchors) else len(lines)
        mlines = [l.strip() for l in lines[a + 1 : mb_end]]
        por = any(l == POR for l in mlines)
        mtext = " ".join(l for l in mlines if l and l != POR and not is_section(l))
        m = re.match(
            r"Individual Membership\(s\):(?P<ind>.*?)Group Membership\(s\):(?P<grp>.*)$",
            mtext,
        )
        if not m:
            problems.append((k, header["name"] if header else "?", "no membership match", mtext[:120]))
            ind_raw, grp_raw = "", ""
        else:
            ind_raw, grp_raw = m.group("ind").strip(), m.group("grp").strip()

        def tiers(raw):
            raw = raw.strip()
            if not raw or raw.lower().startswith("membership information not listed"):
                return []
            return [t.strip() for t in raw.split(",") if t.strip()]

        if header is None:
            problems.append((k, "?", "no header", ""))
            continue
        entries.append({
            "name": header["name"],
            "address": header["address"],
            "phone": header["phone"],
            "email": header["email"],
            "url": header["url"],
            "region": region.title() if region else None,
            "state": US_STATES.get(region) if region else None,
            "country": "US" if region in US_STATES else None,
            "individual_tiers": tiers(ind_raw),
            "group_tiers": tiers(grp_raw),
            "proof_of_residence": por,
        })

    return entries, problems


def main():
    lines, page_leading_blanks = extract_lines()
    entries, problems = parse(lines, page_leading_blanks)
    # non-US countries: region section after the last US state
    non_us = [e for e in entries if e["country"] is None]
    for e in non_us:
        e["country"] = (e["region"] or "").upper() or None

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(entries, indent=1, ensure_ascii=False))
    print(f"entries: {len(entries)}")
    print(f"problems: {len(problems)}")
    for p in problems:
        print("  PROBLEM:", p)
    # validation summary
    no_name = [e for e in entries if not e["name"]]
    no_addr = [e for e in entries if not e["address"]]
    no_tiers = [e for e in entries if not e["individual_tiers"] and not e["group_tiers"]]
    regions = sorted({e["region"] for e in entries if e["region"]})
    print(f"missing name: {len(no_name)}, missing address: {len(no_addr)}, no qualifying tiers: {len(no_tiers)}")
    print(f"regions ({len(regions)}):", ", ".join(regions))
    for e in no_name + no_addr:
        print("  BAD:", e)
    # suspicious: name lines that look like tier continuations
    for e in entries:
        if re.search(r"Membership|Season Ticket|Annual Pass", e["name"]):
            print("  SUSPECT NAME:", e["name"])
        if e["address"] and not re.search(r"\d", e["address"]):
            print("  SUSPECT ADDR:", e["name"], "|", e["address"])


if __name__ == "__main__":
    main()
