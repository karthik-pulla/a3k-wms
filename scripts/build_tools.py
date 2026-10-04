"""Step 4: put the generated data into each tool's template and write the page that gets published.

tools/warehouse-count/template.html + data/generated/count.json         -> tools/warehouse-count/dist/warehouse-count.html
tools/label-maker/template.html     + data/generated/label-catalog.json -> tools/label-maker/dist/label-maker.html
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # the WMS folder
TOOLS = {"warehouse-count": "count.json", "label-maker": "label-catalog.json"}

for tool, data in TOOLS.items():
    tpl = (ROOT / "tools" / tool / "template.html").read_text()
    assert tpl.count("/*DATA*/") == 1, f"{tool}: template needs exactly one /*DATA*/ marker"
    out = ROOT / "tools" / tool / "dist" / f"{tool}.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(tpl.replace("/*DATA*/", (ROOT / "data" / "generated" / data).read_text()))
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")
